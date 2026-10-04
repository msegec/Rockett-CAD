import generate from "./src/kernel/generate.js";
import regions from "./src/kernel/regions.js";
import surfaceMesh from "./src/kernel/surfaceMesh.js";

export default { ...regions, ...generate, ...surfaceMesh };
