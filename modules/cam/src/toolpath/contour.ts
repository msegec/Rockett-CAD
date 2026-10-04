import type { StartKernelJob } from "@rockett/plugin-api";
import {
  arcSweep,
  type Move,
  type Section,
  type Xy,
  type Xyz,
} from "../shared/ir.js";
import type { Box, Setup } from "../shared/setup.js";
import {
  validatePreset,
  validateTool,
  type Preset,
  type Tool,
} from "../shared/tools.js";
import type { OffsetInput } from "../kernel/offset.js";
import type { RegionLoop, Segment } from "../kernel/regions.js";
import { depthLevels, offsetLoops, type Loop } from "./geometry.js";

export type ContourInput = {
  operationId: string;
  setup: Pick<Setup, "safeHeight" | "clearance">;
  stock: Box;
  loop: RegionLoop | Loop;
  side: "outside" | "inside";
  direction: "climb" | "conventional";
  bottom: number;
  start: Xy;
  tool: Tool;
  preset: Preset;
};

const PIECE = 1e-3;

const gap = (a: Xy, b: Xy) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function sweep(from: Xy, to: Xy, centre: Xy, dir: "cw" | "ccw") {
  return arcSweep([...from, 0], {
    kind: "arc",
    to: [...to, 0],
    centre: [...centre, 0],
    dir,
    plane: "xy",
    feed: 1,
    role: "cut",
  });
}

function check({ setup, stock, bottom, tool, preset }: ContourInput) {
  const problems = [...validateTool(tool), ...validatePreset(preset)];
  if (problems.length) throw new RangeError(problems.join("; "));
  if (tool.kind !== "flat" && tool.kind !== "bull")
    throw new RangeError(
      `contour needs a flat or bull end mill, not a ${tool.kind}`,
    );
  if (!tool.centreCutting)
    throw new RangeError(
      `${tool.name} is not centre cutting and cannot plunge`,
    );
  if (!(setup.clearance > 0 && setup.safeHeight >= setup.clearance))
    throw new RangeError(
      "clearance must be above 0 and safe height at least the clearance",
    );
  const depth = stock.max[2] - bottom;
  if (depth > tool.fluteLength)
    throw new RangeError(
      `a ${depth} mm deep cut is past the ${tool.fluteLength} mm flute length of ${tool.name}`,
    );
}

function lines(loop: Loop): RegionLoop {
  const points = loop.map(({ x, y }): Xy => [x, y]);
  return {
    start: points[0]!,
    segments: [...points.slice(1), points[0]!].map((to) => ({
      kind: "line",
      to,
    })),
  };
}

async function offset(input: ContourInput, run: StartKernelJob) {
  const { loop, side, tool } = input;
  const radius = tool.diameter / 2;
  const distance = side === "outside" ? radius : -radius;
  const found = Array.isArray(loop)
    ? offsetLoops([loop], distance).map(lines)
    : ((await run("rockett.cam.offset", {
        loop,
        distance,
      } satisfies OffsetInput)) as RegionLoop[]);
  const what = `${side} offset by the ${radius} mm tool radius`;
  if (!found.length)
    throw new RangeError(
      `${what} leaves no path: the loop is smaller than the tool`,
    );
  if (found.length > 1)
    throw new RangeError(
      `${what} splits into ${found.length} loops: the tool does not fit everywhere`,
    );
  const path = straightened(found[0]!);
  if (Math.abs(area(path)) < PIECE)
    throw new RangeError(
      `${what} leaves a path with no area: the loop is no wider than the tool`,
    );
  return path;
}

function* pieces({ start, segments }: RegionLoop) {
  let from = start;
  for (const segment of segments) {
    yield { from, segment };
    from = segment.to;
  }
}

function area(loop: RegionLoop) {
  let twice = 0;
  for (const { from, segment } of pieces(loop)) {
    const [x, y] = segment.to;
    if (segment.kind === "line") {
      twice += from[0] * y - x * from[1];
      continue;
    }
    const [cx, cy] = segment.centre;
    const turn = sweep(from, segment.to, segment.centre, segment.dir);
    twice +=
      cx * (y - from[1]) -
      cy * (x - from[0]) +
      gap(from, segment.centre) ** 2 * (segment.dir === "ccw" ? turn : -turn);
  }
  return twice / 2;
}

