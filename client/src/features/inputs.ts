import type { ProfileRef } from "@rockett/shared";
import { useStore, type Selection } from "../store";
import { HANDLE_VALUES, type HandleDialog } from "../three/featureHandles";
import { toolTargets } from "../toolTargets";
import type { DialogParams } from "./registry";

export const num = (params: DialogParams, key: string, dflt: number) => {
  const v = Number(params[key]);
  return Number.isFinite(v) ? v : dflt;
};

export const handleValue = (params: DialogParams, d: HandleDialog) =>
  num(params, HANDLE_VALUES[d].param, HANDLE_VALUES[d].fallback);

export const profileRefs = (selection: Selection[]): ProfileRef[] =>
  selection.flatMap((x) =>
    x.kind === "profile"
      ? [{ sketchId: x.sketchId, profileId: x.profileId }]
      : [],
  );

export const profilePicks = (refs: ProfileRef[]): Selection[] =>
  refs.map((r) => ({
    kind: "profile",
    sketchId: r.sketchId,
    profileId: r.profileId,
  }));

export const bodyTargets = (operation: string, params: DialogParams) =>
  toolTargets(
    operation,
    params.targets,
    useStore.getState().document?.namingVersion,
  );
