import type { ChamferType, Feature, FilletType } from "../model.js";

const BLEND_FIELDS = ["distance2", "angle", "flip"] as const;
type BlendField = (typeof BLEND_FIELDS)[number];
type BlendKind = "fillet" | "chamfer";
type Typed = Partial<Record<BlendField | `${BlendKind}Type`, unknown>>;

const TYPE_FIELDS: {
  fillet: Record<FilletType, readonly BlendField[]>;
  chamfer: Record<ChamferType, readonly BlendField[]>;
} = {
  fillet: { equalDistance: [], twoDistances: ["distance2", "flip"] },
  chamfer: {
    equalDistance: [],
    twoDistances: ["distance2", "flip"],
    distanceAngle: ["angle", "flip"],
  },
};

function blendOwns(kind: BlendKind, f: Typed, field: BlendField) {
  const fields: Record<string, readonly BlendField[]> = TYPE_FIELDS[kind];
  const type = String(f[`${kind}Type`]);
  return Object.hasOwn(fields, type) && fields[type]!.includes(field);
}

export function ownsExactly(kind: BlendKind) {
  return (f: Typed) =>
    BLEND_FIELDS.every(
      (key) => blendOwns(kind, f, key) === (f[key] !== undefined),
    );
}

export function dropUnownedBlendFields(feature: Feature, patch: object) {
  if (feature.type !== "fillet" && feature.type !== "chamfer") return;
  if (!(`${feature.type}Type` in patch)) return;
  for (const key of BLEND_FIELDS)
    if (!(key in patch) && !blendOwns(feature.type, feature, key))
      Reflect.deleteProperty(feature, key);
}
