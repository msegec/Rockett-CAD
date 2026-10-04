import type { ComponentType, ReactNode } from "react";
import type { Group, Object3D } from "three";
import type {
  BodyPayload,
  CadDocument,
  Health,
  PathParams,
  Route,
  User,
} from "@rockett/shared";

export type {
  CadDocument,
  Feature,
  FeatureRef,
  FeatureSpec,
  MeasureRequest,
  MeasureResult,
  ModuleManifest,
  PathParams,
  Registry,
  Route,
  User,
} from "@rockett/shared";

export const PLUGIN_API_VERSION = "0.2.0";

export type Dispose = () => void;

export type RouteBody<R extends Route> = R extends { readonly body: object }
  ? R extends Route<string, infer Req>
    ? Req
    : unknown
  : unknown;

export interface RouteRequest<R extends Route> {
  params: PathParams<R["path"]>;
  body: RouteBody<R>;
}

export type ProjectMutation = (
  { label: string; cursor?: never } | { cursor: number; label?: never }
) & {
  document?: CadDocument;
  position?: number | undefined;
  [extra: string]: unknown;
};

export interface RouteContext {
  user: User;
}

export interface RouteModuleApi {
  projectRoute<R extends Route>(
    route: R,
    read: (
      doc: CadDocument,
      req: RouteRequest<R>,
      ctx: RouteContext,
    ) => Promise<unknown>,
  ): void;
  projectMutation<R extends Route>(
    route: R,
    edit: (
      doc: CadDocument,
      req: RouteRequest<R>,
      ctx: RouteContext,
    ) => Promise<ProjectMutation>,
  ): void;
  userRoute<R extends Route>(
    route: R,
    handle: (req: RouteRequest<R>, ctx: RouteContext) => Promise<unknown>,
  ): void;
}

export interface RouteModule<Api extends RouteModuleApi = RouteModuleApi> {
  id: string;
  mount(api: Api): void;
}

export interface KernelJobScope {
  readonly oc: any;
  own<H extends { delete(): void }>(handle: H): H;
  progress(done: number, total: number, label: string): void;
}

export type KernelJobResult =
  | void
  | null
  | boolean
  | number
  | bigint
  | string
  | (object & { then?: never });

export type KernelJob = (
  input: never,
  scope: KernelJobScope,
) => KernelJobResult;

export const defineKernelJobs = (jobs: Readonly<Record<string, KernelJob>>) =>
  jobs;

export interface KernelJobRun {
  onProgress?(done: number, total: number, label: string): void;
  signal?: AbortSignal;
}

export type StartKernelJob = (
  id: string,
  input: unknown,
  run?: KernelJobRun,
) => Promise<unknown>;

export interface ServerRegister {
  routeModule(module: RouteModule): Dispose;
  kernelJob(id: string, entry: URL): Dispose;
}

export interface UserDataEntry {
  version: number;
  data: unknown;
  etag: string;
  readOnly: boolean;
}

export interface UserData {
  read(user: User): Promise<UserDataEntry | null>;
  write(user: User, data: unknown, etag: string | null): Promise<UserDataEntry>;
}

export interface ModuleFiles {
  read(name: string): Promise<Uint8Array | null>;
  write(name: string, data: string | Uint8Array): Promise<void>;
  remove(name: string): Promise<void>;
  list(): Promise<string[]>;
}

export interface ServerBody extends ProjectBody {
  readonly brep: string;
  readonly fingerprint: string;
}

export interface ServerContext {
  readonly register: ServerRegister;
  readonly startKernelJob: StartKernelJob;
  userData(name: string, version: number): UserData;
  readonly files: ModuleFiles;
  readonly kernelVersion: Health["kernelVersion"];
  bodies(projectId: string, user: User): Promise<ServerBody[]>;
}

export interface Anchored {
  id: string;
  after?: string;
  before?: string;
}

export interface CommandBase<Ctx> extends Anchored {
  label: string;
  when?(ctx: Ctx): boolean;
  enabled?(ctx: Ctx): true | string;
}

export type Keyed =
  | { keys?: never; keyContext?: never }
  | { keys: readonly string[]; keyContext: string };

