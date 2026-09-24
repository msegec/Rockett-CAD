import {
  LINEAR_TOL,
  UNIT_DOT_TOL,
  type EdgeRef,
  type FaceRef,
  type RefSignature,
} from "@rockett/shared";
import { faces, release, type Shape } from "./kernel.js";
import { compareNames, computeEdgeNames, type NamedBody } from "./naming.js";
import { edgeSignature, faceSignature } from "./signature.js";

type Ref = FaceRef | EdgeRef;
type Kind = Ref["kind"];

export interface RefCandidate {
  bodyId: string;
  name: string;
  basis: "lineage" | "signature";
}

export type RefResolution =
  | { status: "resolved" }
  | {
      status: "candidate" | "ambiguous" | "missing";
      candidates: RefCandidate[];
      suggestions: RefCandidate[];
    };

const EDGE = /^e\[(.*)\]((?:~\d+)*)$/;

const nameOf = (ref: Ref) =>
  ref.kind === "face" ? ref.faceName : ref.edgeName;

const untie = (name: string) => name.replace(/~\?\d+/g, "");

const within = (a: string, b: string) =>
  a === b || a.startsWith(`${b}~`) || b.startsWith(`${a}~`);

function paired(xs: string[], ys: string[]): boolean {
  const [first, ...rest] = xs;
  if (first === undefined) return ys.length === 0;
  return ys.some(
    (y, i) =>
      within(first, y) &&
      paired(
        rest,
        ys.filter((_, j) => j !== i),
      ),
  );
}

function related(kind: Kind, a: string, b: string): boolean {
  const [x, y] = [untie(a), untie(b)];
  if (kind === "face") return within(x, y);
  const [ex, ey] = [EDGE.exec(x), EDGE.exec(y)];
  return (
    !!ex &&
    !!ey &&
    within(ex[2]!, ey[2]!) &&
    paired(ex[1]!.split("|"), ey[1]!.split("|"))
  );
}

function faceParts(kind: Kind, name: string): string[] {
  const plain = untie(name);
  return kind === "face" ? [plain] : (EDGE.exec(plain)?.[1]?.split("|") ?? []);
}

const byBodyAndName = (a: RefCandidate, b: RefCandidate) =>
  compareNames(a.bodyId, b.bodyId) || compareNames(a.name, b.name);

class Topology {
  private readonly named = new Map<string, Map<string, Shape>>();
  private readonly signatures = new Map<Shape, RefSignature>();

  of(body: NamedBody, kind: Kind): Map<string, Shape> {
    const key = `${kind}\n${body.bodyId}`;
    const known = this.named.get(key);
    if (known) return known;
    const named =
      kind === "edge" ? computeEdgeNames(body).byName : namedFaces(body);
    this.named.set(key, named);
    return named;
  }

  signature(kind: Kind, shape: Shape): RefSignature {
    const known = this.signatures.get(shape);
    if (known) return known;
    const sig = kind === "face" ? faceSignature(shape) : edgeSignature(shape);
    this.signatures.set(shape, sig);
    return sig;
  }

  release(): void {
    for (const named of this.named.values()) release(named.values());
  }
}

function namedFaces(body: NamedBody): Map<string, Shape> {
  const named = new Map<string, Shape>();
  for (const face of faces(body.shape)) {
    const name = body.names.get(face);
    if (name && !named.has(name)) named.set(name, face);
    else face.delete();
  }
  return named;
}

function lineage(
  topology: Topology,
  body: NamedBody,
  kind: Kind,
  name: string,
): RefCandidate[] {
  return [...topology.of(body, kind).keys()]
    .filter((other) => related(kind, name, other))
    .map((other) => ({ bodyId: body.bodyId, name: other, basis: "lineage" }));
}

function aligned(kind: Kind, a: RefSignature, b: RefSignature): boolean {
  const dot = a.direction.reduce((sum, x, i) => sum + x * b.direction[i]!, 0);
  return (kind === "edge" ? Math.abs(dot) : dot) >= 1 - UNIT_DOT_TOL;
}

function nearest(
  topology: Topology,
  body: NamedBody,
  kind: Kind,
  sig: RefSignature,
): RefCandidate[] {
  const matches = [...topology.of(body, kind)].flatMap(([name, shape]) => {
    const found = topology.signature(kind, shape);
    if (found.type !== sig.type || !aligned(kind, found, sig)) return [];
    const gap = Math.hypot(...found.point.map((x, i) => x - sig.point[i]!));
    return [{ name, gap }];
  });
  const best = Math.min(...matches.map((m) => m.gap));
  return matches
    .filter((m) => m.gap <= best + LINEAR_TOL)
    .map((m) => ({ bodyId: body.bodyId, name: m.name, basis: "signature" }));
}

function suggestions(
  topology: Topology,
  bodies: ReadonlyMap<string, NamedBody>,
  ref: Ref,
): RefCandidate[] {
  const name = nameOf(ref);
  const parts = faceParts(ref.kind, name);
  const found = [...bodies.values()]
    .filter(
      (other) =>
        other.bodyId !== ref.bodyId &&
        [...other.names.values()].some((face) =>
          parts.some((part) => within(untie(face), part)),
        ),
    )
    .flatMap((other) => lineage(topology, other, ref.kind, name));
  found.sort(byBodyAndName);
  return found;
}

function resolveRef(
  topology: Topology,
  bodies: ReadonlyMap<string, NamedBody>,
  ref: Ref,
): RefResolution {
  const name = nameOf(ref);
  const body = bodies.get(ref.bodyId);
  if (body && !name.includes("~?") && topology.of(body, ref.kind).has(name))
    return { status: "resolved" };
  const lineal = body ? lineage(topology, body, ref.kind, name) : [];
  const candidates =
    lineal.length === 0 && body && ref.sig
      ? nearest(topology, body, ref.kind, ref.sig)
      : lineal;
  candidates.sort(byBodyAndName);
  const status =
    candidates.length === 0
      ? "missing"
      : candidates.length === 1
        ? "candidate"
        : "ambiguous";
  return {
    status,
    candidates,
    suggestions: suggestions(topology, bodies, ref),
  };
}

export function resolveRefs(
  bodies: ReadonlyMap<string, NamedBody>,
  refs: Ref[],
): RefResolution[] {
  const topology = new Topology();
  try {
    return refs.map((ref) => resolveRef(topology, bodies, ref));
  } finally {
    topology.release();
  }
}
