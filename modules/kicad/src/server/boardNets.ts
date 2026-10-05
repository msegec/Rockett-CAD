import { StoreError, type ProjectServiceHandler } from "@rockett/plugin-api";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { readBoardNets } from "../board.js";
import { sourceTree, storedData } from "./upload.js";

export const BOARD_NETS = "rockett.kicad.boardNets";

const linkId = Type.String({ minLength: 1, maxLength: 128 });
const refuse = (message: string) => new StoreError(message, "unprocessable");

export const boardNets: ProjectServiceHandler = async (doc, input, ctx) => {
  if (!Value.Check(linkId, input)) throw refuse("Invalid KiCad board link id");
  const { links } = storedData(doc);
  const link = Object.hasOwn(links, input) ? links[input] : undefined;
  if (!link) throw refuse("KiCad board link is not in this project");
  const bytes = await ctx.blobs.get(link.sourceAsset).catch((error) => {
    throw error instanceof StoreError && error.code === "not_found"
      ? refuse("KiCad board source is missing; saved data was kept")
      : error;
  });
  try {
    return { nets: readBoardNets(sourceTree(bytes)) };
  } catch (error) {
    throw refuse(
      `KiCad board source is invalid: ${error instanceof Error ? error.message : "unreadable"}`,
    );
  }
};