export interface CommandControl {
  group: string;
  Control: ComponentType;
  run?: never;
  icon?: never;
}

export type CommandAction<Ctx> = {
  Control?: never;
  run(ctx: Ctx): unknown;
} & (
  { group?: never; icon?: never } | { group: string; icon: `${string}.svg` }
);

export type Command<Ctx = unknown> = CommandBase<Ctx> &
  Keyed &
  (CommandControl | CommandAction<Ctx>);

export const EVERY_WORKBENCH = "workbench";

export interface ToolbarGroup extends Anchored {
  label: string;
  context: string;
  end?: true;
}

export interface Panel<State = unknown> {
  id: string;
  title: string;
  when(state: State, open: readonly string[]): boolean;
  component: ComponentType;
}

export interface Workbench {
  id: string;
  label: string;
  panels: readonly string[];
  selectionKinds: readonly string[];
  tree?: ComponentType;
  bar?: ComponentType;
}

export interface ViewportLayer {
  readonly group: Group;
  requestRender(): void;
  disposeObject(object: Object3D): void;
  disposeGroup(group: Object3D): void;
  clearGroup(group: Object3D): void;
}

export interface Layer {
  id: string;
  mount(layer: ViewportLayer): void | Dispose;
}

export interface ClientRegister {
  command(command: Command): Dispose;
  toolbarGroup(group: ToolbarGroup): Dispose;
  panel(panel: Panel): Dispose;
  workbench(workbench: Workbench): Dispose;
  layer(layer: Layer): Dispose;
}

export interface ProjectBody {
  readonly id: string;
  readonly name: string;
  readonly bbox: BodyPayload["bbox"];
}

export interface OpenProject {
  readonly projectId: string | null;
  readonly document: CadDocument | null;
  readonly bodies: readonly ProjectBody[];
}

export type ProjectRoute = Route<`/projects/:id/${string}`>;

export interface ProjectView {
  get(): OpenProject;
  subscribe(listener: () => void): Dispose;
  mutate<R extends ProjectRoute>(route: R, body: RouteBody<R>): Promise<void>;
}

export interface NumberFieldProps {
  label?: string;
  value: number;
  onChange(value: number): void;
  min?: number;
  max?: number;
  above?: number;
  int?: boolean;
  step?: number;
  ariaLabel?: string;
  autoFocus?: boolean;
}

export interface ClientUi {
  DraggablePanel: ComponentType<{ title: string; children: ReactNode }>;
  DialogFooter: ComponentType<{
    onOk?: () => void;
    onCancel: () => void;
    pending?: boolean;
    okLabel?: string;
    cancelLabel?: string;
    okDisabled?: boolean;
  }>;
  NumField: ComponentType<NumberFieldProps>;
  LengthField: ComponentType<NumberFieldProps & { label: string }>;
  AngleField: ComponentType<NumberFieldProps & { label: string }>;
  SelectField<T extends string>(props: {
    label: string;
    value: T;
    options: [T, string][];
    onChange: (value: NoInfer<T>) => void;
  }): ReactNode;
  CheckField: ComponentType<{
    label: string;
    value: boolean;
    onChange: (value: boolean) => void;
  }>;
  TextField: ComponentType<{
    label: string;
    value: string;
    onChange: (value: string) => void;
    error?: string | null;
    disabled?: boolean;
  }>;
  openPanel(id: string): void;
  closePanel(id: string): void;
  confirm(message: string): Promise<boolean>;
  download(file: { fileName: string; data: BlobPart; type: string }): void;
  pickFile(request: {
    accept: string;
    maxBytes: number;
  }): Promise<{ name: string; text: string } | null>;
}

export interface ClientContext {
  readonly register: ClientRegister;
  readonly project: ProjectView;
  readonly ui: ClientUi;
  request<T = unknown>(
    method: Route["method"],
    path: string,
    body?: unknown,
  ): Promise<T>;
}

export interface ServerModule {
  activate(context: ServerContext): void | Promise<void>;
}

export interface ClientModule {
  activate(context: ClientContext): void | Promise<void>;
}

export const defineServerModule = (module: ServerModule) => module;
export const defineClientModule = (module: ClientModule) => module;
