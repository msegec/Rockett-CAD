import { defineKernelJobs, type KernelJobScope } from "@rockett/plugin-api";
import type { Program, Section } from "../shared/ir.js";
import { isOperation, type OperationType } from "../shared/operations.js";
import { stockBox, type Box, type Setup } from "../shared/setup.js";
import type { Preset, Tool } from "../shared/tools.js";
import { facing } from "../toolpath/facing.js";

export type GenerateInput = {
  setup: Pick<
    Setup,
    "id" | "bodies" | "stock" | "wcs" | "safeHeight" | "clearance"
  >;
  operation: { id: string; type: string; params: unknown };
  tool: Tool & { number: number };
  preset: Preset;
  bodies: { id: string; bbox: Box; brep: string }[];
};

type Generator = (input: GenerateInput, scope: KernelJobScope) => Section[];

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
};

function generate(input: GenerateInput, scope: KernelJobScope): Program {
  const { setup, tool } = input;
  const { type } = input.operation;
  if (!isOperation(type)) throw new Error(`operation ${type} is unknown`);
  scope.progress(0, 1, type);
  const sections = GENERATORS[type](input, scope);
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
