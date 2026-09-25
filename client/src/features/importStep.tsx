import type { ImportStepFeature } from "@rockett/shared";
import { ImportPanel } from "../components/ImportPanel";
import { registerFeatureUI, type FeatureUI } from "./registry";

const importStep: FeatureUI<ImportStepFeature> = {
  type: "importStep",
  icon: "⇩",
  title: "Imported STEP",
  group: "insert",
  picks: [],
  Panel: ImportPanel,
  prefill: (f) => ({ params: { id: f.id, name: f.name }, selection: [] }),
};

registerFeatureUI(importStep);
