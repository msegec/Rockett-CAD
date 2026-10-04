import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type {
  CadDocument,
  KernelJobRun,
  Route,
  RouteModuleApi,
  ServerContext,
  User,
} from "@rockett/plugin-api";
import { operation, type GenerateInput } from "../kernel/generate.js";
import {
  CAM_EXTENSION,
  CAM_VERSION,
  migrateCam,
  type CamData,
} from "../shared/document.js";
import type { Program } from "../shared/ir.js";
import { toolSchema, type Tool } from "../shared/tools.js";
import { programCache, type ProgramCache } from "./cache.js";

export const CAM_ENGINE = 1;
export const GENERATE_JOB = "rockett.cam.generate";

export type GenerateRequest = Omit<GenerateInput, "bodies"> & {
  projectId: string;
  user: User;
};

const sorted = (_key: string, value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      )
    : value;

async function sha256(text: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function generator(
  context: Pick<ServerContext, "bodies" | "startKernelJob">,
  cache: ProgramCache,
) {
  return async function generate(
    { projectId, user, ...job }: GenerateRequest,
    run: KernelJobRun = {},
  ): Promise<{ fingerprint: string; program: Program }> {
    const op = operation(job.operation.type);
    if (!op) throw new Error(`operation ${job.operation.type} is unknown`);
    const model = new Map(
      (await context.bodies(projectId, user)).map((body) => [body.id, body]),
    );
    const bodies = job.setup.bodies.map((id) => {
      const body = model.get(id);
      if (!body) throw new Error(`setup body ${id} is not in the model`);
      return body;
    });
    const fingerprint = await sha256(
      JSON.stringify(
        {
          engine: CAM_ENGINE,
          generator: op.version,
          bodies: bodies.map((body) => body.fingerprint),
          ...job,
        },
        sorted,
      ),
    );
    const input: GenerateInput = {
      ...job,
      bodies: bodies.map(({ id, bbox, brep }) => ({ id, bbox, brep })),
    };
    const program = await cache.program(
      fingerprint,
      async () =>
        (await context.startKernelJob(GENERATE_JOB, input, run)) as Program,
      run.signal,
    );
    return { fingerprint, program };
  };
}

const target = Type.Object({
  setupId: Type.String({ minLength: 1 }),
  operationId: Type.String({ minLength: 1 }),
});

type Target = Static<typeof target>;

export const generateRoute: Route<
  "/projects/:id/m/rockett/cam/generate",
  Target
> & { readonly body: typeof target } = {
  method: "POST",
  path: "/projects/:id/m/rockett/cam/generate",
  body: target,
  effect: "document",
};

function cam(doc: CadDocument): CamData {
  const read = migrateCam(doc.extensions[CAM_EXTENSION]);
  if (read.status === "kept") throw new Error(read.reason);
  return read.data;
}

const find = (data: CamData, { setupId, operationId }: Target) => {
  const setup = data.setups.find((item) => item.id === setupId);
  if (!setup) throw new Error(`setup ${setupId} is not in this project`);
  const op = setup.operations?.find((item) => item.id === operationId);
  if (!op) throw new Error(`operation ${operationId} is not in ${setupId}`);
  return { setup, op };
};

function inputs(data: CamData, at: Target): Omit<GenerateInput, "bodies"> {
  const { setup, op } = find(data, at);
  const { bodies, stock, wcs, safeHeight, clearance } = setup;
  if (!bodies || !stock || !wcs || safeHeight === undefined)
    throw new Error(`setup ${setup.id} needs bodies, stock, WCS and heights`);
  if (clearance === undefined || !op.type)
    throw new Error(`setup ${setup.id} needs a clearance and operation type`);
  const found = data.tools.find((item) => item.id === op.toolId);
  if (!found) throw new Error(`operation ${op.id} needs a tool`);
  const { presets, libraryRef: _ref, ...tool } = found;
  if (!Value.Check(toolSchema, { ...tool }) || tool.number === undefined)
    throw new Error(`operation ${op.id} needs a complete numbered tool`);
  const preset = presets?.find((item) => item.id === op.presetId);
  if (!preset) throw new Error(`operation ${op.id} needs a preset of its tool`);
  return structuredClone({
    setup: { id: setup.id, bodies, stock, wcs, safeHeight, clearance },
    operation: { id: op.id, type: op.type, params: op.params ?? {} },
    tool: tool as Tool & { number: number },
    preset,
  });
}

export function mountGenerate(
  api: RouteModuleApi,
  context: Pick<ServerContext, "bodies" | "startKernelJob" | "files">,
) {
  const generate = generator(context, programCache(context.files));
  api.projectMutation(generateRoute, async (doc, req, { user }) => {
    const job = inputs(cam(doc), req.body);
    const made = await generate({ projectId: req.params.id, user, ...job });
    const data = cam(doc);
    const { op } = find(data, req.body);
    op.lastGenerated = {
      fingerprint: made.fingerprint,
      programSha256: await sha256(JSON.stringify(made.program)),
      at: new Date().toISOString(),
    };
    doc.extensions[CAM_EXTENSION] = { version: CAM_VERSION, data };
    return { label: `Generate ${op.name ?? op.id}`, ...made };
  });
}
