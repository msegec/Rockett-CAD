import { act, createElement as h, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Tool } from "../src/shared/tools.js";

const load = (path: string) => import(path);

const client = (file: string) => load(`../../../client/src/${file}`);

const TOOLS = "/api/m/rockett/cam/tools";

let stored: { data: Tool[]; etag: string } | null;
let puts: { data: Tool[]; etag: string | null }[];
let failLoad: boolean;
let host: HTMLElement;
let root: Root;
let unload = () => {};
let runCommand: (id: string) => unknown;

function serve(url: RequestInfo | URL, init: RequestInit = {}) {
  const method = init.method ?? "GET";
  if (String(url) !== TOOLS) throw new Error(`${method} ${url}`);
  if (method === "GET" && failLoad)
    return Response.json({ error: "disk unavailable" }, { status: 500 });
  if (method === "GET")
    return Response.json(stored && { version: 1, ...stored, readOnly: false });
  const body = JSON.parse(String(init.body));
  puts.push(body);
  stored = { data: body.data, etag: `e${puts.length}` };
  return Response.json({ version: 1, ...stored, readOnly: false });
}

async function flush() {
  for (let i = 0; i < 10; i++)
    await act(async () => new Promise((r) => setTimeout(r, 0)));
}

beforeEach(async () => {
  stored = null;
  puts = [];
  failLoad = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) =>
      serve(url, init),
    ),
  );
  const [
    { loadClientModules },
    { clientModules },
    { Panels },
    { ConfirmPanel },
    { useSettings },
    registry,
  ] = await Promise.all([
    client("modules/host.ts"),
    load("../../index.client.ts"),
    client("shell/panels.tsx"),
    client("components/ConfirmPanel.tsx"),
    client("settings.ts"),
    client("commands/registry.ts"),
  ]);
  runCommand = registry.runCommand;
  useSettings.setState((s: { resolved: object }) => ({
    resolved: {
      ...s.resolved,
      "units.length": { value: "in", source: "user" },
    },
  }));
  unload = await loadClientModules(clientModules, async () => [
    {
      id: "rockett.cam",
      name: "CAM",
      version: "0.1.0",
      licence: "UNLICENSED",
      author: "Rockett",
      status: "loaded",
      error: null,
    },
  ]);
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () =>
    root.render(h(Fragment, null, h(Panels), h(ConfirmPanel))),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  unload();
  vi.unstubAllGlobals();
});

const panelTitled = (title: string) =>
  [...host.querySelectorAll(".dialog-panel")].find(
    (p) => p.querySelector(".dialog-title span")?.textContent === title,
  );

const button = (panel: Element, label: string) =>
  [...panel.querySelectorAll("button")].find(
    (b) => b.getAttribute("aria-label") === label || b.textContent === label,
  ) as HTMLButtonElement;

const field = (panel: Element, label: string) =>
  [...panel.querySelectorAll("label.field")].find(
    (l) => l.querySelector("span")?.textContent === label,
  )!;

const setValue = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  "value",
)!.set!;

async function type(panel: Element, label: string, text: string) {
  const input = field(panel, label).querySelector("input")!;
  await act(async () => {
    input.dispatchEvent(new FocusEvent("focus"));
    setValue.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function choose(panel: Element, label: string, value: string) {
  const select = field(panel, label).querySelector("select")!;
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

async function click(panel: Element, label: string) {
  await act(async () => button(panel, label).click());
  await flush();
}

const rows = () =>
  [...panelTitled("Library")!.querySelectorAll(".tree-item > span")].map(
    (s) => s.textContent,
  );

async function openLibrary() {
  await act(async () => void runCommand("rockett.cam.library"));
  await flush();
  return panelTitled("Library")!;
}

const flat: Tool = {
  id: "t1",
  name: "6 mm flat",
  kind: "flat",
  diameter: 6,
  fluteLength: 20,
  overallLength: 50,
  shankDiameter: 6,
  flutes: 2,
  centreCutting: true,
};

it("a diameter entered in inch is stored in mm", async () => {
  const library = await openLibrary();
  expect(library.querySelector(".tree-header")?.textContent).toBe("Tools");
  expect(library.textContent).toContain("No tools yet.");

  await click(library, "Add tool");
  const form = panelTitled("Tool 1")!;
  expect(
    [...form.querySelectorAll(".field span")].map((s) => s.textContent),
  ).toEqual([
    "Kind",
    "Diameter (in)",
    "Flute length (in)",
    "Overall length (in)",
    "Shank diameter (in)",
    "Flutes",
    "Centre cutting",
  ]);
  await type(form, "Diameter (in)", "0.25");
  await click(form, "OK");

  expect(puts).toHaveLength(1);
  expect(puts[0]!.etag).toBeNull();
  expect(puts[0]!.data).toHaveLength(1);
  expect(puts[0]!.data[0]!.diameter).toBeCloseTo(6.35, 9);
  expect(puts[0]!.data[0]).toMatchObject({ name: "Tool 1", kind: "flat" });
  expect(panelTitled("Tool 1")).toBeUndefined();
  expect(rows()).toEqual(["Tool 1"]);
});

it("edits a library tool with the etag of the last read", async () => {
  stored = { data: [flat], etag: "e0" };
  const library = await openLibrary();
  expect(rows()).toEqual(["6 mm flat"]);

  await click(library, "Edit 6 mm flat");
  const form = panelTitled("6 mm flat")!;
  await choose(form, "Kind", "vbit");
  expect(field(form, "Tip angle (°)")).toBeDefined();
  await type(form, "Tip angle (°)", "60");
  await click(form, "OK");

  expect(puts).toEqual([
    { data: [{ ...flat, kind: "vbit", tipAngle: 60 }], etag: "e0" },
  ]);
  await click(panelTitled("Library")!, "Edit 6 mm flat");
  await choose(panelTitled("6 mm flat")!, "Kind", "flat");
  await click(panelTitled("6 mm flat")!, "OK");
  expect(puts[1]).toEqual({ data: [flat], etag: "e1" });
});

it("deletes a tool only after ui.confirm says OK", async () => {
  stored = { data: [flat], etag: "e0" };
  const library = await openLibrary();

  await click(library, "Delete 6 mm flat");
  const confirm = panelTitled("Confirm")!;
  expect(confirm.textContent).toContain("Delete 6 mm flat from your library?");
  await click(confirm, "Cancel");
  expect(puts).toEqual([]);
  expect(rows()).toEqual(["6 mm flat"]);

  await click(panelTitled("Library")!, "Delete 6 mm flat");
  await click(panelTitled("Confirm")!, "OK");
  expect(puts).toEqual([{ data: [], etag: "e0" }]);
  expect(panelTitled("Library")!.textContent).toContain("No tools yet.");
});

it("says why the tools did not load", async () => {
  failLoad = true;
  const library = await openLibrary();
  expect(library.querySelector('[role="alert"]')?.textContent).toMatch(
    /^Tools did not load: .+\.$/,
  );
  expect(button(library, "Add tool")).toBeUndefined();
});
