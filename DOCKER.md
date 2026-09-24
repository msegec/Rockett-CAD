# Docker deployment

Rockett CAD ships as a single container: Node 24 serving the API and the
built client, with the OpenCascade kernel embedded as WebAssembly (no native
dependencies). All persistent state lives under **one volume: `/data`**.

## Compose

```bash
ROCKETT_ALLOWED_ORIGINS=https://cad.example.com \
ROCKETT_COMMIT=$(git rev-parse HEAD) \
ROCKETT_DESCRIBE=$(git describe --tags --always --dirty) \
  docker compose up -d --build
# → http://127.0.0.1:8788
```

`docker-compose.yml` builds the image locally and keeps `/data` in a named
volume. It publishes on `127.0.0.1` unless `ROCKETT_BIND` says otherwise;
the header of the file lists every variable. The server will not start
without `ROCKETT_ALLOWED_ORIGINS`; set it to the origin you browse to.

### Several instances on one host

`-p` names the instance, so containers, volumes and data stay separate. Both
instances run `rockett-cad:<tag>` images from the same engine.

Prod never builds. Dev builds one image, tagged with the short SHA of the
commit it bakes in, and prod runs that image once dev has verified it.

```bash
# dev: build and run the image from a clean checkout
COMMIT=$(git rev-parse HEAD)
REV=$(git rev-parse --short "$COMMIT")
git diff --quiet HEAD &&
ROCKETT_ALLOWED_ORIGINS="$DEV_ORIGIN" \
ROCKETT_BIND="$BIND_ADDRESS" ROCKETT_HOST_PORT="$DEV_PORT" ROCKETT_TAG=$REV \
ROCKETT_COMMIT=$COMMIT ROCKETT_DESCRIBE=$(git describe --tags --always --dirty) \
  docker compose -p rockett-cad-dev up -d --build

# prod: promote the image dev verified
docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
  rockett-cad:$REV
ROCKETT_ALLOWED_ORIGINS="$PROD_ORIGIN" \
ROCKETT_BIND="$BIND_ADDRESS" ROCKETT_TAG=$REV \
  docker compose -p rockett-cad-prod up -d --no-build
```

`git diff --quiet HEAD` refuses a tree that `describe` would mark `-dirty`,
so the tag, the image revision label and `/api/health` all name `COMMIT`.
`REV` uses the same abbreviation as `describe`, so the corner label
`v0.1.0-4-g1a2b3c4` runs as `rockett-cad:1a2b3c4`; on a tagged commit the
label shows the tag and its tooltip the commit. Before promoting,
`docker image inspect` must print `COMMIT`. If prod uses another engine, move
the image there with `docker save` and `docker load`; do not rebuild it.

Supply deployment values through your shell outside this repository. Never
commit environment files, host addresses, deployment ports or operational data.

Roll prod back by rerunning the prod command with the previous `REV`; keep
that image until the new one is trusted. Confirm what is running with
`curl http://<host>:<port>/api/health`, whose `commit` must match the intended
revision. The UI shows the same build in its bottom-right corner: `describe`
when set, else the version and short commit, else `dev`.

Back up an instance's data with
`docker compose -p rockett-cad-prod exec -T rockett-cad tar czf - -C /data . > rockett-prod.tgz`

## Manual

```bash
docker build -t rockett-cad:latest \
  --build-arg ROCKETT_COMMIT=$(git rev-parse HEAD) \
  --build-arg ROCKETT_DESCRIBE=$(git describe --tags --always --dirty) .
docker run -d --name rockett-cad \
  -p 8788:8788 \
  -e ROCKETT_ALLOWED_ORIGINS=https://cad.example.com \
  -v /path/to/appdata/rockett-cad:/data \
  --restart unless-stopped \
  rockett-cad:latest
```

## Unraid

1. Build the image on the server (or push it to a registry you control):
   `docker build -t rockett-cad:latest .`
2. Copy `docker/unraid-rockett-cad.xml` to
   `/boot/config/plugins/dockerMan/templates-user/` on the Unraid box.
3. Add the container from the template. Defaults: WebUI port `8788`, data path
   `/mnt/user/appdata/rockett-cad`. Add the `ROCKETT_ALLOWED_ORIGINS`
   variable; the template does not carry it yet.

## Persistent layout (`/data`)

```
/data
├── backups/
│   └── projects/{projectId}/
│       ├── v{schema}-{hash}/   # the project as it was before a migration
│       │   ├── SHA256SUMS      # written last; the backup is complete once it exists
│       │   └── files/          # byte-for-byte copy of the project directory
│       └── tx-{hash}/          # present only while a history write runs: the files it replaces
├── folders/
│   └── folders.json        # the shared folder tree and project placement
├── uploads/                # model imports while they stream in; each is removed when its request ends
└── projects/
    └── {projectId}/
        ├── project.json    # the manifest: its version and documents, each an id and a type
        ├── documents/
        │   └── {projectId}.json  # the part document (full history)
        ├── view.json       # hidden bodies and features, outside the document
        ├── temporary.json  # present only on a temporary copy of a browser project
        ├── blobs/          # reference images and STEP, IGES and BREP sources, each named by its sha256
        ├── history/        # undo history: log.json and snapshots/ (gzip documents named by sha256)
        └── exports/        # server-retained exports (opt-in per export)
```

