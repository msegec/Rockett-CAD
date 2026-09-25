import { useState } from "react";
import type {
  AxisRef,
  CadDocument,
  EvaluateResult,
  Feature,
  FeatureStatus,
  PlaneRef,
} from "@rockett/shared";
import { pickInto } from "../dialogPicks";
import { featureUI } from "../features/registry";
import {
  useStore,
  selectionKey,
  sketchEditingPosition,
  type DialogType,
  type Selection,
} from "../store";
import { useTimelinePeek } from "../timelinePeek";
import { featureBodies } from "../treeSelection";
import { alignCameraToActiveSketch } from "../viewportRef";
import { ContextMenu } from "./ContextMenu";
import { refNotes, useNamingUpgradePanel } from "./RefRepair";
import { QuickEdit, quickValues } from "./QuickEdit";

const TYPE_ICONS: Record<string, string> = {
  importStep: "⇩",
  importMesh: "⇩",
  sketch: "✏",
  extrude: "⬆",
  revolve: "↻",
  sweep: "〰",
  loft: "◆",
  fillet: "◠",
  chamfer: "◣",
  combine: "∪",
  splitBody: "∤",
  offsetFace: "⇱",
  mirror: "⧉",
  linearPattern: "⋮⋮",
  circularPattern: "❋",
  constructionPlane: "▱",
  referenceImage: "🖼",
  emboss: "℘",
  move: "✥",
};

const typeIcon = (type: string) =>
  featureUI(type)?.icon ?? TYPE_ICONS[type] ?? "•";

function chipTitle(
  f: Feature,
  st: FeatureStatus | undefined,
  document: CadDocument,
  evaluation: EvaluateResult | null,
): string {
  const notes = st?.refs?.length
    ? refNotes(st.refs, document, evaluation, evaluation?.bodies ?? [])
    : [st?.error || st?.warning].filter(Boolean);
  return [
    `${f.name} (${f.type})`,
    ...notes.map((n) => `⚠ ${n}`),
    ...(f.suppressed ? ["(suppressed)"] : []),
  ].join("\n");
}

