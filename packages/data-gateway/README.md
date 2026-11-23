<div align="center">

# λORM Data Gateway

**Your databases as a governed data API — REST, WebSocket, MCP for AI agents and a web UI — in one container, by
configuration.**

[![Docker image](https://img.shields.io/docker/v/flaviorita/data-gateway?label=flaviorita%2Fdata-gateway&sort=semver)](https://hub.docker.com/r/flaviorita/data-gateway)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Documentation:** [lambda-orm.github.io/wiki](https://lambda-orm.github.io/wiki) (English, Deutsch, Español, Português)

</div>

![Data Gateway](https://raw.githubusercontent.com/lambda-orm/wiki/main/docs/data-gateway/images/overview.svg)

You describe your domain once in a [λORM](https://lambda-orm.github.io/wiki/) schema — entities, relations, and in
which databases they live (MySQL, MariaDB, PostgreSQL, SQL Server, Oracle, MongoDB, SQLite). The Data Gateway
publishes it, and then:

- **applications in any language** query and write it over **REST** (OpenAPI 3) or **WebSocket**, with lambda
  queries — no backend to write, no SQL over the wire;
- **AI agents** explore the domain and query it through **MCP**, with the permissions you give them, never more;
- **people** browse the schemas, read each entity as a form, run queries with autocompletion and draw diagrams in the
  **[data-gateway-ide](https://hub.docker.com/r/flaviorita/data-gateway-ide)**, which reaches the gateway through its
  `management` port (left out in production when the schemas come in the volumes).

**Who can do what** is decided in one place: each credential has permissions (`read`, `write`, `script`, `queue`,
`stageImport`), the same on every transport, and every change is audited.

## Try it in two minutes

The [northwind example](https://lambda-orm.github.io/wiki/data-gateway/GettingStarted/): PostgreSQL and the gateway
with Docker Compose.

```sh
mkdir -p northwind/workspace && cd northwind
W=https://lambda-orm.github.io/wiki/data-gateway/northwind
curl -sO $W/docker-compose.yml && curl -sO $W/data-gateway.config.yaml && curl -sO $W/data.json
curl -s $W/lambdaORM.yaml -o workspace/lambdaORM.yaml

docker compose up -d
docker compose exec data-gateway lambdaorm push -w /workspace -s default      # create the tables
curl -X POST http://localhost:8080/stages/default/import -H "X-Api-Key: backend-demo-key" \
  -H "Content-Type: application/json" -d @data.json                         # import the rows
```

Query it — the join with `Categories` is implicit, the parameter is bound:

```sh
curl -X POST "http://localhost:8080/execute?format=beautiful" -H "X-Api-Key: reader-demo-key" \
  -H "Content-Type: application/json" -d '{
    "query": "Products.filter(p => p.price > minPrice).map(p => ({ name: p.name, category: p.category.name, price: p.price })).sort(p => desc(p.price)).page(1, 3)",
    "data": { "minPrice": 50 }
  }'
```

```json
[
  { "name": "Côte de Blaye", "category": "Beverages", "price": 263.5 },
  { "name": "Thüringer Rostbratwurst", "category": "Meat/Poultry", "price": 123.79 },
  { "name": "Mishi Kobe Niku", "category": "Meat/Poultry", "price": 97 }
]
```

The `reader` credential can't write:

```json
{ "error": "ForbiddenError", "message": "the credential \"reader\" does not have the \"stageImport\" permission" }
```

Then open the IDE (its own image, next to the gateway: see [The IDE](#the-ide)), or connect an AI agent:

```sh
claude mcp add --transport http northwind http://localhost:8081/mcp --header "X-Api-Key: reader-demo-key"
```

![The UI](https://raw.githubusercontent.com/lambda-orm/wiki/main/docs/data-gateway/images/ui-diagram.png)

## From any language

It is plain HTTP and JSON: the OpenAPI document is served at `/api-docs` (Swagger UI at `/doc`).

```python
import requests

rows = requests.post("http://localhost:8080/execute", headers={"X-Api-Key": key}, json={
    "query": "Orders.filter(p => p.customerId == id).include(p => p.details)",
    "data": {"id": "ALFKI"},
}).json()
```

```typescript
import { orm } from '@lambdaorm/client'      // Node: the same interface as the library

await orm.init('http://localhost:8080', { headers: { 'X-Api-Key': key } })
const rows = await orm.execute('Orders.filter(p => p.customerId == id).include(p => p.details)', { id: 'ALFKI' })
```

The [CLI](https://www.npmjs.com/package/@lambdaorm/cli) runs its commands on a gateway with `-u <url>` (with bearer
authentication, the token in `SERVICE_TOKEN`). See [Clients](https://lambda-orm.github.io/wiki/data-gateway/Clients/).

## What it does

- Serves **one or several λORM schemas** per instance, each at a route (`/iot/v1`, `/accounts`; a single schema can be
  at the root). Each schema runs in **its own worker**, with its own environment and connections: one that fails
  doesn't affect the others.
- Every operation of λORM: queries (`execute`, `plan`, `metadata`, `model`, `parameters`, `constraints`), **scripts**
  (several queries in one transaction), **queued executions** (Kafka), the schema and its domain, and stages (export,
  import).
- **Authentication** (API key, bearer token, basic) and **permissions** per credential (`read`, `write`, `script`,
  `queue`, `stageImport`), globally, per transport or per schema. `execute` of a query that only selects needs `read`;
  one that writes needs `write`.
- **Audit** of every write, **metrics** (Prometheus), **health** (Kubernetes probes), limits (rate, concurrency,
  sizes, time).

It is published as the Docker image [`flaviorita/data-gateway`](https://hub.docker.com/r/flaviorita/data-gateway)
(not on npm) and replaces the former `lambdaorm-svc` service. It doesn't accept SQL (only λORM queries) and doesn't migrate the databases: that is the
[CLI](https://www.npmjs.com/package/@lambdaorm/cli) (`push`, `pull`, …).

## Configuration

One mounted YAML file, `DATA_GATEWAY_CONFIG_PATH` (default `/config/data-gateway.config.yaml`), says where the schemas
are, how they are exposed and who can use them. `$VAR` / `${VAR}` take environment variables. The schemas stay in
their λORM workspaces (`lambdaORM.yaml`).

```yaml
orm:
  workspacePath: /workspace            # the folder with lambdaORM.yaml (a single schema: served at the root)
  schemas:
    - path: ""                         # that schema: it receives only the variables given here
      env: { NORTHWIND_DB: $NORTHWIND_DB }
authentication:                        # none (default) or local: apikey | bearer | basic
  adapter: local
  type: apikey
  header: X-Api-Key
  keys:
    - { name: reader,  value: $READER_KEY,  permissions: [ read ] }
    - { name: backend, value: $BACKEND_KEY, permissions: [ read, write, script, queue, stageImport ] }
scripts:
  enabled: true                        # POST /script, off by default
transports:                            # a transport is on only when it has a port
  http:
    port: 8080
  mcpHttp:
    port: 8081
  webSocket:
    port: 8083
  management:                          # the API of the IDE and the administration; no port, no IDE
    port: $MANAGEMENT_PORT
```

Every key: [Configuration](https://lambda-orm.github.io/wiki/data-gateway/Configuration/).

## Run it

```sh
docker run --rm \
  -v $(pwd)/data-gateway.config.yaml:/config/data-gateway.config.yaml:ro \
  -v $(pwd)/workspace:/workspace \
  -e NORTHWIND_DB='{"host":"…","port":5432,"user":"…","password":"…","database":"northwind"}' \
  -e READER_KEY=… -e BACKEND_KEY=… \
  -p 8080:8080 -p 8081:8081 -p 8083:8083 \
  flaviorita/data-gateway
```

A complete example with PostgreSQL and Docker Compose is in the
[getting started guide](https://lambda-orm.github.io/wiki/data-gateway/GettingStarted/). Kubernetes, health, metrics
and logs: [Operations](https://lambda-orm.github.io/wiki/data-gateway/Operations/).

## Transports

| Transport | What it serves | Docs |
| --- | --- | --- |
| `http` | the REST API and the OpenAPI document (`/doc`, `/api-docs`) | [REST API](https://lambda-orm.github.io/wiki/data-gateway/Rest/) |
| `mcpHttp` | MCP Streamable HTTP (`/mcp`) for AI agents | [MCP](https://lambda-orm.github.io/wiki/data-gateway/Mcp/) |
| `mcpWebSocket` | MCP over WebSocket | [MCP](https://lambda-orm.github.io/wiki/data-gateway/Mcp/) |
| `webSocket` | the same API as JSON-RPC over one connection, with notifications | [WebSocket API](https://lambda-orm.github.io/wiki/data-gateway/WebSocket/) |
| `management` | the routes of `http` for every schema and the administration (`/admin`), for the IDE; keep it on an internal network | [UI](https://lambda-orm.github.io/wiki/data-gateway/Ui/) |

No transport answers CORS: a web app calls the gateway from its backend.

## The IDE

The UI is [`flaviorita/data-gateway-ide`](https://hub.docker.com/r/flaviorita/data-gateway-ide): the browser talks to
its backend, which reaches the `management` port of each gateway (and, for its REST, WebSocket and MCP tabs, the data
transports). `DATA_GATEWAY_IDE_TARGETS` lists the origins it may reach (`*`: any, for a local IDE).

```yaml
services:
  data-gateway:
    image: flaviorita/data-gateway
    environment: { MANAGEMENT_PORT: 9090 }   # no ports: published only to the IDE
  ide:
    image: flaviorita/data-gateway-ide
    environment: { DATA_GATEWAY_IDE_TARGETS: "http://data-gateway:9090,http://data-gateway:8080" }
    ports: [ "127.0.0.1:8090:8080" ]
```

Open http://localhost:8090 and add a connection to `http://data-gateway:9090` with a credential.

## Development

The gateway builds with Grunt; from `packages/data-gateway`:

```sh
npm run build                 # tsc
npm test                      # unit tests
npm run test:integration      # real sockets, the MCP SDK clients and λORM, no database
```

- The image is published by `.github/workflows/data-gateway-image.yml` when a new version of `package.json` reaches
  `main` (see [DEPLOY.md](../../DEPLOY.md)).
- How well AI models use the MCP tools is measured with the [evaluation set](eval/README.md).
- Design notes: [`docs/DATA_GATEWAY.md`](../../docs/DATA_GATEWAY.md).
- [Change log](CHANGELOG.md)

## License

MIT
