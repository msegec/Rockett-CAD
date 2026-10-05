import {
  LINEAR_TOL,
  UNIT_DOT_TOL,
  type EmbossFeature,
  type ExtrudeFeature,
  type PlaneRef,
  type Vec3,
} from "@rockett/shared";
import {
  acquire,
  bboxOf,
  diagonal,
  faces as facesOf,
  getKernel,
  kernelCall,
  progress,
  scoped,
  solids,
  vec,
  type Shape,
} from "./kernel.js";
import { capName, NameMap, namingVersion, propagateNames } from "./naming.js";
import { V, frameFromPlane } from "./frames.js";
import { commonOperation, cutOperation } from "./boolean.js";
import { namedResult } from "./booleanNaming.js";
import { splitPlaneFace } from "./booleanTools.js";
import {
  resolvePlaneFrame,
  type EvalState,
  type ToolResult,
} from "./featureState.js";
import {
  applyProfileTools,
  buildPrism,
  faceProfile,
  resolveProfiles,
} from "./features.js";
import type { ProfileFace } from "./sketchGeom.js";

const TO_OBJECT_MARGIN = 1;
const ORIGIN: Vec3 = [0, 0, 0];

const ONE_SIDE = "To object extends one side; choose One side";
const NOTHING_AHEAD =
  "All finds no body ahead of the profile; reverse the direction or use Distance";
const PARALLEL =
  "the To object plane is parallel to the extrude direction; pick a plane the profile can reach";
const CROSSES =
  "the To object plane crosses or touches the profile; pick a plane on one side of it";
const missing = (bodyId: string) => `body ${bodyId} no longer exists`;
const level = (bodyId: string) =>
  `body ${bodyId} is level with the profile; To object needs it on one side`;
const startsInside = (bodyId: string) =>
  `the profile starts inside body ${bodyId}; move it or use Distance`;
const misses = (bodyId: string) =>
  `the profile does not fully meet body ${bodyId}`;

interface Source {
  pf: ProfileFace;
  n: Vec3;
  copy: boolean;
}

export function evalExtrude(state: EvalState, f: ExtrudeFeature) {
  const dist = Math.abs(f.distance);
  if (dist <= 0) throw new Error("extrude distance must be non-zero");
  const faceRefs = f.faces ?? [];
  if (f.profiles.length === 0 && faceRefs.length === 0) {
    throw new Error("select at least one profile or planar face");
  }
  const to = f.extent?.kind === "toObject" ? f.extent.object : null;
  if (to && (f.direction === "symmetric" || f.direction === "twoSided"))
    throw new Error(ONE_SIDE);

  const sources: Source[] = [];
  if (f.profiles.length > 0) {
    const { faces: profileFaces, sketch } = resolveProfiles(state, f.profiles);
    for (const pf of profileFaces) {
      sources.push({ pf, n: sketch.frame.normal, copy: false });
    }
  }
  for (const ref of faceRefs)
    sources.push({ ...faceProfile(state, ref), copy: true });

  const tools = sources.map((s) =>
    !to
      ? prismTool(state, f, s)
      : to.kind === "body"
        ? bodyTool(state, f, to.bodyId, s)
        : planeTool(state, f, to, s),
  );
  return applyProfileTools(
    state,
    f,
    tools,
    sources.map((s) => s.pf),
  );
}

function prismTool(state: EvalState, f: ExtrudeFeature, s: Source) {
  const sgn = (f.direction === "reverse" ? -1 : 1) * (f.distance < 0 ? -1 : 1);
  const n = V.scale(s.n, sgn);
  const base = (f.startOffset ?? 0) * sgn;
  const [ahead, behind] = spans(state, f, s.pf, n, base);
  return buildPrism(f.id, s.pf, n, ahead + behind, base - behind, s.copy);
}

function spans(
  state: EvalState,
  f: ExtrudeFeature,
  pf: ProfileFace,
  n: Vec3,
  base: number,
): [number, number] {
  const dist = Math.abs(f.distance);
  const d2 = Math.abs(f.distance2 ?? 0);
  if (f.extent?.kind !== "all") {
    if (f.direction === "symmetric") return [dist / 2, dist / 2];
    return [dist, f.direction === "twoSided" ? d2 : 0];
  }
  const start = along(pf.face, n)[0] + base;
  const extents = [...state.bodies.values()].map((b) => along(b.shape, n));
  const ahead = Math.max(...extents.map(([, hi]) => hi - start));
  const behind =
    f.direction === "symmetric"
      ? Math.max(0, ...extents.map(([lo]) => start - lo))
      : f.direction === "twoSided"
        ? d2
        : 0;
  if (!(ahead > LINEAR_TOL) && !(f.direction === "symmetric" && behind > 0))
    throw new Error(NOTHING_AHEAD);
  return [Math.max(ahead, 0), behind];
}

