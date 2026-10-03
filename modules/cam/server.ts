import { defineServerModule, type Route } from "@rockett/plugin-api";
import {
  CAM_EXTENSION,
  CAM_VERSION,
  camDataSchema,
  migrateCam,
  type CamData,
} from "./src/shared/document.js";

const saveCam: Route<"/projects/:id/m/rockett/cam", CamData> & {
  readonly body: typeof camDataSchema;
} = {
  method: "PUT",
  path: "/projects/:id/m/rockett/cam",
  body: camDataSchema,
  effect: "document",
};

export default defineServerModule({
  activate({ register }) {
    register.kernelJob(
      "rockett.cam.regions",
      new URL("./kernel.ts", import.meta.url),
    );
    register.routeModule({
      id: "rockett.cam.document",
      mount(api) {
        api.projectMutation(saveCam, async (doc, req) => {
          const stored = migrateCam(doc.extensions[CAM_EXTENSION]);
          if (stored.status === "kept") throw new Error(stored.reason);
          doc.extensions[CAM_EXTENSION] = {
            version: CAM_VERSION,
            data: req.body,
          };
          return { label: "Edit CAM data" };
        });
      },
    });
  },
});
