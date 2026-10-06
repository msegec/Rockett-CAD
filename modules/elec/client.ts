import { defineClientModule } from "@rockett/plugin-api";
import { pinsRoute } from "./src/server/pinTable.js";

export default defineClientModule({
  activate({ register, project, ui }) {
    const board = () => {
      const picked = project.selection();
      if (picked.length !== 1) return undefined;
      const { bodyId } = picked[0]!;
      const feature = project
        .get()
        .document?.features.find(
          ({ id, type }) =>
            type === "rockett.kicad.board" && `b:${id}` === bodyId,
        );
      const linkId =
        feature && "params" in feature ? feature.params.linkId : undefined;
      return typeof linkId === "string" ? { bodyId, linkId } : undefined;
    };
    register.command({
      id: "rockett.elec.exportPins",
      label: "Export connector pin table CSV",
      enabled: () => (board() ? true : "Select a face of one KiCad board"),
      async run() {
        const picked = board();
        if (!picked) return;
        const name =
          project.get().bodies.find(({ id }) => id === picked.bodyId)?.name ??
          picked.bodyId;
        try {
          const csv = await project.read(pinsRoute, { linkId: picked.linkId });
          ui.download({
            fileName: `${name} pins.csv`,
            data: csv,
            type: "text/csv",
          });
        } catch (error) {
          ui.showError(error instanceof Error ? error.message : String(error));
        }
      },
    });
    register.menuItem({
      id: "rockett.elec.exportPins",
      menu: "design.viewport.face",
      after: "rockett.kicad.exportOutline",
      command: "rockett.elec.exportPins",
    });
  },
});
