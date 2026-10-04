import { defineServerModule } from "@rockett/plugin-api";
import {
  CAM_EXTENSION,
  CAM_VERSION,
  migrateCam,
  saveCam,
  signRoute,
} from "./src/shared/document.js";
import { mountGenerate } from "./src/server/generate.js";
import { mountLibrary } from "./src/server/library.js";

export default defineServerModule({
  activate({ register, userData, ...context }) {
    register.kernelJob(
      "rockett.cam.regions",
      new URL("./kernel.ts", import.meta.url),
    );
    register.kernelJob(
      "rockett.cam.generate",
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
        api.projectRoute(signRoute, async (_doc, { params }, { user }) => {
          const { id, bodyId, faceName } = params;
          const [signed] = await context.signFaces(id, user, [
            { kind: "face", bodyId, faceName },
          ]);
          return signed;
        });
        mountLibrary(api, userData);
        mountGenerate(api, context);
      },
    });
  },
});
