import {
  StoreError,
  type CadDocument,
  type Route,
  type RouteModule,
} from "@rockett/plugin-api";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import { readBoard } from "../board.js";
import { child, parseSexpr, SEXPR_LIMITS, str } from "../sexpr.js";

const NAMESPACE = "rockett.kicad";
const VERSION = 1;
const hashSchema = Type.String({ pattern: "^[0-9a-f]{64}$" });
const linkSchema = Type.Object({
  sourceKind: Type.Literal("upload"),
  sourceAsset: hashSchema,
  sha256: hashSchema,
  formatVersion: Type.Integer(),
  generator: Type.Optional(Type.String()),
  generatorVersion: Type.Optional(Type.String()),
  snapshotAsset: hashSchema,
  outlineOwner: Type.Union([Type.Literal("kicad"), Type.Literal("rockett")]),
});
const dataSchema = Type.Object({
  links: Type.Record(Type.String(), linkSchema),
});
const body = Type.Object(
  { source: Type.String({ maxLength: Math.ceil(SEXPR_LIMITS.bytes / 3) * 4 }) },
  { additionalProperties: false },
);
export const uploadRoute: Route<
  "/projects/:id/m/rockett/kicad/upload",
  Static<typeof body>
> & { readonly body: typeof body } = {
  method: "POST",
  path: "/projects/:id/m/rockett/kicad/upload",
  body,
  effect: "document",
};

export function storedData(doc: CadDocument) {
  const stored = doc.extensions[NAMESPACE];
  if (stored === undefined) return { links: {} };
  if (stored.version !== VERSION || !Value.Check(dataSchema, stored.data))
    throw new StoreError(
      `KiCad data version ${stored.version} is not supported or valid; saved data was kept`,
    );
  if (
    Object.values(stored.data.links).some(
      (link) => link.sha256 !== link.sourceAsset,
    )
  )
    throw new StoreError(
      "KiCad data has inconsistent source hashes; saved data was kept",
    );
  return stored.data;
}

export function sourceTree(bytes: Uint8Array) {
  if (bytes.byteLength > SEXPR_LIMITS.bytes)
    throw new Error("Board input is too large");
  return parseSexpr(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

function uploaded(source: string) {
  try {
    const binary = atob(source);
    if (btoa(binary) !== source)
      throw new Error("Source must be canonical base64");
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const tree = sourceTree(bytes);
    const data = readBoard(tree);
    const metadata: { generator?: string; generatorVersion?: string } = {};
    for (const [field, key] of [
      ["generator", "generator"],
      ["generator_version", "generatorVersion"],
    ] as const) {
      const entry = child(tree, field);
      if (!entry) continue;
      const value = str(entry);
      if (value === undefined) throw new Error(`Invalid board ${field}`);
      metadata[key] = value;
    }
    return {
      bytes,
      data,
      metadata,
      snapshot: new TextEncoder().encode(
        JSON.stringify({ version: VERSION, data }),
      ),
    };
  } catch (error) {
    throw new StoreError(
      error instanceof Error ? error.message : "Invalid KiCad board",
    );
  }
}

async function hash(bytes: Uint8Array<ArrayBuffer>) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export const uploadModule: RouteModule = {
  id: "rockett.kicad.upload",
  mount(api) {
    api.projectMutation(uploadRoute, async (doc, req, ctx) => {
      const stored = storedData(doc);
      const board = uploaded(req.body.source);
      const sourceAsset = await hash(board.bytes);
      const snapshotAsset = await hash(board.snapshot);
      const previous = new Set([
        ...(doc.moduleAssets?.namespaces[NAMESPACE] ?? []),
        ...Object.values(stored.links).flatMap((link) => [
          link.sourceAsset,
          link.snapshotAsset,
        ]),
      ]);
      ctx.assets.set([...new Set([...previous, sourceAsset, snapshotAsset])]);
      for (const reference of previous) await ctx.blobs.get(reference);
      const ordered = [board.bytes, board.snapshot].toSorted(
        (a, b) => b.byteLength - a.byteLength,
      );
      for (const bytes of ordered) await ctx.blobs.put(bytes);
      const linkId = crypto.randomUUID();
      const link = {
        sourceKind: "upload",
        sourceAsset,
        sha256: sourceAsset,
        formatVersion: board.data.formatVersion,
        ...board.metadata,
        snapshotAsset,
        outlineOwner: "kicad",
      };
      doc.extensions[NAMESPACE] = {
        ...doc.extensions[NAMESPACE],
        version: VERSION,
        data: { ...stored, links: { ...stored.links, [linkId]: link } },
      };
      return { label: "Upload KiCad board", linkId };
    });
  },
};
