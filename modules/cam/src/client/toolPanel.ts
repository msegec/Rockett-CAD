import { createElement as h, Fragment, useEffect, useState } from "react";
import type {
  ClientContext,
  NumberFieldProps,
  UserDataEntry,
} from "@rockett/plugin-api";
import { validateTool, type Tool } from "../shared/tools.js";

export const TOOL_PANEL = "rockett.cam.library.panel";

type Kind = Tool["kind"];
type Library = { tools: Tool[]; etag: string | null };
type LengthKey = "diameter" | "fluteLength" | "overallLength" | "shankDiameter";

const KINDS: [Kind, string][] = [
  ["flat", "Flat end mill"],
  ["ball", "Ball end mill"],
  ["bull", "Bull nose end mill"],
  ["vbit", "V-bit"],
  ["drill", "Drill"],
  ["chamfer", "Chamfer mill"],
];

const LENGTHS: [LengthKey, string][] = [
  ["fluteLength", "Flute length"],
  ["overallLength", "Overall length"],
  ["shankDiameter", "Shank diameter"],
];

const CORNER_RADIUS = 1;
const TIP_ANGLE = 90;

const newTool = (count: number): Tool => ({
  id: crypto.randomUUID(),
  name: `Tool ${count + 1}`,
  kind: "flat",
  diameter: 6,
  fluteLength: 20,
  overallLength: 50,
  shankDiameter: 6,
  flutes: 2,
  centreCutting: true,
});

function withKind(tool: Tool, kind: Kind): Tool {
  const { cornerRadius, tipAngle, ...rest } = tool as Tool & {
    cornerRadius?: number;
    tipAngle?: number;
  };
  if (kind === "bull")
    return { ...rest, kind, cornerRadius: cornerRadius ?? CORNER_RADIUS };
  if (kind === "flat" || kind === "ball") return { ...rest, kind };
  return { ...rest, kind, tipAngle: tipAngle ?? TIP_ANGLE };
}

const saved = (tools: Tool[], tool: Tool) =>
  tools.some((t) => t.id === tool.id)
    ? tools.map((t) => (t.id === tool.id ? tool : t))
    : [...tools, tool];

function libraryOf(entry: UserDataEntry | null): Library {
  if (entry?.readOnly)
    throw new Error("it was saved by a newer version of Rockett");
  return {
    tools: (entry?.data as Tool[] | undefined) ?? [],
    etag: entry?.etag ?? null,
  };
}

const reason = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function toolFields(
  ui: ClientContext["ui"],
  tool: Tool,
  edit: (tool: Tool) => void,
) {
  const length = (
    key: LengthKey,
    label: string,
    bound: Pick<NumberFieldProps, "min" | "above">,
  ) =>
    h(ui.LengthField, {
      key,
      label,
      value: tool[key],
      onChange: (v) => edit({ ...tool, [key]: v }),
      ...bound,
    });
  return [
    h(ui.SelectField<Kind>, {
      key: "kind",
      label: "Kind",
      value: tool.kind,
      options: KINDS,
      onChange: (kind) => edit(withKind(tool, kind)),
    }),
    length("diameter", "Diameter", { above: 0 }),
    tool.kind === "bull" &&
      h(ui.LengthField, {
        key: "cornerRadius",
        label: "Corner radius",
        value: tool.cornerRadius,
        min: 0,
        max: tool.diameter / 2,
        onChange: (cornerRadius) => edit({ ...tool, cornerRadius }),
      }),
    "tipAngle" in tool &&
      h(ui.AngleField, {
        key: "tipAngle",
        label: "Tip angle",
        value: tool.tipAngle,
        above: 0,
        max: 180,
        onChange: (tipAngle) => edit({ ...tool, tipAngle }),
      }),
    ...LENGTHS.map(([key, label]) => length(key, label, { above: 0 })),
    h(ui.NumField, {
      key: "flutes",
      label: "Flutes",
      value: tool.flutes,
      int: true,
      min: 1,
      onChange: (flutes) => edit({ ...tool, flutes }),
    }),
    h(ui.CheckField, {
      key: "centreCutting",
      label: "Centre cutting",
      value: tool.centreCutting,
      onChange: (centreCutting) => edit({ ...tool, centreCutting }),
    }),
  ];
}

const button = (
  text: string,
  label: string,
  disabled: boolean,
  onClick: () => void,
) =>
  h(
    "button",
    { className: "btn", "aria-label": label, disabled, onClick },
    text,
  );

function toolList(
  library: Library | null,
  loading: boolean,
  pending: boolean,
  edit: (tool: Tool) => void,
  remove: (tool: Tool) => void,
) {
  const rows = library?.tools.map((tool) =>
    h(
      "div",
      { key: tool.id, className: "tree-item", role: "listitem" },
      h("span", null, tool.name),
      button("Edit", `Edit ${tool.name}`, pending, () => edit(tool)),
      button("Delete", `Delete ${tool.name}`, pending, () => remove(tool)),
    ),
  );
  const state = !library
    ? loading && h("div", { className: "tree-empty" }, "Loading tools...")
    : !rows?.length && h("div", { className: "tree-empty" }, "No tools yet.");
  return h(
    "div",
    { className: "tree-section" },
    h("div", { className: "tree-header" }, "Tools"),
    h(
      "div",
      { className: "tree-children", role: "list", "aria-label": "Tools" },
      state,
      rows,
    ),
  );
}

export function toolPanel({ ui, request }: ClientContext) {
  const close = () => ui.closePanel(TOOL_PANEL);
  return function ToolPanel() {
    const [library, setLibrary] = useState<Library | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [editing, setEditing] = useState<Tool | null>(null);
    const [pending, setPending] = useState(false);
    useEffect(() => {
      request<UserDataEntry | null>("GET", "tools")
        .then(libraryOf)
        .then(setLibrary, (e) => setError(`Tools did not load: ${reason(e)}.`));
    }, []);
    const write = (tools: Tool[]) => {
      setPending(true);
      return request<UserDataEntry>("PUT", "tools", {
        data: tools,
        etag: library!.etag,
      })
        .then(libraryOf)
        .then(
          (next) => {
            setLibrary(next);
            setError(null);
            setEditing(null);
          },
          (e) => setError(`Tools did not save: ${reason(e)}.`),
        )
        .finally(() => setPending(false));
    };
    const remove = async (tool: Tool) => {
      if (
        await ui.confirm(
          `Delete ${tool.name} from your library? Projects that use it keep their copy.`,
        )
      )
        await write(library!.tools.filter((t) => t.id !== tool.id));
    };
    const banner =
      error && h("div", { className: "error-banner", role: "alert" }, error);
    if (library && editing)
      return h(ui.DraggablePanel, {
        title: editing.name,
        children: h(
          Fragment,
          null,
          h(
            "div",
            { className: "dialog-body" },
            banner,
            toolFields(ui, editing, setEditing),
          ),
          h(ui.DialogFooter, {
            onOk: () => void write(saved(library.tools, editing)),
            onCancel: () => setEditing(null),
            pending,
            okDisabled: validateTool(editing).length > 0,
          }),
        ),
      });
    return h(ui.DraggablePanel, {
      title: "Library",
      children: h(
        Fragment,
        null,
        h(
          "div",
          { className: "dialog-body" },
          banner,
          toolList(library, !error, pending, setEditing, remove),
          library &&
            button("Add tool", "Add tool", pending, () =>
              setEditing(newTool(library.tools.length)),
            ),
        ),
        h(ui.DialogFooter, { onCancel: close, cancelLabel: "Close" }),
      ),
    });
  };
}
