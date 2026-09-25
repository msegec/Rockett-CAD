import {
  projectEdge,
  ValidationError,
  type CadDocument,
  type EdgeRef,
  type EvaluateResult,
  type ExportRequest,
  type FaceRef,
  type Feature,
  type Formats,
  type Health,
  type MeasureRequest,
  type MeasureResult,
  type NamingDecision,
  type NamingMapping,
  type PlaneRef,
  type RefSignature,
  type SketchEntity,
} from "@rockett/shared";
import { StoreError, type ProjectStore } from "../store/projectStore.js";
import {
  dropEngine,
  engineFor,
  type EvaluateHooks,
} from "../geometry/engine.js";
import { kernelVersion } from "../geometry/kernel.js";
import { measure } from "../geometry/measure.js";
import { resolvePlaneFrame, type EvalState } from "../geometry/features.js";
import { computeEdgeNames } from "../geometry/naming.js";
import { curveInfo } from "../geometry/tessellate.js";
import { signRefs } from "../geometry/signature.js";
import { planNamingUpgrade } from "../geometry/upgradeNaming.js";
import { tangentEdges } from "../geometry/tangentEdges.js";
import { importerFor, IMPORTERS, type Sources } from "../geometry/importers.js";
import {
  EXPORT_QUALITY,
  exporterFor,
  exporters,
} from "../geometry/exporters.js";

interface StateQueries {
  measure: { request: MeasureRequest };
  tangentEdges: { position: number | undefined; edge: EdgeRef };
  projectEdge: {
    position: number;
    plane: PlaneRef;
    edge: EdgeRef;
    entityId: string;
  };
  sign: { position: number; refs: Array<FaceRef | EdgeRef> };
}

export type StateQuery<K extends keyof StateQueries = keyof StateQueries> = {
  [P in K]: { kind: P } & StateQueries[P];
}[K];

export interface StateAnswers {
  measure: MeasureResult;
  tangentEdges: EdgeRef[];
  projectEdge: SketchEntity[];
  sign: Array<RefSignature | undefined>;
}

export interface ExportJob extends Omit<ExportRequest, "retain"> {
  hidden: readonly string[];
}

export interface ImportUpload {
  name: string;
  bytes: () => Promise<Buffer>;
}

export interface Imported {
  label: string;
  filename: string;
  features: Feature[];
  sources: Sources;
}

export interface NamingPlan {
  document: CadDocument;
  mappings: NamingMapping[];
}

export interface KernelClient {
  evaluate(
    doc: CadDocument,
    position?: number,
    extra?: Sources,
    hooks?: EvaluateHooks,
  ): Promise<EvaluateResult>;
  stateQuery<K extends keyof StateQueries>(
    doc: CadDocument,
    query: StateQuery<K>,
  ): Promise<StateAnswers[K]>;
  export(
    doc: CadDocument,
    job: ExportJob,
  ): Promise<{ data: Buffer; mime: string; ext: string }>;
  formats(): Promise<Formats>;
  importStep(upload: ImportUpload | undefined): Promise<Imported>;
  planNamingUpgrade(
    doc: CadDocument,
    accept?: NamingDecision[],
  ): Promise<NamingPlan>;
  drop(docId: string): void;
  version(): Health["kernelVersion"];
}

function asValidation<T>(run: () => T): T {
  try {
    return run();
  } catch (error) {
    throw new ValidationError((error as Error).message);
  }
}

