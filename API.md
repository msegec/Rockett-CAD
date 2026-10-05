# REST API

Base path `/api`, JSON unless noted. The route tables own method, path, body
schema, effect and the request and response types (the `route<Req, Res>`
generics):

- `ROUTES` and `AUTH_ROUTES` in `shared/src/routes.ts`;
- settings entries in `shared/src/settingsRoutes.ts`;
- tangent edges and reference signing in `shared/src/refRepairRoutes.ts`;
- `FRIEND_ROUTES` in `shared/src/friends.ts`, `NOTICE_ROUTES` in
  `shared/src/notices.ts`.

A route's `effect` is `document` for a document edit or `viewer` for a write
a view-only member may make; `DOCUMENT_EDITS` and `VIEWER_WRITES` in
`shared/src/routeContract.ts` read it, and route modules declare it the same
way.

Wire types live in `shared/src/api.ts` and `shared/src/model.ts`. The client
builds paths with `pathFor` and sends every call through `request` in
`client/src/api.ts`. Every `ROUTES` entry is registered with its method and
nothing else is: `server/src/api/routes.ts`.

## Routes

| Route                                                                             | Handler                            |
| --------------------------------------------------------------------------------- | ---------------------------------- |
| `GET /auth/status`, `POST /auth/setup`                                            | `server/src/auth/bootstrap.ts`     |
| `POST /auth/login`                                                                | `server/src/auth/routes.ts`        |
| `POST /auth/logout`, `GET /me`                                                    | `server/src/auth/routes.ts`        |
| `POST /me/password`                                                               | `server/src/auth/routes.ts`        |
| `POST /auth/totp`, `POST /me/totp`                                                | `server/src/auth/totpRoutes.ts`    |
| `POST /me/totp/confirm`, `DELETE /me/totp`                                        | `server/src/auth/totpRoutes.ts`    |
| `GET /users`, `POST /users`, `PATCH /users/:id`                                   | `server/src/auth/users.ts`         |
| `/me/friends` and below                                                           | `server/src/auth/friendRoutes.ts`  |
| `GET /me/notices`, `POST /me/notices/*/:id/open`                                  | `server/src/auth/friendRoutes.ts`  |
| `GET`, `PATCH /settings`                                                          | `server/src/api/settingsRoutes.ts` |
| `GET`, `PATCH /me/settings`, `POST /me/settings/import`                           | `server/src/api/settingsRoutes.ts` |
| `GET`, `PATCH /projects/:id/settings`                                             | `server/src/api/settingsRoutes.ts` |
| `GET /health`                                                                     | `server/src/api/systemRoutes.ts`   |
| `GET /formats`                                                                    | `server/src/api/systemRoutes.ts`   |
| `GET /modules`                                                                    | `server/src/api/routes.ts`         |
| `GET`, `POST /projects`                                                           | `server/src/api/projectRoutes.ts`  |
| `GET`, `DELETE /projects/:id`                                                     | `server/src/api/projectRoutes.ts`  |
| `POST /projects/:id/duplicate`, `/rename`                                         | `server/src/api/projectRoutes.ts`  |
| `GET`, `PUT /projects/:id/members`                                                | `server/src/api/projectMembers.ts` |
| `GET /projects/:id/file`, `POST /projects/file`                                   | `server/src/api/projectFile.ts`    |
| `POST /projects/import`, `/projects/:id/import`                                   | `server/src/api/importRoutes.ts`   |
| `PUT /projects/:id/parameters`                                                    | `server/src/api/documentRoutes.ts` |
| `POST /projects/:id/evaluate`                                                     | `server/src/api/geometryRoutes.ts` |
| `GET /projects/:id/meshes/:hash`                                                  | `server/src/api/meshRoute.ts`      |
| `GET /jobs/:jobId/events`, `DELETE /jobs/:jobId`                                  | `server/src/api/jobRoutes.ts`      |
| `POST /projects/:id/features`                                                     | `server/src/api/featureRoutes.ts`  |
| `PUT`, `DELETE /projects/:id/features/:fid`                                       | `server/src/api/featureRoutes.ts`  |
| `POST /projects/:id/features/:fid/project`, `/signature`                          | `server/src/api/featureRoutes.ts`  |
| `POST /projects/:id/timeline`                                                     | `server/src/api/featureRoutes.ts`  |
| `POST /projects/:id/undo`, `/redo`                                                | `server/src/api/previewRoutes.ts`  |
| `POST /projects/:id/previews/:tx/commit`, `DELETE /projects/:id/previews/:tx`     | `server/src/api/previewRoutes.ts`  |
| `GET /projects/:id/history`, `POST /projects/:id/checkpoints`, `/history/restore` | `server/src/api/historyRoutes.ts`  |
| `DELETE /projects/:id/checkpoints`                                                | `server/src/api/historyRoutes.ts`  |
| `PUT /projects/:id/bodies/:bodyId`                                                | `server/src/api/bodyRoutes.ts`     |
| `PUT /projects/:id/groups`                                                        | `server/src/api/bodyRoutes.ts`     |
| `POST /projects/:id/upgrade-naming`, `/commit`                                    | `server/src/api/documentRoutes.ts` |
| `POST /projects/:id/maintenance/gc`                                               | `server/src/api/documentRoutes.ts` |
| `GET`, `PUT /projects/:id/thumbnail`                                              | `server/src/api/documentRoutes.ts` |
| `GET`, `PUT /projects/:id/view`                                                   | `server/src/api/documentRoutes.ts` |
| `POST /projects/:id/tangent-edges`                                                | `server/src/api/geometryRoutes.ts` |
| `POST /projects/:id/size-limit`                                                   | `server/src/api/geometryRoutes.ts` |
| `POST /projects/:id/measure`                                                      | `server/src/api/measureRoutes.ts`  |
| `POST /projects/:id/export`                                                       | `server/src/api/geometryRoutes.ts` |
| `POST /projects/:id/assets`, `GET /projects/:id/assets/:assetId`                  | `server/src/api/geometryRoutes.ts` |
| `/folders` and below, `PUT /projects/:id/folder`                                  | `server/src/api/folderRoutes.ts`   |

