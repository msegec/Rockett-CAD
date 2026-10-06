import type { placementSchema } from "@rockett/plugin-api";
import type { Static } from "typebox";
import type { BoardNets } from "./boardNets.js";

type Vec3 = [number, number, number];
type Placement = Static<typeof placementSchema>;
type Side = "front" | "back";

export type ConnectorSnapshot = {
  thickness: number;
  placement: Placement;
  footprints: readonly {
    uuid?: string | undefined;
    libId?: string | undefined;
    reference?: string | undefined;
    side?: string | undefined;
    pads: readonly { number?: string | undefined; x: number; y: number }[];
  }[];
  nets: BoardNets["nets"];
};

export type ConnectorFlags = Readonly<
  Record<string, { connector?: true; mating?: Vec3 }>
>;

export type Connector = {
  footprintUuid: string;
  reference: string;
  side: Side;
  suggested: Vec3;
  mating?: { direction: Vec3; source: "metadata" | "frame" };
  pins: { pad: string; net?: string; position: Vec3 }[];
};

const CONNECTOR_REFERENCE = /^(?:J|P|X|CN)/;

function rotate([x, y, z, w]: Placement["rotation"], [a, b, c]: Vec3): Vec3 {
  const t: Vec3 = [
    2 * (y * c - z * b),
    2 * (z * a - x * c),
    2 * (x * b - y * a),
  ];
  return [
    a + w * t[0] + y * t[2] - z * t[1],
    b + w * t[1] + z * t[0] - x * t[2],
    c + w * t[2] + x * t[1] - y * t[0],
  ];
}

function vertical(libId: string | undefined) {
  const name = libId?.slice(libId.indexOf(":") + 1) ?? "";
  return name.split("_").includes("Vertical");
}

export function connectors(
  { thickness, placement, footprints, nets }: ConnectorSnapshot,
  flags: ConnectorFlags,
): Connector[] {
  const netOf = new Map(
    nets.flatMap(({ name, members }) =>
      members.map(
        ({ footprintUuid, pad }) => [`${footprintUuid}\0${pad}`, name] as const,
      ),
    ),
  );
  const place = (point: Vec3): Vec3 => {
    const [x, y, z] = rotate(placement.rotation, point);
    const [dx, dy, dz] = placement.translation;
    return [x + dx, y + dy, z + dz];
  };
  return footprints.flatMap(({ uuid, libId, reference = "", side, pads }) => {
    if (!uuid || (side !== "front" && side !== "back")) return [];
    const flag = flags[uuid];
    if (!flag?.connector && !CONNECTOR_REFERENCE.test(reference)) return [];
    const suggested = rotate(placement.rotation, [
      0,
      0,
      side === "front" ? 1 : -1,
    ]);
    const z = side === "front" ? thickness : 0;
    const mating: Connector["mating"] = flag?.mating
      ? { direction: rotate(placement.rotation, flag.mating), source: "frame" }
      : vertical(libId)
        ? { direction: suggested, source: "metadata" }
        : undefined;
    return [
      {
        footprintUuid: uuid,
        reference,
        side,
        suggested,
        ...(mating && { mating }),
        pins: pads.flatMap(({ number, x, y }) => {
          if (!number) return [];
          const net = netOf.get(`${uuid}\0${number}`);
          return [
            {
              pad: number,
              ...(net !== undefined && { net }),
              position: place([x, y, z]),
            },
          ];
        }),
      },
    ];
  });
}
