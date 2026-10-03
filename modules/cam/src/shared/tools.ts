import { Type, type Static } from "typebox";

const coolant = Type.Union([
  Type.Literal("off"),
  Type.Literal("flood"),
  Type.Literal("mist"),
]);

export type Coolant = Static<typeof coolant>;

const body = {
  id: Type.String({ minLength: 1 }),
  name: Type.String(),
  diameter: Type.Number(),
  fluteLength: Type.Number(),
  overallLength: Type.Number(),
  shankDiameter: Type.Number(),
  flutes: Type.Number(),
  centreCutting: Type.Boolean(),
};

export const toolSchema = Type.Union([
  Type.Object({
    ...body,
    kind: Type.Union([Type.Literal("flat"), Type.Literal("ball")]),
  }),
  Type.Object({
    ...body,
    kind: Type.Literal("bull"),
    cornerRadius: Type.Number(),
  }),
  Type.Object({
    ...body,
    kind: Type.Union([
      Type.Literal("vbit"),
      Type.Literal("drill"),
      Type.Literal("chamfer"),
    ]),
    tipAngle: Type.Number(),
  }),
]);

export type Tool = Static<typeof toolSchema>;

export const presetSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String(),
  rpm: Type.Number(),
  cutFeed: Type.Number(),
  plungeFeed: Type.Number(),
  rampFeed: Type.Number(),
  stepdown: Type.Number(),
  stepoverFraction: Type.Number(),
  coolant,
});

export type Preset = Static<typeof presetSchema>;

export function validateTool(tool: Tool): string[] {
  const problems: string[] = [];
  if (!(tool.diameter > 0)) problems.push("diameter must be greater than 0");
  if (
    tool.kind === "bull" &&
    !(tool.cornerRadius >= 0 && tool.cornerRadius <= tool.diameter / 2)
  )
    problems.push("corner radius must be between 0 and half the diameter");
  return problems;
}

export function validatePreset(preset: Preset): string[] {
  return (["cutFeed", "plungeFeed", "rampFeed"] as const)
    .filter((key) => !(preset[key] > 0))
    .map((key) => `${key} must be greater than 0`);
}
