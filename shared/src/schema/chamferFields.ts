import type { ChamferType } from "../model.js";

const CHAMFER_FIELDS: Record<ChamferType, readonly ChamferField[]> = {
  equalDistance: [],
  twoDistances: ["distance2", "flip"],
  distanceAngle: ["angle", "flip"],
};

export const CHAMFER_TYPE_FIELDS = ["distance2", "angle", "flip"] as const;
export type ChamferField = (typeof CHAMFER_TYPE_FIELDS)[number];

export function chamferOwns(chamferType: string, field: ChamferField) {
  return (
    Object.hasOwn(CHAMFER_FIELDS, chamferType) &&
    CHAMFER_FIELDS[chamferType as ChamferType].includes(field)
  );
}
