import { Type, type Static } from "typebox";

const travel = (title: string) => Type.Number({ title, parameterUnit: "mm" });

const feed = (axis: string) =>
  Type.Number({ title: `Max feed ${axis} (mm/min)`, exclusiveMinimum: 0 });

const firmwareSchema = Type.Union(
  [
    Type.Literal("grbl", { title: "GRBL 1.1" }),
    Type.Literal("grblhal", { title: "grblHAL" }),
    Type.Literal("linuxcnc", { title: "LinuxCNC" }),
  ],
  { title: "Firmware" },
);

export type Firmware = Static<typeof firmwareSchema>;

const toolChangeSchema = Type.Union(
  [
    Type.Literal("perFile", { title: "One file per tool" }),
    Type.Literal("m6", { title: "T then M6" }),
  ],
  { title: "Tool change" },
);

type ToolChange = Static<typeof toolChangeSchema>;

export const machineSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  name: Type.String(),
  firmware: firmwareSchema,
  post: Type.String({ minLength: 1 }),
  xMin: travel("X min"),
  xMax: travel("X max"),
  yMin: travel("Y min"),
  yMax: travel("Y max"),
  zMin: travel("Z min"),
  zMax: travel("Z max"),
  maxFeedX: feed("X"),
  maxFeedY: feed("Y"),
  maxFeedZ: feed("Z"),
  rpmMin: Type.Integer({ title: "Min spindle speed (rpm)", minimum: 0 }),
  rpmMax: Type.Integer({ title: "Max spindle speed (rpm)", minimum: 1 }),
  toolChange: toolChangeSchema,
  units: Type.Union(
    [
      Type.Literal("mm", { title: "mm" }),
      Type.Literal("inch", { title: "inch" }),
    ],
    { title: "Output units" },
  ),
});

export type MachineProfile = Static<typeof machineSchema>;

export const FIRMWARE: Record<
  Firmware,
  { post: string; toolChange?: ToolChange }
> = {
  grbl: { post: "grbl", toolChange: "perFile" },
  grblhal: { post: "grblhal" },
  linuxcnc: { post: "linuxcnc", toolChange: "m6" },
};

export const withFirmware = (
  machine: MachineProfile,
  firmware: Firmware,
): MachineProfile => ({
  ...machine,
  firmware,
  post: FIRMWARE[firmware].post,
  toolChange: FIRMWARE[firmware].toolChange ?? machine.toolChange,
});

export const newMachine = (count: number): MachineProfile => ({
  id: crypto.randomUUID(),
  name: `Machine ${count + 1}`,
  firmware: "grbl",
  post: FIRMWARE.grbl.post,
  xMin: 0,
  xMax: 300,
  yMin: 0,
  yMax: 300,
  zMin: -80,
  zMax: 0,
  maxFeedX: 3000,
  maxFeedY: 3000,
  maxFeedZ: 1000,
  rpmMin: 0,
  rpmMax: 24000,
  toolChange: "perFile",
  units: "mm",
});

const AXES = [
  ["X", "xMin", "xMax"],
  ["Y", "yMin", "yMax"],
  ["Z", "zMin", "zMax"],
] as const;

export function validateMachine(machine: MachineProfile): string[] {
  const problems = AXES.filter(
    ([, min, max]) => !(machine[max] > machine[min]),
  ).map(([axis]) => `${axis} max must be greater than ${axis} min`);
  if (!(machine.rpmMax >= machine.rpmMin))
    problems.push("max spindle speed must be at least the min");
  if (machine.firmware === "grbl" && machine.toolChange === "m6")
    problems.push("GRBL 1.1 has no M6; use one file per tool");
  return problems;
}
