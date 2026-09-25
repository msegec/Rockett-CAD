import { refsAt, registerCoreSpec } from "../featureSpec.js";

registerCoreSpec("offsetFace", (f) => refsAt("face", "/faces", f.faces));
