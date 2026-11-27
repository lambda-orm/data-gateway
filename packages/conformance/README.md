# Data Gateway conformance suite

The cases every client of the [Data Gateway](../data-gateway/README.md) must pass, the same on each of the five
transports: the same query gives the same result, and the same error the same code, whether it goes by REST, by
WebSocket or by MCP. The plan of the clients: [`docs/DATA_GATEWAY_CLIENTS_PLAN.md`](../../docs/DATA_GATEWAY_CLIENTS_PLAN.md).

Not published: the clients of this repository run it from here: Node (`packages/client-node`, `npx tsx
conformance/run.ts`) and Go (`packages/client-go`, `go run ./conformance`); Rust and the CLI when they exist.

## Run it

```sh
scripts/ci-local.sh clients                                 # against the gateway from source
scripts/ci-local.sh clients flaviorita/data-gateway:3.2.0   # against an image
```

or by hand, from this folder:

```sh
./conformance.sh up image     # Postgres and the gateway of DATA_GATEWAY_IMAGE (fresh)
./conformance.sh data         # the tables of northwind and its data
node runner/index.mjs         # every case on every transport (--transport http,ws  --case <text>)
./conformance.sh down
```

| What | Where |
| --- | --- |
| Postgres with northwind | `127.0.0.1:19432` |
| `http` (REST) | `http://127.0.0.1:19080/northwind` |
| `mcpHttp` (Streamable HTTP and the legacy HTTP+SSE) | `mcp+http://127.0.0.1:19081/northwind`, `mcp+sse://127.0.0.1:19081/northwind` |
| `mcpWebSocket` | `mcp+ws://127.0.0.1:19082/northwind` |
| `webSocket` (JSON-RPC) | `ws://127.0.0.1:19083/northwind` |
| credentials (header `X-Api-Key`) | `conformance-reader-key` (`read`), `conformance-backend-key` (`read, write, script, queue, stageImport`) |
| tokens (`Authorization: Bearer`, JWT HS256) | issuer `https://conformance.lambdaorm`, audience `data-gateway`, the roles `reader` and `backend` in the claim `roles` |

The gateway has `mcp.maxRows: 50`, so a longer list is cut on MCP (the case of 77 products checks it).

## The cases

`cases/*.json`, each file a list of cases. A case runs its steps in order, on each transport, with one connection per
credential:

```json
{
	"name": "insert, update and delete",
	"credential": "backend",
	"transports": ["http", "ws"],
	"steps": [
		{ "operation": "execute", "args": { "query": "Categories.insert()", "data": { "name": "c $transport" } }, "expect": { "match": { "data": { "name": "c $transport" } } } },
		{ "operation": "execute", "args": { "query": "Categories.delete().filter(p => p.name == name)", "data": { "name": "c $transport" } }, "expect": { "result": 1 } }
	]
}
```

- `credential`: `reader` (default) or `backend` (API keys), or `jwtReader`, `jwtBackend`, `jwtExpired`, `jwtSales`: a
  token of a user with that role (or already expired; `jwtSales` has the view `sales` and the claim `country:
  Germany`), signed by the runner with the secret of the suite (HS256,
  `data-gateway.config.yaml`); a client's runner takes them from `credentialOf` of `runner/index.mjs`.
- `transports`: only on these (default: the five: `http`, `ws`, `mcp+http`, `mcp+sse`, `mcp+ws`).
- A case of one step can leave out `steps` and have `operation`, `args`, `expect` (and `mcp`) itself.
- In `args` and in the expectations, `"$0"`, `"$1"`… is the result of that step, and `$transport` (also inside a
  text) is the name of the transport, for values that must not collide between transports.

**Operations** (the common API of the clients, `docs/DATA_GATEWAY_CLIENTS_PLAN.md` §3), with their arguments:
`execute` (`query`, `data`, `options`), `executeScript` (`script`, `data`, `options`), `plan` (`query`, `options`),
`metadata`, `model`, `parameters`, `constraints` (`query`), `queries`, `query` (`name`, `data`, `options`: a query of
`application.queries`; on MCP the tool `query_<name>`, which has no list), `schemaVersion`, `domain`, `entities`, `entity`
(`entity`), `enums`, `enum` (`enum`), `sources`, `source` (`source`), `mappings`, `mapping` (`mapping`), `stages`,
`stage` (`stage`), `views`, `stageExists` (`stage`), `stageExport` (`stage`), `version`, `health`.

**Expectations** (`expect`; `mcp` replaces it on the three MCP transports):

| Key | Passes when |
| --- | --- |
| `result` | the result is equal (the order of the keys of an object doesn't matter) |
| `match` | every key given is there with a matching value; lists have the same length and match one by one |
| `length` | the result is a list of that length |
| `keys` | the result is an object with those keys |
| `type` | `typeof` the result |
| `error` | the operation fails with that `code` (and `name`, when given) |

## Errors

Every client gives an error with the same `code` on every transport, from what the gateway answers:

| Code | When |
| --- | --- |
| `invalid` | 400 or 422: the query, the model or a value (`SchemaError`, `SintaxisError`, `ValidationError`, `LanguageError`, a script's `throw { status: 400 }`) |
| `unauthorized` | 401: no credential, or a wrong one |
| `forbidden` | 403: the credential lacks the permission |
| `not_found` | 404: a name that doesn't exist in the schema (an entity, an enum, a source, a mapping, a stage), or a script's `throw { status: 404 }` |
| `unique` | 409 with the database's code of a unique key (Postgres `23505`, MySQL `ER_DUP_ENTRY` / `1062`, Oracle `ORA-00001`, SQL Server `2627` / `2601`, MongoDB `11000`) |
| `foreign_key` | 409 with the database's code of a foreign key (Postgres `23503`, MySQL `ER_NO_REFERENCED_ROW_2` / `ER_ROW_IS_REFERENCED_2` / `1451` / `1452`, Oracle `ORA-02291` / `ORA-02292`, SQL Server `547`) |
| `conflict` | any other 409 |
| `timeout` | 408 or 504 (`server.timeout`) |
| `too_large` | 413 (`SCRIPT_MAX_LENGTH`, `maxResponseBytes`) |
| `rate_limited` | 429 |
| `unavailable` | 503: the schema is not ready |
| `internal` | any other status |
| `truncated` | MCP only: the list was cut at `mcp.maxRows` (a client can choose to receive the cut rows instead) |
| `unsupported` | the operation doesn't exist on that transport |
| `transport` | the connection failed (refused, closed, a handshake rejected) |

Where the gateway puts the status, the name and the database's code:

| Transport | Status | Name | Database code |
| --- | --- | --- | --- |
| REST | HTTP status | `error` of the body | `code` of the body |
| WebSocket | `error.data.status` | `error.data.name` | `error.data.code` |
| MCP | `structuredContent.status` of an `isError` result | `structuredContent.error` | `structuredContent.code` |

## The reference runner

`runner/` is a client of the five transports in plain Node (≥ 22, no dependencies) that runs the cases: it shows
how each operation and each error travels on each transport, and checks the suite against the gateway before any
client exists. `runner/transports.mjs` is the transports, `runner/errors.mjs` the codes, `runner/index.mjs` the cases.
