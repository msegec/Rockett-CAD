import * as THREE from "three";
import type { Layer, OpenProject, ProjectView } from "@rockett/plugin-api";
import { stockBox, type Placement, type StockSetup } from "../shared/setup.js";
import { bodyBoxes, camRead } from "./setup.js";

export const STOCK_LAYER = "rockett.cam.stock";

const STOCK_TOKEN = "border";
const AXIS_TOKENS = ["axis-x", "axis-y", "axis-z"] as const;
const TRIAD_FRACTION = 0.25;

export function themed<M extends THREE.LineBasicMaterial>(
  material: M,
  token: string,
): M {
  material.color.set(
    getComputedStyle(document.documentElement)
      .getPropertyValue(`--${token}`)
      .trim(),
  );
  material.userData.themeToken = token;
  return material;
}

const line = (points: THREE.Vector3[], token: string) =>
  new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    themed(new THREE.LineBasicMaterial(), token),
  );

export function placeInModel<O extends THREE.Object3D>(
  object: O,
  { translation, rotation }: Placement,
): O {
  new THREE.Matrix4()
    .compose(
      new THREE.Vector3(...translation),
      new THREE.Quaternion(...rotation),
      new THREE.Vector3(1, 1, 1),
    )
    .invert()
    .decompose(object.position, object.quaternion, object.scale);
  return object;
}

function stockObject(setup: StockSetup, open: OpenProject) {
  const { min, max, modelToSetup } = stockBox(setup, bodyBoxes(open));
  const [a, b] = [new THREE.Vector3(...min), new THREE.Vector3(...max)];
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(
    (i) =>
      new THREE.Vector3(
        i & 1 ? b.x : a.x,
        i & 2 ? b.y : a.y,
        i & 4 ? b.z : a.z,
      ),
  );
  const edges = corners.flatMap((corner, i) =>
    [1, 2, 4]
      .filter((bit) => !(i & bit))
      .flatMap((bit) => [corner, corners[i | bit]!]),
  );
  const object = new THREE.Group();
  object.add(line(edges, STOCK_TOKEN));
  const reach = TRIAD_FRACTION * Math.max(...b.clone().sub(a).toArray());
  AXIS_TOKENS.forEach((token, i) =>
    object.add(
      line(
        [new THREE.Vector3(), new THREE.Vector3().setComponent(i, reach)],
        token,
      ),
    ),
  );
  return placeInModel(object, modelToSetup);
}

function drawn(open: OpenProject) {
  const read = camRead(open);
  if (read.status === "kept") return [];
  const present = new Set(open.bodies.map(({ id }) => id));
  return read.data.setups.flatMap(({ bodies, stock, wcs }) =>
    bodies?.length && bodies.every((id) => present.has(id)) && stock && wcs
      ? [stockObject({ bodies, stock, wcs }, open)]
      : [],
  );
}

export const stockLayer = (project: ProjectView): Layer => ({
  id: STOCK_LAYER,
  mount({ group, requestRender, clearGroup }) {
    const draw = () => {
      clearGroup(group);
      try {
        for (const object of drawn(project.get())) group.add(object);
      } catch (error) {
        console.error(`[rockett] ${STOCK_LAYER}: ${String(error)}`);
      }
      requestRender();
    };
    draw();
    return project.subscribe(draw);
  },
});
