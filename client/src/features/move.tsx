import { newId, type MoveFeature } from "@rockett/shared";
import { NumField, SelInfo } from "../components/form/fields";
import { bodies } from "../dialogPicks";
import { num } from "./inputs";
import {
  registerFeatureUI,
  type FeatureFormProps,
  type FeatureUI,
} from "./registry";

function MoveForm({ params, setParams }: FeatureFormProps) {
  return (
    <>
      <SelInfo label="Bodies" input="bodies" hint="click bodies" />
      <NumField
        label="X (mm)"
        autoFocus
        value={params.tx ?? 0}
        onChange={(v) => setParams({ tx: v })}
      />
      <NumField
        label="Y (mm)"
        value={params.ty ?? 0}
        onChange={(v) => setParams({ ty: v })}
      />
      <NumField
        label="Z (mm)"
        value={params.tz ?? 0}
        onChange={(v) => setParams({ tz: v })}
      />
    </>
  );
}

const move: FeatureUI<MoveFeature> = {
  type: "move",
  icon: "✥",
  title: "Move",
  group: "modify",
  picks: [bodies],
  Form: MoveForm,
  build: (params, selection) => {
    const ids = selection.flatMap((x) => (x.kind === "body" ? [x.bodyId] : []));
    if (ids.length === 0) return { error: "Select at least one body" };
    return {
      id: params.id ?? newId("move"),
      type: "move",
      name: params.name ?? "",
      suppressed: false,
      bodies: ids,
      translation: [
        num(params, "tx", 0),
        num(params, "ty", 0),
        num(params, "tz", 0),
      ],
    };
  },
  prefill: (f) => ({
    params: {
      id: f.id,
      name: f.name,
      tx: f.translation[0],
      ty: f.translation[1],
      tz: f.translation[2],
    },
    selection: f.bodies.map((bodyId) => ({ kind: "body", bodyId })),
  }),
};

registerFeatureUI(move);
