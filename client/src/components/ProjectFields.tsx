import { useStore } from "../store";

export function ProjectFields() {
  const bodies = useStore((s) =>
    s.active?.id === "design.sketch" ? s.active.state.projectBodies : false,
  );
  const setSketchState = useStore((s) => s.setSketchState);
  return (
    <select
      className="tb-select"
      title="Project selection: edges, faces and sketch curves, or whole bodies as their outline"
      aria-label="Project selection"
      value={bodies ? "bodies" : "entities"}
      onChange={(e) =>
        setSketchState({ projectBodies: e.target.value === "bodies" })
      }
    >
      <option value="entities">Edges and faces</option>
      <option value="bodies">Bodies</option>
    </select>
  );
}
