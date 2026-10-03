import { beforeAll, describe, expect, it } from "vitest";
import type { KernelJobScope } from "@rockett/plugin-api";
import { arcSweep, type Xy } from "../src/shared/ir.js";
import { stockBox, type Placement, type Setup } from "../src/shared/setup.js";
import type {
  Regions,
  RegionLoop,
  RegionsInput,
} from "../src/kernel/regions.js";

type OC = KernelJobScope["oc"];
type Own = KernelJobScope["own"];
type Shape = { delete(): void };

const ENTRY = new URL("../src/kernel/regions.ts", import.meta.url).href;
const SAME: Placement = { rotation: [0, 0, 0, 1], translation: [0, 0, 0] };
const core = (file: string) =>
  import(new URL(`../../../server/src/${file}`, import.meta.url).href);

let oc: OC;
let scoped: <T>(fn: (own: Own) => T) => T;
let kernel: {
  moduleJob(entry: string, id: string, input: unknown): Promise<unknown>;
};

beforeAll(async () => {
  const [geometry, client] = await Promise.all([
    core("geometry/kernel.ts"),
    core("kernel/client.ts"),
  ]);
  kernel = await client.InProcessKernel.start({
    sources: async () => new Map(),
  });
  oc = geometry.getKernel();
  scoped = geometry.scoped;
}, 120_000);

function brep(make: (own: Own) => Shape): string {
  const file = `/rockett-cam-regions-${crypto.randomUUID()}.brep`;
  try {
    scoped((own) =>
      oc.BRepTools.Write_3(
        make(own),
        file,
        own(new oc.Message_ProgressRange_1()),
      ),
    );
    return oc.FS.readFile(file, { encoding: "utf8" });
  } finally {
    if (oc.FS.analyzePath(file).exists) oc.FS.unlink(file);
  }
}

function cut(own: Own, body: Shape, tool: Shape): Shape {
  const op = own(
    new oc.BRepAlgoAPI_Cut_3(body, tool, own(new oc.Message_ProgressRange_1())),
  );
  return own(op.Shape());
}

function box(own: Own, at: [number, number, number], size: number[]) {
  const corner = own(new oc.gp_Pnt_3(...at));
  return own(
    own(
      new oc.BRepPrimAPI_MakeBox_3(corner, size[0], size[1], size[2]),
    ).Shape(),
  );
}

function cylinder(own: Own, at: number[], axis: number[], r: number) {
  const frame = own(
    new oc.gp_Ax2_4(
      own(new oc.gp_Pnt_3(at[0], at[1], at[2])),
      own(new oc.gp_Dir_5(axis[0], axis[1], axis[2])),
    ),
  );
  return own(own(new oc.BRepPrimAPI_MakeCylinder_3(frame, r, 20)).Shape());
}

function turned(own: Own, shape: Shape): Shape {
  const trsf = own(new oc.gp_Trsf_1());
  trsf.SetRotation_2(
    own(new oc.gp_Quaternion_2(-Math.SQRT1_2, 0, 0, Math.SQRT1_2)),
  );
  return own(
    own(new oc.BRepBuilderAPI_Transform_2(shape, trsf, true, false)).Shape(),
  );
}

const pocketBlock = (own: Own) =>
  cut(
    own,
    box(own, [0, 0, 0], [60, 40, 10]),
    box(own, [20, 15, 5], [20, 10, 5]),
  );

const holeBlock = (own: Own) =>
  cut(
    own,
    box(own, [0, 0, 0], [60, 40, 10]),
    cylinder(own, [30, 20, 5], [0, 0, 1], 4),
  );

function regions(input: RegionsInput) {
  return kernel.moduleJob(
    ENTRY,
    "rockett.cam.regions",
    input,
  ) as Promise<Regions>;
}

function area({ start, segments }: RegionLoop): number {
  let from: Xy = start;
  let twice = 0;
  for (const segment of segments) {
    const [x, y] = segment.to;
    if (segment.kind === "line") twice += from[0] * y - x * from[1];
    else {
      const [cx, cy] = segment.centre;
      const sweep = arcSweep([...from, 0], {
        kind: "arc",
        to: [x, y, 0],
        centre: [cx, cy, 0],
        dir: segment.dir,
        plane: "xy",
        feed: 1,
        role: "cut",
      });
      const r = Math.hypot(from[0] - cx, from[1] - cy);
      twice +=
        cx * (y - from[1]) -
        cy * (x - from[0]) +
        r * r * (segment.dir === "ccw" ? sweep : -sweep);
    }
    from = segment.to;
  }
  return Math.abs(twice) / 2;
}

