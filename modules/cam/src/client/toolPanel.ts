import { createElement as h, Fragment, useState, type ReactNode } from "react";
import type { ClientContext, UserDataEntry } from "@rockett/plugin-api";
import type { Post } from "../post/schema.js";
import {
  newMachine,
  validateMachine,
  type MachineProfile,
} from "../shared/machine.js";
import { DEFAULT_MACHINE, defaultMachine } from "../shared/settings.js";
import { validateTool, type Preset, type Tool } from "../shared/tools.js";
import {
  exportTools,
  importRockett,
  merge,
  TOOLS_FILE,
  type ToolImport,
} from "../import/rockett.js";
import {
  banner,
  button,
  deleteQuestion,
  dimmed,
  libraryOf,
  placeholder,
  reason,
  row,
  tree,
  useModuleSetting,
  useStored,
  type Library,
} from "./libraryParts.js";
import { machineForm } from "./machineForm.js";
import { newTool, toolFields } from "./toolForm.js";

type Ui = ClientContext["ui"];
type Item = { id: string; name: string };

type Section<T extends Item> = {
  noun: string;
  title: string;
  create(count: number): T;
  problems(item: T): string[];
  fields(ui: Ui, item: T, edit: (item: T) => void): ReactNode[];
};

export const saved = <T extends Item>(items: T[], item: T) =>
  items.some((t) => t.id === item.id)
    ? items.map((t) => (t.id === item.id ? item : t))
    : [...items, item];

const TOOLS: Section<Tool> = {
  noun: "tool",
  title: "Tools",
  create: newTool,
  problems: validateTool,
  fields: toolFields,
};

export const machineSection = (
  posts: Post[],
  postsError: string | null = null,
): Section<MachineProfile> => ({
  noun: "machine",
  title: "Machines",
  create: newMachine,
  problems: validateMachine,
  fields: machineForm(posts, postsError),
});

export function useSection<T extends Item>(
  { ui, request }: ClientContext,
  section: Section<T>,
) {
  const path = `${section.noun}s`;
  const { library, setLibrary, error, setError } = useStored<T>(
    request,
    path,
    section.title,
  );
  const [editing, setEditing] = useState<T | null>(null);
  const [pending, setPending] = useState(false);
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
          return true;
        },
        (e) => {
          setError(`${section.title} did not save: ${reason(e)}.`);
          return false;
        },
      )
      .finally(() => setPending(false));
  };
  const remove = async (item: T) => {
    if (await ui.confirm(deleteQuestion(item.name)))
      await write(library!.items.filter((t) => t.id !== item.id));
  };
  return {
    section,
    library,
    error,
    editing,
    pending,
    setError,
    setEditing,
    write,
    remove,
  };
}

type State<T extends Item> = ReturnType<typeof useSection<T>>;

function sectionForm<T extends Item>(ui: Ui, state: State<T>) {
  const { section, library, editing, pending } = state;
  if (!library || !editing) return null;
  const problems = section.problems(editing);
  return h(
    Fragment,
    null,
    banner(state.error),
    section.fields(ui, editing, state.setEditing),
    problems.length > 0 &&
      h(
        "span",
        { className: "field-hint" },
        `Fix before saving: ${problems.join("; ")}.`,
      ),
    h(ui.DialogFooter, {
      onOk: () => void state.write(saved(library.items, editing)),
      onCancel: () => state.setEditing(null),
      pending,
      okDisabled: problems.length > 0,
    }),
  );
}

