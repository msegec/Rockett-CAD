import { child, children, num, str, type SexprList } from "./sexpr.js";
import {
  arc,
  circle,
  boardLoops,
  BOARD_LIMITS,
  EPS,
  gap,
  fail,
  finite,
  validateSegment,
  type BoardPoint,
  type BoardSegment,
} from "./boardGeometry.js";
export { BOARD_LIMITS } from "./boardGeometry.js";
export type { BoardPoint, BoardSegment, BoardLoop } from "./boardGeometry.js";
const MIN_VERSION = 20241229;
const TESTED_VERSION = 20260206;

type Sublayer = {
  thickness?: number;
  locked?: boolean;
  material?: string;
  color?: string;
  epsilonR?: number;
  lossTangent?: number;
};
export type BoardStackup = {
  layers: { name: string; type: string; sublayers: Sublayer[] }[];
  copperFinish?: string;
  dielectricConstraints?: boolean;
  edgeConnector?: string;
  castellatedPads?: boolean;
  edgePlating?: boolean;
};

function stackup(
  tree: SexprList | undefined,
  spend: () => void,
): BoardStackup | undefined {
  if (!tree) return undefined;
  const result: BoardStackup = { layers: [] };
  for (const layer of children(tree, "layer")) {
    spend();
    const name = str(layer);
    const type = str(child(layer, "type"));
    if (!name || !type) fail("Invalid stackup layer name or type");
    const sublayers: Sublayer[] = [{}];
    for (const field of layer.slice(2)) {
      spend();
      if (field === "addsublayer") {
        sublayers.push({});
        continue;
      }
      if (!Array.isArray(field)) continue;
      const target = sublayers.at(-1)!;
      if (field[0] === "material" || field[0] === "color") {
        const value = str(field);
        if (value === undefined) fail(`Invalid stackup ${field[0]}`);
        target[field[0]] = value;
      }
      const key = {
        thickness: "thickness",
        epsilon_r: "epsilonR",
        loss_tangent: "lossTangent",
      }[String(field[0])] as
        "thickness" | "epsilonR" | "lossTangent" | undefined;
      if (!key) continue;
      const value = num(field);
      if (
        value === undefined ||
        value < 0 ||
        (key === "epsilonR" && value === 0)
      )
        fail(`Invalid stackup ${field[0]}`);
      target[key] = value;
      if (key === "thickness" && field.includes("locked")) target.locked = true;
    }
    result.layers.push({ name, type, sublayers });
  }
  for (const [field, key] of [
    ["copper_finish", "copperFinish"],
    ["edge_connector", "edgeConnector"],
  ] as const) {
    const value = str(child(tree, field));
    if (value !== undefined) result[key] = value;
  }
  for (const [field, key] of [
    ["dielectric_constraints", "dielectricConstraints"],
    ["castellated_pads", "castellatedPads"],
    ["edge_plating", "edgePlating"],
  ] as const) {
    const value = str(child(tree, field));
    if (value !== undefined) {
      if (value !== "yes" && value !== "no") fail(`Invalid stackup ${field}`);
      result[key] = value === "yes";
    }
  }
  return result;
}

function pointMapper(placement?: SexprList) {
  const x = placement ? num(placement) : 0,
    y = placement ? num(placement, 2) : 0;
  const degrees = placement?.[3] === undefined ? 0 : num(placement, 3);
  const theta = ((degrees ?? NaN) * Math.PI) / 180;
  return (field: SexprList | undefined): BoardPoint => {
    const px = num(field),
      py = num(field, 2);
    if (
      x === undefined ||
      y === undefined ||
      px === undefined ||
      py === undefined ||
      !Number.isFinite(theta)
    )
      return fail("Invalid Edge.Cuts coordinate or footprint placement");
    const mapped: BoardPoint = [
      finite(x + px * Math.cos(theta) + py * Math.sin(theta)),
      finite(-y + px * Math.sin(theta) - py * Math.cos(theta)),
    ];
    return [mapped[0] === 0 ? 0 : mapped[0], mapped[1] === 0 ? 0 : mapped[1]];
  };
}

