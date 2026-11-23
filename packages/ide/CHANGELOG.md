# Changelog

### 1.0.0 (unreleased)

The UI of the data-gateway becomes the data-gateway-ide, built two ways:

- **The IDE** (its own image, `flaviorita/data-gateway-ide`): no home, no login. It connects to data-gateways, each with
  its URL (protocol, host, port and base path) and its credential (API key, bearer, basic or none); their schemas,
  workspaces and projects stay in them, as a database IDE connects to databases. The connections stay in the browser
  (the key only when asked to be remembered); each one shows its schemas in the explorer, and its page who that
  credential is and what it may do (its roles, each with what it allows). Tabs of several connections side by side.
  In the explorer, the connections under their root: add one, edit it, remove it (from the IDE only).
  From a connection, with its credential, in tabs: its REST API (Swagger), its WebSocket (its methods, a JSON-RPC
  console) and its MCP (its tools, called) — where they are from `GET /transports`, or the public URLs the connection
  fixes behind a proxy.
- **Embedded** (`--mode embedded`), served by a data-gateway at `{basePath}/ui`: its home and login as before, the
  workspace on its one connection, shown as the current one.
