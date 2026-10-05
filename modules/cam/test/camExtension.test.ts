import { describe, expect, it } from "vitest";
import { CAM_VERSION, isCamData, migrateCam } from "../src/shared/document.js";

const data = {
  setups: [{ id: "s1", name: "Setup 1" }],
  tools: [{ id: "t1", diameter: 6 }],
};

const presetTool = (extra: object = {}) => ({
  id: "t1",
  presets: [
    {
      id: "p1",
      name: "Finish",
      rpm: 18000,
      cutFeed: 1000,
      plungeFeed: 300,
      rampFeed: 500,
      stepdown: 1,
      stepoverFraction: 0.4,
      coolant: "off",
      ...extra,
    },
  ],
});

describe("CAM data validator", () => {
  it("accepts empty and filled v1 data", () => {
    expect(isCamData({ setups: [], tools: [] })).toBe(true);
    expect(isCamData(data)).toBe(true);
  });

  it.each([
    ["missing tools", { setups: [] }],
    ["an extra field", { setups: [], tools: [], notes: "x" }],
    ["a setup without an id", { setups: [{ name: "Setup 1" }], tools: [] }],
    ["an empty tool id", { setups: [], tools: [{ id: "" }] }],
    ["setups as an object", { setups: {}, tools: [] }],
    ["null", null],
  ])("refuses %s", (_name, value) => {
    expect(isCamData(value)).toBe(false);
  });

  it("bounds a preset's acceleration profile to the integers 1 to 5", () => {
    const withProfile = (profile: unknown) => ({
      setups: [],
      tools: [presetTool({ profile })],
    });
    for (const profile of [1, 3, 5])
      expect(isCamData(withProfile(profile))).toBe(true);
    for (const profile of [0, 6, 2.5, "4"])
      expect(isCamData(withProfile(profile))).toBe(false);
  });
});

describe("CAM migration hook", () => {
  it("reads a project saved before CAM as empty data", () => {
    expect(CAM_VERSION).toBe(3);
    expect(migrateCam(undefined)).toEqual({
      status: "ready",
      data: { setups: [], tools: [] },
    });
  });

  it("returns a fresh empty value each time", () => {
    const first = migrateCam(undefined);
    if (first.status === "ready") first.data.setups.push({ id: "s1" });
    expect(migrateCam(undefined)).toEqual({
      status: "ready",
      data: { setups: [], tools: [] },
    });
  });

  it("reads valid v1 data as stored", () => {
    expect(migrateCam({ version: 1, data })).toEqual({ status: "ready", data });
  });

  it("reads a v1 preset saved before profile unchanged, with no profile filled", () => {
    const before = { version: 1, data: { setups: [], tools: [presetTool()] } };
    const stored = structuredClone(before);
    expect(migrateCam(stored)).toEqual({ status: "ready", data: before.data });
    expect(stored).toEqual(before);
  });

  it("keeps newer data unchanged and read only", () => {
    const stored = { version: 4, data: { future: true } };
    expect(migrateCam(stored)).toEqual({
      status: "kept",
      reason: "CAM data version 4 is newer than this module reads (3)",
    });
    expect(stored).toEqual({ version: 4, data: { future: true } });
  });

  it.each([
    [{ version: 1, data: { setups: [] } }],
    [{ version: 0, data: { setups: [], tools: [] } }],
  ])("keeps invalid data read only: %j", (stored) => {
    expect(migrateCam(stored)).toEqual({
      status: "kept",
      reason: `CAM data version ${stored.version} is not valid`,
    });
  });
});
