import type { RegionLoop } from "../kernel/regions.js";
import type { Section, Xy, Xyz } from "../shared/ir.js";
import type { Fixture, Setup } from "../shared/setup.js";
import {
  PIECE,
  bandOf,
  checkCut,
  components,
  covers,
  depthLevels,
  disc,
  gap,
  intersectLoops,
  lines,
  offsetLoops,
  pass,
  pieces,
  startAt,
  stepoverOf,
  steps,
  subtractLoops,
  swathOf,
  unionLoops,
  type Cut,
  type Loop,
  type Motion,
} from "./geometry.js";

export type ClearInput = Cut & {
  operationId: string;
  setup: Pick<Setup, "fixtures">;
  rampAngle: number;
};

export type PocketInput = ClearInput & { boundary: Loop; islands: Loop[] };

type Layer = { target: Loop[]; cleared: Loop[] };

export type Clearing = Layer & {
  region: Loop[];
  floor?: Layer & { below: number };
};

type Entry = { kind: "helix"; centre: Xy } | { kind: "ramp" };

type Step = { ring: RegionLoop; entry?: Entry };

type Plan = { steps: Step[]; descend: boolean };

type Pocket = {
  input: ClearInput;
  radius: number;
  stepover: number;
  walls: Loop[];
  room: Loop[];
  slope: number;
};

const WALL = 1e-3;
const PROOF = 2e-3;
export const SKIN = WALL + PROOF;
const HELIX = 0.45;
const MARGIN = 0.05;

const point = ([x, y]: Xy) => ({ x, y });

const shown = ([x, y]: Xy) =>
  `(${Number(x.toFixed(3))}, ${Number(y.toFixed(3))})`;

function nested(levels: Loop[][][], k: number, parent?: Loop[]): Loop[] {
  const order: Loop[] = [];
  for (const part of levels[k] ?? [])
    if (!parent || intersectLoops([part[0]!], parent).length > 0)
      order.push(...nested(levels, k + 1, part), ...part);
  return order;
}

function rings(
  region: Loop[],
  { radius, stepover }: Pick<Pocket, "radius" | "stepover">,
): Loop[] {
  const levels: Loop[][][] = [];
  for (let k = 0; ; k++) {
    const found = offsetLoops(region, -(radius + WALL + k * stepover));
    if (!found.length) return nested(levels, 0);
    levels.push(components(found));
  }
}

function reachable(from: Xy, to: Xy, cleared: Loop[], shape: Pocket) {
  if (gap(from, to) <= PIECE) return true;
  const path = [point(from), point(to)];
  return (
    covers(shape.room, swathOf(path, PIECE / 2)) &&
    covers(cleared, swathOf(path, shape.radius - PROOF))
  );
}

function perimeter(ring: RegionLoop) {
  let length = 0;
  for (const { from, segment } of pieces(ring)) length += gap(from, segment.to);
  return length;
}

function entryFor(ring: RegionLoop, shape: Pocket): Entry {
  const { diameter } = shape.input.tool;
  const [p, q] = [ring.start, ring.segments[0]!.to];
  const length = gap(p, q);
  const reach = HELIX * diameter;
  const centre: Xy = [
    p[0] - (reach * (q[1] - p[1])) / length,
    p[1] + (reach * (q[0] - p[0])) / length,
  ];
  if (covers(shape.walls, [disc(centre, reach + MARGIN * diameter)]))
    return { kind: "helix", centre };
  if (perimeter(ring) >= 2 * Math.PI * reach) return { kind: "ramp" };
  throw new RangeError(
    `no helix or ramp entry fits at ${shown(p)}: the pocket is too small for the ${diameter} mm tool to enter`,
  );
}

export function provenCleared(region: Loop[], radius: number): Loop[] {
  return offsetLoops(offsetLoops(region, -(radius + WALL)), radius - PROOF);
}

export function flatFloor(
  input: Pick<PocketInput, "boundary" | "islands" | "tool" | "preset">,
  corner: number,
): Loop[] {
  const { boundary, islands, tool, preset } = input;
  const radius = tool.diameter / 2;
  const order = rings(subtractLoops([boundary], islands), {
    radius,
    stepover: stepoverOf(preset, tool),
  });
  return unionLoops(
    order.flatMap((points) => bandOf(points, radius - corner - PROOF)),
  );
}

