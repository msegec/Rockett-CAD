import * as THREE from "three";
import type { MeshPayload } from "@rockett/shared";
import { disposeAll, disposeGroup } from "./dispose";
import { BodyMaterials } from "./materials";
import type { PickBody } from "./pickProviders";
import { hashOf, meshes, meshOf, type LayerBody } from "./meshes";

export interface BodyObjects extends PickBody {
  material: THREE.MeshStandardMaterial;
  tint: THREE.MeshStandardMaterial | null;
}

function edgeLines(p: MeshPayload) {
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

function vertexPoints(p: MeshPayload) {
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
  p: LayerBody,
  shape: MeshPayload,
  materials: BodyMaterials,
  dimmed: boolean,
): BodyObjects {
  const group = new THREE.Group();
  group.userData.bodyId = p.bodyId;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(shape.positions, 3),
  );
  geom.setAttribute(
    "normal",
    new THREE.Float32BufferAttribute(shape.normals, 3),
  );
  geom.setIndex(shape.indices);
  const { edgeGeometry, edgeSegments } = edgeLines(shape);
  const { vertexGeometry, vertexNames } = vertexPoints(shape);
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
  private missing: LayerBody[] = [];
  private synced: readonly LayerBody[] = [];
  private hidden: ReadonlySet<string> = new Set();
  private dimmed: ReadonlySet<string> = new Set();
  private readonly unsubscribe = meshes.subscribe(() => this.arrive());

  constructor(
    private readonly root: THREE.Group,
    private readonly changed: () => void,
  ) {}

  sync(
    bodies: readonly LayerBody[],
    hidden: ReadonlySet<string>,
    projectId?: string,
  ) {
    meshes.useProject(projectId);
    if (bodies !== this.synced) meshes.retry();
    this.synced = bodies;
    this.hidden = hidden;
    this.missing = [];
    const seen = new Set<string>();
    for (const body of bodies) {
      seen.add(body.bodyId);
      const built = this.bodies.get(body.bodyId);
      if (built && hashOf(built.payload) === hashOf(body))
        this.update(built, body);
      else this.show(body, built);
    }
    for (const [id, built] of this.bodies)
      if (!seen.has(id)) this.remove(id, built);
    this.changed();
  }

  dim(ids: ReadonlySet<string>) {
    this.dimmed = ids;
    for (const built of this.bodies.values())
      this.paint(built, built.payload.color);
    this.changed();
  }

  dispose() {
    this.unsubscribe();
    meshes.useProject(undefined);
    this.missing = [];
    for (const [id, built] of this.bodies) this.remove(id, built);
  }

  private show(body: LayerBody, stale: BodyObjects | undefined) {
    const shape = meshOf(body);
    if (shape) return this.place(body, shape);
    if (stale) stale.group.visible = !this.hidden.has(body.bodyId);
    this.missing.push(body);
  }

  private arrive() {
    const waiting = this.missing;
    this.missing = [];
    for (const body of waiting) this.show(body, this.bodies.get(body.bodyId));
    if (this.missing.length < waiting.length) this.changed();
  }

  private update(built: BodyObjects, body: LayerBody) {
    if (built.payload.color !== body.color) this.paint(built, body.color);
    built.payload = body;
    built.group.visible = !this.hidden.has(body.bodyId);
  }

  private place(body: LayerBody, shape: MeshPayload) {
    const old = this.bodies.get(body.bodyId);
    if (old) this.remove(body.bodyId, old);
    const built = buildBody(
      body,
      shape,
      this.materials,
      this.dimmed.has(body.bodyId),
    );
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
}
