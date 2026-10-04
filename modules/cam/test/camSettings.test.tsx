import { act, createElement as h, Fragment } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MachineProfile } from "../src/shared/machine.js";
import {
  client,
  fetchMock,
  flush,
  host,
  mine,
  open,
  root,
  router,
  runCommand,
  saved,
  serve,
} from "./helpers/camClient.js";

const MACHINES = "/api/m/rockett/cam/machines";

const mill: MachineProfile = { ...router, id: "m2", name: "Mill" };

let machines: { data: MachineProfile[]; etag: string };
let machinePuts: { data: MachineProfile[]; etag: string | null }[];
let patches: unknown[];
let userValues: Record<string, unknown>;
let settings: any;

beforeEach(async () => {
  machines = { data: [router, mill], etag: "m0" };
  machinePuts = [];
  patches = [];
  userValues = {};
  fetchMock.mockImplementation(async (url, init = {}) => {
    if (String(url) !== MACHINES) return serve(url, init);
    if ((init.method ?? "GET") === "GET")
      return Response.json({ version: 1, ...machines, readOnly: false });
    const body = JSON.parse(String(init.body));
    machinePuts.push(body);
    machines = { data: body.data, etag: `m${machinePuts.length}` };
    return Response.json({ version: 1, ...machines, readOnly: false });
  });
  const [
    { Panels },
    { ConfirmPanel },
    { SettingsButton },
    { settingsApi },
    { useSession },
    store,
  ] = await Promise.all([
    client("shell/panels.tsx"),
    client("components/ConfirmPanel.tsx"),
    client("components/SettingsPanel.tsx"),
    client("settingsApi.ts"),
    client("session.ts"),
    client("settings.ts"),
  ]);
  settings = store;
  useSession.setState({
    kind: "signed-in",
    user: { id: "u1", username: "mark", role: "admin", status: "active" },
  });
  vi.spyOn(settingsApi, "getAppSettings").mockResolvedValue({
    values: {},
    version: '"a"',
  });
  vi.spyOn(settingsApi, "getUserSettings").mockImplementation(async () => ({
    values: userValues,
    version: '"u"',
  }));
  vi.spyOn(settingsApi, "patchUserSettings").mockImplementation(
    async (patch: any) => {
      patches.push(patch);
      userValues = { ...userValues, ...patch.set };
      return { values: userValues, version: `"u${patches.length}"` };
    },
  );
  await settings.loadAppSettings();
  await settings.loadUserSettings();
  await act(async () =>
    root.render(
      h(Fragment, null, h(Panels), h(SettingsButton), h(ConfirmPanel)),
    ),
  );
});

afterEach(() => {
  settings.clearSettings();
  vi.restoreAllMocks();
});

const settingsPanel = () => host.querySelector(".settings-panel")!;

const heading = () =>
  settingsPanel().querySelector(".settings-heading h2")?.textContent;

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

async function openMachines() {
  await act(async () => void runCommand("rockett.cam.library"));
  await flush();
  return settingsPanel();
}

it("the Library command opens Settings at CAM, Machines and no Library panel exists", async () => {
  const panel = await openMachines();
  expect(heading()).toBe("Machines");
  const nav = [...panel.querySelectorAll("nav button")].map(
    (b) => b.textContent,
  );
  const cam = nav.indexOf("CAM");
  expect(nav.slice(cam, cam + 4)).toEqual([
    "CAM",
    "Machines",
    "Posts",
    "Tools",
  ]);
  expect(button(panel, "Machines").className).toBe("active");
  expect(button(panel, "Machines").closest(".tree-children")).toBeTruthy();
  expect(
    [...host.querySelectorAll(".dialog-panel")].map((p) => p.className),
  ).toEqual(["dialog-panel settings-panel"]);
  await act(async () =>
    (await client("shell/panels.tsx")).openPanel("rockett.cam.library.panel"),
  );
  expect(host.querySelectorAll(".dialog-panel")).toHaveLength(1);
});

