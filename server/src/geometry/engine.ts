/**
 * Regeneration engine.
 *
 * Evaluates a document's feature timeline in order, up to the timeline
 * marker, maintaining per-feature snapshots so an edit to feature k only
 * re-evaluates features k..end (the brief's "retain valid cached state,
 * invalidate downstream" requirement).
 *
 * A failed feature is recorded in the result with an actionable error and
 * evaluation continues with the pre-failure state, so downstream features
 * that don't depend on it still build (they may fail themselves, which is
 * also recorded — never silently discarded).
 */

import type {
  BodyPayload,
  CadDocument,
  ConstructionPlanePayload,
  EvaluateResult,
  FeatureStatus,
  NamingVersion,
  SketchPayload,
} from "@rockett/shared";
import {
  cloneState,
  emptyState,
  evaluateFeature,
  type EvalState,
  type FeatureOutcome,
  type StateBody,
} from "./features.js";
import type { Sources } from "./importers.js";
import { movePayload, tessellateBody } from "./tessellate.js";
import { withNamingVersion, type NamedBody } from "./naming.js";
import { shapeHash, type Shape } from "./kernel.js";
import { ShapeMap, trackShapeMaps } from "./shapeMap.js";
import { BlockedFeature, evaluateResolved, unresolvedRefs } from "./resolve.js";

interface Snapshot {
  featureKeys: string[];
  state: EvalState;
  statuses: FeatureStatus[];
}

function releaseSnapshots(
  discarded: Pick<Snapshot, "state">[],
  retained: Pick<Snapshot, "state">[],
): void {
  const bodies = (snapshots: Pick<Snapshot, "state">[]) =>
    snapshots.flatMap((s) => [...s.state.bodies.values()]);
  const kept = bodies(retained);
  const keptShapes = new Set(kept.map((b) => b.shape));
  const keptNames = new Set(kept.map((b) => b.names));
  const dropped = bodies(discarded);
  const freed = dropped.filter((b) => !keptShapes.has(b.shape));
  for (const body of freed) {
    const key = cacheKey(body);
    if (tessCache.entries.get(key)?.shape === body.shape) evict(key);
  }
  for (const shape of new Set(freed.map((b) => b.shape))) shape.delete();
  for (const names of new Set(dropped.map((b) => b.names)))
    if (!keptNames.has(names)) names.release();
}

function evaluateTracked(
  next: EvalState,
  feature: CadDocument["features"][number],
  earlier: CadDocument["features"],
  sources: Sources,
  namingVersion: NamingVersion,
): FeatureOutcome | void {
  const made: ShapeMap<unknown>[] = [];
  const run = () => evaluateFeature(next, feature, earlier, sources);
  try {
    return trackShapeMaps(made, () =>
      withNamingVersion(namingVersion, () =>
        namingVersion === 1 ? run() : evaluateResolved(next, feature, run),
      ),
    );
  } finally {
    const held = new Set<ShapeMap<unknown>>(
      [...next.bodies.values()].map((b) => b.names),
    );
    for (const map of made) if (!held.has(map)) map.release();
  }
}

function failedStatus(
  err: any,
  state: EvalState,
  feature: CadDocument["features"][number],
): FeatureStatus {
  const refs =
    err instanceof BlockedFeature
      ? err.refs
      : unresolvedRefs(state.bodies, feature);
  return {
    featureId: feature.id,
    status: "error",
    error: err?.message ?? String(err),
    ...(refs.length > 0 && { refs }),
  };
}

export function featureKey(feature: object): string {
  return JSON.stringify(feature);
}

function featureKeys(
  feature: CadDocument["features"][number],
  key: string,
  { targets }: FeatureStatus,
): string[] {
  return targets && !("targets" in feature)
    ? [key, featureKey({ ...feature, targets })]
    : [key];
}

interface Tessellation {
  shape: Shape;
  payload: BodyPayload;
  bytes: number;
}

export const tessCache = {
  limit: 256 * 1024 * 1024,
  bytes: 0,
  entries: new Map<string, Tessellation>(),
};

function payloadBytes(value: unknown): number {
  if (typeof value === "number" || typeof value === "boolean") return 8;
  if (typeof value === "string") return value.length * 2;
  if (!value || typeof value !== "object") return 0;
  if (Array.isArray(value) && typeof value[0] === "number")
    return value.length * 8;
  let bytes = 0;
  for (const v of Object.values(value)) bytes += payloadBytes(v);
  return bytes;
}

function cacheKey(body: NamedBody): string {
  return `${body.bodyId}:${shapeHash(body.shape)}`;
}

function evict(key: string): void {
  const entry = tessCache.entries.get(key);
  if (!entry) return;
  tessCache.entries.delete(key);
  tessCache.bytes -= entry.bytes;
}

function store(body: NamedBody, payload: BodyPayload): void {
  const key = cacheKey(body);
  evict(key);
  const bytes = payloadBytes(payload);
  tessCache.entries.set(key, { shape: body.shape, payload, bytes });
  tessCache.bytes += bytes;
  for (const old of tessCache.entries.keys()) {
    if (tessCache.bytes <= tessCache.limit) break;
    evict(old);
  }
}

function cached(body: NamedBody): BodyPayload | undefined {
  const key = cacheKey(body);
  const entry = tessCache.entries.get(key);
  if (!entry) return undefined;
  if (entry.shape.isDeleted()) {
    evict(key);
    return undefined;
  }
  if (body.shape.isDeleted() || !entry.shape.IsSame(body.shape))
    return undefined;
  tessCache.entries.delete(key);
  tessCache.entries.set(key, entry);
  return entry.payload;
}

