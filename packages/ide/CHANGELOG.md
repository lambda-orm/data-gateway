# Changelog

### Unreleased

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
