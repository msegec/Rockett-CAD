import type { ChamferType } from "@rockett/shared";
import {
  AngleField,
  CheckField,
  LengthField,
  SelectField,
} from "../components/form/fields";
import { useSetting } from "../settings";
import type { NumericInput } from "./registry";

const TYPE_LABELS: Record<ChamferType, string> = {
  equalDistance: "Equal distance",
  twoDistances: "Two distances",
  distanceAngle: "Distance and angle",
};

export type BlendSize<T extends ChamferType> = {
  type: T;
  size: number;
  distance2?: number;
  angle?: number;
  flip?: boolean;
};

type SecondSizes = {
  distance2?: NumericInput;
  angle?: NumericInput;
  flip?: boolean;
};

export function BlendSizeFields<T extends ChamferType>({
  types,
  size,
  label,
  bind,
  onType,
  onSize,
  setParams,
}: {
  types: readonly T[];
  size: BlendSize<T>;
  label: string;
  bind: string;
  onType: (type: T) => void;
  onSize: (value: NumericInput) => void;
  setParams: (patch: SecondSizes) => void;
}) {
  const units = useSetting("units.length");
  return (
    <>
      <SelectField
        label="Type"
        value={size.type}
        options={types.map((type) => [type, TYPE_LABELS[type]])}
        onChange={onType}
      />
      <LengthField
        label={size.distance2 === undefined ? label : "Distance 1"}
        units={units}
        autoFocus
        value={size.size}
        onChange={onSize}
        bind={bind}
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
