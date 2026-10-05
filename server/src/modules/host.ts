import {
  PLUGIN_API_VERSION,
  type Dispose,
  type ProjectServiceHandler,
  type ServerContext,
  type StartKernelJob,
} from "@rockett/plugin-api";
import {
  createRegistry,
  moduleEnabledSetting,
  moduleHostSettings,
  parseManifest,
  REGISTRY_ID,
  registerExtensionSpec,
  registerModuleSetting,
  registerSettings,
  resolveSettings,
  SETTINGS,
  ValidationError,
  type FaceRef,
  type LayerValues,
  type ModuleInfo,
  type ModuleManifest,
  type SettingDefinition,
} from "@rockett/shared";
import { signAt } from "../api/featureRoutes.js";
import { registerImporter } from "../api/importers.js";
import { registerRouteModule } from "../api/routeModules.js";
import { registerExporter } from "../geometry/exporters.js";
import { registerFeatureKind } from "../geometry/featureKinds.js";
import type { KernelClient } from "../kernel/client.js";
import type { FolderStore } from "../store/folderStore.js";
import { moduleUserData } from "../store/moduleData.js";
import { StoreError, type ProjectStore } from "../store/projectStore.js";
import {
  canView,
  finalModel,
  moduleBodies,
  type BodyKernel,
} from "./bodies.js";
import { moduleFiles } from "./files.js";
import { provideService } from "./services.js";

type Kernel = Pick<KernelClient, "moduleJob"> & BodyKernel;

declare const KERNEL_BUNDLES: Readonly<Record<string, string>>;

const kernelJobs = createRegistry<{ id: string; entry: string }>(
  "kernel job",
  (job) => job.id,
);

function jobEntry(moduleId: string, entry: URL) {
  if (typeof KERNEL_BUNDLES !== "object") return entry.href;
  const bundle = Object.hasOwn(KERNEL_BUNDLES, moduleId)
    ? KERNEL_BUNDLES[moduleId]
    : undefined;
  if (bundle === undefined || !entry.pathname.endsWith("/kernel.ts"))
    throw new Error(
      `kernel job entry ${entry.href} is not the kernel.ts that ${moduleId} ships`,
    );
  return bundle;
}

function registerKernelJob(moduleId: string, id: string, entry: URL) {
  if (!id.startsWith(`${moduleId}.`) || !REGISTRY_ID.test(id))
    throw new Error(
      `kernel job ${id} must start with ${moduleId}. and name a valid id`,
    );
  return kernelJobs.register({ id, entry: jobEntry(moduleId, entry) });
}

const starter =
  (moduleId: string, kernel: Kernel): StartKernelJob =>
  async (id, input, run = {}) => {
    const job = id.startsWith(`${moduleId}.`) ? kernelJobs.get(id) : undefined;
    if (!job)
      throw new Error(`kernel job ${id} is not registered by ${moduleId}`);
    return kernel.moduleJob(job.entry, id, input, {
      onProgress: (...args) => run.onProgress?.(...args),
      shouldStop: () => run.signal?.aborted === true,
    });
  };

function registrars(own: Dispose[], manifest: ModuleManifest) {
  const moduleId = manifest.id;
  const track =
    <A extends unknown[]>(register: (...args: A) => Dispose) =>
    (...args: A) => {
      const dispose = register(...args);
      own.push(dispose);
      return dispose;
    };
  return {
    register: {
      routeModule: track((module: Parameters<typeof registerRouteModule>[0]) =>
        registerRouteModule(module, moduleId),
      ),
      exporter: track(registerExporter),
      importer: track(registerImporter),
      featureKind: track(registerFeatureKind),
      extensionSpec: track(registerExtensionSpec),
      kernelJob: track((id: string, entry: URL) =>
        registerKernelJob(moduleId, id, entry),
      ),
      setting: track((definition: SettingDefinition) =>
        registerModuleSetting(manifest, definition),
      ),
    },
    services: {
      provide: track((id: string, handler: ProjectServiceHandler) =>
        provideService(moduleId, id, handler),
      ),
    },
  };
}

