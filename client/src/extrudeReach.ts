import {
  findProfile,
  LINEAR_TOL,
  type BodyPayload,
  type SketchPayload,
  type Vec3,
} from "@rockett/shared";
import { previewBodies, useStore } from "./store";

interface Base {
  points: Vec3[];
  normal: Vec3;
}

interface Bounds {
  min: Vec3;
  max: Vec3;
}

function profileBase(
  sel: { sketchId: string; profileId: string },
  sketches: SketchPayload[],
): Base | null {
  const sketch = sketches.find((s) => s.featureId === sel.sketchId);
  const profile = sketch && findProfile(sketch, sel.profileId);
  if (!sketch || !profile) return null;
  const { origin: o, xAxis: x, yAxis: y, normal } = sketch.frame;
  const points: Vec3[] = [];
  for (let i = 0; i + 1 < profile.polygon.length; i += 2) {
    const u = profile.polygon[i]!;
    const v = profile.polygon[i + 1]!;
    points.push([
      o[0] + u * x[0] + v * y[0],
      o[1] + u * x[1] + v * y[1],
      o[2] + u * x[2] + v * y[2],
    ]);
  }
  return { points, normal };
}

function faceBase(
  sel: { bodyId: string; faceName: string },
  bodies: BodyPayload[],
): Base | null {
  const body = bodies.find((b) => b.bodyId === sel.bodyId);
  const face = body?.faces.find((f) => f.name === sel.faceName);
  if (!body || !face || face.surface.type !== "plane") return null;
  const points: Vec3[] = [];
  for (let i = face.start; i < face.start + face.count; i++) {
    const at = body.indices[i]! * 3;
    points.push([
      body.positions[at]!,
      body.positions[at + 1]!,
      body.positions[at + 2]!,
    ]);
  }
  return { points, normal: face.surface.normal };
}

function swept({ points, normal }: Base, from: number, to: number): Bounds {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of points)
    for (const t of [from, to])
      for (let i = 0; i < 3; i++) {
        const v = p[i]! + normal[i]! * t;
        min[i] = Math.min(min[i]!, v);
        max[i] = Math.max(max[i]!, v);
      }
  return { min, max };
}

function overlaps(a: Bounds, b: Bounds): boolean {
  for (let i = 0; i < 3; i++)
    if (
      a.max[i]! <= b.min[i]! + LINEAR_TOL ||
      b.max[i]! <= a.min[i]! + LINEAR_TOL
    )
      return false;
  return true;
}

export function extrudeReachesBody(from: number, to: number): boolean {
  const s = useStore.getState();
  const bodies = previewBodies(s);
  return s.selection.some((sel) => {
    const base =
      sel.kind === "profile"
        ? profileBase(sel, s.evaluation?.sketches ?? [])
        : sel.kind === "face"
          ? faceBase(sel, bodies)
          : null;
    if (!base) return false;
    const tool = swept(base, from, to);
    return bodies.some((b) => overlaps(tool, b.bbox));
  });
}
