/**
 * Rockett CAD server entrypoint.
 *
 * - Initialises the OCCT WASM kernel (once per process)
 * - Serves the REST API under /api
 * - Serves the built client (client/dist) in production
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import type { AddressInfo } from "node:net";
import { DEFAULT_PORT, SCHEMA_VERSION } from "@rockett/shared";
import { initKernel } from "./geometry/kernel.js";
import { ProjectStore } from "./store/projectStore.js";
import { validateDocument } from "./api/validate.js";
import { FolderStore } from "./store/folderStore.js";
import { LocalStorage } from "./store/storage.js";
import { InProcessKernel, type KernelClient } from "./kernel/client.js";
import { WorkerKernel } from "./kernel/workerKernel.js";
import { createApp, scheduleSweep } from "./app.js";
import { parseAllowedOrigins } from "./auth/origin.js";
import { SessionStore } from "./auth/sessions.js";
import { UserStore } from "./auth/userStore.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.ROCKETT_PORT || DEFAULT_PORT);
const DATA_DIR = process.env.DATA_DIR || path.resolve(here, "../../data");

let allowedOrigins: string[];
try {
  allowedOrigins = parseAllowedOrigins(process.env.ROCKETT_ALLOWED_ORIGINS);
} catch (err) {
  console.error(`[rockett] ${(err as Error).message}`);
  process.exit(1);
}

async function startKernel(store: ProjectStore): Promise<KernelClient> {
  if (process.env.ROCKETT_KERNEL !== "inprocess") {
    console.log("[rockett] starting the kernel worker");
    return new WorkerKernel(
      store,
      new URL(
        import.meta.url.endsWith(".ts")
          ? "./kernel/worker.ts"
          : "./kernel-worker.mjs",
        import.meta.url,
      ),
    );
  }
  console.log("[rockett] loading OCCT kernel…");
  const t0 = Date.now();
  await initKernel();
  console.log(`[rockett] kernel ready in ${Date.now() - t0}ms`);
  return new InProcessKernel(store);
}

async function main() {
  const storage = new LocalStorage(DATA_DIR, fs.promises);
  const store = new ProjectStore(storage, validateDocument);
  const kernel = await startKernel(store);
  console.log(`[rockett] data dir: ${DATA_DIR}`);
  const { recovered, outdated, failed } = await store.inventory();
  for (const id of recovered)
    console.log(
      `[rockett] project ${id}: rolled back an interrupted migration`,
    );
  for (const { key, error } of failed)
    console.error(`[rockett] project ${key}: ${error}`);
  if (outdated.length)
    console.log(
      `[rockett] ${outdated.length} projects predate schema ${SCHEMA_VERSION} or the project manifest; each is backed up and migrated on its next save`,
    );

  // static client (production build)
  const candidates = [
    path.resolve(here, "../../client/dist"), // repo layout (dev/prod)
    path.resolve(here, "./client/dist"), // Docker image layout
    path.resolve(here, "../client/dist"),
  ];
  const clientDir = candidates.find((c) =>
    fs.existsSync(path.join(c, "index.html")),
  );
  const { app, sweep } = createApp({
    store,
    folders: new FolderStore(storage),
    kernel,
    clientDir,
    allowedOrigins,
    users: new UserStore(storage),
    sessions: new SessionStore(),
  });
  if (clientDir) {
    console.log(`[rockett] serving client from ${clientDir}`);
  } else {
    console.log(
      "[rockett] no client build found — API only (use Vite dev server)",
    );
  }

  const server = app.listen(PORT, () => {
    const { port } = server.address() as AddressInfo;
    console.log(`[rockett] listening on http://0.0.0.0:${port}`);
  });
  scheduleSweep(server, sweep);
}

main().catch((err) => {
  console.error("[rockett] fatal:", err);
  process.exit(1);
});
