import crypto from "node:crypto";
import path from "node:path";
import type { ApiErrorCode } from "@rockett/shared";
import {
  migrate,
  NO_BLOBS,
  type MigrationContext,
  type Migrations,
} from "./migrations.js";
import { ProjectQueue } from "./projectQueue.js";
import { storagePath, type Storage } from "./storage.js";

export class StoreError extends Error {
  constructor(
    message: string,
    readonly code: ApiErrorCode = "validation",
  ) {
    super(message);
  }
}

export type Files = ReadonlyMap<string, string | Uint8Array>;
export type Write = (file: string, text: string) => Promise<void>;

const TRANSACTION = "tx";

export interface MigrationEffects<C extends MigrationContext> {
  context(key: string, stored: unknown): Promise<C>;
  created(key: string, context: C): Promise<Files>;
  retire(key: string, context: C): Promise<void>;
}

export interface JsonStoreOptions<T, C extends MigrationContext> {
  storage: Storage;
  root: string;
  name: string;
  key: RegExp;
  file: (item: string) => string;
  legacy?: string;
  migrations: Migrations<T>;
  unbacked?: (key: string) => Promise<boolean>;
  validate?: (value: T) => void;
  effects?: MigrationEffects<C>;
}

export interface Inventory {
  recovered: string[];
  outdated: string[];
  failed: Array<{ key: string; error: string }>;
}

export function sha256(data: string | Uint8Array): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export class NamespaceBackup {
  private readonly dir: string;
  private readonly root: string;
  private readonly record: string;

  constructor(
    private readonly storage: Storage,
    namespace: string,
  ) {
    this.dir = storagePath(namespace);
    this.root = path.posix.join("backups", this.dir);
    this.record = path.posix.join(this.root, "migrating.json");
  }

  async backup(version: string, names?: string[]): Promise<string> {
    const name = await this.write(version, names);
    await this.verify(name);
    return name;
  }

  names(): Promise<string[]> {
    return this.storage.list(this.root);
  }

  async migrate(
    version: string,
    created: Files,
    apply: () => Promise<void>,
    names?: string[],
  ): Promise<void> {
    const backup = await this.backup(version, names);
    await this.storage.writeAtomic(
      this.record,
      JSON.stringify({
        backup,
        created: [...created].map(([file, data]) => [file, sha256(data)]),
      }),
    );
    await writeAll(this.storage, created);
    await apply();
    await this.storage.remove(this.record);
  }

  async commit(build: () => Promise<Files>): Promise<void> {
    await this.settle();
    const files = await build();
    const created = new Map<string, string | Uint8Array>();
    const replaced = new Map<string, string | Uint8Array>();
    for (const [file, data] of files) {
      const live = await this.storage.list(path.posix.dirname(file));
      (live.includes(path.posix.basename(file)) ? replaced : created).set(
        file,
        data,
      );
    }
    try {
      await this.migrate(
        TRANSACTION,
        created,
        () => writeAll(this.storage, replaced),
        [...replaced.keys()].map((file) => path.posix.relative(this.dir, file)),
      );
    } finally {
      await this.settle();
    }
  }

  private async settle(): Promise<void> {
    await this.recover();
    const names = await this.storage.list(this.root);
    const journal = names.filter((n) => n.startsWith(`${TRANSACTION}-`));
    for (const name of journal)
      await this.storage.remove(path.posix.join(this.root, name));
    if (names.length && journal.length === names.length)
      await this.storage.remove(this.root);
  }

  async recover(): Promise<boolean> {
    const raw = await this.storage.read(this.record).catch(() => undefined);
    if (!raw) return false;
    const { backup, created = [] } = JSON.parse(raw.toString("utf8")) as {
      backup: string;
      created?: Array<[string, string]>;
    };
    for (const [file, sum] of created) {
      const data = await this.storage.read(file).catch(() => undefined);
      if (data && sha256(data) === sum) await this.storage.remove(file);
    }
    await this.restore(backup);
    await this.storage.remove(this.record);
    return true;
  }

  async restore(backup: string): Promise<void> {
    for (const [name, sum] of await this.verify(backup))
      await this.storage.writeAtomic(
        path.posix.join(this.dir, name),
        await this.verified(backup, name, sum),
      );
  }

  private async verify(backup: string): Promise<Array<[string, string]>> {
    if (!/^[\w.]+-[0-9a-f]{16}$/.test(backup))
      throw new StoreError(`invalid backup name ${backup}`);
    const text = await this.storage.read(
      path.posix.join(this.root, backup, "SHA256SUMS"),
    );
    const entries = text
      .toString("utf8")
      .split("\n")
      .filter(Boolean)
      .map((line): [string, string] => [line.slice(66), line.slice(0, 64)]);
    for (const [name, sum] of entries) await this.verified(backup, name, sum);
    return entries;
  }

  private async verified(
    backup: string,
    name: string,
    sum: string,
  ): Promise<Buffer> {
    const data = await this.storage.read(
      path.posix.join(this.root, backup, "files", name),
    );
    if (sha256(data) !== sum)
      throw new StoreError(
        `${this.dir} backup ${backup} is damaged`,
        "internal",
      );
    return data;
  }

  private async write(version: string, only?: string[]): Promise<string> {
    const { storage, dir } = this;
    const names = only ?? (await storage.files(dir));
    names.sort();
    const sums = new Map<string, string>();
    for (const name of names)
      sums.set(name, sha256(await storage.read(path.posix.join(dir, name))));
    const manifest = names
      .map((name) => `${sums.get(name)}  ${name}\n`)
      .join("");
    const backup = `${version}-${sha256(manifest).slice(0, 16)}`;
    const target = path.posix.join(this.root, backup);
    const existing = await storage
      .read(path.posix.join(target, "SHA256SUMS"))
      .catch(() => undefined);
    if (existing?.toString("utf8") === manifest) return backup;
    if (existing)
      throw new StoreError(`${dir} backup ${backup} differs`, "internal");
    for (const name of names) {
      const data = await storage.read(path.posix.join(dir, name));
      if (sha256(data) !== sums.get(name))
        throw new StoreError(`${dir} changed during backup`, "internal");
      await storage.writeAtomic(path.posix.join(target, "files", name), data);
    }
    await storage.writeAtomic(path.posix.join(target, "SHA256SUMS"), manifest);
    return backup;
  }
}

