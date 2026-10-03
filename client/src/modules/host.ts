import { createElement, type ComponentType } from "react";
import type {
  ClientContext,
  Dispose,
  Layer,
  OpenProject,
  ProjectView,
  Workbench,
} from "@rockett/plugin-api";
import { REGISTRY_ID, type ModuleInfo } from "@rockett/shared";
import {
  registerCommand,
  registerToolbarGroup,
  type Command,
} from "../commands/registry";
import { iconOf, registerModuleIcon } from "../icons";
import { registerSelectionKind } from "../selection/kinds";
import { PanelBoundary, registerPanel } from "../shell/panels";
import { registerWorkbench } from "../shell/workbench";
import { useStore } from "../store";
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

let open: OpenProject = { projectId: null, document: null };

const project: ProjectView = {
  get() {
    const { projectId, document } = useStore.getState();
    if (projectId !== open.projectId || document !== open.document)
      open = { projectId, document };
    return open;
  },
  subscribe: (listener) =>
    useStore.subscribe((now, before) => {
      if (
        now.projectId !== before.projectId ||
        now.document !== before.document
      )
        listener();
    }),
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