export interface ModuleContext extends ServerContext {
  register: ReturnType<typeof registrars>["register"];
}

export interface HostModule {
  manifest: unknown;
  server: { activate(context: ModuleContext): void | Promise<void> };
}

const ABOUT = ["id", "name", "version", "licence", "author"] as const;
type About = Pick<ModuleInfo, (typeof ABOUT)[number]>;

function about(manifest: unknown): About {
  const raw: Record<string, unknown> =
    typeof manifest === "object" && manifest !== null ? { ...manifest } : {};
  return Object.fromEntries(
    ABOUT.map((key) => [key, typeof raw[key] === "string" ? raw[key] : ""]),
  ) as About;
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const disposeAll = (disposers: readonly Dispose[]) => {
  for (const dispose of disposers.toReversed()) dispose();
};

function enabled(moduleId: string, app: LayerValues) {
  registerSettings(
    moduleHostSettings(moduleId).filter(({ key }) => !SETTINGS.has(key)),
  );
  const { key } = moduleEnabledSetting(moduleId);
  return resolveSettings({ app }).values[key]?.value !== false;
}

const signFaces =
  (
    kernel: Kernel,
    store: ProjectStore,
    folders: FolderStore,
  ): ServerContext["signFaces"] =>
  async (projectId, user, refs) => {
    if (!(await canView(store, folders, user, projectId)))
      throw new StoreError("project not found", "not_found");
    const doc = finalModel(await store.load(projectId));
    const faces = refs.map(({ bodyId, faceName }): FaceRef => ({
      kind: "face",
      bodyId,
      faceName,
    }));
    await signAt(kernel, doc, doc.timelinePosition, faces);
    return faces.map(({ kind, bodyId, faceName, sig }) => {
      if (!sig)
        throw new ValidationError(
          `face ${faceName} of body ${bodyId} is not in the model`,
        );
      return { kind, bodyId, faceName, sig };
    });
  };

async function load(
  module: HostModule,
  own: Dispose[],
  kernel: Kernel,
  store: ProjectStore,
  folders: FolderStore,
  app: LayerValues,
): Promise<ModuleInfo> {
  let check;
  try {
    check = parseManifest(module.manifest, PLUGIN_API_VERSION);
  } catch (error) {
    return {
      ...about(module.manifest),
      status: "failed",
      error: message(error),
    };
  }
  const info = about(check.manifest);
  if (!enabled(check.manifest.id, app))
    return { ...info, status: "disabled", error: null };
  if (check.status === "incompatible")
    return { ...info, status: "incompatible", error: check.reason };
  try {
    const { id } = check.manifest;
    const { storage } = store.documents.options;
    await module.server.activate({
      ...registrars(own, check.manifest),
      startKernelJob: starter(id, kernel),
      userData: moduleUserData(storage, id),
      files: moduleFiles(storage, id),
      get kernelVersion() {
        return kernel.version();
      },
      bodies: moduleBodies(kernel, store, folders),
      signFaces: signFaces(kernel, store, folders),
    });
  } catch (error) {
    disposeAll(own.splice(0));
    return { ...info, status: "failed", error: message(error) };
  }
  return { ...info, status: "loaded", error: null };
}

let loaded: readonly ModuleInfo[] = [];

export const listModules = () => loaded;

export async function loadModules(
  modules: readonly HostModule[],
  kernel: Kernel,
  store: ProjectStore,
  folders: FolderStore,
): Promise<Dispose> {
  const disposers: Dispose[] = [];
  const reports: ModuleInfo[] = [];
  const app = await store.settings.read({ scope: "app" });
  for (const module of modules) {
    const own: Dispose[] = [];
    reports.push(await load(module, own, kernel, store, folders, app));
    disposers.push(() => disposeAll(own));
  }
  loaded = reports;
  return () => {
    disposeAll(disposers);
    loaded = [];
  };
}
