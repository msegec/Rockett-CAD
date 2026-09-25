import { registerFeatureSpec, type FeatureSpec } from "../featureSpec.js";
import { FEATURE_LABELS, type ShellFeature } from "../model.js";
import { FEATURE_SCHEMAS } from "../schema/features.js";
import { parse } from "../schema/index.js";

const shell: FeatureSpec<ShellFeature> = {
  type: "shell",
  label: FEATURE_LABELS.shell,
  producesGeometry: true,
  version: 1,
  paramsSchema: FEATURE_SCHEMAS.shell,
  validate: (f) => void parse(FEATURE_SCHEMAS.shell, f),
  refs: (f) =>
    f.openFaces.map((face, i) => ({
      kind: "face",
      path: `/openFaces/${i}`,
      face,
    })),
  displayOnly: [],
};

registerFeatureSpec(shell);
