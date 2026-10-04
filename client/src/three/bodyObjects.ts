import * as THREE from "three";
import { pathFor, ROUTES, type BodyPayload } from "@rockett/shared";
import { request } from "../api";
import { disposeAll, disposeGroup } from "./dispose";
import { BodyMaterials } from "./materials";
import type { PickBody } from "./pickProviders";

const MAX_FETCHES = 6;

export type BodyMesh = Pick<
  BodyPayload,
  "positions" | "normals" | "indices" | "faces" | "edges" | "vertices" | "bbox"
>;
export type LayerBody = Omit<BodyPayload, keyof BodyMesh> & Partial<BodyMesh>;

export interface BodyObjects extends PickBody {
  material: THREE.MeshStandardMaterial;
  tint: THREE.MeshStandardMaterial | null;
}

interface FetchScope {
  id: string;
  stop: AbortController;
  queue: string[];
  fetching: Set<string>;
}

const hashOf = (body: LayerBody) => body.mesh?.hash ?? body.meshKey;
const decoded = (body: LayerBody): body is BodyPayload =>
  body.positions !== undefined;

function meshOf(p: BodyPayload): BodyMesh {
  const { positions, normals, indices, faces, edges, vertices, bbox } = p;
  return { positions, normals, indices, faces, edges, vertices, bbox };
}

function edgeLines(p: BodyPayload) {
  const points: number[] = [];
  const edgeSegments: string[] = [];
  for (const e of p.edges) {
    for (let i = 0; i + 5 < e.polyline.length; i += 3) {
      points.push(
        e.polyline[i]!,
        e.polyline[i + 1]!,
        e.polyline[i + 2]!,
        e.polyline[i + 3]!,
        e.polyline[i + 4]!,
        e.polyline[i + 5]!,
      );
      edgeSegments.push(e.name);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(points, 3),
  );
  return { edgeGeometry: geometry, edgeSegments };
}

function vertexPoints(p: BodyPayload) {
  const points: number[] = [];
  const vertexNames: string[] = [];
  for (const v of p.vertices) {
    points.push(...v.position);
    vertexNames.push(v.name);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(points, 3),
  );
  return { vertexGeometry: geometry, vertexNames };
}

function buildBody(
  p: BodyPayload,
  materials: BodyMaterials,
  dimmed: boolean,
): BodyObjects {
  const group = new THREE.Group();
  group.userData.bodyId = p.bodyId;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(p.positions, 3),
  );
  geom.setAttribute("normal", new THREE.Float32BufferAttribute(p.normals, 3));
  geom.setIndex(p.indices);
  const { edgeGeometry, edgeSegments } = edgeLines(p);
  const { vertexGeometry, vertexNames } = vertexPoints(p);
  const material = materials.face(p.color, dimmed);
  const mesh = new THREE.Mesh(geom, material);
  mesh.userData.bodyId = p.bodyId;
  const edges = new THREE.LineSegments(edgeGeometry, materials.edge());
  edges.userData.bodyId = p.bodyId;
  const vertices = new THREE.Points(vertexGeometry, materials.vertex());
  vertices.visible = false;
  vertices.userData.bodyId = p.bodyId;
  group.add(mesh, edges, vertices);
  return {
    group,
    mesh,
    material,
    tint: null,
    edges,
    edgeSegments,
    vertices,
    vertexNames,
    payload: p,
  };
}

export class BodyLayer {
  readonly bodies = new Map<string, BodyObjects>();
  private readonly materials = new BodyMaterials();
  private missing = new Map<string, LayerBody[]>();
  private hidden: ReadonlySet<string> = new Set();
  private dimmed: ReadonlySet<string> = new Set();
  private scope: FetchScope | null = null;
  private active = 0;

  constructor(
    private readonly root: THREE.Group,
    private readonly changed: () => void,
  ) {}

