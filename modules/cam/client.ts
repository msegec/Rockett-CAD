import { defineClientModule } from "@rockett/plugin-api";
import { manufactureBrowser } from "./src/client/browser.js";
import {
  dialogPanel,
  OPERATION_DIALOGS,
  operationDialog,
} from "./src/client/opDialog.js";
import { SETUP_PANEL, setupDialog } from "./src/client/setupDialog.js";
import { stockLayer } from "./src/client/stockLayer.js";
import { TOOL_PANEL, toolPanel } from "./src/client/toolPanel.js";
import {
  toolpathBar,
  toolpathLayer,
  toolpathPreview,
} from "./src/client/toolpaths.js";

const MANUFACTURE = "rockett.cam.manufacture";
const SETUP_GROUP = "rockett.cam.group.setup";
const MILL_GROUP = "rockett.cam.group.mill";

export default defineClientModule({
  activate(context) {
    const { register, ui, project } = context;
    const preview = toolpathPreview(project);
    register.workbench({
      id: MANUFACTURE,
      label: "Manufacture",
      panels: [],
      selectionKinds: [],
      tree: manufactureBrowser(context, preview),
      bar: toolpathBar(preview),
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
    register.toolbarGroup({
      id: MILL_GROUP,
      label: "MILL",
      context: MANUFACTURE,
      after: "rockett.cam.group.plan",
    });
    for (const op of OPERATION_DIALOGS) {
      const panel = dialogPanel(op);
      register.command({
        id: op.type,
        label: op.label,
        group: MILL_GROUP,
        icon: op.icon,
        run: () => ui.openPanel(panel),
      });
      register.panel({
        id: panel,
        title: op.label,
        when: (_state, open) => open.includes(panel),
        component: operationDialog(context, op),
      });
    }
    register.layer(stockLayer(project, preview));
    register.layer(toolpathLayer(preview));
  },
});
