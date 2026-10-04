import { defineKernelJobs, type KernelJobScope } from "@rockett/plugin-api";
import type { Program, Section } from "../shared/ir.js";
import { isOperation, type OperationType } from "../shared/operations.js";
import {
  contourParams,
  paramsOf,
  parallelParams,
  pocketParams,
  waterlineParams,
  type FaceRef,
} from "../shared/params.js";
import { stockBox, type Box, type Setup } from "../shared/setup.js";
import type { Preset, Tool } from "../shared/tools.js";
import type { Mesh } from "../surface/dropCutter.js";
import { contour } from "../toolpath/contour.js";
import { facing } from "../toolpath/facing.js";
import { checkMoves, chorded } from "../toolpath/geometry.js";
import { checkParallel, parallel } from "../toolpath/parallel.js";
import { pocket } from "../toolpath/pocket.js";
import { checkWaterline, waterline } from "../toolpath/waterline.js";
import offset, { type OffsetInput } from "./offset.js";
import { planarFace, type FaceBody, type RegionLoop } from "./regions.js";
import surfaceMesh, { type SurfaceMeshInput } from "./surfaceMesh.js";

export type GenerateInput = {
  setup: Pick<
    Setup,
    "id" | "bodies" | "stock" | "wcs" | "safeHeight" | "clearance"
  >;
  operation: { id: string; type: string; params: unknown };
  tool: Tool & { number: number };
  preset: Preset;
  bodies: (FaceBody & { bbox: Box })[];
};

type Generator = (input: GenerateInput, scope: KernelJobScope) => Section[];

const offsetJob = offset["rockett.cam.offset"] as (
  input: OffsetInput,
  scope: KernelJobScope,
) => RegionLoop[];

const meshJob = surfaceMesh["rockett.cam.surfaceMesh"] as (
  input: SurfaceMeshInput,
  scope: KernelJobScope,
) => Mesh;

const boxes = ({ bodies }: GenerateInput) =>
  Object.fromEntries(bodies.map(({ id, bbox }) => [id, bbox]));

function modelTop({ setup }: GenerateInput, at: Record<string, Box>) {
  const margins = { xMin: 0, xMax: 0, yMin: 0, yMax: 0, zMin: 0, zMax: 0 };
  const stock = stockBox(setup, at);
  const bare = stockBox(
    { ...setup, stock: { kind: "boxAround", margins } },
    at,
  );
  return (
    bare.max[2] -
    bare.modelToSetup.translation[2] +
    stock.modelToSetup.translation[2]
  );
}

function faceOf(input: GenerateInput, scope: KernelJobScope, ref: FaceRef) {
  const body = input.bodies.find(({ id }) => id === ref.bodyId);
  if (!body)
    throw new RangeError(`face body ${ref.bodyId} is not a setup body`);
  const stock = stockBox(input.setup, boxes(input));
  return { stock, face: planarFace(scope, body, ref, stock.modelToSetup) };
}

function surface(
  input: GenerateInput,
  scope: KernelJobScope,
  tolerance: number,
) {
  const stock = stockBox(input.setup, boxes(input));
  const mesh = meshJob(
    {
      bodies: input.bodies.map(({ brep }) => ({ identity: brep, brep })),
      modelToSetup: stock.modelToSetup,
      tolerance,
    },
    scope,
  );
  return {
    operationId: input.operation.id,
    setup: { ...input.setup, tolerance },
    stock,
    mesh,
    tool: input.tool,
    preset: input.preset,
  };
}

const cut = ({ operation, setup, tool, preset }: GenerateInput) => ({
  operationId: operation.id,
  setup,
  tool,
  preset,
});

const GENERATORS: Readonly<Record<OperationType, Generator>> = {
  "rockett.cam.facing"(input) {
    const at = boxes(input);
    return [
      facing({
        operationId: input.operation.id,
        setup: input.setup,
        stock: stockBox(input.setup, at),
        modelTop: modelTop(input, at),
        tool: input.tool,
        preset: input.preset,
      }),
    ];
  },
  "rockett.cam.contour"(input, scope) {
    const { type, params } = input.operation;
    const {
      face: ref,
      side,
      bottomOffset,
    } = paramsOf(contourParams, type, params);
    const { stock, face } = faceOf(input, scope, ref);
    return [
      contour(
        {
          ...cut(input),
          stock,
          bottom: face.z - bottomOffset,
          loop: face.outer,
          side,
          direction: "climb",
          start: face.outer.start,
        },
        (loop) => offsetJob(loop, scope),
      ),
    ];
  },
  "rockett.cam.pocket"(input, scope) {
    const { type, params } = input.operation;
    const { floor, rampAngle } = paramsOf(pocketParams, type, params);
    const { stock, face } = faceOf(input, scope, floor);
    return [
      pocket({
        ...cut(input),
        setup: { ...input.setup, fixtures: [] },
        stock,
        bottom: face.z,
        rampAngle,
        boundary: chorded(face.outer),
        islands: face.inner.map(chorded),
      }),
    ];
  },
  "rockett.cam.parallel"(input, scope) {
    const { type, params } = input.operation;
    const { angle, tolerance } = paramsOf(parallelParams, type, params);
    checkParallel({ ...input, setup: { ...input.setup, tolerance }, angle });
    const at = surface(input, scope, tolerance);
    const [min, max] = [at.stock.min, at.stock.max];
    return [
      parallel({
        ...at,
        angle,
        boundary: [
          [
            { x: min[0], y: min[1] },
            { x: max[0], y: min[1] },
            { x: max[0], y: max[1] },
            { x: min[0], y: max[1] },
          ],
        ],
      }),
    ];
  },
  "rockett.cam.waterline"(input, scope) {
    const { type, params } = input.operation;
    const { angle, tolerance } = paramsOf(waterlineParams, type, params);
    checkWaterline({ ...input, setup: { ...input.setup, tolerance }, angle });
    return [waterline({ ...surface(input, scope, tolerance), angle })];
  },
};

function generate(input: GenerateInput, scope: KernelJobScope): Program {
  const { setup, tool } = input;
  const { type } = input.operation;
  if (!isOperation(type)) throw new Error(`operation ${type} is unknown`);
  scope.progress(0, 1, type);
  const sections = GENERATORS[type](input, scope);
  checkMoves(
    `operation ${input.operation.id}`,
    sections.reduce((sum, { moves }) => sum + moves.length, 0),
  );
  scope.progress(1, 1, type);
  return {
    irVersion: 1,
    units: "mm",
    setupId: setup.id,
    offsetIndex: setup.wcs.offsetIndex,
    tools: [tool],
    sections,
  };
}

export default defineKernelJobs({ "rockett.cam.generate": generate });