## Errors

Project, folder, settings and job routes answer `ApiErrorBody`
(`shared/src/api.ts`). `STATUS` in `server/src/api/apiErrors.ts` fixes the
status for each `code`. `StoreError(message, code)` and `ValidationError`
(`shared/src/schema/validation.ts`) answer their own code and message; any
other throw is `internal`, 500 with a generic message, and the server log
gets the route, the error name and its first three stack frames, never the
message, the request or the document, because a message can carry user input. A 409 on a document edit carries the stored `revision`, and on a
preview commit also the staged `draft`. `client/src/api.ts` turns any error
into `ApiError`; a body without `code` becomes `internal`.

An unknown `/api` path answers 404 `not_found`, malformed JSON 400
`validation` and a body over its size limit 413 `too_large`.

These answer `{ "error": string }` without `code`: the origin check, the
session guard (401 `unauthenticated`), the 403 `forbidden` from the project
access guard, `requireAdmin` and the members routes, the rate limiter (429
`rate limited` with `Retry-After` in seconds), and the auth, user, friend and
notice routes.

## Identity

- A request that is not `GET`, `HEAD` or `OPTIONS` needs an `Origin` listed in
  `ROCKETT_ALLOWED_ORIGINS`, checked before the session:
  `server/src/auth/origin.ts`.
- `PUBLIC_ROUTES` in `server/src/auth/middleware.ts` need no session. Every
  other route needs a session cookie or, when `ROCKETT_CF_ACCESS_TEAM` and
  `ROCKETT_CF_ACCESS_AUD` are set, a verified `Cf-Access-Jwt-Assertion` whose
  email matches an active user: `server/src/auth/cfAccess.ts`.
- `GET /health` returns only `{ ok: true }` without a full signed-in identity.
  Build, schema and kernel diagnostics require that identity; health stays
  available to anonymous and step-session callers.
- Admins must use TOTP; members may opt in. A sign-in that needs a code or
  enrolment gets a step session limited to `STEP_ROUTES` in
  `server/src/auth/middleware.ts`.
- Sessions end after `auth.sessionDays` or `auth.sessionMaxDays` unused
  (`shared/src/settings.ts`): `server/src/auth/sessions.ts`.
- Login takes a username or an email in any case; both names share one
  failure limit: `server/src/auth/userStore.ts`, `server/src/auth/rateLimit.ts`.
- Password policy: `server/src/auth/password.ts`.
- A public `User` never carries a password hash or TOTP secret:
  `toPublicUser` in `server/src/auth/userStore.ts`.
- User routes and blob collection are admin only. Project members routes need
  the owner or an admin. Anyone without project access gets 404, not 403. A
  `view` member may only read, plus the `viewer` effect routes
  (`server/src/api/projectAccess.ts`).
