import { defineClientModule } from "@rockett/plugin-api";
import { SETUP_PANEL, setupDialog } from "./src/client/setupDialog.js";
import { stockLayer } from "./src/client/stockLayer.js";
import { TOOL_PANEL, toolPanel } from "./src/client/toolPanel.js";

const MANUFACTURE = "rockett.cam.manufacture";
const SETUP_GROUP = "rockett.cam.group.setup";

export default defineClientModule({
  activate(context) {
    const { register, ui, project } = context;
    register.workbench({
      id: MANUFACTURE,
      label: "Manufacture",
      panels: [],
      selectionKinds: [],
    });
    register.toolbarGroup({
      id: SETUP_GROUP,
      label: "SETUP",
      context: MANUFACTURE,
    });
    register.command({
      id: "rockett.cam.setup",
      label: "Setup",
      group: SETUP_GROUP,
      icon: "setup.svg",
      run: () => ui.openPanel(SETUP_PANEL),
    });
    register.panel({
      id: SETUP_PANEL,
      title: "Setup",
      when: (_state, open) => open.includes(SETUP_PANEL),
      component: setupDialog(context),
    });
    register.command({
      id: "rockett.cam.library",
      label: "Library",
      group: SETUP_GROUP,
      icon: "library.svg",
      run: () => ui.openPanel(TOOL_PANEL),
    });
    register.panel({
      id: TOOL_PANEL,
      title: "Library",
      when: (_state, open) => open.includes(TOOL_PANEL),
      component: toolPanel(context),
    });
    register.layer(stockLayer(project));
  },
});
