import {
  createElement as h,
  useEffect,
  useState,
  useSyncExternalStore,
  type MouseEvent,
  type ReactNode,
} from "react";
import type {
  ClientContext,
  ContextMenuItem,
  OpenProject,
  ProjectView,
} from "@rockett/plugin-api";
import {
  generateRoute,
  generateStaleRoute,
  statusRoute,
  type CamData,
  type OperationStatus,
} from "../shared/document.js";
import { banner, empty, reason, row, tree } from "./libraryParts.js";
import { camRead, editCam } from "./setup.js";
import type { Selection, ToolpathPreview } from "./toolpaths.js";

type Setup = CamData["setups"][number];
type Operation = NonNullable<Setup["operations"]>[number];
type Step = -1 | 1;
type Statuses = Record<string, Record<string, OperationStatus>>;
type Read =
  | { projectId: string; statuses: Statuses }
  | { projectId: string; error: string };

export const generateOperation = (
  view: ProjectView,
  setupId: string,
  operationId: string,
) => view.mutate(generateRoute, { setupId, operationId });

export const generateStale = (view: ProjectView) =>
  view.mutate(generateStaleRoute, {});

function moved<T extends { id: string }>(
  list: readonly T[],
  id: string,
  by: Step,
  what: string,
): T[] {
  const from = list.findIndex((item) => item.id === id);
  if (from < 0) throw new Error(`${what} ${id} is not in this project`);
  const to = from + by;
  if (to < 0 || to >= list.length)
    throw new Error(`${what} ${id} cannot move ${by < 0 ? "up" : "down"}`);
  const next = list.filter((item) => item.id !== id);
  next.splice(to, 0, list[from]!);
  return next;
}

const withOperations = (
  data: CamData,
  setupId: string,
  change: (operations: Operation[]) => Operation[],
): CamData => ({
  ...data,
  setups: data.setups.map((setup) =>
    setup.id === setupId
      ? { ...setup, operations: change(setup.operations ?? []) }
      : setup,
  ),
});

export const moveSetup = (view: ProjectView, setupId: string, by: Step) =>
  editCam(view, (data) => ({
    ...data,
    setups: moved(data.setups, setupId, by, "setup"),
  }));

export const moveOperation = (
  view: ProjectView,
  setupId: string,
  operationId: string,
  by: Step,
) =>
  editCam(view, (data) =>
    withOperations(data, setupId, (operations) =>
      moved(operations, operationId, by, "operation"),
    ),
  );

export const toggleSuppressed = (
  view: ProjectView,
  setupId: string,
  operationId: string,
) =>
  editCam(view, (data) =>
    withOperations(data, setupId, (operations) =>
      operations.map((op) => {
        if (op.id !== operationId) return op;
        const { suppressed, ...rest } = op;
        return suppressed ? rest : { ...rest, suppressed: true };
      }),
    ),
  );

const BADGES: Record<OperationStatus["status"], [string, string]> = {
  fresh: ["tl-chip", "fresh"],
  stale: ["tl-chip tl-warn", "stale"],
  never: ["tl-chip dimmed", "never"],
  error: ["tl-chip error", "error"],
  missingReference: ["tl-chip error", "missing reference"],
  suppressed: ["tl-chip suppressed", "suppressed"],
};

function badge(status: OperationStatus | undefined) {
  if (!status) return null;
  const [className, text] = BADGES[status.status];
  const title = "reason" in status ? status.reason : undefined;
  return h("span", { className, title }, text);
}

const readStatuses = async (
  project: ProjectView,
  setups: Setup[],
): Promise<Statuses> =>
  Object.fromEntries(
    await Promise.all(
      setups.map(
        async ({ id }) =>
          [id, await project.read(statusRoute, { setupId: id })] as const,
      ),
    ),
  );

function useStatuses(project: ProjectView, open: OpenProject) {
  const [read, setRead] = useState<Read | null>(null);
  const [retries, setRetries] = useState(0);
  useEffect(() => {
    const { projectId } = open;
    const cam = camRead(open);
    if (!projectId || cam.status !== "ready") return;
    let live = true;
    void readStatuses(project, cam.data.setups).then(
      (statuses) => live && setRead({ projectId, statuses }),
      (e: unknown) => live && setRead({ projectId, error: reason(e) }),
    );
    return () => {
      live = false;
    };
  }, [project, open, retries]);
  return {
    current: read?.projectId === open.projectId ? read : null,
    retry: () => setRetries((n) => n + 1),
  };
}