- Folder members inherit their role on the folder's projects: `folderRole`
  in `server/src/api/projectAccess.ts`.

## Document revisions

A project's `ETag` is `"<revision>"`, equal to `document.revision`; every
save raises it by one. Every `document` effect route, route module mutations
included, needs `If-Match: "<revision>"`, checked inside the project
queue: missing is 428, malformed is 400, stale is 409, and none writes:
`server/src/api/revision.ts`. Other writes (view, thumbnail, checkpoints,
folders, members, settings, assets, export `retain`) take no revision.
Project deletion also requires the revision shown in the project list; a stale
request leaves the project intact. Unreadable projects list a `deleteTag`, a
quoted SHA256 of the stored document bytes. An unreadable manifest also binds
its stored bytes into the tag; only an admin may delete such a project. Deletion
needs that exact tag and refuses changed or now-readable contents. Storage
failures refuse listing and deletion. Temporary cleanup needs no revision.

## History

Every document edit except a project rename saves the document and one
labelled undo entry together. An edit that fails before its document file
lands writes nothing. One that fails after it lands keeps the edit and its
entry and answers 500 `kept`, never `internal`; the client then reloads the
project, so the edit shows and Undo names it:
`server/src/api/projectMutations.ts`, `client/src/store.ts`. Edits sharing an
`X-Rockett-Tx` (`TX_HEADER`) fold into the latest entry. Undo, redo and
restore are document edits; nothing to undo or redo is 409:
`server/src/store/historyStore.ts`. Entries and checkpoints carry `by`, the
signed-in user's id; the history list and a new checkpoint add `byName`. Both
are absent on older entries. Checkpoints keep their snapshots and blobs:
`server/src/store/blobGc.ts`. Checkpoints have a bound far above real use (see
Limits); one more is 409 with a plain message and keeps the rest.
`DELETE /projects/:id/checkpoints` with a listed checkpoint's `label`, `at` and
`snapshot` removes it and rewrites the log without snapshots nothing else
holds, so blobs nothing else references become collectable; an unknown
checkpoint is 404.

The log stores each feature once, keyed by the SHA256 of its JSON, and each
snapshot as the document with its features replaced by those keys:
`server/src/store/historyLog.ts`. A snapshot's hash is the SHA256 of that
form. Entries have no count limit. A project's log has a disk byte budget
(see Limits). Past it, the log drops its oldest entries until it fits in
what checkpoints, the current state and redo entries take, plus half the rest
of the budget. Those always stay, and so does one undo step while the log
still fits the budget. A version 2 log, one whole gzipped document per
snapshot, is backed up as `history2-<hash>` and rewritten on first open:
`server/src/store/historyUpgrade.ts`. A snapshot it cannot read is dropped
with its checkpoints, and undo steps over the gap; with none readable, history
starts again at the next edit. Snapshot hashes change then; a restore naming
an old hash is 404.

A feature add or edit with `X-Rockett-Preview` (`PREVIEW_HEADER`) and
`X-Rockett-Tx` stages the edit in memory for that user and session instead of
saving it. Only the preview commit route saves it. A restart drops open
previews: `Previews` in `server/src/store/historyStore.ts`.

Parameter and expression associations update together through
`PUT /projects/:id/parameters` with `parameters` and `parameterBindings`.
The document revision header is required; feature preview transaction headers
also apply. Successful edits regenerate dependent geometry and create one history
entry. Invalid names, cycles, numeric bounds or conflicting dimensions refuse the
edit before saving. Project files, history and reopen preserve associations.
`PUT /projects/:id/features/:fid` may also carry the whole `parameterBindings`
list, so a sketch edit that renumbers its constraints saves the moved bindings
in the same edit.

## Evaluation

- Evaluate answers `EvaluateResult` and mutations `MutationResponse`
  (`shared/src/routes.ts`). Each `BodyPayload` carries `bodyId`, `name`,
  `color`, `meshKey`, `bbox` and `mesh`, the hash and byte size of its
  mesh, never the mesh itself. A B-Rep body with at least 1,024 triangles
  whose mesh at 12 times the viewport deflection has at most half of them
  also carries `coarse`, that level's hash and byte size; the mesh route
  serves both. The client
  fetches each hash from the mesh route once: `client/src/three/meshes.ts`.
- `BodyPayload.color` is the body's stored `bodyMeta` colour, else the
  `#rrggbb` a STEP file gave it, kept per body id through later features
  (`EvalState.imported`).