function sectionList<T extends Item>(
  state: State<T>,
  extra?: ReactNode,
  mark?: (item: T) => ReactNode,
) {
  const { section, library, error, pending } = state;
  const plural = section.title.toLowerCase();
  const rows = library?.items.map((item) =>
    row(
      { key: item.id, name: item.name },
      mark?.(item),
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
  const add = `Add ${section.noun}`;
  return h(
    Fragment,
    { key: section.noun },
    banner(error),
    tree(
      { title: `Your ${plural}` },
      placeholder(plural, state, rows?.length),
      rows,
    ),
    library &&
      button(add, add, pending, () =>
        state.setEditing(section.create(library.items.length)),
      ),
    extra,
  );
}

type ImportView = {
  name: string;
  result: ToolImport;
  tools: Tool[];
  presets: Preset[];
  replace: boolean;
  error: string | null;
  pending: boolean;
  setReplace(replace: boolean): void;
  onOk(): void;
  onCancel(): void;
};

function importRows<T extends Item>(
  items: T[],
  incoming: T[],
  replace: boolean,
) {
  const known = new Set(items.map((item) => item.id));
  return incoming.map((item) =>
    row(
      { key: item.id, name: item.name },
      h(
        "span",
        null,
        !known.has(item.id)
          ? "New"
          : replace
            ? "Replaces yours"
            : "Skipped, already in your library",
      ),
    ),
  );
}

export function importDialog(ui: Ui, view: ImportView) {
  const { result, replace } = view;
  const unchanged =
    merge(view.tools, result.tools, replace) === view.tools &&
    merge(view.presets, result.presets, replace) === view.presets;
  return h(
    Fragment,
    null,
    h("span", { className: "field-hint" }, `Import ${view.name}`),
    banner(view.error),
    result.tools.length > 0 &&
      tree({ title: "Tools" }, importRows(view.tools, result.tools, replace)),
    result.presets.length > 0 &&
      tree(
        { title: "Presets" },
        importRows(view.presets, result.presets, replace),
      ),
    result.rejects.length > 0 &&
      tree(
        { title: "Rejected" },
        result.rejects.map((reject, index) =>
          row(
            { key: String(index), name: reject.item },
            h("span", null, reject.reason),
          ),
        ),
      ),
    h(ui.CheckField, {
      label: "Replace tools and presets with the same id",
      value: replace,
      onChange: view.setReplace,
    }),
    h(ui.DialogFooter, {
      onOk: view.onOk,
      onCancel: view.onCancel,
      okLabel: "Import",
      okDisabled: unchanged,
      pending: view.pending,
    }),
  );
}

type Importing = {
  name: string;
  result: ToolImport;
  replace: boolean;
  presets: Library<Preset>;
};

const readPresets = ({ request }: ClientContext) =>
  request<UserDataEntry | null>("GET", "presets").then(libraryOf<Preset>);

const exportLibrary = async (context: ClientContext, tools: Tool[]) =>
  context.ui.download({
    fileName: TOOLS_FILE,
    data: exportTools(tools, (await readPresets(context)).items),
    type: "application/json",
  });

async function pickImport(context: ClientContext): Promise<Importing | null> {
  const file = await context.ui.pickFile({
    accept: ".json,application/json",
    maxBytes: Infinity,
  });
  if (!file) return null;
  return {
    name: file.name,
    result: importRockett(file.text),
    replace: false,
    presets: await readPresets(context),
  };
}

function useTransfer(context: ClientContext, tools: State<Tool>) {
  const { ui, request } = context;
  const [importing, setImporting] = useState<Importing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const items = tools.library?.items;
  const exportFile = (list: Tool[]) =>
    exportLibrary(context, list).catch((e) =>
      setError(`Export did not read your presets: ${reason(e)}.`),
    );
  const pick = () =>
    pickImport(context).then(
      (next) => {
        if (!next) return;
        setError(null);
        setImporting(next);
      },
      (e) => setError(`Import did not start: ${reason(e)}.`),
    );
  const writePresets = async (open: Importing, next: Preset[]) => {
    setPending(true);
    try {
      const stored = await request<UserDataEntry>("PUT", "presets", {
        data: next,
        etag: open.presets.etag,
      });
      setImporting({ ...open, presets: libraryOf<Preset>(stored) });
      return true;
    } catch (e) {
      setError(`Presets did not save: ${reason(e)}.`);
      return false;
    } finally {
      setPending(false);
    }
  };
  const run = async (open: Importing) => {
    const { result, replace, presets } = open;
    const nextTools = merge(items!, result.tools, replace);
    if (nextTools !== items && !(await tools.write(nextTools))) return;
    const next = merge(presets.items, result.presets, replace);
    if (next !== presets.items && !(await writePresets(open, next))) return;
    setImporting(null);
  };
  const busy = pending || tools.pending;
  const buttons =
    items &&
    h(
      Fragment,
      null,
      banner(error),
      button("Import tools", "Import tools", busy, () => void pick()),
      button(
        "Export tools",
        "Export tools",
        busy,
        () => void exportFile(items),
      ),
    );
  const dialog =
    importing &&
    items &&
    importDialog(ui, {
      name: importing.name,
      result: importing.result,
      replace: importing.replace,
      tools: items,
      presets: importing.presets.items,
      error: error ?? tools.error,
      pending: busy,
      setReplace: (replace) => setImporting({ ...importing, replace }),
      onOk: () => void run(importing),
      onCancel: () => {
        setError(null);
        setImporting(null);
      },
    });
  return { buttons, dialog };
}

export function toolsPage(context: ClientContext) {
  const { ui } = context;
  return function ToolsPage() {
    const tools = useSection(context, TOOLS);
    const transfer = useTransfer(context, tools);
    return (
      transfer.dialog ||
      sectionForm(ui, tools) ||
      sectionList(tools, transfer.buttons)
    );
  };
}

export function machinesPage(context: ClientContext) {
  const { ui, request, settings } = context;
  return function MachinesPage() {
    const posts = useStored<Post>(request, "posts", "Posts");
    const machines = useSection(
      context,
      machineSection(posts.library?.items ?? [], posts.error),
    );
    useModuleSetting(settings, DEFAULT_MACHINE.key);
    const [error, setError] = useState<string | null>(null);
    const chosen = defaultMachine(settings, machines.library?.items ?? []);
    const makeDefault = (machine: MachineProfile) =>
      settings.set(DEFAULT_MACHINE.key, machine.id).then(
        () => setError(null),
        (e) => setError(`Default machine did not save: ${reason(e)}.`),
      );
    const mark = (machine: MachineProfile) =>
      machine === chosen
        ? dimmed("Default")
        : button(
            "Make default",
            `Make ${machine.name} the default machine`,
            machines.pending,
            () => void makeDefault(machine),
          );
    return (
      sectionForm(ui, machines) ||
      h(Fragment, null, banner(error), sectionList(machines, null, mark))
    );
  };
}
