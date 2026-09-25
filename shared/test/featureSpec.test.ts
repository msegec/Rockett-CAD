import { describe, expect, it } from "vitest";
import {
  FEATURE_SCHEMAS,
  featureRefs,
  featureSpec,
  featureSpecs,
  registerFeatureSpec,
  ValidationError,
  type FaceRef,
  type ShellFeature,
} from "../src/index.js";

const face = (faceName: string): FaceRef => ({
  kind: "face",
  bodyId: "body-1",
  faceName,
});

const shell: ShellFeature = {
  id: "f1",
  type: "shell",
  name: "Shell1",
  suppressed: false,
  openFaces: [face("F1"), face("F2")],
  thickness: 1,
};

describe("shell feature spec", () => {
  it("is registered with the shell schema", () => {
    const spec = featureSpec("shell");
    expect(spec).toMatchObject({
      type: "shell",
      label: "Shell",
      producesGeometry: true,
      version: 1,
      displayOnly: [],
    });
    expect(spec?.paramsSchema).toBe(FEATURE_SCHEMAS.shell);
  });

  it("accepts a valid shell", () => {
    expect(() => featureSpec("shell")?.validate(shell)).not.toThrow();
    expect(() =>
      featureSpec("shell")?.validate({ ...shell, openFaces: [] }),
    ).not.toThrow();
  });

  it("rejects an invalid shell with the path", () => {
    const bad = { ...shell, thickness: 0 };
    const thrown = (() => {
      try {
        featureSpec("shell")?.validate(bad);
      } catch (e) {
        return e;
      }
    })();
    expect(thrown).toBeInstanceOf(ValidationError);
    expect(thrown).toMatchObject({ detail: "/thickness" });
    expect(() =>
      featureSpec("shell")?.validate({ ...shell, openFaces: [null] } as never),
    ).toThrow(/^openFaces\.0 /);
  });

  it("lists every open face with its param path", () => {
    expect(featureRefs(shell)).toEqual([
      { kind: "face", path: "/openFaces/0", face: face("F1") },
      { kind: "face", path: "/openFaces/1", face: face("F2") },
    ]);
    expect(featureRefs({ ...shell, openFaces: [] })).toEqual([]);
  });
});

describe("feature spec registry", () => {
  const spec = featureSpec("shell")!;

  it("throws on a duplicate id and stays unchanged", () => {
    const before = featureSpecs.snapshot();
    expect(() => registerFeatureSpec({ ...spec })).toThrow(
      "feature spec registry already has shell",
    );
    expect(featureSpecs.snapshot()).toBe(before);
    expect(featureSpec("shell")).toBe(spec);
  });

  it("disposes exactly the registration that returned the disposer", () => {
    const calls: number[] = [];
    const unsubscribe = featureSpecs.subscribe(() => calls.push(1));
    const before = featureSpecs.snapshot();
    const first = { ...spec, type: "test.block" };
    const dispose = registerFeatureSpec(first);
    expect(featureSpec("test.block")).toBe(first);
    expect(featureSpecs.list().at(-1)).toBe(first);
    expect(featureSpecs.snapshot()).not.toBe(before);
    dispose();
    expect(featureSpec("test.block")).toBeUndefined();
    expect(featureSpecs.list()).toEqual(before);
    const second = { ...spec, type: "test.block" };
    const disposeSecond = registerFeatureSpec(second);
    const stable = featureSpecs.snapshot();
    dispose();
    expect(featureSpec("test.block")).toBe(second);
    expect(featureSpecs.snapshot()).toBe(stable);
    disposeSecond();
    const again = registerFeatureSpec(first);
    dispose();
    expect(featureSpec("test.block")).toBe(first);
    again();
    unsubscribe();
    registerFeatureSpec(first)();
    expect(calls).toHaveLength(6);
  });
});
