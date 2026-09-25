import { refsAt, registerCoreSpec } from "../featureSpec.js";

registerCoreSpec("shell", (f) => refsAt("face", "/openFaces", f.openFaces));
