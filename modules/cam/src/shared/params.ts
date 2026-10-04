import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

const vector = Type.Tuple([Type.Number(), Type.Number(), Type.Number()]);

const faceRef = (title: string) =>
  Type.Object(
    {
      kind: Type.Literal("face"),
      bodyId: Type.String({ minLength: 1 }),
      faceName: Type.String(),
      sig: Type.Object({
        type: Type.String(),
        point: vector,
        direction: vector,
      }),
    },
    { title },
  );

export type FaceRef = Static<ReturnType<typeof faceRef>>;

export const contourParams = Type.Object({
  face: faceRef("Face"),
  side: Type.Union(
    [
      Type.Literal("outside", { title: "Outside" }),
      Type.Literal("inside", { title: "Inside" }),
    ],
    { title: "Side" },
  ),
  bottomOffset: Type.Number({ title: "Bottom offset", parameterUnit: "mm" }),
});

export const pocketParams = Type.Object({
  floor: faceRef("Floor"),
  rampAngle: Type.Number({ title: "Ramp angle", parameterUnit: "deg" }),
});

export const MIN_TOLERANCE = 0.001;

const tolerance = Type.Number({
  title: "Tolerance",
  parameterUnit: "mm",
  minimum: MIN_TOLERANCE,
});

export const parallelParams = Type.Object({
  angle: Type.Number({ title: "Pass angle", parameterUnit: "deg" }),
  tolerance,
});

export const waterlineParams = Type.Object({
  angle: Type.Number({ title: "Wall angle", parameterUnit: "deg" }),
  tolerance,
});

export function paramsOf<S extends TSchema>(
  schema: S,
  type: string,
  params: unknown,
): Static<S> {
  if (Value.Check(schema, params)) return params;
  const [error] = Value.Errors(schema, params);
  const field = error?.instancePath.slice(1).replaceAll("/", ".");
  throw new RangeError(
    `${type} params: ${field ? `${field} ` : ""}${error?.message ?? "are invalid"}`,
  );
}
