import { Type, type Static } from "typebox";

export const HISTORY_VERSION = 1;
export const HISTORY_LIMIT = 50;

const snapshot = Type.String({ pattern: "^[0-9a-f]{64}$" });
const label = Type.String({ minLength: 1, maxLength: 200 });
const mark = Type.Object({ label, at: Type.String(), snapshot });

export const historyLog = Type.Object({
  version: Type.Literal(HISTORY_VERSION),
  base: snapshot,
  entries: Type.Array(mark, { maxItems: HISTORY_LIMIT }),
  checkpoints: Type.Array(mark),
});

export const historyCursor = Type.Object({
  version: Type.Literal(HISTORY_VERSION),
  position: Type.Integer({ minimum: 0 }),
});

export type HistoryLog = Static<typeof historyLog>;
export type HistoryCursor = Static<typeof historyCursor>;
