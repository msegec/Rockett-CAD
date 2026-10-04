import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type {
  CadDocument,
  FeatureStatus,
  KernelJobRun,
  Route,
  RouteModuleApi,
  ServerBody,
  ServerContext,
  User,
} from "@rockett/plugin-api";
import type { GenerateInput } from "../kernel/generate.js";
import {
  CAM_EXTENSION,
  CAM_VERSION,
  migrateCam,
  type CamData,
} from "../shared/document.js";
import type { Program } from "../shared/ir.js";
import { isOperation, OPERATION_VERSIONS } from "../shared/operations.js";
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

export type OperationStatus =
  | { status: "fresh" | "stale" | "never" }
  | { status: "error" | "missingReference"; reason: string };

type Blocked = Extract<OperationStatus, { reason: string }>;

const why = ({ featureId, status, error }: FeatureStatus) =>
  status === "error"
    ? `${featureId}, which failed${error ? `: ${error}` : ""}`
    : status === "cancelled"
      ? `${featureId}, which was cancelled`
      : `${featureId}, which has unresolved references`;

async function prepare(
  context: Pick<ServerContext, "bodies">,
  { projectId, user, ...job }: GenerateRequest,
): Promise<Blocked | { fingerprint: string; input: GenerateInput }> {
  const { type } = job.operation;
  if (!isOperation(type))
    return { status: "error", reason: `operation ${type} is unknown` };
  const model = new Map(
    (await context.bodies(projectId, user)).map((body) => [body.id, body]),
  );
  const bodies: ServerBody[] = [];
  for (const id of job.setup.bodies) {
    const body = model.get(id);
    if (!body)
      return {
        status: "missingReference",
        reason: `setup body ${id} is not in the model`,
      };
    if (body.problems?.length)
      return {
        status: "error",
        reason: `setup body ${id} depends on ${body.problems.map(why).join("; ")}`,
      };
    bodies.push(body);
  }
  const fingerprint = await sha256(
    JSON.stringify(
      {
        engine: CAM_ENGINE,
        generator: OPERATION_VERSIONS[type],
        bodies: bodies.map((body) => body.fingerprint),
        ...job,
      },
      sorted,
    ),
  );
  return {
    fingerprint,
    input: {
      ...job,
      bodies: bodies.map(({ id, bbox, brep }) => ({ id, bbox, brep })),
    },
  };
}

export function generator(
  context: Pick<ServerContext, "bodies" | "startKernelJob">,
  cache: ProgramCache,
) {
  return async function generate(
    request: GenerateRequest,
    run: KernelJobRun = {},
  ): Promise<{ fingerprint: string; program: Program }> {
    const ready = await prepare(context, request);
    if ("reason" in ready) throw new Error(ready.reason);
    const { fingerprint, input } = ready;
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

function inputs(
  data: CamData,
  at: Target,
): Omit<GenerateInput, "bodies"> | string {
  const { setup, op } = find(data, at);
  const { bodies, stock, wcs, safeHeight, clearance } = setup;
  if (!bodies || !stock || !wcs || safeHeight === undefined)
    return `setup ${setup.id} needs bodies, stock, WCS and heights`;
  if (clearance === undefined || !op.type)
    return `setup ${setup.id} needs a clearance and operation type`;
  const found = data.tools.find((item) => item.id === op.toolId);
  if (!found) return `operation ${op.id} needs a tool`;
  const { presets, libraryRef: _ref, ...tool } = found;
  if (!Value.Check(toolSchema, { ...tool }) || tool.number === undefined)
    return `operation ${op.id} needs a complete numbered tool`;
  const preset = presets?.find((item) => item.id === op.presetId);
  if (!preset) return `operation ${op.id} needs a preset of its tool`;
  return structuredClone({
    setup: { id: setup.id, bodies, stock, wcs, safeHeight, clearance },
    operation: { id: op.id, type: op.type, params: op.params ?? {} },
    tool: tool as Tool & { number: number },
    preset,
  });
}

export const statusRoute: Route<
  "/projects/:id/m/rockett/cam/setups/:setupId/operations/:operationId/status",
  unknown,
  OperationStatus
> = {
  method: "GET",
  path: "/projects/:id/m/rockett/cam/setups/:setupId/operations/:operationId/status",
};

function operationStatus(
  context: Pick<ServerContext, "bodies">,
  cache: Pick<ProgramCache, "failure">,
) {
  return async (
    doc: CadDocument,
    at: Target & { id: string },
    user: User,
  ): Promise<OperationStatus> => {
    const data = cam(doc);
    const { op } = find(data, at);
    const job = inputs(data, at);
    if (typeof job === "string") return { status: "error", reason: job };
    const ready = await prepare(context, { projectId: at.id, user, ...job });
    if ("reason" in ready) return ready;
    const failed = cache.failure(ready.fingerprint);
    if (failed !== undefined) return { status: "error", reason: failed };
    if (!op.lastGenerated) return { status: "never" };
    return op.lastGenerated.fingerprint === ready.fingerprint
      ? { status: "fresh" }
      : { status: "stale" };
  };
}

export function mountGenerate(
  api: RouteModuleApi,
  context: Pick<ServerContext, "bodies" | "startKernelJob" | "files">,
) {
  const cache = programCache(context.files);
  const generate = generator(context, cache);
  const status = operationStatus(context, cache);
  api.projectRoute(statusRoute, (doc, req, { user }) =>
    status(doc, req.params, user),
  );
  api.projectMutation(generateRoute, async (doc, req, { user }) => {
    const job = inputs(cam(doc), req.body);
    if (typeof job === "string") throw new Error(job);
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
