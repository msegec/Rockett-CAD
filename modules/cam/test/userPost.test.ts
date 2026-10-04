import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse, type User } from "@rockett/shared";
import type {
  CadDocument,
  Route,
  RouteModuleApi,
  ServerBody,
  ModuleFiles,
  ServerContext,
  UserData,
} from "@rockett/plugin-api";
import cam from "../server.js";
import { POSTS } from "../src/server/posts.js";
import {
  CAM_EXTENSION,
  generateRoute,
  isCamData,
  migrateCam,
  ncRoute,
  POST_MAX_BYTES,
  saveCam,
  USER_POST_PREFIX,
  type CamData,
  type NcExport,
} from "../src/shared/document.js";
import { newMachine } from "../src/shared/machine.js";
import { fixture, golden, loadPost } from "./goldens.js";

type Handler = (body: unknown, doc?: CadDocument, params?: object) => any;

const mark: User = {
  id: "u1",
  username: "mark",
  displayName: "Mark",
  role: "admin",
  status: "active",
  createdAt: "2026-10-04T00:00:00.000Z",
  modifiedAt: "2026-10-04T00:00:00.000Z",
};

const grbl = loadPost("grbl");
const mine = { ...grbl, id: "my-grbl", label: "My GRBL" };
const userMine = { ...mine, id: "user.my-grbl" };
const copyOf = <T extends { id: string }>(post: T) => ({
  ...post,
  libraryRef: { id: post.id },
});
const contour = fixture("contour");
const tool = contour.tools[0]!;
const preset = {
  id: "p1",
  name: "MDF contour",
  rpm: 18000,
  cutFeed: 1000,
  plungeFeed: 300,
  rampFeed: 500,
  stepdown: 3,
  stepoverFraction: 0.5,
  coolant: "off" as const,
};

const body: ServerBody = {
  id: "b1",
  name: "Body 1",
  bbox: { min: [0, 0, -10], max: [40, 30, 0] } as ServerBody["bbox"],
  brep: "",
  faceNames: [],
  fingerprint: "f".repeat(64),
};

const setup = {
  id: "s1",
  name: "Setup 1",
  bodies: ["b1"],
  stock: {
    kind: "boxAround" as const,
    margins: { xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 0 },
  },
  wcs: {
    origin: {
      kind: "stockCorner" as const,
      x: "min" as const,
      y: "min" as const,
      z: "max" as const,
    },
    axes: { x: "+x" as const, z: "+z" as const },
    offsetIndex: 1,
    machine: { kind: "unknown" as const },
  },
  safeHeight: 15,
  clearance: 2,
  operations: [
    {
      id: "op1",
      type: "rockett.cam.contour",
      name: "Contour 1",
      toolId: "t1",
      presetId: "p1",
      params: {},
    },
  ],
};

const project = (setups: CamData["setups"]) =>
  ({
    name: "Bracket",
    extensions: {
      [CAM_EXTENSION]: {
        version: 2,
        data: { setups, tools: [{ ...tool, presets: [preset] }] },
      },
    },
  }) as unknown as CadDocument;

function memory(): ModuleFiles {
  const stored = new Map<string, Uint8Array>();
  return {
    read: async (name) => stored.get(name) ?? null,
    write: async (name, data) => {
      stored.set(
        name,
        typeof data === "string" ? new TextEncoder().encode(data) : data,
      );
    },
    remove: async (name) => {
      stored.delete(name);
    },
    list: async () => [...stored.keys()],
  };
}

const routes = new Map<string, Handler>();
let dataDir = "";
let posts: UserData;

const call = (method: string, at: string, ...rest: Parameters<Handler>) => {
  const handle = routes.get(`${method} ${at}`);
  if (!handle) throw new Error(`no route ${method} ${at}`);
  return handle(...rest);
};

const add = async (post: string) =>
  call("POST", "/m/rockett/cam/posts", {
    post,
    etag: (await posts.read(mark))?.etag ?? null,
  });

