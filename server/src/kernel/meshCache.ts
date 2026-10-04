import { createHash } from "node:crypto";
import {
  meshPayload,
  type BodyPayload,
  type EvaluateResult,
  type MeshedBody,
  type MeshedEvaluation,
} from "@rockett/shared";

const MESH_LIMITS = {
  bytes: 256 * 1024 * 1024,
  projects: 4096,
  indexed: 65536,
  recent: 4096,
};

type Entry = { hash: string; data: Buffer };
type Project = { revision?: number; hashes: Set<string>; recent: Set<string> };

export class MeshCache {
  private readonly entries = new Map<string, Entry>();
  private readonly projects = new Map<string, Project>();
  private readonly limits: typeof MESH_LIMITS;
  private size = 0;
  private indexed = 0;

  constructor(limits: Partial<typeof MESH_LIMITS> = {}) {
    this.limits = { ...MESH_LIMITS, ...limits };
  }

  private encoded(body: MeshedBody): Entry {
    const hit = this.entries.get(body.meshKey);
    if (hit) {
      this.entries.delete(body.meshKey);
      this.entries.set(body.meshKey, hit);
      return hit;
    }
    const data = Buffer.from(JSON.stringify(meshPayload(body)));
    const entry = {
      hash: createHash("sha256").update(data).digest("hex"),
      data,
    };
    if (data.length <= this.limits.bytes) {
      this.entries.set(body.meshKey, entry);
      this.size += data.length;
      for (const [key, old] of this.entries) {
        if (this.size <= this.limits.bytes) break;
        this.entries.delete(key);
        this.size -= old.data.length;
      }
    }
    return entry;
  }

  private project(projectId: string): Project {
    const project = this.projects.get(projectId) ?? {
      hashes: new Set<string>(),
      recent: new Set<string>(),
    };
    this.projects.delete(projectId);
    this.projects.set(projectId, project);
    return project;
  }

  publish(
    projectId: string,
    revision: number,
    evaluation: MeshedEvaluation,
    current = true,
  ): EvaluateResult {
    const bodies = evaluation.bodies.map((body) => this.wire(body));
    const hashes = new Set(bodies.map((body) => body.mesh!.hash));
    const project = this.project(projectId);
    const before = project.hashes.size + project.recent.size;
    if (current) {
      project.revision = revision;
      project.hashes = hashes;
    } else {
      for (const hash of hashes) {
        project.recent.delete(hash);
        project.recent.add(hash);
      }
      for (const hash of project.recent) {
        if (project.recent.size <= this.limits.recent) break;
        project.recent.delete(hash);
      }
    }
    this.indexed += project.hashes.size + project.recent.size - before;
    for (const [oldId] of this.projects) {
      if (
        this.projects.size <= this.limits.projects &&
        this.indexed <= this.limits.indexed
      )
        break;
      this.drop(oldId);
    }
    return { ...evaluation, bodies };
  }

  private wire(body: MeshedBody): BodyPayload {
    const { hash, data } = this.encoded(body);
    const { bodyId, name, color, meshKey, bbox } = body;
    const mesh = { hash, bytes: data.length };
    return { bodyId, name, ...(color && { color }), meshKey, mesh, bbox };
  }

  rejects(projectId: string, revision: number, hash: string): boolean {
    const project = this.projects.get(projectId);
    return project?.revision === revision && !project.hashes.has(hash);
  }

  get(projectId: string, revision: number, hash: string): Buffer | undefined {
    const project = this.projects.get(projectId);
    const known =
      project?.recent.has(hash) ||
      (project?.revision === revision && project.hashes.has(hash));
    if (!known) return;
    for (const [key, entry] of this.entries) {
      if (entry.hash !== hash) continue;
      this.entries.delete(key);
      this.entries.set(key, entry);
      return entry.data;
    }
  }

  materialize(body: MeshedBody): Buffer {
    return this.encoded(body).data;
  }

  drop(projectId: string): void {
    const project = this.projects.get(projectId);
    if (!project) return;
    this.indexed -= project.hashes.size + project.recent.size;
    this.projects.delete(projectId);
  }
}
