import type { ChamferFeature } from "@rockett/shared";
import { edges as edgesOf, faces as facesOf, type Shape } from "./kernel.js";
import type { NamedBody } from "./naming.js";

function measuredFace(
  body: NamedBody,
  edge: Shape,
  selected: { edge: Shape }[],
  flip: boolean,
): Shape {
  const sides = facesOf(body.shape)
    .map((face) => ({ face, edges: edgesOf(face) }))
    .filter((side) => side.edges.some((e) => e.IsSame(edge)))
    .map(({ face, edges }) => ({
      face,
      name: body.names.get(face) ?? "?",
      shared: edges.filter((e) => selected.some((s) => s.edge.IsSame(e)))
        .length,
    }))
    .toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .toSorted((a, b) => b.shared - a.shared);
  const side = sides[flip ? sides.length - 1 : 0];
  if (!side) throw new Error("the chamfer edge has no face");
  return side.face;
}

function need(value: number | undefined, what: string): number {
  if (value === undefined) throw new Error(`the chamfer needs ${what}`);
  return value;
}

export function addChamferContour(
  op: any,
  body: NamedBody,
  edge: Shape,
  selected: { edge: Shape }[],
  f: ChamferFeature,
): void {
  if (f.chamferType === "equalDistance") return op.Add_2(f.distance, edge);
  const face = measuredFace(body, edge, selected, f.flip ?? false);
  if (f.chamferType === "twoDistances")
    return op.Add_3(
      f.distance,
      need(f.distance2, "a second distance"),
      edge,
      face,
    );
  const angle = need(f.angle, "an angle");
  op.AddDA(f.distance, (angle * Math.PI) / 180, edge, face);
}
