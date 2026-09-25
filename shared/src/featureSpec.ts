import type { TSchema } from "typebox";
import type { FaceRef, Feature } from "./model.js";
import { createRegistry } from "./registry.js";

export type FeatureRef = { kind: "face"; path: string; face: FaceRef };

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
