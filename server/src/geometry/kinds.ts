import type { Feature, FeatureType } from "@rockett/shared";
import {
  registerFeatureKind,
  type EvalContext,
  type FeatureKind,
} from "./featureKinds.js";
import {
  evalChamfer,
  evalCombine,
  evalEmboss,
  evalExtrude,
  evalFillet,
  evalLoft,
  evalMove,
  evalOffsetFace,
  evalRevolve,
  evalShell,
  evalSplitBody,
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
  kind("fillet", (ctx, f) => evalFillet(ctx.state, f)),
  kind("chamfer", (ctx, f) => evalChamfer(ctx.state, f)),
  kind("offsetFace", (ctx, f) => evalOffsetFace(ctx.state, f)),
  kind("combine", (ctx, f) => evalCombine(ctx.state, f)),
  kind("splitBody", (ctx, f) => evalSplitBody(ctx.state, f)),
  kind("move", evalMove),
];

for (const k of kinds) registerFeatureKind(k);
