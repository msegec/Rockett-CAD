import camManifest from "./cam/manifest.json";
import camClient from "./cam/client";

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
];