function expectAreas(loops: RegionLoop[], wanted: number[]) {
  expect(loops).toHaveLength(wanted.length);
  expect(loops.map(area)).toEqual(
    expect.arrayContaining(wanted.map((value) => expect.closeTo(value, 9))),
  );
}

describe("rockett.cam.regions", () => {
  it("a 60 by 40 by 10 block with a 20 by 10 by 5 pocket gives floors 10 and 5 and one loop of area 200", async () => {
    const found = await regions({
      brep: brep(pocketBlock),
      modelToSetup: SAME,
      z: [7.5],
    });
    expect(found.floors).toEqual([10, 5]);
    expect(found.sections.map(({ z }) => z)).toEqual([7.5]);
    const loops = found.sections[0]!.loops;
    expect(
      loops.filter((loop) => Math.abs(area(loop) - 200) < 1e-9),
    ).toHaveLength(1);
    expectAreas(loops, [200, 2400]);
    for (const loop of loops) {
      expect(loop.segments.every(({ kind }) => kind === "line")).toBe(true);
      expect(loop.segments.at(-1)!.to).toEqual(loop.start);
    }
  });

  it("keeps a round pocket wall as arcs about its axis", async () => {
    const found = await regions({
      brep: brep(holeBlock),
      modelToSetup: SAME,
      z: [7.5, 2],
    });
    expect(found.floors).toEqual([10, 5]);
    const [upper, lower] = found.sections;
    expectAreas(upper!.loops, [16 * Math.PI, 2400]);
    const hole = upper!.loops.find((loop) => area(loop) < 100)!;
    for (const segment of hole.segments) {
      expect(segment.kind).toBe("arc");
      if (segment.kind !== "arc") continue;
      expect(segment.centre[0]).toBeCloseTo(30, 9);
      expect(segment.centre[1]).toBeCloseTo(20, 9);
      expect(Math.hypot(segment.to[0] - 30, segment.to[1] - 20)).toBeCloseTo(
        4,
        9,
      );
    }
    expectAreas(lower!.loops, [2400]);
  });

  it("reads floors and loops in the setup frame, not the model frame", async () => {
    const setup: Setup = {
      id: "s1",
      name: "Setup 1",
      bodies: ["b1"],
      stock: {
        kind: "boxAround",
        margins: { xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 0 },
      },
      wcs: {
        origin: { kind: "stockCorner", x: "min", y: "min", z: "min" },
        axes: { x: "+x", z: "+y" },
        offsetIndex: 1,
        machine: { kind: "unknown" },
      },
      safeHeight: 15,
      clearance: 3,
      tolerance: 0.01,
      fixtures: [],
    };
    const { modelToSetup } = stockBox(setup, {
      b1: { min: [0, 0, -40], max: [60, 10, 0] },
    });
    const found = await regions({
      brep: brep((own) => turned(own, pocketBlock(own))),
      modelToSetup,
      z: [7.5],
    });
    expect(found.floors).toEqual([expect.closeTo(10, 9), expect.closeTo(5, 9)]);
    const pocket = found.sections[0]!.loops.find((loop) => area(loop) < 1000)!;
    expect(area(pocket)).toBeCloseTo(200, 9);
    const xs = pocket.segments.map(({ to }) => to[0]);
    const ys = pocket.segments.map(({ to }) => to[1]);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([
      expect.closeTo(20, 9),
      expect.closeTo(40, 9),
    ]);
    expect([Math.min(...ys), Math.max(...ys)]).toEqual([
      expect.closeTo(15, 9),
      expect.closeTo(25, 9),
    ]);
  });

  it("refuses a section edge that is neither a line nor an arc, never approximating it", async () => {
    const tilted = brep((own) =>
      cut(
        own,
        box(own, [0, 0, 0], [60, 40, 10]),
        cylinder(own, [30, 20, -2], [1, 0, 1], 4),
      ),
    );
    await expect(
      regions({ brep: tilted, modelToSetup: SAME, z: [5] }),
    ).rejects.toThrow(
      "section at Z 5 has an edge of type Ellipse, not a line or arc",
    );
  });

  it("refuses input that is not a BREP body", async () => {
    await expect(
      regions({ brep: "not a shape", modelToSetup: SAME, z: [5] }),
    ).rejects.toThrow("regions input is not a readable BREP body");
  });
});
