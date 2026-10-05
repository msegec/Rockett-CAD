import { StoreError, type Route, type RouteModule } from "@rockett/plugin-api";
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

const PROVIDER = "rockett.kicad";
const id = Type.String({ minLength: 1 });
const boardNetsSchema = Type.Object({
  nets: Type.Array(
    Type.Object({
      name: id,
      members: Type.Array(
        Type.Object({
          footprintUuid: id,
          reference: Type.String(),
          pad: Type.String(),
        }),
      ),
    }),
  ),
});
export type BoardNets = Static<typeof boardNetsSchema>;

export const netsRoute: Route<
  "/projects/:id/m/rockett/elec/boards/:linkId/nets",
  unknown,
  BoardNets
> = {
  method: "GET",
  path: "/projects/:id/m/rockett/elec/boards/:linkId/nets",
};

export const netsModule: RouteModule = {
  id: "rockett.elec.nets",
  mount(api) {
    api.projectRoute(netsRoute, async (_doc, { params }, { services }) => {
      const boardNets = services.get(`${PROVIDER}.boardNets`);
      if (!boardNets)
        throw new StoreError(`Requires module ${PROVIDER}`, "unprocessable");
      const result = await boardNets(params.linkId);
      if (!Value.Check(boardNetsSchema, result))
        throw new StoreError(
          `Module ${PROVIDER} returned invalid board nets`,
          "unprocessable",
        );
      return result;
    });
  },
};
