import {
  sketchSpaceCurve,
  type ExactCurve,
  type ProjectionRef,
} from "@rockett/shared";
import type { EvalState } from "./featureState.js";
import { computeEdgeNames } from "./naming.js";
import { exactCurve } from "./edgeCurve.js";
import { release } from "./kernel.js";

export const sourceLabel = (ref: ProjectionRef) =>
  ref.kind === "edge"
    ? `edge ${ref.edgeName}`
    : `sketch entity ${ref.entityId} of ${ref.sketchId}`;

export function sourceCurve(
  state: EvalState,
  ref: ProjectionRef,
): ExactCurve | undefined {
  if (ref.kind === "sketchEntity") {
    const sketch = state.sketches.get(ref.sketchId);
    return sketch && sketchSpaceCurve(sketch, ref.entityId);
  }
  const body = state.bodies.get(ref.bodyId);
  const byName = body && computeEdgeNames(body).byName;
  try {
    const edge = byName?.get(ref.edgeName);
    return edge && exactCurve(edge);
  } finally {
    release(byName?.values() ?? []);
  }
}
