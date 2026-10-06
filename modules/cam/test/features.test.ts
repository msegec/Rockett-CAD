import { serverRegister } from "./helpers/serverRegister.js";
import { beforeAll, describe, expect, it } from "vitest";
import type { CadDocument, ServerBody, User } from "@rockett/plugin-api";
import cam from "../server.js";
import type { FeaturesInput } from "../src/kernel/features.js";
import type { PlanFeatures } from "../src/plan/plan.js";
import {
  CAM_EXTENSION,
  featuresRoute,
  type CamData,
} from "../src/shared/document.js";
import {
  box,
  brep,
  cut,
  cylinder,
  moduleJob,
  oc,
  scoped,
  startKernel,
  type Own,
} from "./helpers/kernel.js";

const ENTRY = new URL("../kernel.ts", import.meta.url).href;

const mark: User = {
  id: "u1",
  username: "mark",
  displayName: "Mark",
  role: "admin",
  status: "active",
  createdAt: "2026-10-06T00:00:00.000Z",
  modifiedAt: "2026-10-06T00:00:00.000Z",
};

const setup = {
  bodies: ["b1"],
  stock: {
    kind: "boxAround" as const,
    margins: { xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 2 },
  },
  wcs: {
    origin: {
      kind: "stockCorner" as const,
      x: "min" as const,
      y: "min" as const,
      z: "max" as const,
    },
    axes: { x: "+x" as const, z: "+z" as const },
    offsetIndex: 1,
    machine: { kind: "unknown" as const },
  },
};

let body: ServerBody;

function roundedPocket(own: Own) {
  const at = (x: number, y: number) => own(new oc.gp_Pnt_3(x, y, 12));
  const up = own(new oc.gp_Dir_5(0, 0, 1));
  const wire = own(new oc.BRepBuilderAPI_MakeWire_1());
  const line = (a: number[], b: number[]) =>
    own(new oc.BRepBuilderAPI_MakeEdge_3(at(a[0]!, a[1]!), at(b[0]!, b[1]!)));
  const arc = (c: number[], a: number[], b: number[]) =>
    own(
      new oc.BRepBuilderAPI_MakeEdge_10(
        own(new oc.gp_Circ_2(own(new oc.gp_Ax2_4(at(c[0]!, c[1]!), up)), 3)),
        at(a[0]!, a[1]!),
        at(b[0]!, b[1]!),
      ),
    );
  for (const made of [
    line([13, 10], [27, 10]),
    arc([27, 13], [27, 10], [30, 13]),
    line([30, 13], [30, 37]),
    arc([27, 37], [30, 37], [27, 40]),
    line([27, 40], [13, 40]),
    arc([13, 37], [13, 40], [10, 37]),
    line([10, 37], [10, 13]),
    arc([13, 13], [10, 13], [13, 10]),
  ])
    wire.Add_1(own(made.Edge()));
  const face = own(
    own(new oc.BRepBuilderAPI_MakeFace_15(own(wire.Wire()), true)).Face(),
  );
  return own(
    own(
      new oc.BRepPrimAPI_MakePrism_1(
        face,
        own(new oc.gp_Vec_4(0, 0, 9)),
        false,
        true,
      ),
    ).Shape(),
  );
}

function faceCount(text: string) {
  return scoped((own) => {
    const shape = own(new oc.TopoDS_Shape());
    const file = `/rockett-cam-features-${crypto.randomUUID()}.brep`;
    oc.FS.writeFile(file, text);
    oc.BRepTools.Read_2(
      shape,
      file,
      own(new oc.BRep_Builder()),
      own(new oc.Message_ProgressRange_1()),
    );
    oc.FS.unlink(file);
    const found = own(
      new oc.TopExp_Explorer_2(
        shape,
        oc.TopAbs_ShapeEnum.TopAbs_FACE,
        oc.TopAbs_ShapeEnum.TopAbs_SHAPE,
      ),
    );
    let count = 0;
    for (; found.More(); found.Next()) count++;
    return count;
  });
}

const named = (text: string, max: number[]): ServerBody => ({
  id: "b1",
  name: "Block",
  bbox: { min: [0, 0, 0], max } as ServerBody["bbox"],
  brep: text,
  faceNames: Array.from({ length: faceCount(text) }, (_, i) => `f:block:${i}`),
  fingerprint: "f".repeat(64),
});