function chipClass(
  f: Feature,
  st: FeatureStatus | undefined,
  selected: boolean,
) {
  return [
    "tl-chip",
    st?.status === "error" ? "error" : "",
    f.suppressed ? "suppressed" : "",
    selected ? "selected" : "",
    st?.status === "rolledBack" ? "rolledback" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function selectFeatureBodies(featureId: string, additive: boolean) {
  const s = useStore.getState();
  const bodies = featureBodies(s.evaluation, featureId);
  if (s.mode.name === "dialog") return pickInto(bodies, additive);
  if (s.mode.name !== "idle" || bodies.length === 0) return;
  const had = new Set(s.selection.map(selectionKey));
  s.setSelection(
    additive
      ? [...s.selection, ...bodies.filter((b) => !had.has(selectionKey(b)))]
      : bodies,
  );
}

function chipSelected(
  evaluation: EvaluateResult | null,
  featureId: string,
  selection: Selection[],
) {
  if (!selection.some((x) => x.kind === "body")) return false;
  const keys = new Set(selection.map(selectionKey));
  const bodies = featureBodies(evaluation, featureId);
  return bodies.length > 0 && bodies.every((b) => keys.has(selectionKey(b)));
}

export function Timeline() {
  const document_ = useStore((s) => s.document);
  const evaluation = useStore((s) => s.evaluation);
  const mode = useStore((s) => s.mode);
  const selection = useStore((s) => s.selection);
  const busy = useStore((s) => s.busy);
  const rollTimeline = useStore((s) => s.rollTimeline);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    feature: Feature;
    anchor: { left: number; top: number };
  } | null>(null);
  const [quick, setQuick] = useState<{
    feature: Feature;
    anchor: { left: number; top: number };
  } | null>(null);
  const [renaming, setRenaming] = useState<{
    id: string;
    value: string;
  } | null>(null);
  const peek = useTimelinePeek(quick !== null);
  const upgrade = useNamingUpgradePanel();

  if (!document_) return null;
  const pos =
    sketchEditingPosition(document_, mode) ?? document_.timelinePosition;
  const statuses = new Map(
    (evaluation?.featureStatuses ?? []).map((s) => [s.featureId, s]),
  );

  return (
    <div className="timeline">
      <fieldset
        className="tl-controls"
        disabled={busy || mode.name === "sketch"}
        style={{ border: 0, margin: 0, padding: 0 }}
      >
        <button title="Roll to start" onClick={() => void rollTimeline(0)}>
          ⏮
        </button>
        <button
          title="Step back"
          onClick={() => void rollTimeline(Math.max(0, pos - 1))}
        >
          ◀
        </button>
        <button
          title="Step forward"
          onClick={() =>
            void rollTimeline(Math.min(document_.features.length, pos + 1))
          }
        >
          ▶
        </button>
        <button
          title="Roll to end"
          onClick={() => void rollTimeline(document_.features.length)}
        >
          ⏭
        </button>
      </fieldset>
      <div className="tl-strip">
        <div
          className={`tl-marker ${pos === 0 ? "current" : ""}`}
          title="Roll to start"
          onClick={() => void rollTimeline(0)}
        />
        {document_.features.map((f, i) => {
          const st = statuses.get(f.id);
          return (
            <span key={f.id} style={{ display: "contents" }}>
              <div
                className={chipClass(
                  f,
                  st,
                  chipSelected(evaluation, f.id, selection),
                )}
                title={chipTitle(f, st, document_, evaluation)}
                onClick={(e) =>
                  selectFeatureBodies(f.id, e.ctrlKey || e.metaKey)
                }
                onDoubleClick={() => void openFeatureEditor(f)}
                onMouseEnter={() => peek.enter(f.id)}
                onMouseLeave={peek.leave}
                onContextMenu={(e) => {
                  e.preventDefault();
                  const { left, top } = e.currentTarget.getBoundingClientRect();
                  setMenu({
                    x: e.clientX,
                    y: e.clientY,
                    feature: f,
                    anchor: { left, top },
                  });
                }}
              >
                <span className="tl-icon">{typeIcon(f.type)}</span>
                {renaming?.id === f.id ? (
                  <input
                    autoFocus
                    className="tl-rename"
                    value={renaming.value}
                    onChange={(e) =>
                      setRenaming({ id: f.id, value: e.target.value })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        void useStore
                          .getState()
                          .renameFeature(f.id, renaming.value || f.name);
                        setRenaming(null);
                      }
                      if (e.key === "Escape") setRenaming(null);
                    }}
                    onBlur={() => setRenaming(null)}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="tl-name">{f.name}</span>
                )}
                {(st?.status === "error" || st?.status === "warning") && (
                  <span className="tl-warn">⚠</span>
                )}
              </div>
              <div
                className={`tl-marker ${pos === i + 1 ? "current" : ""}`}
                title={`Roll to after ${f.name}`}
                onClick={() => void rollTimeline(i + 1)}
              />
            </span>
          );
        })}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          up
          onClose={() => setMenu(null)}
          items={[
            {
              label: "Edit",
              action: () => void openFeatureEditor(menu.feature),
            },
            ...(mode.name === "idle" && quickValues(menu.feature).length > 0
              ? [{ label: "Quick edit", action: () => setQuick(menu) }]
              : []),
            {
              label: "Rename",
              action: () =>
                setRenaming({ id: menu.feature.id, value: menu.feature.name }),
            },
            {
              label: menu.feature.suppressed ? "Unsuppress" : "Suppress",
              action: () =>
                void useStore
                  .getState()
                  .suppressFeature(menu.feature.id, !menu.feature.suppressed),
            },
            {
              label: "Delete",
              danger: true,
              action: () =>
                void useStore.getState().deleteFeature(menu.feature.id),
            },
            ...upgrade.items(menu.x, menu.y),
          ]}
        />
      )}
      {upgrade.panel}
      {quick && (
        <QuickEdit
          feature={quick.feature}
          anchor={quick.anchor}
          onClose={() => setQuick(null)}
        />
      )}
    </div>
  );
}

const axisParams = (axis: AxisRef | undefined) => ({
  axisSource: axis?.kind === "originAxis" ? "origin" : "edge",
  axis: axis?.kind === "originAxis" ? axis.axis : "Z",
});

