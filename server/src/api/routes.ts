import { Router, json, type RequestHandler } from "express";
import {
  DOCUMENT_EDITS,
  MB,
  nextFeatureName,
  parse,
  projectEdge,
  ROUTES,
  SCHEMA_VERSION,
  TX_HEADER,
  ValidationError,
  type ApiErrorBody,
  type ApiErrorCode,
  type CadDocument,
  type EvaluateResult,
  type ExportRequest,
  type Feature,
  type Method,
  type Route,
  unsignedRefs,
} from "@rockett/shared";
import { build } from "../build.js";
import type { ProjectStore } from "../store/projectStore.js";
import { splitView } from "../store/migrations.js";
import type { FolderStore } from "../store/folderStore.js";
import { StoreError } from "../store/projectStore.js";
import { ProjectQueue } from "../store/projectQueue.js";
import { HistoryStore } from "../store/historyStore.js";
import { engineFor, dropEngine } from "../geometry/engine.js";
import { kernelVersion } from "../geometry/kernel.js";
import { measure } from "../geometry/measure.js";
import { resolvePlaneFrame } from "../geometry/features.js";
import { computeEdgeNames } from "../geometry/naming.js";
import { curveInfo } from "../geometry/tessellate.js";
import { signRefs } from "../geometry/signature.js";
import { lacksTargets, pinTargets } from "../geometry/pinRefs.js";
import {
  acceptedNamingUpgrade,
  namingUpgraded,
  stageNamingUpgrade,
} from "../geometry/upgradeNaming.js";
import { tangentEdges } from "../geometry/tangentEdges.js";
import { importerFor, IMPORTERS } from "../geometry/importers.js";
import { EXPORT_QUALITY, write3mf, writeStl } from "../geometry/exporters.js";
import type { NamedBody } from "../geometry/naming.js";
import {
  knownKeys,
  record,
  validateDocument,
  validateFeature,
} from "./validate.js";
import {
  downloadProjectFile,
  safeFileName,
  uploadProjectFile,
} from "./projectFile.js";
import { folderRoutes } from "./folderRoutes.js";
import {
  discarding,
  IMPORT_LIMITS,
  JSON_BODY_LIMIT_BYTES,
  readUpload,
  receiveImage,
  receiveImport,
  receiveProjectFile,
  type ImportLimits,
  type Upload,
} from "./uploads.js";
import {
  checkRevision,
  ifMatchRevision,
  keepNamingVersion,
  reply,
  RevisionConflict,
  transactionId,
} from "./revision.js";
import { omitHeldMeshes } from "./heldMeshes.js";

const STATUS: Record<ApiErrorCode, number> = {
  validation: 400,
  not_found: 404,
  too_large: 413,
  conflict: 409,
  precondition_required: 428,
  unprocessable: 422,
  kernel: 503,
  internal: 500,
};

function sendError(res: any, body: ApiErrorBody) {
  res.status(STATUS[body.code]).json(body);
}

function fail(res: any, err: any) {
  const code: ApiErrorCode =
    err instanceof StoreError || err instanceof ValidationError
      ? err.code
      : "internal";
  if (code !== "internal")
    return sendError(res, {
      error: err.message,
      code,
      ...(err.detail !== undefined && { detail: err.detail }),
      ...(err instanceof RevisionConflict && { revision: err.revision }),
    });
  console.error(err);
  sendError(res, { error: "Internal server error", code });
}

function check(test: (req: any, res: any) => void): RequestHandler {
  return (req, res, next) => {
    try {
      test(req, res);
    } catch (err) {
      return fail(res, err);
    }
    next();
  };
}

const parseBody = (schema: NonNullable<Route["body"]>) =>
  check((req) => (req.body = parse(schema, req.body ?? {})));

const requireRevision = check((req, res) => {
  res.locals.revision = ifMatchRevision(req.get("If-Match"));
});

const EXPORTERS: Record<
  ExportRequest["format"],
  {
    mime: string;
    write: (bodies: NamedBody[], doc: CadDocument, quality: number) => Buffer;
  }
> = {
  stl: {
    mime: "model/stl",
    write: (bodies, _doc, quality) => writeStl(bodies, quality),
  },
  "3mf": {
    mime: "application/vnd.ms-package.3dmanufacturing-3dmodel+xml",
    write: (bodies, doc, quality) =>
      write3mf(
        bodies.map((b) => ({
          body: b,
          name: doc.bodyMeta[b.bodyId]?.name ?? b.bodyId,
        })),
        quality,
      ),
  },
};

