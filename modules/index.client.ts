import camManifest from "./cam/manifest.json";
import camClient from "./cam/client";
import elecManifest from "./elec/manifest.json";
import elecClient from "./elec/client";
import kicadManifest from "./kicad/manifest.json";
import kicadClient from "./kicad/client";

export const clientModules = [
  {
    manifest: camManifest,
    client: camClient,
    icons: import.meta.glob<string>("./cam/icons/*.svg", {
      query: "?raw",
      import: "default",
      eager: true,
    }),
  },
  { manifest: kicadManifest, client: kicadClient, icons: {} },
  { manifest: elecManifest, client: elecClient, icons: {} },
];
