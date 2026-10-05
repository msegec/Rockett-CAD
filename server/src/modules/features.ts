import type { TSchema } from "typebox";
import type { KernelJobScope } from "@rockett/plugin-api";
import {
  featureModule,
  REGISTRY_ID,
  registerExtensionSpec,
  type ExtensionFeature,
  type ExtensionSpec,
  type ResolvedFeatureInputs,
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
  getKernel,
  scoped,
  solids,
  type Shape,
} from "../geometry/kernel.js";
import { sourceNames } from "../geometry/signature.js";

export interface FeatureBundle {
  moduleId: string;
  entry: string;
}

export interface TimelineScope<P> extends KernelJobScope {
  readonly params: P;
  readonly inputs?: {
    readonly identity: ResolvedFeatureInputs["identity"];
    readonly assets: readonly Uint8Array[];
  };
}

export interface TimelineFeature<P = Record<string, unknown>> {
  spec: ExtensionSpec<TSchema>;
  evaluate(scope: TimelineScope<P>): unknown;
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

function kindOf({ spec, evaluate }: TimelineFeature): FeatureKind {
  const what = `timeline feature ${spec.type}`;
  return {
    type: spec.type,
    evaluate({ state, sources, inputs }, feature) {
      const oc = getKernel();
      const shape = scoped((own) => {
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
        if (!(result instanceof oc.TopoDS_Shape))
          throw new Error(`${what} must return a solid shape`);
        own(result);
        if (result.isDeleted() || solids(result).length === 0)
          throw new Error(`${what} must return a solid shape`);
        rejectInvalidBody(spec.label, result);
        return own.keep(result);
      });
      acquire(shape);
      registerBodySolids(
        state,
        `b:${feature.id}`,
        shape,
        sourceNames(shape, feature.id),
      );
    },
  };
}

export async function installFeatureBundle(
  { moduleId, entry }: FeatureBundle,
  withSpecs: boolean,
): Promise<() => void> {
  const { features } = (await import(entry)) as { features?: unknown };
  if (!Array.isArray(features))
    throw new Error(`${entry} has no timeline feature list`);
  const disposers: Array<() => void> = [];
  const dispose = () => {
    for (const undo of disposers.splice(0).toReversed()) undo();
    engineCache.clear();
  };
  try {
    for (const feature of features as TimelineFeature[]) {
      if (typeof feature?.evaluate !== "function" || !feature.spec)
        throw new Error(
          `${entry} lists a timeline feature without spec and evaluate`,
        );
      checkModuleType(moduleId, feature.spec.type, "timeline feature");
      if (withSpecs) disposers.push(registerExtensionSpec(feature.spec));
      disposers.push(registerFeatureKind(kindOf(feature)));
    }
  } catch (error) {
    dispose();
    throw error;
  }
  engineCache.clear();
  return dispose;
}