- `PUT /projects/:id/bodies/:bodyId` sends exactly one of `name` or `color`,
  each its own undo step. `color` is lowercase `#rrggbb`, or `null` to clear
  it. Anything else, an unknown key included, is a 400; a body id that is not
  an own key of `bodyMeta` is a 404.
- A STEP `importStep` status carries `importTree`: each assembly and part
  instance with its name, its `path` of child indices from the file's roots
  and, for a part, the body ids its solids became. It is derived on every
  evaluation and never stored. The model tree nests each component's bodies
  under it by body id, so a renamed body keeps its place, a body in a user
  group shows only in the group, a body a later feature removed drops out and
  a component left empty is hidden: `client/src/importTree.ts`.
- Stored sketch points are the model. A feature add or edit solves a sketch
  once when it adds or changes a constraint its points do not meet, and
  otherwise stores the points as sent. Evaluation re-solves a sketch only when
  a projected source moves: `editedEntities` in `shared/src/solver.ts`.
- `?position=N` evaluates the first N features without moving the saved
  marker: `evaluationPosition` in `server/src/api/routes.ts`.
- The mesh route sends a `shared/src/meshFormat.ts` mesh for a hash in the
  project's current evaluation, or among its latest 4096 preview and
  rolled-back hashes while cached in memory or on disk; any other hash is a
  404: `server/src/kernel/meshCache.ts`.
- JSON responses from `GZIP_FROM_BYTES` up are gzipped when accepted:
  `server/src/api/gzipJson.ts`.
- Requests for one project run in order; projects run independently:
  `server/src/store/projectQueue.ts`. The queue does not lock across
  processes, so run one server per data directory.

### Kernel jobs

A request may send `Rockett-Job: <UUID v4>` to follow its kernel work at the
job events route (`text/event-stream`) or cancel it. Jobs belong to the
submitting user and project; anyone else gets 404. A job fails with a plain
`message` on its `failed` event when no feature finishes within `jobStall`,
or when it runs past `jobCeiling` (`server/src/tunables.ts`); both cancel it.
A retry resumes from the snapshots that cancel kept, unless the worker was
restarted. A worker that misses the cancel watchdog is restarted and
in-flight kernel requests get 503 `kernel`:
`server/src/kernel/jobs.ts`, `server/src/kernel/workerKernel.ts`.

## Naming upgrade

Stage and commit move a `namingVersion` 1 project to 2; nothing else changes
the naming version. Both back up the project first and name the backup. The
commit needs `If-Match` and is 409 while a `candidate` or `ambiguous` mapping
has no choice. A project already on version 2 is 409. Stage gives each
candidate and suggestion a `mesh` from the version 2 evaluation at its
mapping's position: a face or body index range, or an edge polyline, with the
body's `bbox`, so the client finds it in the version 1 mesh it shows. Stage
also lists `failures`: each feature that errors under either version, with
that version, its message and any unresolved refs. The commit is 422 while a
feature fails under version 2 and not under version 1. Both refuse when the
engine's kernel is not initialised. Types: `NamingUpgradeProposal`,
`NamingMapping`, `NamingFailure` and `NamingDecision` in `shared/src/api.ts`.
Code: `server/src/store/namingUpgrade.ts`. Model rules:
[CAD_MODEL.md](CAD_MODEL.md), Naming upgrade.

## View state

Each user has their own view of a project (`projectView` in
`shared/src/routes.ts`), with its own `ETag`; a stale `If-Match` is 409.
Saving a view never edits the document, evaluates or raises the revision.
Visibility lives only in the view: a document edit carrying `visible` is 400.
Code: `server/src/store/viewStore.ts`. A temporary project's views stay in
server memory, never on disk, and go when it is removed
(`server/src/store/projectStore.ts`). A server restart drops them: the view
reads as empty, and a view PUT for that user skips the `If-Match` check, so
the browser's next view change or reopen sends the record's view back.

## Settings layers

App, user and project layers are sparse; clients resolve defaults with
`resolveSettings` (`shared/src/settings.ts`). `PATCH` needs the layer `ETag`
in `If-Match`. App writes need an admin; project layers use project access:
`server/src/api/settingsRoutes.ts`. Import keeps unknown keys that match the
key grammar, so removed plugin values survive:
`server/src/store/settingsStore.ts`.

## Inspection & output

- `format` must name a registered exporter; `GET /formats` lists the exporter
  and importer registries.
- Export refuses a body blocked by an unresolved reference (`namingVersion` 2)
  with 422 `unprocessable`, and an id that is not a body with 400.
  Measure answers 400 for a body or name the live evaluation lacks.
