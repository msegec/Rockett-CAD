import { LINEAR_TOL, type Vec3 } from "@rockett/shared";
import {
  cylinderOf,
  radial,
  torusSides,
  type PlanarSide,
} from "./blendSides.js";
import { V } from "./frames.js";
import {
  dir,
  edges,
  faces,
  getKernel,
  listToArray,
  pnt,
  progress,
  shapeList,
  type Own,
  type Shape,
} from "./kernel.js";
import { blendFaceName, type NamedBody } from "./naming.js";
import {
  assembleBlend,
  copiedBody,
  planeFilletSection,
  type BlendStrip,
  type Cell,
} from "./planarFillet.js";
import { planeBoundarySample } from "./planeBoundary.js";

const TURN = 2 * Math.PI;

function torusFace(edge: Shape, sides: PlanarSide[], radius: number, own: Own) {
  const k = getKernel();
  const plane = sides.find((side) => side.radius === 0)!;
  const wall = sides.find((side) => side.radius !== 0)!;
  const cylinder = cylinderOf(wall.face, own)!;
  const { point } = planeBoundarySample(edge, plane.normal, own);
  const p: Vec3 = [point.X(), point.Y(), point.Z()];
  const out = V.normalize(radial(cylinder, p));
  const tangent = V.cross(cylinder.axis, out);
  const [section] = planeFilletSection(
    [p, V.add(p, tangent)],
    [plane, wall],
    radius,
  );
  const major = V.dot(radial(cylinder, section.centre), out);
  if (major <= LINEAR_TOL)
    throw new Error("the torus fillet would reach its axis");
  const angle = (q: Vec3) => {
    const d = V.sub(q, section.centre);
    return Math.atan2(V.dot(d, cylinder.axis), V.dot(d, out));
  };
  const [a, b] = section.contacts.map(angle) as [number, number];
  const span = (((b - a) % TURN) + TURN) % TURN;
  const [start, sweep] = span > Math.PI ? [b, TURN - span] : [a, span];
  const frame = own(
    new k.gp_Ax3_3(
      own(pnt(...V.sub(section.centre, V.scale(out, major)))),
      own(dir(...cylinder.axis)),
      own(dir(...out)),
    ),
  );
  const make = own(
    new k.BRepBuilderAPI_MakeFace_13(
      own(new k.gp_Torus_2(frame, major, radius)),
      0,
      TURN,
      start,
      start + sweep,
    ),
  );
  if (!make.IsDone()) throw new Error("the torus fillet could not be built");
  return own(make.Face());
}

type Guide = { guide: Shape; contacts: Shape[] };

function droppedBand(
  piece: Shape,
  guides: Guide[],
  images: (edge: Shape) => Shape[],
  own: Own,
) {
  const k = getKernel(),
    face = own(k.TopoDS.Face_1(piece)),
    bounds = edges(face).map(own);
  const held = guides.filter(({ guide }) =>
    bounds.some((edge) => edge.IsSame(guide)),
  );
  if (!held.length) return false;
  const allowed = held.length === 1 && [
    held[0]!.guide,
    ...held[0]!.contacts.flatMap(images),
  ];
  if (
    !allowed ||
    !bounds.every(
      (edge) =>
        k.BRep_Tool.IsClosed_2(edge, face) ||
        allowed.some((a) => a.IsSame(edge)),
    )
  )
    throw new Error("the torus fillet contacts overlap another boundary");
  return true;
}

function trimmedNeighbours(neighbours: Shape[], guides: Guide[], own: Own) {
  const k = getKernel();
  const splitter = own(new k.BRepAlgoAPI_Splitter_1());
  splitter.SetArguments(shapeList(neighbours));
  splitter.SetTools(shapeList(guides.flatMap(({ contacts }) => contacts)));
  splitter.Build(progress());
  if (!splitter.IsDone())
    throw new Error("the torus fillet contacts could not trim their faces");
  const images = (edge: Shape) => {
    const split = listToArray(splitter.Modified(edge));
    return split.length ? split : [edge];
  };
  return neighbours.map((face) => {
    const kept = listToArray(splitter.Modified(face)).filter(
      (piece) => !droppedBand(piece, guides, images, own),
    );
    if (kept.length !== 1)
      throw new Error("the torus fillet contact leaves its face");
    return own(k.TopoDS.Face_1(kept[0]));
  });
}

export function torusBlend(
  body: NamedBody,
  chain: { edge: Shape }[],
  strip: Pick<BlendStrip, "kind" | "size">,
  featureId: string,
  own: Own,
) {
  const k = getKernel();
  const original = faces(body.shape).map(own);
  const { source, edge: copiedEdge } = copiedBody(body, original, own);
  const guides = chain.map(({ edge }) => {
    const guide = copiedEdge(edge);
    const sides = torusSides(guide, source, own);
    if (!sides) throw new Error("the torus fillet guide changed in the copy");
    return { guide, sides, face: torusFace(guide, sides, strip.size, own) };
  });
  const neighbours = guides
    .flatMap(({ sides }) => sides.map((side) => side.face))
    .filter((face, i, all) => all.findIndex((f) => f.IsSame(face)) === i);
  const kept = trimmedNeighbours(
    neighbours,
    guides.map(({ guide, face }) => ({
      guide,
      contacts: edges(face)
        .map(own)
        .filter((edge) => !k.BRep_Tool.IsClosed_2(edge, face)),
    })),
    own,
  );
  const cells: Cell[] = source
    .map((face, i) => {
      const trimmed = neighbours.findIndex((n) => n.IsSame(face));
      return {
        face: trimmed < 0 ? face : kept[trimmed]!,
        name: body.names.get(original[i]!),
        made: false,
      };
    })
    .concat(
      guides.map(({ face }, i) => ({
        face,
        name: blendFaceName(featureId, i),
        made: true,
      })),
    );
  return assembleBlend(cells, body, strip, featureId, own);
}
