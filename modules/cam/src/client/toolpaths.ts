import * as THREE from "three";
import { createElement as h, useSyncExternalStore } from "react";
import type {
  Dispose,
  Layer,
  OpenProject,
  ProjectView,
} from "@rockett/plugin-api";
import { programRoute } from "../shared/document.js";
import { stockBox, type Placement } from "../shared/setup.js";
import { reason } from "./libraryParts.js";
import { ROLES, programToSegments, type Segments } from "./segments.js";
import { bodyBoxes, camRead } from "./setup.js";
import { placeInModel, themed } from "./stockLayer.js";

export const TOOLPATH_LAYER = "rockett.cam.toolpaths";

const TOKENS = { rapid: "err", cut: "accent", plunge: "warn", link: "ok" };
const DASH_MM = 1;

export type Selection = { setupId: string; operationId?: string } | null;
type Path = { segments: Segments; modelToSetup: Placement };
export type Preview = {
  selection: Selection;
  name: string;
  paths: Path[];
  moves: number;
  shown: number;
  reason: string | null;
};

const NOTHING = { name: "", paths: [], moves: 0, shown: 0, reason: null };

function picked(open: OpenProject, selection: Selection) {
  const read = camRead(open);
  if (!selection || read.status === "kept") return null;
  const setup = read.data.setups.find(({ id }) => id === selection.setupId);
  const { operationId } = selection;
  const operations = (setup?.operations ?? []).filter((op) =>
    operationId ? op.id === operationId : !op.suppressed,
  );
  if (!setup || (operationId && !operations.length)) return null;
  const named = operationId ? operations[0]! : setup;
  return { setup, operations, name: named.name ?? named.id };
}

type Chosen = NonNullable<ReturnType<typeof picked>>;

const readPrograms = (project: ProjectView, { setup, operations }: Chosen) =>
  Promise.allSettled(
    operations.map(async ({ id }) => {
      const read = await project.read(programRoute, {
        setupId: setup.id,
        operationId: id,
      });
      if ("reason" in read) throw new Error(read.reason);
      return programToSegments(read.program);
    }),
  );

function drawable(
  open: OpenProject,
  { setup, name }: Chosen,
  reads: PromiseSettledResult<Segments>[],
): Partial<Preview> {
  try {
    const { bodies, stock, wcs } = setup;
    if (!bodies || !stock || !wcs)
      throw new Error(`setup ${setup.id} needs bodies, stock and WCS`);
    const { modelToSetup } = stockBox({ bodies, stock, wcs }, bodyBoxes(open));
    const paths = reads.flatMap((read) =>
      read.status === "fulfilled"
        ? [{ segments: read.value, modelToSetup }]
        : [],
    );
    const failed = reads.find((read) => read.status === "rejected");
    const moves = paths.reduce(
      (n, path) => n + path.segments.moveEnds.length,
      0,
    );
    return {
      name,
      paths,
      moves,
      shown: moves,
      reason: !paths.length && failed ? reason(failed.reason) : null,
    };
  } catch (error) {
    return { ...NOTHING, name, reason: reason(error) };
  }
}

export function toolpathPreview(project: ProjectView) {
  const listeners = new Set<() => void>();
  let state: Preview = { selection: null, ...NOTHING };
  let loaded = "";
  let tickets = 0;
  let unsubscribe: Dispose | undefined;

  const set = (patch: Partial<Preview>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  async function load() {
    const open = project.get();
    const chosen = picked(open, state.selection);
    const key = JSON.stringify([
      open.projectId,
      chosen && state.selection,
      chosen?.operations.map((op) => op.lastGenerated?.fingerprint ?? null),
    ]);
    if (key === loaded) return;
    loaded = key;
    const ticket = ++tickets;
    if (!chosen) return set(NOTHING);
    const reads = await readPrograms(project, chosen);
    if (ticket === tickets) set(drawable(open, chosen, reads));
  }

  return {
    get: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1)
        unsubscribe = project.subscribe(() => void load());
      return () => {
        listeners.delete(listener);
        if (!listeners.size) unsubscribe?.();
      };
    },
    select(selection: Selection) {
      set({ selection });
      return load();
    },
    scrub(shown: number) {
      set({ shown: Math.min(Math.max(Math.round(shown), 0), state.moves) });
    },
  };
}

export type ToolpathPreview = ReturnType<typeof toolpathPreview>;

function pathObject({ segments: { positions, roles }, modelToSetup }: Path) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  for (let start = 0, end = 0; start < roles.length; start = end) {
    while (end < roles.length && roles[end] === roles[start]) end++;
    geometry.addGroup(start, end - start, roles[start]);
  }
  const materials = ROLES.map((role) =>
    themed(
      role === "rapid"
        ? new THREE.LineDashedMaterial({ dashSize: DASH_MM, gapSize: DASH_MM })
        : new THREE.LineBasicMaterial(),
      TOKENS[role],
    ),
  );
  const object = new THREE.LineSegments(geometry, materials);
  object.computeLineDistances();
  return placeInModel(object, modelToSetup);
}

export const toolpathLayer = (preview: ToolpathPreview): Layer => ({
  id: TOOLPATH_LAYER,
  mount({ group, requestRender, clearGroup }) {
    let drawn: Path[] | undefined;
    let objects: THREE.LineSegments[] = [];
    const draw = () => {
      const { paths, shown } = preview.get();
      if (paths !== drawn) {
        clearGroup(group);
        drawn = paths;
        objects = paths.map(pathObject);
        if (objects.length) group.add(...objects);
      }
      let left = shown;
      paths.forEach(({ segments: { moveEnds } }, i) => {
        const n = Math.min(Math.max(left, 0), moveEnds.length);
        objects[i]!.geometry.setDrawRange(0, n ? moveEnds[n - 1]! : 0);
        left -= moveEnds.length;
      });
      requestRender();
    };
    draw();
    return preview.subscribe(draw);
  },
});

const count = (n: number) => n.toLocaleString("en");

export function toolpathBar(preview: ToolpathPreview) {
  return function ToolpathBar() {
    const {
      name,
      moves,
      shown,
      reason: why,
    } = useSyncExternalStore(preview.subscribe, preview.get);
    return h(
      "div",
      { className: "timeline" },
      h(
        "label",
        { className: "field" },
        h("span", null, name),
        moves > 0 &&
          h("input", {
            type: "range",
            min: 0,
            max: moves,
            step: 1,
            value: shown,
            "aria-label": "Moves shown",
            onChange: (e: { target: { value: string } }) =>
              preview.scrub(Number(e.target.value)),
          }),
      ),
      moves > 0 && h("span", null, `${count(shown)} of ${count(moves)} moves`),
      why && h("span", { role: "status" }, why),
    );
  };
}
