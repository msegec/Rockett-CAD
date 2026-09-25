import { refAt, registerCoreSpec } from "../featureSpec.js";

registerCoreSpec("referenceImage", (f) => [refAt("plane", "/plane", f.plane)], {
  producesGeometry: false,
});