it("renames a machine, makes it a laser and gives it a user post, each saved through the library", async () => {
  const panel = await openMachines();
  await click(panel, "Edit Router");
  await type(panel, "Name", "Shop router");
  await click(panel, "OK");
  expect(machinePuts[0]).toEqual({
    data: [{ ...router, name: "Shop router" }, mill],
    etag: "m0",
  });

  await click(panel, "Edit Shop router");
  await choose(panel, "Kind", "laser");
  expect(button(panel, "OK").disabled).toBe(true);
  expect(panel.textContent).toContain("a laser needs its maximum power S");
  await type(panel, "Max laser power (S)", "1000");
  await type(panel, "Focus Z (mm)", "2.5");
  await click(panel, "OK");
  expect(machinePuts[1]!.etag).toBe("m1");
  expect(machinePuts[1]!.data[0]).toEqual({
    ...router,
    name: "Shop router",
    kind: "laser",
    laserPowerMax: 1000,
    focusZ: 2.5,
  });

  await click(panel, "Edit Shop router");
  const posts = [
    ...field(panel, "Default post").querySelectorAll("option"),
  ].map((o) => [o.value, o.textContent]);
  expect(posts).toContainEqual(["grbl", "GRBL 1.1"]);
  expect(posts.at(-1)).toEqual([mine.id, "My GRBL (unqualified)"]);
  await choose(panel, "Default post", mine.id);
  await click(panel, "OK");
  expect(machinePuts[2]!.etag).toBe("m2");
  expect(machinePuts[2]!.data[0]!.post).toBe(mine.id);
});

it("the Posts page shows each post read only and sets one as a machine's default", async () => {
  const panel = await openMachines();
  await click(panel, "Posts");
  expect(heading()).toBe("Posts");
  const grbl = [...panel.querySelectorAll(".tree-section")].find((s) =>
    s.querySelector(".tree-header")?.textContent?.startsWith("GRBL 1.1"),
  )!;
  expect(
    [...grbl.querySelectorAll(".tree-item")].map((r) =>
      [...r.querySelectorAll("span")].map((s) => s.textContent),
    ),
  ).toEqual([
    ["Id", "grbl"],
    ["Units", "mm, inch"],
    ["Capabilities", "Arcs, Laser"],
  ]);
  expect(grbl.querySelector(".tree-header .dimmed")?.textContent).toBe(
    "Default for Router",
  );
  expect(button(panel, "Delete GRBL 1.1")).toBeUndefined();
  expect(button(panel, "Delete My GRBL")).toBeDefined();
  expect(button(panel, "Import post")).toBeDefined();
  expect(button(panel, "Download post kit")).toBeDefined();

  await choose(panel, "Machine", "m2");
  await click(panel, "Make My GRBL the default post for Mill");
  expect(machinePuts).toEqual([
    { data: [router, { ...mill, post: mine.id }], etag: "m0" },
  ]);
  expect(button(panel, "Make My GRBL the default post for Mill")).toBe(
    undefined,
  );
});

it("a new setup takes the default safe height and clearance, and NC Program starts at the default machine", async () => {
  const panel = await openMachines();
  const marked = () =>
    [...panel.querySelectorAll(".tree-item .dimmed")].map((s) => [
      s.parentElement!.firstChild!.textContent,
      s.textContent,
    ]);
  expect(marked()).toEqual([["Router", "Default"]]);
  await click(panel, "Make Mill the default machine");
  expect(marked()).toEqual([["Mill", "Default"]]);
  await click(panel, "CAM");
  await type(panel, "Default safe height (mm)", "22");
  await type(panel, "Default clearance (mm)", "4");
  await flush();
  expect(userValues).toEqual({
    "plugin.rockett.cam.defaultMachine": "m2",
    "plugin.rockett.cam.safeHeight": 22,
    "plugin.rockett.cam.clearance": 4,
  });
  await click(panel, "Close settings");

  const setup = await open("Setup 2", "rockett.cam.setup");
  await click(setup, "OK");
  const setups = (saved.extensions["rockett.cam"] as any).data.setups;
  expect(setups[1]).toMatchObject({ safeHeight: 22, clearance: 4 });

  const nc = await open("NC Program", "rockett.cam.nc");
  expect(field(nc, "Machine").querySelector("select")!.value).toBe("m2");
});
