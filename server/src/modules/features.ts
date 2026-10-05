import type { TimelineFeature } from "@rockett/plugin-api";
import {
  featureModule,
  REGISTRY_ID,
  registerExtensionSpec,
  type ExtensionFeature,
} from "@rockett/shared";
import { engineCache } from "../geometry/engine.js";
import {
  registerFeatureKind,
  type FeatureKind,
} from "../geometry/featureKinds.js";
import {
  registerBodySolids,
  rejectInvalidBody,
} from "../geometry/featureState.js";
import {
  acquire,
  cancelRequested,
  faces,
  getKernel,
  scoped,
  solids,
  type Own,
  type Shape,
} from "../geometry/kernel.js";
import { ShapeMap } from "../geometry/shapeMap.js";
import { sourceNames } from "../geometry/signature.js";

export interface FeatureBundle {
  moduleId: string;
  entry: string;
  type: string;
}

export function checkModuleType(moduleId: string, type: string, what: string) {
  if (!type.startsWith(`${moduleId}.`) || !REGISTRY_ID.test(type))
    throw new Error(
      `${what} ${type} must start with ${moduleId}. and name a valid id`,
    );
  if (featureModule(type) !== moduleId)
    throw new Error(`${what} ${type} must belong to module ${moduleId}`);
}

export function synchronous<T>(result: T, what: string): T {
  if (
    result instanceof Object &&
    typeof Reflect.get(result, "then") === "function"
  ) {
    Promise.resolve(result).catch((error: unknown) =>
      console.error(`[rockett] ${what} failed after it was refused`, error),
    );
    throw new Error(`${what} must return synchronously, not a promise`);
  }
  return result;
}

const LABEL = /^[a-z0-9][a-z0-9_:-]{0,63}$/;

function labelsOf(own: Own, shape: Shape, listed: unknown, what: string) {
  const oc = getKernel();
  if (!Array.isArray(listed))
    throw new Error(`${what} face labels must be a list`);
  const labels = new ShapeMap<string>();
  own({ delete: () => labels.release() });
  const seen = new Set<string>();
  for (const entry of listed) {
    const [face, label] = Array.isArray(entry) ? entry : [];
    if (typeof label !== "string" || !LABEL.test(label))
      throw new Error(
        `${what} face label ${JSON.stringify(String(label).slice(0, 64))} is invalid`,
      );
    if (!(face instanceof oc.TopoDS_Shape) || own(face).isDeleted())
      throw new Error(`${what} labels a face it did not emit`);
    if (seen.has(label)) throw new Error(`${what} labels two faces ${label}`);
    if (labels.get(face) !== undefined)
      throw new Error(`${what} labels one face twice`);
    seen.add(label);
    labels.set(face, label);
  }
  const found = faces(shape).filter((face) => labels.get(face) !== undefined);
  if (found.length !== labels.size)
    throw new Error(`${what} labels a face it did not emit`);
  return labels;
}

function kindOf({ spec, evaluate }: TimelineFeature): FeatureKind {
  const what = `timeline feature ${spec.type}`;
  return {
    type: spec.type,
    evaluate({ state, sources, inputs }, feature) {
      const oc = getKernel();
      const { shape, names } = scoped((own) => {
        const result: Shape = synchronous(
          evaluate({
            oc,
            own,
            progress() {
              if (cancelRequested()) throw new Error(`${what} cancelled`);
            },
            params: structuredClone((feature as ExtensionFeature).params),
            ...(inputs && {
              inputs: {
                identity: inputs.identity,
                assets: inputs.assets.map((hash) => sources.get(hash)!.slice()),
              },
            }),
          }),
          what,
        );
        const { shape: body, faces: listed = [] }: Shape =
          result instanceof oc.TopoDS_Shape
            ? { shape: result }
            : Object(result);
        if (!(body instanceof oc.TopoDS_Shape))
          throw new Error(`${what} must return a solid shape`);
        own(body);
        if (body.isDeleted() || solids(body).length === 0)
          throw new Error(`${what} must return a solid shape`);
        rejectInvalidBody(spec.label, body);
        const labels = labelsOf(own, body, listed, what);
        return {
          shape: own.keep(body),
          names: sourceNames(body, feature.id, labels),
        };
      });
      acquire(shape);
      registerBodySolids(state, `b:${feature.id}`, shape, names);
    },
  };
}

export async function installFeatureBundle(
  { moduleId, entry, type }: FeatureBundle,
  withSpecs: boolean,
): Promise<() => void> {
  checkModuleType(moduleId, type, "timeline feature");
  const { features } = (await import(entry)) as { features?: unknown };
  if (!Array.isArray(features))
    throw new Error(`${entry} has no timeline feature list`);
  const feature = (features as TimelineFeature[]).find(
    (listed) => listed?.spec?.type === type,
  );
  if (typeof feature?.evaluate !== "function" || !feature.spec)
    throw new Error(`${entry} has no timeline feature ${type}`);
  const disposers: Array<() => void> = [];
  const dispose = () => {
    for (const undo of disposers.splice(0).toReversed()) undo();
    engineCache.clear();
  };
  try {
    if (withSpecs) disposers.push(registerExtensionSpec(feature.spec));
    disposers.push(registerFeatureKind(kindOf(feature)));
  } catch (error) {
    dispose();
    throw error;
  }
  engineCache.clear();
  return dispose;
}
