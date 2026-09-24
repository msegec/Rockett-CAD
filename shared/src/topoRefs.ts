import type { EdgeRef, FaceRef, Feature } from "./model.js";

export function collectTopoRefs(feature: Feature): Array<FaceRef | EdgeRef> {
  const found: Array<FaceRef | EdgeRef> = [];
  const visit = (value: unknown): void => {
    if (typeof value !== "object" || value === null) return;
    const item = value as Record<string, unknown>;
    if (
      (item.kind === "face" && typeof item.faceName === "string") ||
      (item.kind === "edge" && typeof item.edgeName === "string")
    ) {
      found.push(value as FaceRef | EdgeRef);
      return;
    }
    Object.values(item).forEach(visit);
  };
  visit(feature);
  return found;
}

const refKey = (ref: FaceRef | EdgeRef) =>
  `${ref.kind}\n${ref.bodyId}\n${ref.kind === "face" ? ref.faceName : ref.edgeName}`;

export function unsignedRefs(
  feature: Feature,
  previous?: Feature,
): Array<FaceRef | EdgeRef> {
  const known = new Map(
    (previous ? collectTopoRefs(previous) : []).map((r) => [refKey(r), r.sig]),
  );
  return collectTopoRefs(feature).filter((ref) => {
    const sig = ref.sig ?? known.get(refKey(ref));
    if (sig) ref.sig = sig;
    return !sig;
  });
}