const nc = (doc: CadDocument, postId: string): Promise<NcExport> =>
  call("GET", ncRoute.path, undefined, doc, {
    machineId: "m1",
    postId,
    toolChange: "perFile",
    setupIds: "s1",
  });

const core = (file: string) =>
  import(new URL(`../../../server/src/${file}`, import.meta.url).href);

const value = (route: Route, input: unknown) =>
  route.body ? parse(route.body, JSON.parse(JSON.stringify(input))) : input;

beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "rockett-cam-posts-"));
  const [{ moduleUserData }, { LocalStorage }] = await Promise.all([
    core("store/moduleData.ts"),
    core("store/storage.ts"),
  ]);
  const userData: (name: string, version: number) => UserData = moduleUserData(
    new LocalStorage(dataDir, fs),
    "rockett.cam",
  );
  posts = userData("posts", 1);
  await userData("machines", 1).write(
    mark,
    [{ ...newMachine(0), id: "m1" }],
    null,
  );
  const mount =
    (route: Route, handle: any): Handler =>
    (input, doc, params) =>
      doc
        ? handle(
            doc,
            { params: { id: "p1", ...params }, body: value(route, input) },
            { user: mark },
          )
        : handle({ params: {}, body: value(route, input) }, { user: mark });
  const keep = (route: Route, handle: any) =>
    routes.set(`${route.method} ${route.path}`, mount(route, handle));
  const api: RouteModuleApi = {
    projectRoute: keep,
    projectMutation: keep,
    userRoute: keep,
  };
  const context: ServerContext = {
    register: {
      routeModule: (module) => {
        module.mount(api);
        return () => {};
      },
      kernelJob: () => () => {},
    },
    startKernelJob: async (_id, input) => {
      const { setup: s, operation } = input as {
        setup: { id: string };
        operation: { id: string };
      };
      const program = structuredClone(contour);
      program.setupId = s.id;
      for (const section of program.sections)
        section.operationId = operation.id;
      return program;
    },
    userData,
    files: memory(),
    kernelVersion: { occt: "7.9.1", commit: "abc1234" },
    signFaces: async () => [],
    bodies: async () => [body],
  };
  await cam.activate(context);
});

afterAll(() => fs.rm(dataDir, { recursive: true, force: true }));

