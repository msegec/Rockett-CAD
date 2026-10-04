import {
  newId,
  normalizeDegrees,
  type ParameterBinding,
  type SketchConstraint,
  type SketchEntity,
  type SketchFeature,
  type SketchPoint,
} from "./model.js";
import { ValidationError } from "./schema/index.js";
import { curveSamples, entityPointIds, sketchCurves } from "./sketchCurves.js";
import type { SketchModification } from "./sketchModify.js";

type XY = { x: number; y: number };

const REF_KEYS = ["a", "b", "point", "line", "circle", "entity"] as const;

export const constraintEntityRefs = (c: SketchConstraint): string[] =>
  REF_KEYS.map((k) => (c as unknown as Record<string, unknown>)[k]).filter(
    (x): x is string => typeof x === "string",
  );

function renamedConstraint(
  c: SketchConstraint,
  ids: ReadonlyMap<string, string>,
): SketchConstraint {
  const out: Record<string, unknown> = { ...c, id: newId("c") };
  for (const key of REF_KEYS) {
    const ref = out[key];
    if (typeof ref === "string") out[key] = ids.get(ref) ?? ref;
  }
  return out as unknown as SketchConstraint;
}

export interface SketchMove {
  dx: number;
  dy: number;
  angle: number;
  pivot: XY | null;
  copy: boolean;
  bound: readonly string[];
}

const BOUND_VALUE = /^\/constraints\/(0|[1-9][0-9]*)\/value$/;

export const boundConstraintIds = (
  bindings: readonly ParameterBinding[],
  sketch: SketchFeature,
): string[] =>
  bindings.flatMap((b) => {
    const at = b.featureId === sketch.id && BOUND_VALUE.exec(b.path);
    const id = at ? sketch.constraints[Number(at[1])]?.id : undefined;
    return id ? [id] : [];
  });

export class FixedEntityError extends ValidationError {
  constructor(
    readonly entityId: string,
    readonly reason: "fixed" | "reference",
  ) {
    super(
      reason === "fixed"
        ? "Fixed geometry cannot move. Remove its Fix, or use Copy."
        : "Projected and offset geometry cannot move. Use Copy.",
    );
  }
}

function boxCentre(group: SketchEntity[]): XY {
  const coords = sketchCurves(group, true).flatMap((c) => curveSamples(c));
  for (const e of group) if (e.kind === "point") coords.push(e.x, e.y);
  const mid = (odd: number) => {
    const v = coords.filter((_, i) => i % 2 === odd);
    const low = v.reduce((a, b) => Math.min(a, b), Infinity);
    return (low + v.reduce((a, b) => Math.max(a, b), -Infinity)) / 2;
  };
  return { x: mid(0), y: mid(1) };
}

function refuseFixed(
  selected: SketchEntity[],
  entities: SketchEntity[],
  constraints: SketchConstraint[],
) {
  const fixed = new Set(
    constraints.flatMap((c) => (c.type === "fix" ? [c.point] : [])),
  );
  const external = new Set(
    entities.flatMap((e) => (e.kind === "point" && e.external ? [e.id] : [])),
  );
  for (const e of selected) {
    const own = [e.id, ...entityPointIds(e)];
    if (own.some((id) => fixed.has(id)))
      throw new FixedEntityError(e.id, "fixed");
    if (e.external || own.some((id) => external.has(id)))
      throw new FixedEntityError(e.id, "reference");
  }
}

const valueOf = (c: SketchConstraint) => ("value" in c ? c.value : undefined);

function turned(
  c: SketchConstraint,
  angle: number,
  direction: (line: string) => number,
): SketchConstraint | null {
  if (normalizeDegrees(angle) === 0) return c;
  const quarter = Math.round(angle / 90);
  const square = Math.abs(angle - quarter * 90) < 1e-9;
  const odd = square && quarter % 2 !== 0;
  if (c.type === "horizontal" || c.type === "vertical") {
    if (!square)
      return {
        id: c.id,
        type: "lineAngle",
        line: c.line,
        value: direction(c.line),
      };
    if (!odd) return c;
    return { ...c, type: c.type === "horizontal" ? "vertical" : "horizontal" };
  }
  if (c.type === "lineAngle")
    return { ...c, value: normalizeDegrees(c.value + angle) };
  if (c.type !== "distance" || !c.axis) return c;
  if (!square) return null;
  return odd ? { ...c, axis: c.axis === "x" ? "y" : "x" } : c;
}

