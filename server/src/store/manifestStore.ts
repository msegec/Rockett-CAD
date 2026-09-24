import {
  createManifest,
  DOCUMENT_TYPES,
  type ProjectManifest,
} from "@rockett/shared";
import { JsonStore, StoreError } from "./jsonStore.js";
import { manifestMigrations } from "./migrations.js";
import type { Storage } from "./storage.js";

export const ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MANIFEST = "project.json";

export function checkManifest(id: string, manifest: ProjectManifest): void {
  const types = new Set<unknown>(DOCUMENT_TYPES);
  if (!Array.isArray(manifest.documents))
    throw new Error("documents is not a list");
  for (const document of manifest.documents) {
    if (!types.has(document?.type))
      throw new Error(`unknown document type ${String(document?.type)}`);
    if (typeof document.id !== "string" || !ID_RE.test(document.id))
      throw new Error(`invalid document id ${String(document.id)}`);
  }
  const [first] = manifest.documents;
  if (first?.id !== id || first.type !== "part")
    throw new Error(`the first document is not part ${id}`);
}

export class ManifestStore {
  private readonly manifests: JsonStore<ProjectManifest>;

  constructor(private readonly storage: Storage) {
    this.manifests = new JsonStore({
      storage,
      root: "projects",
      name: "project",
      key: ID_RE,
      file: () => MANIFEST,
      migrations: manifestMigrations,
    });
  }

  read(id: string): Promise<ProjectManifest> {
    return this.manifests.read(id).catch((err) => {
      if (!(err instanceof StoreError && err.code === "not_found")) throw err;
      return createManifest(id);
    });
  }

  created(id: string): [string, string] {
    return this.manifests.encode(id, createManifest(id));
  }

  async missing(id: string): Promise<boolean> {
    const files = await this.storage.list(this.manifests.dir(id));
    return !files.includes(MANIFEST);
  }
}
