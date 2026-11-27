# @lambdaorm/data-gateway-client-node

## 0.2.0

### Minor Changes

- 80440c8: `client.approval(id)` and `isApprovalPending(result)`: a write that waits for a person to approve it (gateway 4.3,
  `docs/MUTATION_APPROVAL.md`) answers `{ approval, status: 'pending', expiresAt }` at once; `approval(id)` tells its state
  (pending, done with its result, failed, rejected, expired), on every transport.
- 23887f8: `client.queries()` lists the queries of `application.queries` that the credential can use (their parameters and
  model) and `client.query(name, data)` runs one by its name, on every transport (on MCP, the tool `query_<name>`): the
  named queries of the gateway 4.1.0 (`docs/NAMED_QUERIES.md`).
- b153e2d: `client.subscribe({ entity } | { query, data } | { name, data }, listener)` over a `ws(s)://` connection: the writes
  of an entity, or a query run again when what it reads changes (the subscriptions of the gateway, `docs/SUBSCRIPTIONS.md`);
  it answers the subscription, the first result of a query and `unsubscribe()`.
- 9e83577: `token` can be a function that gives it (`token: () => idp.accessToken()`): it is asked for on every request of REST
  and MCP over HTTP, and on opening a WebSocket, so the token of an identity provider can be refreshed (the JWT of the
  gateway 4.1.0, `docs/JWT.md`).

### Patch Changes

- 6804c59: `@lambdaorm/base` ^3.11.1 (its types of the λORM the gateway 4.1.0 runs).
- d552889: The package can be imported from an ES module (`import { connect } from '@lambdaorm/data-gateway-client-node'`): its
  `exports` said only `require`, so `import` failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`.

## 0.1.1

### Patch Changes

- Updated dependencies [37a1e21]
  - @lambdaorm/base@3.6.0

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
