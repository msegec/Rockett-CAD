import { refsAt, registerCoreSpec } from "../featureSpec.js";

registerCoreSpec("emboss", (f) => [
  ...refsAt("profile", "/profiles", f.profiles),
  ...refsAt("body", "/targets", f.targets),
]);