- Measure takes face and body refs, up to `MEASURE_MAX_REFS`
  (`shared/src/api.ts`), and edge or vertex refs only when it has at most two
  refs; either breach answers 400 saying so. `items` holds one entry per ref,
  in request order: faces carry exact area and bodies exact volume
  (`BRepGProp`). Distance and angle come only for exactly two refs. A
  duplicate ref is resolved once per request.
- Writers: `server/src/geometry/exporters.ts`, `server/src/geometry/xde.ts`
  (STEP and GLB), `server/src/geometry/dxf.ts`.

## Extension points

- `registerRouteModule` (`server/src/api/routeModules.ts`) mounts project
  routes behind the access guard and project queue. `projectMutation` needs
  `If-Match`. A non-core module id `<moduleId>.<name>` must mount under
  `/projects/:id/m/<moduleId>/`, or mounting throws. Its `userRoute` mounts
  under `/m/<moduleId>/` for the signed-in user; one with an `effect` or an
  `:id` parameter throws. A route refuses with
  `throw new StoreError(reason, "unprocessable")`, which the plugin API
  exports: 422 with the one-line reason.
- `registerExporter` (`server/src/geometry/exporters.ts`) and
  `registerImporter` (`server/src/api/importers.ts`) return a disposer.
- Document `extensions` (`shared/src/model.ts`) survive upload, edits and
  reload. Blob collection skips a project that holds them:
  `server/src/store/blobGc.ts`.

## Modules

`GET /modules` returns one `ModuleInfo` (`shared/src/api.ts`) per listed
module, in load order:

```json
[
  {
    "id": "acme",
    "name": "Acme",
    "version": "1.2.3",
    "licence": "MIT",
    "author": "Acme Ltd",
    "status": "loaded",
    "error": null
  }
]
```

- `status` is `loaded`, `failed`, `incompatible` or `disabled`.
- `error` is null for `loaded` and `disabled`. Otherwise it is the manifest
  error, the thrown registration or activation message, or the plugin API
  range reason.
- `disabled` means the app setting `plugin.<moduleId>.enabled` is `false`.
  Only an admin can set it (`PATCH /settings`). The host reads it at startup,
  so a change applies on the next start.
- The user setting `plugin.<moduleId>.hidden` (`PATCH /me/settings`) hides
  the module's client UI for that user only. Its status stays `loaded`.
- Keys ending in `.enabled` or `.hidden` belong to the host; a manifest that
  lists one in `contributes.settings` fails `parseManifest`.
- `server/src/modules/host.ts` loads every module before the router mounts
  route modules. A module that throws during activation keeps none of its
  registrations; the others still load.
- A manifest that fails `parseManifest` reports `failed` with whichever of
  its identity fields are strings; the rest are empty.
- `activate` receives `ServerContext` (`plugin-api/src/index.ts`):
  `register`, `startKernelJob`, `userData`, `files`, `kernelVersion` and
  `bodies`. `register.routeModule`, `kernelJob` and `setting` take
  `plugin-api` types; `exporter`, `importer`, `featureKind` and
  `extensionSpec` take core types. Each call is tracked under one disposer.
- `register.setting(definition)` takes a `SettingDefinition` whose key
  starts with `plugin.<moduleId>.`, is listed in `contributes.settings` and
  is not a host key, or the load fails naming the key. Settings routes then
  validate its values with its schema. The client part registers the same
  definition, so the Settings panel draws it under the module's section.
- Route callbacks receive typed `params`, `body` and the signed-in `user`.
  Project reads get `blobs.get(hash)`; mutations also get `blobs.put(bytes)`.
  Reads copy bytes, writes snapshot them and return their SHA-256 hash.
  Both bind to the authorised project, without an id argument or delete.
  Access, `If-Match`, the project queue and import byte budget precede put.
  Invalid hashes and corrupt bytes refuse through the existing blob store.
  API 0.8.0 adds mutation-only `assets.set(hashes)`: replace the calling
  manifest's exact namespace references with a detached array of hashes.
  The host preserves opaque asset metadata; only this capability declares refs.
  Bounded, unique hashes must resolve here before document or history commit.
  `moduleAssets.namespaces` owns portable references; opaque extension JSON
  stays unchanged. Sources survive save, undo, reopen, duplicate and `.rockett`
  export/import without a feature, even with the module disabled or absent.
  Blob collection keeps its conservative extension-data refusal.
  User routes get neither capability and take no user id from the request.
  `kernel` exists at runtime but only the core `ModuleApi` declares it.
