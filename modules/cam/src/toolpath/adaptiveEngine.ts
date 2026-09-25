import type { Loop } from "./geometry";

const MOTIONS = [
  "cut",
  "linkClear",
  "linkNotClear",
  "linkClearAtPrevPass",
] as const;
const OPERATIONS = [
  "clearingInside",
  "clearingOutside",
  "profilingInside",
  "profilingOutside",
] as const;
const WARNINGS = [
  "startPointNotFound",
  "leadPathFailed",
  "unexpectedRotateIterations",
  "tooManyFailedEngagements",
  "unclearedAreaRemains",
  "failedToSetUpFinishingPass",
  "finishingLeadInFailed",
] as const;

export type AdaptiveMotion = (typeof MOTIONS)[number];
export type AdaptiveOperation = (typeof OPERATIONS)[number];
export type AdaptiveWarning = (typeof WARNINGS)[number];
type Point = { x: number; y: number };

export type AdaptiveInput = {
  stock: Loop[];
  region: Loop[];
  cleared: Loop[];
  operation: AdaptiveOperation;
  toolDiameter: number;
  stepOverFactor: number;
  tolerance: number;
  stockToLeave: number;
  helixRampTargetDiameter: number;
  helixRampMinDiameter: number;
  forceInsideOut: boolean;
  finishingProfile: boolean;
  keepToolDownDistRatio: number;
};

export type AdaptiveRegion = {
  helixCentre: Point;
  start: Point;
  returnMotion: AdaptiveMotion;
  clearedArea: number;
  warnings: AdaptiveWarning[];
  paths: { motion: AdaptiveMotion; points: Point[] }[];
};

type Engine = {
  memory: WebAssembly.Memory;
  _initialize(): void;
  malloc(bytes: bigint): bigint;
  adaptive(input: bigint): bigint;
};

const UNSUPPORTED = () => 52;
const IMPORTS = {
  env: { emscripten_notify_memory_growth: () => undefined },
  wasi_snapshot_preview1: Object.fromEntries(
    [
      "clock_time_get",
      "fd_seek",
      "fd_write",
      "fd_read",
      "fd_close",
      "environ_sizes_get",
      "environ_get",
    ].map((name) => [name, UNSUPPORTED]),
  ),
};

function encode(input: AdaptiveInput): number[] {
  const values = [
    input.toolDiameter,
    input.helixRampTargetDiameter,
    input.helixRampMinDiameter,
    input.stepOverFactor,
    input.tolerance,
    input.stockToLeave,
    Number(input.forceInsideOut),
    Number(input.finishingProfile),
    input.keepToolDownDistRatio,
    OPERATIONS.indexOf(input.operation),
  ];
  for (const loops of [input.stock, input.region, input.cleared]) {
    values.push(loops.length);
    for (const loop of loops) {
      values.push(loop.length, ...loop.flatMap(({ x, y }) => [x, y]));
    }
  }
  if (!values.every(Number.isFinite)) {
    throw new RangeError("adaptive input has a number that is not finite");
  }
  if (input.toolDiameter <= 0 || input.stepOverFactor <= 0) {
    throw new RangeError("tool diameter and step over must be positive");
  }
  return values;
}

function decode(values: Float64Array): AdaptiveRegion[] {
  let at = 1;
  const next = () => values[at++]!;
  const point = () => ({ x: next(), y: next() });
  const motion = () => {
    const code = next();
    const found = MOTIONS[code];
    if (!found) throw new Error(`adaptive engine returned motion ${code}`);
    return found;
  };
  return Array.from({ length: next() }, () => {
    const helixCentre = point();
    const start = point();
    const returnMotion = motion();
    const clearedArea = next();
    const flags = next();
    const warnings = WARNINGS.filter((_, bit) => flags & (1 << bit));
    const paths = Array.from({ length: next() }, () => ({
      motion: motion(),
      points: Array.from({ length: next() }, point),
    }));
    return { helixCentre, start, returnMotion, clearedArea, warnings, paths };
  });
}

export function adaptiveClear(
  engine: WebAssembly.Module,
  input: AdaptiveInput,
): AdaptiveRegion[] {
  const values = encode(input);
  const wasm = new WebAssembly.Instance(engine, IMPORTS)
    .exports as unknown as Engine;
  wasm["_initialize"]();
  const address = wasm.malloc(BigInt(values.length * 8));
  new Float64Array(wasm.memory.buffer, Number(address), values.length).set(
    values,
  );
  const result = Number(wasm.adaptive(address));
  const length = new Float64Array(wasm.memory.buffer, result, 1)[0]!;
  return decode(new Float64Array(wasm.memory.buffer, result, length));
}