function renamed(
  e: SketchEntity,
  ids: ReadonlyMap<string, string>,
): SketchEntity {
  const to = (id: string) => ids.get(id) ?? id;
  switch (e.kind) {
    case "point":
      return e;
    case "line":
      return { ...e, p1: to(e.p1), p2: to(e.p2) };
    case "circle":
      return { ...e, center: to(e.center) };
    case "arc":
      return { ...e, center: to(e.center), start: to(e.start), end: to(e.end) };
    case "ellipse":
      return {
        ...e,
        center: to(e.center),
        major: to(e.major),
        minor: to(e.minor),
        ...(e.start && { start: to(e.start) }),
        ...(e.end && { end: to(e.end) }),
      };
  }
}

function copied(e: SketchEntity, ids: ReadonlyMap<string, string>) {
  const copy = { ...renamed(e, ids), id: ids.get(e.id)! };
  delete copy.external;
  if (copy.kind !== "point") delete copy.projection;
  return copy;
}

function detached(
  entities: SketchEntity[],
  moving: ReadonlySet<string>,
): SketchEntity[] {
  const fresh = new Map<string, string>();
  const added: SketchPoint[] = [];
  const kept = entities.map((e) => {
    const shared = entityPointIds(e).filter((id) => moving.has(id));
    if (moving.has(e.id) || !shared.length) return e;
    for (const id of shared)
      if (!fresh.has(id)) {
        const point = entities.find((p) => p.id === id) as SketchPoint;
        added.push({ ...point, id: newId("pt") });
        fresh.set(id, added.at(-1)!.id);
      }
    return renamed(e, fresh);
  });
  return [...kept, ...added];
}

export function moveSketchSelection(
  entities: SketchEntity[],
  constraints: SketchConstraint[],
  ids: readonly string[],
  move: SketchMove,
): SketchModification {
  const chosen = new Set(ids);
  const selected = entities.filter((e) => chosen.has(e.id));
  if (!selected.length) throw new Error("Select sketch geometry to move.");
  if (![move.dx, move.dy, move.angle].every(Number.isFinite))
    throw new Error("Enter a number for each distance and the angle.");
  if (!move.copy) refuseFixed(selected, entities, constraints);
  const moving = new Set(selected.flatMap(entityPointIds));
  for (const e of selected) moving.add(e.id);
  const group = entities.filter((e) => moving.has(e.id));
  const pivot = move.pivot ?? boxCentre(group);
  const t = (move.angle * Math.PI) / 180;
  const [cos, sin] = [Math.cos(t), Math.sin(t)];
  const place = (e: SketchEntity): SketchEntity => {
    if (e.kind !== "point") return e;
    const [x, y] = [e.x - pivot.x, e.y - pivot.y];
    return {
      ...e,
      x: pivot.x + x * cos - y * sin + move.dx,
      y: pivot.y + x * sin + y * cos + move.dy,
    };
  };
  const placed = new Map(group.map((e) => [e.id, place(e)]));
  const direction = (line: string) => {
    const l = placed.get(line);
    const [a, b] =
      l?.kind === "line" ? [placed.get(l.p1), placed.get(l.p2)] : [];
    if (a?.kind !== "point" || b?.kind !== "point") return 0;
    return normalizeDegrees((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI);
  };
  const copyIds = new Map(
    move.copy ? group.map((e) => [e.id, newId(e.kind)]) : [],
  );
  const bound = new Set(move.bound);
  let removed = 0;
  const kept: SketchConstraint[] = [];
  const carried: SketchConstraint[] = [];
  for (const c of constraints) {
    const refs = constraintEntityRefs(c);
    const inside = refs.filter((r) => moving.has(r)).length;
    let next =
      inside > 0 && inside === refs.length
        ? turned(c, move.angle, direction)
        : null;
    if (next && !move.copy && bound.has(c.id) && valueOf(next) !== valueOf(c))
      next = null;
    if (inside > 0 && !next) removed++;
    if (move.copy || inside === 0) kept.push(c);
    if (next && !move.copy) kept.push(next);
    else if (next && next.type !== "fix")
      carried.push(renamedConstraint(next, copyIds));
  }
  if (move.copy)
    return {
      entities: [
        ...entities,
        ...group.map((e) => copied(placed.get(e.id)!, copyIds)),
      ],
      constraints: [...kept, ...carried],
      removedConstraints: removed,
    };
  return {
    entities: detached(entities, moving).map((e) => placed.get(e.id) ?? e),
    constraints: kept,
    removedConstraints: removed,
  };
}
