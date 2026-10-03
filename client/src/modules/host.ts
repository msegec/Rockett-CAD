import { createElement, type ComponentType } from "react";
import type {
  ClientContext,
  ClientUi,
  Dispose,
  Layer,
  NumberFieldProps,
  OpenProject,
  ProjectView,
  Workbench,
} from "@rockett/plugin-api";
import {
  DOCUMENT_EDITS,
  REGISTRY_ID,
  type ModuleInfo,
  type Route,
} from "@rockett/shared";
import { send, type MutationResponse } from "../api";
import {
  registerCommand,
  registerToolbarGroup,
  type Command,
} from "../commands/registry";
import { iconOf, registerModuleIcon } from "../icons";
import { registerSelectionKind } from "../selection/kinds";
import { DraggablePanel } from "../components/DraggablePanel";
import { DialogFooter } from "../components/form/DialogFooter";
import {
  AngleField,
  CheckField,
  LengthField,
  NumField,
  SelectField,
} from "../components/form/fields";
import { useSetting } from "../settings";
import {
  closePanel,
  openPanel,
  PanelBoundary,
  registerPanel,
} from "../shell/panels";
import { registerWorkbench } from "../shell/workbench";
import { useStore, type State } from "../store";
import { registerPickProvider } from "../three/pickProviders";
import { registerLayer } from "../three/sceneLayers";

const messageOf = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const bounded =
  (id: string, title: string, Inner: ComponentType): ComponentType =>
  () =>
    createElement(PanelBoundary, {
      panel: { id, title },
      children: createElement(Inner),
    });

const guarded = (command: Command): Command =>
  command.Control
    ? {
        ...command,
        Control: bounded(command.id, command.label, command.Control),
      }
    : command;

const guardedWorkbench = ({ tree, bar, ...workbench }: Workbench) => ({
  ...workbench,
  ...(tree && { tree: bounded(workbench.id, workbench.label, tree) }),
  ...(bar && { bar: bounded(workbench.id, workbench.label, bar) }),
});

const guardedLayer = ({ id, mount }: Layer): Layer => ({
  id,
  mount(layer) {
    try {
      return mount(layer);
    } catch (error) {
      console.error(`[rockett] layer ${id} failed: ${messageOf(error)}`);
    }
  },
});

const ICON_FILE = /\/icons\/([a-z0-9-]+)\.svg$/;

function registerModuleIcons(own: Dispose[], { manifest, icons }: HostModule) {
  for (const [path, file] of Object.entries(icons ?? {})) {
    const name = ICON_FILE.exec(path)?.[1];
    if (!name) throw new Error(`icon ${path} must be icons/<name>.svg`);
    own.push(registerModuleIcon(`${manifest.id}/${name}.svg`, file));
  }
}

type ModuleCommand = Command & { icon?: `${string}.svg` };

function iconed(moduleId: string, command: ModuleCommand): Command {
  if (!command.icon) return command;
  const icon = `${moduleId}/${command.icon}` as const;
  if (!iconOf(icon))
    throw new Error(
      `command ${command.id} icon ${command.icon} is not in ${moduleId} icons/`,
    );
  return { ...command, icon };
}

function registerModuleLayer(moduleId: string, layer: Layer) {
  if (!layer.id.startsWith(`${moduleId}.`) || !REGISTRY_ID.test(layer.id))
    throw new Error(
      `layer ${layer.id} must start with ${moduleId}. and name a valid id`,
    );
  return registerLayer(guardedLayer(layer));
}

type Viewed = Pick<State, "projectId" | "document" | "evaluation">;

const changed = (now: Viewed, before: Viewed) =>
  now.projectId !== before.projectId ||
  now.document !== before.document ||
  now.evaluation !== before.evaluation;

let seen: Viewed = { projectId: null, document: null, evaluation: null };
let open: OpenProject = { projectId: null, document: null, bodies: [] };

const project: ProjectView = {
  get() {
    const now = useStore.getState();
    if (!changed(now, seen)) return open;
    const { projectId, document, evaluation } = now;
    seen = { projectId, document, evaluation };
    const bodies = (evaluation?.bodies ?? []).map(({ bodyId, name, bbox }) => ({
      id: bodyId,
      name,
      bbox,
    }));
    open = { projectId, document, bodies };
    return open;
  },
  subscribe: (listener) =>
    useStore.subscribe((now, before) => {
      if (changed(now, before)) listener();
    }),
  async mutate(route, body) {
    const { projectId, mutate } = useStore.getState();
    if (!projectId) throw new Error("No project is open.");
    if (!DOCUMENT_EDITS(route))
      throw new Error(`${route.path} is not a document edit`);
    const edit = route as Route<string, unknown, MutationResponse>;
    await mutate((tx) => send(edit, { id: projectId }, { body, tx }));
  },
};

const ModuleLengthField = (props: NumberFieldProps & { label: string }) =>
  createElement(LengthField, { ...props, units: useSetting("units.length") });

const ui: ClientUi = {
  DraggablePanel,
  DialogFooter,
  NumField,
  LengthField: ModuleLengthField,
  AngleField,
  SelectField,
  CheckField,
  openPanel,
  closePanel,
};

function moduleContext(own: Dispose[], moduleId: string) {
  const track =
    <A extends unknown[]>(register: (...args: A) => Dispose) =>
    (...args: A) => {
      const dispose = register(...args);
      own.push(dispose);
      return dispose;
    };
  const register = {
    command: track((command: ModuleCommand) =>
      registerCommand(guarded(iconed(moduleId, command))),
    ),
    toolbarGroup: track(registerToolbarGroup),
    panel: track(registerPanel),
    workbench: track((workbench: Workbench) =>
      registerWorkbench(guardedWorkbench(workbench)),
    ),
    selectionKind: track(registerSelectionKind),
    pickProvider: track(registerPickProvider),
    layer: track((layer: Layer) => registerModuleLayer(moduleId, layer)),
  };
  return {
    register,
    project: { ...project, subscribe: track(project.subscribe) },
    ui,
  };
}

export interface ModuleContext extends ClientContext {
  register: ReturnType<typeof moduleContext>["register"];
}

export interface HostModule {
  manifest: { id: string };
  client: { activate(context: ModuleContext): void | Promise<void> };
  icons?: Readonly<Record<string, string>>;
}

const disposeAll = (disposers: readonly Dispose[]) => {
  for (const dispose of disposers.toReversed()) dispose();
};

export async function loadClientModules(
  modules: readonly HostModule[],
  report: () => Promise<readonly ModuleInfo[]>,
): Promise<Dispose> {
  const reports = await report().catch((error: Error) => {
    useStore.getState().setError(error.message);
    return [];
  });
  const loaded = new Set(
    reports.filter((m) => m.status === "loaded").map((m) => m.id),
  );
  const disposers: Dispose[] = [];
  for (const module of modules) {
    if (!loaded.has(module.manifest.id)) continue;
    const own: Dispose[] = [];
    try {
      registerModuleIcons(own, module);
      await module.client.activate(moduleContext(own, module.manifest.id));
      disposers.push(() => disposeAll(own));
    } catch (error) {
      disposeAll(own);
      console.error(
        `[rockett] module ${module.manifest.id} failed: ${messageOf(error)}`,
      );
    }
  }
  return () => disposeAll(disposers);
}
