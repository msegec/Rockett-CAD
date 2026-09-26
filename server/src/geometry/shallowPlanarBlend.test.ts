import { beforeAll, expect, it } from "vitest";
import { edges, getKernel, initKernel, progress } from "./kernel.js";
import { curveInfo } from "./tessellate.js";

beforeAll(async () => {
  await initKernel();
}, 120_000);

function joinedFold(angle: number, crest: boolean) {
  const k = getKernel();
  const rise = 10 * Math.tan((angle / 2) * (Math.PI / 180)) * (crest ? 1 : -1);
  const owned: { delete(): void }[] = [];
  const prism = (points: number[][]) => {
    const polygon = new k.BRepBuilderAPI_MakePolygon_1();
    owned.push(polygon);
    for (const [x, y] of points) {
      const point = new k.gp_Pnt_3(x, y, 0);
      polygon.Add_1(point);
      point.delete();
    }
    polygon.Close();
    const wire = polygon.Wire();
    owned.push(wire);
    const faceBuilder = new k.BRepBuilderAPI_MakeFace_15(wire, true);
    owned.push(faceBuilder);
    const face = faceBuilder.Face();
    owned.push(face);
    const vector = new k.gp_Vec_4(0, 0, 38.5);
    owned.push(vector);
    const builder = new k.BRepPrimAPI_MakePrism_1(face, vector, false, true);
    owned.push(builder);
    const shape = builder.Shape();
    owned.push(shape);
    return shape;
  };
  const left = prism([
    [0, 0],
    [10, 0],
    [10, 20 + rise],
    [0, 20],
  ]);
  const right = prism([
    [10, 0],
    [20, 0],
    [20, 20],
    [10, 20 + rise],
  ]);
  const fuse = new k.BRepAlgoAPI_Fuse_3(left, right, progress());
  owned.push(fuse);
  fuse.Build(progress());
  expect(fuse.IsDone()).toBe(true);
  const shape = fuse.Shape();
  owned.push(shape);
  const allEdges = edges(shape);
  owned.push(...allEdges);
  const edge = allEdges.find((candidate) => {
    const curve = curveInfo(candidate);
    return (
      curve.type === "line" &&
      Math.abs(curve.a[0] - 10) < 1e-6 &&
      Math.abs(curve.b[0] - 10) < 1e-6 &&
      Math.abs(curve.a[1] - (20 + rise)) < 1e-6 &&
      Math.abs(curve.b[1] - (20 + rise)) < 1e-6
    );
  });
  expect(edge).toBeDefined();
  return {
    shape,
    edge: edge!,
    release: () => owned.reverse().forEach((handle) => handle.delete()),
  };
}

function blend(shape: any, edge: any, type: "fillet" | "chamfer") {
  const k = getKernel();
  const builder =
    type === "fillet"
      ? new k.BRepFilletAPI_MakeFillet(
          shape,
          k.ChFi3d_FilletShape.ChFi3d_Rational,
        )
      : new k.BRepFilletAPI_MakeChamfer(shape);
  try {
    builder.Add_2(0.1, edge);
    const contours = builder.NbContours();
    if (!contours) return { contours, done: false, valid: false };
    builder.Build(progress());
    const done = builder.IsDone();
    if (!done) return { contours, done, valid: false };
    const result = builder.Shape();
    const checker = new k.BRepCheck_Analyzer(result, true, false, false);
    try {
      return { contours, done, valid: checker.IsValid_2() };
    } finally {
      checker.delete();
      result.delete();
    }
  } finally {
    builder.delete();
  }
}

it.each([
  [1, true, "fillet"],
  [1, true, "chamfer"],
  [1, false, "fillet"],
  [1, false, "chamfer"],
  [4.3207, true, "fillet"],
  [4.3207, true, "chamfer"],
  [4.3207, false, "fillet"],
  [4.3207, false, "chamfer"],
] as const)(
  "%s degree joined %s accepts a valid %s",
  (angle, crest, type) => {
    const fold = joinedFold(angle, crest);
    try {
      expect(blend(fold.shape, fold.edge, type)).toEqual({
        contours: 1,
        done: true,
        valid: true,
      });
    } finally {
      fold.release();
    }
  },
  120_000,
);

it.each(["fillet", "chamfer"] as const)(
  "rejects a nearly tangent joined edge for %s",
  (type) => {
    const fold = joinedFold(0.001, true);
    try {
      expect(blend(fold.shape, fold.edge, type).contours).toBe(0);
    } finally {
      fold.release();
    }
  },
  120_000,
);
