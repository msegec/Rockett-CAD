import { defineKernelJobs, type KernelJobScope } from "@rockett/plugin-api";
import type { Arc, Xy } from "../shared/ir.js";
import type { Placement } from "../shared/setup.js";

export type Segment =
  | { kind: "line"; to: Xy }
  | { kind: "arc"; to: Xy; centre: Xy; dir: Arc["dir"] };

export type RegionLoop = { start: Xy; segments: Segment[] };

export type Regions = {
  floors: number[];
  sections: { z: number; loops: RegionLoop[] }[];
};

export type RegionsInput = {
  brep: string;
  modelToSetup: Placement;
  z: number[];
};
type Edge = { from: Xy; segment: Segment };

const LENGTH = 1e-6;
const FACING = 1 - 1e-9;

const same = (a: Xy, b: Xy) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= LENGTH;

function read({ oc, own }: KernelJobScope, text: string) {
  const file = `/rockett-cam-regions-${crypto.randomUUID()}.brep`;
  try {
    oc.FS.writeFile(file, text);
    const shape = own(new oc.TopoDS_Shape());
    const range = own(new oc.Message_ProgressRange_1());
    const builder = own(new oc.BRep_Builder());
    if (!oc.BRepTools.Read_2(shape, file, builder, range) || shape.IsNull())
      throw new Error("regions input is not a readable BREP body");
    return shape;
  } finally {
    if (oc.FS.analyzePath(file).exists) oc.FS.unlink(file);
  }
}

function toSetup({ oc, own }: KernelJobScope, shape: any, at: Placement) {
  const trsf = own(new oc.gp_Trsf_1());
  trsf.SetRotation_2(own(new oc.gp_Quaternion_2(...at.rotation)));
  trsf.SetTranslationPart(own(new oc.gp_Vec_4(...at.translation)));
  const moved = own(
    new oc.BRepBuilderAPI_Transform_2(shape, trsf, true, false),
  );
  return own(moved.Shape());
}

function* shapes({ oc, own }: KernelJobScope, shape: any, kind: string) {
  const found = own(
    new oc.TopExp_Explorer_2(
      shape,
      oc.TopAbs_ShapeEnum[kind],
      oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
    ),
  );
  for (; found.More(); found.Next()) yield own(found.Current());
}

function floors(scope: KernelJobScope, body: any): number[] {
  const { oc, own } = scope;
  const levels: number[] = [];
  for (const face of shapes(scope, body, "TopAbs_FACE")) {
    const surface = own(
      new oc.BRepAdaptor_Surface_2(own(oc.TopoDS.Face_1(face)), true),
    );
    if (surface.GetType() !== oc.GeomAbs_SurfaceType.GeomAbs_Plane) continue;
    const plane = own(surface.Plane());
    const reversed =
      face.Orientation_1() === oc.TopAbs_Orientation.TopAbs_REVERSED;
    const direct = own(plane.Position()).Direct();
    const up =
      own(own(plane.Axis()).Direction()).Z() *
      (reversed ? -1 : 1) *
      (direct ? 1 : -1);
    const z = own(plane.Location()).Z();
    if (up < FACING || levels.some((level) => Math.abs(level - z) <= LENGTH))
      continue;
    const below = levels.findIndex((level) => level < z);
    levels.splice(below < 0 ? levels.length : below, 0, z);
  }
  return levels;
}

function edge(scope: KernelJobScope, shape: any, z: number): Edge {
  const { oc, own } = scope;
  const curve = own(new oc.BRepAdaptor_Curve_2(own(oc.TopoDS.Edge_1(shape))));
  const xy = (t: number): Xy => {
    const p = own(curve.Value(t));
    return [p.X(), p.Y()];
  };
  const from = xy(curve.FirstParameter());
  const to = xy(curve.LastParameter());
  const type = curve.GetType();
  if (type === oc.GeomAbs_CurveType.GeomAbs_Line)
    return { from, segment: { kind: "line", to } };
  if (type === oc.GeomAbs_CurveType.GeomAbs_Circle) {
    const circle = own(curve.Circle());
    const centre = own(circle.Location());
    const up = own(own(circle.Axis()).Direction()).Z();
    return {
      from,
      segment: {
        kind: "arc",
        to,
        centre: [centre.X(), centre.Y()],
        dir: up > 0 ? "ccw" : "cw",
      },
    };
  }
  const name = Object.entries(oc.GeomAbs_CurveType).find(
    ([, value]) => value === type,
  )?.[0];
  throw new Error(
    `section at Z ${z} has an edge of type ${name?.replace("GeomAbs_", "") ?? "unknown"}, not a line or arc`,
  );
}

function reverse({ from, segment }: Edge): Edge {
  return {
    from: segment.to,
    segment:
      segment.kind === "line"
        ? { kind: "line", to: from }
        : {
            ...segment,
            to: from,
            dir: segment.dir === "ccw" ? "cw" : "ccw",
          },
  };
}

function chain(edges: Edge[], z: number): RegionLoop[] {
  const left = [...edges];
  const loops: RegionLoop[] = [];
  while (left.length) {
    const first = left.shift()!;
    const loop: RegionLoop = { start: first.from, segments: [first.segment] };
    let at = first.segment.to;
    while (!same(at, loop.start)) {
      const next = left.findIndex(
        ({ from, segment }) => same(from, at) || same(segment.to, at),
      );
      if (next < 0)
        throw new Error(
          `section at Z ${z} leaves an open chain at (${at[0]}, ${at[1]})`,
        );
      const [found] = left.splice(next, 1);
      const step = same(found!.from, at) ? found! : reverse(found!);
      loop.segments.push(step.segment);
      at = step.segment.to;
    }
    loop.segments[loop.segments.length - 1]!.to = loop.start;
    loops.push(loop);
  }
  return loops;
}

function section(scope: KernelJobScope, body: any, z: number): RegionLoop[] {
  const { oc, own } = scope;
  const plane = own(
    new oc.gp_Pln_3(
      own(new oc.gp_Pnt_3(0, 0, z)),
      own(new oc.gp_Dir_5(0, 0, 1)),
    ),
  );
  const cut = own(new oc.BRepAlgoAPI_Section_5(body, plane, false));
  cut.Build(own(new oc.Message_ProgressRange_1()));
  if (!cut.IsDone()) throw new Error(`section at Z ${z} failed`);
  const edges = [...shapes(scope, own(cut.Shape()), "TopAbs_EDGE")];
  return chain(
    edges.map((shape) => edge(scope, shape, z)),
    z,
  );
}

export default defineKernelJobs({
  "rockett.cam.regions": (input: RegionsInput, scope): Regions => {
    const body = toSetup(scope, read(scope, input.brep), input.modelToSetup);
    const found = floors(scope, body);
    const sections = input.z.map((z, index) => {
      const loops = section(scope, body, z);
      scope.progress(index + 1, input.z.length, "regions");
      return { z, loops };
    });
    return { floors: found, sections };
  },
});
