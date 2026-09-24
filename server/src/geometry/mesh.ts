import { getKernel, faces as facesOf, type Shape } from "./kernel.js";

export interface FaceMesh {
  face: Shape;
  positions: Float64Array;
  normals: Float64Array;
  indices: Uint32Array;
}

export function meshShape(
  shape: Shape,
  { linear, angular }: { linear: number; angular: number },
): FaceMesh[] {
  const k = getKernel();
  new k.BRepMesh_IncrementalMesh_2(
    shape,
    linear,
    false,
    angular,
    false,
  ).delete();

  const out: FaceMesh[] = [];
  for (const face of facesOf(shape)) {
    const mesh = k.meshFace(face);
    if (mesh) out.push({ face, ...mesh });
    else face.delete();
  }
  return out;
}
