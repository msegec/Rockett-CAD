import { defineServerModule } from "@rockett/plugin-api";
import { BOARD_NETS, boardNets } from "./src/server/boardNets.js";
import { uploadModule } from "./src/server/upload.js";

export default defineServerModule({
  activate({ register, services }) {
    register.routeModule(uploadModule);
    services.provide(BOARD_NETS, boardNets);
  },
});
