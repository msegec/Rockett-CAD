import { defineServerModule } from "@rockett/plugin-api";
import { uploadModule } from "./src/server/upload.js";

export default defineServerModule({
  activate({ register }) {
    register.routeModule(uploadModule);
  },
});
