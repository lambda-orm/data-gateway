# Changelog

### 1.0.0 (unreleased)

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
- From a connection, with its credential and through the backend, in tabs: its REST API (Swagger), its WebSocket (its
  methods, a JSON-RPC console) and its MCP (its tools, called) — where they are from `GET /transports` of its
  management, or the URLs the connection fixes.
