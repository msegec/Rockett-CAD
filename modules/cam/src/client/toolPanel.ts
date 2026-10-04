import {
  createElement as h,
  Fragment,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type {
  ClientContext,
  NumberFieldProps,
  UserDataEntry,
} from "@rockett/plugin-api";
import {
  machineSchema,
  newMachine,
  validateMachine,
  withFirmware,
  type MachineProfile,
} from "../shared/machine.js";
import { validateTool, type Tool } from "../shared/tools.js";
import { schemaFields } from "./schemaForm.js";

export const TOOL_PANEL = "rockett.cam.library.panel";

type Ui = ClientContext["ui"];
type Item = { id: string; name: string };
type Library<T> = { items: T[]; etag: string | null };
type Kind = Tool["kind"];

type Section<T extends Item> = {
  noun: string;
  title: string;
  create(count: number): T;
  problems(item: T): string[];
  fields(ui: Ui, item: T, edit: (item: T) => void): ReactNode[];
};
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

const saved = <T extends Item>(items: T[], item: T) =>
  items.some((t) => t.id === item.id)
    ? items.map((t) => (t.id === item.id ? item : t))
    : [...items, item];

function libraryOf<T>(entry: UserDataEntry | null): Library<T> {
  if (entry?.readOnly)
    throw new Error("it was saved by a newer version of Rockett");
  return {
    items: (entry?.data as T[] | undefined) ?? [],
    etag: entry?.etag ?? null,
  };
}

const reason = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function toolFields(ui: Ui, tool: Tool, edit: (tool: Tool) => void) {
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

export const machineFields = (
  ui: Ui,
  machine: MachineProfile,
  edit: (machine: MachineProfile) => void,
) =>
  schemaFields(ui, machineSchema, machine, (next) =>
    edit(
      next.firmware === machine.firmware
        ? next
        : withFirmware(next, next.firmware),
    ),
  );

const TOOLS: Section<Tool> = {
  noun: "tool",
  title: "Tools",
  create: newTool,
  problems: validateTool,
  fields: toolFields,
};

const MACHINES: Section<MachineProfile> = {
  noun: "machine",
  title: "Machines",
  create: newMachine,
  problems: validateMachine,
  fields: machineFields,
};

function useSection<T extends Item>(
  { ui, request }: ClientContext,
  section: Section<T>,
) {
  const [library, setLibrary] = useState<Library<T> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<T | null>(null);
  const [pending, setPending] = useState(false);
  const path = `${section.noun}s`;
  useEffect(() => {
    request<UserDataEntry | null>("GET", path)
      .then(libraryOf<T>)
      .then(setLibrary, (e) =>
        setError(`${section.title} did not load: ${reason(e)}.`),
      );
  }, []);
  const write = (items: T[]) => {
    setPending(true);
    return request<UserDataEntry>("PUT", path, {
      data: items,
      etag: library!.etag,
    })
      .then(libraryOf<T>)
      .then(
        (next) => {
          setLibrary(next);
          setError(null);
          setEditing(null);
        },
        (e) => setError(`${section.title} did not save: ${reason(e)}.`),
      )
      .finally(() => setPending(false));
  };
  const remove = async (item: T) => {
    if (
      await ui.confirm(
        `Delete ${item.name} from your library? Projects that use it keep their copy.`,
      )
    )
      await write(library!.items.filter((t) => t.id !== item.id));
  };
  return {
    section,
    library,
    error,
    editing,
    pending,
    setEditing,
    write,
    remove,
  };
}

type State<T extends Item> = ReturnType<typeof useSection<T>>;

const banner = (error: string | null) =>
  error && h("div", { className: "error-banner", role: "alert" }, error);

function sectionForm<T extends Item>(ui: Ui, state: State<T>) {
  const { section, library, editing, pending } = state;
  if (!library || !editing) return null;
  return h(ui.DraggablePanel, {
    title: editing.name,
    children: h(
      Fragment,
      null,
      h(
        "div",
        { className: "dialog-body" },
        banner(state.error),
        section.fields(ui, editing, state.setEditing),
      ),
      h(ui.DialogFooter, {
        onOk: () => void state.write(saved(library.items, editing)),
        onCancel: () => state.setEditing(null),
        pending,
        okDisabled: section.problems(editing).length > 0,
      }),
    ),
  });
}

function sectionList<T extends Item>(state: State<T>) {
  const { section, library, error, pending } = state;
  const plural = section.title.toLowerCase();
  const rows = library?.items.map((item) =>
    h(
      "div",
      { key: item.id, className: "tree-item", role: "listitem" },
      h("span", null, item.name),
      button("Edit", `Edit ${item.name}`, pending, () =>
        state.setEditing(item),
      ),
      button(
        "Delete",
        `Delete ${item.name}`,
        pending,
        () => void state.remove(item),
      ),
    ),
  );
  const empty = !library
    ? !error && h("div", { className: "tree-empty" }, `Loading ${plural}...`)
    : !rows?.length &&
      h("div", { className: "tree-empty" }, `No ${plural} yet.`);
  const add = `Add ${section.noun}`;
  return h(
    Fragment,
    { key: section.noun },
    banner(error),
    h(
      "div",
      { className: "tree-section" },
      h("div", { className: "tree-header" }, section.title),
      h(
        "div",
        {
          className: "tree-children",
          role: "list",
          "aria-label": section.title,
        },
        empty,
        rows,
      ),
    ),
    library &&
      button(add, add, pending, () =>
        state.setEditing(section.create(library.items.length)),
      ),
  );
}

export function toolPanel(context: ClientContext) {
  const { ui } = context;
  const close = () => ui.closePanel(TOOL_PANEL);
  return function ToolPanel() {
    const tools = useSection(context, TOOLS);
    const machines = useSection(context, MACHINES);
    return (
      sectionForm(ui, tools) ??
      sectionForm(ui, machines) ??
      h(ui.DraggablePanel, {
        title: "Library",
        children: h(
          Fragment,
          null,
          h(
            "div",
            { className: "dialog-body" },
            sectionList(tools),
            sectionList(machines),
          ),
          h(ui.DialogFooter, { onCancel: close, cancelLabel: "Close" }),
        ),
      })
    );
  };
}