A project saved by an older schema, or in the layout from before the manifest
with its document in `document.json`, is migrated on disk by its next save.
That migration moves the document to `documents/{projectId}.json` and writes
the manifest, which lists the part under the project id. `part` is the only document type; a manifest
naming another type lists the project as invalid and is never rewritten.
Before that write, the whole project directory is copied to `backups/`, named
by the old schema and a hash of its contents, so a second migration of
different contents never overwrites the first backup. The backup holds the
project exactly as it was: files a migration adds, such as blobs moved out of
the document, a first `view.json`, the manifest or the moved document, are
written after it. A project from before schema 9 keeps its reference images in `assets/`; the migration copies
them into `blobs/`, and `assets/` is removed only after the backup reads back
intact and the migrated document is written. While the migration runs,
`backups/projects/{projectId}/migrating.json` records the backup and the files
the migration adds, with their sha256. At startup, and before the next save, a
project with that record loses each added file that still holds what the
migration wrote, and is restored from its backup, so a retry reuses the same
backup and a view saved in between survives. Startup also logs how many
projects still predate the current schema or the manifest. A temporary
project, the server copy of a project kept in the browser, is never backed up
before migration; the server deletes it after 24 hours without a request.
Backups are never pruned.

A history write replaces the document and `history/log.json` and adds a
snapshot. It first copies the files it replaces to `tx-{hash}/` and lists
that copy and the files it adds in `migrating.json`, then writes the new files
together, so startup, or the next write, restores the previous generation
after a failure, as for a migration. The copy and a backups
directory holding nothing else are removed once the write ends. The log keeps
the 50 most recent entries, the state before the oldest of them and every
checkpoint; a snapshot none of them names is deleted on the next history
write. To
restore one by hand, stop the container, run `sha256sum -c ../SHA256SUMS`
inside its `files/` directory, and replace the project directory with a copy
of `files/`. Copying over it would keep a later `documents/{projectId}.json`,
which is read in preference to a restored `document.json`.
Any other namespace under `/data`, such as `folders/`, follows the same rule
when its format changes: its directory is backed up to
`backups/<namespace>/v{version}-{hash}/` and restored the same way.

Every project is validated when it is opened. One that fails, or one saved by
a newer schema, stays in the project list with its reason and is never
rewritten; opening an invalid one is refused with its first failure.

Documents, blobs and retained exports are written atomically (temp file,
fsync, rename, directory fsync), so a crash or container kill never corrupts a
project. **The container is
stateless outside `/data`**. Recreating it (upgrades, host moves) loses
nothing; this is verified by the persistence tests and was smoke-tested against
a live container.

### Naming report

`node scripts/naming-report.mjs <copy>` lists which projects in a copy of
`/data` still use naming version 1. Run it from a checkout after `npm ci`,
since it loads the server source through `tsx`. It prints each project's id
and `namingVersion`, and under a version 1 project one line per mapping the
naming upgrade would stage (see [API.md](API.md), Naming upgrade): feature id
or `-`, path, status, the old body and name, then `->` the proven target,
`candidates` and `suggestions`. A project that fails to load prints its
status and reason. It skips temporary projects, as the project list does. It
never writes: it takes no backup, and its file access refuses every write. It
exits 0 when every project is on version 2, and 1 otherwise.

## Environment

| Variable                  | Default  | Purpose                                                                                                         |
| ------------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `ROCKETT_ALLOWED_ORIGINS` | required | Comma-separated bare origins, such as `https://cad.example.com`; writes to `/api` from any other origin get 403 |
| `ROCKETT_PORT`            | `8788`   | HTTP port inside the container                                                                                  |
| `DATA_DIR`                | `/data`  | Persistent root                                                                                                 |
| `ROCKETT_COMMIT`          | empty    | Git revision reported by `/api/health` (build arg)                                                              |
| `ROCKETT_DESCRIBE`        | empty    | `git describe --tags --always --dirty` reported by `/api/health` (build arg)                                    |

## Security

- Runs as the non-root `rockett` user. `/app` is root-owned, so the app
  cannot change its own code. `/data` is the only path it writes; it needs no
  ephemeral writable path, and `--read-only` with the `/data` volume serves.
  The base image's `/tmp` stays world-writable unless the root is read-only.
- No outbound network use; no cloud services; fully offline-capable.
- Single-user by design for v1. Put it behind your reverse proxy
  (basic auth, Authelia, Cloudflare Access, …) if it is reachable beyond your
  LAN. The auth layer is intentionally separable from the CAD logic
  (see ARCHITECTURE.md).
- Healthcheck hits `/api/health` (30 s start period, one probe interval,
  since the WASM kernel loads in under a second). A long regeneration
  blocks the event loop, so each probe waits 5 s, inside Docker's 10 s
  limit, and then exits rather than piling up. The container turns
  unhealthy only after 10 failed probes in a row, 30 s apart: about five
  minutes.
