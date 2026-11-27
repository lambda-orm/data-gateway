# data-gateway-client-go

The Go client of the [λORM Data Gateway](https://lambda-orm.github.io/wiki/data-gateway/). One API, five transports:
the scheme of the connection string chooses REST, WebSocket or MCP, and the same query gives the same result, and the
same error the same code, whichever you use. The same API as the Node client
([`@lambdaorm/data-gateway-client-node`](../client-node/README.md)).

```sh
go get github.com/lambda-orm/data-gateway-client-go
```

Go ≥ 1.22. Its only dependency is [`github.com/coder/websocket`](https://github.com/coder/websocket).

```go
import gateway "github.com/lambda-orm/data-gateway-client-go"

type Product struct {
	Name  string  `json:"name"`
	Price float64 `json:"price"`
}

gw, err := gateway.Connect(ctx, "http://localhost:8080/northwind", gateway.WithAPIKey(os.Getenv("GATEWAY_KEY")))
if err != nil {
	return err
}
defer gw.Close()
products, err := gateway.ExecuteInto[[]Product](ctx, gw,
	"Products.filter(p => p.price > minPrice).map(p => ({ name: p.name, price: p.price })).sort(p => desc(p.price)).page(1, 3)",
	map[string]any{"minPrice": 50}, nil)
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
| — | `DATA_GATEWAY_URL` | the connection string when `Connect` gets `""` |
| `WithAPIKey(key)` | `DATA_GATEWAY_API_KEY` | sent as `X-Api-Key` (or the header of `WithAPIKeyHeader`) |
| `WithToken(token)` | `DATA_GATEWAY_TOKEN` | sent as `Authorization: Bearer <token>` |
| `WithTokenFunc(f)` | | the token asked for on every request (and on opening a WebSocket): one of an identity provider, refreshed |
| `WithHeader(name, value)` | | any other header |
| `WithTimeout(d)` | | how long each operation can take (default 30 s); the `ctx` of each call can end it before |
| `WithStage(stage)` | | the stage of every query, unless its options say another |
| `WithTruncatedRows()` | | MCP: a list cut at the `mcp.maxRows` of the gateway gives its cut rows (`{ rows, truncated, … }`) instead of the error `truncated` |

## The API

Every operation takes a `context.Context`. A `*Client` is safe for concurrent use.

| | |
| --- | --- |
| `Execute(ctx, query, data, *QueryOptions)`, `ExecuteInto[T](ctx, c, …)` | runs a query: its rows, or what an insert, update or delete answers |
| `ExecuteScript(ctx, script, data, *ScriptOptions)`, `ExecuteScriptInto[T]` | a script of λORM in one transaction (the gateway needs `scripts.enabled`) |
| `ExecuteQueued(ctx, query, topic, data, chunk, *QueryOptions)` | queues a query to run in the background |
| `Plan(ctx, query, *QueryOptions)` | the sentences it would run, without running them |
| `Metadata`, `Model`, `Parameters`, `Constraints` (`ctx, query`) | what the query reads, returns and needs |
| `Queries(ctx)`, `Query(ctx, name, data, *QueryOptions)`, `QueryInto[T]` | the queries of `application.queries` and running one by its name |
| `Approval(ctx, id)`, `IsApprovalPending(result)` | a write that waits for a person to approve it |
| `Schema.Get`, `.Version`, `.Domain`, `.Entities`, `.Entity`, `.Enums`, `.Enum`, `.Sources`, `.Source`, `.Mappings`, `.Mapping`, `.EntityMapping`, `.Stages`, `.Stage`, `.Views` | the schema as the gateway loaded it |
| `Schema.Search(ctx, text)`, `Schema.Describe(ctx, entities)` | a large schema as compact text |
| `Stage.Exists`, `Stage.Export`, `Stage.Import` | the data of a stage |
| `General.Version(ctx)`, `General.Health(ctx)` | the gateway |
| `Whoami(ctx)` | the credential and its permissions (REST) |
| `Subscribe(ctx, SubscribeTarget{Entity: …} \| {Query: …, Data: …} \| {Name: …}, listener)` | the writes of an entity, or the result of a query when it changes (WebSocket) |
| `On(event, listener)` | `queue.completed`, `queue.failed`, `schema.statusChanged` (WebSocket) |
| `Close()` | closes the connection |

The listeners of `On` and `Subscribe` run on the goroutine that reads the socket: they must not block.

## Errors

Every operation that fails returns an `*gateway.Error`. Its `Code` is the same on the five transports:

```go
_, err := gw.Execute(ctx, "Categories.insert()", map[string]any{"name": "Beverages"}, nil)
if gateway.IsCode(err, gateway.CodeUnique) {
	// already exists
}
var e *gateway.Error
if errors.As(err, &e) {
	fmt.Println(e.Code, e.Name, e.Status, e.DBCode, e.Suggestions)
}
```

| `Code` | When |
| --- | --- |
| `invalid` | the query, the model or a value is wrong (`SchemaError`, `SintaxisError`, `ValidationError`, …) |
| `unauthorized`, `forbidden` | no valid credential; the credential lacks the permission |
| `not_found` | a name the schema doesn't have, or a script's `throw { status: 404 }` |
| `unique`, `foreign_key`, `conflict` | the database refused it: a unique key, a foreign key, another conflict |
| `timeout`, `too_large`, `rate_limited`, `unavailable`, `internal` | the gateway couldn't do it (`timeout` also when `WithTimeout` or the `ctx` ran out: `errors.Is(err, context.DeadlineExceeded)`) |
| `truncated` | MCP: the list was cut at `mcp.maxRows` |
| `unsupported` | the operation is not on that transport (`On` and `Subscribe` outside WebSocket, `Whoami` outside REST) |
| `transport` | the connection failed |

`Name` is the name the gateway gave the error, `Status` its HTTP status, `DBCode` the code of the database, and
`Suggestions`, for a name of the query that doesn't exist, the closest ones (`[{Name: "nme", DidYouMean: ["name"]}]`).

## Tests

```sh
go test ./...                  # the transports against fake gateways (httptest), no Docker
go run ./conformance           # the conformance suite (packages/conformance) on the five transports
```

Every case of the conformance suite of the gateway runs on the five transports with this client, against a real
gateway (`scripts/ci-local.sh clients` in the repository).

## Publishing

Go has no registry: `go get` downloads the code of the repository of the module path. This package is developed in
the monorepo `lambda-orm/data-gateway` and published to the read-only public mirror
`github.com/lambda-orm/data-gateway-client-go` (its content at the root, a tag `v<version>`). Issues and pull requests
go to the monorepo.

## License

[MIT](https://opensource.org/licenses/MIT)
