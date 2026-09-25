/**
 * Contextual feature panel (right side): parameter forms for each operation.
 * Flow: select geometry → enter parameters → OK commits the parametric
 * feature through the API.
 */

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type {
  AxisRef,
  ConstructionPlaneFeature,
  EdgeRef,
  ExportFormat,
  FaceRef,
  Feature,
  PlaneRef,
  PointRef,
  ProfileRef,
} from "@rockett/shared";
import { newId } from "@rockett/shared";
import {
  featurePatch,
  useStore,
  type DialogType,
  type Selection,
} from "../store";
import { api, saveDownload } from "../api";
import { extrudeOperation } from "../extrudeReach";
import { HANDLE_VALUES, type HandleDialog } from "../three/featureHandles";
import {
  clearInput,
  sketchPicks,
  takes,
  type PlaneMethod,
} from "../dialogPicks";
import { createLivePreview } from "../livePreview";
import { targetOperation, toolTargets } from "../toolTargets";
import { viewportHandle } from "../viewportRef";
import { DraggablePanel } from "./DraggablePanel";
import { ImportPanel } from "./ImportPanel";
import { RefRepair } from "./RefRepair";
import {
  AngleField,
  AxisField,
  axisOptions,
  CheckField,
  LengthField,
  NumField,
  SelInfo,
  SelectField,
  TargetField,
} from "./form/fields";
import { DialogFooter } from "./form/DialogFooter";
import { featureUI } from "../features/registry";
import "../features/shell";

const OFFSET_TAKES_ONE = "Offset takes one reference; remove the extra one";

