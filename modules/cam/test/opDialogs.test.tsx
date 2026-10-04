import { act, createElement as h } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import type {
  CadDocument,
  FaceRef,
  ModuleFiles,
  RouteModuleApi,
  ServerBody,
  User,
} from "@rockett/plugin-api";
import cam from "../server.js";
import { newSetup } from "../src/client/setup.js";
import {
  CAM_EXTENSION,
  isCamData,
  type CamData,
} from "../src/shared/document.js";
import { contourParams, paramsOf, pocketParams } from "../src/shared/params.js";
import type { Preset, Tool } from "../src/shared/tools.js";

const load = (path: string) => import(path);

const client = (file: string) => load(`../../../client/src/${file}`);

const SIGN = "/projects/:id/m/rockett/cam/bodies/:bodyId/faces/:faceName/sig";
const STATUS = "/projects/:id/m/rockett/cam/setups/:setupId/status";
const SAVE = "/projects/:id/m/rockett/cam";

const FACE_NAME = "f:plate/top ?#%&+~1";

const bbox: ServerBody["bbox"] = { min: [0, 0, 0], max: [40, 20, 5] };

const sig = { type: "plane", point: [20, 10, 5], direction: [0, 0, 1] };

const flat: Tool = {
  id: "lib-flat",
  name: "6 mm flat",
  kind: "flat",
  diameter: 6,
  fluteLength: 20,
  overallLength: 50,
  shankDiameter: 6,
  flutes: 2,
  centreCutting: true,
};

const ball: Tool = { ...flat, id: "lib-ball", name: "6 mm ball", kind: "ball" };

const preset: Preset = {
  id: "lib-preset",
  name: "MDF",
  rpm: 18000,
  cutFeed: 1000,
  plungeFeed: 300,
  rampFeed: 500,
  stepdown: 1,
  stepoverFraction: 0.4,
  coolant: "off",
};

const mark: User = {
  id: "u1",
  username: "mark",
  displayName: "Mark",
  role: "admin",
  status: "active",
  createdAt: "2026-10-04T00:00:00.000Z",
  modifiedAt: "2026-10-04T00:00:00.000Z",
};

type Handler = (doc: CadDocument, req: unknown, ctx: unknown) => Promise<any>;

const routes = new Map<string, Handler>();
let signed: FaceRef[][] = [];
let saved: CadDocument;
let library: { tools: Tool[] | null; presets: Preset[] | "fail" };
let host: HTMLElement;
let root: Root;
let unload = () => {};
let runCommand: (id: string) => unknown;
let useStore: any;
let initial: unknown;

const files: ModuleFiles = {
  read: async () => null,
  write: async () => {},
  remove: async () => {},
  list: async () => [],
};

const serverBody: ServerBody = {
  id: "b1",
  name: "Plate",
  bbox,
  brep: "",
  faceNames: [FACE_NAME],
  fingerprint: "a".repeat(64),
};

beforeAll(async () => {
  const keep = (route: { path: string }, handler: unknown) =>
    routes.set(route.path, handler as Handler);
  const api: RouteModuleApi = {
    projectRoute: keep,
    projectMutation: keep,
    userRoute: () => {},
  };
  await cam.activate({
    register: {
      routeModule: (module) => {
        module.mount(api);
        return () => {};
      },
      kernelJob: () => () => {},
    },
    startKernelJob: async () => {
      throw new Error("no job runs here");
    },
    userData: () => ({ read: async () => null, write: async () => null! }),
    files,
    kernelVersion: null,
    bodies: async () => [serverBody],
    signFaces: async (_id, _user, refs) => {
      signed.push([...refs]);
      return refs.map((ref) => ({ ...ref, sig }) as never);
    },
  });
});

const entry = (data: unknown[] | null) =>
  Response.json(data && { version: 1, data, etag: "e1", readOnly: false });

const evaluation = {
  bodies: [
    {
      bodyId: "b1",
      name: "Plate",
      meshKey: "b1-mesh",
      positions: [],
      normals: [],
      indices: [],
      faces: [],
      edges: [],
      vertices: [],
      bbox,
    },
  ],
  featureStatuses: [],
  sketches: [],
  planes: [],
  kernelMs: 0,
};

const history = { entries: [], position: 0, checkpoints: [] };

