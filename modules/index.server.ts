import camManifest from "./cam/manifest.json";
import camServer from "./cam/server.js";
import elecManifest from "./elec/manifest.json";
import elecServer from "./elec/server.js";
import kicadManifest from "./kicad/manifest.json";
import kicadServer from "./kicad/server.js";

export const serverModules = [
  { manifest: camManifest, server: camServer },
  { manifest: kicadManifest, server: kicadServer },
  { manifest: elecManifest, server: elecServer },
];
