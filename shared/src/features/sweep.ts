import { refAt, refsAt, registerCoreSpec } from "../featureSpec.js";

registerCoreSpec("sweep", (f) => [
  ...refsAt("profile", "/profiles", f.profiles),
  refAt("sketch", "/pathSketchId", f.pathSketchId),
  ...refsAt("body", "/targets", f.targets),
]);
