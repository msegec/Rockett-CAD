import type { ComponentType } from "react";
import { createRegistry, type Feature } from "@rockett/shared";
import type { PickInput } from "../dialogPicks";
import type { Selection } from "../store";

export type DialogParams = Record<string, any>;

export interface FeatureFormProps {
  params: DialogParams;
  setParams: (patch: DialogParams) => void;
}

export interface FeatureUI<F extends Feature = Feature> {
  type: F["type"];
  icon: string;
  title: string;
  group: string;
  picks: readonly PickInput[];
  Form: ComponentType<FeatureFormProps>;
  build(params: DialogParams, selection: Selection[]): F | { error: string };
  prefill(f: F): { params: DialogParams; selection: Selection[] };
}

const featureUIs = createRegistry<FeatureUI>("feature UI", (ui) => ui.type);

export const registerFeatureUI = featureUIs.register;
export const featureUI = featureUIs.get;
