import { defineServerModule } from "@rockett/plugin-api";
import { netsModule } from "./src/boardNets.js";

export default defineServerModule({
  activate({ register }) {
    register.routeModule(netsModule);
  },
});
