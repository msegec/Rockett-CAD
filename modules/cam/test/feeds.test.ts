import { describe, expect, it } from "vitest";
import data from "../src/feeds/materials.json";
import { suggestFeeds, type Suggestion } from "../src/feeds/suggest.js";
import { CAM_VERSION, migrateCam } from "../src/shared/document.js";
import {
  availableWatts,
  newMachine,
  type MachineProfile,
} from "../src/shared/machine.js";
import type { Tool } from "../src/shared/tools.js";

const quarter: Tool = {
  id: "t1",
  name: "1/4 O flute",
  kind: "flat",
  diameter: 6.35,
  fluteLength: 19,
  overallLength: 50,
  shankDiameter: 6.35,
  flutes: 1,
  centreCutting: true,
};

const router: MachineProfile = { ...newMachine(0), id: "m1" };

const spindle300: MachineProfile = {
  ...router,
  ratedWatts: 300,
  ratedRpm: 12000,
};

const unbounded: MachineProfile = {
  ...router,
  maxFeedX: 1e9,
  maxFeedY: 1e9,
  maxFeedZ: 1e9,
};

const kinds = (result: Suggestion) => result.limits.map(({ limit }) => limit);

const chipload = (result: Suggestion, tool: Tool) =>
  result.cutFeed / (result.rpm * tool.flutes);

