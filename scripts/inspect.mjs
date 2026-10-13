import fs from "node:fs";
import { register } from "tsx/esm/api";

const [file] = process.argv.slice(2);
if (!file) {
  console.error("usage: node scripts/inspect.mjs <doc.json|.rockett>");
  process.exit(1);
}

process.env.ROCKETT_COMMIT = "inspect";
register();
const server = (path) => import(`../server/src/${path}`);
const [
  { Placement, resolveDocumentParameters },
  { initKernel, kernelVersion, scoped, faces, edges, volumeOf, bboxOf },
  { engineFor, dropEngine },
  { bodyFingerprint },
  { documentMigrations, migrate, NO_BLOBS },
  { validateDocument },
] = await Promise.all([
  import("@rockett/shared"),
  ...[
    "geometry/kernel.ts",
    "geometry/engine.ts",
    "geometry/fingerprint.ts",
    "store/migrations.ts",
    "api/validate.ts",
  ].map(server),
]);

let doc;
try {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  doc = migrate(documentMigrations, parsed.document ?? parsed, {
    ...NO_BLOBS,
    show() {},
  });
  validateDocument(doc);
} catch (err) {
  console.error(`${file}: ${err.message}`);
  process.exit(1);
}

const num = (n) => (Number(n.toFixed(3)) || 0).toFixed(3);
const vec = (v) => v.map(num).join(",");

await initKernel();
const engine = engineFor(doc.id);
try {
  const evaluation = engine.evaluate(doc);
  const statusOf = new Map(
    evaluation.featureStatuses.map((s) => [s.featureId, s]),
  );
  doc.features.forEach((f, i) => {
    const s = statusOf.get(f.id);
    const notes = [
      s?.warning && `warning ${JSON.stringify(s.warning)}`,
      s?.error && `error ${JSON.stringify(s.error)}`,
    ].filter(Boolean);
    console.log(
      ["feature", i, f.id, f.type, s?.status ?? "-", ...notes].join(" "),
    );
  });
  const state = engine.stateAt(doc);
  const resolved = {
    ...doc,
    features: resolveDocumentParameters(doc).features,
  };
  const kernel = kernelVersion();
  for (const { bodyId, name } of evaluation.bodies) {
    const { shape } = state.bodies.get(bodyId);
    const { min, max } = bboxOf(shape);
    const [faceCount, edgeCount] = scoped(() => [
      faces(shape).length,
      edges(shape).length,
    ]);
    const fingerprint = bodyFingerprint({
      doc: resolved,
      bodyId,
      sources: new Map(),
      placement: Placement.identity(),
      selection: [],
      camVersion: "",
      kernel,
      evaluation,
    });
    console.log(
      [
        "body",
        bodyId,
        JSON.stringify(name),
        `volume ${num(volumeOf(shape))}`,
        `min ${vec(min)}`,
        `max ${vec(max)}`,
        `faces ${faceCount}`,
        `edges ${edgeCount}`,
        `fingerprint ${fingerprint}`,
      ].join(" "),
    );
  }
} finally {
  dropEngine(doc.id);
}
