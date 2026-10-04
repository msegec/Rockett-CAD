import type { Program, Xy } from "../shared/ir.js";
import type { Box } from "../shared/setup.js";
import type { Tool } from "../shared/tools.js";
import { programToSegments } from "./segments.js";

export type Heightmap = {
  min: Xy;
  cellMm: number;
  columns: number;
  rows: number;
  heights: Float32Array;
};

type Lowest = (
  z: number,
  m: number,
  h2: number,
  lo: number,
  hi: number,
) => number;

const EPSILON = 1e-9;

const clamp = (u: number, lo: number, hi: number) =>
  Math.min(Math.max(u, lo), hi);

function lowest(tool: Tool): Lowest {
  const r = tool.diameter / 2;
  if (tool.kind === "bull") throw new Error("bull tools are not simulated yet");
  if ("tipAngle" in tool) {
    const k = 1 / Math.tan((tool.tipAngle * Math.PI) / 360);
    return (z, m, h2, lo, hi) => {
      const free =
        Math.abs(m) < k
          ? (-m * Math.sqrt(h2)) / Math.sqrt(k * k - m * m)
          : -m * Infinity;
      const u = clamp(free, lo, hi);
      return z + m * u + k * Math.sqrt(u * u + h2);
    };
  }
  if (tool.kind === "flat")
    return (z, m, _h2, lo, hi) => z + m * (m > 0 ? lo : hi);
  return (z, m, h2, lo, hi) => {
    const w2 = r * r - h2;
    const u = clamp((-m * Math.sqrt(w2)) / Math.sqrt(1 + m * m), lo, hi);
    return z + m * u + r - Math.sqrt(Math.max(0, w2 - u * u));
  };
}

export function simulateHeightmap(
  program: Program,
  stock: Box,
  cellMm: number,
): Heightmap {
  if (!(cellMm > 0)) throw new Error("cell size must be greater than 0");
  const [x0, y0, bottom] = stock.min;
  const [x1, y1, top] = stock.max;
  const columns = Math.ceil((x1 - x0) / cellMm);
  const rows = Math.ceil((y1 - y0) / cellMm);
  const heights = new Float32Array(columns * rows).fill(top);
  const { positions, sections } = programToSegments(program);

  const sweep = (p: number, r: number, cut: Lowest) => {
    const [ax = 0, ay = 0, az = 0, bx = 0, by = 0, bz = 0] = positions.subarray(
      p,
      p + 6,
    );
    if (Math.min(az, bz) >= top) return;
    const s = Math.hypot(bx - ax, by - ay);
    const vertical = s < EPSILON;
    const [ex, ey] = vertical ? [0, 0] : [(bx - ax) / s, (by - ay) / s];
    const m = vertical ? 0 : (bz - az) / s;
    const z0 = vertical ? Math.min(az, bz) : az;
    const span = (a: number, b: number, origin: number, count: number) =>
      [
        Math.max(0, Math.ceil((Math.min(a, b) - r - origin) / cellMm - 0.5)),
        Math.min(
          count - 1,
          Math.floor((Math.max(a, b) + r - origin) / cellMm - 0.5),
        ),
      ] as const;
    const [i0, i1] = span(ax, bx, x0, columns);
    const [j0, j1] = span(ay, by, y0, rows);
    for (let j = j0; j <= j1; j++) {
      const ry = y0 + (j + 0.5) * cellMm - ay;
      for (let i = i0; i <= i1; i++) {
        const rx = x0 + (i + 0.5) * cellMm - ax;
        const along = rx * ex + ry * ey;
        const h2 = Math.max(0, rx * rx + ry * ry - along * along);
        if (h2 > r * r) continue;
        const w = Math.sqrt(r * r - h2);
        const lo = Math.max(-along, -w);
        const hi = Math.min(s - along, w);
        if (lo > hi) continue;
        const z = cut(z0 + m * along, m, h2, lo, hi);
        const c = j * columns + i;
        if (z < heights[c]!) heights[c] = Math.max(z, bottom);
      }
    }
  };

  program.sections.forEach(({ toolId }, n) => {
    const tool = program.tools.find(({ id }) => id === toolId);
    if (!tool) throw new Error(`section ${n} tool ${toolId} is unknown`);
    const cut = lowest(tool);
    const { start, count } = sections[n]!;
    for (let v = start; v < start + count; v += 2)
      sweep(v * 3, tool.diameter / 2, cut);
  });
  return { min: [x0, y0], cellMm, columns, rows, heights };
}

export function simulateInWorker(program: Program, stock: Box, cellMm: number) {
  let worker: Worker | undefined;
  let stop: ((error: Error) => void) | undefined;
  const result = new Promise<Heightmap>((resolve, reject) => {
    stop = reject;
    worker = new Worker(new URL("./heightmapWorker.ts", import.meta.url), {
      type: "module",
    });
    worker.addEventListener("message", ({ data }) =>
      "map" in data ? resolve(data.map) : reject(data.error),
    );
    worker.addEventListener("error", (event) =>
      reject(new Error(event.message)),
    );
    worker.postMessage({ program, stock, cellMm }, { transfer: [] });
  }).finally(() => worker?.terminate());
  return { result, cancel: () => stop?.(new Error("simulation cancelled")) };
}
