import type { TSchema } from "typebox";
import {
  FEATURE_LABELS,
  type AxisRef,
  type FaceRef,
  type Feature,
  type FeatureType,
  type ProfileRef,
} from "./model.js";
import { createRegistry } from "./registry.js";
import { FEATURE_SCHEMAS } from "./schema/features.js";
import { parse } from "./schema/index.js";

interface RefTargets {
  face: FaceRef;
  profile: ProfileRef;
  axis: AxisRef;
  body: string;
}

type RefKind = keyof RefTargets;

export type FeatureRef = {
  [K in RefKind]: { kind: K; path: string } & Record<K, RefTargets[K]>;
}[RefKind];

export interface FeatureSpec<F extends Feature = Feature> {
  type: string;
  label: string;
  producesGeometry: boolean;
  version: number;
  paramsSchema: TSchema;
  validate(f: F): void;
  refs(f: F): FeatureRef[];
  displayOnly: readonly string[];
  migrate?(fromVersion: number, f: F): F;
}

export const featureSpecs = createRegistry<FeatureSpec>(
  "feature spec",
  (spec) => spec.type,
);

export const registerFeatureSpec = featureSpecs.register;
export const featureSpec = featureSpecs.get;

export function featureRefs(f: Feature): FeatureRef[] {
  const spec = featureSpec(f.type);
  if (!spec) throw new Error(`no feature spec for ${f.type}`);
  return spec.refs(f);
}

export const refAt = <K extends RefKind>(
  kind: K,
  path: string,
  target: RefTargets[K],
) => ({ kind, path, [kind]: target }) as FeatureRef;

export const refsAt = <K extends RefKind>(
  kind: K,
  path: string,
  targets: readonly RefTargets[K][] = [],
) => targets.map((target, i) => refAt(kind, `${path}/${i}`, target));

export function registerCoreSpec<T extends FeatureType>(
  type: T,
  refs: (f: Extract<Feature, { type: T }>) => FeatureRef[],
): () => void {
  const schema = FEATURE_SCHEMAS[type];
  const spec: FeatureSpec<Extract<Feature, { type: T }>> = {
    type,
    label: FEATURE_LABELS[type],
    producesGeometry: true,
    version: 1,
    paramsSchema: schema,
    validate: (f) => void parse(schema, f),
    refs,
    displayOnly: [],
  };
  return registerFeatureSpec(spec);
}
