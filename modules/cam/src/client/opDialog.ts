import {
  createElement as h,
  Fragment,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import { Type, type TObject } from "typebox";
import type {
  ClientContext,
  FaceRef,
  OpenProject,
  UserDataEntry,
} from "@rockett/plugin-api";
import { signRoute, type CamData } from "../shared/document.js";
import { toolRefusal } from "../shared/operations.js";
import {
  contourParams,
  laserParams,
  paramsOf,
  pocketParams,
} from "../shared/params.js";
import type { Preset, Tool } from "../shared/tools.js";
import { banner, libraryOf, reason } from "./libraryParts.js";
import { faceKeys, firstChoices, schemaFields } from "./schemaForm.js";
import { camRead, editCam, withOperations } from "./setup.js";

export const MILL_GROUP = "rockett.cam.group.mill";
export const LASER_GROUP = "rockett.cam.group.laser";

export const OPERATION_DIALOGS = [
  {
    type: "rockett.cam.contour",
    label: "Contour",
    icon: "contour.svg",
    group: MILL_GROUP,
    schema: contourParams,
  },
  {
    type: "rockett.cam.pocket",
    label: "Pocket",
    icon: "pocket.svg",
    group: MILL_GROUP,
    schema: pocketParams,
  },
  {
    type: "rockett.cam.laser",
    label: "Laser",
    icon: "laser.svg",
    group: LASER_GROUP,
    schema: laserParams,
  },
] as const satisfies readonly {
  type: string;
  label: string;
  icon: `${string}.svg`;
  group: string;
  schema: TObject;
}[];

export type OperationDialog = (typeof OPERATION_DIALOGS)[number];

export const dialogPanel = ({ type }: OperationDialog) => `${type}.dialog`;

type Params = Record<string, unknown>;

type List<T> =
  | { status: "loading" }
  | { status: "ready"; items: T[] }
  | { status: "failed"; reason: string };

type Named = { id: string; name?: string | undefined };

type Texts = { loading: string; empty: string; failed: string };

const withFaces = (schema: TObject, params: Params, face?: FaceRef) =>
  face
    ? {
        ...params,
        ...Object.fromEntries(faceKeys(schema).map((key) => [key, face])),
      }
    : params;

const unset = (schema: TObject, params: Params) =>
  Object.entries(schema.properties)
    .filter(
      ([key, field]) =>
        (field as { title?: string }).title !== undefined &&
        !Type.IsOptional(field) &&
        params[key] === undefined,
    )
    .map(([key]) => key);

export function setupList(open: OpenProject): List<CamData["setups"][number]> {
  const read = camRead(open);
  return read.status === "kept"
    ? { status: "failed", reason: read.reason }
    : { status: "ready", items: read.data.setups };
}

function copyTool(
  data: CamData,
  tool: Tool,
  preset: Preset,
): { tools: CamData["tools"]; toolId: string } {
  const copy = data.tools.find((item) => item.libraryRef?.id === tool.id);
  if (!copy) {
    const toolId = crypto.randomUUID();
    const number = Math.max(0, ...data.tools.map((t) => t.number ?? 0)) + 1;
    const made = {
      ...tool,
      id: toolId,
      libraryRef: { id: tool.id },
      number,
      presets: [preset],
    };
    return { tools: [...data.tools, made], toolId };
  }
  const presets = copy.presets ?? [];
  if (presets.some((item) => item.id === preset.id))
    return { tools: data.tools, toolId: copy.id };
  return {
    tools: data.tools.map((item) =>
      item === copy ? { ...copy, presets: [...presets, preset] } : item,
    ),
    toolId: copy.id,
  };
}

type Draft = {
  setupId: string;
  tool: Tool;
  preset: Preset;
  params: Params;
};

function addOperation(
  data: CamData,
  { type, label }: OperationDialog,
  { setupId, tool, preset, params }: Draft,
): CamData {
  const { tools, toolId } = copyTool(data, tool, preset);
  return withOperations({ ...data, tools }, setupId, (operations) => [
    ...operations,
    {
      id: crypto.randomUUID(),
      type,
      name: `${label} ${operations.filter((op) => op.type === type).length + 1}`,
      toolId,
      presetId: preset.id,
      params,
    },
  ]);
}

export function picker<T extends Named>(
  ui: ClientContext["ui"],
  label: string,
  list: List<T>,
  chosen: T | undefined,
  choose: (id: string) => void,
  texts: Texts,
) {
  if (list.status === "loading")
    return h("span", { key: label, className: "field-hint" }, texts.loading);
  if (list.status === "failed")
    return h(
      Fragment,
      { key: label },
      banner(`${texts.failed}: ${list.reason}.`),
    );
  if (!chosen)
    return h("span", { key: label, className: "field-hint" }, texts.empty);
  return h(ui.SelectField<string>, {
    key: label,
    label,
    value: chosen.id,
    options: list.items.map((item): [string, string] => [
      item.id,
      item.name ?? item.id,
    ]),
    onChange: choose,
  });
}

export function useLibrary<T>(
  request: ClientContext["request"],
  noun: string,
  keep: (item: T) => boolean = () => true,
): List<T> {
  const [list, setList] = useState<List<T>>({ status: "loading" });
  useEffect(() => {
    let live = true;
    request<UserDataEntry | null>("GET", noun)
      .then(libraryOf<T>)
      .then(
        ({ items }) =>
          live && setList({ status: "ready", items: items.filter(keep) }),
        (e) => live && setList({ status: "failed", reason: reason(e) }),
      );
    return () => {
      live = false;
    };
  }, []);
  return list;
}

export const chosen = <T extends Named>(list: List<T>, id: string) =>
  list.status === "ready"
    ? (list.items.find((item) => item.id === id) ?? list.items[0])
    : undefined;

async function saveOperation(
  project: ClientContext["project"],
  op: OperationDialog,
  { params, ...draft }: Draft,
) {
  const out = { ...params };
  for (const key of faceKeys(op.schema)) {
    const { bodyId, faceName } = params[key] as FaceRef;
    out[key] = await project.read(signRoute, { bodyId, faceName });
  }
  const checked = paramsOf(op.schema, op.type, out);
  await editCam(project, (data) =>
    addOperation(data, op, { ...draft, params: checked }),
  );
}

export const SETUP_TEXTS: Texts = {
  loading: "Loading setups...",
  empty: "No setups yet. Add one with Setup.",
  failed: "Setups did not load",
};

const listTexts = ({
  label,
}: OperationDialog): Record<"setup" | "tool" | "preset", Texts> => ({
  setup: SETUP_TEXTS,
  tool: {
    loading: "Loading tools...",
    empty: `No tool in your library can cut a ${label.toLowerCase()}.`,
    failed: "Tools did not load",
  },
  preset: {
    loading: "Loading presets...",
    empty: "No presets in your library.",
    failed: "Presets did not load",
  },
});

export function operationDialog(
  { ui, project, request }: ClientContext,
  op: OperationDialog,
) {
  const close = () => ui.closePanel(dialogPanel(op));
  const usable = (tool: Tool) => !toolRefusal(op.type, tool.kind);
  const texts = listTexts(op);
  return function OperationDialog() {
    const open = useSyncExternalStore(project.subscribe, project.get);
    const selected = useSyncExternalStore(project.subscribe, project.selection);
    const [params, setParams] = useState<Params>(() =>
      withFaces(op.schema, firstChoices(op.schema), project.selection()[0]),
    );
    const tools = useLibrary(request, "tools", usable);
    const presets = useLibrary<Preset>(request, "presets");
    const [ids, setIds] = useState({ setup: "", tool: "", preset: "" });
    const [saving, setSaving] = useState({ pending: false, error: "" });
    useEffect(
      () => setParams((now) => withFaces(op.schema, now, selected[0])),
      [selected],
    );
    const setups = setupList(open);
    const setup = chosen(setups, ids.setup);
    const tool = chosen(tools, ids.tool);
    const preset = chosen(presets, ids.preset);
    const blank = unset(op.schema, params);
    const hint = faceKeys(op.schema).some((key) => blank.includes(key))
      ? "Select a face in the viewport."
      : null;
    const ready = setup && tool && preset && blank.length === 0;
    const save = async () => {
      if (!ready) return;
      setSaving({ pending: true, error: "" });
      try {
        await saveOperation(project, op, {
          setupId: setup.id,
          tool,
          preset,
          params,
        });
        close();
      } catch (e) {
        setSaving({
          pending: false,
          error: `${op.label} did not save: ${reason(e)}.`,
        });
      }
    };
    const choose = (key: keyof typeof ids) => (id: string) =>
      setIds((now) => ({ ...now, [key]: id }));
    const body = h(
      "div",
      { className: "dialog-body" },
      banner(saving.error || null),
      picker(ui, "Setup", setups, setup, choose("setup"), texts.setup),
      picker(ui, "Tool", tools, tool, choose("tool"), texts.tool),
      picker(ui, "Preset", presets, preset, choose("preset"), texts.preset),
      schemaFields(
        ui,
        op.schema,
        params,
        setParams,
        ({ bodyId, faceName }) =>
          `${open.bodies.find((item) => item.id === bodyId)?.name ?? bodyId} ${faceName}`,
      ),
      hint && h("span", { className: "field-hint" }, hint),
    );
    const footer = h(ui.DialogFooter, {
      onOk: () => void save(),
      onCancel: close,
      pending: saving.pending,
      okDisabled: !ready,
    });
    return h(ui.DraggablePanel, {
      title: op.label,
      children: h(Fragment, null, body, footer),
    });
  };
}
