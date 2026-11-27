# Changelog

### Unreleased

- **Administration, in the explorer:** each connection has a node **Administration** above its schemas, with what its
  credential may do: **Roles** (the permissions by role, a role by row and a permission by column, with its schemas;
  Add role; and each role as a node: all it gives, its permissions and, by schema, its views and stages with the
  defaults marked, with Edit and Remove; Edit has a box per permission and, for each schema chosen, its views and
  stages to check and the default view and stage), **Access** (each key or token, where it applies, its roles and its context; never a secret),
  **Persist** (where the gateway keeps its administration) and **Config** (its lambdaORM.yaml, in Monaco, read only),
  **Sessions**, **Writes that wait**, **Tools** (REST API, WebSocket, MCP) and **Observability** (Metrics, Logs,
  Traces: what is sent, the OTLP exporter and where it is seen in Grafana, saved and applied at once). Needs
  data-gateway 5.0.
- **The page of a connection** has only the connection: its form and who it is there, its user and its roles with
  their permissions, views, stages and schemas (`GET /admin/me`). Its tabs (Tools, Roles, Sessions, Writes that wait)
  moved to Administration.
- **The traces of an entity, from its gateway:** the link of an entity to its traces in Grafana comes from the
  configuration of the gateway (`observability.explore`, data-gateway 4.5, `GET /observability` of its management).
  The section **Observability** of a connection (Grafana URL, Tempo datasource) is gone: what was saved there is no
  longer used.
- **The explorer on the left:** the box of the connection fills the height of the side and grows with its tree; past
  the height, the side scrolls and its heading stays.

### 1.4.0 (2026-11-26)

Works with any data-gateway 4.x; the roles of the gateway and the view in the options need data-gateway 4.4.

- **Roles of the gateway:** with the permission `roles` (data-gateway 4.4), the tab **Roles** of a connection lists the
  roles of its configuration (read only) and those of its state; **Add a role**, **Extend** one of the configuration
  (more views, stages or permissions, in every schema or in one), edit or remove one of the state, with a reason; its
  changes, who and when.
- **The options of a query** offer the stages the roles of the credential allow and, when they give more than one, the
  view (data-gateway 4.4).
- The permissions `approve`, `destructive` and `roles` in the list of the permissions of a connection.

### 1.3.0 (2026-11-26)

Works with any data-gateway 4.x; the files of a property and the writes that wait need data-gateway 4.3.

- **Sign in with the identity provider:** a connection can authenticate with **OpenID Connect (sign in)**: its issuer,
  a public client with PKCE and its scopes. **Sign in** opens the login of the provider (a window of its own; in the
  desktop app, the browser of the system, back to a loopback of the app); its token stays in the tab and is renewed
  before it ends. The backend of the IDE reaches the provider: its origin goes in `DATA_GATEWAY_IDE_TARGETS`.
- `DATA_GATEWAY_IDE_CONNECT_SRC`: the storages of the files the page may reach itself (the bytes go straight to them);
  the desktop app allows `https:`.
- **Files:** in **Data**, a property that keeps files (data-gateway 4.3) opens its file, and with `write` uploads
  another (straight to the storage) or removes it.
- **Panels:** **New panel** in the workbench: cards of queries shown as a number, a table, bars, lines or a pie;
  refreshed by hand or every so often; saved in the workbench.
- **Writes that wait:** with `approve`, the page of a connection has the tab of the writes of agents that wait for a
  person (data-gateway 4.3): what each would run, its data and who asked; approve it (it runs as who asked) or reject it
  with a reason.
- **Vectors and points** (λORM 3.15): the forms of the schema offer `vector` (its dimensions) and `point`, and the
  indexes `hnsw`, `ivfflat` and `spatial`; in **Data**, a point shows as longitude, latitude with a link to a map and
  is edited in two fields; a vector shows its first numbers and how many, and is written in the form of a row.
- **Its icon:** λORM on a blue rounded square, only the λ where λORM can't be read (a tab of the browser, 16 to 48
  px); in the browser (favicon) and as the icon of the desktop app.
- **The desktop app** has no bar of a menu on Windows and Linux (the page has its own); on macOS only the menu of the
  app and Edit.
- **The tree:** each connection is a card, its explorer inside, with its heading on one line: the name, and its URL
  smaller and muted.

### 1.2.0 (2026-11-26)

Works with any data-gateway 4.x: the table uses `execute`, with the credential of the connection.

- **The data of an entity as a backoffice:** with a credential that writes, a double click changes a cell (only while
  it still has what was read: if someone changed it, the table says so), **Add a row** and **Delete the row**; any
  credential sorts by a column, filters with a condition and exports the page or everything (up to 100 000 rows, with
  progress) as CSV, JSON or Excel (.xlsx).

### 1.1.0 (2026-11-25)

