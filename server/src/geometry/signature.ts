import type { EdgeRef, FaceRef, RefSignature } from "@rockett/shared";
import {
  faceCentroid,
  getKernel,
  pnt,
  release,
  scoped,
  vec,
  type Shape,
} from "./kernel.js";
import { computeEdgeNames, findFace, type NamedBody } from "./naming.js";
import { curveInfo, surfaceType } from "./tessellate.js";

type Vec = RefSignature["direction"];

function unit(x: number, y: number, z: number): Vec {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

export function faceSignature(face: Shape): RefSignature {
  const k = getKernel();
  return scoped((own) => {
    const surf = own(new k.BRepAdaptor_Surface_2(face, true));
    const p = own(pnt(0, 0, 0)),
      du = own(vec(0, 0, 0)),
      dv = own(vec(0, 0, 0));
    surf.D1(
      (surf.FirstUParameter() + surf.LastUParameter()) / 2,
      (surf.FirstVParameter() + surf.LastVParameter()) / 2,
      p,
      du,
      dv,
    );
    const sign =
      face.Orientation_1() === k.TopAbs_Orientation.TopAbs_REVERSED ? -1 : 1;
    const u: Vec = [du.X(), du.Y(), du.Z()];
    const v: Vec = [dv.X(), dv.Y(), dv.Z()];
    return {
      type: surfaceType(surf),
      point: faceCentroid(face),
      direction: unit(
        sign * (u[1] * v[2] - u[2] * v[1]),
        sign * (u[2] * v[0] - u[0] * v[2]),
        sign * (u[0] * v[1] - u[1] * v[0]),
      ),
    };
  });
}

export function edgeSignature(edge: Shape): RefSignature {
  const k = getKernel();
  return scoped((own) => {
    const curve = own(new k.BRepAdaptor_Curve_2(edge));
    const p = own(pnt(0, 0, 0)),
      d = own(vec(0, 0, 0));
    curve.D1((curve.FirstParameter() + curve.LastParameter()) / 2, p, d);
    return {
      type: curveInfo(edge).type,
      point: [p.X(), p.Y(), p.Z()],
      direction: unit(d.X(), d.Y(), d.Z()),
    };
  });
}

const finite = (sig: RefSignature) =>
  [...sig.point, ...sig.direction].every(Number.isFinite);

function faceSig(body: NamedBody, name: string): RefSignature | undefined {
  const face = findFace(body, name);
  if (!face) return undefined;
  try {
    return faceSignature(face);
  } finally {
    face.delete();
  }
}

export function signRefs(
  bodies: ReadonlyMap<string, NamedBody>,
  refs: Array<FaceRef | EdgeRef>,
): void {
  const edges = new Map<string, Map<string, Shape>>();
  const edgesOf = (body: NamedBody) => {
    const known = edges.get(body.bodyId);
    if (known) return known;
    const named = computeEdgeNames(body).byName;
    edges.set(body.bodyId, named);
    return named;
  };
  try {
    for (const ref of refs) {
      const body = bodies.get(ref.bodyId);
      if (!body) continue;
      const edge = ref.kind === "edge" && edgesOf(body).get(ref.edgeName);
      const sig =
        ref.kind === "face"
          ? faceSig(body, ref.faceName)
          : edge && edgeSignature(edge);
      if (sig && finite(sig)) ref.sig = sig;
    }
  } finally {
    for (const named of edges.values()) release(named.values());
  }
}