class DocumentEngine {
  private snapshots: Snapshot[] = [];
  private namingVersion?: NamingVersion;
  private held: Sources = new Map();

  get sources(): Sources {
    return this.held;
  }

  evaluate(
    doc: CadDocument,
    position?: number,
    sources?: Sources,
  ): EvaluateResult {
    const t0 = performance.now();
    const { state, statuses } = this.regenerate(doc, position, sources);

    // --- payloads ---
    const bodies: BodyPayload[] = [];
    for (const body of state.bodies.values()) {
      const name = doc.bodyMeta[body.bodyId]?.name ?? body.bodyId;
      bodies.push({ ...this.tessellated(body, name), name });
    }

    const sketches: SketchPayload[] = [];
    for (const sk of state.sketches.values()) {
      sketches.push({
        featureId: sk.featureId,
        frame: sk.frame,
        entities: sk.entities,
        solveStatus: sk.solveStatus,
        dof: sk.dof,
        profiles: sk.profiles,
      });
    }

    const planes: ConstructionPlanePayload[] = [];
    for (const [featureId, p] of state.planes) {
      planes.push({ featureId, frame: p.frame, size: p.size });
    }

    return {
      bodies,
      featureStatuses: statuses,
      sketches,
      planes,
      kernelMs: Math.round(performance.now() - t0),
    };
  }

  private regenerate(
    doc: CadDocument,
    position: number | undefined,
    sources: Sources | undefined,
  ) {
    if (sources) this.held = sources;
    const upTo = Math.min(
      position ?? doc.timelinePosition,
      doc.features.length,
    );

    const keys: string[] = [];
    const keyAt = (i: number) => (keys[i] ??= featureKey(doc.features[i]!));
    // Drop snapshots from the first stale feature on. Valid snapshots past
    // upTo stay, so a rewind or stateAt query doesn't discard later work.
    let valid = 0;
    while (
      this.namingVersion === doc.namingVersion &&
      valid < this.snapshots.length &&
      valid < doc.features.length &&
      this.snapshots[valid]!.featureKeys.includes(keyAt(valid))
    ) {
      valid++;
    }
    releaseSnapshots(this.snapshots.splice(valid), this.snapshots);
    this.namingVersion = doc.namingVersion;
    const start = Math.min(valid, upTo);

    let state: EvalState =
      start === 0 ? emptyState() : this.snapshots[start - 1]!.state;
    let statuses: FeatureStatus[] =
      start === 0 ? [] : [...this.snapshots[start - 1]!.statuses];

    for (let i = start; i < upTo; i++) {
      const feature = doc.features[i]!;
      const next = cloneState(state);
      let status: FeatureStatus;
      if (feature.suppressed) {
        status = { featureId: feature.id, status: "suppressed" };
      } else {
        try {
          const outcome = evaluateTracked(
            next,
            feature,
            doc.features.slice(0, i),
            this.held,
            doc.namingVersion,
          );
          status = {
            featureId: feature.id,
            status: outcome?.warning ? "warning" : "ok",
            ...outcome,
          };
        } catch (err: any) {
          status = failedStatus(err, state, feature);
          releaseSnapshots([{ state: next }], this.snapshots);
          next.bodies = new Map(state.bodies);
          next.sketches = new Map(state.sketches);
          next.planes = new Map(state.planes);
          if (err instanceof BlockedFeature)
            next.blocked = new Set([...state.blocked, ...err.bodies]);
        }
      }
      statuses = [...statuses, status];
      this.snapshots.push({
        featureKeys: featureKeys(feature, keyAt(i), status),
        state: next,
        statuses,
      });
      state = next;
    }

    for (let i = upTo; i < doc.features.length; i++) {
      statuses = [
        ...statuses,
        { featureId: doc.features[i]!.id, status: "rolledBack" },
      ];
    }
    return { state, statuses };
  }

  private tessellated(body: StateBody, name: string): BodyPayload {
    const hit = cached(body);
    if (hit) return hit;
    const payload = this.moved(body) ?? tessellateBody(body, { name });
    store(body, payload);
    return payload;
  }

  private moved({ bodyId, copyOf }: StateBody): BodyPayload | undefined {
    const source = copyOf && cached(copyOf.source);
    return source && movePayload(source, bodyId, copyOf.offset, copyOf.prefix);
  }

  /** Access the evaluated state at the current cache tip (for measure/export). */
  stateAt(doc: CadDocument, position?: number, sources?: Sources): EvalState {
    return this.regenerate(doc, position, sources).state;
  }

  invalidate(): void {
    releaseSnapshots(this.snapshots, []);
    this.snapshots = [];
    this.held = new Map();
  }
}

const MAX_ENGINES = 8;
const engines = new Map<string, DocumentEngine>();

export function engineFor(docId: string): DocumentEngine {
  const e = engines.get(docId) ?? new DocumentEngine();
  engines.delete(docId);
  engines.set(docId, e);
  for (const [id] of engines) {
    if (engines.size <= MAX_ENGINES) break;
    dropEngine(id);
  }
  return e;
}

export function dropEngine(docId: string): void {
  engines.get(docId)?.invalidate();
  engines.delete(docId);
}

export type { DocumentEngine };
