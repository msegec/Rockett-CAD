import { Type, type TProperties, type TSchema } from "typebox";

export const splineEntity = <P extends TProperties, I extends TSchema>(
  base: P,
  id: I,
) =>
  Type.Object({
    ...base,
    kind: Type.Literal("spline"),
    degree: Type.Integer(),
    poles: Type.Array(id),
    weights: Type.Optional(Type.Array(Type.Number())),
    knots: Type.Array(Type.Number()),
    multiplicities: Type.Array(Type.Integer()),
    periodic: Type.Optional(Type.Boolean()),
  });