function covered(cleared: Loop[], reach: Loop[], shape: Pocket) {
  const left = subtractLoops(reach, cleared);
  const at = left[0]?.[0];
  if (at)
    throw new RangeError(
      `a ${shape.stepover} mm stepover leaves uncut material between rings near ${shown([at.x, at.y])}`,
    );
}

function plan(
  { target, cleared: prior }: Layer,
  shape: Pocket,
): Plan | undefined {
  if (!target.length) return undefined;
  const order = rings(target, shape);
  if (!order.length)
    throw new RangeError(
      `the ${shape.input.tool.diameter} mm tool does not fit the area to clear`,
    );
  let cleared = prior;
  let at: Xy | undefined;
  const chosen: Step[] = [];
  for (const points of order) {
    const ring = at ? startAt(lines(points), at) : lines(points);
    const next = unionLoops([...cleared, ...bandOf(points, shape.radius)]);
    chosen.push(
      at && reachable(at, ring.start, next, shape)
        ? { ring }
        : { ring, entry: entryFor(ring, shape) },
    );
    cleared = next;
    at = ring.start;
  }
  covered(cleared, provenCleared(target, shape.radius), shape);
  const first = chosen[0]!.ring.start;
  return { steps: chosen, descend: reachable(at!, first, cleared, shape) };
}

function helix(centre: Xy, p: Xy, top: number, z: number, shape: Pocket) {
  const { cutFeed, rampFeed } = shape.input.preset;
  const radius = gap(p, centre);
  const q: Xy = [2 * centre[0] - p[0], 2 * centre[1] - p[1]];
  const halves = 2 * steps(top - z, 2 * Math.PI * radius * shape.slope);
  const half = (h: number, at: number, role: "plunge" | "cut"): Motion => ({
    kind: "arc",
    to: [...(h % 2 ? p : q), at],
    centre: [...centre, at],
    dir: "ccw",
    plane: "xy",
    feed: role === "cut" ? cutFeed : rampFeed,
    role,
  });
  return [
    ...Array.from({ length: halves }, (_, h) =>
      half(
        h,
        h + 1 === halves ? z : top - ((h + 1) * (top - z)) / halves,
        "plunge",
      ),
    ),
    half(0, z, "cut"),
    half(1, z, "cut"),
  ];
}

function ramp(ring: RegionLoop, top: number, z: number, shape: Pocket) {
  const length = perimeter(ring);
  const laps = steps(top - z, length * shape.slope);
  const total = laps * ring.segments.length;
  const moves: Motion[] = [];
  let run = 0;
  for (let lap = 0; lap < laps; lap++)
    for (const { from, segment } of pieces(ring)) {
      run += gap(from, segment.to);
      const at =
        moves.length + 1 === total
          ? z
          : top - ((top - z) * run) / (laps * length);
      moves.push({
        kind: "feed",
        to: [...segment.to, at],
        feed: shape.input.preset.rampFeed,
        role: "plunge",
      });
    }
  return moves;
}

function link([x, y]: Xy, z: number, shape: Pocket): Motion {
  return {
    kind: "feed",
    to: [x, y, z],
    feed: shape.input.preset.cutFeed,
    role: "link",
  };
}

function approach(at: Xyz | undefined, p: Xy, from: number, shape: Pocket) {
  const { setup, stock, preset } = shape.input;
  const top = stock.max[2];
  const clear = top + setup.clearance;
  const moves: Motion[] = at
    ? [{ kind: "rapid", to: [at[0], at[1], clear] }]
    : [{ kind: "rapid", to: [...p, top + setup.safeHeight] }];
  return [
    ...moves,
    { kind: "rapid", to: [...p, clear] },
    {
      kind: "feed",
      to: [...p, from],
      feed: preset.plungeFeed,
      role: "plunge",
    },
  ] satisfies Motion[];
}

function level(
  z: number,
  from: number,
  { steps: order, descend }: Plan,
  shape: Pocket,
  at: Xyz | undefined,
) {
  const moves: Motion[] = [];
  for (const [i, { ring, entry }] of order.entries()) {
    const p = ring.start;
    if (!entry) moves.push(link(p, z, shape));
    else {
      if (at && !i && descend) moves.push(link(p, from, shape));
      else moves.push(...approach(moves.at(-1)?.to ?? at, p, from, shape));
      moves.push(
        ...(entry.kind === "helix"
          ? helix(entry.centre, p, from, z, shape)
          : ramp(ring, from, z, shape)),
      );
    }
    moves.push(...pass(ring, z, shape.input.preset.cutFeed));
  }
  return moves;
}

