import type {
  BodyPayload,
  CadDocument,
  EdgeRef,
  EvaluateResult,
  FaceRef,
  Feature,
  UnresolvedRef,
} from "@rockett/shared";
import { previewBodies, useStore, type Selection } from "../store";
import { dialogTargets } from "../toolTargets";
import { pickLabel, useHoverPick } from "./form/fields";

type Ref = FaceRef | EdgeRef;

function proposed({
  ref,
  status,
  candidates,
}: UnresolvedRef): Selection | null {
  const to = candidates[0];
  if (status !== "candidate" || !to) return null;
  return ref.kind === "face"
    ? { kind: "face", bodyId: to.bodyId, faceName: to.name }
    : { kind: "edge", bodyId: to.bodyId, edgeName: to.name };
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

export function RefRepair() {
  const mode = useStore((s) => s.mode);
  const document = useStore((s) => s.document);
  const evaluation = useStore((s) => s.evaluation);
  const busy = useStore((s) => s.busy);
  const hover = useHoverPick();
  const fid = mode.name === "dialog" ? mode.editFeatureId : undefined;
  const problems = evaluation?.featureStatuses.find(
    (st) => st.featureId === fid,
  )?.refs;
  if (!fid || !problems?.length) return null;
  const bodies = previewBodies({ mode, evaluation });
  const label = (pick: Selection) =>
    pickLabel(pick, document, evaluation, bodies);
  return (
    <>
      <div className="sel-info">
        <span>References</span>
        <b>{problems.length} to repair</b>
      </div>
      <div role="list" aria-label="References">
        {problems.map((problem) => {
          const to = proposed(problem);
          return (
            <div
              key={JSON.stringify(problem.ref)}
              role="listitem"
              className="measure-row"
              onMouseEnter={() => hover(to)}
              onMouseLeave={() => hover(null)}
            >
              <span>{note(problem, label)}</span>
              {to && (
                <button
                  className="btn"
                  disabled={busy}
                  aria-label={`Accept ${label(to)}`}
                  onClick={() => void accept(fid, problem.ref, to)}
                >
                  Accept
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
