# λORM Data Gateway

[![Docker image](https://img.shields.io/docker/v/flaviorita/data-gateway?label=flaviorita%2Fdata-gateway&sort=semver)](https://hub.docker.com/r/flaviorita/data-gateway)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

📖 **Documentation:** [lambda-orm.github.io/wiki](https://lambda-orm.github.io/wiki) (English, Deutsch, Español, Português)

Governed access to the data of [λORM](https://lambda-orm.github.io/wiki/) schemas over the network, by configuration,
without writing a backend:

- **applications** query and write a schema through a **REST API** (or a **WebSocket** connection), with the same
  lambda queries they would run in Node;
- **AI agents** explore the domain and query it through **MCP**;
- **people** explore the schemas, read each entity as a form, try queries and draw diagrams in a **web UI**;

and **who can do what** is decided in one place: every credential has permissions, the same on every transport, and
every change is audited.

It is published as the Docker image [`flaviorita/data-gateway`](https://hub.docker.com/r/flaviorita/data-gateway)
(not on npm). It replaces the former `lambdaorm-svc` service (`packages/service`, image `flaviorita/lambdaorm-svc`).

The [Data Gateway section](https://lambda-orm.github.io/wiki/data-gateway/) of the wiki covers it in full; its
[getting started guide](https://lambda-orm.github.io/wiki/data-gateway/GettingStarted/) goes from an empty folder to
the REST API, the UI, MCP and WebSocket in about ten minutes.

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

It doesn't accept SQL (only λORM queries) and doesn't migrate the databases: that is the
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
    ui: { enabled: true }              # the web UI at /ui
  mcpHttp:
    port: 8081
  webSocket:
    port: 8083
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
| `http` | the REST API, the OpenAPI document (`/doc`, `/api-docs`) and the web UI (`/ui`) | [REST API](https://lambda-orm.github.io/wiki/data-gateway/Rest/), [UI](https://lambda-orm.github.io/wiki/data-gateway/Ui/) |
| `mcpHttp` | MCP Streamable HTTP (`/mcp`) for AI agents | [MCP](https://lambda-orm.github.io/wiki/data-gateway/Mcp/) |
| `mcpWebSocket` | MCP over WebSocket | [MCP](https://lambda-orm.github.io/wiki/data-gateway/Mcp/) |
| `webSocket` | the same API as JSON-RPC over one connection, with notifications | [WebSocket API](https://lambda-orm.github.io/wiki/data-gateway/WebSocket/) |

```sh
# REST
curl -X POST http://localhost:8080/execute -H "X-Api-Key: $READER_KEY" -H "Content-Type: application/json" \
  -d '{"query": "Products.filter(p => p.price > minPrice).map(p => [p.name, p.price])", "data": {"minPrice": 50}}'

# an AI agent (Claude Code)
claude mcp add --transport http northwind http://localhost:8081/mcp --header "X-Api-Key: $READER_KEY"
```

From Node.js, [`@lambdaorm/client`](https://www.npmjs.com/package/@lambdaorm/client) has the interface of the library
(`orm.execute`, `orm.plan`, …) over REST or WebSocket; the [CLI](https://www.npmjs.com/package/@lambdaorm/cli) runs
its commands on the gateway with `-u <url>`; and [`@lambdaorm/ui`](https://www.npmjs.com/package/@lambdaorm/ui) puts
the UI in an application of your own. See [Clients](https://lambda-orm.github.io/wiki/data-gateway/Clients/).

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
