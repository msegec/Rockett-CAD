import { refsAt, registerCoreSpec } from "../featureSpec.js";

registerCoreSpec("chamfer", (f) => refsAt("edge", "/edges", f.edges));
