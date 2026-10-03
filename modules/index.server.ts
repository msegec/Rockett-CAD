import camManifest from "./cam/manifest.json";
import camServer from "./cam/server.js";

export const serverModules = [{ manifest: camManifest, server: camServer }];
