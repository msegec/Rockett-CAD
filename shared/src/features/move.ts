import { refsAt, registerCoreSpec } from "../featureSpec.js";

registerCoreSpec("move", (f) => refsAt("body", "/bodies", f.bodies));