function need(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

function attempt(build: (() => Feature) | null): Feature | null {
  try {
    return build?.() ?? null;
  } catch {
    return null;
  }
}

const picked = (value: unknown) =>
  JSON.stringify(value, (key, v) => (key === "sig" ? undefined : v));

function changes(stored: Feature | undefined, patch: Partial<Feature>) {
  const was: Record<string, unknown> = { targets: [], ...stored };
  return Object.entries({ targets: [], ...patch }).some(
    ([k, v]) => picked(was[k]) !== picked(v),
  );
}

function useLivePreview(editId: string | undefined, draft: Feature | null) {
  const key = draft && JSON.stringify(featurePatch(draft));
  const sent = useRef(editId ? key : null);
  const [live] = useState(() =>
    createLivePreview({
      send: async (_id, feature) => {
        const patch = featurePatch(feature as Feature);
        sent.current = JSON.stringify(patch);
        const s = useStore.getState();
        if (!editId) return s.previewNewFeature(feature as Feature);
        const stored = s.document?.features.find((f) => f.id === editId);
        if (changes(stored, patch))
          return s.updateFeaturePreview(editId, patch);
      },
    }),
  );
  useEffect(() => {
    if (draft && key !== sent.current) live.dwell(draft.id, draft);
    else live.cancel();
  }, [key]);
  useEffect(() => live.cancel, [live]);
  return live;
}

export function FeatureDialog() {
  const mode = useStore((s) => s.mode);
  if (mode.name !== "dialog") return null;
  return (
    <DialogBody
      key={mode.dialog + (mode.editFeatureId ?? "")}
      dialog={mode.dialog}
      editId={mode.editFeatureId}
    />
  );
}

function DialogBody({
  dialog,
  editId,
}: {
  dialog: DialogType;
  editId?: string | undefined;
}) {
  const selection = useStore((s) => s.selection);
  const params = useStore((s) => s.dialogParams);
  const setParams = useStore((s) => s.setDialogParams);
  const setMode = useStore((s) => s.setMode);
  const addFeature = useStore((s) => s.addFeature);
  const updateFeature = useStore((s) => s.updateFeature);
  const setError = useStore((s) => s.setError);
  const document_ = useStore((s) => s.document);
  const [pending, setPending] = useState(false);

  const profiles = selection.filter((s) => s.kind === "profile") as Extract<
    Selection,
    { kind: "profile" }
  >[];
  const edges = selection.filter((s) => s.kind === "edge") as Extract<
    Selection,
    { kind: "edge" }
  >[];
  const faces = selection.filter((s) => s.kind === "face") as Extract<
    Selection,
    { kind: "face" }
  >[];
  const bodies = selection.filter((s) => s.kind === "body") as Extract<
    Selection,
    { kind: "body" }
  >[];
  const planes = selection.filter((s) => s.kind === "plane") as Extract<
    Selection,
    { kind: "plane" }
  >[];
  // selected sketch LINES (axis candidates for revolve / circular pattern)
  const sketchLines = (
    selection.filter((s) => s.kind === "sketchEntity") as any[]
  ).filter((s) => {
    const sk = document_?.features.find(
      (f) => f.id === s.sketchId && f.type === "sketch",
    ) as any;
    return sk?.entities.find((x: any) => x.id === s.entityId)?.kind === "line";
  });

  const p = (key: string, dflt: any) => params[key] ?? dflt;
  const num = (key: string, dflt: number) => {
    const v = Number(params[key]);
    return Number.isFinite(v) ? v : dflt;
  };
  const main = (d: HandleDialog) =>
    num(HANDLE_VALUES[d].param, HANDLE_VALUES[d].fallback);

  // Picking an edge or sketch line in an axis-based dialog switches the axis
  // to it — the dropdown alone gave no hint the pick was registered.
  const axisDialog =
    dialog === "constructionPlane"
      ? params.method === "angle"
      : takes(dialog, "axis");
  useEffect(() => {
    if (!axisDialog) return;
    if (
      (edges.length > 0 || sketchLines.length > 0) &&
      params.axisSource !== "edge"
    ) {
      setParams({ axisSource: "edge" });
    }
  }, [edges.length, sketchLines.length, dialog]);
  const originAxis = selection.findLast((s) => s.kind === "axis")?.axis;
  useEffect(() => {
    if (axisDialog && originAxis)
      setParams({ axisSource: "origin", axis: originAxis });
  }, [originAxis, dialog]);

  const profileRefs = (): ProfileRef[] =>
    profiles.map((x) => ({ sketchId: x.sketchId, profileId: x.profileId }));
  const edgeRefs = (): EdgeRef[] =>
    edges.map((x) => ({
      kind: "edge",
      bodyId: x.bodyId,
      edgeName: x.edgeName,
    }));
  const faceRefs = (): FaceRef[] =>
    faces.map((x) => ({
      kind: "face",
      bodyId: x.bodyId,
      faceName: x.faceName,
    }));
  const storedFeature = () =>
    document_?.features.find((f) => f.id === editId) ?? {};
  const profileSources = () => {
    need(
      profiles.length + faces.length > 0,
      "Select at least one profile or planar face",
    );
    return {
      profiles: profileRefs(),
      ...((faces.length > 0 || "faces" in storedFeature()) && {
        faces: faceRefs(),
      }),
    };
  };
  const planeRef = (): PlaneRef | null => {
    if (planes.length > 0) return planes[0]!.ref;
    if (faces.length > 0) return { kind: "face", face: faceRefs()[0]! };
    return null;
  };
  const axisMissing =
    axisDialog &&
    p("axisSource", "origin") === "edge" &&
    edges.length + sketchLines.length === 0;
  const axisHint = axisMissing
    ? "Pick an axis"
    : "click a sketch line or body edge, or pick X/Y/Z";
  const chooseAxis = (key: string, patch: Record<string, unknown>) => {
    setParams(patch);
    clearInput(key);
  };
  const axisRef = (): AxisRef => {
    if (p("axisSource", "origin") !== "edge")
      return { kind: "originAxis", axis: p("axis", "Z") };
    need(!axisMissing, "Pick an axis");
    const line = sketchLines[0];
    return line
      ? { kind: "sketchLine", sketchId: line.sketchId, entityId: line.entityId }
      : { kind: "edge", edge: edgeRefs()[0]! };
  };

  const close = () => setMode({ name: "idle" });

  const targets = (operation: string) =>
    toolTargets(operation, params.targets, document_?.namingVersion);
  const operationField = (intersect: boolean, extra: object = {}) => (
    <>
      <SelectField
        label="Operation"
        value={p("operation", "join")}
        options={[
          ["newBody", "New body"],
          ["join", "Join"],
          ["cut", "Cut"],
          ...(intersect
            ? [["intersect", "Intersect"] as [string, string]]
            : []),
        ]}
        onChange={(v) => setParams({ operation: v, ...extra })}
      />
      <TargetField operation={p("operation", "join")} />
    </>
  );

  useEffect(() => {
    if (dialog !== "extrude" || num("distance", 10) === 0) return;
    if (params.operation !== undefined && !params.autoOperation) return;
    const operation = extrudeOperation(
      p("direction", "normal"),
      num("distance", 10),
      num("startOffset", 0),
      num("distance2", 5),
    );
    if (operation !== params.operation)
      setParams({ operation, autoOperation: true });
  }, [dialog, selection, params]);

  let title = "";
  let body: ReactElement | null = null;
  let build: (() => Feature) | null = null;
  let panel: ReactElement | null = null;

  const ui = featureUI(dialog);
  if (ui) {
    title = ui.title;
    body = <ui.Form params={params} setParams={setParams} />;
    build = () => {
      const built = ui.build(params, selection);
      if ("error" in built) throw new Error(built.error);
      return built;
    };
  }
  switch (dialog) {
    case "importStep": {
      panel = <ImportPanel editId={editId} onClose={close} />;
      break;
    }
    case "extrude": {
      title = "Extrude";
      body = (
        <>
          <SelInfo
            label="Profiles / faces"
            input="profiles"
            hint="click sketch regions or planar faces"
          />
          <NumField
            label="Start offset (mm)"
            value={p("startOffset", 0)}
            onChange={(v) => setParams({ startOffset: v })}
          />
          <div className="field-hint">
            0 = start on the sketch / face; ± moves the start plane along its
            normal
          </div>
          <NumField
            label="Distance (mm)"
            autoFocus
            value={p("distance", 10)}
            onChange={(v) => setParams({ distance: v })}
          />
          <div className="field-hint">
            Negative = the other side (Cut when it meets a body)
          </div>
          <SelectField
            label="Direction"
            value={p("direction", "normal")}
            options={[
              ["normal", "One side"],
              ["reverse", "Reversed"],
              ["symmetric", "Symmetric"],
              ["twoSided", "Two sided"],
            ]}
            onChange={(v) => setParams({ direction: v })}
          />
          {p("direction", "normal") === "twoSided" && (
            <NumField
              label="Distance 2 (mm)"
              value={p("distance2", 5)}
              onChange={(v) => setParams({ distance2: v })}
            />
          )}
          {operationField(true, { autoOperation: false })}
        </>
      );
      build = () => {
        const sources = profileSources();
        need(num("distance", 10) !== 0, "Extrude distance must be non-zero");
        const stored = storedFeature();
        const direction = p("direction", "normal");
        const startOffset = num("startOffset", 0);
        return {
          id: editId ?? newId("extrude"),
          type: "extrude",
          name: p("name", ""),
          suppressed: false,
          ...sources,
          distance: num("distance", 10),
          ...((direction === "twoSided" || "distance2" in stored) && {
            distance2: num("distance2", 5),
          }),
          ...((startOffset !== 0 || "startOffset" in stored) && {
            startOffset,
          }),
          direction,
          operation: p("operation", "join"),
          ...targets(p("operation", "join")),
        };
      };
      break;
    }
    case "revolve": {
      title = "Revolve";
      body = (
        <>
          <SelInfo
            label="Profiles / faces"
            input="profiles"
            hint="click sketch regions or Shift-click planar faces"
          />
          <SelInfo
            label="Axis"
            input="axis"
            picks={[...edges, ...sketchLines]}
            hint={axisHint}
          />
          <AxisField
            axisSource={params.axisSource}
            axis={params.axis}
            onChange={(patch) => chooseAxis("axis", patch)}
          />
          <NumField
            label="Angle (°)"
            autoFocus
            value={p("angle", 360)}
            onChange={(v) => setParams({ angle: v })}
          />
          {operationField(true)}
        </>
      );
      build = () => {
        return {
          id: editId ?? newId("revolve"),
          type: "revolve",
          name: p("name", ""),
          suppressed: false,
          ...profileSources(),
          axis: axisRef(),
          angle: num("angle", 360),
          operation: p("operation", "join"),
          ...targets(p("operation", "join")),
        };
      };
      break;
    }
    case "move": {
      title = "Move";
      body = (
        <>
          <SelInfo label="Bodies" input="bodies" hint="click bodies" />
          <NumField
            label="X (mm)"
            autoFocus
            value={p("tx", 0)}
            onChange={(v) => setParams({ tx: v })}
          />
          <NumField
            label="Y (mm)"
            value={p("ty", 0)}
            onChange={(v) => setParams({ ty: v })}
          />
          <NumField
            label="Z (mm)"
            value={p("tz", 0)}
            onChange={(v) => setParams({ tz: v })}
          />
        </>
      );
      build = () => {
        need(bodies.length > 0, "Select at least one body");
        return {
          id: editId ?? newId("move"),
          type: "move",
          name: p("name", ""),
          suppressed: false,
          bodies: bodies.map((b) => b.bodyId),
          translation: [num("tx", 0), num("ty", 0), num("tz", 0)],
        };
      };
      break;
    }
    case "sweep": {
      title = "Sweep";
      const sketches = (document_?.features ?? []).filter(
        (f) => f.type === "sketch",
      );
      body = (
        <>
          <SelInfo
            label="Profile"
            input="profiles"
            hint="click a sketch region"
          />
          <SelectField
            label="Path sketch"
            value={p("pathSketchId", "")}
            options={[
              ["", "Choose"],
              ...sketches.map((s) => [s.id, s.name] as [string, string]),
            ]}
            onChange={(v) => setParams({ pathSketchId: v })}
          />
          <SelInfo
            label="Path sketch"
            input="path"
            picks={sketchPicks(params.pathSketchId)}
            hint="click a curve of the path sketch"
            onRemove={() => clearInput("path")}
          />
          {operationField(false)}
        </>
      );
      build = () => {
        need(profiles.length > 0, "Select a profile");
        need(p("pathSketchId", ""), "Choose a path sketch");
        return {
          id: editId ?? newId("sweep"),
          type: "sweep",
          name: p("name", ""),
          suppressed: false,
          profiles: profileRefs(),
          pathSketchId: p("pathSketchId", ""),
          operation: p("operation", "join"),
          ...targets(p("operation", "join")),
        };
      };
      break;
    }
    case "loft": {
      title = "Loft";
      body = (
        <>
          <SelInfo
            label="Sections (in order)"
            input="profiles"
            hint="click 2+ profiles"
          />
          {operationField(false)}
        </>
      );
      build = () => {
        need(profiles.length >= 2, "Select at least two section profiles");
        return {
          id: editId ?? newId("loft"),
          type: "loft",
          name: p("name", ""),
          suppressed: false,
          sections: profileRefs(),
          operation: p("operation", "join"),
          ...targets(p("operation", "join")),
        };
      };
      break;
    }
    case "emboss": {
      title = "Emboss";
      body = (
        <>
          <SelInfo
            label="Profiles"
            input="profiles"
            hint="sketch on a face, then pick regions"
          />
          <NumField
            label="Depth (mm)"
            autoFocus
            value={p("depth", main("emboss"))}
            onChange={(v) => setParams({ depth: v })}
          />
          <SelectField
            label="Mode"
            value={p("embossMode", "emboss")}
            options={[
              ["emboss", "Emboss (raise)"],
              ["deboss", "Deboss (engrave)"],
            ]}
            onChange={(v) => setParams({ embossMode: v })}
          />
          <TargetField operation={targetOperation(dialog, params)} />
        </>
      );
      build = () => {
        need(profiles.length > 0, "Select profiles");
        return {
          id: editId ?? newId("emboss"),
          type: "emboss",
          name: p("name", ""),
          suppressed: false,
          profiles: profileRefs(),
          depth: main("emboss"),
          mode: p("embossMode", "emboss"),
          ...targets(targetOperation(dialog, params)),
        };
      };
      break;
    }
    case "fillet": {
      title = "Fillet";
      body = (
        <>
          <SelInfo label="Edges" input="edges" hint="click model edges" />
          <label>
            <input
              type="checkbox"
              checked={p("tangentChain", true)}
              onChange={(e) => setParams({ tangentChain: e.target.checked })}
            />{" "}
            Select tangent chain
          </label>
          <small>
            Smooth curves chain together; sharp corners stop the selection.
          </small>
          <NumField
            label="Radius (mm)"
            autoFocus
            value={p("radius", main("fillet"))}
            onChange={(v) => setParams({ radius: v })}
          />
        </>
      );
      build = () => {
        need(edges.length > 0, "Select at least one edge");
        return {
          id: editId ?? newId("fillet"),
          type: "fillet",
          name: p("name", ""),
          suppressed: false,
          edges: edgeRefs(),
          radius: main("fillet"),
          tangentChain: p("tangentChain", true),
        };
      };
      break;
    }
    case "chamfer": {
      title = "Chamfer";
      body = (
        <>
          <SelInfo label="Edges" input="edges" hint="click model edges" />
          <label>
            <input
              type="checkbox"
              checked={p("tangentChain", true)}
              onChange={(e) => setParams({ tangentChain: e.target.checked })}
            />{" "}
            Select tangent chain
          </label>
          <small>
            Smooth curves chain together; sharp corners stop the selection.
          </small>
          <NumField
            label="Distance (mm)"
            autoFocus
            value={p("distance", main("chamfer"))}
            onChange={(v) => setParams({ distance: v })}
          />
        </>
      );
      build = () => {
        need(edges.length > 0, "Select at least one edge");
        return {
          id: editId ?? newId("chamfer"),
          type: "chamfer",
          name: p("name", ""),
          suppressed: false,
          edges: edgeRefs(),
          distance: main("chamfer"),
          tangentChain: p("tangentChain", true),
        };
      };
      break;
    }
    case "combine": {
      title = "Combine";
      body = (
        <>
          <SelInfo
            label="Bodies (first = target)"
            input="bodies"
            hint="click bodies: first is the target"
          />
          <SelectField
            label="Operation"
            value={p("operation", "join")}
            options={[
              ["join", "Join"],
              ["cut", "Cut"],
              ["intersect", "Intersect"],
            ]}
            onChange={(v) => setParams({ operation: v })}
          />
          <CheckField
            label="Keep tools"
            value={!!p("keepTools", false)}
            onChange={(v) => setParams({ keepTools: v })}
          />
        </>
      );
      build = () => {
        need(bodies.length >= 2, "Select a target body then tool bodies");
        return {
          id: editId ?? newId("combine"),
          type: "combine",
          name: p("name", ""),
          suppressed: false,
          operation: p("operation", "join"),
          targetBody: bodies[0]!.bodyId,
          toolBodies: bodies.slice(1).map((b) => b.bodyId),
          keepTools: !!p("keepTools", false),
        };
      };
      break;
    }
    case "splitBody": {
      title = "Split Body";
      body = (
        <>
          <SelInfo label="Body" input="body" hint="click the body to split" />
          <SelInfo
            label="Split plane"
            input="tool"
            hint="click an origin/construction plane or planar face"
          />
        </>
      );
      build = () => {
        need(bodies.length > 0, "Select a body to split");
        const tool = planeRef();
        need(tool, "Select a splitting plane");
        return {
          id: editId ?? newId("split"),
          type: "splitBody",
          name: p("name", ""),
          suppressed: false,
          body: bodies[0]!.bodyId,
          tool,
        };
      };
      break;
    }
    case "offsetFace": {
      title = "Press / Pull";
      body = (
        <>
          <SelInfo label="Faces" input="faces" hint="click planar faces" />
          <NumField
            label="Distance (mm, − = inward)"
            autoFocus
            value={p("distance", main("offsetFace"))}
            onChange={(v) => setParams({ distance: v })}
          />
        </>
      );
      build = () => {
        need(faces.length > 0, "Select faces");
        return {
          id: editId ?? newId("offsetf"),
          type: "offsetFace",
          name: p("name", ""),
          suppressed: false,
          faces: faceRefs(),
          distance: main("offsetFace"),
        };
      };
      break;
    }
    case "mirror": {
      title = "Mirror";
      body = (
        <>
          <SelInfo label="Bodies" input="bodies" hint="click bodies" />
          <SelInfo
            label="Mirror plane"
            input="plane"
            hint="origin/construction plane or planar face"
          />
          <CheckField
            label="Join with source"
            value={!!p("combine", true)}
            onChange={(v) => setParams({ combine: v })}
          />
        </>
      );
      build = () => {
        need(bodies.length > 0, "Select bodies to mirror");
        const plane = planeRef();
        need(plane, "Select a mirror plane");
        return {
          id: editId ?? newId("mirror"),
          type: "mirror",
          name: p("name", ""),
          suppressed: false,
          bodies: bodies.map((b) => b.bodyId),
          plane,
          combine: p("combine", true),
        };
      };
      break;
    }
    case "linearPattern": {
      title = "Rectangular Pattern";
      body = (
        <>
          <SelInfo label="Bodies" input="bodies" hint="click bodies" />
          <SelInfo
            label="Direction edge"
            input="direction"
            picks={edges}
            hint={
              axisMissing
                ? "Pick a direction"
                : "click a body edge, or pick X/Y/Z"
            }
          />
          <SelectField
            label="Direction"
            value={
              p("axisSource", "origin") === "edge" ? "edge" : p("axis", "X")
            }
            options={[...axisOptions, ["edge", "Selected edge"]]}
            onChange={(v) =>
              chooseAxis(
                "direction",
                v === "edge"
                  ? { axisSource: "edge" }
                  : { axisSource: "origin", axis: v },
              )
            }
          />
          <NumField
            label="Quantity"
            value={p("count", 3)}
            onChange={(v) => setParams({ count: v })}
            int
          />
          <NumField
            label="Spacing (mm)"
            autoFocus
            value={p("spacing", main("linearPattern"))}
            onChange={(v) => setParams({ spacing: v })}
          />
          <CheckField
            label="Join instances"
            value={!!p("combine", false)}
            onChange={(v) => setParams({ combine: v })}
          />
        </>
      );
      build = () => {
        need(bodies.length > 0, "Select bodies to pattern");
        need(!axisMissing, "Pick a direction");
        const direction =
          p("axisSource", "origin") === "edge"
            ? ({ kind: "edge", edge: edgeRefs()[0]! } as const)
            : ({ kind: "axis", axis: p("axis", "X") } as const);
        return {
          id: editId ?? newId("lpat"),
          type: "linearPattern",
          name: p("name", ""),
          suppressed: false,
          bodies: bodies.map((b) => b.bodyId),
          direction,
          count: Math.round(num("count", 3)),
          spacing: main("linearPattern"),
          combine: !!p("combine", false),
        };
      };
      break;
    }
    case "circularPattern": {
      title = "Circular Pattern";
      body = (
        <>
          <SelInfo label="Bodies" input="bodies" hint="click bodies" />
          <SelInfo
            label="Axis"
            input="axis"
            picks={[...edges, ...sketchLines]}
            hint={axisHint}
          />
          <AxisField
            axisSource={params.axisSource}
            axis={params.axis}
            onChange={(patch) => chooseAxis("axis", patch)}
          />
          <NumField
            label="Quantity"
            autoFocus
            value={p("count", 6)}
            onChange={(v) => setParams({ count: v })}
            int
          />
          <NumField
            label="Total angle (°)"
            value={p("totalAngle", main("circularPattern"))}
            onChange={(v) => setParams({ totalAngle: v })}
          />
          <CheckField
            label="Join instances"
            value={!!p("combine", false)}
            onChange={(v) => setParams({ combine: v })}
          />
        </>
      );
      build = () => {
        need(bodies.length > 0, "Select bodies to pattern");
        return {
          id: editId ?? newId("cpat"),
          type: "circularPattern",
          name: p("name", ""),
          suppressed: false,
          bodies: bodies.map((b) => b.bodyId),
          axis: axisRef(),
          count: Math.round(num("count", 6)),
          totalAngle: main("circularPattern"),
          combine: !!p("combine", false),
        };
      };
      break;
    }
    case "constructionPlane": {
      title = "Construction Plane";
      const method: PlaneMethod = p("method", "offset");
      const refs = selection.flatMap((x): PlaneRef[] =>
        x.kind === "plane"
          ? [x.ref]
          : x.kind === "face"
            ? [{ kind: "face", face: { ...x } }]
            : [],
      );
      const points = selection.flatMap((x): PointRef[] =>
        x.kind === "vertex" || x.kind === "sketchPoint" ? [{ ...x }] : [],
      );
      const lines = selection.flatMap((x): AxisRef[] => {
        if (x.kind === "edge") return [{ kind: "edge", edge: { ...x } }];
        if (x.kind === "axis") return [{ kind: "originAxis", axis: x.axis }];
        return x.kind === "sketchEntity"
          ? [{ kind: "sketchLine", sketchId: x.sketchId, entityId: x.entityId }]
          : [];
      });
      const flip = !!p("flip", false);
      const flipField = (
        <CheckField
          label="Flip"
          value={flip}
          onChange={(v) => setParams({ flip: v })}
        />
      );
      body = (
        <>
          <SelectField
            label="Method"
            value={method}
            options={[
              ["offset", "Offset"],
              ["midplane", "Midplane"],
              ["angle", "At angle"],
              ["threePoints", "3 points"],
              ["twoEdges", "2 edges"],
            ]}
            onChange={(v) => setParams({ method: v })}
          />
          {method === "offset" && (
            <>
              <SelInfo
                label="Reference plane"
                input="plane"
                hint="click a plane or planar face"
              />
              {refs.length > 1 && (
                <div className="field-hint">{OFFSET_TAKES_ONE}</div>
              )}
              <NumField
                label="Offset (mm)"
                autoFocus
                value={p("distance", main("constructionPlane"))}
                onChange={(v) => setParams({ distance: v })}
              />
              {flipField}
            </>
          )}
          {method === "midplane" && (
            <>
              <SelInfo
                label="Planes"
                input="plane"
                hint="click two planes or planar faces"
              />
              <NumField
                label="Offset (mm)"
                value={p("offset", 0)}
                onChange={(v) => setParams({ offset: v })}
              />
              {flipField}
            </>
          )}
          {method === "angle" && (
            <>
              <SelInfo
                label="Axis"
                input="axis"
                picks={[...edges, ...sketchLines]}
                hint={axisHint}
              />
              <AxisField
                axisSource={params.axisSource}
                axis={params.axis}
                onChange={(patch) => chooseAxis("axis", patch)}
              />
              <SelInfo
                label="Reference plane"
                input="plane"
                hint="click a plane or planar face"
              />
              <AngleField
                label="Angle"
                value={p("angle", 90)}
                onChange={(v) => setParams({ angle: v })}
              />
            </>
          )}
          {method === "threePoints" && (
            <SelInfo
              label="Points"
              input="points"
              hint="click three vertices or sketch points"
            />
          )}
          {method === "twoEdges" && (
            <SelInfo
              label="Edges"
              input="lines"
              hint="click two straight edges in one plane"
            />
          )}
        </>
      );
      const planeMethod = (): ConstructionPlaneFeature["method"] => {
        switch (method) {
          case "offset":
            need(refs.length > 0, "Select a base plane or face");
            need(refs.length === 1, OFFSET_TAKES_ONE);
            return {
              kind: "offset",
              base: refs[0]!,
              distance: main("constructionPlane"),
              ...(flip && { flip }),
            };
          case "midplane": {
            need(refs.length === 2, "Select two references for a midplane");
            const offset = num("offset", 0);
            return {
              kind: "midplane",
              a: refs[0]!,
              b: refs[1]!,
              ...(offset !== 0 && { offset }),
              ...(flip && { flip }),
            };
          }
          case "angle":
            need(refs.length === 1, "Select a reference plane or face");
            return {
              kind: "angle",
              axis: axisRef(),
              base: refs[0]!,
              angle: num("angle", 90),
            };
          case "threePoints":
            need(points.length === 3, "Select three points");
            return {
              kind: "threePoints",
              points: [points[0]!, points[1]!, points[2]!],
            };
          case "twoEdges":
            need(lines.length === 2, "Select two straight edges");
            return { kind: "twoEdges", a: lines[0]!, b: lines[1]! };
        }
      };
      build = () => ({
        id: editId ?? newId("plane"),
        type: "constructionPlane",
        name: p("name", ""),
        suppressed: false,
        method: planeMethod(),
      });
      break;
    }
    case "referenceImage": {
      panel = (
        <ReferenceImagePanel
          editId={editId}
          planeRef={planeRef}
          onClose={close}
        />
      );
      break;
    }
    case "export": {
      panel = <ExportPanel onClose={close} />;
      break;
    }
  }

  const live = useLivePreview(editId, attempt(build));
  useEffect(
    () => () => {
      void useStore.getState().cancelPreview();
    },
    [],
  );
  if (panel) return panel;

  const ok = async () => {
    let feature: Feature;
    try {
      feature = build!();
    } catch (e: any) {
      setError(e.message);
      return;
    }
    live.cancel();
    const { previewBaseline, document: current } = useStore.getState();
    const before = (previewBaseline ?? current)?.features.find(
      (f) => f.id === editId,
    );
    if (editId && !changes(before, featurePatch(feature))) return close();
    setPending(true);
    try {
      if (editId) await updateFeature(editId, featurePatch(feature));
      else await addFeature(feature);
      close();
    } catch {
      // error toast already set by store
    } finally {
      setPending(false);
    }
  };

  return (
    <DraggablePanel title={title}>
      <div className="dialog-body">
        <RefRepair />
        {body}
      </div>
      <DialogFooter
        onOk={() => void ok()}
        onCancel={close}
        pending={pending}
        okDisabled={axisMissing}
        escapeAnywhere
      />
    </DraggablePanel>
  );
}

// ---------------------------------------------------------------------------
// Reference image panel
// ---------------------------------------------------------------------------

function ReferenceImagePanel({
  editId,
  planeRef,
  onClose,
}: {
  editId?: string | undefined;
  planeRef: () => PlaneRef | null;
  onClose: () => void;
}) {
  const document_ = useStore((s) => s.document);
  const addFeature = useStore((s) => s.addFeature);
  const updateFeature = useStore((s) => s.updateFeature);
  const setError = useStore((s) => s.setError);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);

  const existing = editId
    ? (document_?.features.find((f) => f.id === editId) as any)
    : null;
  const [opacity, setOpacity] = useState<number>(existing?.opacity ?? 0.6);
  const [scale, setScale] = useState<number>(existing?.transform.scale ?? 0.5);
  const [rotation, setRotation] = useState<number>(
    existing?.transform.rotation ?? 0,
  );
  const [u, setU] = useState<number>(existing?.transform.u ?? 0);
  const [v, setV] = useState<number>(existing?.transform.v ?? 0);
  const [calibrating, setCalibrating] = useState(false);

  const live = useLivePreview(
    editId,
    existing
      ? { ...existing, opacity, transform: { u, v, rotation, scale } }
      : null,
  );

  const onOk = async () => {
    live.cancel();
    setPending(true);
    try {
      if (existing) {
        await updateFeature(editId!, {
          opacity,
          transform: { u, v, rotation, scale },
        } as any);
        onClose();
        return;
      }
      if (!file) {
        setError("Choose an image file (PNG, JPEG, WebP)");
        return;
      }
      const plane = planeRef() ?? {
        kind: "origin" as const,
        plane: "XY" as const,
      };
      const { assetId } = await api.uploadImage(document_!.id, file);
      const img = new Image();
      const dims = await new Promise<{ w: number; h: number }>(
        (resolve, reject) => {
          img.onload = () =>
            resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = reject;
          img.src = URL.createObjectURL(file);
        },
      );
      await addFeature({
        id: newId("canvas"),
        type: "referenceImage",
        name: "",
        suppressed: false,
        plane,
        assetId,
        fileName: file.name,
        transform: { u, v, rotation, scale },
        opacity,
        width: dims.w,
        height: dims.h,
      });
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPending(false);
    }
  };

  const calibrate = async () => {
    // Two clicks on the image plane, then a real-world distance.
    setCalibrating(true);
    const vp = viewportHandle.current;
    if (!vp || !existing) {
      setCalibrating(false);
      return;
    }
    const clicks: { x: number; y: number; z: number }[] = [];
    const el = vp.renderer.domElement;
    const evalState = useStore.getState().evaluation;
    const frame = evalState?.planes.find((p) => p.featureId === editId)?.frame;
    if (!frame) {
      setCalibrating(false);
      return;
    }
    const handler = (e: PointerEvent) => {
      const pt = vp.screenToPlanePoint(e.clientX, e.clientY, frame);
      if (!pt) return;
      clicks.push({ x: pt.x, y: pt.y, z: pt.z });
      if (clicks.length === 2) {
        el.removeEventListener("pointerdown", handler, true);
        const a = clicks[0]!;
        const b = clicks[1]!;
        const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        const desired = Number(
          window.prompt("Real distance between the two points (mm):", "100"),
        );
        setCalibrating(false);
        if (Number.isFinite(desired) && desired > 0 && d > 1e-9) {
          setScale((s) => s * (desired / d));
        }
      }
      e.stopPropagation();
    };
    el.addEventListener("pointerdown", handler, true);
  };

  return (
    <DraggablePanel title="Reference Image">
      <div className="dialog-body">
        {!existing && (
          <>
            <SelInfo
              label="Plane"
              input="plane"
              hint="click a plane/face (default XY)"
            />
            <label className="field">
              <span>Image file</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
          </>
        )}
        <NumField
          label="Scale (mm / pixel)"
          autoFocus
          value={scale}
          onChange={setScale}
        />
        <AngleField label="Rotation" value={rotation} onChange={setRotation} />
        <LengthField label="Position U" units="mm" value={u} onChange={setU} />
        <LengthField label="Position V" units="mm" value={v} onChange={setV} />
        <label className="field">
          <span>Opacity</span>
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
          />
        </label>
        {existing && (
          <button
            className="btn"
            disabled={calibrating}
            onClick={() => void calibrate()}
          >
            {calibrating
              ? "Click two points on the image…"
              : "Calibrate (2 points)"}
          </button>
        )}
      </div>
      <DialogFooter
        onOk={() => void onOk()}
        onCancel={onClose}
        pending={pending}
        escapeAnywhere
      />
    </DraggablePanel>
  );
}

