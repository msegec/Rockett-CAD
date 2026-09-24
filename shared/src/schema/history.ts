import { Type, type Static } from "typebox";

export const HISTORY_VERSION = 1;
export const HISTORY_LIMIT = 50;
export const LABEL_LIMIT = 200;
export const TX_HEADER = "X-Rockett-Tx";
export const TX_ID = /^[\w-]{1,64}$/;

const txId = Type.String({ pattern: TX_ID.source });

const snapshot = Type.String({ pattern: "^[0-9a-f]{64}$" });
const label = Type.String({ minLength: 1, maxLength: LABEL_LIMIT });
const mark = Type.Object({ label, at: Type.String(), snapshot });
const entry = Type.Object({
  label,
  at: Type.String(),
  snapshot,
  tx: Type.Optional(txId),
});

export const historyLog = Type.Object({
  version: Type.Literal(HISTORY_VERSION),
  base: snapshot,
  entries: Type.Array(entry, { maxItems: HISTORY_LIMIT }),
  position: Type.Integer({ minimum: 0 }),
  checkpoints: Type.Array(mark),
});

export type HistoryLog = Static<typeof historyLog>;
