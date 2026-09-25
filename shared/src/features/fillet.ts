import { refsAt, registerCoreSpec } from "../featureSpec.js";

registerCoreSpec("fillet", (f) => refsAt("edge", "/edges", f.edges));
