import {
  FEATURE_SCHEMAS,
  MAX_TARGETS,
  unsignedRefs,
  type CadDocument,
  type Feature,
  type FeatureStatus,
} from "@rockett/shared";
import type { DocumentEngine } from "./engine.js";
import type { Sources } from "./importers.js";
import { signRefs } from "./signature.js";

export function lacksTargets(feature: Feature): boolean {
  return (
    !("targets" in feature) &&
    "targets" in FEATURE_SCHEMAS[feature.type].properties
  );
}

export function pinTargets(feature: Feature, { targets }: FeatureStatus) {
  if (lacksTargets(feature) && targets && targets.length <= MAX_TARGETS)
    Object.assign(feature, { targets });
}

export function pinRefs(
  doc: CadDocument,
  engine: DocumentEngine,
  sources: Sources,
): CadDocument {
  const { featureStatuses } = engine.evaluate(
    doc,
    doc.features.length,
    sources,
  );
  const pinned = structuredClone(doc);
  pinned.features.forEach((feature, index) => {
    pinTargets(feature, featureStatuses[index]!);
    const missing = unsignedRefs(feature);
    if (missing.length)
      signRefs(engine.stateAt(doc, index, sources).bodies, missing);
  });
  return pinned;
}
