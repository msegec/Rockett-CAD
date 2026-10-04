import type { ServerContext } from "@rockett/plugin-api";
import {
  Placement,
  resolveDocumentParameters,
  type User,
} from "@rockett/shared";
import { projectAccess } from "../api/projectAccess.js";
import { bodyFingerprint } from "../geometry/fingerprint.js";
import type { KernelClient } from "../kernel/client.js";
import type { FolderStore } from "../store/folderStore.js";
import { StoreError, type ProjectStore } from "../store/projectStore.js";

export type BodyKernel = Pick<
  KernelClient,
  "evaluate" | "stateQuery" | "version"
>;

async function canView(
  store: ProjectStore,
  folders: FolderStore,
  user: User,
  projectId: string,
) {
  try {
    return (await projectAccess(store, folders, user, projectId)) !== undefined;
  } catch (error) {
    if (error instanceof StoreError && error.code === "not_found") return false;
    throw error;
  }
}

export function moduleBodies(
  kernel: BodyKernel,
  store: ProjectStore,
  folders: FolderStore,
): ServerContext["bodies"] {
  return async (projectId, user) => {
    if (!(await canView(store, folders, user, projectId)))
      throw new StoreError("project not found", "not_found");
    const doc = await store.load(projectId);
    const { bodies } = await kernel.evaluate(doc);
    if (bodies.length === 0) return [];
    const breps = await kernel.stateQuery(doc, {
      kind: "brep",
      bodyIds: bodies.map((body) => body.bodyId),
    });
    const sources = await store.sources(doc);
    const resolved = {
      ...doc,
      features: resolveDocumentParameters(doc).features,
    };
    return bodies.map(({ bodyId, name, bbox }, i) => ({
      id: bodyId,
      name,
      bbox,
      brep: breps[i]!,
      fingerprint: bodyFingerprint({
        doc: resolved,
        bodyId,
        sources,
        placement: Placement.identity(),
        selection: [],
        camVersion: "",
        kernel: kernel.version(),
      }),
    }));
  };
}
