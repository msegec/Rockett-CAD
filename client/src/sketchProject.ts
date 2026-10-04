import {
  newId,
  ROUTES,
  type ProjectionRef,
  type SketchFeature,
} from "@rockett/shared";
import { send } from "./api";
import { useStore, type Selection } from "./store";
import type { CadViewport } from "./three/CadViewport";

const PICKS = ["design.edge", "sketch.entity"];
const DEPTH = 16;

type Pointer = Pick<PointerEvent, "clientX" | "clientY">;

export function projectionPick(
  vp: CadViewport,
  e: Pointer,
  sketchId: string | undefined,
): Selection | undefined {
  for (let depth = 0; depth < DEPTH; depth++) {
    const picked = vp.pick(e.clientX, e.clientY, PICKS, depth)?.selection;
    if (picked?.kind !== "sketchEntity" || picked.sketchId !== sketchId)
      return picked;
  }
}

const sourceKey = (ref: ProjectionRef) =>
  ref.kind === "edge"
    ? `edge/${ref.bodyId}/${ref.edgeName}`
    : `sketch/${ref.sketchId}/${ref.entityId}`;

function pickedSource(
  vp: CadViewport,
  e: Pointer,
  draft: SketchFeature,
): ProjectionRef | undefined {
  const picked = projectionPick(vp, e, draft.id);
  if (picked?.kind === "edge")
    return { kind: "edge", bodyId: picked.bodyId, edgeName: picked.edgeName };
  if (picked?.kind === "sketchEntity")
    return {
      kind: "sketchEntity",
      sketchId: picked.sketchId,
      entityId: picked.entityId,
    };
}

export async function projectPicked(
  vp: CadViewport,
  e: Pointer,
  draft: SketchFeature,
): Promise<void> {
  const s = useStore.getState();
  const source = pickedSource(vp, e, draft);
  if (!source || !s.projectId) return;
  try {
    if (
      draft.entities.some(
        (en) =>
          en.kind !== "point" &&
          en.projection &&
          sourceKey(en.projection) === sourceKey(source),
      )
    )
      throw new Error(
        `This ${source.kind === "edge" ? "edge" : "sketch curve"} is already projected into the sketch.`,
      );
    const { entities: added } = await send(
      ROUTES.projectEdge,
      { id: s.projectId, fid: draft.id },
      { body: { edge: source, entityId: newId("proj") } },
    );
    const current = useStore.getState();
    if (
      current.draftSketch !== draft ||
      current.active?.id !== "design.sketch" ||
      current.active.state.tool !== "project"
    )
      return;
    s.updateDraftSketch([...draft.entities, ...added], draft.constraints);
    await s.commitDraftSketch();
    useStore.getState().setSketchTool("select");
  } catch (error) {
    if (useStore.getState().draftSketch?.id === draft.id)
      useStore.setState({ draftSketch: draft });
    s.setError((error as Error).message);
  }
}
