import { useEffect, useState } from "react";
import type { Feature, SizedFeature, SizeLimit } from "@rockett/shared";
import { api } from "../../api";
import { PREVIEW_DEBOUNCE_MS } from "../../livePreview";
import { useStore } from "../../store";

const SIZE_SCOPE = {
  fillet: "on these edges",
  chamfer: "on these edges",
  shell: "for this body",
};

const mm = (size: number) => Number(size.toPrecision(2));

function sizeText(limit: SizeLimit, feature: SizedFeature): string {
  switch (limit.kind) {
    case "upTo":
      return `Works up to about ${mm(limit.size)} mm ${SIZE_SCOPE[feature.type]}`;
    case "smooth":
      return "No corner: the faces meet flat or smoothly";
    case "none":
      return `Fails at every size tried, down to ${mm(limit.below)} mm`;
    case "slow":
      return "Too slow to find the usable size";
  }
}

function sizePicks(draft: Feature | null): string | null {
  if (draft?.type === "shell")
    return draft.openFaces.length ? JSON.stringify(draft.openFaces) : null;
  if (draft?.type !== "fillet" && draft?.type !== "chamfer") return null;
  return draft.edges.length
    ? JSON.stringify([draft.edges, draft.tangentChain])
    : null;
}

function sizePosition(id: string): number {
  const { document, previewBaseline } = useStore.getState();
  const before = previewBaseline ?? document!;
  const edited = before.features.findIndex((f) => f.id === id);
  if (edited >= 0) return edited;
  return Math.min(before.timelinePosition, before.features.length);
}

export function SizeLimitHint({ draft }: { draft: Feature | null }) {
  const projectId = useStore((s) => s.projectId);
  const key = sizePicks(draft);
  const [hint, setHint] = useState<{ key: string; text: string } | null>(null);
  useEffect(() => {
    if (!key || !projectId) return;
    let current = true;
    const ask = window.setTimeout(() => {
      const feature = draft as SizedFeature;
      api.sizeLimit(projectId, feature, sizePosition(feature.id)).then(
        (limit) => current && setHint({ key, text: sizeText(limit, feature) }),
        () =>
          current && setHint({ key, text: "Could not check the usable size" }),
      );
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      current = false;
      window.clearTimeout(ask);
    };
  }, [projectId, key]);
  if (!key) return null;
  return (
    <div className="field-hint">
      {hint?.key === key ? hint.text : "Checking the usable size"}
    </div>
  );
}