async function serve(url: RequestInfo | URL, init: RequestInit = {}) {
  const [path] = String(url)
    .replace(/^\/api/, "")
    .split("?");
  const method = init.method ?? "GET";
  const sign =
    /^\/projects\/p1\/m\/rockett\/cam\/bodies\/([^/]+)\/faces\/([^/]+)\/sig$/.exec(
      path!,
    );
  if (method === "GET" && sign)
    return Response.json(
      await routes.get(SIGN)!(
        saved,
        {
          params: {
            id: "p1",
            bodyId: decodeURIComponent(sign[1]!),
            faceName: decodeURIComponent(sign[2]!),
          },
        },
        { user: mark },
      ),
    );
  if (method === "GET" && path === "/m/rockett/cam/tools")
    return entry(library.tools);
  if (method === "GET" && path === "/m/rockett/cam/presets")
    return library.presets === "fail"
      ? Response.json({ error: "disk unavailable" }, { status: 500 })
      : entry(library.presets);
  if (method === "GET" && path === "/projects/p1")
    return Response.json({ document: saved, access: "edit" });
  if (method === "GET" && path === "/projects/p1/view")
    return Response.json(
      (await load("../../../shared/src/api.ts")).emptyView(),
    );
  if (method === "POST" && path === "/projects/p1/evaluate")
    return Response.json(evaluation);
  if (method === "GET" && path === "/projects/p1/history")
    return Response.json(history);
  if (method === "PUT" && path === "/projects/p1/m/rockett/cam") {
    const body = JSON.parse(String(init.body));
    const doc = structuredClone(saved);
    await routes.get(SAVE)!(
      doc,
      { params: { id: "p1" }, body },
      { user: mark },
    );
    saved = { ...doc, revision: saved.revision + 1 };
    return Response.json({
      document: saved,
      evaluation,
      history: {
        canUndo: true,
        canRedo: false,
        undoLabel: "Edit CAM data",
        redoLabel: null,
      },
    });
  }
  throw new Error(`${method} ${path}`);
}

const fetchMock = vi.fn(serve);

async function flush() {
  for (let i = 0; i < 10; i++)
    await act(async () => new Promise((r) => setTimeout(r, 0)));
}

const project = {
  projectId: "p1",
  document: null,
  bodies: [{ id: "b1", name: "Plate", bbox }],
};

