import { NAME_LENGTH } from "@rockett/shared";
import { solids, type Shape } from "./kernel.js";
import { readXdeStep } from "./xde.js";
import type { ImportedLabel } from "./featureState.js";

const DEFAULT_NAME = /^Open CASCADE STEP translator \d+(\.\d+)* \d+$/;

function cleanName(raw: string | null | undefined): string | undefined {
  const name = raw?.replace(/\p{Cc}/gu, "").trim();
  if (!name || DEFAULT_NAME.test(name)) return undefined;
  return name.slice(0, NAME_LENGTH);
}

export function readStep(data: Uint8Array):
  | {
      shapes: Shape[];
      parts: Array<{ shape: Shape; label: ImportedLabel }>;
    }
  | undefined {
  let bodies;
  try {
    ({ bodies } = readXdeStep(data));
  } catch (error) {
    if ((error as Error).message === "STEP file could not be read") return;
    throw error;
  }
  const parts = bodies.flatMap(({ name, path, color, shape }) => {
    const text = cleanName(path.at(-1)) ?? cleanName(name);
    const label = { ...(text && { name: text }), ...(color && { color }) };
    return solids(shape).map((solid) => ({ shape: solid, label }));
  });
  return { shapes: bodies.map((body) => body.shape), parts };
}
