import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { formatProgram } from "../src/post/format.js";
import { normalise, type Units } from "../src/post/normalise.js";
import { validatePost, type Post } from "../src/post/schema.js";
import { validateProgram, type Program } from "../src/shared/ir.js";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");
const post = JSON.parse(read("../posts/grbl.json")) as Post;
const fixtures = ["facing", "contour", "pocket", "drill"];
const fixture = (name: string) =>
  JSON.parse(read(`fixtures/ir/${name}.json`)) as Program;

function files(name: string, units: Units = "mm") {
  return formatProgram(normalise(fixture(name), post, { units }), post, {});
}

function golden(name: string, count: number) {
  const names =
    count === 1
      ? [name]
      : Array.from({ length: count }, (_, i) => `${name}-${i + 1}`);
  return names.map((each) => read(`golden/grbl/${each}.nc`));
}

describe("GRBL 1.1 post", () => {
  it("is a valid post over valid fixtures", () => {
    expect(validatePost(post)).toEqual([]);
    for (const name of fixtures)
      expect(validateProgram(fixture(name))).toEqual([]);
  });

  it("matches the goldens byte for byte", () => {
    for (const name of fixtures) {
      const out = files(name);
      expect(out).toEqual(golden(name, out.length));
    }
    expect(files("contour", "inch")).toEqual(golden("contour-inch", 1));
  });

  it("keeps GRBL 1.1 rules", () => {
    const all = fixtures.flatMap((name) => files(name));
    const lines = all.flatMap((file) => file.split("\n").slice(0, -1));
    expect(lines.filter((l) => /\bM6\b|\bT\d|\bG8\d\b|;/.test(l))).toEqual([]);
    expect(lines.filter((l) => l.startsWith("(") !== l.endsWith(")"))).toEqual(
      [],
    );
    expect(
      lines.filter((l) => /\bG[23]\b/.test(l) && !/ I\S+ J/.test(l)),
    ).toEqual([]);
    expect(files("drill")).toHaveLength(2);
    for (const file of all) expect(file).toMatch(/^G90 G94 G91\.1 G17 G21\n/);
    expect(files("contour", "inch")[0]).toMatch(/^G90 G94 G91\.1 G17 G20\n/);
    for (const file of all) expect(file).toMatch(/\nM30\n$/);
  });
});
