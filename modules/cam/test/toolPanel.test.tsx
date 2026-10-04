import { act, createElement as h, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MAX_SETTINGS_TEXT } from "../src/import/grblSettings.js";
import type { MachineProfile } from "../src/shared/machine.js";
import type { Tool } from "../src/shared/tools.js";

const load = (path: string) => import(path);

const client = (file: string) => load(`../../../client/src/${file}`);

const TOOLS = "/api/m/rockett/cam/tools";
const MACHINES = "/api/m/rockett/cam/machines";

let stored: { data: Tool[]; etag: string } | null;
let puts: { data: Tool[]; etag: string | null }[];
let failLoad: boolean;
let machines: { data: MachineProfile[]; etag: string } | null;
let machinePuts: { data: MachineProfile[]; etag: string | null }[];
let host: HTMLElement;
let root: Root;
let unload = () => {};
let runCommand: (id: string) => unknown;

function serveMachines(method: string, init: RequestInit) {
  if (method === "GET")
    return Response.json(
      machines && { version: 1, ...machines, readOnly: false },
    );
  const body = JSON.parse(String(init.body));
  machinePuts.push(body);
  machines = { data: body.data, etag: `m${machinePuts.length}` };
  return Response.json({ version: 1, ...machines, readOnly: false });
}

function serve(url: RequestInfo | URL, init: RequestInit = {}) {
  const method = init.method ?? "GET";
  if (String(url) === MACHINES) return serveMachines(method, init);
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
  machines = null;
  machinePuts = [];
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
  expect(library.querySelector('[role="alert"]')).toBeNull();

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

it("adds and saves a machine through the panel", async () => {
  const library = await openLibrary();
  expect(library.textContent).toContain("No machines yet.");

  await click(library, "Add machine");
  const form = panelTitled("Machine 1")!;
  await choose(form, "Firmware", "grblhal");
  await type(form, "X max (in)", "10");
  await click(form, "OK");

  expect(puts).toEqual([]);
  expect(machinePuts).toHaveLength(1);
  expect(machinePuts[0]!.etag).toBeNull();
  expect(machinePuts[0]!.data).toHaveLength(1);
  expect(machinePuts[0]!.data[0]!.xMax).toBeCloseTo(254, 9);
  expect(machinePuts[0]!.data[0]).toMatchObject({
    name: "Machine 1",
    firmware: "grblhal",
    post: "grblhal",
    toolChange: "perFile",
  });
  expect(panelTitled("Machine 1")).toBeUndefined();
  expect(rows()).toEqual(["Machine 1"]);
});

const router: MachineProfile = {
  id: "m1",
  name: "Router",
  firmware: "grbl",
  post: "grbl",
  xMin: 0,
  xMax: 300,
  yMin: 0,
  yMax: 300,
  zMin: -80,
  zMax: 0,
  maxFeedX: 3000,
  maxFeedY: 3000,
  maxFeedZ: 1000,
  rpmMin: 0,
  rpmMax: 24000,
  toolChange: "perFile",
  units: "mm",
};

const dump = [
  "$11=0.010",
  "$30=24000.",
  "$31=0.",
  "$32=0",
  "$110=5000.000",
  "$111=5000.000",
  "$112=1500.000",
  "$120=400.000",
  "$121=400.000",
  "ok",
].join("\r\n");

const setText = Object.getOwnPropertyDescriptor(
  HTMLTextAreaElement.prototype,
  "value",
)!.set!;

async function paste(panel: Element, text: string) {
  await click(panel, "Import $$");
  const area = field(panel, "$$ output").querySelector("textarea")!;
  await act(async () => {
    setText.call(area, text);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return area;
}

const shown = (panel: Element, label: string) =>
  field(panel, label).querySelector("input")!.value;

const listed = (panel: Element) =>
  [...panel.querySelectorAll(".tree-item > span")].map((s) => s.textContent);

async function editRouter(machine: MachineProfile) {
  machines = { data: [machine], etag: "m0" };
  await click(await openLibrary(), "Edit Router");
  return panelTitled("Router")!;
}

it("a pasted $$ missing $122 fills $110 and lists $122", async () => {
  const form = await editRouter(router);
  expect(shown(form, "Acceleration Z (mm/s^2)")).toBe("");
  await paste(form, dump);
  await click(form, "Fill from $$");

  expect(form.querySelector('[role="alert"]')).toBeNull();
  expect(listed(form)).toEqual(["$122"]);
  expect(shown(form, "Max feed X (mm/min)")).toBe("5000");
  await click(form, "OK");
  const saved = machinePuts[0]!.data[0]!;
  expect(saved).toMatchObject({
    maxFeedX: 5000,
    accelX: 400,
    laserMode: false,
  });
  expect(saved).not.toHaveProperty("accelZ");
});

it("refuses a $$ with $30 below the stored minimum", async () => {
  const form = await editRouter({ ...router, rpmMin: 10000 });
  await paste(form, "$30=5000.\n$110=5000.000\n");
  await click(form, "Fill from $$");

  expect(form.querySelector('[role="alert"]')?.textContent).toBe(
    "$$ import refused: max spindle speed must be at least the min.",
  );
  expect(shown(form, "Max feed X (mm/min)")).toBe("3000");
  await click(form, "OK");
  expect(machinePuts[0]!.data[0]).toEqual({ ...router, rpmMin: 10000 });
});

it("saves a cleared optional limit as unset", async () => {
  const form = await editRouter({ ...router, accelX: 400 });
  expect(shown(form, "Acceleration X (mm/s^2)")).toBe("400");
  await type(form, "Acceleration X (mm/s^2)", "");
  await click(form, "OK");
  expect(machinePuts[0]!.data[0]).toEqual(router);
});

it("cuts a paste over the $$ cap and says so", async () => {
  const form = await editRouter(router);
  const area = await paste(form, "x".repeat(MAX_SETTINGS_TEXT + 10));
  expect(area.value).toHaveLength(MAX_SETTINGS_TEXT);
  expect(form.querySelector('[role="alert"]')?.textContent).toBe(
    `Cut to the ${MAX_SETTINGS_TEXT} character limit`,
  );
});
