# @lambdaorm/data-gateway-client

[![npm version](https://img.shields.io/npm/v/@lambdaorm/data-gateway-client.svg)](https://www.npmjs.com/package/@lambdaorm/data-gateway-client)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

The Node client of the [λORM Data Gateway](https://lambda-orm.github.io/wiki/data-gateway/). One API, five transports:
the scheme of the connection string chooses REST, WebSocket or MCP, and the same query gives the same result, and the
same error the same code, whichever you use.

```sh
npm install @lambdaorm/data-gateway-client
```

```ts
import { connect } from '@lambdaorm/data-gateway-client'

const gateway = await connect('http://localhost:8080/northwind', { apiKey: process.env.GATEWAY_KEY })
const products = await gateway.execute(
	'Products.filter(p => p.price > minPrice).map(p => ({ name: p.name, price: p.price })).sort(p => desc(p.price)).page(1, 3)',
	{ minPrice: 50 }
)
await gateway.close()
```

## The connection string

| Connection string | Transport of the gateway |
| --- | --- |
| `http://host:8080/northwind`, `https://…` | REST API (`transports.http`) |
| `ws://host:8083/northwind`, `wss://…` | JSON-RPC 2.0 over WebSocket (`transports.webSocket`), with notifications |
| `mcp+http://host:8081/northwind`, `mcp+https://…` | MCP Streamable HTTP (`transports.mcpHttp`) |
| `mcp+sse://host:8081/northwind`, `mcp+sses://…` | MCP HTTP+SSE, the legacy one (`transports.mcpHttp` with `legacySse`) |
| `mcp+ws://host:8082/northwind`, `mcp+wss://…` | MCP over WebSocket (`transports.mcpWebSocket`, not standard) |

The path is the route of the schema (`iot/v1`, after a `basePath` if the gateway has one). The URL can carry
`?timeout=<ms>` and `?stage=<stage>`; a credential in it (`user:pass@`, `?apiKey=`, `?token=`) is an error. The
credential goes in the options, or in the environment:

| Option | Environment | |
| --- | --- | --- |
| — | `DATA_GATEWAY_URL` | the connection string when `connect()` gets none |
| `apiKey` | `DATA_GATEWAY_API_KEY` | sent as `X-Api-Key` (or the header of `apiKeyHeader`) |
| `token` | `DATA_GATEWAY_TOKEN` | sent as `Authorization: Bearer <token>` |
| `headers` | | any other header |
| `timeout` | | milliseconds of each operation (default 30000) |
| `stage` | | the stage of every query, unless its options say another |
| `onTruncated` | | MCP: a list cut at the `mcp.maxRows` of the gateway is the error `truncated` (default), or `'return'` its cut rows |

## The API

| | |
| --- | --- |
| `execute(query, data?, options?)` | runs a query: its rows, or what an insert, update or delete answers |
| `executeScript(script, data?, options?)` | a script of λORM in one transaction (the gateway needs `scripts.enabled`) |
| `executeQueued(query, topic, data?, chunk?, options?)` | queues a query to run in the background |
| `plan(query, options?)` | the sentences it would run, without running them |
| `metadata(query)`, `model(query)`, `parameters(query)`, `constraints(query)` | what the query reads, returns and needs |
| `schema.entities()`, `schema.entity(name)`, `schema.enums()`, `schema.sources()`, `schema.mappings()`, `schema.stages()`, `schema.views()`, `schema.domain()`, `schema.version()`, … | the schema as the gateway loaded it |
| `schema.search(text)`, `schema.describe(entities)` | a large schema as compact text: entities, properties and relations by part of their name (`Areas.type` only in Areas, the closest names when nothing matches), and some entities in two lines each |
| `stage.exists(stage)`, `stage.export(stage)`, `stage.import(stage, data)` | the data of a stage |
| `general.version()`, `general.health()` | the gateway |
| `whoami()` | the credential and its permissions (REST) |
| `on(event, listener)` | `queue.completed`, `queue.failed`, `schema.statusChanged` (WebSocket) |
| `close()` | closes the connection |

A query is the text of a λORM expression, with its variables in `data`; it can also be a function whose text is one:
`gateway.execute(() => Products.filter(p => p.price > 10))`.

## Errors

Every operation that fails throws a `GatewayError`. Its `code` is the same on the five transports:

```ts
import { GatewayError } from '@lambdaorm/data-gateway-client'

try {
	await gateway.execute('Categories.insert()', { name: 'Beverages' })
} catch (error) {
	if (error instanceof GatewayError && error.code === 'unique') {
		// already exists
	}
}
```

| `code` | When |
| --- | --- |
| `invalid` | the query, the model or a value is wrong (`SchemaError`, `SintaxisError`, `ValidationError`, …) |
| `unauthorized`, `forbidden` | no valid credential; the credential lacks the permission |
| `not_found` | a name the schema doesn't have, or a script's `throw { status: 404 }` |
| `unique`, `foreign_key`, `conflict` | the database refused it: a unique key, a foreign key, another conflict |
| `timeout`, `too_large`, `rate_limited`, `unavailable`, `internal` | the gateway couldn't do it |
| `truncated` | MCP: the list was cut at `mcp.maxRows` |
| `unsupported` | the operation is not on that transport (`on` outside WebSocket, `whoami` outside REST) |
| `transport` | the connection failed |

`errorName` is the name the gateway gave the error, `status` its HTTP status, `dbCode` the code of the database, and `suggestions`, for a name of the query that doesn't exist, the closest ones (`[{ name: 'nme', didYouMean: ['name'] }]`).

Every case of the conformance suite of the gateway runs on the five transports with this client, against a real
gateway (`scripts/ci-local.sh clients` in the repository).

## License

[MIT](https://opensource.org/licenses/MIT)
