import {
  defineClientModule,
  type ClientContext,
  type Panel,
} from "@rockett/plugin-api";
import { manufactureBrowser } from "./src/client/browser.js";
import {
  dialogPanel,
  LASER_GROUP,
  MILL_GROUP,
  OPERATION_DIALOGS,
  operationDialog,
} from "./src/client/opDialog.js";
import { NC_PANEL, ncDialog } from "./src/client/ncDialog.js";
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
const PROGRAM_GROUP = "rockett.cam.group.program";

type Dialog = {
  id: string;
  label: string;
  group: string;
  icon: `${string}.svg`;
  panel: string;
  component: Panel["component"];
};

function dialog({ register, ui }: ClientContext, item: Dialog) {
  const { panel, component, ...command } = item;
  register.command({ ...command, run: () => ui.openPanel(panel) });
  register.panel({
    id: panel,
    title: command.label,
    when: (_state, open) => open.includes(panel),
    component,
  });
}

export default defineClientModule({
  activate(context) {
    const { register, project } = context;
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
    dialog(context, {
      id: "rockett.cam.setup",
      label: "Setup",
      group: SETUP_GROUP,
      icon: "setup.svg",
      panel: SETUP_PANEL,
      component: setupDialog(context),
    });
    dialog(context, {
      id: "rockett.cam.library",
      label: "Library",
      group: SETUP_GROUP,
      icon: "library.svg",
      panel: TOOL_PANEL,
      component: toolPanel(context),
    });
    register.toolbarGroup({
      id: MILL_GROUP,
      label: "MILL",
      context: MANUFACTURE,
      after: "rockett.cam.group.plan",
    });
    register.toolbarGroup({
      id: LASER_GROUP,
      label: "LASER",
      context: MANUFACTURE,
      after: "rockett.cam.group.surface",
    });
    for (const op of OPERATION_DIALOGS)
      dialog(context, {
        id: op.type,
        label: op.label,
        group: op.group,
        icon: op.icon,
        panel: dialogPanel(op),
        component: operationDialog(context, op),
      });
    register.toolbarGroup({
      id: PROGRAM_GROUP,
      label: "PROGRAM",
      context: MANUFACTURE,
      after: LASER_GROUP,
    });
    dialog(context, {
      id: "rockett.cam.nc",
      label: "NC Program",
      group: PROGRAM_GROUP,
      icon: "nc-program.svg",
      panel: NC_PANEL,
      component: ncDialog(context),
    });
    register.layer(stockLayer(project, preview));
    register.layer(toolpathLayer(preview));
  },
});