- `register.kernelJob(id, entry)` registers a kernel job: `id` starts with
  the module id and a dot, and `entry` is the URL of a file whose default
  export, from `defineKernelJobs`, holds the job under that id.
- `userData(name, version)` gives the module a per-user store at
  `users/<userId>/modules/<moduleId>/<name>.json`, holding
  `{ version, data }`. `name` follows the store id rule, or activation
  fails. `read(user)` returns `{ version, data, etag, readOnly }` or null.
  `write(user, data, etag)` needs the etag it read, or null for none yet,
  and runs in the store's write queue: a stale etag is 409 `conflict`, a
  file over the cap 413 `too_large`, and neither writes. Data saved at a
  higher `version` than the module passes reads as `readOnly`, and a write
  over it is 409. Code: `server/src/store/moduleData.ts`.
- `files` is the module's own folder, `modules/<moduleId>/` under the data
  folder, beside and never inside any user's folder. `read(name)` returns
  the bytes or null, `write(name, data)` writes atomically, `remove(name)`
  deletes, and `list()` returns every file's name relative to the folder.
  A name that is absolute, empty or holds `..` is refused before any read
  or write. Code: `server/src/modules/files.ts`.
- `kernelVersion` is the `{ occt, commit }` the running kernel reports, the
  value `bodyFingerprint` hashes, or null while the kernel starts. The
  naming version is the document's `namingVersion`, already in each body
  fingerprint.
- `bodies(projectId, user)` reads the stored document under the same access
  rule as a project route. A user without view access and a missing project
  get the same `not_found` rejection, "project not found", which a route
  answers as 404. It returns
  `{ id, name, bbox, brep, faceNames, fingerprint, problems }` for each body
  at the end of the timeline, whatever the Design rollback, in model
  millimetres. `brep` is the OCCT BREP text of the body. `faceNames` holds
  one regen face name per face, in the order `TopExp_Explorer` visits the
  faces of the shape read back from `brep`, so a kernel job resolves a
  `FaceRef` by taking the face at the index of its `faceName`. A face the
  name map does not cover holds `""`. A face the explorer visits twice
  appears at both indexes, and a repeated name resolves to its first index,
  as core resolves it. A `~?` name never resolves as a `FaceRef`.
  `fingerprint` is `bodyFingerprint` (CAM-003) over the resolved features
  the body depends on, with identity placement, no selection and an empty
  CAM version. The rule errs toward stale. Walking back from the end, a
  feature is left out only when its type is a core type, it evaluated `ok`,
  and its reach is known and meets no body or feature already counted. Its
  reach is the bodies it names, targets, modifies or made, and a sketch or
  plane or reference image also reaches itself. A split piece `X:n` also
  counts `X`. Every other feature counts, including one that failed, was
  cancelled or warned, and a geometry feature with no known reach. An
  extension type, or a geometry feature with no known reach, makes every
  earlier feature count.
  A counted face extrude, face revolve or Move makes every earlier sketch
  count, since each reads all sketches, and a Move counts when a counted
  sketch is earlier than it. An edit to another body leaves the fingerprint
  unchanged, unless a counted feature also reaches that body. `problems`
  lists the evaluate status of each counted feature that failed, was
  cancelled or has unresolved references, empty when there are none. A
  failed or cancelled feature counts for every body, so it is in every
  body's `problems`. A failed feature leaves the body as it was before
  that feature, so a body with problems is not the model as designed.
  Nothing is cached: each call evaluates, writes BREP for every body, reads
  its face names from the evaluated name map and hashes the import
  sources. Code: `server/src/modules/bodies.ts`.
- `startKernelJob(id, input, { onProgress, signal })` runs one of the
  module's own jobs in the kernel worker and resolves to its result. A job is
  synchronous; one that returns a promise is refused. The job
  receives the OCCT instance, `own` for every handle it makes and
  `progress(done, total, label)`. Its handles are freed when it returns,
  throws or is cancelled; an aborted signal cancels it at its next
  `progress` call. A job's thrown error keeps its `name` and message across
  the worker, so a module can tell its own refusals from failures.
- After sign-in, `client/src/modules/host.ts` activates the client part of
  each listed module that this route reports `loaded`, with `ClientContext`:
  `register`, `project`, `ui`, `settings` and `request`. `register.command`,
  `toolbarGroup`, `panel`, `workbench`, `layer`, `setting` and
  `settingsPage` take `plugin-api` types; `selectionKind` and `pickProvider`
  take core types. Activation is atomic as on the server. A command
  `Control`, a workbench `tree` and `bar` and a settings page draw inside the
  panel error boundary.