interface Mutation {
  label: string;
  document?: CadDocument;
  position?: number | undefined;
  [extra: string]: unknown;
}

type Edit = (doc: CadDocument, req: any) => Promise<Mutation>;

const KEEPS_TARGETS = new Set(["name", "suppressed"]);

function retargets(patch: object): boolean {
  return (
    !("targets" in patch) &&
    Object.keys(patch).some((key) => !KEEPS_TARGETS.has(key))
  );
}

function evaluationPosition(req: any, doc: CadDocument): number | undefined {
  if (req.query.position === undefined) return undefined;
  const position = Number(req.query.position);
  if (
    !Number.isInteger(position) ||
    position < 0 ||
    position > doc.features.length
  )
    throw new ValidationError("invalid evaluation position");
  return position;
}

function pruneGroups(
  doc: CadDocument,
  evaluation: EvaluateResult,
  position: number | undefined,
): boolean {
  const sketches = new Set(
    doc.features.filter((f) => f.type === "sketch").map((f) => f.id),
  );
  const bodies =
    position === undefined && doc.timelinePosition === doc.features.length
      ? new Set(evaluation.bodies.map((b) => b.bodyId))
      : null;
  let changed = false;
  for (const group of doc.groups) {
    const kept = group.members.filter((id) =>
      group.kind === "sketch" ? sketches.has(id) : (bodies?.has(id) ?? true),
    );
    changed ||= kept.length !== group.members.length;
    group.members = kept;
  }
  return changed;
}

