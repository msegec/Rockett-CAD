import * as THREE from "three";
import { createElement as h, useSyncExternalStore } from "react";
import type {
  Dispose,
  Layer,
  OpenProject,
  ProjectView,
} from "@rockett/plugin-api";
import { programRoute } from "../shared/document.js";
import type { Program } from "../shared/ir.js";
import { stockBox, type Box, type Placement } from "../shared/setup.js";
import { simulateInWorker, type Heightmap } from "./heightmap.js";
import { button, reason } from "./libraryParts.js";
import { ROLES, programToSegments, type Segments } from "./segments.js";
import { bodyBoxes, camRead } from "./setup.js";
import { placeInModel, themed } from "./stockLayer.js";

export const TOOLPATH_LAYER = "rockett.cam.toolpaths";

const TOKENS = { rapid: "err", cut: "accent", plunge: "warn", link: "ok" };
const DASH_MM = 1;
const CELL_MM = 0.5;
const MAX_CELLS = 600 * 600;

export type Selection = { setupId: string; operationId?: string } | null;
type Path = { segments: Segments; modelToSetup: Placement };
type Stock = Box & { modelToSetup: Placement };
export type Simulation =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; map: Heightmap; modelToSetup: Placement }
  | { status: "failed"; reason: string };
export type Preview = {
  selection: Selection;
  name: string;
  paths: Path[];
  programs: Program[];
  stock: Stock | null;
  moves: number;
  shown: number;
  reason: string | null;
  simulation: Simulation;
};

const IDLE: Simulation = { status: "idle" };
const NOTHING = {
  name: "",
  paths: [],
  programs: [],
  stock: null,
  moves: 0,
  shown: 0,
  reason: null,
  simulation: IDLE,
};

const cellSize = ({ min, max }: Box) =>
  Math.max(
    CELL_MM,
    Math.sqrt(((max[0] - min[0]) * (max[1] - min[1])) / MAX_CELLS),
  );

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
      return {
        program: read.program,
        segments: programToSegments(read.program),
      };
    }),
  );

function drawable(
  open: OpenProject,
  { setup, name }: Chosen,
  reads: PromiseSettledResult<{ program: Program; segments: Segments }>[],
): Partial<Preview> {
  try {
    const { bodies, stock, wcs } = setup;
    if (!bodies || !stock || !wcs)
      throw new Error(`setup ${setup.id} needs bodies, stock and WCS`);
    const box = stockBox({ bodies, stock, wcs }, bodyBoxes(open));
    const loaded = reads.flatMap((read) =>
      read.status === "fulfilled" ? [read.value] : [],
    );
    const paths = loaded.map(({ segments }) => ({
      segments,
      modelToSetup: box.modelToSetup,
    }));
    const failed = reads.find((read) => read.status === "rejected");
    const moves = paths.reduce(
      (n, path) => n + path.segments.moveEnds.length,
      0,
    );
    return {
      name,
      paths,
      programs: loaded.map(({ program }) => program),
      stock: box,
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
  let run: ReturnType<typeof simulateInWorker> | undefined;

  const stop = () => {
    run?.cancel();
    run = undefined;
  };

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
    stop();
    if (!chosen) return set(NOTHING);
    set({ programs: [], stock: null, simulation: IDLE });
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
    async simulate() {
      const { programs, stock } = state;
      const [first] = programs;
      stop();
      if (!first || !stock) return;
      const started = simulateInWorker(
        {
          ...first,
          tools: programs.flatMap(({ tools }) => tools),
          sections: programs.flatMap(({ sections }) => sections),
        },
        stock,
        cellSize(stock),
      );
      run = started;
      set({ simulation: { status: "running" } });
      const simulation: Simulation = await started.result.then(
        (map) => ({ status: "done", map, modelToSetup: stock.modelToSetup }),
        (error) => ({ status: "failed", reason: reason(error) }),
      );
      if (run === started) set({ simulation });
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

const SIMULATION_TEXT = {
  idle: null,
  running: "Simulating...",
  done: null,
} as const;

export function toolpathBarView(
  { name, moves, shown, reason: why, programs, simulation }: Preview,
  preview: ToolpathPreview,
) {
  const simulated =
    simulation.status === "failed"
      ? simulation.reason
      : SIMULATION_TEXT[simulation.status];
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
    programs.length > 0 &&
      button(
        "Simulate",
        `Simulate ${name}`,
        simulation.status === "running",
        () => void preview.simulate(),
      ),
    why && h("span", { role: "status" }, why),
    simulated && h("span", { role: "status" }, simulated),
  );
}

export function toolpathBar(preview: ToolpathPreview) {
  return function ToolpathBar() {
    return toolpathBarView(
      useSyncExternalStore(preview.subscribe, preview.get),
      preview,
    );
  };
}
