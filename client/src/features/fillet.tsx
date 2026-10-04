import {
  arrow,
  edgeRay,
  first,
  type FeatureHandleDefinition,
} from "../three/featureHandles";
import { FILLET_TYPES, newId, type FilletFeature } from "@rockett/shared";
import { SelInfo } from "../components/form/fields";
import { blendPicks } from "../commands/featureCommand";
import { num } from "./inputs";
import {
  blendHint,
  blendSelection,
  blendSources,
  refuseVertex,
} from "./blendPicks";
import {
  registerFeatureUI,
  type FeatureFormProps,
  type FeatureUI,
  type InputParams,
} from "./registry";
import { TangentChainField } from "./tangentChain";
import { BlendSizeFields } from "./blendSize";

export type FilletParams = InputParams<
  Pick<
    FilletFeature,
    | "id"
    | "name"
    | "radius"
    | "tangentChain"
    | "filletType"
    | "distance2"
    | "flip"
  >
>;

const handle = {
  param: "radius",
  fallback: 2,
  signed: false,
  place: (input) => arrow(edgeRay(input.bodies, first(input, "edge"))),
} satisfies FeatureHandleDefinition<FilletParams>;

function sizes(params: FilletParams) {
  const filletType = params.filletType ?? "equalDistance";
  const radius = num(params, handle.param, handle.fallback);
  return filletType === "equalDistance"
    ? { filletType, radius }
    : {
        filletType,
        radius,
        distance2: num(params, "distance2", radius),
        flip: params.flip ?? false,
      };
}

function FilletForm({ params, setParams }: FeatureFormProps<FilletParams>) {
  const { filletType, radius, ...second } = sizes(params);
  return (
    <>
      <SelInfo label="Edges" input="edges" hint={blendHint} />
      <TangentChainField params={params} setParams={setParams} />
      <BlendSizeFields
        types={FILLET_TYPES}
        size={{ type: filletType, size: radius, ...second }}
        label="Radius"
        bind="/radius"
        onType={(v) => setParams({ filletType: v })}
        onSize={(v) => setParams({ radius: v })}
        setParams={setParams}
      />
    </>
  );
}

export const fillet: FeatureUI<FilletFeature, FilletParams> = {
  type: "fillet",
  handle,
  initialParams: {},
  icon: "◠",
  title: "Fillet",
  group: "modify",
  picks: [blendPicks],
  Form: FilletForm,
  build: (params, selection) => {
    const picks = blendSources(params.id, selection);
    if ("error" in picks) return picks;
    return {
      id: params.id ?? newId("fillet"),
      type: "fillet",
      name: params.name ?? "",
      suppressed: false,
      ...picks,
      ...sizes(params),
      tangentChain: params.tangentChain ?? true,
    };
  },
  prefill: (f) => ({
    params: {
      id: f.id,
      name: f.name,
      filletType: f.filletType,
      radius: f.radius,
      distance2: f.distance2,
      flip: f.flip,
      tangentChain: f.tangentChain ?? false,
    },
    selection: blendSelection(f),
  }),
  onPick: refuseVertex(
    "Fillet rounds edges: pick the edges or faces at this corner",
  ),
};

registerFeatureUI(fillet);
