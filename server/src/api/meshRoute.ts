import type { Request, Response } from "express";
import type { CadDocument, MeshedEvaluation } from "@rockett/shared";
import type { ProjectStore } from "../store/projectStore.js";
import type { MeshCache } from "../kernel/meshCache.js";

export function meshRoute(
  store: ProjectStore,
  cache: MeshCache,
  evaluate: (doc: CadDocument) => Promise<MeshedEvaluation>,
): (req: Request, res: Response) => Promise<void> {
  return async (req, res) => {
    const missing = () => {
      res.status(404).json({ error: "mesh not found", code: "not_found" });
    };
    const hash = req.params.hash;
    const projectId = req.params.id;
    if (
      typeof hash !== "string" ||
      typeof projectId !== "string" ||
      !/^[0-9a-f]{64}$/.test(hash)
    )
      return missing();
    const doc = await store.load(projectId);
    let bytes = cache.get(doc.id, doc.revision, hash);
    if (!bytes && cache.rejects(doc.id, doc.revision, hash)) return missing();
    if (!bytes) {
      const result = await evaluate(doc);
      const { bodies } = cache.publish(doc.id, doc.revision, result);
      const at = bodies.findIndex((item) => item.mesh?.hash === hash);
      if (at >= 0)
        bytes =
          cache.get(doc.id, doc.revision, hash) ??
          cache.materialize(result.bodies[at]!);
    }
    if (!bytes) return missing();
    res.set("Cache-Control", "private, max-age=31536000, immutable");
    res.vary("Cookie");
    res.type("application/octet-stream").send(bytes);
  };
}
