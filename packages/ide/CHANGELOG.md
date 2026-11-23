# Changelog

### 1.0.0 (unreleased)

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
