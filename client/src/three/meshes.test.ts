import * as THREE from "three";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Feature, MeshPayload } from "@rockett/shared";
import { watchProject } from "../api";
import { previewTints } from "../livePreview";
import { fillGhost } from "./ghostGeometry";
import { meshes, meshOf, MeshRegistry, type LayerBody } from "./meshes";

const hashOf = (n: number) => n.toString(16).padStart(64, "0");

function shape(size: number): MeshPayload {
  return {
    positions: [0, 0, 0, size, 0, 0, 0, size, 0],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
    indices: [0, 1, 2],
    faces: [
      {
        name: `f${size}`,
        start: 0,
        count: 3,
        surface: { type: "plane" },
        area: size,
      },
    ] as MeshPayload["faces"],
    edges: [],
    vertices: [],
    bbox: { min: [0, 0, 0], max: [size, size, 0] },
  };
}

const head = (n: number, bodyId = `b${n}`): LayerBody => ({
  bodyId,
  name: bodyId,
  meshKey: `k${n}`,
  mesh: { hash: hashOf(n), bytes: 1 },
});

let requests: string[];
let replies: Map<string, () => Response>;
const settle = () => new Promise((done) => setTimeout(done));

beforeEach(() => {
  requests = [];
  replies = new Map();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      requests.push(url);
      const reply = replies.get(url.split("/").at(-1)!);
      return reply?.() ?? new Response(null, { status: 404 });
    }),
  );
  meshes.useProject("p1");
});

afterEach(() => {
  meshes.useProject(undefined);
  watchProject(null);
  vi.unstubAllGlobals();
});

const serve = (n: number, mesh = shape(n)) =>
  replies.set(hashOf(n), () => Response.json(mesh));

it("fetches each hash once and announces its arrival", async () => {
  serve(1);
  const heard = vi.fn();
  const stop = meshes.subscribe(heard);
  const before = meshes.current();

  expect(meshOf(head(1))).toBeUndefined();
  expect(meshOf(head(1, "copy"))).toBeUndefined();
  await settle();

  expect(requests).toEqual([`/api/projects/p1/meshes/${hashOf(1)}`]);
  expect(meshOf(head(1))?.faces[0]?.name).toBe("f1");
  expect(heard).toHaveBeenCalledOnce();
  expect(meshes.current()).toBe(before + 1);
  stop();
});

it("fetches preview and rolled-back hashes through the same route", async () => {
  serve(2);
  serve(3);
  const preview = head(2);
  const rolledBack = head(3);

  meshOf(preview);
  meshOf(rolledBack);
  await settle();

  expect(requests.toSorted()).toEqual(
    [hashOf(2), hashOf(3)].map((h) => `/api/projects/p1/meshes/${h}`),
  );
  expect(meshOf(preview)?.bbox.max[0]).toBe(2);
  expect(meshOf(rolledBack)?.bbox.max[0]).toBe(3);
});

it("keeps the newest meshes within its number budget", () => {
  const registry = new MeshRegistry(45);
  const full = (n: number) => ({ ...head(n), ...shape(n) });
  for (const n of [1, 2, 3]) registry.get(full(n));

  expect(registry.get(head(1))).toBeUndefined();
  expect(registry.get(head(2))?.bbox.max[0]).toBe(2);
  expect(registry.get(head(3))?.bbox.max[0]).toBe(3);
});

it("a 404 takes the session missing path and waits for the next payload", async () => {
  const onMissing = vi.fn();
  watchProject({
    id: "p1",
    onMissing,
    onDocument: () => {},
    checkImage: async () => {},
  });

  expect(meshOf(head(4))).toBeUndefined();
  await settle();
  expect(onMissing).toHaveBeenCalledOnce();

  meshOf(head(4));
  await settle();
  expect(requests).toHaveLength(1);

  serve(4);
  meshes.retry();
  meshOf(head(4));
  await settle();
  expect(requests).toHaveLength(2);
  expect(meshOf(head(4))).toBeDefined();
});

it("tints and ghosts nothing before a mesh arrives and the right faces after", async () => {
  serve(5);
  const feature = { type: "extrude", operation: "join" } as Feature;
  const geom = new THREE.BufferGeometry();
  const ranges = [{ start: 0, count: 3 }];

  expect(previewTints(feature, [], [head(5)]).size).toBe(0);
  fillGhost(geom, head(5), ranges);
  expect(geom.drawRange.count).toBe(0);
  await settle();

  expect(previewTints(feature, [], [head(5)]).get("b5")?.ranges).toEqual(
    ranges,
  );
  fillGhost(geom, head(5), ranges);
  expect(geom.drawRange.count).toBe(3);
});
