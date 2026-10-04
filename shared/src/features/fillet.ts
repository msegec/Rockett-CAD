import { refsAt, registerCoreSpec } from "../featureSpec.js";

registerCoreSpec("fillet", "Fillet", (f) => [
  ...refsAt("edge", "/edges", f.edges),
  ...refsAt("face", "/faces", f.faces),
  ...refsAt("feature", "/features", f.features),
]);