async function writeAll(storage: Storage, files: Files): Promise<void> {
  for (const [file, data] of files) await storage.writeAtomic(file, data);
}

export function backupNamespace(
  storage: Storage,
  namespace: string,
): NamespaceBackup {
  return new NamespaceBackup(storage, namespace);
}

export class JsonStore<T, C extends MigrationContext = MigrationContext> {
  private writes = new ProjectQueue();

  constructor(readonly options: JsonStoreOptions<T, C>) {}

  dir(key: string): string {
    if (!this.options.key.test(key))
      throw new StoreError(`invalid ${this.options.name} id`);
    return path.posix.join(this.options.root, key);
  }

  private file(key: string, item = key): string {
    if (!this.options.key.test(item))
      throw new StoreError(`invalid ${this.options.name} id`);
    return path.posix.join(this.dir(key), this.options.file(item));
  }

  encode(key: string, value: T): [string, string] {
    this.options.validate?.(value);
    return [this.file(key), JSON.stringify(value, null, 1)];
  }

  async stored(key: string, item = key): Promise<unknown> {
    return (await this.found(key, item)).value;
  }

  private async found(
    key: string,
    item = key,
  ): Promise<{ file: string; value: unknown }> {
    const { storage, legacy, name } = this.options;
    const files = [this.file(key, item)];
    if (legacy && item === key)
      files.push(path.posix.join(this.dir(key), legacy));
    for (const file of files) {
      const raw = await storage.read(file).catch(() => undefined);
      if (!raw) continue;
      try {
        return { file, value: JSON.parse(raw.toString("utf8")) };
      } catch {
        throw new StoreError(`${name} ${key} is corrupted`, "internal");
      }
    }
    throw new StoreError(`${name} ${key} not found`, "not_found");
  }

