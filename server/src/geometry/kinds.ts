import type { ShellFeature } from "@rockett/shared";
import { registerFeatureKind, type FeatureKind } from "./featureKinds.js";
import { evalShell } from "./features.js";

const kinds: FeatureKind<ShellFeature>[] = [
  { type: "shell", evaluate: (ctx, f) => evalShell(ctx.state, f) },
];

for (const kind of kinds) registerFeatureKind(kind);
