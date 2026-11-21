# @lambdaorm/data-gateway-client

## 0.1.0

### Minor Changes

- 5edab28: `schema.search(text)` and `schema.describe(entities)`: a large schema as compact text, on the five transports.
- 6145069: The Node client of the λORM Data Gateway. `connect(url, options)` chooses the transport by the scheme of the
  connection string: `http(s)://` the REST API, `ws(s)://` JSON-RPC over WebSocket (with notifications),
  `mcp+http(s)://` MCP Streamable HTTP, `mcp+sse(s)://` the legacy MCP HTTP+SSE, `mcp+ws(s)://` MCP over WebSocket. The
  same API on the five (`execute`, `executeScript`, `executeQueued`, `plan`, `metadata`, `schema.*`, `stage.*`, …) and
  one `GatewayError` whose `code` (`invalid`, `forbidden`, `not_found`, `unique`, `foreign_key`, `truncated`, …) is the
  same whichever transport the error came by. The credential goes apart (`apiKey`, `token`, or `DATA_GATEWAY_API_KEY` /
  `DATA_GATEWAY_TOKEN`), never in the URL. It passes the conformance suite of the gateway on the five transports.
- 2923a57: The errors of a query for a name that doesn't exist carry the closest names as data, `suggestions: [{ name: 'nme',
didYouMean: ['name'] }]` (SchemaError and SintaxisError), for a client to offer them. The data gateway answers them on
  REST, WebSocket and MCP, and the Node client's GatewayError has them.

### Patch Changes

- Updated dependencies [2923a57]
- Updated dependencies [d1decf3]
- Updated dependencies [8ecbb98]
  - @lambdaorm/base@3.5.0
