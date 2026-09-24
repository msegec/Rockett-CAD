import path from "node:path";
import { promisify } from "node:util";
import zlib from "node:zlib";
import {
  HISTORY_LIMIT,
  HISTORY_VERSION,
  historyCursor,
  historyLog,
  parse,
  type CadDocument,
  type HistoryCursor,
  type HistoryLog,
} from "@rockett/shared";
import { BlobStore } from "./blobStore.js";
import { backupNamespace, JsonStore, sha256, StoreError } from "./jsonStore.js";
import { ID_RE } from "./manifestStore.js";
import type { ProjectStore } from "./projectStore.js";
import type { Storage } from "./storage.js";

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

type Staged = Map<string, string | Uint8Array>;

export type History = HistoryLog & { position: number };

function historyFile<T extends { version: number }>(
  storage: Storage,
  name: string,
  validate: (value: T) => void,
) {
  return new JsonStore<T>({
    storage,
    root: "projects",
    name: `project history ${name}`,
    key: ID_RE,
    file: () => `history/${name}.json`,
    migrations: {
      namespace: `history ${name}`,
      current: HISTORY_VERSION,
      field: "version",
      steps: {},
    },
    validate,
  });
}

export class HistoryStore {
  private readonly logs: JsonStore<HistoryLog>;
  private readonly cursors: JsonStore<HistoryCursor>;

  constructor(
    private readonly storage: Storage,
    private readonly store: ProjectStore,
  ) {
    this.logs = historyFile(storage, "log", (v) => parse(historyLog, v));
    this.cursors = historyFile(storage, "cursor", (v) =>
      parse(historyCursor, v),
    );
  }

  save(doc: CadDocument, label: string): Promise<void> {
    return this.store.save(doc, (file, text) =>
      this.commit(doc.id, async (history) => {
        const files: Staged = new Map([[file, text]]);
        const base =
          history?.base ??
          (await this.stage(doc.id, files, await this.storage.read(file)));
        const entries = history?.entries.slice(0, history.position) ?? [];
        entries.push(this.mark(label, await this.stage(doc.id, files, text)));
        const dropped = entries.splice(0, entries.length - HISTORY_LIMIT);
        const log: HistoryLog = {
          version: HISTORY_VERSION,
          base: dropped.at(-1)?.snapshot ?? base,
          entries,
          checkpoints: history?.checkpoints ?? [],
        };
        files.set(...this.logs.encode(doc.id, log));
        files.set(
          ...this.cursors.encode(doc.id, {
            version: HISTORY_VERSION,
            position: entries.length,
          }),
        );
        return files;
      }),
    );
  }

  checkpoint(id: string, label: string): Promise<void> {
    return this.store.exclusive(id, () =>
      this.commit(id, async (history) => {
        if (!history)
          throw new StoreError(`project ${id} has no history to checkpoint`);
        const { base, entries, checkpoints, position } = history;
        const snapshot = entries[position - 1]?.snapshot ?? base;
        const log: HistoryLog = {
          version: HISTORY_VERSION,
          base,
          entries,
          checkpoints: [...checkpoints, this.mark(label, snapshot)],
        };
        return new Map([this.logs.encode(id, log)]);
      }),
    );
  }

  async read(id: string): Promise<History | undefined> {
    let stored: unknown;
    try {
      stored = await this.logs.read(id);
    } catch (err) {
      if (err instanceof StoreError && err.code === "not_found")
        return undefined;
      throw err;
    }
    try {
      const log = parse(historyLog, stored);
      const { position } = parse(historyCursor, await this.cursors.read(id));
      if (position > log.entries.length)
        throw new Error("the cursor is past the log");
      return { ...log, position };
    } catch (err) {
      throw new StoreError(
        `project ${id} history is damaged: ${(err as Error).message}`,
        "internal",
      );
    }
  }

  async snapshot(id: string, hash: string): Promise<unknown> {
    const bytes = await this.snapshots(id).get(hash);
    return JSON.parse((await gunzip(bytes)).toString("utf8"));
  }

  private commit(
    id: string,
    build: (history?: History) => Promise<Staged>,
  ): Promise<void> {
    return backupNamespace(this.storage, this.logs.dir(id)).commit(async () => {
      const history = await this.read(id);
      if (history) await this.prune(id, history);
      return build(history);
    });
  }

  private mark(label: string, snapshot: string) {
    return { label, at: new Date().toISOString(), snapshot };
  }

  private snapshots(id: string): BlobStore {
    return new BlobStore(this.storage, this.snapshotDir(id));
  }

  private snapshotDir(id: string): string {
    return path.posix.join(this.logs.dir(id), "history", "snapshots");
  }

  private async stage(
    id: string,
    files: Staged,
    text: string | Uint8Array,
  ): Promise<string> {
    const bytes = await gzip(text);
    const hash = sha256(bytes);
    const snapshots = this.snapshots(id);
    if (!(await snapshots.has(hash))) files.set(snapshots.file(hash), bytes);
    return hash;
  }

  private async prune(id: string, history: History): Promise<void> {
    const marks = [...history.entries, ...history.checkpoints];
    const kept = new Set([history.base, ...marks.map((m) => m.snapshot)]);
    const dir = this.snapshotDir(id);
    for (const name of await this.storage.list(dir))
      if (!kept.has(name))
        await this.storage.remove(path.posix.join(dir, name));
  }
}
