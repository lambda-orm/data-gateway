# Changelog

All notable changes to this project will be documented in this file.

## Versions

### Unreleased

- **`observability.explore`**: where the traces of the gateway are seen (`grafana`, the URL of Grafana; `tempo`, the uid
  of the datasource of Tempo; `orgId`), of the installation and not of each IDE. `management` tells it at
  `GET /observability` (no credential, as `/transports`); `{}` without it. It doesn't reach the SDK of λORM.
- **Docs:** the example of `state.source` in `docs/GATEWAY_STATE.md` said `dialect: SQLjs`, which the gateway refuses
  for the state: `SQLite`.

### 4.4.0 (2026-11-26)

With `@lambdaorm/base` 3.11.1 and `@lambdaorm/lib` 3.15.0, the exact versions the image installs.

**Roles with their views and stages** (`docs/ROLE_SCOPES.md`):

- **`authorization.roles`**: a role says its `permissions`, the `views` and the `stages` it may use (the first of each,
  the one of who doesn't choose; none, the one of the schema), `maxRows`, `approval`, `scope: any` (its permissions
  whatever was chosen) and `locked`. Tokens name them by their claim (`principal.permissions.claim`), keys by `roles`.
  `orm.schemas[].roles` extends them in a schema; `orm.schemas[].stage` is the stage of who doesn't choose.
- **The client chooses** `options.view` and `options.stage` only among those of its roles (`403` outside them);
  `options.maxRows` only lower than its role's. The permissions of a request are those of the roles that allow the view
  and the stage chosen (not the sum of all of them); the commands of a stage (`push`, `migrate`, `export`, `import`…)
  only in the stages of their role. `/whoami` says the view and stage it got and every one it may choose.
- **Roles from the administration:** `GET /admin/roles`, `PUT /admin/roles/{name}` `{ schema, config, reason }`,
  `DELETE /admin/roles/{name}?schema=`, `GET /admin/roles/changes`, with the new permission `roles`: a new role, or one of
  the configuration extended (more views, stages, permissions; never one `locked`); nobody gives a permission it doesn't
  have; each change recorded (who, when, before and after). It applies at once, in the other replicas within
  `state.refresh`.

