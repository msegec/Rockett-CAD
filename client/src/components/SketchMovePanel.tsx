import { useEffect, useMemo, useState } from "react";
import {
  boundConstraintIds,
  FixedEntityError,
  formatLength,
  moveSketchSelection,
  type SketchFeature,
  type Units,
} from "@rockett/shared";
import { useStore, type Selection } from "../store";
import { useSetting } from "../settings";
import { pickLabel } from "../selection/labels";
import { DraggablePanel } from "./DraggablePanel";
import { DialogFooter } from "./form/DialogFooter";
import {
  AngleField,
  CheckField,
  LengthField,
  SelectField,
} from "./form/fields";
import { useSketchPreview } from "./SketchOffsetPanel";

type XY = { x: number; y: number };
type Move = { dx: number; dy: number; angle: number; copy: boolean };
const START: Move = { dx: 0, dy: 0, angle: 0, copy: false };

export function SketchMove() {
  const draft = useStore((s) => s.draftSketch);
  return draft && <SketchMovePanel draft={draft} />;
}

const sketchIds = (selection: Selection[], sketchId: string) =>
  selection.flatMap((s) =>
    (s.kind === "sketchEntity" || s.kind === "sketchPoint") &&
    s.sketchId === sketchId
      ? [s.entityId]
      : [],
  );

function refusal(e: unknown, draft: SketchFeature): string {
  if (!(e instanceof FixedEntityError)) return (e as Error).message;
  const { document, evaluation } = useStore.getState();
  const name = pickLabel(
    { kind: "sketchEntity", sketchId: draft.id, entityId: e.entityId },
    document,
    evaluation,
    [],
  );
  return `${name}: ${e.message}`;
}

function usePickedPoint(draft: SketchFeature) {
  const selection = useStore((s) => s.selection);
  const [held, setHeld] = useState<Selection[] | null>(null);
  const [pivot, setPivot] = useState<XY | null>(null);
  useEffect(() => {
    if (!held) return;
    const picked = sketchIds(selection, draft.id)
      .map((id) => draft.entities.find((e) => e.id === id))
      .find((e) => e?.kind === "point");
    if (picked?.kind !== "point") return;
    setPivot({ x: picked.x, y: picked.y });
    setHeld(null);
    useStore.getState().setSelection(held);
  }, [selection, held, draft]);
  const toggle = () => {
    const s = useStore.getState();
    setHeld(held ? null : s.selection);
    s.setSelection(held ?? []);
  };
  const shown = held ?? selection;
  const ids = useMemo(() => sketchIds(shown, draft.id), [shown, draft.id]);
  return { ids, held, pivot, toggle };
}

function MoveFields({
  move,
  setMove,
  units,
}: {
  move: Move;
  setMove: (move: Move) => void;
  units: Units;
}) {
  return (
    <>
      <LengthField
        label="X distance"
        units={units}
        step={1}
        ariaLabel="Move X distance"
        autoFocus
        value={move.dx}
        onChange={(dx) => setMove({ ...move, dx })}
      />
      <LengthField
        label="Y distance"
        units={units}
        step={1}
        ariaLabel="Move Y distance"
        value={move.dy}
        onChange={(dy) => setMove({ ...move, dy })}
      />
      <AngleField
        label="Angle"
        step={15}
        ariaLabel="Move angle"
        value={move.angle}
        onChange={(angle) => setMove({ ...move, angle })}
      />
    </>
  );
}

function PivotFields({
  about,
  setAbout,
  picking,
  pivot,
  onPick,
  units,
}: {
  about: "centre" | "point";
  setAbout: (v: "centre" | "point") => void;
  picking: boolean;
  pivot: XY | null;
  onPick: () => void;
  units: Units;
}) {
  return (
    <>
      <SelectField
        label="Rotate about"
        value={about}
        options={[
          ["centre", "Selection centre"],
          ["point", "Picked point"],
        ]}
        onChange={setAbout}
      />
      {about === "point" && (
        <>
          <button className="btn" aria-pressed={picking} onClick={onPick}>
            {picking ? "Stop" : "Pick point"}
          </button>
          <p className="field-hint">
            {picking
              ? "Click a sketch point to rotate about."
              : pivot
                ? `Rotates about ${formatLength(pivot.x, units)}, ${formatLength(pivot.y, units)}.`
                : "No point picked yet."}
          </p>
        </>
      )}
    </>
  );
}

type About = "centre" | "point";

function useMovePreview(
  draft: SketchFeature,
  ids: string[],
  move: Move,
  about: About,
  pivot: XY | null,
) {
  const document = useStore((s) => s.document);
  return useMemo(() => {
    if (!ids.length) return { result: null, error: null };
    if (about === "point" && !pivot)
      return { result: null, error: "Pick a sketch point to rotate about." };
    const at = about === "point" ? pivot : null;
    const saved = document?.features.find((f) => f.id === draft.id);
    const bound =
      document && saved?.type === "sketch"
        ? boundConstraintIds(document.parameterBindings, saved)
        : [];
    try {
      const { entities, constraints } = draft;
      const result = moveSketchSelection(entities, constraints, ids, {
        ...move,
        pivot: at,
        bound,
      });
      return { result, error: null };
    } catch (e) {
      return { result: null, error: refusal(e, draft) };
    }
  }, [draft, ids, move, about, pivot, document]);
}

function SketchMovePanel({ draft }: { draft: SketchFeature }) {
  const units = useSetting("units.length");
  const busy = useStore((s) => s.busy);
  const { ids, held, pivot, toggle } = usePickedPoint(draft);
  const [move, setMove] = useState<Move>(START);
  const [about, setAbout] = useState<About>("centre");
  const preview = useMovePreview(draft, ids, move, about, pivot);
  useSketchPreview(
    "sketchMovePreview",
    preview.result,
    move.copy ? undefined : ids,
  );
  const removed = preview.result?.removedConstraints ?? 0;
  const close = () => {
    if (held) toggle();
    useStore.getState().setSketchState({ moveCopy: false });
  };
  const apply = async () => {
    if (!preview.result || busy) return;
    const s = useStore.getState();
    const { entities, constraints } = preview.result;
    if (s.updateDraftSketch(entities, constraints)) return;
    try {
      await s.commitDraftSketch();
      close();
    } catch (e) {
      useStore.setState({ draftSketch: draft });
      s.setError((e as Error).message);
    }
  };
  return (
    <DraggablePanel title="Move/Copy">
      <div className="dialog-body">
        <p>
          {ids.length
            ? `${ids.length} item${ids.length === 1 ? "" : "s"} selected · Ctrl-click or drag a window to change the selection`
            : "Select sketch geometry. Ctrl-click adds; drag from empty space to window-select."}
        </p>
        <MoveFields move={move} setMove={setMove} units={units} />
        <PivotFields
          about={about}
          setAbout={setAbout}
          picking={!!held}
          pivot={pivot}
          onPick={toggle}
          units={units}
        />
        <CheckField
          label="Copy"
          value={move.copy}
          onChange={(copy) => setMove({ ...move, copy })}
        />
        {removed > 0 && (
          <p className="field-hint">
            {move.copy ? "The copy leaves out" : "Removes"} {removed} constraint
            {removed === 1 ? "" : "s"} linking the selection to other geometry,
            the sketch axes or a parameter.
          </p>
        )}
        {preview.error && <p className="field-hint">{preview.error}</p>}
      </div>
      <DialogFooter
        onOk={() => void apply()}
        onCancel={close}
        pending={busy}
        okDisabled={!preview.result}
      />
    </DraggablePanel>
  );
}
