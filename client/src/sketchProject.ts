import {
  newId,
  ROUTES,
  sourceKey,
  type ProjectionRef,
  type SketchFeature,
} from "@rockett/shared";
import { send } from "./api";
import { useStore, type Selection } from "./store";
import type { CadViewport } from "./three/CadViewport";

const PICKS = ["design.edge", "sketch.entity", "design.face"];
const BODY_PICKS = ["design.body"];
const DEPTH = 16;

type Pointer = Pick<PointerEvent, "clientX" | "clientY">;

export function projectionPick(
  vp: CadViewport,
  e: Pointer,
  sketchId: string | undefined,
): Selection | undefined {
  const { active } = useStore.getState();
  const bodies = active?.id === "design.sketch" && active.state.projectBodies;
  const picks = bodies ? BODY_PICKS : PICKS;
  for (let depth = 0; depth < DEPTH; depth++) {
    const picked = vp.pick(e.clientX, e.clientY, picks, depth)?.selection;
    if (picked?.kind !== "sketchEntity" || picked.sketchId !== sketchId)
      return picked;
  }
}

const LABELS: Record<ProjectionRef["kind"], string> = {
  edge: "edge",
  face: "face",
  body: "body",
  sketchEntity: "sketch curve",
};

function pickedSource(
  vp: CadViewport,
  e: Pointer,
  draft: SketchFeature,
): ProjectionRef | undefined {
  const picked = projectionPick(vp, e, draft.id);
  if (picked?.kind === "edge")
    return { kind: "edge", bodyId: picked.bodyId, edgeName: picked.edgeName };
  if (picked?.kind === "face")
    return { kind: "face", bodyId: picked.bodyId, faceName: picked.faceName };
  if (picked?.kind === "body") return { kind: "body", bodyId: picked.bodyId };
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
        `This ${LABELS[source.kind]} is already projected into the sketch.`,
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
