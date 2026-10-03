import type { RequestHandler } from "express";
import type {
  ProjectMutation,
  RouteContext,
  RouteModule as ModuleOf,
  RouteModuleApi,
} from "@rockett/plugin-api";
import {
  createRegistry,
  DOCUMENT_EDITS,
  REGISTRY_ID,
  type CadDocument,
  type Route,
} from "@rockett/shared";
import type { KernelClient } from "../kernel/client.js";
import type { ProjectStore } from "../store/projectStore.js";

export type Edit = (
  doc: CadDocument,
  req: any,
  ctx: RouteContext,
) => Promise<ProjectMutation>;

export interface ModuleApi extends RouteModuleApi {
  kernel: KernelClient;
}

export type RouteModule = ModuleOf<ModuleApi>;

export const routeModules = createRegistry<RouteModule>(
  "route module",
  (module) => module.id,
);

export const registerRouteModule = routeModules.register;

export const BODY_ROUTE_MODULE = "bodies";

function moduleSegment(id: string): string {
  const moduleId = REGISTRY_ID.exec(id)?.[1];
  if (!moduleId) throw new Error(`route module ${id} has an invalid id`);
  return `/m/${moduleId}/`;
}

const projectPrefix = (id: string) =>
  id.includes(".") ? `/projects/:id${moduleSegment(id)}` : "/projects/:id/";

type RouterApi = {
  kernel: KernelClient;
  store: ProjectStore;
  on(route: Route, ...handlers: RequestHandler[]): void;
  wrap(
    fn: (req: any, res: any, ctx: RouteContext) => Promise<void>,
  ): RequestHandler;
  mutateProject(edit: Edit): RequestHandler;
};

export function mountRouteModule(router: RouterApi, module: RouteModule): void {
  const { kernel, store, on, wrap, mutateProject } = router;
  const inside = (route: Route, start = projectPrefix(module.id)) => {
    if (!route.path.startsWith(start))
      throw new Error(
        `route module ${module.id} must mount ${route.path} under ${start}`,
      );
    return route;
  };
  module.mount({
    kernel,
    projectRoute: (route, read) => {
      if (DOCUMENT_EDITS(route))
        throw new Error(
          `route module ${module.id} must mount ${route.path} as a mutation`,
        );
      on(
        inside(route),
        wrap(async (req, res, ctx) => {
          res.json(await read(await store.load(req.params.id), req, ctx));
        }),
      );
    },
    projectMutation: (route, edit) => {
      inside(route);
      if (!DOCUMENT_EDITS(route))
        throw new Error(
          `route module ${module.id} must declare ${route.path} as a document edit`,
        );
      on(route, mutateProject(edit));
    },
    userRoute: (route, handle) => {
      inside(route, moduleSegment(module.id));
      if (route.effect || /\/:id(\/|$)/.test(route.path))
        throw new Error(
          `route module ${module.id} user route ${route.path} cannot name a project`,
        );
      on(
        route,
        wrap(async (req, res, ctx) => {
          res.json(await handle(req, ctx));
        }),
      );
    },
  });
}

export function mountRouteModules(router: RouterApi): void {
  for (const module of routeModules.list())
    if (module.id !== BODY_ROUTE_MODULE) mountRouteModule(router, module);
}
