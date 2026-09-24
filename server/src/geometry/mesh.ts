import { getKernel, faces as facesOf, release, type Shape } from "./kernel.js";

export interface FaceMesh {
  face: Shape;
  positions: Float64Array;
  normals: Float64Array;
  indices: Uint32Array;
}

const EXACT = 32;

export function setExactTriangle(
  builder: any,
  face: Shape,
  corners: number[][],
) {
  const k = getKernel(),
    mesh = new k.Poly_Triangulation_2(3, 1, false, false),
    triangle = new k.Poly_Triangle_2(1, 2, 3);
  corners.forEach(([x, y, z], i) => {
    const at = new k.gp_Pnt_3(x, y, z);
    mesh.SetNode(i + 1, at);
    at.delete();
  });
  mesh.SetTriangle(1, triangle);
  mesh.SetMeshPurpose(EXACT);
  triangle.delete();
  const handle = new k.Handle_Poly_Triangulation_2(mesh);
  builder.UpdateFace_2(face, handle, true);
  handle.delete();
}

function isExact(face: Shape): boolean {
  const k = getKernel(),
    at = new k.TopLoc_Location_1(),
    mesh = k.BRep_Tool.Triangulation(face, at, EXACT),
    exact = !mesh.IsNull();
  mesh.delete();
  at.delete();
  return exact;
}

function read(faces: Shape[]): FaceMesh[] {
  const k = getKernel(),
    out: FaceMesh[] = [];
  for (const face of faces) {
    const mesh = k.meshFace(face);
    if (mesh) out.push({ face, ...mesh });
    else face.delete();
  }
  return out;
}

export function meshShape(
  shape: Shape,
  { linear, angular }: { linear: number; angular: number },
): FaceMesh[] {
  const faces = facesOf(shape);
  if (!faces.every(isExact))
    new (getKernel().BRepMesh_IncrementalMesh_2)(
      shape,
      linear,
      false,
      angular,
      false,
    ).delete();
  return read(faces);
}

export function meshCopy(
  shape: Shape,
  deflection: { linear: number; angular: number },
): FaceMesh[] {
  const faces = facesOf(shape);
  if (faces.every(isExact)) return read(faces);
  release(faces);
  const copy = new (getKernel().BRepBuilderAPI_Copy_2)(shape, false, false);
  try {
    return meshShape(copy.Shape(), deflection);
  } finally {
    copy.delete();
  }
}
