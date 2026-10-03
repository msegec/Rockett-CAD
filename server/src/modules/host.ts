import {
  PLUGIN_API_VERSION,
  type Dispose,
  type ServerContext,
  type StartKernelJob,
} from "@rockett/plugin-api";
import {
  createRegistry,
  parseManifest,
  REGISTRY_ID,
  registerExtensionSpec,
  type ModuleInfo,
} from "@rockett/shared";
import { registerImporter } from "../api/importers.js";
import { registerRouteModule } from "../api/routeModules.js";
import { registerExporter } from "../geometry/exporters.js";
import { registerFeatureKind } from "../geometry/featureKinds.js";
import type { KernelClient } from "../kernel/client.js";
import { moduleUserData } from "../store/moduleData.js";
import type { Storage } from "../store/storage.js";

type Kernel = Pick<KernelClient, "moduleJob">;

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

function registrars(own: Dispose[], moduleId: string) {
  const track =
    <A extends unknown[]>(register: (...args: A) => Dispose) =>
    (...args: A) => {
      const dispose = register(...args);
      own.push(dispose);
      return dispose;
    };
  return {
    routeModule: track(registerRouteModule),
    exporter: track(registerExporter),
    importer: track(registerImporter),
    featureKind: track(registerFeatureKind),
    extensionSpec: track(registerExtensionSpec),
    kernelJob: track((id: string, entry: URL) =>
      registerKernelJob(moduleId, id, entry),
    ),
  };
}

export interface ModuleContext extends ServerContext {
  register: ReturnType<typeof registrars>;
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

async function load(
  module: HostModule,
  own: Dispose[],
  kernel: Kernel,
  storage: Storage,
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
  if (check.status === "incompatible")
    return { ...info, status: "incompatible", error: check.reason };
  try {
    const { id } = check.manifest;
    await module.server.activate({
      register: registrars(own, id),
      startKernelJob: starter(id, kernel),
      userData: moduleUserData(storage, id),
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
  storage: Storage,
): Promise<Dispose> {
  const disposers: Dispose[] = [];
  const reports: ModuleInfo[] = [];
  for (const module of modules) {
    const own: Dispose[] = [];
    reports.push(await load(module, own, kernel, storage));
    disposers.push(() => disposeAll(own));
  }
  loaded = reports;
  return () => {
    disposeAll(disposers);
    loaded = [];
  };
}
