import { createElement, type ComponentType } from "react";
import type {
  ClientContext,
  ClientUi,
  Dispose,
  Layer,
  NumberFieldProps,
  OpenProject,
  ProjectView,
  RouteResponse,
  Workbench,
} from "@rockett/plugin-api";
import {
  DOCUMENT_EDITS,
  moduleHiddenSetting,
  moduleHostSettings,
  nameSection,
  REGISTRY_ID,
  registerSettings,
  SETTINGS,
  type ModuleInfo,
  type Route,
} from "@rockett/shared";
import { request, send, type MutationResponse } from "../api";
import {
  registerCommand,
  registerToolbarGroup,
  type Command,
} from "../commands/registry";
import { iconOf, registerModuleIcon } from "../icons";
import { registerSelectionKind } from "../selection/kinds";
import { confirm } from "../components/ConfirmPanel";
import { ContextMenu } from "../components/ContextMenu";
import { pickFile, saveDownload } from "../download";
import { DraggablePanel } from "../components/DraggablePanel";
import { DialogFooter } from "../components/form/DialogFooter";
import {
  AngleField,
  CheckField,
  LengthField,
  NumField,
  SelectField,
  TextAreaField,
  TextField,
} from "../components/form/fields";
import { getSetting, subscribe, useSetting } from "../settings";
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
  async read(route, params) {
    const { projectId } = useStore.getState();
    if (!projectId) throw new Error("No project is open.");
    if (route.method !== "GET")
      throw new Error(`${route.path} is not a GET route`);
    const get = route as Route<string, unknown, RouteResponse<typeof route>>;
    const reply = await send(get, { ...params, id: projectId });
    if (useStore.getState().projectId !== projectId)
      throw new Error("The open project changed.");
    return reply;
  },
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
  TextField,
  TextAreaField,
  ContextMenu,
  openPanel,
  closePanel,
  confirm,
  download: ({ fileName, data, type }) =>
    saveDownload({ blob: new Blob([data], { type }), fileName }),
  pickFile,
};

const ROUTE_PATH = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/;

const moduleRequest =
  (moduleId: string): ClientContext["request"] =>
  async (method, path, body) => {
    if (!ROUTE_PATH.test(path))
      throw new Error(`${path} is not a route of ${moduleId}`);
    const prefix = `/m/${moduleId.replaceAll(".", "/")}/`;
    return request(method, prefix + path, { body });
  };

type Shown = { show: () => Dispose; hide: Dispose | null };

function hideable(own: Dispose[], moduleId: string) {
  const { key } = moduleHiddenSetting(moduleId);
  const entries = new Set<Shown>();
  own.push(
    subscribe(key, (hidden) => {
      for (const entry of entries) {
        if (hidden !== true) entry.hide ??= entry.show();
        else if (entry.hide) {
          entry.hide();
          entry.hide = null;
        }
      }
    }),
  );
  return <T>(register: (item: T) => Dispose) =>
    (item: T): Dispose => {
      const entry: Shown = { show: () => register(item), hide: null };
      if (getSetting(key) !== true) entry.hide = entry.show();
      entries.add(entry);
      const dispose = () => {
        entries.delete(entry);
        entry.hide?.();
        entry.hide = null;
      };
      own.push(dispose);
      return dispose;
    };
}

function moduleContext(own: Dispose[], moduleId: string) {
  const track =
    <A extends unknown[]>(register: (...args: A) => Dispose) =>
    (...args: A) => {
      const dispose = register(...args);
      own.push(dispose);
      return dispose;
    };
  const shown = hideable(own, moduleId);
  const command = shown(registerCommand);
  const workbench = shown(registerWorkbench);
  const register = {
    command: (item: ModuleCommand) => command(guarded(iconed(moduleId, item))),
    toolbarGroup: shown(registerToolbarGroup),
    panel: shown(registerPanel),
    workbench: (item: Workbench) => workbench(guardedWorkbench(item)),
    selectionKind: track(registerSelectionKind),
    pickProvider: track(registerPickProvider),
    layer: track((layer: Layer) => registerModuleLayer(moduleId, layer)),
  };
  return {
    register,
    project: { ...project, subscribe: track(project.subscribe) },
    ui,
    request: moduleRequest(moduleId),
  };
}

export interface ModuleContext extends ClientContext {
  register: ReturnType<typeof moduleContext>["register"];
}

export interface HostModule {
  manifest: { id: string; name: string };
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
  for (const { manifest } of modules)
    registerSettings(
      moduleHostSettings(manifest.id).filter(({ key }) => !SETTINGS.has(key)),
    );
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
      own.push(
        nameSection(`plugin:${module.manifest.id}`, module.manifest.name),
      );
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
