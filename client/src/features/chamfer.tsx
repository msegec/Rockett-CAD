import {
  arrow,
  edgeRay,
  first,
  type FeatureHandleDefinition,
} from "../three/featureHandles";
import { newId, type ChamferFeature, type ChamferType } from "@rockett/shared";
import {
  AngleField,
  CheckField,
  LengthField,
  SelectField,
  SelInfo,
} from "../components/form/fields";
import { useSetting } from "../settings";
import { edges } from "../commands/featureCommand";
import { edgePicks, edgeRefs, num } from "./inputs";
import {
  registerFeatureUI,
  type FeatureFormProps,
  type FeatureUI,
  type InputParams,
} from "./registry";
import { tangentChain, TangentChainField } from "./tangentChain";

export type ChamferParams = InputParams<
  Pick<
    ChamferFeature,
    | "id"
    | "name"
    | "tangentChain"
    | "chamferType"
    | "distance"
    | "distance2"
    | "angle"
    | "flip"
  >
>;

const handle = {
  param: "distance",
  fallback: 1,
  signed: false,
  place: (input) => arrow(edgeRay(input.bodies, first(input, "edge"))),
} satisfies FeatureHandleDefinition<ChamferParams>;

const ANGLE_FALLBACK = 45;

function sizes(params: ChamferParams) {
  const chamferType = params.chamferType ?? "equalDistance";
  const distance = num(params, handle.param, handle.fallback);
  const flip = params.flip ?? false;
  switch (chamferType) {
    case "equalDistance":
      return { chamferType, distance };
    case "twoDistances":
      return {
        chamferType,
        distance,
        distance2: num(params, "distance2", distance),
        flip,
      };
    case "distanceAngle":
      return {
        chamferType,
        distance,
        angle: num(params, "angle", ANGLE_FALLBACK),
        flip,
      };
  }
}

const TYPE_OPTIONS: [ChamferType, string][] = [
  ["equalDistance", "Equal distance"],
  ["twoDistances", "Two distances"],
  ["distanceAngle", "Distance and angle"],
];

function ChamferForm({ params, setParams }: FeatureFormProps<ChamferParams>) {
  const units = useSetting("units.length");
  const size = sizes(params);
  const two = size.chamferType === "twoDistances";
  return (
    <>
      <SelInfo label="Edges" input="edges" hint="click model edges" />
      <TangentChainField params={params} setParams={setParams} />
      <SelectField
        label="Type"
        value={size.chamferType}
        options={TYPE_OPTIONS}
        onChange={(v) => setParams({ chamferType: v })}
      />
      <LengthField
        label={two ? "Distance 1" : "Distance"}
        units={units}
        autoFocus
        value={size.distance}
        onChange={(v) => setParams({ distance: v })}
        bind="/distance"
      />
      {size.distance2 !== undefined && (
        <LengthField
          label="Distance 2"
          units={units}
          value={size.distance2}
          onChange={(v) => setParams({ distance2: v })}
          bind="/distance2"
        />
      )}
      {size.angle !== undefined && (
        <AngleField
          label="Angle"
          value={size.angle}
          onChange={(v) => setParams({ angle: v })}
          bind="/angle"
        />
      )}
      {size.flip !== undefined && (
        <CheckField
          label="Flip"
          value={size.flip}
          onChange={(v) => setParams({ flip: v })}
        />
      )}
    </>
  );
}

export const chamfer: FeatureUI<ChamferFeature, ChamferParams> = {
  type: "chamfer",
  handle,
  icon: "◣",
  title: "Chamfer",
  group: "modify",
  picks: [edges],
  initialParams: {},
  Form: ChamferForm,
  build: (params, selection) => {
    const edges = edgeRefs(selection);
    if (edges.length === 0) return { error: "Select at least one edge" };
    return {
      id: params.id ?? newId("chamfer"),
      type: "chamfer",
      name: params.name ?? "",
      suppressed: false,
      edges,
      ...sizes(params),
      tangentChain: params.tangentChain ?? true,
    };
  },
  prefill: (f) => ({
    params: {
      id: f.id,
      name: f.name,
      chamferType: f.chamferType,
      distance: f.distance,
      distance2: f.distance2,
      angle: f.angle,
      flip: f.flip,
      tangentChain: f.tangentChain ?? false,
    },
    selection: edgePicks(f.edges),
  }),
  onPick: tangentChain,
};

registerFeatureUI(chamfer);
