import type { StartKernelJob } from "@rockett/plugin-api";
import type { Move, Section, Xy, Xyz } from "../shared/ir.js";
import type { OffsetInput } from "../kernel/offset.js";
import type { RegionLoop, Segment } from "../kernel/regions.js";
import {
  PIECE,
  area,
  checkCut,
  depthLevels,
  gap,
  lines,
  offsetLoops,
  pass,
  pieces,
  startAt,
  type Cut,
  type Loop,
} from "./geometry.js";

export type ContourInput = Cut & {
  operationId: string;
  loop: RegionLoop | Loop;
  side: "outside" | "inside";
  direction: "climb" | "conventional";
  start: Xy;
};

function check(input: ContourInput) {
  checkCut("contour", input);
  if (!input.tool.centreCutting)
    throw new RangeError(
      `${input.tool.name} is not centre cutting and cannot plunge`,
    );
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

function oriented(loop: RegionLoop, { side, direction }: ContourInput) {
  const clockwise = (side === "outside") === (direction === "climb");
  return area(loop) < 0 === clockwise ? loop : reversed(loop);
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
