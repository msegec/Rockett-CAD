import { defineConfig } from "vitest/config";

const BROWSER_WAIT_MS = 30_000;

export const projects = [
  {
    name: "node",
    environment: "node",
    include: [
      "shared/test/**/*.test.ts",
      "server/test/**/*.test.ts",
      "server/src/**/*.test.ts",
      "client/test/**/*.test.ts",
      "modules/*/test/**/*.test.ts",
    ],
    exclude: [
      "**/test/dom/**",
      "**/test/browser/**",
      "server/test/memorySoak.test.ts",
    ],
    testTimeout: 30_000,
    benchmark: { include: [] },
  },
  {
    name: "dom",
    environment: "happy-dom",
    include: [
      "client/test/*.test.tsx",
      "client/test/dom/**/*.test.{ts,tsx}",
      "modules/*/test/dom/**/*.test.{ts,tsx}",
    ],
    exclude: [],
    setupFiles: ["client/test/dom/setup.ts"],
    testTimeout: 30_000,
    benchmark: { include: ["client/test/**/*.bench.ts"] },
  },
  {
    name: "soak",
    environment: "node",
    include: ["server/test/memorySoak.test.ts"],
    exclude: [],
    benchmark: { include: [] },
  },
  {
    name: "browser",
    environment: "node",
    include: ["client/test/browser/**/*.test.ts"],
    exclude: [],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    expect: { poll: { timeout: BROWSER_WAIT_MS } },
    provide: { browserWaitMs: BROWSER_WAIT_MS },
    benchmark: { include: [] },
  },
];

export default defineConfig({
  test: { projects: projects.map((test) => ({ test })) },
});
