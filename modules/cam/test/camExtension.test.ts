import { describe, expect, it } from "vitest";
import { CAM_VERSION, isCamData, migrateCam } from "../src/shared/document.js";

const data = {
  setups: [{ id: "s1", name: "Setup 1" }],
  tools: [{ id: "t1", diameter: 6 }],
};

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
});

describe("CAM migration hook", () => {
  it("reads a project saved before CAM as empty v1 data", () => {
    expect(CAM_VERSION).toBe(1);
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

  it("keeps newer data unchanged and read only", () => {
    const stored = { version: 2, data: { future: true } };
    expect(migrateCam(stored)).toEqual({
      status: "kept",
      reason: "CAM data version 2 is newer than this module reads (1)",
    });
    expect(stored).toEqual({ version: 2, data: { future: true } });
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