  private context(key: string, stored: unknown): Promise<C> | C {
    return this.options.effects?.context(key, stored) ?? (NO_BLOBS as C);
  }

  async migrated(key: string, item = key): Promise<{ value: T; context: C }> {
    const stored = await this.stored(key, item);
    const context = await this.context(key, stored);
    return {
      value: migrate(this.options.migrations, stored, context),
      context,
    };
  }

  async read(key: string, item = key): Promise<T> {
    return (await this.migrated(key, item)).value;
  }

  exclusive<R>(key: string, operation: () => Promise<R>): Promise<R> {
    return this.writes.run(key, operation);
  }

  write(key: string, value: T): Promise<void> {
    return this.update(key, () => value);
  }

  update(
    key: string,
    change: (previous: T | undefined) => T,
    write: Write = (file, text) => this.options.storage.writeAtomic(file, text),
  ): Promise<void> {
    return this.writes.run(key, async () => {
      const [file, text] = this.encode(key, change(await this.previous(key)));
      await this.upgrade(key);
      await write(file, text);
    });
  }

  settle(key: string): Promise<void> {
    return this.writes.run(key, () => this.upgrade(key));
  }

  private async previous(key: string): Promise<T | undefined> {
    try {
      return await this.read(key);
    } catch (err) {
      if (err instanceof StoreError && err.code === "not_found")
        return undefined;
      throw err;
    }
  }

  private async upgrade(key: string): Promise<void> {
    const backed = !(await this.options.unbacked?.(key));
    if (backed) await this.recover(key);
    let found: { file: string; value: unknown };
    try {
      found = await this.found(key);
    } catch (err) {
      if (err instanceof StoreError && err.code === "not_found") return;
      throw err;
    }
    const { storage } = this.options;
    const { file, value } = found;
    const moved = file !== this.file(key);
    const context = await this.context(key, value);
    const next = migrate(this.options.migrations, value, context);
    if (next === value && !moved) return;
    const staged = JSON.stringify(next, null, 1);
    if (backed) this.options.validate?.(JSON.parse(staged));
    const created = new Map<string, string | Uint8Array>(
      (await this.options.effects?.created(key, context)) ?? [],
    );
    if (moved) created.set(this.file(key), staged);
    const place = () =>
      moved ? storage.remove(file) : storage.writeAtomic(file, staged);
    if (!backed) {
      await writeAll(storage, created);
      return place();
    }
    const from = (value as Record<string, unknown>)[
      this.options.migrations.field
    ];
    await backupNamespace(storage, this.dir(key)).migrate(
      `v${String(from)}`,
      created,
      async () => {
        await place();
        await this.options.effects?.retire(key, context);
      },
    );
  }

  private async recover(key: string): Promise<boolean> {
    return backupNamespace(this.options.storage, this.dir(key)).recover();
  }

  async inventory(): Promise<Inventory> {
    const out: Inventory = { recovered: [], outdated: [], failed: [] };
    for (const key of await this.keys()) {
      try {
        if (await this.writes.run(key, () => this.recover(key)))
          out.recovered.push(key);
        const { file, value } = await this.found(key);
        const context = await this.context(key, value);
        if (
          file !== this.file(key) ||
          migrate(this.options.migrations, value, context) !== value
        )
          out.outdated.push(key);
      } catch (err) {
        out.failed.push({ key, error: (err as Error).message });
      }
    }
    return out;
  }

  async remove(key: string): Promise<void> {
    await this.options.storage.remove(this.dir(key));
  }

  async keys(): Promise<string[]> {
    const names = await this.options.storage.list(this.options.root);
    return names.filter((name) => this.options.key.test(name));
  }
}