function minor(from: Xy, { to, centre, dir }: Segment & { kind: "arc" }) {
  const side =
    (to[0] - from[0]) * (centre[1] - from[1]) -
    (to[1] - from[1]) * (centre[0] - from[0]);
  return dir === "ccw" ? side > 0 : side < 0;
}

function straightened(loop: RegionLoop): RegionLoop {
  if (loop.segments.length === 1) return loop;
  const segments = [...pieces(loop)].map(({ from, segment }): Segment =>
    segment.kind === "arc" &&
    gap(from, segment.to) <= PIECE &&
    minor(from, segment)
      ? { kind: "line", to: segment.to }
      : segment,
  );
  return { start: loop.start, segments };
}

function reversed(loop: RegionLoop): RegionLoop {
  const segments = [...pieces(loop)]
    .reverse()
    .map(({ from, segment }): Segment =>
      segment.kind === "line"
        ? { kind: "line", to: from }
        : { ...segment, to: from, dir: segment.dir === "ccw" ? "cw" : "ccw" },
    );
  return { start: loop.start, segments };
}

function nearest(p: Xy, from: Xy, segment: Segment): Xy {
  const to = segment.to;
  if (segment.kind === "line") {
    const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
    const length = dx * dx + dy * dy;
    const t = length
      ? ((p[0] - from[0]) * dx + (p[1] - from[1]) * dy) / length
      : 0;
    const k = Math.min(1, Math.max(0, t));
    return [from[0] + k * dx, from[1] + k * dy];
  }
  const [cx, cy] = segment.centre;
  const radius = gap(from, segment.centre);
  const angle = Math.atan2(p[1] - cy, p[0] - cx);
  const on: Xy = [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  if (
    sweep(from, on, segment.centre, segment.dir) <=
    sweep(from, to, segment.centre, segment.dir)
  )
    return on;
  return gap(p, from) <= gap(p, to) ? from : to;
}

function startAt(loop: RegionLoop, p: Xy): RegionLoop {
  const all = [...pieces(loop)].map((piece) => ({
    ...piece,
    at: nearest(p, piece.from, piece.segment),
  }));
  const best = all.reduce((a, b) => (gap(p, b.at) < gap(p, a.at) ? b : a));
  const index = all.indexOf(best);
  const { from, segment, at } = best;
  const { segments } = loop;
  if (gap(at, from) > PIECE && gap(at, segment.to) > PIECE)
    return {
      start: at,
      segments: [
        segment,
        ...segments.slice(index + 1),
        ...segments.slice(0, index),
        { ...segment, to: at },
      ],
    };
  const first =
    (gap(at, from) <= gap(at, segment.to) ? index : index + 1) %
    segments.length;
  return {
    start: all[first]!.from,
    segments: [...segments.slice(first), ...segments.slice(0, first)],
  };
}

function oriented(loop: RegionLoop, { side, direction }: ContourInput) {
  const clockwise = (side === "outside") === (direction === "climb");
  return area(loop) < 0 === clockwise ? loop : reversed(loop);
}

function pass(loop: RegionLoop, z: number, feed: number): Move[] {
  return loop.segments.map((segment): Move =>
    segment.kind === "line"
      ? { kind: "feed", to: [...segment.to, z], feed, role: "cut" }
      : {
          kind: "arc",
          to: [...segment.to, z],
          centre: [...segment.centre, z],
          dir: segment.dir,
          plane: "xy",
          feed,
          role: "cut",
        },
  );
}

export async function contour(
  input: ContourInput,
  run: StartKernelJob,
): Promise<Section> {
  check(input);
  const { setup, stock, tool, preset } = input;
  const top = stock.max[2];
  const levels = depthLevels(top, input.bottom, preset.stepdown);
  const loop = startAt(oriented(await offset(input, run), input), input.start);
  const [x, y] = loop.start;
  const above = (height: number): Xyz => [x, y, top + height];
  const moves: Move[] = [
    { kind: "rapid", to: above(setup.safeHeight) },
    { kind: "rapid", to: above(setup.clearance) },
    ...levels.flatMap((z): Move[] => [
      { kind: "feed", to: [x, y, z], feed: preset.plungeFeed, role: "plunge" },
      ...pass(loop, z, preset.cutFeed),
    ]),
    { kind: "rapid", to: above(setup.safeHeight) },
  ];
  return {
    operationId: input.operationId,
    toolId: tool.id,
    pass: "finish",
    spindle: { rpm: preset.rpm, dir: "cw" },
    coolant: preset.coolant,
    moves,
  };
}
