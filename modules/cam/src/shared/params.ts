import { Type, type Static, type TSchema } from "typebox";
import { Value } from "typebox/value";

const vector = Type.Tuple([Type.Number(), Type.Number(), Type.Number()]);

export const faceRefSchema = Type.Object({
  kind: Type.Literal("face"),
  bodyId: Type.String({ minLength: 1 }),
  faceName: Type.String(),
  sig: Type.Object({ type: Type.String(), point: vector, direction: vector }),
});

export type FaceRef = Static<typeof faceRefSchema>;

export const contourParams = Type.Object({
  face: faceRefSchema,
  side: Type.Union([Type.Literal("outside"), Type.Literal("inside")]),
  bottomOffset: Type.Number(),
});

export const pocketParams = Type.Object({
  floor: faceRefSchema,
  rampAngle: Type.Number(),
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
