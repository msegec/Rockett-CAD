import { promises as fs } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  CadDocument,
  OpenProject,
  ProjectView,
} from "@rockett/plugin-api";
import { CAM_EXTENSION, migrateCam } from "../src/shared/document.js";
import { newSetup, saveSetup } from "../src/client/setup.js";

const core = (file: string) =>
  import(new URL(`../../../server/src/${file}`, import.meta.url).href);

const bodies = [
  { id: "b1", name: "Plate", bbox: { min: [0, 0, 0], max: [40, 20, 5] } },
] satisfies OpenProject["bodies"];

const preSetupData = {
  setups: [{ id: "s1", name: "Setup 1" }],
  tools: [{ id: "t1", diameter: 6 }],
};

let dataDir = "";
let origin = "";
let cookie = "";
let store: any;
let ownerId = "";
let server: http.Server;
let unload = () => {};

const request = (at: string, init: RequestInit = {}) =>
  fetch(`${origin}/api${at}`, {
    ...init,
    headers: {
      Origin: origin,
      Cookie: cookie,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

const load = async (id: string): Promise<CadDocument> =>
  (await (await request(`/projects/${id}`)).json()).document;

const historyLength = async (id: string): Promise<number> =>
  (await (await request(`/projects/${id}/history`)).json()).entries.length;

async function projectView(id: string): Promise<ProjectView> {
  let open: OpenProject = {
    projectId: id,
    document: await load(id),
    bodies,
  };
  return {
    get: () => open,
    subscribe: () => () => {},
    async mutate(route, body) {
      const res = await request(route.path.replace(":id", id), {
        method: route.method,
        headers: { "If-Match": `"${open.document!.revision}"` },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
      open = { ...open, document: (await res.json()).document };
    },
  };
}

beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-cam-setup-"));
  const [
    { createApp },
    { ProjectStore },
    { validateDocument },
    { FolderStore },
    { LocalStorage },
    { InProcessKernel },
    { SessionStore },
    { UserStore },
    { cookieConfig },
    { loadModules },
    { serverModules },
  ] = await Promise.all([
    core("app.ts"),
    core("store/projectStore.ts"),
    core("api/validate.ts"),
    core("store/folderStore.ts"),
    core("store/storage.ts"),
    core("kernel/client.ts"),
    core("auth/sessions.ts"),
    core("auth/userStore.ts"),
    core("auth/cookie.ts"),
    core("modules/host.ts"),
    import(new URL("../../index.server.ts", import.meta.url).href),
  ]);
  const storage = new LocalStorage(dataDir, fs);
  store = new ProjectStore(storage, validateDocument);
  unload = await loadModules(
    serverModules,
    new InProcessKernel({ sources: async () => new Map() }),
    storage,
  );
  const users = new UserStore(storage);
  const sessions = await SessionStore.open(storage);
  const owner = await users.create({
    username: "mark",
    displayName: "Mark",
    role: "admin",
    passwordHash: "scrypt$test",
  });
  ownerId = owner.id;
  const config = cookieConfig(undefined);
  cookie = `${config.name}=${await sessions.create(owner.id)}`;
  server = http.createServer();
  await new Promise<void>((done) => server.listen(0, "localhost", done));
  origin = `http://localhost:${(server.address() as AddressInfo).port}`;
  const { app } = await createApp({
    store,
    folders: new FolderStore(storage),
    kernel: new InProcessKernel(store),
    allowedOrigins: [origin],
    users,
    sessions,
    cookie: config,
  });
  server.on("request", app);
}, 120_000);

afterAll(async () => {
  unload();
  await new Promise((done) => server?.close(done));
  await fs.rm(dataDir, { recursive: true, force: true });
});

async function project(data?: unknown): Promise<CadDocument> {
  const doc = await store.create("Plate", ownerId);
  if (data === undefined) return doc;
  doc.extensions = { [CAM_EXTENSION]: { version: 1, data } };
  await store.save(doc, ownerId);
  return doc;
}

describe("setup dialog save", () => {
  it("adds exactly one history entry holding the dialog's setup", async () => {
    const doc = await project();
    const view = await projectView(doc.id);
    const before = await historyLength(doc.id);
    const setup = newSetup(view.get());
    await saveSetup(view, setup);
    expect(await historyLength(doc.id)).toBe(before + 1);
    expect(setup).toMatchObject({
      name: "Setup 1",
      bodies: ["b1"],
      stock: { kind: "boxAround" },
      wcs: {
        origin: { kind: "stockCorner", x: "min", y: "min", z: "max" },
        offsetIndex: 1,
      },
    });
    expect((await load(doc.id)).extensions[CAM_EXTENSION]).toEqual({
      version: 1,
      data: { setups: [setup], tools: [] },
    });
  });

  it("loads a v1 document saved before setup fields unchanged and keeps it on save", async () => {
    const doc = await project(preSetupData);
    const loaded = await load(doc.id);
    expect(migrateCam(loaded.extensions[CAM_EXTENSION])).toEqual({
      status: "ready",
      data: preSetupData,
    });
    const view = await projectView(doc.id);
    const before = await historyLength(doc.id);
    const setup = newSetup(view.get());
    expect(setup.name).toBe("Setup 2");
    await saveSetup(view, setup);
    expect(await historyLength(doc.id)).toBe(before + 1);
    expect((await load(doc.id)).extensions[CAM_EXTENSION]).toEqual({
      version: 1,
      data: { ...preSetupData, setups: [...preSetupData.setups, setup] },
    });
  });
});
