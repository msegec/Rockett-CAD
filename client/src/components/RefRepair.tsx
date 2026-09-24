import { Fragment, type ReactNode } from "react";
import type {
  BodyPayload,
  CadDocument,
  EdgeRef,
  EvaluateResult,
  FaceRef,
  Feature,
  RefCandidate,
  UnresolvedRef,
} from "@rockett/shared";
import {
  previewBodies,
  selectionKey,
  useStore,
  type Selection,
} from "../store";
import { dialogTargets } from "../toolTargets";
import { pickLabel, useHoverPick } from "./form/fields";

type Ref = FaceRef | EdgeRef;

const pickOf = (
  kind: Ref["kind"],
  { bodyId, name }: Pick<RefCandidate, "bodyId" | "name">,
): Selection =>
  kind === "face"
    ? { kind, bodyId, faceName: name }
    : { kind, bodyId, edgeName: name };

function proposed({
  ref,
  status,
  candidates,
}: UnresolvedRef): Selection | null {
  const to = candidates[0];
  return status === "candidate" && to ? pickOf(ref.kind, to) : null;
}

function choices({ ref, status, candidates, suggestions }: UnresolvedRef) {
  if (status === "candidate") return [];
  return [
    ...candidates.map((c) => ({
      pick: pickOf(ref.kind, c),
      from: `found by ${c.basis}`,
    })),
    ...suggestions.map((c) => ({
      pick: pickOf(ref.kind, c),
      from: "on another body",
    })),
  ];
}

function note(
  problem: UnresolvedRef,
  label: (pick: Selection) => string,
): string {
  const head = `${label(problem.ref)}: ${problem.status}`;
  const to = proposed(problem);
  if (to)
    return `${head} ${label(to)}, found by ${problem.candidates[0]!.basis}`;
  if (problem.status === "ambiguous")
    return `${head}, ${problem.candidates.length} candidates`;
  return head;
}

export function refNotes(
  problems: UnresolvedRef[],
  document: CadDocument | null,
  evaluation: EvaluateResult | null,
  bodies: BodyPayload[],
): string[] {
  return problems.map((p) =>
    note(p, (pick) => pickLabel(pick, document, evaluation, bodies)),
  );
}

const sameRef = (item: Record<string, unknown>, ref: Ref) =>
  item.kind === ref.kind &&
  item.bodyId === ref.bodyId &&
  (ref.kind === "face"
    ? item.faceName === ref.faceName
    : item.edgeName === ref.edgeName);

function swapRef(value: unknown, ref: Ref, to: Selection): unknown {
  if (Array.isArray(value)) return value.map((v) => swapRef(v, ref, to));
  if (typeof value !== "object" || value === null) return value;
  const item = value as Record<string, unknown>;
  if (sameRef(item, ref)) return to;
  return Object.fromEntries(
    Object.entries(item).map(([k, v]) => [k, swapRef(v, ref, to)]),
  );
}

async function accept(fid: string, ref: Ref, to: Selection): Promise<void> {
  const s = useStore.getState();
  const feature = s.document?.features.find((f) => f.id === fid);
  if (!feature) return;
  const patch = Object.fromEntries(
    Object.entries(feature).flatMap(([key, value]) => {
      const next = swapRef(value, ref, to);
      return JSON.stringify(next) === JSON.stringify(value)
        ? []
        : [[key, next]];
    }),
  );
  try {
    await s.updateFeature(fid, {
      ...patch,
      ...dialogTargets(),
    } as Partial<Feature>);
  } catch {
    return;
  }
  s.setMode({ name: "idle" });
}

export function repick(pick: Selection | null): boolean {
  const s = useStore.getState();
  const ref: Ref | undefined = s.dialogParams.repick;
  const fid = s.mode.name === "dialog" ? s.mode.editFeatureId : undefined;
  if (!ref || !fid) return false;
  if (pick?.kind !== ref.kind) return true;
  s.setDialogParams({ repick: undefined });
  const name = pick.kind === "face" ? pick.faceName : pick.edgeName;
  void accept(fid, ref, pickOf(ref.kind, { bodyId: pick.bodyId, name }));
  return true;
}

function PickButton({ refFor }: { refFor: Ref }) {
  const busy = useStore((s) => s.busy);
  const picking: Ref | undefined = useStore((s) => s.dialogParams.repick);
  const setParams = useStore((s) => s.setDialogParams);
  const on = JSON.stringify(picking) === JSON.stringify(refFor);
  return (
    <button
      className="btn"
      disabled={busy}
      aria-pressed={on}
      onClick={() => setParams({ repick: on ? undefined : refFor })}
    >
      {on ? "Stop" : "Pick"}
    </button>
  );
}

function RepairRow({
  text,
  pick,
  hover,
  children,
}: {
  text: string;
  pick: Selection | null;
  hover: (pick: Selection | null) => void;
  children: ReactNode;
}) {
  return (
    <div
      role="listitem"
      className="measure-row"
      onMouseEnter={() => hover(pick)}
      onMouseLeave={() => hover(null)}
    >
      <span>{text}</span>
      {children}
    </div>
  );
}

export function RefRepair() {
  const mode = useStore((s) => s.mode);
  const document = useStore((s) => s.document);
  const evaluation = useStore((s) => s.evaluation);
  const busy = useStore((s) => s.busy);
  const picking: Ref | undefined = useStore((s) => s.dialogParams.repick);
  const hover = useHoverPick();
  const fid = mode.name === "dialog" ? mode.editFeatureId : undefined;
  const problems = evaluation?.featureStatuses.find(
    (st) => st.featureId === fid,
  )?.refs;
  if (!fid || !problems?.length) return null;
  const bodies = previewBodies({ mode, evaluation });
  const label = (pick: Selection) =>
    pickLabel(pick, document, evaluation, bodies);
  const acceptButton = (ref: Ref, to: Selection) => (
    <button
      className="btn"
      disabled={busy}
      aria-label={`Accept ${label(to)}`}
      onClick={() => void accept(fid, ref, to)}
    >
      Accept
    </button>
  );
  return (
    <>
      <div className="sel-info">
        <span>References</span>
        <b>
          {picking
            ? `Pick ${picking.kind === "face" ? "a face" : "an edge"} in the viewport`
            : `${problems.length} to repair`}
        </b>
      </div>
      <div role="list" aria-label="References">
        {problems.map((problem) => {
          const to = proposed(problem);
          const key = JSON.stringify(problem.ref);
          return (
            <Fragment key={key}>
              <RepairRow text={note(problem, label)} pick={to} hover={hover}>
                {to ? (
                  acceptButton(problem.ref, to)
                ) : (
                  <PickButton refFor={problem.ref} />
                )}
              </RepairRow>
              {choices(problem).map(({ pick, from }) => (
                <RepairRow
                  key={selectionKey(pick)}
                  text={`${label(pick)}, ${from}`}
                  pick={pick}
                  hover={hover}
                >
                  {acceptButton(problem.ref, pick)}
                </RepairRow>
              ))}
            </Fragment>
          );
        })}
      </div>
    </>
  );
}
