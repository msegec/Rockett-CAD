import type { Feature, FeatureType } from "@rockett/shared";
import {
  registerFeatureKind,
  type EvalContext,
  type FeatureKind,
} from "./featureKinds.js";
import {
  evalEmboss,
  evalExtrude,
  evalLoft,
  evalRevolve,
  evalShell,
  evalSweep,
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
  kind("sweep", (ctx, f) => evalSweep(ctx.state, f)),
  kind("loft", (ctx, f) => evalLoft(ctx.state, f)),
];

for (const k of kinds) registerFeatureKind(k);