// ---------------------------------------------------------------------------
// Export panel
// ---------------------------------------------------------------------------

function ExportPanel({ onClose }: { onClose: () => void }) {
  const document_ = useStore((s) => s.document);
  const evaluation = useStore((s) => s.evaluation);
  const hiddenBodies = useStore((s) => s.view.hidden.bodies);
  const selection = useStore((s) => s.selection);
  const setError = useStore((s) => s.setError);
  const [exporters, setExporters] = useState<ExportFormat[]>([]);
  const [picked, setFormat] = useState("");
  const format = picked || exporters[0]?.format;
  const [quality, setQuality] = useState(0.05);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    api.formats().then(
      (formats) =>
        setExporters(formats.exporters.filter((e) => e.source === "bodies")),
      (e: Error) => setError(e.message),
    );
  }, [setError]);

  const selectedBodies = useMemo(
    () => selection.filter((s) => s.kind === "body").map((s: any) => s.bodyId),
    [selection],
  );
  const shownBodies = useMemo(() => {
    const hidden = new Set(hiddenBodies);
    return (evaluation?.bodies ?? [])
      .filter((b) => !hidden.has(b.bodyId))
      .map((b) => b.bodyId);
  }, [evaluation, hiddenBodies]);

  const doExport = async () => {
    if (!document_ || !format) return;
    setPending(true);
    try {
      saveDownload(
        await api.exportModel(document_.id, {
          format,
          bodyIds: selectedBodies.length > 0 ? selectedBodies : shownBodies,
          quality,
        }),
      );
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <DraggablePanel title="Export for 3D printing">
      <div className="dialog-body">
        <SelInfo
          label="Bodies"
          input="bodies"
          hint={`all visible (${shownBodies.length})`}
        />
        <label className="field">
          <span>Format</span>
          <select value={format} onChange={(e) => setFormat(e.target.value)}>
            {exporters.map((e) => (
              <option key={e.format} value={e.format}>
                {e.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Quality (mm deviation)</span>
          <select
            value={quality}
            onChange={(e) => setQuality(Number(e.target.value))}
          >
            <option value={0.1}>Draft (0.1)</option>
            <option value={0.05}>Standard (0.05)</option>
            <option value={0.01}>Fine (0.01)</option>
          </select>
        </label>
      </div>
      <DialogFooter
        onOk={() => void doExport()}
        onCancel={onClose}
        pending={pending}
        okDisabled={!format}
        okLabel={pending ? "Exporting…" : "Download"}
        escapeAnywhere
      />
    </DraggablePanel>
  );
}