For the data-gateway 4.1.0; what needs it says so (an older gateway doesn't offer it).

- **The identity:** a connection takes the token of an identity provider as its **Bearer token (JWT)**; when it
  expires the connection says so and asks for a new one. The workbench says the **view** of the credential (the gateway
  chooses it by the identity), and the options of a query no longer offer one.
- **Commands:** the preview of **push** (and of **migrate**) lists the changes that can lose data and runs them only
  once allowed; **migrations** shows the history of the stage, with **go back here** on an applied version
  (**migrate**); **seed** shows its files and inserts the rows that are not there.
- **History:** the changes of a schema (who, when, what, the diff and the element before and after) in the view of the
  schema and in the tab History of an entity.
- **A change of another session** (another IDE, the administration of another person) is announced with who changed
  what and a Refresh; a form that meets a change says who made it.
- **Traces:** every request carries a W3C `traceparent` (the requests of one action share a trace), so the gateway and
  λORM continue it; a connection can say where its Grafana is (and its Tempo datasource), and an entity links to its
  traces.
- **The diagram of a stage:** each source with the tables that live in it and those whose reads or writes it takes; and
  every diagram has an outline.
- **Entities:** their constraints in a tab of their own and under the properties they use; the `readValue` and
  `writeValue` of the properties; the keys with the indexes (**Keys and indexes**), in the view and in the form;
  **Relations (n)** counts its own relations.
- **The query wizard** reads a query it didn't write (or one edited by hand), shows a table without a map with every
  field ticked, and its help gives an example of the entity.
- **The explorer:** the state and the source code of a schema under its metadata; the actions of a connection, a schema
  and an entity in what opens when it is chosen; what is saved shows as **Workbench**, and **New project** opens a
  dialog of that name.
- **The app:** its menu named λORM Data Gateway, on top; every request with its session; a connection by its name.
- **Texts:** the names of λORM (source, stage, view, mapping, domain, plan, metadata, execute, Workbench) stay as
  written in the ten languages and the rest is translated (the tabs of a result, Metadata, About); the variables
  (.env) have the headers of their columns.

### 1.0.0 (2026-11-23)

**The desktop app** (`packages/ide-desktop`, Electron): the IDE for Linux (AppImage, deb), Windows (installer) and
macOS (dmg, zip), x64 and arm64, from the releases `ide-v<version>` of this repository. The app is served at
`app://ide` and its proxy listens on `127.0.0.1` for its page only (a token per run). Windows and the AppImage update
themselves; macOS and the deb tell that a new version is out. Not signed yet.

The UI of the data-gateway becomes the data-gateway-ide, its own image (`flaviorita/data-gateway-ide`): no home, no
login. It connects to data-gateways (4.0.0 or later), each with the URL of its `management` port and its credential
(API key, bearer, basic or none); their schemas, workspaces and projects stay in them, as a database IDE connects to
databases.

- **Its backend** (`server/server.mjs`, Node) serves the app and is its proxy: the browser talks only to it, and a
  request to a gateway carries the gateway's URL in its path (`/gw/{base64url}/…`), REST, MCP and WebSocket alike. The
  gateways answer no CORS. `DATA_GATEWAY_IDE_TARGETS` lists the origins it may reach (`*`: any).
- The connections stay in the browser (the key only when asked to be remembered); each one shows its schemas in the
  explorer, and its page who that credential is and what it may do (its roles, each with what it allows). Tabs of
  several connections side by side. In the explorer, the connections under their root: add one, edit it, remove it
  (from the IDE only).
- **Sessions of management:** a connection logs in to the management of its gateway and keeps the token in the tab;
  every request carries it, never the key. An expired session is renewed by itself when the key is at hand; a revoked
  one says who revoked it and waits. The WebSocket of events of the gateway makes it "connected" and replaces the
  polling of the schemas. The page of a connection lists its sessions (close one, close the others) and, with
  `sessionAdmin`, every session of the gateway by credential (revoke one, or all of a credential).
- The backend tells the gateway the address of the browser (`X-Forwarded-For`, believed from its
  `trustedProxies`).
- From a connection, with its credential and through the backend, in tabs: its REST API (Swagger), its WebSocket (its
  methods, a JSON-RPC console) and its MCP (its tools, called) — where they are from `GET /transports` of its
  management, or the URLs the connection fixes.
- **The query wizard:** the tables as in a diagram with a check on each field, the + of a table adding its related
  ones (each relation an include of its own), a filter on the entity it starts from with its suggestions, the order
  and the page; it writes the query in a new tab and stays with it and with the saved query, to be opened again.
- The options of a query as a form (the stages and views of its schema to choose), in one line with an edit; the data
  folds while it is empty.
- The window as a whole: the explorer and the open tab scroll each on their own, a flat tab bar, one height for the
  controls of each bar; a visual pass (one palette and scale, hover and focus states, dialogs, menus and tables).