function along(shape: Shape, normal: Vec3, origin = ORIGIN): [number, number] {
  const { xAxis, yAxis, normal: z } = frameFromPlane(origin, normal);
  const k = getKernel();
  return scoped((own) => {
    const trsf = own(new k.gp_Trsf_1());
    trsf.SetValues(
      ...xAxis,
      -V.dot(xAxis, origin),
      ...yAxis,
      -V.dot(yAxis, origin),
      ...z,
      -V.dot(z, origin),
    );
    const moved = own(shape.Moved(own(new k.TopLoc_Location_4(trsf)), false));
    const { min, max } = bboxOf(moved, false);
    return [min[2], max[2]];
  });
}

function planeTool(
  state: EvalState,
  f: ExtrudeFeature,
  object: PlaneRef,
  s: Source,
): ToolResult {
  const frame = resolvePlaneFrame(state, object);
  const m = frame.normal;
  const slope = V.dot(s.n, m);
  if (Math.abs(slope) < UNIT_DOT_TOL) throw new Error(PARALLEL);
  const offset = f.startOffset ?? 0;
  const [lo, hi] = along(s.pf.face, m, frame.origin).map(
    (d) => d + offset * slope,
  ) as [number, number];
  if (lo <= LINEAR_TOL && hi >= -LINEAR_TOL) throw new Error(CROSSES);
  const above = lo > 0 ? 1 : -1;
  const side = -above * Math.sign(slope);
  const reach = Math.max(Math.abs(lo), Math.abs(hi)) / Math.abs(slope);
  const n = V.scale(s.n, side);
  const prism = buildPrism(
    f.id,
    s.pf,
    n,
    reach + TO_OBJECT_MARGIN,
    offset * side,
    s.copy,
  );
  return kernelCall("extrude to object", () =>
    clipAtPlane(prism, frame.origin, V.scale(m, above), f.id),
  );
}

function clipAtPlane(
  prism: ToolResult,
  origin: Vec3,
  toProfile: Vec3,
  featureId: string,
): ToolResult {
  const k = getKernel();
  const box = bboxOf(prism.shape, false);
  const size = 2 * diagonal(box) + TO_OBJECT_MARGIN;
  const centre = V.scale(V.add(box.min, box.max), 0.5);
  const foot = V.sub(
    centre,
    V.scale(toProfile, V.dot(V.sub(centre, origin), toProfile)),
  );
  const frame = { ...frameFromPlane(foot, toProfile), origin: foot };
  const face = splitPlaneFace(frame, size, acquire);
  const half = acquire(
    new k.BRepPrimAPI_MakePrism_1(
      face,
      vec(...V.scale(toProfile, size)),
      false,
      true,
    ),
  );
  half.Build(progress());
  if (!half.IsDone()) throw new Error("the To object plane solid failed");
  const halfSpace = acquire(half.Shape());
  const op = commonOperation(prism.shape, halfSpace);
  if (!op.IsDone()) throw new Error("trimming at the To object plane failed");
  return namedResult(
    op,
    [prism, { shape: halfSpace, names: endNames(halfSpace, featureId) }],
    featureId,
  );
}

function endNames(shape: Shape, featureId: string) {
  const names = new NameMap(namingVersion());
  for (const face of facesOf(shape)) names.set(face, capName(featureId, "end"));
  return names;
}

function bodyTool(
  state: EvalState,
  f: ExtrudeFeature,
  bodyId: string,
  s: Source,
): ToolResult {
  const body = state.bodies.get(bodyId);
  if (!body) throw new Error(missing(bodyId));
  const offset = f.startOffset ?? 0;
  const start = along(s.pf.face, s.n)[0] + offset;
  const [lo, hi] = along(body.shape, s.n).map((d) => d - start) as [
    number,
    number,
  ];
  if (Math.abs(lo + hi) / 2 <= LINEAR_TOL) throw new Error(level(bodyId));
  const side = lo + hi > 0 ? 1 : -1;
  const n = V.scale(s.n, side);
  const length = (side > 0 ? hi : -lo) + TO_OBJECT_MARGIN;
  const prism = buildPrism(f.id, s.pf, n, length, offset * side, s.copy);
  const near = start * side;
  const cut = kernelCall("extrude to object", () => {
    const op = cutOperation(prism.shape, body.shape);
    if (!op.IsDone()) throw new Error("cutting at the To object body failed");
    const pieces = solids(acquire(op.Shape())).filter(
      (p) => along(p, n)[0] - near <= LINEAR_TOL,
    );
    if (pieces.length !== 1) return { error: startsInside(bodyId) };
    const piece = pieces[0]!;
    if (along(piece, n)[1] - near >= length - LINEAR_TOL)
      return { error: misses(bodyId) };
    const names = propagateNames(
      op,
      [prism, { shape: body.shape, names: endNames(body.shape, f.id) }],
      piece,
      f.id,
    );
    return { shape: piece, names };
  });
  if ("error" in cut) throw new Error(cut.error);
  return cut;
}

export function evalEmboss(state: EvalState, f: EmbossFeature) {
  const pseudo: ExtrudeFeature = {
    id: f.id,
    name: f.name,
    suppressed: false,
    type: "extrude",
    profiles: f.profiles,
    distance: Math.abs(f.depth),
    direction: f.mode === "emboss" ? "normal" : "reverse",
    operation: f.mode === "emboss" ? "join" : "cut",
    ...(f.targets && { targets: f.targets }),
  };
  return evalExtrude(state, pseudo);
}
