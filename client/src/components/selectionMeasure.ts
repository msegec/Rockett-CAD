import {
  formatAngle,
  formatLength,
  MEASURE_MAX_REFS,
  UNIT_TO_MM,
  type BodyPayload,
  type CadDocument,
  type MeasureRequest,
  type MeasureResult,
  type SketchEntity,
  type Units,
} from "@rockett/shared";
import { useEffect, useState } from "react";
import { api } from "../api";
import { measurable } from "../commands/measure";
import { previewBodies } from "../previewBase";
import { useSetting } from "../settings";
import { dimensionFor, measureDimension, type DimTarget } from "../sketchTools";
import { useStore, type Selection } from "../store";
import { meshOf, useMeshVersion } from "../three/meshes";
import { TIMING_MS } from "../tunables";

interface Scene {
  bodies: BodyPayload[];
  sketch: (sketchId: string) => SketchEntity[] | undefined;
}

interface Pair {
  distance?: number | undefined;
  angleDeg?: number | undefined;
}

type Outcome = { result: MeasureResult } | { error: string };

interface SketchPick {
  sketchId: string;
  entities: SketchEntity[];
  target: DimTarget;
}

function sketchPick(pick: Selection, scene: Scene): SketchPick | undefined {
  if (pick.kind !== "sketchEntity" && pick.kind !== "sketchPoint") return;
  const entities = scene.sketch(pick.sketchId);
  const kind = entities?.find((e) => e.id === pick.entityId)?.kind;
  if (!entities || (kind !== "point" && kind !== "line")) return;
  return {
    sketchId: pick.sketchId,
    entities,
    target: { kind, id: pick.entityId },
  };
}

function lengthOf(pick: Selection, scene: Scene): number | undefined {
  if (pick.kind === "edge") {
    const body = scene.bodies.find((b) => b.bodyId === pick.bodyId);
    return (body && meshOf(body))?.edges.find((e) => e.name === pick.edgeName)
      ?.length;
  }
  const sketch = sketchPick(pick, scene);
  if (sketch?.target.kind !== "line") return;
  return measureDimension(
    { id: "", type: "length", line: sketch.target.id, value: 0 },
    sketch.entities,
  );
}

function sizeOf(selection: Selection[], scene: Scene): number[] | undefined {
  const boxes = selection.flatMap((pick) =>
    pick.kind === "body"
      ? scene.bodies.filter((b) => b.bodyId === pick.bodyId).map((b) => b.bbox)
      : [],
  );
  if (boxes.length === 0) return;
  return [0, 1, 2].map(
    (i) =>
      Math.max(...boxes.map((b) => b.max[i]!)) -
      Math.min(...boxes.map((b) => b.min[i]!)),
  );
}

function sketchPair(selection: Selection[], scene: Scene): Pair | undefined {
  const [a, b] = selection.map((pick) => sketchPick(pick, scene));
  if (!a || !b || a.sketchId !== b.sketchId) return;
  const dimension = dimensionFor([a.target, b.target], a.entities);
  if (!dimension || !("value" in dimension)) return;
  if (dimension.type === "angle")
    return { angleDeg: Math.min(dimension.value, 180 - dimension.value) };
  if (dimension.type === "lineDistance")
    return { distance: dimension.value, angleDeg: 0 };
  return { distance: dimension.value };
}

type ExactRef = MeasureRequest["refs"][number];

const exact = (pick: Selection): pick is ExactRef =>
  measurable(pick) || pick.kind === "body";

function exactRefs(selection: Selection[]): ExactRef[] | null {
  const refs = selection.filter(exact);
  if (selection.length === 2 && refs.length === 2) return refs;
  const summed = refs.filter((r) => r.kind === "face" || r.kind === "body");
  return summed.length > 0 ? summed : null;
}

function formatPower(mm: number, units: Units, power: 2 | 3): string {
  return `${formatLength(mm / UNIT_TO_MM[units] ** (power - 1), units)}${power === 2 ? "²" : "³"}`;
}