- `register.settingsPage({ id, title, component })` lists a page with id
  `<moduleId>.<name>` under the module's Settings section, with the title
  above `component`. `ui.openSettings(page)` opens Settings at that page.
- `settings.get(key)` returns the resolved value of one of the module's own
  settings, `settings.set(key, value)` writes it to the narrowest layer its
  `scopes` allow that this user can write, and
  `settings.subscribe(key, listener)` calls the listener with each new value
  and returns its disposer, removed with the module. The key must start with
  `plugin.<moduleId>.`, must not be a host key and must be in
  `contributes.settings`; any other key throws, and `set` rejects, naming
  the key. There is no server-side access.
- A workbench's optional `tree` draws in the left dock and `bar` in the
  timeline row, in place of the model tree and timeline. The view toolbar
  group shows at the right end of every workbench.
- `project.get()` returns `{projectId, document, bodies}` for the open
  project, the same object until the project, document or evaluation
  changes. `bodies` lists `{id, name, bbox}` for each body of the current
  evaluation, in model millimetres. `project.subscribe(listener)` calls the
  listener on each change and returns its disposer. Both fit
  `useSyncExternalStore`.
- `project.mutate(route, body)` sends a document-edit route of the open
  project through the same write queue, transaction id and `If-Match` as a
  core edit, and applies the returned document and history. A route that is
  not a document edit, or no open project, rejects.
- `project.read(route, params)` GETs a project route of the open project,
  filling `:id` with its id and the other path parameters from `params`,
  and resolves the route's typed JSON response. A route that is not GET, a
  path parameter of `.` or `..`, or no open project, rejects before a
  request goes out. A reply that lands after the open project changed
  rejects.
- `ui` passes the core `DraggablePanel`, `DialogFooter`, `NumField`,
  `LengthField`, `AngleField`, `SelectField`, `CheckField`, `TextField`,
  `TextAreaField` and `ContextMenu`, so a module dialog uses the KIT fields
  and a module right-click menu is the core menu. `LengthField`
  takes millimetres and shows the user's length unit. `ui.openPanel(id)`
  and `ui.closePanel(id)` open and close a core panel.
- A number field's `value` may be `undefined`, which shows a blank box.
  With `onClear`, clearing the box calls it, so the module can store
  `undefined`; without it, a blank box shows "Enter a value" and calls
  nothing.
- `TextAreaField` takes `label`, `value`, `onChange`, a `maxLength` in
  characters, and optional `rows` (3) and `disabled`. Line breaks arrive
  as LF, because browsers normalise CRLF in a textarea. An edit past
  `maxLength` keeps the existing text and as much of the new text as fits,
  puts the caret after the kept insertion and shows
  `Cut to the <maxLength> character limit`. The alert clears on the next
  edit that fits or when the module changes `value`. An IME composition is
  cut when it ends.
- `ui.confirm(message)` asks through the core Confirm panel and resolves
  true on OK, false on Cancel or Escape. A newer confirm answers the open
  one false.
- `ui.download({ fileName, data, type })` saves `data` as a file named
  `fileName` of MIME `type` through the core download.
- `ui.pickFile({ accept, maxBytes })` opens the browser file picker for
  `accept` and resolves `{ name, text }`, or `null` on Cancel. A file over
  `maxBytes` rejects before it is read, stating the limit exactly: "This
  file is over the 2 KB file limit." or "over the 1000 B file limit."
  `maxBytes` is capped at `MODULE_DATA_MAX_BYTES`, 8 MB, the module user
  data limit; a `maxBytes` of 0, below 0 or NaN rejects.
- Where the browser lacks the file input `cancel` event, a cancelled pick
  never settles.
- `request(method, path, body?)` calls the module's own user routes under
  `/m/<moduleId>/`, with the dots of the id as slashes: `rockett.cam`
  sending `"tools"` reaches `/m/rockett/cam/tools`. It goes through the core
  client request, so the API prefix, JSON body, `ApiError` rejections and
  sign-out on 401 match core calls. `path` is one or more segments of
  letters, digits, `-` and `_` joined by single slashes; anything else,
  such as `..`, a leading slash, a URL, `%`, `?` or `#`, rejects before a
  request goes out. Project routes are not reachable: a read goes through
  `project.read` and a document edit through `project.mutate`. A user-data
  etag travels in the JSON body, as `userData` reads and writes it.