const ANSWERS: {
  [K in keyof StateQueries]: (
    state: EvalState,
    query: StateQuery<K>,
  ) => StateAnswers[K];
} = {
  measure: (state, { request }) => measure(state, request),
  tangentEdges(state, { edge }) {
    const body = state.bodies.get(edge.bodyId);
    if (!body) throw new ValidationError("Body not found before this feature");
    return asValidation(() => tangentEdges(body, [edge]));
  },
  projectEdge(state, { plane, edge: ref, entityId }) {
    const body = state.bodies.get(ref.bodyId);
    const edge = body && computeEdgeNames(body).byName.get(ref.edgeName);
    if (!edge)
      throw new ValidationError(
        "This edge is not available before the sketch. Choose geometry from an earlier feature.",
      );
    return asValidation(() =>
      projectEdge(
        curveInfo(edge),
        resolvePlaneFrame(state, plane),
        entityId,
        ref,
      ),
    );
  },
  sign(state, { refs }) {
    const signed = structuredClone(refs);
    signRefs(state.bodies, signed);
    return signed.map((ref) => ref.sig);
  },
};

export class InProcessKernel implements KernelClient {
  constructor(private readonly store: Pick<ProjectStore, "sources">) {}

  private async sourced(doc: CadDocument) {
    const engine = engineFor(doc.id);
    return { engine, sources: await this.store.sources(doc, engine.sources) };
  }

  private async stateAt(doc: CadDocument, position?: number) {
    const { engine, sources } = await this.sourced(doc);
    return engine.stateAt(doc, position, sources);
  }

  async evaluate(
    doc: CadDocument,
    position?: number,
    extra?: Sources,
    hooks?: EvaluateHooks,
  ) {
    const { engine, sources } = await this.sourced(doc);
    return engine.evaluate(
      doc,
      position,
      extra ? new Map([...sources, ...extra]) : sources,
      hooks,
    );
  }

  async stateQuery<K extends keyof StateQueries>(
    doc: CadDocument,
    query: StateQuery<K>,
  ) {
    const state = await this.stateAt(
      doc,
      "position" in query ? query.position : undefined,
    );
    return ANSWERS[query.kind](state, query);
  }

  async export(doc: CadDocument, job: ExportJob) {
    const { format, bodyIds, quality = EXPORT_QUALITY, hidden } = job;
    const exporter = exporterFor(format);
    const state = await this.stateAt(doc);
    const missing = bodyIds.filter((id) => !state.bodies.has(id));
    if (missing.length)
      throw new ValidationError(
        `export bodies not in the model: ${missing.join(", ")}`,
      );
    const chosen = [...state.bodies.values()].filter((b) =>
      bodyIds.length > 0
        ? bodyIds.includes(b.bodyId)
        : !hidden.includes(b.bodyId),
    );
    if (chosen.length === 0) throw new ValidationError("no bodies to export");
    const blocked = chosen.filter((b) => state.blocked.has(b.bodyId));
    if (blocked.length)
      throw new StoreError(
        `export bodies depend on unresolved references: ${blocked.map((b) => b.bodyId).join(", ")}`,
        "unprocessable",
      );
    return {
      data: exporter.write({
        doc,
        bodies: chosen,
        options: { quality: Math.min(Math.max(quality, 0.001), 1) },
      }),
      mime: exporter.mime,
      ext: exporter.ext,
    };
  }

  async formats() {
    return {
      exporters: exporters
        .list()
        .map(({ format, label, ext, mime }) => ({ format, label, ext, mime })),
      importers: IMPORTERS.map(({ format, label, extensions }) => ({
        format,
        label,
        extensions,
      })),
    };
  }

  async importStep(upload: ImportUpload | undefined) {
    const importer = upload && importerFor(upload.name);
    if (!upload || !importer)
      throw new ValidationError(
        `Choose a ${IMPORTERS.flatMap((i) => i.extensions).join(", ")} file`,
      );
    const filename = upload.name.replace(/^.*[\\/]/, "").slice(0, 255);
    const { features, sources } = importer.read(await upload.bytes(), filename);
    return { label: importer.label, filename, features, sources };
  }

  async planNamingUpgrade(doc: CadDocument, accept?: NamingDecision[]) {
    const { sources } = await this.sourced(doc);
    return planNamingUpgrade(doc, sources, accept);
  }

  drop(docId: string) {
    dropEngine(docId);
  }

  version() {
    return kernelVersion();
  }
}