  sync(
    bodies: readonly LayerBody[],
    hidden: ReadonlySet<string>,
    projectId?: string,
  ) {
    this.useProject(projectId);
    this.hidden = hidden;
    this.missing = new Map();
    const seen = new Set<string>();
    for (const body of bodies) {
      seen.add(body.bodyId);
      const built = this.bodies.get(body.bodyId);
      if (built && hashOf(built.payload) === hashOf(body))
        this.update(built, body);
      else if (decoded(body)) this.place(body);
      else this.want(body, built);
    }
    for (const [id, built] of this.bodies)
      if (!seen.has(id)) this.remove(id, built);
    this.pump();
    this.changed();
  }

  dim(ids: ReadonlySet<string>) {
    this.dimmed = ids;
    for (const built of this.bodies.values())
      this.paint(built, built.payload.color);
    this.changed();
  }

  dispose() {
    this.useProject(undefined);
    this.missing.clear();
    for (const [id, built] of this.bodies) this.remove(id, built);
  }

  private useProject(id: string | undefined) {
    if (this.scope?.id === id) return;
    this.scope?.stop.abort();
    this.scope =
      id === undefined
        ? null
        : { id, stop: new AbortController(), queue: [], fetching: new Set() };
  }

  private update(built: BodyObjects, body: LayerBody) {
    if (built.payload.color !== body.color) this.paint(built, body.color);
    built.payload = decoded(body)
      ? body
      : { ...meshOf(built.payload), ...body };
    built.group.visible = !this.hidden.has(body.bodyId);
  }

  private place(body: BodyPayload) {
    const old = this.bodies.get(body.bodyId);
    if (old) this.remove(body.bodyId, old);
    const built = buildBody(body, this.materials, this.dimmed.has(body.bodyId));
    built.group.visible = !this.hidden.has(body.bodyId);
    this.bodies.set(body.bodyId, built);
    this.root.add(built.group);
  }

  private paint(built: BodyObjects, color: string | undefined) {
    const old = built.material;
    const next = this.materials.face(
      color,
      this.dimmed.has(built.payload.bodyId),
    );
    this.materials.release(old);
    if (next === old) return;
    built.material = next;
    const { mesh } = built;
    mesh.material = Array.isArray(mesh.material)
      ? mesh.material.map((m) => (m === old ? next : m))
      : next;
    disposeAll([old], this.materials.live());
  }

  private remove(id: string, built: BodyObjects) {
    this.root.remove(built.group);
    this.materials.release(built.material);
    this.materials.release(built.edges.material);
    this.materials.release(built.vertices.material);
    disposeGroup(built.group, this.materials.live());
    this.bodies.delete(id);
  }

  private want(body: LayerBody, stale: BodyObjects | undefined) {
    if (stale) stale.group.visible = !this.hidden.has(body.bodyId);
    const hash = hashOf(body);
    const waiting = this.missing.get(hash);
    if (waiting) return waiting.push(body);
    this.missing.set(hash, [body]);
    if (!this.scope || this.scope.fetching.has(hash)) return;
    this.scope.fetching.add(hash);
    this.scope.queue.push(hash);
  }

  private pump() {
    const scope = this.scope;
    if (!scope) return;
    while (this.active < MAX_FETCHES) {
      const hash = scope.queue.shift();
      if (hash === undefined) return;
      if (this.missing.has(hash)) this.fetch(scope, hash);
      else scope.fetching.delete(hash);
    }
  }

  private fetch(scope: FetchScope, hash: string) {
    this.active++;
    const path = pathFor(ROUTES.mesh, { id: scope.id, hash });
    request<BodyMesh>(ROUTES.mesh.method, path, { signal: scope.stop.signal })
      .then((mesh) => this.arrive(scope, hash, mesh))
      .catch(() => scope.fetching.delete(hash))
      .finally(() => {
        this.active--;
        this.pump();
      });
  }

  private arrive(scope: FetchScope, hash: string, mesh: BodyMesh) {
    scope.fetching.delete(hash);
    if (scope !== this.scope) return;
    for (const body of this.missing.get(hash) ?? [])
      this.place({ ...mesh, ...body });
    this.missing.delete(hash);
    this.changed();
  }
}
