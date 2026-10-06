import { Type, type Static } from "typebox";
import { featureNameSchema } from "./schema/coreFeatures.js";
import { documentSchema } from "./schema/documents.js";
import { featureIdSchema } from "./schema/refs.js";
import { parse, ValidationError } from "./schema/validation.js";
import { placementSchema } from "./placement.js";

export const ASSEMBLY_SCHEMA_VERSION = 1;

const { revision, savedWith, extensions } = documentSchema.properties;
const id = featureIdSchema;
const documentId = featureIdSchema;

const componentRefSchema = Type.Object({
  documentId,
  acknowledgedRevision: revision,
});

const instanceSchema = Type.Object({
  id,
  name: featureNameSchema,
  documentId,
  placement: placementSchema,
  grounded: Type.Boolean(),
});

const assemblySchema = Type.Object({
  schemaVersion: Type.Literal(ASSEMBLY_SCHEMA_VERSION),
  revision,
  savedWith,
  id,
  components: Type.Array(componentRefSchema),
  instances: Type.Array(instanceSchema),
  joints: Type.Tuple([]),
  extensions,
});

export type ComponentRef = Static<typeof componentRefSchema>;
export type Instance = Static<typeof instanceSchema>;
export type AssemblyDocument = Static<typeof assemblySchema>;

const reject = (path: string, message: string): never => {
  throw new ValidationError(
    `assembly${path.replaceAll("/", ".")} ${message}`,
    path,
  );
};

export function validateAssembly(value: unknown): AssemblyDocument {
  const doc = parse(assemblySchema, value, "assembly");
  const listed = new Set<string>();
  doc.components.forEach((component, i) => {
    const path = `/components/${i}/documentId`;
    if (component.documentId === doc.id)
      reject(path, "references the assembly itself");
    if (listed.has(component.documentId))
      reject(path, `repeats component ${component.documentId}`);
    listed.add(component.documentId);
  });
  const ids = new Set<string>();
  doc.instances.forEach((instance, i) => {
    if (ids.has(instance.id))
      reject(`/instances/${i}/id`, `repeats instance id ${instance.id}`);
    ids.add(instance.id);
    if (!listed.has(instance.documentId))
      reject(
        `/instances/${i}/documentId`,
        `names unlisted component ${instance.documentId}`,
      );
  });
  return doc;
}
