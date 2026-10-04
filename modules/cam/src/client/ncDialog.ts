import {
  createElement as h,
  Fragment,
  useState,
  useSyncExternalStore,
} from "react";
import { Type } from "typebox";
import type { ClientContext } from "@rockett/plugin-api";
import { POSTS } from "../server/posts.js";
import { ncRoute, type Blocker, type NcExport } from "../shared/document.js";
import { machineSchema, type MachineProfile } from "../shared/machine.js";
import { generateOperation } from "./browser.js";
import { banner, button, reason, row, tree } from "./libraryParts.js";
import {
  chosen,
  picker,
  SETUP_TEXTS,
  setupList,
  useLibrary,
} from "./opDialog.js";
import { schemaFields } from "./schemaForm.js";

export const NC_PANEL = "rockett.cam.nc.dialog";

const MACHINE_TEXTS = {
  loading: "Loading machines...",
  empty: "No machines yet. Add one in Library.",
  failed: "Machines did not load",
};

const POST_CHOICES = [...POSTS.values()].map(
  ({ id, label }): [string, string] => [id, label],
);

const postOptions = Type.Pick(machineSchema, ["toolChange"]);

type Ui = ClientContext["ui"];
type ToolChange = MachineProfile["toolChange"];
type Choice = { postId?: string; toolChange?: ToolChange; off: string[] };
type Run = { pending: boolean; error: string; blocked: Blocker[] };
type Blocked = Extract<Blocker, { kind: "operation" }>;
type File = Extract<NcExport, { fileName: string }>;
type Setups = ReturnType<typeof setupList>;

function save(ui: Ui, out: File) {
  if ("nc" in out)
    return ui.download({
      fileName: out.fileName,
      data: out.nc,
      type: "text/plain",
    });
  const bytes = Uint8Array.from(atob(out.zip), (c) => c.charCodeAt(0));
  ui.download({ fileName: out.fileName, data: bytes, type: "application/zip" });
}

const blockerText = (blocker: Blocker) =>
  blocker.kind === "check"
    ? blocker.reason
    : `${blocker.name}: ${blocker.reason ?? blocker.status}`;

function blockedList(
  blocked: Blocker[],
  pending: boolean,
  generate: (blocker: Blocked) => void,
) {
  if (!blocked.length) return null;
  return tree(
    { title: "Export blocked" },
    ...blocked.map((blocker, i) =>
      row(
        { key: `${i}`, name: blockerText(blocker) },
        blocker.kind === "operation" &&
          button("Generate first", `Generate ${blocker.name}`, pending, () =>
            generate(blocker),
          ),
      ),
    ),
  );
}

function setupChecks(
  ui: Ui,
  setups: Setups,
  off: string[],
  turn: (id: string, on: boolean) => void,
) {
  if (setups.status === "failed")
    return banner(`${SETUP_TEXTS.failed}: ${setups.reason}.`);
  if (setups.status === "loading") return null;
  if (!setups.items.length)
    return h("span", { className: "field-hint" }, SETUP_TEXTS.empty);
  return setups.items.map(({ id, name }) =>
    h(ui.CheckField, {
      key: id,
      label: name ?? id,
      value: !off.includes(id),
      onChange: (on: boolean) => turn(id, on),
    }),
  );
}

function postFields(
  ui: Ui,
  postId: string,
  toolChange: ToolChange,
  setChoice: (change: (now: Choice) => Choice) => void,
) {
  return h(
    Fragment,
    null,
    h(ui.SelectField<string>, {
      label: "Post",
      value: postId,
      options: POST_CHOICES,
      onChange: (id: string) => setChoice((now) => ({ ...now, postId: id })),
    }),
    POSTS.get(postId)?.capabilities.toolChange &&
      schemaFields(ui, postOptions, { toolChange }, (next) =>
        setChoice((now) => ({ ...now, toolChange: next.toolChange })),
      ),
  );
}

function useRun() {
  const [run, setRun] = useState<Run>({
    pending: false,
    error: "",
    blocked: [],
  });
  const act = async (
    work: () => Promise<Blocker[] | undefined>,
    failed: string,
  ) => {
    setRun((now) => ({ ...now, pending: true, error: "" }));
    try {
      const blocked = await work();
      setRun((now) => ({
        pending: false,
        error: "",
        blocked: blocked ?? now.blocked,
      }));
    } catch (e) {
      setRun((now) => ({
        ...now,
        pending: false,
        error: `${failed}: ${reason(e)}.`,
      }));
    }
  };
  return { run, act };
}

export function ncDialog({ ui, project, request }: ClientContext) {
  const close = () => ui.closePanel(NC_PANEL);
  return function NcDialog() {
    const open = useSyncExternalStore(project.subscribe, project.get);
    const machines = useLibrary<MachineProfile>(request, "machines");
    const [machineId, setMachineId] = useState("");
    const [choice, setChoice] = useState<Choice>({ off: [] });
    const { run, act } = useRun();
    const setups = setupList(open);
    const machine = chosen(machines, machineId);
    const postId = choice.postId ?? machine?.post ?? "";
    const post = POSTS.get(postId);
    const toolChange = post?.capabilities.toolChange
      ? (choice.toolChange ?? machine?.toolChange ?? "perFile")
      : "perFile";
    const picked =
      setups.status === "ready"
        ? setups.items.filter(({ id }) => !choice.off.includes(id))
        : [];
    const exportNc = () =>
      act(async () => {
        if (!machine) return undefined;
        const out = await project.read(ncRoute, {
          machineId: machine.id,
          postId,
          toolChange,
          setupIds: picked.map(({ id }) => id).join(","),
        });
        if ("reason" in out) throw new Error(out.reason);
        if ("blocked" in out) return out.blocked;
        save(ui, out);
        close();
        return [];
      }, "NC program did not export");
    const generate = (blocker: Blocked) =>
      act(async () => {
        await generateOperation(project, blocker.setupId, blocker.operationId);
        return run.blocked.filter((each) => each !== blocker);
      }, `${blocker.name} did not generate`);
    const turn = (id: string, on: boolean) =>
      setChoice((now) => ({
        ...now,
        off: on ? now.off.filter((each) => each !== id) : [...now.off, id],
      }));
    const body = h(
      "div",
      { className: "dialog-body" },
      banner(run.error || null),
      setupChecks(ui, setups, choice.off, turn),
      picker(ui, "Machine", machines, machine, setMachineId, MACHINE_TEXTS),
      machine && postFields(ui, postId, toolChange, setChoice),
      blockedList(
        run.blocked,
        run.pending,
        (blocker) => void generate(blocker),
      ),
    );
    const footer = h(ui.DialogFooter, {
      onOk: () => void exportNc(),
      onCancel: close,
      pending: run.pending,
      okLabel: "Export",
      okDisabled: !(machine && post && picked.length) || run.pending,
    });
    return h(ui.DraggablePanel, {
      title: "NC Program",
      children: h(Fragment, null, body, footer),
    });
  };
}