**The state of the gateway** (`docs/GATEWAY_STATE.md`): **`state.source`** says where the gateway keeps its own state
(the sessions of management, the state of the UI, the writes that wait, the roles): `SQLite` (a file, as before:
`.data-gateway/state.sqlite` of the volume when it isn't said) for one instance, or a database through λORM
(`PostgreSQL`, `MySQL`, `MariaDB`, `SqlServer`, `Oracle`) for several replicas; its tables (`dg_*`) are created when it
starts. `state.refresh` (30 s), `state.required` (without it the gateway doesn't start; else it starts with the roles of
the configuration alone).

**Breaking:**

- A client can't choose a stage its roles don't name (before, any of the schema): `authorization.stages: open` keeps the
  old behavior for this version.
- A push or a migration that loses data (`allowDestructive`) needs the permission `destructive` besides `ddl`.
- `cluster.valkey` (several replicas) with the state in SQLite is an error: give `state.source` a database.
- A token whose roles give two views is no longer refused when it authenticates: the request chooses one (or is told to).

### 4.3.0 (2026-11-26)

With `@lambdaorm/base` 3.11.1 and `@lambdaorm/lib` 3.15.0, the exact versions the image installs.

**Tested against Keycloak** (`docs/OIDC_LOGIN.md`): `scripts/ci-local.sh oidc` and its job of CI take the tokens of a
real Keycloak on the five transports (its roles, a view by its claim `country`, another audience or a changed token
refused, the rotation of the key of the realm without a restart).

**Files of some properties** (`docs/FILES_AND_PANELS.md`):

- **`files.storages`** (S3 — AWS, or another with `endpoint` — and Azure Blob) and **`files.properties`**
  (`Entity.property: storage`), globally or per schema: the property keeps the key of an object, the gateway signs URLs
  of short life and the bytes go straight between the client and the storage (SigV4 and the SAS of Azure, signed
  without the SDKs).
- `GET /{schema}/files` (which properties, in the view of the caller), `POST /files/{Entity}/{property}/upload`
  `{ name, type, size }` (write: within the `types` and `maxBytes` of the storage; the key is made by the gateway) and
  `GET /files/{Entity}/{property}/url?key=` (read: only a key that a row of the view of the caller keeps); by WebSocket
  `files.list`, `files.upload`, `files.url`. The storage must allow the origin of the IDE (CORS).
- The workbench keeps panels too (`<name>.panel.yaml`).

**Writes that wait for a person** (`docs/MUTATION_APPROVAL.md`):

- **`mcp.approval: writes`** (also per schema; `mcp.approvalExpires`, 1 h): every write by MCP waits, answered at once
  with `{ approval, status: "pending", expiresAt }` (REST: `202`); nothing changes yet. **`approval: writes`** on a key
  or a role of a token: its writes wait on every transport. A script always waits (it may write); a queued write can't.
- **`approve`**, a new permission: `GET /admin/workspaces/{schema}/approvals` (with the plan of each write: the sentences
  it would run), `POST …/approvals/{id}/approve` and `…/reject { reason }`. Never the own write (four eyes); an approved
  write runs once, as who asked for it (its view, its context), audited with `approvedBy`.
- **Who asked** sees it with the MCP tool `approval_status`, `GET /{schema}/approvals/{id}` or `approvals.status` by
  WebSocket: pending, done (its result), failed, rejected (its reason) or expired.
- They live in the SQLite of the volume (`.data-gateway/state.sqlite`, shared by the replicas), in memory without
  `orm.workspacePath`.

**Replicas together** (`docs/REPLICAS.md`):

- **`cluster.valkey`** (`url`: `valkey://`, `valkeys://`, also `redis://`, `rediss://`; `prefix`): the replicas share
  the changes of the data through a Valkey (or a Redis), with `iovalkey`. A write through any replica drops the cached
  results that read it in every replica, and reaches the subscribers (WebSocket, SSE) of every replica, each through
  its view. Only entity, action, keys and count travel, never the rows.
- **The outbox** is dispatched by the replica that holds its lease in the Valkey (renewed every 5 s, 15 s to expire):
  when it goes, another takes it; `outbox.dispatch: false` still keeps a replica out.
- **The Valkey down:** each replica goes on with its own changes (the cache bounded by its `ttl`), said once in the
  log; nobody dispatches the outbox until it is back. `/metrics`: `data_gateway_cluster_connected`,
  `data_gateway_outbox_leader`.
- The log of the configuration hides the password of a URL, and `secret`, `secretAccessKey` and `accountKey`.

**Development:** `npm run dev` (and the task of VS Code) seeds `dev/workspace` once with northwind on SQLite (sql.js)
and its data: the dev gateway needs no database server. A `dev/workspace` that is there is left as it is.

### 4.2.0 (2026-11-26)

With `@lambdaorm/base` 3.11.1 and `@lambdaorm/lib` 3.15.0, the exact versions the image installs.

**The dispatcher of the outbox** (`docs/OUTBOX_DISPATCHER.md`, G5):

- **`outbox.destinations`** (global or by schema): the events λORM writes with the data (`infrastructure.outbox` of
  the `lambdaORM.yaml`) are delivered every `interval`, `batch` at a time, to **webhooks** (a `POST` per event, its id
  in `X-Data-Gateway-Event`, signed `X-Data-Gateway-Signature: sha256=…` of `timestamp.body` with its `secret`) and to
  **Kafka** (its `topic`, the brokers of `infrastructure.queue`, keyed by the entity and the keys of the row); never
  the data written. An event goes when every destination that takes it accepted it; else λORM retries it (1, 2, 4…
  s) and leaves it `dead` after its `maxAttempts`.
- **The administration:** `GET /admin/workspaces/{schema}/outbox?status=dead` (`schemaRead`) and `POST
  …/outbox/{id}/retry` (`ddl`).
- **One replica dispatches:** `outbox.dispatch: false`, or `DATA_GATEWAY_OUTBOX_DISPATCH=false`, on the others.
- `data_gateway_outbox_events{result="delivered|failed"}` in `/metrics`.

**Subscriptions** (`docs/SUBSCRIPTIONS.md`, G4):

- **Over WebSocket:** `subscribe.entity { entity }` (each write of it: `data.changed` with its action, the keys its view
  sees and its count, never the data), `subscribe.query { query, data }` or `{ name, data }` (its result now, and
  `query.changed` with the new one when something it reads is written, only if it changed, at most once in 200 ms) and
  `unsubscribe`. Up to 100 a connection; they end with it.
- **Over SSE:** `GET /subscribe?entity=…`, `?query=…&data=…` or `?name=…` on `http`: the same events.
- **With the identity of who subscribes:** its permissions, its view and its context; with a view, a write of rows it
  can't see doesn't reach it (its keys are read in its view).
- The writes of this replica (across replicas, later).

**The cache of the reads** (`docs/RESULT_CACHE.md`, G3):

- **`cache`** (global or by schema, off by default): the result of an `execute` that only reads (and of a named query
  that only reads) is kept in memory (LRU, `maxEntries`, `maxRowBytes`) until its `ttl`, or the `ttl` of an entity it
  reads (`entities: { Prices: { ttl: 5s }, AuditLogs: { enabled: false } }`). Its key has the query, its data, the
  stage, the view and the context of who reads: two identities never share a result.
- **A write through λORM drops** at once every result that reads its entities (`orm.onDataChange`), also those reached
  through a relation; what another application writes is bounded by the `ttl`.
- **REST answers `ETag`** (and `Cache-Control: private, no-cache`) on `execute` and `/queries/{name}`: the same
  `If-None-Match` is `304` without body.
- `data_gateway_cache_requests{result}`, `data_gateway_cache_invalidations` and `data_gateway_cache_entries` in
  `/metrics`.

**Fixes:**

- `view`, `queries` and `cache` of a schema no longer warn `unknown key … ignored` (they were read anyway).

Needs `@lambdaorm/base` 3.11.1 and `@lambdaorm/lib` 3.15.0.

### 4.1.0 (2026-11-25)

With `@lambdaorm/base` 3.11.1 and `@lambdaorm/lib` 3.15.0, the exact versions the image installs.

**Named queries** (`docs/NAMED_QUERIES.md`, G7):

- **The queries of `application.queries`** of the schema are served by their name: `GET /queries` (name, description,
  parameters and model; never their text) and `POST /queries/{name}` (`{ data, options }`); `queries.list` and
  `queries.execute` by WebSocket; and an MCP tool each, `query_<name>`, with its parameters typed and its result
  described. In the view of who calls (one that uses what its view excludes is not listed); run as `execute` (its
  permissions; the audit says its `name`).
- **`mcp.freeQueries: false`** (global or by schema): an agent without `orm_execute`, `orm_execute_script`,
  `orm_execute_queued` nor `orm_plan`, only the named queries and the tools of the schema. `mcp.tools.include` and
  `exclude` take `query_<name>`.
- **Limits by query:** `orm.schemas[].queries: { <name>: { maxRows, timeout } }`; more rows is 422
  (`TooManyRowsError`), longer is 504.

**The view by identity** (`docs/VIEWS_BY_IDENTITY.md`, G2):

- **The gateway chooses the view of λORM of each request:** of the key (`keys[].view`), of the role of the token
  (`roles: { support: { permissions: [read], view: support } }`), else of the schema (`orm.schemas[].view`), else
  none (the domain). The client's is still dropped.
- **Everything is in that view:** the queries (masked, without what it excludes, their rows filtered with the context
  of the token), their `metadata`, `model`, `parameters` and `constraints`, the domain (`/schema`, `/domain`,
  `/entities`, `/typings`, the search), the entities of the mappings, the views listed, the descriptions and resources
  of MCP, and `/whoami` (`view`).
- **Never guessed:** a token whose roles give two views is 403; a view the schema doesn't have is said when it loads
  and its requests are 403; a credential with a view and `stageImport` or `ddl` is warned (the commands of stage see the
  whole schema).

**JWT / OIDC** (`docs/JWT.md`, G1):

- **`authentication.adapter: jwt`:** the tokens of an identity provider, checked with its keys (its JWKS, discovered
  from `issuer` when `jwksUri` is not given, cached; a token of a new `kid` reads it again) or a shared `secret` (HS256,
  for development); `issuer`, `audience`, `algorithms` (never `none`), `clockTolerance`.
- **Who it is, from its claims:** `principal.name` (default `sub`), the permissions of its roles
  (`principal.permissions.claim` and `roles`: role → permissions; a role must list them), and `context` (variable →
  claim), the context of λORM of its requests: it reaches the row filters of the views, the defaults and the
  conditions; one sent by the client is still dropped.
- **`authentication.methods`:** several in order (a JWT for the users, the API keys of the services); the first that
  recognizes the credential decides.
- **A refused token says why:** 401 with `the token is not valid: expired` (`issuer`, `audience`, `signature`,
  `algorithm`, `unknown key`…) and `WWW-Authenticate: Bearer error="invalid_token"`; an issuer that can't be reached,
  503. The token is never written anywhere.
- **Nothing outlives its token:** a session of `management` ends at its `exp`; a WebSocket or MCP WebSocket connection
  is closed with 4401.
- The image needs Node ≥ 22.12 (`jose` is ESM; the image runs 24).

**λORM 3.15** (`docs/PENDINGS.md` R3):

- **Its errors have their status:** `ContextError` 400 (a value of the context a filter needs), `ViewError` 403 (an
  entity the view excludes, a write out of the filter of its view), `CrossSourceError` 422 (a query across sources too
  big for memory), `DestructiveChangeError` 409; each with what a client can use of it in `details` (`variable` and
  `where`, `view` and `entity`, `changes`).
- **`push` says what can lose data:** its preview brings `destructive` (source, sentence and why: a narrower type, a
  shorter length), and the command runs those only with `allowDestructive: true`; without it the job fails with
  `DestructiveChangeError`.
- **Migrations** (`infrastructure.migrations`): the command `migrations` lists the history of the stage (version,
  source, applied or undone) and `migrate` goes back to a `version`: its preview shows the undo of each later migration
  (and what of it can lose data), and it runs with `allowDestructive` when it has to.
- **Seed** (`stages[].seed`): the command `seed` inserts the rows of its files that are not in the database yet; its
  preview lists the files.
- The observability of a schema without its own goes through `orm.observeWith`.

**Fixes** (seen reviewing the wiki):

- `GET /transports` gives `schemaPath: "/{schema}/mcp"` for `mcpWebSocket`, where its upgrade is (it said `/{schema}`).
- The OpenAPI document lists every route open without a credential (also `/version`, `/transports` and the
  documentation), and `/version` is marked open as the gateway serves it.
- The Northwind data of the configuration keeps its letters (`München`, `Köln`, `México D.F.`).

**Observability** (`DATA_GATEWAY.md` §8.2):

- **OpenTelemetry:** the section `observability` of `data-gateway.config.yaml` (the shape of the one of a
  `lambdaORM.yaml`; the `OTEL_*` variables override it) starts the SDK in the edge and in every schema worker, before
  λORM, which uses it. A `SERVER` span per HTTP request (by its route template), WebSocket message and MCP call, child
  of the caller's `traceparent`; the trace goes on in the worker and in λORM's spans.
- **The actor** of each request (credential; session, IDE and IP on `management`) reaches λORM; one sent by a client
  is replaced.
- **λORM's metrics in `/metrics`**, with the names of the OpenTelemetry → Prometheus compatibility
  (`db_client_operation_duration_seconds`…), and `http_server_request_duration_seconds` with the labels of the
  conventions.
- **The history of a schema:** every change of the administration is a `schema.change` with who, before, after and
  the JSON Patch, in `logs/changes.jsonl` of the workspace and in OpenTelemetry; `GET
  /admin/workspaces/{schema}/history`. `workspace.changed` says who and what. The audit also goes as an OpenTelemetry
  LogRecord.
- **The 412 of a form or of the YAML says who changed it:** `details.changedBy` (credential, client, time, kind,
  target), from the history.

**Security:**

- **The client no longer chooses the view nor the context of λORM:** `options.view` and `options.context` are dropped
  from what a client sends on every transport (REST, WebSocket, MCP, `script`, `execute-queued`) before reaching λORM,
  and `plan` now takes the actor and goes through the same filter as `execute`. A client with `read` could ask for any
  view (or none, the whole domain) and skip what a view hides or masks, and with λORM ≥ 3.10 send a context of another
  tenant to the row filters of the views. The gateway takes them from the identity (JWT / OIDC and the view by
  identity, above).

### 4.0.0 (2026-11-23)

**Breaking changes** (`DATA_GATEWAY.md` §12):

- **The `management` transport:** the API of the data-gateway-ide on its own port (`transports.management.port`): the
  routes of `http` for every schema (whatever `orm.schemas[].transports` says) and the administration at `/admin`, with
  the same credentials and permissions. Without its port there is no administration and no IDE: a production gateway
  whose schemas come in the volumes leaves it out. The `admin_*` tools of MCP are there when it is exposed.
- **`/admin` is no longer on `http`**, and `admin.enabled` is gone (warned about and ignored): the administration is on
  when `management` has a port. `admin.allowAnonymous`, `maxFileBytes` and `commandTimeoutMs` stay.
- **The gateway serves no UI:** `{basePath}/ui` and `transports.http.ui` (warned about and ignored) are gone. The UI is
  the data-gateway-ide, its own image (`flaviorita/data-gateway-ide`), whose backend reaches `management`.
- **No CORS on any transport** (`http`, `mcpHttp`, `management`, the `/asyncapi.json` of the WebSocket transports): a
  web app that called the gateway from the browser calls it from its backend.
- **`management` works with sessions** (`docs/DATA_GATEWAY_SESSIONS_PLAN.md`): `POST /sessions` with the credential
  (as every transport takes it) answers a token, and every other request carries it in `X-Data-Gateway-Session`. A
  credential sent directly is refused (`401 SessionRequiredError`); `/health`, `/ping`, `/metrics`, `/schemas` and
  `/transports` need none. The data transports don't change: they take the credential on every request.

**Features:**

- **The sessions of `management`:** `GET`/`DELETE /sessions/current` (the logout), `GET /sessions` (one's own; all with
  `?all=true` and the new `sessionAdmin` permission), `DELETE /sessions/{id}` and `DELETE /sessions?credential=`
  (`&except=current`: close the others). A session ends after `sessions.idleTimeout` (30 min) without requests or
  `sessions.maxLifetime` (12 h); `401 SessionExpiredError` / `SessionRevokedError` say why. Kept in
  `<orm.workspacePath>/.data-gateway/state.sqlite`, shared by the replicas, with the hash of the token only.
  `sessions.maxPerCredential` limits them; `trustedProxies` takes the address of the browser from `X-Forwarded-For` of
  the IDE. Every login, logout, expiry and revocation leaves an audit line; `data_gateway_management_sessions` counts
  them.
- **The WebSocket of events of `management`**, `{basePath}/events`: the session in the upgrade
  (`X-Data-Gateway-Session`, or the subprotocol `lambdaorm.session.<token>` from a browser). It pushes
  `session.revoked` (then closes with `4401`), `session.expiring` (2 minutes before the end of its lifetime),
  `schema.statusChanged` and `workspace.changed`, and takes `session.activity` (`{ schema, tab }`) from the IDE. A
  session with its socket open is `connected` in the lists, also for the other replicas on the same volume; revoking it
  in any replica closes its socket (within 5 s; at once in the same replica).
- `GET {basePath}/transports`: the transports of the gateway (port, base path, how a schema is reached, its document),
  and `GET {basePath}/openapi.json`.
- A WebSocket from a browser authenticates with the credential in its subprotocols (`lambdaorm`,
  `lambdaorm.headers.<base64url>`): a browser can't send headers in a WebSocket. Also the MCP over WebSocket.
- `GET /admin/workspaces/{path}/files` and `…/files/content`: the files of `data/` and `src/` of a workspace, listed and
  read (never the `.env`, `orm_state/` or a hidden file), for the explorer of the UI.
- `GET /admin/expressions` and `POST /admin/expressions/check`: the language of the expressions (3xpr) and the variables
  of the condition of a source of a stage, and one expression checked, for the editor of the UI. The validator of a
  schema says a condition that doesn't parse (an error) and a variable that is not of a sentence (a warning).
- `GET`/`PUT /admin/session`: where the UI of each credential was (its tabs and their drafts, what is unfolded), in
  `<orm.workspacePath>/.data-gateway/state.sqlite` (`node:sqlite`), so that a reload or another browser starts there.
  The UI keeps its credential across a reload (in the tab, or in the browser with "remember me").
- The UI: the account at the right of the header (its icon and name), with Account (the user, how it
  authenticates, each permission with what it allows) and Preferences (the language and the theme with their previews),
  both opened as tabs, and Logout. The suggestions of the queries and scripts show the type of each property and the
  functions of each type; the json and yaml views of a result are Monaco editors.
- The UI: the themes of Ilusor (Light, Dark, Dracula, Night, Nord, Solarized, Monokai, High Contrast) and a
  regional format for the numbers and dates of the results; the query of a diagram in a new tab; copy and format a query.
- `POST /admin/workspaces` takes a `name` and a `description`, written on top of the new `lambdaORM.yaml`.
- A `set` of a section or key the `lambdaORM.yaml` doesn't have yet (`application`, `name`, `description`) creates it.
- The UI (`@lambdaorm/ui`): the explorer as the workspace is (`DATA_GATEWAY.md` §11.7); the name, description
  and version of a schema, in its tab and when it is created; the commands as a toolbar of icons, with a form for those that need a file; closing tabs
  one by one, all but one or all; the sources of a stage chosen with their condition, an expression with suggestions
  checked while it is written: shown in the colors of 3xpr and written in a form with its suggestions and the variables
  of a sentence; diagrams with what each box shows (all, keys, PK, names), the related tables of a box added with its +,
  exported as PDF, PNG or SVG, several boxes selected (by click or a rectangle) to move or remove them together, and
  the select and move tools and the zoom in their bar. A diagram of `workbench/` keeps its `detail`.

### 3.2.0 (2026-11-22)

Uses `@lambdaorm/lib` 3.8.1 and `@lambdaorm/ui` 0.5.0. The administration of the workspaces (phases 1 to 6 of
`docs/DATA_GATEWAY_ADMIN_PLAN.md`). Nothing to change in the configuration: `orm.watch` is on by default, `admin` off.

**Features:**

- **The workspaces are watched while the gateway runs** (`orm.watch`): a folder with a `lambdaORM.yaml` that appears
  is a new schema, served on every transport without restarting the gateway; a folder that goes takes its schema (its
  routes answer `404`, its WebSocket connections are closed with `4404`).
- **A `lambdaORM.yaml` or `.env` whose content changed reloads its schema blue-green**: the new worker starts next to
  the current one, which keeps serving until the new one is ready, without a moment out of service. If the new
  version doesn't start (an invalid YAML), the last one that did keeps serving, and the state of the schema says why
  in `pending` (`GET /schemas`, `schema.statusChanged`).
- WebSocket notification `workspace.changed` (`{ path, kind, files?, at }`; `added`, `removed`, `schema`, `env`,
  `files`), on the connections to that schema and to the root.
- With `orm.watch`, an empty volume starts and waits for its first schema, and an `orm.schemas` adjustment of a schema
  not there yet is a warning, applied when it appears.
- **The administration of the workspaces** (`admin.enabled`, off by default; `docs/DATA_GATEWAY.md` §11), on
  `/admin` of the http transport, with new permissions never given by default (`schemaRead`, `schemaWrite`,
  `schemaAdmin`, `workbenchWrite`): workspaces created (empty or a copy) and removed (to `.trash`), the
  `lambdaORM.yaml` read and written with its version (`If-Match`; `412` with what there is now, `428` without it), its
  validation with the line of each issue (without running `application.start`), and what the UI saves as files in
  `workbench/` of each workspace. Writes to a workspace go one at a time (a lock file, also across replicas) and are
  atomic; the monitor of the workspaces serves what is written.
- **The commands of a workspace as jobs** (`DATA_GATEWAY.md` §11.3): `version`, `fetch`, `export` (also saved in
  `data/`), `push`, `drop` and `import`, run by the worker of the schema, one at a time per schema. The ones that change
  the databases first show what they will do (the sentences by source, the rows of each entity) and run exactly that
  preview, only with the same `lambdaORM.yaml`. New permission `ddl`; `admin.commandTimeoutMs`.
- `pull`, `introspect` and `incorporate` from the gateway: their preview is the diff of the `lambdaORM.yaml`, and it is
  written keeping its comments, order and style (only what changed is new; λORM writes it with js-yaml, which loses
  them). `pull` updates the state of the stage as λORM does; `incorporate` waits for the new schema, pushes it and
  imports the data.
- **One element of a schema at a time** (`DATA_GATEWAY.md` §11.4): `PATCH /admin/workspaces/{path}/schema` with `set`,
  `add`, `remove` or `rename` of an element named by names; a rename renames what names it (relations, keys, indexes,
  mappings, stages…). Concurrency per element: someone else's change to another element doesn't collide. Written
  keeping the comments and the rest of the file. The validation rejects a name repeated in a list.
- **The connections and the code** (`DATA_GATEWAY.md` §11.5): the variables of the connections in the `.env` of a
  workspace, listed (defined or not, used by which sources) and set or removed keeping the rest of the file, never
  answered; and `build` of the model and repositories (node, client-node) in `src/` of the workspace or as a `.zip`.
  New permission `build`.
- **The administration over MCP, read only** (`DATA_GATEWAY.md` §11.6): `admin_schema_get`, `admin_schema_validate` and
  `admin_stage_fetch`, for credentials with `schemaRead` when `admin.enabled`. Writing is not offered over MCP.
- The UI at `/ui` (`@lambdaorm/ui` 0.5.0), with those permissions: the `lambdaORM.yaml` of each schema editable in Monaco
  (validated while typed, saved with Ctrl+S, a conflict shown side by side), new and removed schemas, what is saved
  shared in the workspaces, the panel of commands, the schema as forms with
  its variables, the code of the domain and the completion of the keys and values of the lambdaORM.yaml.
- The UI at `/ui` reads the schemas again every 5 s: a schema added, removed or reloaded shows without reloading the
  page (its domain and typings are read again), and a version that didn't start is marked ⚠ with its reason.

**Bug Fixes:**

- After a blue-green reload, the new worker was terminated 30 s later (its pongs were not counted) and its fall didn't
  restart the schema: it is now a worker of the schema like any other.

### 3.1.0 (2026-11-21)

Uses `@lambdaorm/lib` 3.8.0 and `@lambdaorm/ui` 0.4.0. Nothing to change in the configuration; the API gains routes,
tools and fields, and some answers change status (below).

**Features:**

- **Large schemas** (Ilusor's Cloud: 192 entities, the domain 389 KB as JSON):
    - MCP: a domain that doesn't fit in the description of `orm_execute` gives the names of its entities and points to
      two new tools, `schema_search { text }` (entities, properties and relations by part of their name, compact;
      `Areas.type` only in Areas; the closest names when nothing matches) and `schema_describe { entities }` (some
      entities in two lines each). It used to cut the domain and point to reading it whole.
    - The same on REST, `GET /{schema}/search?q=` and `GET /{schema}/describe?entities=A,B`, and on WebSocket,
      `schema.search` and `schema.describe`.
- **The errors of a query say what is there instead** (from `@lambdaorm/lib` 3.8.0): `nam is neither a property nor
  a relation of Areas; did you mean name?`, `entity Area not found; did you mean Areas?`, or the key of the entity;
  and as data, `suggestions: [{ name, didYouMean }]`, in the body of REST, `error.data` of WebSocket and
  `structuredContent` of MCP.
- **MCP errors** carry `structuredContent` with the name, status and database code that REST and WebSocket answer.
- **From `@lambdaorm/lib` 3.8.0:** relations of several fields (`from: [locationId, areaId]`), and Ilusor's model:
  reads with includes without a transaction and MongoDB `transactions: false` (FerretDB), includes by a `uuid` key
  with several parents, UUIDs read from MongoDB as text, `fetch` with `uuid` and `character(n)` columns and the
  PostgreSQL catalog across schemas and partitions.
- **The UI at `/ui`** (from `@lambdaorm/ui` 0.4.0): a filter of the entities in the explorer, "use name" on an error
  with a suggestion, the width of the explorer kept and fitted to the names, and the schemas that didn't start
  shown with their reason.

**Changes of status:**

- A name that doesn't exist (an entity, an enum, a source, a mapping, a stage, `GET /entities/Nope`) answers `404`; it
  answered `204` without a body.
- A query error that answered `500` answers `400`: an unknown entity, a missing required property (λORM kept the
  class of the error), an include of a relation that doesn't exist, a function that doesn't exist.
- A route that doesn't exist answers a `404` in JSON (`{ error: "NotFoundError", message }`) with the closest routes;
  it was the HTML page of Express.
- `ConnectionError` (a source the gateway can't reach, or whose connection variable is not set) answers `503`, not
  `500`.

**Bug Fixes:**

- A connection whose environment variable is not set (`${ORM_SALES_DOCUMENTS_CNX}`) failed with `Cannot read
  properties of undefined (reading 'startsWith')`. With `runtime.checkConnections`, the schema now doesn't start and
  its reason lists every variable that is missing and where to give it, before connecting to anything; without it, the
  first query to that source answers `503` naming the variable.

### 3.0.3 (2026-11-20)

Uses `@lambdaorm/lib` 3.7.0 and `@lambdaorm/ui` 0.3.4. Nothing changes in the configuration or the API.

**Bug Fixes:**

- From `@lambdaorm/ui` 0.3.4, in the UI at `/ui`: a new query tab picks the schema by itself when only one is ready
  (it asked even with one), and the checkboxes of the diagram dialog sit next to their names.

### 3.0.2 (2026-11-20)

Uses `@lambdaorm/lib` 3.7.0 and `@lambdaorm/ui` 0.3.3. Nothing changes in the configuration or the API.

**Bug Fixes:**

- From `@lambdaorm/lib` 3.7.0: dates are stored in UTC on every engine, whatever the time zone of the gateway
  (`TZ`). On PostgreSQL, MySQL, MariaDB and Oracle they were written in the time zone of the process (12:34Z was
  stored as 13:34 by a gateway in Madrid), so the functions of the database (`hour`, `dateToString`, a comparison with
  `now()`) and other applications saw a different time. Dates already stored in the local time of the gateway are
  read shifted by its offset.

### 3.0.1 (2026-11-19)

Uses `@lambdaorm/lib` 3.6.0 and `@lambdaorm/ui` 0.3.3. Nothing changes in the configuration or the API.

**Bug Fixes:**

- From `@lambdaorm/lib` 3.6.0, checked by the engines lab on the six engines:
    - **MongoDB:** dates are stored and compared as BSON dates (the `Date` of MongoDB), not ISO text: the values of
      inserts and updates, and the dates of filters. `distinct` applies `sort` and `page` (they were ignored, and the
      rows came nested in one list), also as a function of the map. `<<` and `>>` work.
    - **Oracle:** a date written in the query is a `DATE` / `TIMESTAMP` literal (`ORA-01861`), a variable named as a
      reserved word works (`to`, `from`, `date`: `ORA-01745`), and `<<` and `>>` work.

### 3.0.0 (2026-11-19)

The first stable version: it moves `latest`. Uses `@lambdaorm/lib` 3.5.5 and `@lambdaorm/ui` 0.3.2. Nothing changes in
the configuration or the API since `3.0.0-rc.4`; the queries the gateway runs are translated right on more engines.

**Bug Fixes:**

- From `@lambdaorm/lib` 3.5.4 and 3.5.5, every engine checked against a real database by the engines lab:
    - **MongoDB:** `sort` by a column, names with spaces (`Order Details`), `like` / `startsWith` / `includes` /
      `isNull` in filters, the date functions on stored dates, comparisons of an expression in a filter
      (`year(p.date) == 2026`), `log`, `trunc` and a map of one expression.
    - **SQL Server:** the functions are T-SQL (they were Oracle's: 52 of 62 failed).
    - **Oracle:** the date functions are Oracle's (they were MySQL's: 20 of 56 failed).
    - **Every engine:** `includes` of a list is an `IN` and of a text a contains (on SQL Server a list was a `LIKE`);
      an `include` with its own filter keeps the condition on the parents; `first` / `last` as aggregates are a clear
      error on SQL databases, which have no such aggregate.
- UI: the autocompletion of the query editor offers the functions the language has (`hour`, `addHour`, `dayDiff`, …),
  not names that don't exist (`hours`, `addHours`).
- Swagger (`/doc`): `POST /script` says what scripts need, `scripts.enabled: true` and a credential with the `script`
  permission, instead of the former service's `SCRIPT_ENABLED`.

### 3.0.0-rc.4 (2026-11-18)

Prerelease: it doesn't move `latest`. Uses `@lambdaorm/lib` 3.5.3.

**Bug Fixes:**

- Swagger (`/doc`): Authorize offers the credential the served schemas are configured with (an API key in its header,
  a bearer token or basic); it offered a fixed bearer token, so it didn't work with an API key. Each http transport
  serves its own document.
- From `@lambdaorm/lib` 3.5.3: a PostgreSQL `bytea` column is read as `buffer` (`lambdaorm pull`, `fetch` and
  `introspect` failed with `error with type: bytea`), and a `buffer` property is created as `BYTEA`.

### 3.0.0-rc.3 (2026-11-18)

Prerelease: it doesn't move `latest`. Uses `@lambdaorm/lib` 3.5.2.

**Features** (the UI at `/ui`, built on `@lambdaorm/ui`):

- Named Data Gateway: a home page with what it is and the schemas, a login page (show / hide the secret) and the
  query page, with logout; the theme (system / light / dark) and the language (English, Español, Português,
  Français, Italiano, Deutsch, Nederlands, Català, Galego, Euskara) are chosen at the top and kept in the browser. The
  credential is never kept.
- An explorer of the schemas on the left. For each schema: its domain as YAML, read only (only `GET /{schema}/domain`:
  never the sources nor the connections); its entities with their properties and relations, and the form of each
  entity (properties, relations and references, keys, indexes and constraints, rows read only by pages, diagram).
- Folders, queries and diagrams saved with a name and a description, moved by dragging; queries in tabs with Save,
  Save as… and Ctrl+S. Saved diagrams: the chosen entities laid out by themselves, boxes and lines moved by hand,
  boxes taken out with their ×, the names of the relations, export to SVG and PNG.
- What is saved stays in the browser (IndexedDB, per gateway and user of the credential) and is exported to and
  imported from a JSON file.
- Results: a copy icon and an export menu (JSON, YAML, tab-separated text).
- The Swagger page says Data Gateway and the version of the instance.

### 3.0.0-rc.2 (2026-11-18)

Prerelease: it doesn't move `latest`.

Uses `@lambdaorm/lib` 3.5.2.

**Bug Fixes (from `@lambdaorm/lib` 3.5.1 / 3.5.2):**

- `like(p.name, 'Ch%')` with the pattern written in the query, `p.name.includes('ch')` ("contains"), and
  `startsWith` / `includes` with the value in a variable work on every SQL engine.
- The date functions (`year`, `month`, `day`, `addDay`, `dayDiff`, …) on a column work on PostgreSQL.
- The MCP guide (`lambdaorm://guide/expressions`) and the description of `orm_execute` teach them; the evaluation set
  has two more questions (contains, `like` with `_`).

### 3.0.0-rc.1 (2026-11-18)

First release as `@lambdaorm/data-gateway` (formerly `packages/service` / `@lambdaorm/service`), published as the
Docker image `flaviorita/data-gateway` (up to 2.4.0, `flaviorita/lambdaorm-svc`). Prerelease: it doesn't move `latest`.
Uses `@lambdaorm/lib` 3.5.0. Design: `docs/DATA_GATEWAY.md`; plan: `docs/DATA_GATEWAY_PLAN.md`.

**BREAKING CHANGES:**

- The configuration is one mandatory YAML file (`DATA_GATEWAY_CONFIG_PATH`, default
  `/config/data-gateway.config.yaml`): `infrastructure.service` of `lambdaORM.yaml` and the variables `PORT`,
  `SERVICE_TOKEN`, `RATE_LIMIT_*`, `SCRIPT_*` are no longer read (migration table: `docs/DATA_GATEWAY.md` §2.7).
- There are no default ports: a transport without `port` is not exposed.
- Each schema worker receives only its own variables (`orm.schemas[].env`, the `.env` of its workspace, the base
  variables and `runtime.env.passthrough`); `runtime.env.isolate: false` gives them the whole environment.
- At start each schema opens a connection of each source (`runtime.checkConnections`): a database down leaves the
  schema in `error` (and retried) instead of failing in the first query.
- The image runs `node index.js` (it stops on `SIGTERM`).

**Features:**

- Transports by configuration, each on its own port: `http` (the REST API), `mcpHttp` (MCP Streamable HTTP, stateless
  or stateful, plus the deprecated HTTP+SSE), `mcpWebSocket` and `webSocket` (JSON-RPC with notifications).
- MCP: 22 tools (one per operation, writes included) listed by the credential's permissions, with `readOnlyHint` /
  `destructiveHint`, the domain in the description of `orm_execute`, resources (`lambdaorm://guide/expressions`,
  the domain, each entity) and `mcp.maxRows`.
- Several schemas: discovered under `orm.workspacePath` (the folder is the route: `/iot/v1`) and declared in
  `orm.schemas`, with overrides per schema (transports, authentication, env, scripts, mcp, server, runtime).
- Runtime: a supervisor, an edge worker with the transports and a worker per schema (`thread` or `process`); heartbeat,
  restarts with a growing wait, `server.maxConcurrent` (429) and `server.maxResponseBytes` (413). A schema that
  doesn't start or falls doesn't affect the others.
- Credentials with permissions (`read`, `write`, `script`, `queue`, `stageImport`) for bearer, API key and basic; a
  write with only `read` is refused before connecting.
- Audit of writes, scripts, queued executions and stage imports (a JSON line `"type":"audit"` on stdout).
- The query UI at `/ui` (`transports.http.ui.enabled`, off by default), built on `@lambdaorm/ui`; `GET /typings` and
  `GET /whoami` per schema.
- Metrics of every worker in `/metrics` (and `/{schema}/metrics`): operations by transport / schema / method / status
  / credential, forbidden, throttled, connections, schema states and restarts, event loop lag; logs labeled by worker.

**Known limits** (bugs of `@lambdaorm/lib`, avoided by the MCP guide): `like` with a literal pattern, `includes` over
text, grouping by an expression, the `sql.js` adapter.

### 2.4.0 (2026-11-17)

Uses `@lambdaorm/lib` 3.5.0.

**Features:**

- `upsert()` on SQL Server and Oracle (`MERGE` on the primary key), and with it `update().include()` of a composite
  relation saves the aggregate (children inserted, updated and deleted) on every SQL engine — through `/execute` and
  `/script`.

### 2.3.3 (2026-11-17)

Uses `@lambdaorm/lib` 3.4.1 and `@lambdaorm/cli` 1.6.5 (3xpr 5.3.1).

**Bug Fixes:**

- `POST /script`: an empty list literal (`names = [];`) and a query result indexed directly
  (`orm.execute(…)[0].name`) work.

### 2.3.2 (2026-11-17)

Uses `@lambdaorm/lib` 3.4.0 and `@lambdaorm/cli` 1.6.4.

**Features:**

- `POST /script`: `orm.execute(query, data, { stage })` inside a script can name another stage; it joins the script's
  transaction (commit or rollback together).
- `POST /script`: the script's limits travel in its `options` — `{ stage, timeout, maxIterations }`. A client may lower
  them, never above the service's `SCRIPT_TIMEOUT_MS` and the new `SCRIPT_MAX_ITERATIONS` (default 100000).
- The timeout and `maxIterations` stop a script's loops: a `while (true) {}` no longer blocks the service.
- OpenAPI document: version taken from the service, `bearerAuth` security scheme (`SERVICE_TOKEN`).

**Bug Fixes:**

- SQL Server: decimal parameters keep their decimals (they were rounded to integers).
- `toBase64` / `getBase64` return strings.

### 2.3.1 (2026-11-17)

Uses `@lambdaorm/lib` 3.2.1 and `@lambdaorm/cli` 1.6.1.

**Bug Fixes:**

* MySQL, MariaDB, SQL Server, Oracle and MongoDB fixes found by the engines lab (`in` with a list variable, json
  columns, SQL Server delete, Oracle identity and booleans, MongoDB transactions and documents, no false drift in
  `fetch`/`push`)
* listeners and scripts run on their own Orm, inside their transaction

### 2.3.0 (2026-11-17)

Uses `@lambdaorm/lib` 3.2.0 (transactions, scripts, listeners, `json` type, upsert, stage push/fetch against the
database — see `docs/LAMBDAORM_FEATURES.md` in the repository).

**Features:**

* `POST /script`: a 3xpr script whose `orm.execute` calls run in one transaction; off unless `SCRIPT_ENABLED=true`,
  limits `SCRIPT_MAX_LENGTH` (413) and `SCRIPT_TIMEOUT_MS` (rollback) (L32)
* optional service token: with `SERVICE_TOKEN` every request but `/ping`, `/health` and `/metrics` needs
  `Authorization: Bearer <token>` (L12)
* `RATE_LIMIT_MAX=0` turns the rate limit off (L9)
* errors answer `{ error, code, message }` with a status a client can map: unique / foreign key → 409, not null /
  check / invalid data / invalid query → 400, a script's `throw { status, message }` → that status (L30)

**Bug Fixes:**

* every result is answered as JSON: `delete`/`update` answered 500 or 204 for a number (L5, L4)
* `/execute` takes `data` and `options` as objects or as JSON text (L14)
* a setting left as an undefined `$VARIABLE` falls back to its default instead of stopping the service
* image on Node 24 with `@lambdaorm/cli` 1.6.0 (the CLI did not start on Node 18) (L8); the dist starts with
  `npm start` and includes `swagger.yaml`

### [2.2.1](https://github.com/lambda-orm/lambdaorm-svc/compare/v2.2.0...v2.2.1) (2025-06-01)

## [2.2.0](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.35...v2.2.0) (2025-05-30)

**Features:**

* add beatiful format on endpoints ([6a99932](https://github.com/lambda-orm/lambdaorm-svc/commit/6a99932ba30592584ec77df266fc5913634898fa)), closes [#189](https://github.com/lambda-orm/lambdaorm-svc/issues/189)
* complete readme ([9f17af2](https://github.com/lambda-orm/lambdaorm-svc/commit/9f17af2383d21745b907155b0e4ab6b035e4d974)), closes [#189](https://github.com/lambda-orm/lambdaorm-svc/issues/189)
* complete readme ([6b7083f](https://github.com/lambda-orm/lambdaorm-svc/commit/6b7083fe6673a5ef3c87568b67fe53ac864e5ce8)), closes [#189](https://github.com/lambda-orm/lambdaorm-svc/issues/189)
* **depens:** update lambdaorm dependence ([cea5225](https://github.com/lambda-orm/lambdaorm-svc/commit/cea5225d689130b92465228656714e2e4c273fd3)), closes [#201](https://github.com/lambda-orm/lambdaorm-svc/issues/201)
* **docs:** add usage on readme ([401fbe7](https://github.com/lambda-orm/lambdaorm-svc/commit/401fbe71dc26d970be791f3b67ea97017ec37754)), closes [#201](https://github.com/lambda-orm/lambdaorm-svc/issues/201)
* **docs:** update readme and wiki ([85fc4ec](https://github.com/lambda-orm/lambdaorm-svc/commit/85fc4ec6f8e96a10ecc50c92134e2a3ee5c4e80c)), closes [#201](https://github.com/lambda-orm/lambdaorm-svc/issues/201)
* fix: request without response data ([c9bd639](https://github.com/lambda-orm/lambdaorm-svc/commit/c9bd63902a9ac57ec5f96330e1d943d5675faefb)), closes [#201](https://github.com/lambda-orm/lambdaorm-svc/issues/201)
* **queue:** refactorize consumer ([e49120e](https://github.com/lambda-orm/lambdaorm-svc/commit/e49120ebff480d27f306a412d14b27f4127d8f11)), closes [#201](https://github.com/lambda-orm/lambdaorm-svc/issues/201)
* **queue:** test cqrs with kafka ([b4a3d05](https://github.com/lambda-orm/lambdaorm-svc/commit/b4a3d053f13942ee7f32088464cd8f15b1332b18)), closes [#201](https://github.com/lambda-orm/lambdaorm-svc/issues/201)
* remove /api prefix on endpoints, refactorize folders and complete readme ([bc575cc](https://github.com/lambda-orm/lambdaorm-svc/commit/bc575cce24063411a59f7d1db30f7fa0c7eb15e4)), closes [#189](https://github.com/lambda-orm/lambdaorm-svc/issues/189)
* remove orb library for apply on lambdaorm ([15da943](https://github.com/lambda-orm/lambdaorm-svc/commit/15da9436c749b960719ac29fc84a3ad854b7cd03)), closes [#201](https://github.com/lambda-orm/lambdaorm-svc/issues/201)
* rename datasource for souce ([3fd0a8b](https://github.com/lambda-orm/lambdaorm-svc/commit/3fd0a8b795dd8a57a95d3a8fdc8959bd218bd25f)), closes [#224](https://github.com/lambda-orm/lambdaorm-svc/issues/224)
* **schema:** add schema endpoint ([24d7055](https://github.com/lambda-orm/lambdaorm-svc/commit/24d7055ea3a01070954c8d00eb2e3006f5069ba7)), closes [#202](https://github.com/lambda-orm/lambdaorm-svc/issues/202)
* **schema:** add version and views ([439b45b](https://github.com/lambda-orm/lambdaorm-svc/commit/439b45bad5f687a6ff7774a95d6f5d5ed82ad443)), closes [#202](https://github.com/lambda-orm/lambdaorm-svc/issues/202)
* test cqrs ([279339d](https://github.com/lambda-orm/lambdaorm-svc/commit/279339d554c5f3981659b54553b64eaeca100fe3)), closes [#201](https://github.com/lambda-orm/lambdaorm-svc/issues/201)
* update lambdaorm dependencie ([285fb49](https://github.com/lambda-orm/lambdaorm-svc/commit/285fb496aba3169172bb3ef3ca19b92b7cc5be50)), closes [#224](https://github.com/lambda-orm/lambdaorm-svc/issues/224)
* update methods and dependences ([c6a8fe9](https://github.com/lambda-orm/lambdaorm-svc/commit/c6a8fe9507aaf461cdd51965bf4fd0b7faab4ce1)), closes [#0](https://github.com/lambda-orm/lambdaorm-svc/issues/0)
* update readme ([ba346c8](https://github.com/lambda-orm/lambdaorm-svc/commit/ba346c865f20b6a39443dac5ce7fb12e16707e86)), closes [#189](https://github.com/lambda-orm/lambdaorm-svc/issues/189)
* **wiki:** update Sidebar ([5eac40d](https://github.com/lambda-orm/lambdaorm-svc/commit/5eac40d00c447818316842222da4005a60a6b9c1)), closes [#201](https://github.com/lambda-orm/lambdaorm-svc/issues/201)
* **wiki:** update wiki ([1cbd2c0](https://github.com/lambda-orm/lambdaorm-svc/commit/1cbd2c0c0c6ab64a2d8b04a46bc1b22f6d8c18de)), closes [#201](https://github.com/lambda-orm/lambdaorm-svc/issues/201)

**Bug Fixes:**

* solve bug on body parameters ([647df0d](https://github.com/lambda-orm/lambdaorm-svc/commit/647df0d11112e47861fd859125b572f47a8f5da9)), closes [#189](https://github.com/lambda-orm/lambdaorm-svc/issues/189)
* solve import request data ([413fc78](https://github.com/lambda-orm/lambdaorm-svc/commit/413fc7892c60d2374e2f310fd71cadc9dda92a0a)), closes [#201](https://github.com/lambda-orm/lambdaorm-svc/issues/201)

## [2.1.0](https://github.com/lambda-orm/lambdaorm-svc/compare/v1.2.3...v2.1.0) (2024-05-13)

**Features:**

* update methods and dependences ([c6a8fe9](https://github.com/lambda-orm/lambdaorm-svc/commit/c6a8fe9507aaf461cdd51965bf4fd0b7faab4ce1)), closes [#0](https://github.com/lambda-orm/lambdaorm-svc/issues/0)

### [1.2.3](https://github.com/lambda-orm/lambdaorm-svc/compare/v1.2.2...v1.2.3) (2024-05-04)

### [1.2.2](https://github.com/lambda-orm/lambdaorm-svc/compare/v1.2.1...v1.2.2) (2024-05-03)

### [1.2.1](https://github.com/lambda-orm/lambdaorm-svc/compare/v1.2.0...v1.2.1) (2024-04-18)

## [1.2.0](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.35...v1.2.0) (2023-12-28)

**Features:**

* add beatiful format on endpoints ([6a99932](https://github.com/lambda-orm/lambdaorm-svc/commit/6a99932ba30592584ec77df266fc5913634898fa)), closes [#189](https://github.com/lambda-orm/lambdaorm-svc/issues/189)
* complete readme ([9f17af2](https://github.com/lambda-orm/lambdaorm-svc/commit/9f17af2383d21745b907155b0e4ab6b035e4d974)), closes [#189](https://github.com/lambda-orm/lambdaorm-svc/issues/189)
* complete readme ([6b7083f](https://github.com/lambda-orm/lambdaorm-svc/commit/6b7083fe6673a5ef3c87568b67fe53ac864e5ce8)), closes [#189](https://github.com/lambda-orm/lambdaorm-svc/issues/189)
* **depens:** update lambdaorm dependence ([cea5225](https://github.com/lambda-orm/lambdaorm-svc/commit/cea5225d689130b92465228656714e2e4c273fd3)), closes [#201](https://github.com/lambda-orm/lambdaorm-svc/issues/201)
* **docs:** add usage on readme ([401fbe7](https://github.com/lambda-orm/lambdaorm-svc/commit/401fbe71dc26d970be791f3b67ea97017ec37754)), closes [#201](https://github.com/lambda-orm/lambdaorm-svc/issues/201)
* **docs:** update readme and wiki ([85fc4ec](https://github.com/lambda-orm/lambdaorm-svc/commit/85fc4ec6f8e96a10ecc50c92134e2a3ee5c4e80c)), closes [#201](https://github.com/lambda-orm/lambdaorm-svc/issues/201)
* fix: request without response data ([c9bd639](https://github.com/lambda-orm/lambdaorm-svc/commit/c9bd63902a9ac57ec5f96330e1d943d5675faefb)), closes [#201](https://github.com/lambda-orm/lambdaorm-svc/issues/201)
* **queue:** refactorize consumer ([e49120e](https://github.com/lambda-orm/lambdaorm-svc/commit/e49120ebff480d27f306a412d14b27f4127d8f11)), closes [#201](https://github.com/lambda-orm/lambdaorm-svc/issues/201)
* **queue:** test cqrs with kafka ([b4a3d05](https://github.com/lambda-orm/lambdaorm-svc/commit/b4a3d053f13942ee7f32088464cd8f15b1332b18)), closes [#201](https://github.com/lambda-orm/lambdaorm-svc/issues/201)
* remove /api prefix on endpoints, refactorize folders and complete readme ([bc575cc](https://github.com/lambda-orm/lambdaorm-svc/commit/bc575cce24063411a59f7d1db30f7fa0c7eb15e4)), closes [#189](https://github.com/lambda-orm/lambdaorm-svc/issues/189)
* remove orb library for apply on lambdaorm ([15da943](https://github.com/lambda-orm/lambdaorm-svc/commit/15da9436c749b960719ac29fc84a3ad854b7cd03)), closes [#201](https://github.com/lambda-orm/lambdaorm-svc/issues/201)
* rename datasource for souce ([3fd0a8b](https://github.com/lambda-orm/lambdaorm-svc/commit/3fd0a8b795dd8a57a95d3a8fdc8959bd218bd25f)), closes [#224](https://github.com/lambda-orm/lambdaorm-svc/issues/224)
* **schema:** add schema endpoint ([24d7055](https://github.com/lambda-orm/lambdaorm-svc/commit/24d7055ea3a01070954c8d00eb2e3006f5069ba7)), closes [#202](https://github.com/lambda-orm/lambdaorm-svc/issues/202)
* **schema:** add version and views ([439b45b](https://github.com/lambda-orm/lambdaorm-svc/commit/439b45bad5f687a6ff7774a95d6f5d5ed82ad443)), closes [#202](https://github.com/lambda-orm/lambdaorm-svc/issues/202)
* test cqrs ([279339d](https://github.com/lambda-orm/lambdaorm-svc/commit/279339d554c5f3981659b54553b64eaeca100fe3)), closes [#201](https://github.com/lambda-orm/lambdaorm-svc/issues/201)
* update lambdaorm dependencie ([285fb49](https://github.com/lambda-orm/lambdaorm-svc/commit/285fb496aba3169172bb3ef3ca19b92b7cc5be50)), closes [#224](https://github.com/lambda-orm/lambdaorm-svc/issues/224)
* update readme ([ba346c8](https://github.com/lambda-orm/lambdaorm-svc/commit/ba346c865f20b6a39443dac5ce7fb12e16707e86)), closes [#189](https://github.com/lambda-orm/lambdaorm-svc/issues/189)
* **wiki:** update Sidebar ([5eac40d](https://github.com/lambda-orm/lambdaorm-svc/commit/5eac40d00c447818316842222da4005a60a6b9c1)), closes [#201](https://github.com/lambda-orm/lambdaorm-svc/issues/201)
* **wiki:** update wiki ([1cbd2c0](https://github.com/lambda-orm/lambdaorm-svc/commit/1cbd2c0c0c6ab64a2d8b04a46bc1b22f6d8c18de)), closes [#201](https://github.com/lambda-orm/lambdaorm-svc/issues/201)

**Bug Fixes:**

* solve bug on body parameters ([647df0d](https://github.com/lambda-orm/lambdaorm-svc/commit/647df0d11112e47861fd859125b572f47a8f5da9)), closes [#189](https://github.com/lambda-orm/lambdaorm-svc/issues/189)
* solve import request data ([413fc78](https://github.com/lambda-orm/lambdaorm-svc/commit/413fc7892c60d2374e2f310fd71cadc9dda92a0a)), closes [#201](https://github.com/lambda-orm/lambdaorm-svc/issues/201)

### [1.1.1](https://github.com/lambda-orm/lambdaorm-svc/compare/v1.1.0...v1.1.1) (2023-12-27)

## [1.1.0](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.60...v1.1.0) (2023-12-23)

**Features:**

* update lambdaorm dependencie ([285fb49](https://github.com/lambda-orm/lambdaorm-svc/commit/285fb496aba3169172bb3ef3ca19b92b7cc5be50)), closes [#224](https://github.com/lambda-orm/lambdaorm/issues/224)

### [0.8.60](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.59...v0.8.60) (2023-12-22)

### [0.8.59](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.58...v0.8.59) (2023-12-22)

**Features:**

* rename datasource for source ([3fd0a8b](https://github.com/lambda-orm/lambdaorm-svc/commit/3fd0a8b795dd8a57a95d3a8fdc8959bd218bd25f)), closes [#224](https://github.com/lambda-orm/lambdaorm/issues/224)

### [0.8.58](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.57...v0.8.58) (2023-12-17)

**Features:**

* **docs:** add usage on readme ([401fbe7](https://github.com/lambda-orm/lambdaorm-svc/commit/401fbe71dc26d970be791f3b67ea97017ec37754)), closes [#201](https://github.com/lambda-orm/lambdaorm/issues/201)

### [0.8.57](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.56...v0.8.57) (2023-12-16)

**Features:**

* test cqrs ([279339d](https://github.com/lambda-orm/lambdaorm-svc/commit/279339d554c5f3981659b54553b64eaeca100fe3)), closes [#201](https://github.com/lambda-orm/lambdaorm/issues/201)

### [0.8.56](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.55...v0.8.56) (2023-12-16)

**Features:**

* **queue:** test cqrs with kafka ([b4a3d05](https://github.com/lambda-orm/lambdaorm-svc/commit/b4a3d053f13942ee7f32088464cd8f15b1332b18)), closes [#201](https://github.com/lambda-orm/lambdaorm/issues/201)

### [0.8.55](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.54...v0.8.55) (2023-12-16)

**Features:**

* **queue:** refactorize consumer ([e49120e](https://github.com/lambda-orm/lambdaorm-svc/commit/e49120ebff480d27f306a412d14b27f4127d8f11)), closes [#201](https://github.com/lambda-orm/lambdaorm/issues/201)

### [0.8.54](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.53...v0.8.54) (2023-12-13)

**Features:**

* fix: request without response data ([c9bd639](https://github.com/lambda-orm/lambdaorm-svc/commit/c9bd63902a9ac57ec5f96330e1d943d5675faefb)), closes [#201](https://github.com/lambda-orm/lambdaorm/issues/201)

### [0.8.53](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.52...v0.8.53) (2023-12-13)

**Features:**

* **wiki:** update Sidebar ([5eac40d](https://github.com/lambda-orm/lambdaorm-svc/commit/5eac40d00c447818316842222da4005a60a6b9c1)), closes [#201](https://github.com/lambda-orm/lambdaorm/issues/201)

**Bug Fixes:**

* solve import request data ([413fc78](https://github.com/lambda-orm/lambdaorm-svc/commit/413fc7892c60d2374e2f310fd71cadc9dda92a0a)), closes [#201](https://github.com/lambda-orm/lambdaorm/issues/201)

### [0.8.52](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.51...v0.8.52) (2023-12-02)

**Features:**

* remove orb library for apply on lambdaorm ([15da943](https://github.com/lambda-orm/lambdaorm-svc/commit/15da9436c749b960719ac29fc84a3ad854b7cd03)), closes [#201](https://github.com/lambda-orm/lambdaorm/issues/201)
* **wiki:** update wiki ([1cbd2c0](https://github.com/lambda-orm/lambdaorm-svc/commit/1cbd2c0c0c6ab64a2d8b04a46bc1b22f6d8c18de)), closes [#201](https://github.com/lambda-orm/lambdaorm/issues/201)

### [0.8.51](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.50...v0.8.51) (2023-11-29)

**Features:**

* **docs:** update readme and wiki ([85fc4ec](https://github.com/lambda-orm/lambdaorm-svc/commit/85fc4ec6f8e96a10ecc50c92134e2a3ee5c4e80c)), closes [#201](https://github.com/lambda-orm/lambdaorm/issues/201)

### [0.8.50](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.49...v0.8.50) (2023-11-28)

### [0.8.49](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.48...v0.8.49) (2023-11-28)

**Features:**

* **depens:** update lambdaorm dependence ([cea5225](https://github.com/lambda-orm/lambdaorm-svc/commit/cea5225d689130b92465228656714e2e4c273fd3)), closes [#201](https://github.com/lambda-orm/lambdaorm/issues/201)

### [0.8.48](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.47...v0.8.48) (2023-11-28)

### [0.8.47](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.46...v0.8.47) (2023-11-26)

### [0.8.46](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.45...v0.8.46) (2023-11-26)

### [0.8.45](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.44...v0.8.45) (2023-11-21)

**Features:**

* **schema:** add schema endpoint ([24d7055](https://github.com/lambda-orm/lambdaorm-svc/commit/24d7055ea3a01070954c8d00eb2e3006f5069ba7)), closes [#202](https://github.com/lambda-orm/lambdaorm/issues/202)

### [0.8.44](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.43...v0.8.44) (2023-11-21)

**Features:**

* **schema:** add version and views ([439b45b](https://github.com/lambda-orm/lambdaorm-svc/commit/439b45bad5f687a6ff7774a95d6f5d5ed82ad443)), closes [#202](https://github.com/lambda-orm/lambdaorm/issues/202)

### [0.8.43](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.42...v0.8.43) (2023-11-17)

**Features:**

* remove /api prefix on endpoints, refactorize folders and complete readme ([bc575cc](https://github.com/lambda-orm/lambdaorm-svc/commit/bc575cce24063411a59f7d1db30f7fa0c7eb15e4)), closes [#189](https://github.com/lambda-orm/lambdaorm/issues/189)

### [0.8.42](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.41...v0.8.42) (2023-11-17)

**Features:**

* update readme ([ba346c8](https://github.com/lambda-orm/lambdaorm-svc/commit/ba346c865f20b6a39443dac5ce7fb12e16707e86)), closes [#189](https://github.com/lambda-orm/lambdaorm/issues/189)

### [0.8.41](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.40...v0.8.41) (2023-11-17)

**Features:**

* complete readme ([9f17af2](https://github.com/lambda-orm/lambdaorm-svc/commit/9f17af2383d21745b907155b0e4ab6b035e4d974)), closes [#189](https://github.com/lambda-orm/lambdaorm/issues/189)

### [0.8.40](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.39...v0.8.40) (2023-11-17)

**Features:**

* complete readme ([6b7083f](https://github.com/lambda-orm/lambdaorm-svc/commit/6b7083fe6673a5ef3c87568b67fe53ac864e5ce8)), closes [#189](https://github.com/lambda-orm/lambdaorm/issues/189)

### [0.8.39](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.38...v0.8.39) (2023-11-17)

**Features:**

* add beatiful format on endpoints ([6a99932](https://github.com/lambda-orm/lambdaorm-svc/commit/6a99932ba30592584ec77df266fc5913634898fa)), closes [#189](https://github.com/lambda-orm/lambdaorm/issues/189)

### [0.8.38](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.37...v0.8.38) (2023-11-17)

### [0.8.37](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.36...v0.8.37) (2023-11-16)

**Bug Fixes:**

* solve bug on body parameters ([647df0d](https://github.com/lambda-orm/lambdaorm-svc/commit/647df0d11112e47861fd859125b572f47a8f5da9)), closes [#189](https://github.com/lambda-orm/lambdaorm/issues/189)

### [0.8.36](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.35...v0.8.36) (2023-11-15)

### [0.8.35](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.34...v0.8.35) (2023-11-15)

**Features:**

* **licence:** change licence to MIT and update email ([8b4298f](https://github.com/lambda-orm/lambdaorm-svc/commit/8b4298f1da7e262e9059302f8183a55ae6023f0e)), closes [#189](https://github.com/lambda-orm/lambdaorm/issues/189)

### [0.8.34](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.33...v0.8.34) (2023-11-09)

**Features:**

* **dependenpies:** add dependabot ([76094ff](https://github.com/lambda-orm/lambdaorm-svc/commit/76094ff62964f0483a7f7d7f7ce1c643796df1bc)), closes [#176](https://github.com/lambda-orm/lambdaorm/issues/176)

### [0.8.33](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.32...v0.8.33) (2023-11-09)

**Bug Fixes:**

* **publish:** bugfix build on github workflow ([0f8c8d9](https://github.com/lambda-orm/lambdaorm-svc/commit/0f8c8d9956d9fe5cbe518e06de71e1c0565265d4)), closes [#176](https://github.com/lambda-orm/lambdaorm/issues/176)

### [0.8.32](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.31...v0.8.32) (2023-11-09)

### [0.8.31](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.30...v0.8.31) (2023-11-09)

### [0.8.30](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.29...v0.8.30) (2023-11-09)

### [0.8.29](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.28...v0.8.29) (2023-11-09)

### [0.8.28](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.27...v0.8.28) (2023-11-09)

### [0.8.27](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.26...v0.8.27) (2023-11-09)

### [0.8.26](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.25...v0.8.26) (2023-11-09)

### [0.8.25](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.24...v0.8.25) (2023-11-09)

### [0.8.24](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.23...v0.8.24) (2023-11-09)

### [0.8.23](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.22...v0.8.23) (2023-11-09)

### [0.8.22](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.21...v0.8.22) (2023-11-09)

### [0.8.21](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.10...v0.8.21) (2023-11-09)

### [0.8.10](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.9...v0.8.10) (2023-11-09)

### [0.8.9](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.8...v0.8.9) (2023-11-09)

**Features:**

* **release:** update github actions ([51d4215](https://github.com/lambda-orm/lambdaorm-svc/commit/51d4215987ddeb2e1a2fa66c688c215fb72d7527)), closes [#176](https://github.com/lambda-orm/lambdaorm/issues/176)

### [0.8.8](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.7...v0.8.8) (2023-11-07)

### [0.8.7](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.6...v0.8.7) (2023-11-07)

**Features:**

* **release:** add dist task on release workflow ([99e7d06](https://github.com/lambda-orm/lambdaorm-svc/commit/99e7d068833942a981b4d7dd9d387204e4c40dd3)), closes [#176](https://github.com/lambda-orm/lambdaorm/issues/176)

### [0.8.6](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.5...v0.8.6) (2023-11-07)

**Features:**

* **release:** update workflow ([c5b2d99](https://github.com/lambda-orm/lambdaorm-svc/commit/c5b2d991eee5bd0c80744f870de2edf559b8b71d)), closes [#176](https://github.com/lambda-orm/lambdaorm/issues/176)

### [0.8.5](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.4...v0.8.5) (2023-11-07)

**Features:**

* **release:** update workflow ([63954b7](https://github.com/lambda-orm/lambdaorm-svc/commit/63954b7c1b340a3f5a8cc05abe9c45d80ecf22e1)), closes [#176](https://github.com/lambda-orm/lambdaorm/issues/176)

### [0.8.4](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.3...v0.8.4) (2023-11-06)

**Features:**

* update release workflow ([bae0678](https://github.com/lambda-orm/lambdaorm-svc/commit/bae06784ebfc34e57c2c1cdb6abce5f9b034f0cc)), closes [#176](https://github.com/lambda-orm/lambdaorm/issues/176)

### [0.8.3](https://github.com/lambda-orm/lambdaorm-svc/compare/v0.8.2...v0.8.3) (2023-11-06)

**Features:**

* adjust release workflow ([4add60f](https://github.com/lambda-orm/lambdaorm-svc/commit/4add60fba31b9508c70049e41792f652b6fd0c69)), closes [#176](https://github.com/lambda-orm/lambdaorm/issues/176)

### [0.8.2](https://github.com/lambda-orm/lambdaorm/compare/v0.8.1...v0.8.2) (2023-11-05)

### [0.8.1](https://github.com/lambda-orm/lambdaorm/compare/v0.7.21...v0.8.1) (2023-11-05)

### [0.7.21](https://github.com/lambda-orm/lambdaorm/compare/v0.6.5...v0.7.21) (2023-11-05)
