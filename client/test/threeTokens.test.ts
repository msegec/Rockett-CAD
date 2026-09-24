import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const dir = fileURLToPath(new URL("../src/", import.meta.url));

it("keeps every hex colour literal in client/src/theme", () => {
  const found = readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/.test(file) && !file.startsWith("theme/"))
    .flatMap((file) =>
      (
        readFileSync(dir + file, "utf8").match(
          /\b0x[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3,8}\b/g,
        ) ?? []
      ).map((literal) => `${file}: ${literal}`),
    );
  expect(found).toEqual([]);
});
