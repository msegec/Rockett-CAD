import { defineKernelJobs, type KernelJobScope } from "@rockett/plugin-api";
import type { Program, Section } from "../shared/ir.js";
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

type Operation = {
  version: number;
  generate(input: GenerateInput, scope: KernelJobScope): Section[];
};

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

export const OPERATIONS: Readonly<Record<string, Operation>> = {
  "rockett.cam.facing": {
    version: 1,
    generate(input) {
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
  },
};

export const operation = (type: string) =>
  Object.hasOwn(OPERATIONS, type) ? OPERATIONS[type] : undefined;

function generate(input: GenerateInput, scope: KernelJobScope): Program {
  const { setup, tool } = input;
  const op = operation(input.operation.type);
  if (!op) throw new Error(`operation ${input.operation.type} is unknown`);
  scope.progress(0, 1, input.operation.type);
  const sections = op.generate(input, scope);
  scope.progress(1, 1, input.operation.type);
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
