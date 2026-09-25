import { refAt, refsAt, registerCoreSpec } from "../featureSpec.js";

registerCoreSpec("circularPattern", (f) => [
  ...refsAt("body", "/bodies", f.bodies),
  refAt("axis", "/axis", f.axis),
]);