## Project file

A `.rockett` file is `ProjectFile` in `shared/src/projectFile.ts`. Upload migrates
an older schema, validates, and rejects a newer `version` or `schemaVersion`
with 400; any failure creates nothing: `server/src/api/projectFile.ts`. A
stored project with a newer schema is listed as `tooNew`, and an invalid one
is 422 on load: `server/src/store/projectStore.ts`, which also owns temporary
projects.

Version 2 adds an optional `view`, the `PUT /projects/:id/view` body.
Download writes the requesting user's view; upload stores it as the
uploader's, and a browser project keeps it in its record. A `view` that fails
that schema is 400 like a bad document. A file without one, such as any
version 1 file, takes its view from the document's old visibility flags as
before. Duplicate copies only the requesting user's view.

Imports and project files stream to disk under `uploads/`. A file over the
import budget is 413 before it is read: `server/src/api/uploads.ts`. Imported
STEP and mesh sources live in the project blob store; the feature holds the
hash in `blob`, and `GET /projects/:id/assets/:assetId` serves any project
blob, so a `.rockett` file and a browser project carry them as assets. A 3MF
source keeps only its content types, relationship and model parts;
thumbnails, slicer settings and other parts are dropped before storing. Model
parts whose declared sizes pass the 3MF package limit are 413. A package is
400 when its parts overlap, run past the zip directory, or would rebuild
larger than the upload: `slim3mf` in `server/src/geometry/read3mf.ts`. A
package that understates its expanded sizes fails as 400 at evaluation.

## Validation

- A route with a `body` schema parses it before the handler; a mismatch is
  400 with the failing JSON Pointer in `detail`: `parseBody` in
  `server/src/api/routes.ts`.
- Features are checked by `validateFeature` in `server/src/api/validate.ts`
  through their registered `FeatureSpec` (`shared/src/featureSpec.ts`); an
  unregistered type is 400 `unknown feature type <type>`. Core schemas and
  `documentSchema` live in `shared/src/schema/features.ts`.
  `registerExtensionSpec` builds a dotted type's spec from its `params`
  schema and `version`; a feature at another version is 400.
- Feature add and update fill a missing reference `sig` from the model
  (`server/src/geometry/signature.ts`). They also write `targets`, leaving
  out bodies the caller's view hides: `server/src/api/routes.ts`. See
  [CAD_MODEL.md](CAD_MODEL.md), Tool targets.
- A validation failure writes nothing.

## Limits

| Limit                                 | Owner                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------- |
| JSON request body                     | `JSON_BODY_LIMIT_BYTES`, `server/src/api/uploads.ts`                                |
| Import and project file upload, disk  | `ROCKETT_UPLOAD_MAX_MB`, `IMPORT_LIMITS` in `server/src/tunables.ts`                |
| Import and project file read, heap    | `ROCKETT_IMPORT_BUDGET_MB`, `IMPORT_LIMITS` in `server/src/tunables.ts`             |
| Mesh import triangles                 | `MAX_MESH_TRIANGLES`, `server/src/geometry/importers.ts`                            |
| 3MF expanded package                  | `MAX_3MF_EXPANDED`, `server/src/geometry/read3mf.ts`                                |
| 3MF component placements              | `MAX_3MF_COMPONENTS`, `server/src/geometry/read3mf.ts`                              |
| Browser project file                  | `PROJECT_FILE_LIMIT_MB`, `shared/src/projectFile.ts`                                |
| Thumbnail                             | `THUMBNAIL_LIMITS`, `shared/src/routes.ts`                                          |
| Reference image                       | `IMAGE_LIMIT_MB`, `server/src/store/projectStore.ts`                                |
| History labels                        | `LABEL_LIMIT`, `shared/src/schema/history.ts`                                       |
| History disk bytes, checkpoints       | `HISTORY_LIMITS.bytes`, `HISTORY_LIMITS.checkpoints`, `server/src/tunables.ts`      |
| Tool targets                          | `MAX_TARGETS`, `shared/src/schema/features.ts`                                      |
| Previews, jobs, timeouts, size search | `server/src/tunables.ts`                                                            |
| Settings import                       | `SETTINGS_IMPORT_MAX_BYTES`; nodes and depth in `server/src/store/settingsStore.ts` |
| Module user data file and file pick   | `MODULE_DATA_MAX_BYTES`, `shared/src/units.ts`                                      |