export function createApiRouter(
  store: ProjectStore,
  folders: FolderStore,
  projects = new ProjectQueue(),
  limits: Partial<ImportLimits> = {},
): Router {
  const { uploadBytes, importBytes } = { ...IMPORT_LIMITS, ...limits };
  const router = Router();
  const history = new HistoryStore(store.documents.options.storage, store);
  router.use(json({ limit: JSON_BODY_LIMIT_BYTES }), check(omitHeldMeshes));
  const on = (route: Route, ...handlers: RequestHandler[]) =>
    router[route.method.toLowerCase() as Lowercase<Method>](
      route.path,
      ...(route.body ? [parseBody(route.body)] : []),
      ...(DOCUMENT_EDITS.has(route) ? [requireRevision] : []),
      ...handlers,
    );

  // Serialize the whole load/edit/save/evaluate operation for each project.
  // Locking only save() would still allow two requests to edit stale copies.
  const wrap =
    (fn: (req: any, res: any) => Promise<void>) => (req: any, res: any) => {
      const { id } = req.params;
      const result = id
        ? projects.run(id, () => store.touch(id).then(() => fn(req, res)))
        : fn(req, res);
      result.catch((err) => fail(res, err));
    };

  const editable = async (req: any, res: any) => {
    const doc = await store.load(req.params.id);
    checkRevision(doc, res.locals.revision);
    return doc;
  };

  const send = (res: any, doc: CadDocument, evaluation?: EvaluateResult) =>
    reply(res, { document: doc, ...(evaluation && { evaluation }) });

  async function sourced(doc: CadDocument) {
    const engine = engineFor(doc.id);
    return { engine, sources: await store.sources(doc, engine.sources) };
  }

  async function evaluate(doc: CadDocument, position?: number) {
    const { engine, sources } = await sourced(doc);
    return engine.evaluate(doc, position, sources);
  }

  async function stateAt(doc: CadDocument, position?: number) {
    const { engine, sources } = await sourced(doc);
    return engine.stateAt(doc, position, sources);
  }

  async function pinned(doc: CadDocument, index: number) {
    const feature = doc.features[index]!;
    if (!lacksTargets(feature)) return;
    const evaluation = await evaluate(doc, index + 1);
    pinTargets(feature, evaluation.featureStatuses[index]!);
  }

  async function signed(
    doc: CadDocument,
    index: number,
    feature: Feature,
    previous?: Feature,
  ) {
    const missing = unsignedRefs(feature, previous);
    if (missing.length) signRefs((await stateAt(doc, index)).bodies, missing);
  }

  async function evaluateAndSync(doc: CadDocument, position?: number) {
    const evaluation = await evaluate(doc, position);
    let metaChanged = pruneGroups(doc, evaluation, position);
    for (const body of evaluation.bodies) {
      if (!doc.bodyMeta[body.bodyId]) {
        const n = (doc.counters["body"] ?? 0) + 1;
        doc.counters["body"] = n;
        doc.bodyMeta[body.bodyId] = { name: `Body${n}` };
        metaChanged = true;
      }
    }
    if (metaChanged)
      evaluation.bodies = evaluation.bodies.map((body) => ({
        ...body,
        name: doc.bodyMeta[body.bodyId]!.name,
      }));
    return evaluation;
  }

  const mutateProject = (edit: Edit) =>
    wrap(
      discarding(store.uploads, async (req, res) => {
        const tx = transactionId(req.get(TX_HEADER));
        const loaded = await editable(req, res);
        const {
          label,
          position,
          document = loaded,
          ...extra
        } = await edit(loaded, req);
        const evaluation = await evaluateAndSync(document, position);
        await history.save(document, label, tx);
        reply(res, { ...extra, document, evaluation });
      }),
    );

  on(ROUTES.health, (_req, res) => {
    res.json({
      ok: true,
      ...build(),
      schemaVersion: SCHEMA_VERSION,
      describe: process.env.ROCKETT_DESCRIBE || null,
      kernelVersion: kernelVersion(),
    });
  });

  on(
    ROUTES.listProjects,
    wrap(async (_req, res) => {
      res.json(await store.list());
    }),
  );

  on(
    ROUTES.createProject,
    wrap(async (req, res) => {
      const name = (req.body.name ?? "Untitled").slice(0, 200);
      const { folderId } = req.body;
      const doc =
        folderId === undefined
          ? await store.create(name)
          : await folders.createIn(folderId, () => store.create(name));
      res.json({ document: doc });
    }),
  );

  on(ROUTES.downloadProjectFile, wrap(downloadProjectFile(store)));
  on(
    ROUTES.uploadProjectFile,
    receiveProjectFile,
    wrap(uploadProjectFile(store, folders)),
  );

  on(
    ROUTES.getProject,
    wrap(async (req, res) => {
      send(res, await store.load(req.params.id));
    }),
  );

  on(
    ROUTES.deleteProject,
    wrap(async (req, res) => {
      await store.remove(req.params.id);
      dropEngine(req.params.id);
      await folders.place(req.params.id, null);
      res.json({ ok: true });
    }),
  );

  on(
    ROUTES.duplicateProject,
    wrap(async (req, res) => {
      const copy = await store.duplicate(
        req.params.id,
        req.body.name ? req.body.name.slice(0, 200) : undefined,
      );
      res.json({ document: copy });
    }),
  );

  on(
    ROUTES.renameProject,
    wrap(async (req, res) => {
      const doc = await editable(req, res);
      doc.name = (req.body.name ?? doc.name).slice(0, 200);
      await store.save(doc);
      send(res, doc);
    }),
  );

  for (const [route, handler] of folderRoutes(folders, store))
    on(route, wrap(handler));

  on(
    ROUTES.evaluate,
    wrap(async (req, res) => {
      const doc = await store.load(req.params.id);
      res.json(await evaluate(doc, evaluationPosition(req, doc)));
    }),
  );

  on(
    ROUTES.replaceDocument,
    mutateProject(async (stored, req) => {
      const sent = req.body?.document;
      if (!sent || sent.id !== req.params.id)
        throw new ValidationError("document id mismatch");
      validateDocument(sent);
      const document = splitView(sent).doc as unknown as CadDocument;
      const position = evaluationPosition(req, document);
      if (!(await namingUpgraded(store, stored.id)))
        keepNamingVersion(stored, document);
      return { label: "Replace document", document, position };
    }),
  );

  const receiveStep = receiveImport(store.uploads, uploadBytes);
  type Received = Awaited<ReturnType<typeof received>>;
  async function received(req: any) {
    const file: Upload | undefined = req.file,
      importer = file && importerFor(file.originalname);
    if (!file || !importer)
      throw new ValidationError(
        `Choose a ${IMPORTERS.flatMap((i) => i.extensions).join(", ")} file`,
      );
    const filename = file.originalname.replace(/^.*[\\/]/, "").slice(0, 255);
    const { features, sources } = importer.read(
      await readUpload(store.uploads, file, importBytes),
      filename,
    );
    features.forEach(validateFeature);
    return { file, importer, filename, features, sources };
  }
  async function insert(doc: CadDocument, upload: Received) {
    const { file, importer, features, sources } = upload;
    try {
      const at = Math.min(doc.timelinePosition, doc.features.length);
      doc.features.splice(at, 0, ...features);
      doc.timelinePosition = at + features.length;
      if (Buffer.byteLength(JSON.stringify(doc), "utf8") > 40 * MB)
        throw new ValidationError(
          `This import would exceed the 40 MB project limit. Start a separate project for this ${importer.label} file.`,
        );
      const held = await sourced(doc);
      const evaluation = held.engine.evaluate(
        doc,
        undefined,
        new Map([...held.sources, ...sources]),
      );
      for (const feature of features) {
        const status = evaluation.featureStatuses.find(
          (s) => s.featureId === feature.id,
        );
        if (status?.status !== "ok" && status?.status !== "warning")
          throw new ValidationError(
            status?.error ?? `${importer.label} import failed`,
          );
      }
      for (const [hash, bytes] of sources)
        await (hash === file.hash
          ? store.blobs(doc.id).adopt(file)
          : store.blobs(doc.id).put(bytes));
      return { label: `Import ${upload.filename}` };
    } catch (error) {
      dropEngine(doc.id);
      throw error;
    }
  }
  on(
    ROUTES.importStep,
    receiveStep,
    wrap(
      discarding(store.uploads, async (req, res) => {
        const upload = await received(req);
        const doc = await store.create(upload.filename.replace(/\.[^.]*$/, ""));
        try {
          await insert(doc, upload);
          const evaluation = await evaluateAndSync(doc);
          await store.save(doc);
          send(res, doc, evaluation);
        } catch (error) {
          dropEngine(doc.id);
          await store.remove(doc.id);
          throw error;
        }
      }),
    ),
  );
  on(
    ROUTES.importStepInto,
    receiveStep,
    mutateProject(async (doc, req) => insert(doc, await received(req))),
  );

  on(
    ROUTES.addFeature,
    mutateProject(async (doc, req) => {
      const feature = req.body?.feature as Feature;
      record(feature, "feature");
      knownKeys(feature, feature.type);
      feature.name ||= nextFeatureName(doc, feature.type);
      validateFeature(feature);
      if (doc.features.some((f) => f.id === feature.id))
        throw new ValidationError("duplicate feature id");
      const at = Math.min(doc.timelinePosition, doc.features.length);
      await signed(doc, at, feature);
      doc.features.splice(at, 0, feature);
      doc.timelinePosition = at + 1;
      await pinned(doc, at);
      return { label: `Add ${feature.name}` };
    }),
  );

  on(
    ROUTES.updateFeature,
    mutateProject(async (doc, req) => {
      const position = evaluationPosition(req, doc);
      const idx = doc.features.findIndex((f) => f.id === req.params.fid);
      const current = doc.features[idx];
      if (!current) throw new StoreError("feature not found", "not_found");
      const patch = req.body?.feature as Partial<Feature>;
      record(patch, "feature");
      if (patch.type !== undefined && patch.type !== current.type)
        throw new ValidationError("feature type cannot change");
      knownKeys(patch, current.type);
      const updated = { ...current, ...patch, id: current.id } as Feature;
      if (retargets(patch)) Reflect.deleteProperty(updated, "targets");
      validateFeature(updated);
      await signed(doc, idx, updated, current);
      doc.features[idx] = updated;
      await pinned(doc, idx);
      return { label: `Edit ${updated.name}`, position };
    }),
  );

  // Resolve against geometry BEFORE the sketch, so projections cannot depend
  // on their own extrude or another downstream feature. This is read-only.
  on(
    ROUTES.projectEdge,
    wrap(async (req, res) => {
      const doc = await store.load(req.params.id);
      const index = doc.features.findIndex((f) => f.id === req.params.fid);
      const sketch = doc.features[index];
      if (!sketch || sketch.type !== "sketch")
        throw new ValidationError("Sketch not found");
      const { edge: ref, entityId } = req.body;
      const state = await stateAt(doc, index);
      const body = state.bodies.get(ref.bodyId);
      const edge = body && computeEdgeNames(body).byName.get(ref.edgeName);
      if (!edge)
        throw new ValidationError(
          "This edge is not available before the sketch. Choose geometry from an earlier feature.",
        );
      try {
        res.json({
          entities: projectEdge(
            curveInfo(edge),
            resolvePlaneFrame(state, sketch.plane),
            entityId,
            ref,
          ),
        });
      } catch (error) {
        throw new ValidationError((error as Error).message);
      }
    }),
  );

  on(
    ROUTES.deleteFeature,
    mutateProject(async (doc, req) => {
      const idx = doc.features.findIndex((f) => f.id === req.params.fid);
      if (idx < 0) throw new StoreError("feature not found", "not_found");
      const [deleted] = doc.features.splice(idx, 1);
      if (doc.timelinePosition > idx) doc.timelinePosition--;
      return { label: `Delete ${deleted!.name}` };
    }),
  );

  on(
    ROUTES.setTimeline,
    mutateProject(async (doc, req) => {
      const { position } = req.body;
      if (position > doc.features.length)
        throw new ValidationError("invalid timeline position", "/position");
      doc.timelinePosition = position;
      return { label: "Roll timeline" };
    }),
  );

  on(
    ROUTES.tangentEdges,
    wrap(async (req, res) => {
      const doc = await store.load(req.params.id);
      const { edge, beforeFeatureId } = req.body;
      const index =
        beforeFeatureId === undefined
          ? undefined
          : doc.features.findIndex((f) => f.id === beforeFeatureId);
      if (index === -1) throw new ValidationError("Feature not found");
      const state = await stateAt(doc, index);
      const body = state.bodies.get(edge.bodyId);
      if (!body)
        throw new ValidationError("Body not found before this feature");
      try {
        res.json({ edges: tangentEdges(body, [edge]) });
      } catch (error) {
        throw new ValidationError((error as Error).message);
      }
    }),
  );

  on(
    ROUTES.updateGroups,
    mutateProject(async (doc, req) => {
      doc.groups = req.body.groups;
      return { label: "Edit groups" };
    }),
  );

  on(
    ROUTES.updateBody,
    mutateProject(async (doc, req) => {
      const meta = doc.bodyMeta[req.params.bodyId];
      if (!meta) throw new StoreError("body not found", "not_found");
      const label = `Rename ${meta.name}`;
      if (req.body.name !== undefined) meta.name = req.body.name.slice(0, 120);
      return { label };
    }),
  );

  on(
    ROUTES.stageNamingUpgrade,
    wrap(async (req, res) => {
      const doc = await store.load(req.params.id);
      res.json(await stageNamingUpgrade(store, doc, req.body.accept));
    }),
  );

  on(
    ROUTES.commitNamingUpgrade,
    mutateProject(async (doc, req) => ({
      label: "Upgrade naming",
      ...(await acceptedNamingUpgrade(store, doc, req.body.accept)),
    })),
  );

  on(
    ROUTES.getView,
    wrap(async (req, res) => {
      res.json(await store.view(req.params.id));
    }),
  );

  on(
    ROUTES.putView,
    wrap(async (req, res) => {
      await store.setView(req.params.id, req.body);
      res.json(req.body);
    }),
  );

  on(
    ROUTES.measure,
    wrap(async (req, res) => {
      const doc = await store.load(req.params.id);
      const state = await stateAt(doc);
      res.json(measure(state, req.body));
    }),
  );

  on(
    ROUTES.exportModel,
    wrap(async (req, res) => {
      const { doc, view } = await store.open(req.params.id);
      const {
        format,
        bodyIds: requestedIds,
        quality = EXPORT_QUALITY,
        retain,
      }: ExportRequest = req.body;
      const exporter = EXPORTERS[format];
      const state = await stateAt(doc);
      const missing = requestedIds.filter((id) => !state.bodies.has(id));
      if (missing.length)
        throw new ValidationError(
          `export bodies not in the model: ${missing.join(", ")}`,
        );
      const chosen = [...state.bodies.values()].filter((b) => {
        if (requestedIds.length > 0) return requestedIds.includes(b.bodyId);
        return !view.hidden.bodies.includes(b.bodyId);
      });
      if (chosen.length === 0) {
        throw new ValidationError("no bodies to export");
      }
      const blocked = chosen.filter((b) => state.blocked.has(b.bodyId));
      if (blocked.length)
        throw new StoreError(
          `export bodies depend on unresolved references: ${blocked.map((b) => b.bodyId).join(", ")}`,
          "unprocessable",
        );
      const safeName = safeFileName(doc.name) || "model";
      const data = exporter.write(
        chosen,
        doc,
        Math.min(Math.max(quality, 0.001), 1),
      );
      const fileName = `${safeName}.${format}`;
      res.setHeader("Content-Type", exporter.mime);
      if (retain) {
        await store.saveExport(doc.id, fileName, data);
      }
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${fileName}"`,
      );
      res.send(data);
    }),
  );

  on(
    ROUTES.uploadImage,
    receiveImage,
    wrap(async (req, res) => {
      await store.load(req.params.id); // ensure project exists
      if (!req.file) throw new ValidationError("image file required");
      const { assetId } = await store.saveAsset(req.params.id, req.file.buffer);
      res.json({ assetId });
    }),
  );

  on(
    ROUTES.asset,
    wrap(async (req, res) => {
      const asset = await store.readAsset(req.params.id, req.params.assetId);
      res.type(asset.mime).send(asset.data);
    }),
  );

  return router;
}
