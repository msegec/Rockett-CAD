import {
  compareNames,
  faceMadeBy,
  type ChamferFeature,
  type EdgeRef,
  type FilletFeature,
} from "@rockett/shared";
import type { EvalState } from "./featureState.js";
import { faceNamesOf, type NamedBody } from "./naming.js";
import { sharpEdgesByFace } from "./tangentEdges.js";

const edgeRefs = (bodyId: string, names: string[]): EdgeRef[] =>
  names.map((edgeName) => ({ kind: "edge", bodyId, edgeName }));

export function blendEdges(
  state: EvalState,
  f: FilletFeature | ChamferFeature,
): EdgeRef[] {
  if (!f.faces?.length && !f.features?.length) {
    if (f.edges.length === 0) throw new Error("no edges selected");
    return f.edges;
  }
  const label = f.type === "fillet" ? "Fillet" : "Chamfer";
  const sharp = new Map<string, Map<string, string[]>>();
  const sharpOf = (body: NamedBody) => {
    const found = sharp.get(body.bodyId) ?? sharpEdgesByFace(body);
    sharp.set(body.bodyId, found);
    return found;
  };
  const picked = [...f.edges];
  for (const { bodyId, faceName } of f.faces ?? []) {
    const body = state.bodies.get(bodyId);
    if (!body) throw new Error(`body ${bodyId} no longer exists`);
    const names = sharpOf(body).get(faceName);
    if (!names)
      throw new Error(`referenced face no longer exists: ${faceName}`);
    if (names.length === 0)
      throw new Error(`${label} found no sharp edges on face ${faceName}`);
    picked.push(...edgeRefs(bodyId, names));
  }
  for (const id of f.features ?? []) {
    const made = [...state.bodies.values()]
      .filter((body) => faceNamesOf(body).some((face) => faceMadeBy(id, face)))
      .flatMap((body) => {
        const names = [...sharpOf(body)]
          .filter(([face]) => faceMadeBy(id, face))
          .flatMap(([, edges]) => edges);
        return edgeRefs(body.bodyId, names.toSorted(compareNames));
      });
    if (made.length === 0)
      throw new Error(
        `${label} found no sharp edges on the faces of feature ${id}`,
      );
    picked.push(...made);
  }
  const seen = new Set<string>();
  return picked.filter(({ bodyId, edgeName }) => {
    const key = `${bodyId}\n${edgeName}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