describe("suggestFeeds", () => {
  it("keeps a 300 W spindle roughing aluminium within 80% of its power", () => {
    const result = suggestFeeds(quarter, "aluminium6061", spindle300);
    const watts = availableWatts(spindle300, result.rpm)!;
    const cutting =
      (data.materials.aluminium6061.unitPower *
        result.stepdown *
        result.stepoverFraction *
        quarter.diameter *
        result.cutFeed) /
      60;
    expect(cutting).toBeLessThanOrEqual(0.8 * watts + 1e-9);
    expect(cutting).toBeCloseTo(0.8 * watts, 6);
    expect(result.stepdown).toBeLessThan(quarter.diameter);
    expect(result.stepoverFraction).toBe(1);
    expect(result.rpm).toBeCloseTo((182.88 * 1000) / (Math.PI * 6.35), 6);
    expect(chipload(result, quarter)).toBeCloseTo(0.0762, 9);
    const power = result.limits.find(({ limit }) => limit === "power");
    expect(power?.reason).toMatch(/80% of the \d+ W/);
  });

  it("narrows the stepover once the stepdown reaches its floor", () => {
    const weak = { ...spindle300, ratedWatts: 20 };
    const result = suggestFeeds(quarter, "aluminium6061", weak);
    expect(result.stepdown).toBeCloseTo(0.1 * quarter.diameter, 9);
    expect(result.stepoverFraction).toBeLessThan(1);
    expect(kinds(result)).toContain("power");
  });

  it("lowers rpm under a feed cap to keep the chipload", () => {
    const tool = { ...quarter, flutes: 2 };
    const result = suggestFeeds(tool, "softwood", router);
    expect(result.cutFeed).toBe(3000);
    expect(chipload(result, tool)).toBeCloseTo(0.127, 9);
    expect(result.rpm).toBeCloseTo(3000 / (2 * 0.127), 6);
    expect(kinds(result)).toEqual(["feedCap", "plungeCap", "powerUnchecked"]);
  });

  it("stops lowering rpm at the measured minimum", () => {
    const tool = { ...quarter, flutes: 2 };
    const slow = { ...router, rpmMin: 5000, measuredRpmMin: 15000 };
    const result = suggestFeeds(tool, "softwood", slow);
    expect(result.rpm).toBe(15000);
    expect(result.cutFeed).toBe(3000);
    expect(chipload(result, tool)).toBeLessThan(0.127);
    expect(kinds(result)).toContain("rpmFloor");
  });

  it("names the spindle maximum when the cutting speed asks for more", () => {
    const small = { ...quarter, diameter: 1.5875 };
    const result = suggestFeeds(small, "aluminium6061", router);
    expect(result.rpm).toBe(24000);
    const limit = result.limits.find((entry) => entry.limit === "rpmMax");
    expect(limit?.reason).toMatch(/24000 rpm/);
  });

  it("caps the plunge at the Z maximum feed", () => {
    const tool = { ...quarter, flutes: 2 };
    const result = suggestFeeds(tool, "mdf", { ...router, maxFeedZ: 200 });
    expect(result.plungeFeed).toBe(200);
    expect(kinds(result)).toContain("plungeCap");
  });

  it("lets a preset value win", () => {
    const result = suggestFeeds(quarter, "aluminium6061", spindle300, {
      rpm: 12000,
      stepdown: 2,
    });
    const plain = suggestFeeds(quarter, "aluminium6061", spindle300);
    expect(result.rpm).toBe(12000);
    expect(result.stepdown).toBe(2);
    expect(result.cutFeed).toBe(plain.cutFeed);
    expect(result.limits.at(-1)).toEqual({
      limit: "preset",
      reason: "the preset sets rpm, stepdown",
    });
  });

  it("refuses a tool without whole flutes or a real diameter", () => {
    for (const flutes of [0, 1.5, -2, Number.NaN])
      expect(() => suggestFeeds({ ...quarter, flutes }, "mdf", router)).toThrow(
        /flutes must be a whole number of at least 1/,
      );
    for (const diameter of [0, -6, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() =>
        suggestFeeds({ ...quarter, diameter }, "mdf", router),
      ).toThrow(/diameter must be above 0 and finite/);
  });

  it("refuses what the charts do not cover", () => {
    expect(() => suggestFeeds(quarter, "oak", router)).toThrow(
      /no feeds for material oak/,
    );
    expect(() =>
      suggestFeeds({ ...quarter, diameter: 1 }, "aluminium6061", router),
    ).toThrow(/smaller than the 1.5875 mm/);
    expect(() =>
      suggestFeeds({ ...quarter, kind: "ball" }, "mdf", router),
    ).toThrow(/flat end mill/);
  });

  it("gives a 7/32 inch bit in wood the 7/32 inch chip load", () => {
    const tool = { ...quarter, diameter: (7 / 32) * 25.4, flutes: 2 };
    const result = suggestFeeds(tool, "softwood", unbounded);
    expect(chipload(result, tool)).toBeCloseTo(0.07112, 9);
  });

  it("puts every inch band edge in its own band", () => {
    const charts: Record<string, { from: number; chipload: number }[]> =
      data.charts;
    for (const [key, material] of Object.entries(data.materials))
      for (const band of charts[material.chart]!) {
        const sixtyfourths = Math.round((band.from / 25.4) * 64);
        if (Math.abs(sixtyfourths - (band.from / 25.4) * 64) > 1e-9) continue;
        const tool = { ...quarter, diameter: (sixtyfourths / 64) * 25.4 };
        const result = suggestFeeds(tool, key, unbounded);
        expect(chipload(result, tool), `${key} ${sixtyfourths}/64`).toBeCloseTo(
          band.chipload,
          9,
        );
        expect(kinds(result)).not.toContain("outsideChart");
      }
  });

  it("names a tool above the last band as outside the chart", () => {
    const tool = { ...quarter, diameter: (3 / 4) * 25.4, flutes: 2 };
    const result = suggestFeeds(tool, "mdf", unbounded);
    expect(chipload(result, tool)).toBeCloseTo(0.3048, 9);
    const outside = result.limits.find(({ limit }) => limit === "outsideChart");
    expect(outside?.reason).toMatch(
      /above the 15.875 mm the MDF chart ends at/,
    );
  });
});

describe("materials.json", () => {
  it("ships the six materials, each on a chart in diameter order", () => {
    expect(Object.keys(data.materials)).toEqual([
      "aluminium6061",
      "softwood",
      "hardwood",
      "mdf",
      "plywood",
      "acrylic",
    ]);
    const charts: Record<string, { from: number; chipload: number }[]> =
      data.charts;
    for (const material of Object.values(data.materials)) {
      const bands = charts[material.chart]!;
      expect(bands.length).toBeGreaterThan(0);
      bands.forEach((band, i) => {
        expect(band.chipload).toBeGreaterThan(0);
        if (i) expect(band.from).toBeGreaterThan(bands[i - 1]!.from);
      });
    }
  });
});

const saved = (setup: Record<string, unknown>) =>
  migrateCam({ version: CAM_VERSION, data: { setups: [setup], tools: [] } });

describe("setup material", () => {
  it("loads a setup saved without a material unchanged", () => {
    const setup = { id: "s1", name: "Setup 1", safeHeight: 15 };
    expect(saved(setup)).toEqual({
      status: "ready",
      data: { setups: [setup], tools: [] },
    });
  });

  it("reads a setup that names its stock material", () => {
    expect(saved({ id: "s1", material: "aluminium6061" }).status).toBe("ready");
    expect(saved({ id: "s1", material: "" }).status).toBe("kept");
  });
});