type Rows = {
  project: ProjectView;
  preview: ToolpathPreview;
  selection: Selection;
  statuses: Statuses;
  staleItems: ContextMenuItem[];
  act(action: () => Promise<void>): () => void;
  opener(items: ContextMenuItem[]): (e: MouseEvent) => void;
};

const moves = (
  { act }: Rows,
  count: number,
  index: number,
  move: (by: Step) => Promise<void>,
): ContextMenuItem[] => [
  ...(index > 0 ? [{ label: "Move up", action: act(() => move(-1)) }] : []),
  ...(index < count - 1
    ? [{ label: "Move down", action: act(() => move(1)) }]
    : []),
];

function operationItems(
  rows: Rows,
  setup: Setup,
  op: Operation,
  index: number,
) {
  const { project, act, staleItems } = rows;
  const generate: ContextMenuItem = {
    label: "Generate",
    action: act(() => generateOperation(project, setup.id, op.id)),
  };
  return [
    ...(op.suppressed ? [] : [generate]),
    ...staleItems,
    ...moves(rows, setup.operations?.length ?? 0, index, (by) =>
      moveOperation(project, setup.id, op.id, by),
    ),
    {
      label: op.suppressed ? "Unsuppress" : "Suppress",
      action: act(() => toggleSuppressed(project, setup.id, op.id)),
    },
  ];
}

const operationRow = (rows: Rows, setup: Setup, op: Operation, index: number) =>
  row(
    {
      key: op.id,
      name: `${index + 1} ${op.name ?? op.id}`,
      selected:
        rows.selection?.setupId === setup.id &&
        rows.selection.operationId === op.id,
      onClick: () =>
        void rows.preview.select({ setupId: setup.id, operationId: op.id }),
      onContextMenu: rows.opener(operationItems(rows, setup, op, index)),
    },
    badge(rows.statuses[setup.id]?.[op.id]),
  );

function setupSection(rows: Rows, setup: Setup, index: number, count: number) {
  const operations = setup.operations ?? [];
  const items = [
    ...rows.staleItems,
    ...moves(rows, count, index, (by) => moveSetup(rows.project, setup.id, by)),
  ];
  return tree(
    {
      title: setup.name ?? setup.id,
      key: setup.id,
      selected:
        rows.selection?.setupId === setup.id && !rows.selection.operationId,
      onClick: () => void rows.preview.select({ setupId: setup.id }),
      onContextMenu: rows.opener(items),
    },
    operations.length
      ? operations.map((op, i) => operationRow(rows, setup, op, i))
      : empty("No operations yet."),
  );
}

export function manufactureBrowser(
  { project, ui }: ClientContext,
  preview: ToolpathPreview,
) {
  return function ManufactureBrowser() {
    const open = useSyncExternalStore(project.subscribe, project.get);
    const { selection } = useSyncExternalStore(preview.subscribe, preview.get);
    const { current, retry } = useStatuses(project, open);
    const [error, setError] = useState<string | null>(null);
    const [menu, setMenu] = useState<{
      x: number;
      y: number;
      items: ContextMenuItem[];
    } | null>(null);

    const act = (action: () => Promise<void>) => () => {
      setError(null);
      action().catch((e: unknown) => {
        setError(reason(e));
        retry();
      });
    };
    const statuses = current && "statuses" in current ? current.statuses : {};
    const anyStale = Object.values(statuses).some((ops) =>
      Object.values(ops).some(({ status }) => status === "stale"),
    );
    const rows: Rows = {
      project,
      preview,
      selection,
      statuses,
      act,
      staleItems: anyStale
        ? [
            {
              label: "Generate all stale",
              action: act(() => generateStale(project)),
            },
          ]
        : [],
      opener: (items) => (e) => {
        e.preventDefault();
        if (items.length) setMenu({ x: e.clientX, y: e.clientY, items });
      },
    };

    const cam = camRead(open);
    const body = (): ReactNode => {
      if (!open.document) return empty("Loading setups...");
      if (cam.status === "kept")
        return banner(`Setups did not load: ${cam.reason}.`);
      if (current && "error" in current)
        return banner(`Setups did not load: ${current.error}.`);
      const { setups } = cam.data;
      if (!setups.length) return empty("No setups yet.");
      if (!current) return empty("Loading setups...");
      return setups.map((setup, i) =>
        setupSection(rows, setup, i, setups.length),
      );
    };

    return h(
      "div",
      { className: "model-tree" },
      h("div", { className: "tree-doc" }, "Manufacture"),
      banner(error),
      body(),
      menu && h(ui.ContextMenu, { ...menu, onClose: () => setMenu(null) }),
    );
  };
}