describe("CAM user posts", () => {
  it("exports the GRBL golden from a setup's copy after the library copy is deleted", async () => {
    const saved = await add(JSON.stringify(mine));
    expect(saved).toMatchObject({ version: 1, data: [userMine] });
    expect(await call("GET", "/m/rockett/cam/posts", undefined)).toEqual(saved);
    const doc = project([{ ...setup, post: copyOf(userMine) }]);
    await call(
      "POST",
      generateRoute.path,
      { setupId: "s1", operationId: "op1" },
      doc,
    );
    await posts.write(mark, [], saved.etag);
    expect((await posts.read(mark))?.data).toEqual([]);
    const out = await nc(doc, "user.my-grbl");
    if (!("nc" in out)) throw new Error(JSON.stringify(out));
    const lines = out.nc.split("\n");
    expect(lines[2]).toBe("(post user.my-grbl)");
    expect(lines.slice(4).join("\n")).toBe(golden(grbl, "contour", 1)[0]);
    const shipped = await nc(doc, "grbl");
    if (!("nc" in shipped)) throw new Error(JSON.stringify(shipped));
    expect(shipped.nc.split("\n")[2]).toBe("(post grbl)");
    expect(await nc(doc, "other")).toEqual({
      reason: "post other is not installed",
    });
  });

  it("stores every user post under the user. prefix, once", async () => {
    const first = await add(JSON.stringify({ ...mine, id: "twice" }));
    const next = await add(
      JSON.stringify({ ...mine, id: "user.twice", label: "Twice" }),
    );
    expect(next.etag).not.toBe(first.etag);
    expect(next.data.filter((p: any) => p.id.endsWith("twice"))).toEqual([
      { ...mine, id: "user.twice", label: "Twice" },
    ]);
    const grblCopy = await add(JSON.stringify(grbl));
    expect(grblCopy.data.map((p: any) => p.id)).toContain("user.grbl");
  });

  it("keeps the user. prefix out of every shipped post id", () => {
    expect(USER_POST_PREFIX).toBe("user.");
    for (const id of POSTS.keys())
      expect(id.startsWith(USER_POST_PREFIX)).toBe(false);
  });

  it.each([
    [
      "a post over the size bound",
      JSON.stringify({ ...mine, label: "x".repeat(POST_MAX_BYTES) }),
      new RegExp(`^post is \\d+ bytes, over the ${POST_MAX_BYTES} byte limit$`),
    ],
    ["text that is not JSON", "{ id:", /^post is not JSON$/],
    [
      "a post missing a template variable",
      JSON.stringify({
        ...mine,
        templates: { ...mine.templates, linear: ["G1 X{x} Y{y} Z{z}"] },
      }),
      /^post templates\.linear: needs \{feed\}$/,
    ],
  ])("refuses %s with 400 naming it", async (_name, text, message) => {
    const before = await posts.read(mark);
    let error: any;
    try {
      await add(text);
    } catch (e) {
      error = e;
    }
    expect(error).toMatchObject({ code: "validation", detail: "/post" });
    expect(error.message).toMatch(message);
    expect(await posts.read(mark)).toEqual(before);
  });

  it("bounds the raw text, not the parsed post", async () => {
    const text = JSON.stringify(mine);
    const padded = text + " ".repeat(POST_MAX_BYTES - Buffer.byteLength(text));
    await expect(add(padded)).resolves.toMatchObject({ version: 1 });
    await expect(add(`${padded} `)).rejects.toMatchObject({
      code: "validation",
    });
  });
});

describe("CAM setup post copies", () => {
  it("reads a v2 document saved without a setup post unchanged", () => {
    const data = { setups: [setup], tools: [] };
    const stored = { version: 2, data: structuredClone(data) };
    expect(migrateCam(stored)).toEqual({ status: "ready", data });
    expect(stored).toEqual({ version: 2, data });
  });

  it("refuses a setup copy without the user. prefix on every save", () => {
    const shadow = {
      setups: [{ ...setup, post: copyOf({ ...grbl, label: "Shadow" }) }],
      tools: [],
    };
    expect(isCamData(shadow)).toBe(false);
    expect(() => parse(saveCam.body, shadow)).toThrow(
      "setups.0.post id must start with user.",
    );
  });

  it("serves a shipped id from the shipped post, never a setup copy", async () => {
    const doc = project([{ ...setup, post: copyOf(userMine) }]);
    await call(
      "POST",
      generateRoute.path,
      { setupId: "s1", operationId: "op1" },
      doc,
    );
    const data = doc.extensions[CAM_EXTENSION]!.data as CamData;
    data.setups[0]!.post = copyOf({ ...grbl, label: "Shadow" }) as never;
    await expect(nc(doc, "grbl")).rejects.toThrow(
      "CAM data version 2 is not valid",
    );
  });

  it("bounds a setup copy by the post size limit", () => {
    const big = copyOf({ ...userMine, label: "x".repeat(POST_MAX_BYTES) });
    expect(isCamData({ setups: [{ id: "s1", post: big }], tools: [] })).toBe(
      false,
    );
  });

  it("refuses a setup copy that is not a valid post", () => {
    const copy = copyOf(userMine);
    expect(isCamData({ setups: [{ id: "s1", post: copy }], tools: [] })).toBe(
      true,
    );
    for (const post of [
      { ...copy, words: "G0" },
      { ...copy, script: "x" },
      { id: "user.s", libraryRef: { id: "" } },
    ])
      expect(isCamData({ setups: [{ id: "s1", post }], tools: [] })).toBe(
        false,
      );
  });
});
