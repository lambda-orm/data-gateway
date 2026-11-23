# λORM Data Gateway

The [λORM](https://github.com/lambda-orm/core) Data Gateway: λORM's queries over REST, WebSocket and MCP, the
workspaces of its schemas, and the tools to work with it.

| Package | Published as | What it is |
| --- | --- | --- |
| [`packages/data-gateway`](packages/data-gateway/README.md) | image [`flaviorita/data-gateway`](https://hub.docker.com/r/flaviorita/data-gateway) | The gateway: the schemas of its workspace over REST, WebSocket, MCP (HTTP and WebSocket) and Kafka, their administration, and the UI at `/ui` |
| [`packages/ide`](packages/ide/README.md) | image [`flaviorita/data-gateway-ide`](https://hub.docker.com/r/flaviorita/data-gateway-ide) | The IDE: connects to several gateways (each with its URL and its credential), like a database IDE |
| [`packages/ui`](packages/ui/README.md) | npm [`@lambdaorm/ui`](https://www.npmjs.com/package/@lambdaorm/ui) | React components: the workspace, the query editor with λORM's suggestions, the diagrams |
| [`packages/client-node`](packages/client-node/README.md) | npm [`@lambdaorm/data-gateway-client`](https://www.npmjs.com/package/@lambdaorm/data-gateway-client) | The Node client: the same queries over REST, WebSocket or MCP, chosen by the connection string |
| [`packages/conformance`](packages/conformance/README.md) | — | The conformance suite every client passes, on the five transports |

λORM itself (`@lambdaorm/base`, `@lambdaorm/lib`, `@lambdaorm/cli`) lives in [lambda-orm/core](https://github.com/lambda-orm/core)
and comes from npm. The design of the gateway: [`docs/DATA_GATEWAY.md`](docs/DATA_GATEWAY.md). The user documentation:
the [wiki](https://lambda-orm.github.io/wiki/data-gateway/).

## Development

```bash
pnpm install
pnpm build          # ui, then data-gateway and client-node (tsc -b), then the IDE
pnpm lint
pnpm test
scripts/ci-local.sh check     # what the CI does, in a clean checkout of HEAD
scripts/ci-local.sh clients   # the conformance suite against the gateway from source (Docker)
```

Contributing: [CONTRIBUTING.md](CONTRIBUTING.md). Releases: [DEPLOY.md](DEPLOY.md).
