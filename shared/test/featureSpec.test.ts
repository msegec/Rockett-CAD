import { describe, expect, it } from "vitest";
import {
  FEATURE_LABELS,
  FEATURE_SCHEMAS,
  featureRefs,
  featureSpec,
  featureSpecs,
  registerFeatureSpec,
  ValidationError,
  type EdgeRef,
  type FaceRef,
  type Feature,
  type FeatureRef,
  type ProfileRef,
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

const meta = { id: "f1", name: "F1", suppressed: false };
const refFace = (faceName: string): FaceRef => ({
  kind: "face",
  bodyId: "ref:body",
  faceName: `ref:${faceName}`,
});
const refEdge = (edgeName: string): EdgeRef => ({
  kind: "edge",
  bodyId: "ref:body",
  edgeName: `ref:${edgeName}`,
});
const refProfile = (profileId: string): ProfileRef => ({
  sketchId: "ref:sketch",
  profileId: `ref:${profileId}`,
});

interface SpecCase {
  producesGeometry: boolean;
  valid: Feature[];
  invalid: [Feature, string, string][];
  refsOnly?: Feature[];
}

const cases: Record<string, SpecCase> = {
  extrude: {
    producesGeometry: true,
    valid: [
      {
        ...meta,
        type: "extrude",
        profiles: [refProfile("p1"), refProfile("p2")],
        faces: [refFace("F1")],
        distance: 5,
        distance2: 2,
        startOffset: 1,
        direction: "twoSided",
        operation: "join",
        targets: ["ref:b1", "ref:b2"],
      },
    ],
    invalid: [
      [
        {
          ...meta,
          type: "extrude",
          profiles: [refProfile("p1")],
          distance: 0,
          direction: "normal",
          operation: "newBody",
        },
        "distance must be non-zero",
        "/distance",
      ],
    ],
  },
  revolve: {
    producesGeometry: true,
    valid: (
      [
        { kind: "originAxis", axis: "Z" },
        { kind: "sketchLine", sketchId: "ref:axisSketch", entityId: "ref:l1" },
        { kind: "edge", edge: refEdge("E1") },
      ] as const
    ).map((axis) => ({
      ...meta,
      type: "revolve",
      profiles: [refProfile("p1")],
      faces: [refFace("F1")],
      axis,
      angle: 90,
      operation: "cut",
      targets: ["ref:b1"],
    })),
    invalid: [
      [
        {
          ...meta,
          type: "revolve",
          profiles: [refProfile("p1")],
          axis: { kind: "originAxis", axis: "Z" },
          angle: 1e12,
          operation: "newBody",
        },
        "angle must be <= 360",
        "/angle",
      ],
    ],
  },
  emboss: {
    producesGeometry: true,
    valid: [
      {
        ...meta,
        type: "emboss",
        profiles: [refProfile("p1"), refProfile("p2")],
        depth: 1,
        mode: "deboss",
        targets: ["ref:b1"],
      },
    ],
    invalid: [
      [
        {
          ...meta,
          type: "emboss",
          profiles: [refProfile("p1")],
          depth: 0,
          mode: "emboss",
        },
        "depth must be >= 0.000001",
        "/depth",
      ],
    ],
  },
  sweep: {
    producesGeometry: true,
    valid: [
      {
        ...meta,
        type: "sweep",
        profiles: [refProfile("p1"), refProfile("p2")],
        pathSketchId: "ref:path",
        operation: "join",
        targets: ["ref:b1"],
      },
    ],
    invalid: [
      [
        {
          ...meta,
          type: "sweep",
          profiles: [refProfile("p1")],
          pathSketchId: null as never,
          operation: "newBody",
        },
        "pathSketchId must be string",
        "/pathSketchId",
      ],
    ],
  },
  loft: {
    producesGeometry: true,
    valid: [
      {
        ...meta,
        type: "loft",
        sections: [refProfile("p1"), refProfile("p2")],
        operation: "newBody",
        targets: ["ref:b1"],
      },
    ],
    invalid: [
      [
        {
          ...meta,
          type: "loft",
          sections: [refProfile("p1")],
          operation: "newBody",
        },
        "sections must not have fewer than 2 items",
        "/sections",
      ],
    ],
    refsOnly: [
      {
        ...meta,
        type: "loft",
        sections: [
          refProfile("p1"),
          { sketchId: "ref:whole" } as ProfileRef,
          refProfile("p3"),
        ],
        operation: "newBody",
        targets: ["ref:b1"],
      },
    ],
  },
  fillet: {
    producesGeometry: true,
    valid: [
      {
        ...meta,
        type: "fillet",
        tangentChain: true,
        edges: [refEdge("E1"), refEdge("E2")],
        radius: 1,
      },
    ],
    invalid: [
      [
        { ...meta, type: "fillet", edges: [refEdge("E1")], radius: 0 },
        "radius must be >= 0.000001",
        "/radius",
      ],
    ],
  },
  chamfer: {
    producesGeometry: true,
    valid: [
      {
        ...meta,
        type: "chamfer",
        tangentChain: false,
        edges: [refEdge("E1"), refEdge("E2")],
        distance: 1,
      },
    ],
    invalid: [
      [
        { ...meta, type: "chamfer", edges: [], distance: 1 },
        "edges must not have fewer than 1 items",
        "/edges",
      ],
    ],
  },
  offsetFace: {
    producesGeometry: true,
    valid: [
      {
        ...meta,
        type: "offsetFace",
        faces: [refFace("F1"), refFace("F2")],
        distance: -1,
      },
    ],
    invalid: [
      [
        { ...meta, type: "offsetFace", faces: [], distance: 1 },
        "faces must not have fewer than 1 items",
        "/faces",
      ],
    ],
  },
};

const valueAt = (f: Feature, path: string) =>
  path
    .split("/")
    .slice(1)
    .reduce<unknown>((v, key) => (v as Record<string, unknown>)[key], f);

const markedPaths = (v: unknown, at = ""): string[] =>
  typeof v === "string"
    ? v.startsWith("ref:")
      ? [at]
      : []
    : typeof v === "object" && v !== null
      ? Object.entries(v).flatMap(([key, child]) =>
          markedPaths(child, `${at}/${key}`),
        )
      : [];

const target = (ref: FeatureRef) =>
  (ref as unknown as Record<string, unknown>)[ref.kind];

describe.each(Object.entries(cases))("%s feature spec", (type, specCase) => {
  const spec = featureSpec(type)!;

  it("is registered with its schema and label", () => {
    expect(spec).toMatchObject({
      type,
      label: FEATURE_LABELS[type as Feature["type"]],
      producesGeometry: specCase.producesGeometry,
      version: 1,
      displayOnly: [],
    });
    expect(spec.paramsSchema).toBe(FEATURE_SCHEMAS[type as Feature["type"]]);
  });

  it("accepts valid features", () => {
    for (const f of specCase.valid)
      expect(() => spec.validate(f)).not.toThrow();
  });

  it("rejects invalid features with the message and path", () => {
    for (const [f, message, detail] of specCase.invalid) {
      expect(() => spec.validate(f)).toThrow(ValidationError);
      expect(() => spec.validate(f)).toThrow(
        expect.objectContaining({ message, detail }),
      );
    }
  });

  it("lists every reference with its param path", () => {
    for (const f of [...specCase.valid, ...(specCase.refsOnly ?? [])]) {
      const properties = Object.keys(FEATURE_SCHEMAS[f.type].properties);
      expect(properties.filter((key) => !(key in f))).toEqual([]);
      const refs = featureRefs(f);
      for (const ref of refs) expect(valueAt(f, ref.path)).toEqual(target(ref));
      const missed = markedPaths(f).filter(
        (path) =>
          !refs.some(
            (ref) => path === ref.path || path.startsWith(`${ref.path}/`),
          ),
      );
      expect(missed).toEqual([]);
    }
  });
});

it("lists a loft section without a profile id as its whole sketch", () => {
  const refs = featureRefs(cases.loft!.refsOnly![0]!);
  expect(refs.map((ref) => [ref.kind, ref.path])).toEqual([
    ["profile", "/sections/0"],
    ["sketch", "/sections/1/sketchId"],
    ["profile", "/sections/2"],
    ["body", "/targets/0"],
  ]);
});
