import { refAt, refsAt, registerCoreSpec } from "../featureSpec.js";

registerCoreSpec("extrude", "Extrude", (f) => [
  ...refsAt("profile", "/profiles", f.profiles),
  ...refsAt("face", "/faces", f.faces),
  ...refsAt("body", "/targets", f.targets),
  ...(f.startObject ? [refAt("plane", "/startObject", f.startObject)] : []),
  ...(f.extent?.kind !== "toObject"
    ? []
    : f.extent.object.kind === "body"
      ? [refAt("body", "/extent/object/bodyId", f.extent.object.bodyId)]
      : [refAt("plane", "/extent/object", f.extent.object)]),
]);
