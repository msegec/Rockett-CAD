import {
  Worker,
  type Transferable,
  type WorkerOptions,
} from "node:worker_threads";
import type { CadDocument, Health, NamingDecision } from "@rockett/shared";
import type { ProjectStore } from "../store/projectStore.js";
import type { Sources } from "../geometry/importers.js";
import type { EvaluateHooks } from "../geometry/engine.js";
import type {
  ExportJob,
  ImportUpload,
  KernelClient,
  StateAnswers,
  StateQuery,
} from "./client.js";
import {
  fromWire,
  owned,
  toWire,
  type Calls,
  type FromWorker,
  type Method,
  type Payload,
  type Report,
  type ToWorker,
} from "./protocol.js";

interface Pending {
  resolve: (value: Calls[Method]["result"]) => void;
  reject: (error: Error) => void;
  payload: (held: string[]) => Promise<Payload>;
  report?: ((message: Report) => void) | undefined;
}

const noPayload = () =>
  Promise.reject(new Error("this kernel call carries no payload"));

export class WorkerKernel implements KernelClient {
  private readonly worker: Worker;
  private readonly pending = new Map<number, Pending>();
  private lastId = 0;
  private kernelVersion: Health["kernelVersion"] = null;
  private failure: Error | undefined;

  constructor(
    private readonly store: Pick<ProjectStore, "sources">,
    entry: URL,
    options?: WorkerOptions,
  ) {
    this.worker = new Worker(entry, options);
    this.worker.on("message", (message: FromWorker) => this.receive(message));
    this.worker.on("error", (error) => this.fail(error));
    this.worker.on("exit", (code) =>
      this.fail(new Error(`The kernel worker exited with code ${code}`)),
    );
  }

  private post(message: ToWorker, transfer: Transferable[] = []) {
    this.worker.postMessage(message, transfer);
  }

  private receive(message: FromWorker) {
    switch (message.type) {
      case "ready":
        this.kernelVersion = message.version;
        return;
      case "ask":
        void this.answer(message.id, message.held);
        return;
      case "featureStart":
      case "progress":
        this.pending.get(message.id)?.report?.(message);
        return;
      case "reply": {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        const { settled } = message;
        if (settled.ok) pending?.resolve(settled.value);
        else pending?.reject(fromWire(settled.error));
        return;
      }
    }
  }

  private async answer(id: number, held: string[]) {
    const pending = this.pending.get(id);
    if (!pending) return;
    try {
      const value = await pending.payload(held);
      this.post(
        { type: "payload", id, settled: { ok: true, value } },
        value instanceof ArrayBuffer ? [value] : [],
      );
    } catch (error) {
      this.post({
        type: "payload",
        id,
        settled: { ok: false, error: toWire(error) },
      });
    }
  }

  private fail(error: Error) {
    this.failure ??= error;
    for (const { reject } of this.pending.values()) reject(this.failure);
    this.pending.clear();
  }

  private call<M extends Method>(
    method: M,
    args: Calls[M]["args"],
    payload: Pending["payload"] = noPayload,
    report?: Pending["report"],
  ): Promise<Calls[M]["result"]> {
    return new Promise((resolve, reject) => {
      if (this.failure) return reject(this.failure);
      const id = ++this.lastId;
      this.post({ type: "call", id, method, args } as ToWorker);
      this.pending.set(id, {
        resolve: resolve as Pending["resolve"],
        reject,
        payload,
        report,
      });
    });
  }

  private sources(doc: CadDocument) {
    return async (held: string[]) => {
      const reused = new Uint8Array();
      const found = await this.store.sources(
        doc,
        new Map(held.map((hash) => [hash, reused])),
      );
      return new Map(
        [...found].map(([hash, bytes]) => [
          hash,
          bytes === reused ? null : bytes,
        ]),
      );
    };
  }

  evaluate(
    doc: CadDocument,
    position?: number,
    extra?: Sources,
    hooks: EvaluateHooks = {},
  ) {
    const stop = new Int32Array(new SharedArrayBuffer(4));
    const check = () => {
      if (hooks.shouldStop?.()) Atomics.store(stop, 0, 1);
    };
    check();
    return this.call(
      "evaluate",
      [doc, position, extra, stop],
      this.sources(doc),
      (message) => {
        if (message.type === "featureStart")
          hooks.onFeatureStart?.(...message.args);
        else hooks.onProgress?.(...message.args);
        check();
      },
    );
  }

  async stateQuery<K extends keyof StateAnswers>(
    doc: CadDocument,
    query: StateQuery<K>,
  ) {
    return (await this.call(
      "stateQuery",
      [doc, query as StateQuery],
      this.sources(doc),
    )) as StateAnswers[K];
  }

  async export(doc: CadDocument, job: ExportJob) {
    const { data, mime } = await this.call(
      "export",
      [doc, job],
      this.sources(doc),
    );
    return { data: Buffer.from(data), mime };
  }

  importStep(upload: ImportUpload | undefined) {
    return this.call(
      "importStep",
      [upload?.name],
      upload && (async () => owned(await upload.bytes())),
    );
  }

  planNamingUpgrade(doc: CadDocument, accept?: NamingDecision[]) {
    return this.call("planNamingUpgrade", [doc, accept], this.sources(doc));
  }

  drop(docId: string) {
    if (!this.failure) this.post({ type: "drop", docId });
  }

  version() {
    return this.kernelVersion;
  }

  async close() {
    await this.worker.terminate();
  }
}
