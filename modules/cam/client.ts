import { defineClientModule } from "@rockett/plugin-api";

export default defineClientModule({
  activate({ register }) {
    register.workbench({
      id: "rockett.cam.manufacture",
      label: "Manufacture",
      panels: [],
      selectionKinds: [],
    });
  },
});
