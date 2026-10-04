import { LINEAR_TOL, type ImportMeshFeature } from "@rockett/shared";
import { acquire, scoped, getKernel, progress, type Shape } from "./kernel.js";
import { setExactTriangle } from "./mesh.js";
import {
  compound,
  MAX_MESH_TRIANGLES,
  MESH_READERS,
  solidsOf,
  sourceOf,
  type MeshPart,
  type Sources,
} from "./importers.js";
import { finalizeNames } from "./naming.js";
import { ShapeMap } from "./shapeMap.js";
import { registerBodySolids, type FeatureOutcome } from "./featureState.js";
import type { EvalContext } from "./featureKinds.js";

function attachTriangle(
  builder: any,
  sewing: any,
  sides: (Shape | null)[],
  corners: number[][],
  normalVector: number[],
): void {
  const k = getKernel();
  scoped((local) => {
    const wire = local(new k.BRepBuilderAPI_MakeWire_4(...sides));
    const origin = local(new k.gp_Pnt_3(...corners[0]!));
    const normal = local(new k.gp_Dir_5(...normalVector));
    const plane = local(new k.gp_Pln_3(origin, normal));
    const make = local(new k.BRepBuilderAPI_MakeFace_3(plane));
    const face = local(make.Face());
    builder.UpdateFace_3(face, LINEAR_TOL);
    setExactTriangle(builder, face, corners);
    builder.Add(face, local(wire.Wire()));
    sewing.Add(face);
  });
}

function sewTriangles({ nodes, triangles, transform: m }: MeshPart): {
  shape: Shape;
  openEdges: number;
} {
  const k = getKernel();
  const result = scoped((own) => {
    const builder = own(new k.BRep_Builder());
    const sewing = own(
      new k.BRepBuilderAPI_Sewing(LINEAR_TOL, true, false, false, false),
    );
    const vertices = new Map<number, Shape>();
    const edges = new Map<number, Shape | null>();
    const count = nodes.length / 3;
    const point = (i: number): number[] => {
      const [x, y, z] = [nodes[3 * i]!, nodes[3 * i + 1]!, nodes[3 * i + 2]!];
      if (!m) return [x, y, z];
      return [0, 1, 2].map(
        (axis) =>
          x * m[axis]! + y * m[3 + axis]! + z * m[6 + axis]! + m[9 + axis]!,
      );
    };
    const vertex = (i: number): Shape => {
      if (!vertices.has(i)) {
        const made = scoped((local) => {
          const p = point(i);
          const at = local(new k.gp_Pnt_3(p[0], p[1], p[2]));
          const make = local(new k.BRepBuilderAPI_MakeVertex(at));
          return local.keep(local(make.Vertex()));
        });
        vertices.set(i, own(made));
      }
      return vertices.get(i)!;
    };
    const edge = (a: number, b: number): Shape | null => {
      const key = Math.min(a, b) * count + Math.max(a, b);
      if (!edges.has(key)) {
        const made = scoped((local) => {
          const make = local(
            new k.BRepBuilderAPI_MakeEdge_2(
              vertex(Math.min(a, b)),
              vertex(Math.max(a, b)),
            ),
          );
          return make.IsDone() ? local.keep(local(make.Edge())) : null;
        });
        edges.set(key, made && own(made));
      }
      const found = edges.get(key)!;
      if (!found || a < b) return found;
      return own(
        scoped((local) =>
          local.keep(local(k.TopoDS.Edge_1(local(found.Reversed())))),
        ),
      );
    };
    for (let i = 0; i < triangles.length; i += 3) {
      const [a, b, c] = [triangles[i]!, triangles[i + 1]!, triangles[i + 2]!],
        [p, q, r] = [point(a), point(b), point(c)],
        u = [q[0]! - p[0]!, q[1]! - p[1]!, q[2]! - p[2]!],
        v = [r[0]! - p[0]!, r[1]! - p[1]!, r[2]! - p[2]!],
        n = [
          u[1]! * v[2]! - u[2]! * v[1]!,
          u[2]! * v[0]! - u[0]! * v[2]!,
          u[0]! * v[1]! - u[1]! * v[0]!,
        ],
        sides = [edge(a, b), edge(b, c), edge(c, a)];
      if (sides.includes(null) || Math.hypot(n[0]!, n[1]!, n[2]!) === 0)
        continue;
      attachTriangle(builder, sewing, sides, [p, q, r], n);
    }
    sewing.Perform(progress());
    return {
      shape: own.keep(own(sewing.SewedShape())),
      openEdges: sewing.NbFreeEdges(),
    };
  });
  acquire(result.shape);
  return result;
}

function readMesh(
  feature: ImportMeshFeature,
  sources: Sources,
): {
  shape: Shape;
  warning?: string;
} {
  const { label, read } = MESH_READERS[feature.format],
    parts = read(Buffer.from(sourceOf(sources, feature, label))).filter(
      (part) => part.triangles.length > 0,
    ),
    triangles = parts.reduce((sum, part) => sum + part.triangles.length / 3, 0);
  if (triangles === 0) throw new Error(`No mesh found in the ${label} file.`);
  if (triangles > MAX_MESH_TRIANGLES)
    throw new Error(
      `The ${label} mesh has ${triangles.toLocaleString("en-US")} triangles; the limit is ${MAX_MESH_TRIANGLES.toLocaleString("en-US")}.`,
    );
  const result = scoped((own) => {
    const pieces = parts.map(sewTriangles);
    const sewn = own(compound(pieces.map((piece) => piece.shape)));
    const openEdges = pieces.reduce((sum, piece) => sum + piece.openEdges, 0);
    if (openEdges > 0)
      return {
        shape: own.keep(sewn),
        warning: `The ${label} mesh is open at ${openEdges} edges, so it imported as a shell, not a solid.`,
      };
    return { shape: own.keep(solidsOf(sewn)) };
  });
  acquire(result.shape);
  return result;
}

export function evalImportMesh(
  { state, sources }: EvalContext,
  feature: ImportMeshFeature,
): FeatureOutcome | void {
  const { shape, warning } = readMesh(feature, sources),
    bodyId = `b:${feature.id}`,
    names = finalizeNames(shape, new ShapeMap(), feature.id);
  if (!warning) return registerBodySolids(state, bodyId, shape, names);
  state.bodies.set(bodyId, { bodyId, shape, names });
  return { warning };
}