beforeEach(async () => {
  const { createEmptyDocument } = await load(
    "../../../shared/src/documents.ts",
  );
  const setup = newSetup(project as never);
  saved = {
    ...createEmptyDocument("p1", "Plate"),
    revision: 4,
    extensions: {
      [CAM_EXTENSION]: { version: 1, data: { setups: [setup], tools: [] } },
    },
  };
  signed = [];
  library = { tools: [flat, ball], presets: [preset] };
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
  const [
    { loadClientModules },
    { clientModules },
    { Panels },
    registry,
    store,
  ] = await Promise.all([
    client("modules/host.ts"),
    load("../../index.client.ts"),
    client("shell/panels.tsx"),
    client("commands/registry.ts"),
    client("store.ts"),
  ]);
  runCommand = registry.runCommand;
  useStore = store.useStore;
  initial = useStore.getState();
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
  await useStore.getState().openProject("p1");
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root.render(h(Panels)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  unload();
  useStore.setState(initial, true);
  vi.unstubAllGlobals();
});

const panelTitled = (title: string) =>
  [...host.querySelectorAll(".dialog-panel")].find(
    (p) => p.querySelector(".dialog-title span")?.textContent === title,
  );

const fieldLabels = (panel: Element) =>
  [...panel.querySelectorAll("label.field > span:first-child")].map(
    (s) => s.textContent,
  );

const field = (panel: Element, label: string) =>
  [...panel.querySelectorAll("label.field")]
    .find((l) => l.textContent?.startsWith(label))!
    .querySelector("input")!;

const toolSelect = (panel: Element) =>
  [...panel.querySelectorAll("label.field")]
    .find((l) => l.textContent?.startsWith("Tool"))!
    .querySelector("select")!;

const hints = (panel: Element) =>
  [...panel.querySelectorAll(".field-hint")].map((s) => s.textContent);

const ok = (panel: Element) =>
  [...panel.querySelectorAll("button")].find((b) => b.textContent === "OK")!;

const setValue = Object.getOwnPropertyDescriptor(
  HTMLInputElement.prototype,
  "value",
)!.set!;

async function type(input: HTMLInputElement, text: string) {
  await act(async () => {
    input.dispatchEvent(new FocusEvent("focus"));
    setValue.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const selectFace = (faceName: string) =>
  act(async () =>
    useStore.setState({
      selection: [{ kind: "face", bodyId: "b1", faceName }],
    }),
  );

async function open(label: string, command: string) {
  await act(async () => void runCommand(command));
  await flush();
  return panelTitled(label)!;
}

const titles = (schema: typeof contourParams | typeof pocketParams) =>
  Object.values(schema.properties).map(
    (property) => (property as { title?: string }).title,
  );

it("contour and pocket each open a dialog built from its schema", async () => {
  for (const [label, command, schema, labels] of [
    [
      "Contour",
      "rockett.cam.contour",
      contourParams,
      ["Face", "Side", "Bottom offset (mm)"],
    ],
    ["Pocket", "rockett.cam.pocket", pocketParams, ["Floor", "Ramp angle (°)"]],
  ] as const) {
    expect(panelTitled(label)).toBeUndefined();
    const panel = await open(label, command);
    expect(titles(schema)).toEqual(labels.map((l) => l.split(" (")[0]));
    expect(fieldLabels(panel)).toEqual(["Setup", "Tool", "Preset", ...labels]);
    expect(
      [...toolSelect(panel).querySelectorAll("option")].map(
        (o) => o.textContent,
      ),
    ).toEqual(["6 mm flat"]);
    expect(field(panel, labels[0]).disabled).toBe(true);
    await act(async () =>
      [...panel.querySelectorAll("button")]
        .find((b) => b.textContent === "Cancel")!
        .click(),
    );
    expect(panelTitled(label)).toBeUndefined();
  }
});

it("with no face selected Save is blocked with text, and the face field takes the selection", async () => {
  const panel = await open("Contour", "rockett.cam.contour");
  expect(field(panel, "Face").value).toBe("");
  expect(hints(panel)).toEqual([
    "Enter a value",
    "Select a face in the viewport.",
  ]);
  expect(ok(panel).disabled).toBe(true);
  await act(async () => ok(panel).click());
  expect(signed).toEqual([]);

  await selectFace("f:plate:side:1");
  expect(field(panel, "Face").value).toBe("Plate f:plate:side:1");
  expect(hints(panel)).toEqual(["Enter a value"]);
  expect(ok(panel).disabled).toBe(true);
  await type(field(panel, "Bottom offset"), "0.5");
  expect(hints(panel)).toEqual([]);
  expect(ok(panel).disabled).toBe(false);

  await act(async () => useStore.setState({ selection: [] }));
  expect(field(panel, "Face").value).toBe("Plate f:plate:side:1");
});

it("with a face selected Save signs it and stores an operation that passes paramsOf", async () => {
  await selectFace(FACE_NAME);
  const panel = await open("Pocket", "rockett.cam.pocket");
  expect(field(panel, "Floor").value).toBe(`Plate ${FACE_NAME}`);
  await type(field(panel, "Ramp angle"), "3");
  const before = saved.revision;
  await act(async () => ok(panel).click());
  await flush();

  expect(signed).toEqual([
    [{ kind: "face", bodyId: "b1", faceName: FACE_NAME }],
  ]);
  const signCall = fetchMock.mock.calls.find(([url]) =>
    String(url).includes("/sig"),
  )!;
  expect(String(signCall[0])).toContain(
    `/faces/${encodeURIComponent(FACE_NAME)}/sig`,
  );
  expect(saved.revision).toBe(before + 1);
  expect(panelTitled("Pocket")).toBeUndefined();
  const data = saved.extensions[CAM_EXTENSION]!.data as CamData;
  expect(isCamData(data)).toBe(true);
  const [tool] = data.tools;
  expect(tool).toEqual({
    ...flat,
    id: tool!.id,
    libraryRef: { id: flat.id },
    number: 1,
    presets: [preset],
  });
  expect(tool!.id).not.toBe(flat.id);
  const [setup] = data.setups;
  const [op] = setup!.operations!;
  expect(op).toMatchObject({
    type: "rockett.cam.pocket",
    name: "Pocket 1",
    toolId: tool!.id,
    presetId: preset.id,
  });
  expect(paramsOf(pocketParams, op!.type!, op!.params)).toEqual({
    floor: { kind: "face", bodyId: "b1", faceName: FACE_NAME, sig },
    rampAngle: 3,
  });

  const status = await routes.get(STATUS)!(
    saved,
    { params: { id: "p1", setupId: setup!.id } },
    { user: mark },
  );
  expect(status).toEqual({ [op!.id]: { status: "never" } });
});

it("states empty and error text for its lists", async () => {
  library = { tools: null, presets: "fail" };
  await selectFace("f:plate:side:1");
  const panel = await open("Contour", "rockett.cam.contour");
  expect(hints(panel)).toContain("No tool in your library can cut a contour.");
  expect(panel.querySelector(".error-banner")?.textContent).toBe(
    "Presets did not load: HTTP 500.",
  );
  expect(ok(panel).disabled).toBe(true);
});