function total(
  label: string,
  values: number[],
  format: (value: number) => string,
): string[] {
  if (values.length === 0) return [];
  const sum = values.reduce((a, v) => a + v, 0);
  return [
    `${values.length > 1 ? `Total ${label.toLowerCase()}` : label} ${format(sum)}`,
  ];
}

function exactLines(
  result: MeasureResult,
  pair: boolean,
  units: Units,
): string[] {
  const values = (key: "area" | "volume") =>
    result.items.flatMap((item) => item[key] ?? []);
  return [
    ...total("Area", values("area"), (v) => formatPower(v, units, 2)),
    ...total("Volume", values("volume"), (v) => formatPower(v, units, 3)),
    ...(pair ? pairLines(result, units) : []),
  ];
}

function pairLines(pair: Pair, units: Units): string[] {
  return [
    ...(pair.distance === undefined
      ? []
      : [`Distance ${formatLength(pair.distance, units)}`]),
    ...(pair.angleDeg === undefined
      ? []
      : [`Angle ${formatAngle(pair.angleDeg, 4)}`]),
  ];
}

function useExactMeasure(
  projectId: string | null,
  refs: ExactRef[] | null,
  document: CadDocument | null,
  bodies: BodyPayload[],
): Outcome | "pending" | null {
  const [reply, setReply] = useState<{
    key: string;
    projectId: string;
    document: CadDocument | null;
    bodies: BodyPayload[];
    outcome: Outcome;
  } | null>(null);
  const key = projectId && refs ? JSON.stringify(refs) : null;
  const held =
    reply?.key === key &&
    reply.projectId === projectId &&
    reply.document === document &&
    reply.bodies === bodies
      ? reply.outcome
      : null;
  useEffect(() => {
    if (!projectId || !refs || !key || held) return;
    let live = true;
    const land = (outcome: Outcome) => {
      if (live) setReply({ key, projectId, document, bodies, outcome });
    };
    const timer = setTimeout(() => {
      api.measure(projectId, refs).then(
        (result) => land({ result }),
        (error) => land({ error: (error as Error).message }),
      );
    }, TIMING_MS.selectionSettle);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key, projectId, document, bodies]);
  return key ? (held ?? "pending") : null;
}

export function useSelectionMeasures(): string[] {
  const units = useSetting("units.length");
  const selection = useStore((s) => s.selection);
  const projectId = useStore((s) => s.projectId);
  const document = useStore((s) => s.document);
  const evaluation = useStore((s) => s.evaluation);
  const active = useStore((s) => s.active);
  const draft = useStore((s) => s.draftSketch);
  useMeshVersion();
  const bodies = previewBodies({ active, evaluation });
  const scene: Scene = {
    bodies,
    sketch: (id) =>
      draft?.id === id
        ? draft.entities
        : evaluation?.sketches.find((s) => s.featureId === id)?.entities,
  };
  const wanted =
    bodies === evaluation?.bodies && active?.id !== "inspect.measure"
      ? exactRefs(selection)
      : null;
  const over = (wanted?.length ?? 0) > MEASURE_MAX_REFS;
  const refs = over ? null : wanted;
  const measured = useExactMeasure(projectId, refs, document, bodies);

  const lines = total(
    "Length",
    selection.flatMap((pick) => lengthOf(pick, scene) ?? []),
    (v) => formatLength(v, units),
  );
  const size = sizeOf(selection, scene);
  if (size)
    lines.push(
      `Size ${size.map((v, i) => `${"XYZ"[i]} ${formatLength(v, units)}`).join(", ")}`,
    );
  if (over) lines.push(`Area and volume take up to ${MEASURE_MAX_REFS} picks`);
  else if (measured === "pending") lines.push("Measuring");
  else if (measured && "error" in measured)
    lines.push(`Measure failed: ${measured.error}`);
  else if (measured)
    lines.push(
      ...exactLines(
        measured.result,
        selection.length === 2 && refs?.length === 2,
        units,
      ),
    );
  else if (selection.length === 2) {
    const pair = sketchPair(selection, scene);
    if (pair) lines.push(...pairLines(pair, units));
  }
  return lines;
}
