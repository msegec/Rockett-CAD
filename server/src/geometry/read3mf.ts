import { inflateRawSync } from "node:zlib";
import type { MeshPart } from "./importers.js";

const MAX_3MF_EXPANDED = 256 * 1024 * 1024;
const MAX_3MF_COMPONENTS = 100_000;

const UNITS: Record<string, number> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
};

const TAG = /<(\/?)([A-Za-z_][\w.:-]*)([^>]*?)(\/?)>/g;
const ATTR = /([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

const tooLarge = () =>
  new Error(
    `The 3MF file expands past ${MAX_3MF_EXPANDED / 1024 / 1024} MB, the limit.`,
  );
const invalid = () => new Error("The 3MF file is not a valid zip package.");

interface Entry {
  data: Buffer;
  method: number;
  flags: number;
}

function zipEntries(zip: Buffer): Map<string, Entry> {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0 || end + 22 > zip.length) throw invalid();
  const entries = new Map<string, Entry>();
  let p = zip.readUInt32LE(end + 16);
  for (let i = zip.readUInt16LE(end + 10); i > 0; i--) {
    if (p + 46 > end || zip.readUInt32LE(p) !== 0x02014b50) throw invalid();
    const nameLength = zip.readUInt16LE(p + 28),
      local = zip.readUInt32LE(p + 42);
    if (local + 30 > end || zip.readUInt32LE(local) !== 0x04034b50)
      throw invalid();
    const start =
      local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    entries.set(
      zip.toString("utf8", p + 46, p + 46 + nameLength).toLowerCase(),
      {
        data: zip.subarray(start, start + zip.readUInt32LE(p + 20)),
        method: zip.readUInt16LE(p + 10),
        flags: zip.readUInt16LE(p + 8),
      },
    );
    p += 46 + nameLength + zip.readUInt16LE(p + 30) + zip.readUInt16LE(p + 32);
  }
  return entries;
}

function expand({ data, method, flags }: Entry, limit: number): Buffer {
  if (flags & 1)
    throw new Error("The 3MF file is encrypted, which is not supported.");
  if (method !== 0 && method !== 8) throw invalid();
  let out = data;
  if (method === 8)
    try {
      out = inflateRawSync(data, { maxOutputLength: Math.max(limit, 1) });
    } catch (error) {
      if ((error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE")
        throw tooLarge();
      throw invalid();
    }
  if (out.length > limit) throw tooLarge();
  return out;
}

function* tags(xml: string) {
  for (const [, close, name, body, empty] of xml
    .replace(/<!--[\s\S]*?-->/g, "")
    .matchAll(TAG)) {
    const attrs: Record<string, string> = {};
    for (const [, key, double, single] of body!.matchAll(ATTR))
      attrs[key!] = double ?? single!;
    yield { close: close === "/", name: name!, attrs, empty: empty === "/" };
  }
}

function modelPath(rels: string | undefined): string {
  for (const { name, attrs } of rels ? tags(rels) : [])
    if (name === "Relationship" && attrs.Type?.endsWith("/3dmodel"))
      return attrs.Target!;
  return "/3D/3dmodel.model";
}

function transformOf(value: string | undefined): number[] {
  const m = (value ?? "1 0 0 0 1 0 0 0 1 0 0 0")
    .trim()
    .split(/\s+/)
    .map(Number);
  if (m.length !== 12 || !m.every(Number.isFinite))
    throw new Error(`The 3MF transform "${value}" is not valid.`);
  return m;
}

const key = (path: string) => path.replace(/^\//, "").toLowerCase();

const compose = (a: number[], b: number[]) =>
  Array.from({ length: 12 }, (_, n) => {
    const i = 3 * Math.floor(n / 3),
      j = n % 3;
    return (
      a[i]! * b[j]! +
      a[i + 1]! * b[3 + j]! +
      a[i + 2]! * b[6 + j]! +
      (i === 9 ? b[9 + j]! : 0)
    );
  });

interface ModelObject {
  id: string;
  nodes: number[];
  triangles: number[];
  components: { objectid: string; path?: string; transform?: string }[];
}

interface Model {
  scale: number;
  objects: Map<string, ModelObject>;
  items: { objectid: string; transform?: string }[];
}

function parseModel(xml: string): Model {
  const model: Model = { scale: 1, objects: new Map(), items: [] };
  let object: ModelObject | undefined;
  for (const { close, name, attrs, empty } of tags(xml)) {
    if (name === "model" && !close) {
      const unit = attrs.unit ?? "millimeter";
      if (!Object.hasOwn(UNITS, unit))
        throw new Error(`The 3MF unit "${unit}" is not supported.`);
      model.scale = UNITS[unit]!;
    } else if (name === "object" && !close && !empty) {
      object = { id: attrs.id ?? "", nodes: [], triangles: [], components: [] };
    } else if (name === "object" && close) {
      if (object) model.objects.set(object.id, object);
      object = undefined;
    } else if (name === "vertex" && object) {
      const point = [attrs.x, attrs.y, attrs.z].map(Number);
      if (!point.every(Number.isFinite))
        throw new Error(`The 3MF object ${object.id} has an invalid vertex.`);
      object.nodes.push(...point);
    } else if (name === "triangle" && object) {
      const corners = [attrs.v1, attrs.v2, attrs.v3].map(Number);
      if (
        !corners.every(
          (v) => Number.isInteger(v) && v >= 0 && v < object!.nodes.length / 3,
        )
      )
        throw new Error(
          `The 3MF object ${object.id} has a triangle outside its vertices.`,
        );
      object.triangles.push(...corners);
    } else if (name === "component" && object) {
      object.components.push({
        objectid: attrs.objectid ?? "",
        ...(attrs["p:path"] !== undefined && { path: attrs["p:path"] }),
        ...(attrs.transform !== undefined && { transform: attrs.transform }),
      });
    } else if (name === "item") {
      model.items.push({
        objectid: attrs.objectid ?? "",
        ...(attrs.transform !== undefined && { transform: attrs.transform }),
      });
    }
  }
  return model;
}

type Step =
  { path: string; id: string; transform: number[] } | { leave: string };

export function read3mf(bytes: Buffer): MeshPart[] {
  let zip: Map<string, Entry>;
  try {
    zip = zipEntries(bytes);
  } catch (error) {
    if (error instanceof RangeError) throw invalid();
    throw error;
  }
  let left = MAX_3MF_EXPANDED;
  const text = (entry: Entry) => {
    const out = expand(entry, left);
    left -= out.length;
    return out.toString("utf8");
  };
  const models = new Map<string, Model>(),
    load = (path: string) => {
      if (!models.has(key(path))) {
        const entry = zip.get(key(path));
        if (!entry)
          throw new Error(`The 3MF file has no 3D model part ${path}.`);
        models.set(key(path), parseModel(text(entry)));
      }
      return models.get(key(path))!;
    };
  const rels = zip.get("_rels/.rels"),
    root = modelPath(rels && text(rels)),
    { scale, items } = load(root),
    parts: MeshPart[] = [],
    open = new Set<string>(),
    steps: Step[] = items
      .map(({ objectid, transform }) => ({
        path: root,
        id: objectid,
        transform: transformOf(transform).map((v) => v * scale),
      }))
      .toReversed();
  let placed = 0;
  for (let step = steps.pop(); step; step = steps.pop()) {
    if ("leave" in step) {
      open.delete(step.leave);
      continue;
    }
    const { path, id, transform } = step,
      object = load(path).objects.get(id),
      at = `${key(path)}#${id}`;
    if (!object)
      throw new Error(`The 3MF file has no object ${id} in ${path}.`);
    if (open.has(at))
      throw new Error(
        `The 3MF object ${id} in ${path} contains itself through its components.`,
      );
    if (!object.components.length)
      parts.push({
        nodes: object.nodes,
        triangles: object.triangles,
        transform,
      });
    open.add(at);
    steps.push({ leave: at });
    for (const component of object.components.toReversed()) {
      if (++placed > MAX_3MF_COMPONENTS)
        throw new Error(
          `The 3MF file places more than ${MAX_3MF_COMPONENTS.toLocaleString("en")} components, the limit.`,
        );
      const child = component.path ?? path;
      steps.push({
        path: child,
        id: component.objectid,
        transform: compose(transformOf(component.transform), transform),
      });
    }
  }
  return parts;
}