function rect({ min, max }: Fixture): Loop {
  return [
    { x: min[0], y: min[1] },
    { x: max[0], y: min[1] },
    { x: max[0], y: max[1] },
    { x: min[0], y: max[1] },
  ];
}

function near(from: Xyz, move: Motion, shape: Pocket) {
  const { setup, tool } = shape.input;
  const reach = tool.diameter / 2 + setup.clearance;
  const sweep =
    move.kind === "arc"
      ? [
          disc(
            [move.centre[0], move.centre[1]],
            gap([from[0], from[1]], [move.centre[0], move.centre[1]]) + reach,
          ),
        ]
      : swathOf(
          [point([from[0], from[1]]), point([move.to[0], move.to[1]])],
          reach,
        );
  const low = Math.min(from[2], move.to[2]);
  return setup.fixtures.find(
    (fixture) =>
      low < fixture.max[2] + setup.clearance &&
      intersectLoops(sweep, [rect(fixture)]).length > 0,
  );
}

function guarded(moves: Motion[], shape: Pocket): Motion[] {
  const { setup, stock } = shape.input;
  const safe = stock.max[2] + setup.safeHeight;
  const out: Motion[] = [];
  let at: Xyz | undefined;
  for (const move of moves) {
    const hit = at && near(at, move, shape);
    if (at && hit) {
      if (move.kind !== "rapid" || at[2] !== move.to[2] || at[2] >= safe)
        throw new RangeError(
          `pocket comes within the ${setup.clearance} mm clearance of fixture ${hit.name}`,
        );
      const over: Motion = {
        kind: "rapid",
        to: [move.to[0], move.to[1], safe],
      };
      const rise: Xyz = [at[0], at[1], safe];
      const above = near(rise, over, shape);
      if (above)
        throw new RangeError(
          `fixture ${above.name} reaches above the safe height`,
        );
      out.push({ kind: "rapid", to: rise }, over);
    }
    out.push(move);
    at = move.to;
  }
  return out;
}

export function clearRegion(
  input: ClearInput,
  { region, floor, ...layer }: Clearing,
): Section {
  checkCut("pocket", input);
  const { setup, stock, tool, preset, rampAngle } = input;
  if (!(rampAngle > 0 && rampAngle < 90))
    throw new RangeError("ramp angle must be above 0 and below 90 degrees");
  const top = stock.max[2];
  const levels = depthLevels(top, input.bottom, preset.stepdown);
  const radius = tool.diameter / 2;
  const walls = offsetLoops(region, -(radius + WALL));
  if (!walls.length)
    throw new RangeError(
      `the ${tool.diameter} mm tool does not fit the pocket`,
    );
  const shape: Pocket = {
    input,
    radius,
    stepover: stepoverOf(preset, tool),
    walls,
    room: offsetLoops(walls, PIECE),
    slope: Math.tan((rampAngle * Math.PI) / 180),
  };
  const upper = plan(layer, shape);
  const deep = floor && plan(floor, shape);
  const moves: Motion[] = [];
  let last: Plan | undefined;
  for (const [l, z] of levels.entries()) {
    const chosen = floor && z < floor.below ? deep : upper;
    if (!chosen) continue;
    const from = l ? levels[l - 1]! : top;
    const linked = chosen === last ? chosen : { ...chosen, descend: false };
    moves.push(...level(z, from, linked, shape, moves.at(-1)?.to));
    last = chosen;
  }
  const end = moves.at(-1)!.to;
  moves.push({ kind: "rapid", to: [end[0], end[1], top + setup.safeHeight] });
  return {
    operationId: input.operationId,
    toolId: tool.id,
    pass: "rough",
    spindle: { rpm: preset.rpm, dir: "cw" },
    coolant: preset.coolant,
    moves: guarded(moves, shape),
  };
}

export function pocket(input: PocketInput): Section {
  const region = subtractLoops([input.boundary], input.islands);
  return clearRegion(input, { region, target: region, cleared: [] });
}
