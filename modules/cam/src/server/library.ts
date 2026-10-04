import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";
import type {
  Route,
  RouteModuleApi,
  ServerContext,
  UserData,
} from "@rockett/plugin-api";
import {
  CAM_EXTENSION,
  CAM_VERSION,
  entry,
  migrateCam,
} from "../shared/document.js";
import {
  machineSchema,
  validateMachine,
  type MachineProfile,
} from "../shared/machine.js";
import {
  presetSchema,
  toolSchema,
  validatePreset,
  validateTool,
  type Preset,
  type Tool,
} from "../shared/tools.js";

const useTool: Route<
  "/projects/:id/m/rockett/cam/tools",
  Static<typeof entry>
> & { readonly body: typeof entry } = {
  method: "POST",
  path: "/projects/:id/m/rockett/cam/tools",
  body: entry,
  effect: "document",
};

function list<T extends { id: string }>(
  api: RouteModuleApi,
  store: UserData,
  noun: string,
  item: TSchema,
  problems: (item: T) => string[],
) {
  const path = `/m/rockett/cam/${noun}s`;
  const save: Route<string, { data: T[]; etag: string | null }> & {
    readonly body: TSchema;
  } = {
    method: "PUT",
    path,
    body: Type.Object({
      data: Type.Array(item),
      etag: Type.Union([Type.String(), Type.Null()]),
    }),
  };
  api.userRoute({ method: "GET", path }, (_req, { user }) => store.read(user));
  api.userRoute(save, async (req, { user }) => {
    const { data, etag } = req.body;
    const ids = new Set<string>();
    for (const value of data) {
      if (ids.has(value.id)) throw new Error(`${noun}s has ${value.id} twice`);
      ids.add(value.id);
      const [problem] = problems(value);
      if (problem) throw new Error(`${noun} ${value.id}: ${problem}`);
    }
    return store.write(user, data, etag);
  });
}

export function mountLibrary(
  api: RouteModuleApi,
  userData: ServerContext["userData"],
) {
  const tools = userData("tools", 1);
  list<Tool>(api, tools, "tool", toolSchema, validateTool);
  list<Preset>(
    api,
    userData("presets", 1),
    "preset",
    presetSchema,
    validatePreset,
  );
  list<MachineProfile>(
    api,
    userData("machines", 1),
    "machine",
    machineSchema,
    validateMachine,
  );
  api.projectMutation(useTool, async (doc, req, { user }) => {
    const cam = migrateCam(doc.extensions[CAM_EXTENSION]);
    if (cam.status === "kept") throw new Error(cam.reason);
    const { id } = req.body;
    const stored = (await tools.read(user))?.data;
    const tool = Array.isArray(stored)
      ? stored.find((value) => value?.id === id)
      : undefined;
    if (!Value.Check(toolSchema, tool))
      throw new Error(`tool ${id} is not in your library`);
    cam.data.tools.push({
      ...tool,
      id: crypto.randomUUID(),
      libraryRef: { id },
    });
    doc.extensions[CAM_EXTENSION] = { version: CAM_VERSION, data: cam.data };
    return { label: `Use tool ${tool.name}` };
  });
}
