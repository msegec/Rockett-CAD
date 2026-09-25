import type { Feature, FeatureType } from "@rockett/shared";
import {
  registerFeatureKind,
  type EvalContext,
  type FeatureKind,
} from "./featureKinds.js";
import {
  evalEmboss,
  evalExtrude,
  evalRevolve,
  evalShell,
  type FeatureOutcome,
} from "./features.js";

const kind = <T extends FeatureType>(
  type: T,
  evaluate: (
    ctx: EvalContext,
    f: Extract<Feature, { type: T }>,
  ) => FeatureOutcome | void,
): FeatureKind => ({ type, evaluate });

const kinds = [
  kind("shell", (ctx, f) => evalShell(ctx.state, f)),
  kind("extrude", (ctx, f) => evalExtrude(ctx.state, f)),
  kind("revolve", (ctx, f) => evalRevolve(ctx.state, f)),
  kind("emboss", (ctx, f) => evalEmboss(ctx.state, f)),
];

for (const k of kinds) registerFeatureKind(k);
