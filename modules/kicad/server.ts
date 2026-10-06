import { defineServerModule } from "@rockett/plugin-api";
import { board } from "./src/kernel/boardFeature.js";
import { BOARD_NETS, boardNets } from "./src/server/boardNets.js";
import { uploadModule } from "./src/server/upload.js";

export default defineServerModule({
  async activate({ register, services }) {
    await register.timelineFeature(
      board,
      new URL("./kernel.ts", import.meta.url),
    );
    register.routeModule(uploadModule);
    services.provide(BOARD_NETS, boardNets);
  },
});
