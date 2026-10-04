import {
  bindingHolds,
  resolvedFeatureIn,
  type CadDocument,
  type Feature,
  type ParameterBinding,
} from "@rockett/shared";
import { api } from "../api";
import { useStore } from "../store";

export type FieldExpressions = Readonly<Record<string, string | null>>;

export function resolvedFeature<F extends Feature>(f: F): F {
  const doc = useStore.getState().document;
  return doc ? resolvedFeatureIn(doc, f) : f;
}

export function storedExpression(
  doc: Pick<CadDocument, "parameterBindings"> | null,
  featureId: string | undefined,
  path: string,
): string | undefined {
  return doc?.parameterBindings.find(
    (b) => b.featureId === featureId && b.path === path,
  )?.expression;
}

export function nextBindings(
  doc: Pick<CadDocument, "parameterBindings">,
  feature: Feature,
  expressions: FieldExpressions | undefined,
  opening: ParameterBinding[] = doc.parameterBindings,
): ParameterBinding[] | null {
  const own = doc.parameterBindings.filter((b) => b.featureId === feature.id);
  const kept = new Map(
    opening
      .filter((b) => b.featureId === feature.id)
      .map((b) => [b.path, b.expression]),
  );
  for (const [path, expression] of Object.entries(expressions ?? {}))
    if (expression === null) kept.delete(path);
    else kept.set(path, expression);
  const next = [...kept]
    .filter(([path]) => bindingHolds(feature, path))
    .map(([path, expression]) => ({ featureId: feature.id, path, expression }));
  const same =
    next.length === own.length &&
    next.every((b) =>
      own.some((o) => o.path === b.path && o.expression === b.expression),
    );
  if (same) return null;
  return [
    ...doc.parameterBindings.filter((b) => b.featureId !== feature.id),
    ...next,
  ];
}

export async function saveBound(
  feature: Feature,
  editId: string | undefined,
  patch: Partial<Feature>,
  parameterBindings: ParameterBinding[],
): Promise<void> {
  const s = useStore.getState();
  await s.cancelPreview();
  const doc = useStore.getState().document;
  if (!doc) return;
  await s.mutate(async (tx) => {
    await (editId
      ? api.updateFeature(doc.id, editId, patch, undefined, tx, 1)
      : api.addFeature(doc.id, feature, tx, 1));
    await api.updateParameters(
      doc.id,
      { parameters: doc.parameters, parameterBindings },
      { tx, seq: 2 },
    );
    return api.commitPreview(doc.id, tx);
  });
}
