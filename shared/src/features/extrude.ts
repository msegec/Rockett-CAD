import { refsAt, registerCoreSpec } from "../featureSpec.js";

registerCoreSpec("extrude", (f) => [
  ...refsAt("profile", "/profiles", f.profiles),
  ...refsAt("face", "/faces", f.faces),
  ...refsAt("body", "/targets", f.targets),
]);
