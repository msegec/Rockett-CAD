import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type { CadDocument } from "@rockett/plugin-api";
import { toolSchema } from "./tools.js";

export const CAM_EXTENSION = "rockett.cam";
export const CAM_VERSION = 1;

export const entry = Type.Object({ id: Type.String({ minLength: 1 }) });

const docTool = Type.Intersect([
  entry,
  Type.Partial(toolSchema),
  Type.Partial(Type.Object({ libraryRef: entry })),
]);

export const camDataSchema = Type.Object(
  { setups: Type.Array(entry), tools: Type.Array(docTool) },
  { additionalProperties: false },
);

export type CamData = Static<typeof camDataSchema>;

export type CamRead =
  { status: "ready"; data: CamData } | { status: "kept"; reason: string };

export const isCamData = (data: unknown): data is CamData =>
  Value.Check(camDataSchema, data);

export function migrateCam(
  stored: CadDocument["extensions"][string] | undefined,
): CamRead {
  if (!stored) return { status: "ready", data: { setups: [], tools: [] } };
  const { version, data } = stored;
  if (version > CAM_VERSION)
    return {
      status: "kept",
      reason: `CAM data version ${version} is newer than this module reads (${CAM_VERSION})`,
    };
  if (version === CAM_VERSION && isCamData(data))
    return { status: "ready", data };
  return { status: "kept", reason: `CAM data version ${version} is not valid` };
}