function readGraphics(
  items: SexprList,
  add: (segment: BoardSegment) => void,
  spend: () => void,
  placement?: SexprList,
) {
  const point = pointMapper(placement);
  const makeArc = (item: SexprList) =>
    arc(
      point(child(item, "start")),
      point(child(item, "mid")),
      point(child(item, "end")),
    );
  for (const item of items) {
    spend();
    if (
      !Array.isArray(item) ||
      !/^(gr|fp)_/.test(String(item[0])) ||
      str(child(item, "layer")) !== "Edge.Cuts"
    )
      continue;
    const kind = String(item[0]).slice(3);
    if (kind === "arc") {
      add(makeArc(item));
      continue;
    }
    if (kind === "circle") {
      add(circle(point(child(item, "center")), point(child(item, "end"))));
      continue;
    }
    if (kind === "line") {
      add({
        kind: "line",
        from: point(child(item, "start")),
        to: point(child(item, "end")),
      });
      continue;
    }
    if (kind === "rect") {
      const start = child(item, "start"),
        end = child(item, "end");
      const points = [
        point(start),
        point(["xy", end?.[1] ?? "", start?.[2] ?? ""]),
        point(end),
        point(["xy", start?.[1] ?? "", end?.[2] ?? ""]),
      ];
      points.forEach((from, i) =>
        add({ kind: "line", from, to: points[(i + 1) % 4]! }),
      );
      continue;
    }
    if (kind !== "poly") fail(`unsupported Edge.Cuts item ${item[0]}`);
    const entries = child(item, "pts")?.slice(1) ?? [];
    let first: BoardPoint | undefined, previous: BoardPoint | undefined;
    let curves = 0;
    for (const entry of entries) {
      spend();
      if (!Array.isArray(entry) || (entry[0] !== "xy" && entry[0] !== "arc"))
        fail("Invalid Edge.Cuts polygon point");
      const curved = entry[0] === "arc" ? makeArc(entry) : undefined;
      const next = curved?.from ?? point(entry);
      first ??= next;
      if (previous && gap(previous, next) > EPS)
        add({ kind: "line", from: previous, to: next });
      if (curved) {
        add(curved);
        curves++;
      }
      previous = curved?.to ?? next;
    }
    if (entries.length < (curves ? 2 : 3) || !first || !previous)
      fail("Invalid Edge.Cuts polygon");
    if (gap(previous, first) > EPS)
      add({ kind: "line", from: previous, to: first });
  }
}

function readSegments(tree: SexprList, spend: () => void) {
  const segments: BoardSegment[] = [];
  const add = (segment: BoardSegment) => {
    if (segments.length >= BOARD_LIMITS.segments)
      fail("Board segment limit exceeded");
    validateSegment(segment);
    if (segment.kind === "line" && gap(segment.from, segment.to) <= EPS)
      fail("degenerate line in Edge.Cuts");
    segments.push(segment);
  };
  readGraphics(tree, add, spend);
  for (const footprint of children(tree, "footprint")) {
    const edges = footprint.filter((entry) => {
      spend();
      return (
        Array.isArray(entry) &&
        String(entry[0]).startsWith("fp_") &&
        str(child(entry, "layer")) === "Edge.Cuts"
      );
    });
    if (edges.length) {
      const placement = child(footprint, "at");
      if (!placement) fail("Invalid Edge.Cuts footprint placement");
      readGraphics(edges, add, spend, placement);
    }
  }
  if (!segments.length) fail("Board has no Edge.Cuts outline");
  return segments;
}

export function readBoard(tree: SexprList) {
  if (tree[0] !== "kicad_pcb") fail("Expected kicad_pcb board");
  const formatVersion = num(child(tree, "version"));
  if (formatVersion === undefined || !Number.isSafeInteger(formatVersion))
    fail("Invalid board format version");
  if (formatVersion < MIN_VERSION) fail("Save this board in KiCad 9 or later");
  const thickness = num(child(child(tree, "general"), "thickness"));
  if (thickness === undefined || thickness <= 0)
    fail("Invalid board thickness");
  let work = 0;
  const spend = () => {
    if (++work > BOARD_LIMITS.work) fail("Board geometry work limit exceeded");
  };
  return {
    formatVersion,
    thickness,
    ...boardLoops(readSegments(tree, spend), spend),
    stackup: stackup(child(child(tree, "setup"), "stackup"), spend),
    warnings: formatVersion > TESTED_VERSION ? ["untested version"] : [],
  };
}
