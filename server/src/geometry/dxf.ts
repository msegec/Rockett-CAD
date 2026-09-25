import type { SketchEntity, SketchPoint } from "@rockett/shared";

type Pair = [number, string];

const CONSTRUCTION = "CONSTRUCTION";

function real(v: number): string {
  const s = v.toFixed(9).replace(/0+$/, "").replace(/\.$/, ".0");
  return s === "-0.0" ? "0.0" : s;
}

function degrees(center: SketchPoint, p: SketchPoint): number {
  const a = (Math.atan2(p.y - center.y, p.x - center.x) * 180) / Math.PI;
  return a < 0 ? a + 360 : a;
}

function layer(name: string, color: number): Pair[] {
  return [
    [0, "LAYER"],
    [2, name],
    [70, "0"],
    [62, String(color)],
    [6, "CONTINUOUS"],
  ];
}

function section(name: string, body: Pair[]): Pair[] {
  return [[0, "SECTION"], [2, name], ...body, [0, "ENDSEC"]];
}

function layerTable(): Pair[] {
  return [
    [0, "TABLE"],
    [2, "LTYPE"],
    [70, "1"],
    [0, "LTYPE"],
    [2, "CONTINUOUS"],
    [70, "0"],
    [3, "Solid line"],
    [72, "65"],
    [73, "0"],
    [40, "0.0"],
    [0, "ENDTAB"],
    [0, "TABLE"],
    [2, "LAYER"],
    [70, "2"],
    ...layer("0", 7),
    ...layer(CONSTRUCTION, 8),
    [0, "ENDTAB"],
  ];
}

function entityPairs(entities: readonly SketchEntity[]) {
  const points = new Map<string, SketchPoint>();
  const used = new Set<string>();
  for (const e of entities) {
    if (e.kind === "point") points.set(e.id, e);
    if (e.kind === "line") used.add(e.p1).add(e.p2);
    if (e.kind === "circle") used.add(e.center);
    if (e.kind === "arc") used.add(e.center).add(e.start).add(e.end);
  }
  const at = (id: string) => {
    const p = points.get(id);
    if (!p) throw new Error(`sketch point ${id} is missing`);
    return p;
  };
  const xyz = (p: SketchPoint, code = 10): Pair[] => [
    [code, real(p.x)],
    [code + 10, real(p.y)],
    [code + 20, "0.0"],
  ];
  const out: Pair[] = [];
  for (const e of entities) {
    const head = (type: string): Pair[] => [
      [0, type],
      [8, e.construction ? CONSTRUCTION : "0"],
    ];
    if (e.kind === "point" && !used.has(e.id))
      out.push(...head("POINT"), ...xyz(e));
    if (e.kind === "line")
      out.push(...head("LINE"), ...xyz(at(e.p1)), ...xyz(at(e.p2), 11));
    if (e.kind === "circle")
      out.push(...head("CIRCLE"), ...xyz(at(e.center)), [40, real(e.radius)]);
    if (e.kind === "arc") {
      const c = at(e.center);
      const s = at(e.start);
      out.push(
        ...head("ARC"),
        ...xyz(c),
        [40, real(Math.hypot(s.x - c.x, s.y - c.y))],
        [50, real(degrees(c, s))],
        [51, real(degrees(c, at(e.end)))],
      );
    }
  }
  return out;
}

export function writeDxf(entities: readonly SketchEntity[]): Buffer {
  const pairs = [
    ...section("HEADER", [
      [9, "$ACADVER"],
      [1, "AC1009"],
    ]),
    ...section("TABLES", layerTable()),
    ...section("ENTITIES", entityPairs(entities)),
    [0, "EOF"] as Pair,
  ];
  return Buffer.from(
    pairs
      .map(([code, value]) => `${String(code).padStart(3)}\n${value}\n`)
      .join(""),
    "ascii",
  );
}
