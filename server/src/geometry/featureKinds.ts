import { createRegistry, type Feature } from "@rockett/shared";
import type { EvalState, FeatureOutcome } from "./features.js";
import type { Sources } from "./importers.js";

export interface EvalContext {
  state: EvalState;
  earlier: Feature[];
  index: number;
  sources: Sources;
}

export interface FeatureKind<F extends Feature = Feature> {
  type: string;
  evaluate(ctx: EvalContext, f: F): FeatureOutcome | void;
}

export const featureKinds = createRegistry<FeatureKind>(
  "feature kind",
  (kind) => kind.type,
);

export const registerFeatureKind = featureKinds.register;
export const featureKind = featureKinds.get;