beforeAll(async () => {
  await startKernel();
  const text = brep((own) => {
    const block = box(own, [0, 0, 0], [80, 60, 20]);
    const pocketed = cut(own, block, roundedPocket(own));
    const drilled = cut(
      own,
      pocketed,
      cylinder(own, [60, 30, -1], [0, 0, 1], 3, 22),
    );
    return cut(own, drilled, box(own, [70, 0, 15], [10, 60, 5]));
  });
  body = named(text, [80, 60, 20]);
}, 120_000);

const features = (of = body) =>
  moduleJob(ENTRY, "rockett.cam.features", {
    setup,
    bodies: [of].map(({ id, bbox, brep: text, faceNames }) => ({
      id,
      bbox,
      brep: text,
      faceNames,
    })),
  } satisfies FeaturesInput) as Promise<PlanFeatures>;

type Read = (doc: CadDocument, req: unknown, ctx: unknown) => Promise<unknown>;

async function featuresRead() {
  const reads = new Map<string, Read>();
  await cam.activate({
    services: { provide: () => () => {} },
    register: serverRegister((module) => {
      module.mount({
        projectRoute: (r, read) => reads.set(r.path, read as Read),
        userRoute: () => {},
        projectMutation: () => {},
      });
      return () => {};
    }),
    startKernelJob: (id: string, input: unknown) => moduleJob(ENTRY, id, input),
    userData: () => ({ read: async () => null, write: async () => null! }),
    files: undefined!,
    kernelVersion: null,
    signFaces: async () => [],
    bodies: async () => [body],
  });
  const data: CamData = {
    setups: [{ id: "s1", name: "Setup 1", ...setup }],
    tools: [],
  };
  return (setupId: string) =>
    reads.get(featuresRoute.path)!(
      {
        extensions: { [CAM_EXTENSION]: { version: 1, data } },
      } as unknown as CadDocument,
      { params: { id: "p1", setupId } },
      { user: mark },
    );
}

const near = (value: number, expected: number) =>
  expect(Math.abs(value - expected)).toBeLessThanOrEqual(0.01);

describe("rockett.cam.features", () => {
  it("finds the pocket, the through hole and the outside outline of a block", async () => {
    const found = await features();
    expect(found.stockTop).toBeCloseTo(0, 9);
    expect(found.modelTop).toBeCloseTo(-2, 6);
    expect(found.pockets).toHaveLength(1);
    const [pocket] = found.pockets;
    near(pocket!.width, 20);
    near(pocket!.cornerRadius, 3);
    expect(pocket!.z).toBeCloseTo(-10, 6);
    expect(pocket!.floor.bodyId).toBe("b1");
    expect(pocket!.floor.sig.point[2]).toBeCloseTo(12, 6);
    expect(pocket!.floor.sig.direction[2]).toBeCloseTo(1, 9);
    expect(found.holes).toHaveLength(1);
    expect(found.holes[0]!.diameter).toBeCloseTo(6, 6);
    expect(found.holes[0]!.blocked).toBe(false);
    expect(found.profiles).toHaveLength(1);
    expect(found.profiles[0]).toMatchObject({ side: "outside" });
    expect(found.profiles[0]!.z).toBeCloseTo(-22, 6);
  }, 120_000);

  it("returns the same features for the setup through the route", async () => {
    const read = await featuresRead();
    expect(await read("s1")).toEqual(await features());
    expect(await read("s9")).toEqual({
      reason: "setup s9 is not in this project",
    });
  }, 120_000);

  it("leaves out an undercut floor and an outline the body overhangs, and finds a through opening", async () => {
    const text = brep((own) => {
      const block = box(own, [0, 0, 0], [60, 40, 10]);
      const opened = cut(own, block, box(own, [5, 10, -1], [10, 20, 12]));
      const rebated = cut(own, opened, box(own, [50, -1, -1], [11, 42, 4]));
      const cavity = cut(own, rebated, box(own, [20, 5, 2], [20, 10, 4]));
      return cut(own, cavity, box(own, [28, 8, 5], [4, 4, 6]));
    });
    const found = await features(named(text, [60, 40, 10]));
    expect(found.pockets).toEqual([]);
    expect(found.holes).toEqual([]);
    expect(found.profiles).toHaveLength(1);
    const [opening] = found.profiles;
    expect(opening).toMatchObject({ side: "inside", cornerRadius: 0 });
    near((opening as { width: number }).width, 10);
    expect(opening!.z).toBeCloseTo(-12, 6);
  }, 120_000);
});