/** Open the right editor for a feature: sketch mode, or a prefilled dialog. */
export async function openFeatureEditor(f: Feature): Promise<void> {
  if (useStore.getState().busy) return;
  if (f.type !== "sketch" && useStore.getState().mode.name === "sketch") {
    await useStore.getState().finishSketch();
    if (useStore.getState().mode.name === "sketch") return;
  }
  const s = useStore.getState();
  if (f.type === "sketch") {
    // rolling target: ensure the sketch is inside the active timeline range
    void s.editSketch(f.id).then(alignCameraToActiveSketch);
    return;
  }
  const ui = featureUI(f.type);
  if (ui) return openDialog(f, ui.prefill(f));
  const anyF = f as any;
  const selection: Selection[] = [];
  for (const p of anyF.profiles ?? []) {
    selection.push({
      kind: "profile",
      sketchId: p.sketchId,
      profileId: p.profileId,
    });
  }
  for (const p of anyF.sections ?? []) {
    selection.push({
      kind: "profile",
      sketchId: p.sketchId,
      profileId: p.profileId,
    });
  }
  for (const e of anyF.edges ?? []) {
    selection.push({ kind: "edge", bodyId: e.bodyId, edgeName: e.edgeName });
  }
  for (const fa of anyF.faces ?? []) {
    selection.push({ kind: "face", bodyId: fa.bodyId, faceName: fa.faceName });
  }
  if (anyF.targetBody)
    selection.push({ kind: "body", bodyId: anyF.targetBody });
  for (const b of anyF.toolBodies ?? anyF.bodies ?? []) {
    selection.push({ kind: "body", bodyId: b });
  }
  if (anyF.body) selection.push({ kind: "body", bodyId: anyF.body });

  /** Reselect an edge or sketch-line axis so OK rebuilds the same axis. */
  const pushAxis = (axis: any) => {
    if (axis?.kind === "edge") {
      selection.push({
        kind: "edge",
        bodyId: axis.edge.bodyId,
        edgeName: axis.edge.edgeName,
      });
    }
    if (axis?.kind === "sketchLine") {
      selection.push({
        kind: "sketchEntity",
        sketchId: axis.sketchId,
        entityId: axis.entityId,
      });
    }
  };

  const params: Record<string, any> = { name: f.name, targets: anyF.targets };
  switch (f.type) {
    case "extrude":
      Object.assign(params, {
        distance: anyF.distance,
        distance2: anyF.distance2,
        startOffset: anyF.startOffset ?? 0,
        direction: anyF.direction,
        operation: anyF.operation,
      });
      break;
    case "revolve":
      Object.assign(params, {
        angle: anyF.angle,
        operation: anyF.operation,
        ...axisParams(anyF.axis),
      });
      pushAxis(anyF.axis);
      break;
    case "sweep":
      Object.assign(params, {
        pathSketchId: anyF.pathSketchId,
        operation: anyF.operation,
      });
      break;
    case "loft":
      Object.assign(params, { operation: anyF.operation });
      break;
    case "fillet":
      Object.assign(params, {
        radius: anyF.radius,
        tangentChain: anyF.tangentChain ?? false,
      });
      break;
    case "chamfer":
      Object.assign(params, {
        distance: anyF.distance,
        tangentChain: anyF.tangentChain ?? false,
      });
      break;
    case "combine":
      Object.assign(params, {
        operation: anyF.operation,
        keepTools: anyF.keepTools,
      });
      break;
    case "offsetFace":
      Object.assign(params, { distance: anyF.distance });
      break;
    case "mirror":
      Object.assign(params, { combine: anyF.combine });
      if (anyF.plane?.kind)
        selection.push({ kind: "plane", ref: anyF.plane, label: "Plane" });
      break;
    case "linearPattern":
      Object.assign(params, {
        count: anyF.count,
        spacing: anyF.spacing,
        combine: anyF.combine,
        axisSource: anyF.direction?.kind === "axis" ? "origin" : "edge",
        axis: anyF.direction?.kind === "axis" ? anyF.direction.axis : "X",
      });
      pushAxis(anyF.direction);
      break;
    case "circularPattern":
      Object.assign(params, {
        count: anyF.count,
        totalAngle: anyF.totalAngle,
        combine: anyF.combine,
        ...axisParams(anyF.axis),
      });
      pushAxis(anyF.axis);
      break;
    case "splitBody":
      if (anyF.tool)
        selection.push({ kind: "plane", ref: anyF.tool, label: "Tool" });
      break;
    case "constructionPlane": {
      const m = f.method;
      const plane = (ref: PlaneRef, label: string) =>
        selection.push({ kind: "plane", ref, label });
      params.method = m.kind;
      switch (m.kind) {
        case "offset":
          Object.assign(params, { distance: m.distance, flip: m.flip });
          plane(m.base, "Base");
          break;
        case "midplane":
          Object.assign(params, { offset: m.offset, flip: m.flip });
          plane(m.a, "A");
          plane(m.b, "B");
          break;
        case "angle":
          Object.assign(params, { angle: m.angle, ...axisParams(m.axis) });
          pushAxis(m.axis);
          plane(m.base, "Base");
          break;
        case "threePoints":
          for (const point of m.points) selection.push({ ...point });
          break;
        case "twoEdges":
          for (const line of [m.a, m.b])
            if (line.kind === "originAxis")
              selection.push({ kind: "axis", axis: line.axis });
            else pushAxis(line);
      }
      break;
    }
    case "emboss":
      Object.assign(params, { depth: anyF.depth, embossMode: anyF.mode });
      break;
    case "move":
      Object.assign(params, {
        tx: anyF.translation?.[0] ?? 0,
        ty: anyF.translation?.[1] ?? 0,
        tz: anyF.translation?.[2] ?? 0,
      });
      break;
    default:
      break;
  }
  openDialog(f, { params, selection });
}

function openDialog(
  f: Feature,
  open: { params: Record<string, any>; selection: Selection[] },
) {
  const s = useStore.getState();
  s.setMode({
    name: "dialog",
    dialog: (f.type === "importMesh" ? "importStep" : f.type) as DialogType,
    editFeatureId: f.id,
  });
  s.setDialogParams(open.params);
  s.setSelection(open.selection);
}
