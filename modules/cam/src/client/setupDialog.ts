import { createElement as h, Fragment, useState } from "react";
import type { ClientContext, NumberFieldProps } from "@rockett/plugin-api";
import type { Xyz } from "../shared/ir.js";
import type { Stock } from "../shared/setup.js";
import {
  newSetup,
  saveSetup,
  withStockKind,
  type DialogSetup,
} from "./setup.js";

export const SETUP_PANEL = "rockett.cam.setup.dialog";

type Margin = keyof Extract<Stock, { kind: "boxAround" }>["margins"];
type Corner = Extract<DialogSetup["wcs"]["origin"], { kind: "stockCorner" }>;

const ALL_BODIES = "";

const STOCK_KINDS: [Stock["kind"], string][] = [
  ["boxAround", "Box around bodies"],
  ["box", "Box"],
  ["cylinder", "Cylinder"],
];

const MARGINS: [Margin, string][] = [
  ["xMax", "+X"],
  ["xMin", "-X"],
  ["yMax", "+Y"],
  ["yMin", "-Y"],
  ["zMin", "-Z"],
  ["zMax", "+Z"],
];

const SIZES = ["Length", "Width", "Height"] as const;

const SIDES = ["min", "max"] as const;

const CORNERS: Corner[] = (["max", "min"] as const).flatMap((z) =>
  SIDES.flatMap((y) =>
    SIDES.map((x): Corner => ({ kind: "stockCorner", x, y, z })),
  ),
);

const cornerKey = ({ x, y, z }: Corner) => `${x} ${y} ${z}`;

const cornerLabel = ({ x, y, z }: Corner) =>
  `Stock corner, ${y === "min" ? "front" : "back"} ${x === "min" ? "left" : "right"}, ${z === "max" ? "top" : "bottom"}`;

const CORNER_OPTIONS = CORNERS.map((c): [string, string] => [
  cornerKey(c),
  cornerLabel(c),
]);

const OFFSETS = [54, 55, 56, 57, 58, 59].map((g, i): [string, string] => [
  String(i + 1),
  `G${g}`,
]);

const resized = (size: Xyz, i: number, value: number): Xyz => [
  i === 0 ? value : size[0],
  i === 1 ? value : size[1],
  i === 2 ? value : size[2],
];

function stockSizes(
  ui: ClientContext["ui"],
  stock: Stock,
  setStock: (stock: Stock) => void,
) {
  const length = (
    label: string,
    value: number,
    onChange: (v: number) => void,
    bound: Pick<NumberFieldProps, "min" | "above">,
  ) => h(ui.LengthField, { key: label, label, value, onChange, ...bound });
  if (stock.kind === "boxAround")
    return MARGINS.map(([side, label]) =>
      length(
        label,
        stock.margins[side],
        (v) => setStock({ ...stock, margins: { ...stock.margins, [side]: v } }),
        { min: 0 },
      ),
    );
  if (stock.kind === "box")
    return SIZES.map((label, i) =>
      length(
        label,
        stock.size[i]!,
        (v) => setStock({ ...stock, size: resized(stock.size, i, v) }),
        { above: 0 },
      ),
    );
  return [
    length(
      "Diameter",
      stock.diameter,
      (diameter) => setStock({ ...stock, diameter }),
      { above: 0 },
    ),
    length("Height", stock.height, (height) => setStock({ ...stock, height }), {
      above: 0,
    }),
  ];
}

export function setupDialog({ ui, project }: ClientContext) {
  return function SetupDialog() {
    const [setup, setSetup] = useState(() => newSetup(project.get()));
    const [pending, setPending] = useState(false);
    const open = project.get();
    const edit = (patch: Partial<DialogSetup>) =>
      setSetup((now) => ({ ...now, ...patch }));
    const close = () => ui.closePanel(SETUP_PANEL);
    const save = () => {
      setPending(true);
      void saveSetup(project, setup).then(close, () => setPending(false));
    };
    const { stock, wcs } = setup;
    const setStock = (next: Stock) => edit({ stock: next });
    const bodyOptions = open.bodies.map(({ id, name }): [string, string] => [
      id,
      name,
    ]);
    if (bodyOptions.length > 1) bodyOptions.unshift([ALL_BODIES, "All bodies"]);
    const body = h(
      "div",
      { className: "dialog-body" },
      h(ui.SelectField<string>, {
        label: "Bodies",
        value: setup.bodies.length === 1 ? setup.bodies[0]! : ALL_BODIES,
        options: bodyOptions,
        onChange: (id) =>
          edit({
            bodies: id === ALL_BODIES ? open.bodies.map((b) => b.id) : [id],
          }),
      }),
      h(ui.SelectField<Stock["kind"]>, {
        label: "Stock",
        value: stock.kind,
        options: STOCK_KINDS,
        onChange: (kind) => setStock(withStockKind(setup, kind, open)),
      }),
      stockSizes(ui, stock, setStock),
      wcs.origin.kind === "stockCorner" &&
        h(ui.SelectField<string>, {
          label: "WCS",
          value: cornerKey(wcs.origin),
          options: CORNER_OPTIONS,
          onChange: (key) => {
            const origin = CORNERS.find((c) => cornerKey(c) === key);
            if (origin) edit({ wcs: { ...wcs, origin } });
          },
        }),
      h(ui.SelectField<string>, {
        label: "Offset",
        value: String(wcs.offsetIndex),
        options: OFFSETS,
        onChange: (index) =>
          edit({ wcs: { ...wcs, offsetIndex: Number(index) } }),
      }),
      h(ui.LengthField, {
        label: "Safe height",
        value: setup.safeHeight,
        onChange: (safeHeight) => edit({ safeHeight }),
      }),
      h(ui.LengthField, {
        label: "Clearance",
        value: setup.clearance,
        onChange: (clearance) => edit({ clearance }),
      }),
    );
    const footer = h(ui.DialogFooter, {
      onOk: save,
      onCancel: close,
      pending,
      okDisabled: setup.bodies.length === 0,
    });
    return h(ui.DraggablePanel, {
      title: setup.name,
      children: h(Fragment, null, body, footer),
    });
  };
}
