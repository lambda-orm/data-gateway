# data-gateway-ide

The IDE of the λORM data-gateway: write and run queries, model the schemas (their `lambdaORM.yaml` as YAML and as forms),
draw their diagrams and run their commands — on the data-gateways it connects to.

Like a database IDE: the schemas, workspaces (`src/`, `data/`, `workbench/`) and projects are in each data-gateway; the
IDE only connects. Each connection has its URL (`http`/`https`, host, port and base path) and its credential; what the
credential may do (its roles) is shown in the page of the connection.

## Run it

```bash
docker run -p 8098:8080 flaviorita/data-gateway-ide
```

Open http://localhost:8098 and add a connection: the protocol and the address of a gateway, with its port and the base
path it is served at (`localhost:8097/data-gateway` for a gateway behind a proxy at `/data-gateway`). A data-gateway answers any origin (CORS), so the IDE can be
deployed anywhere, or run locally, while the gateways in production don't serve a UI (`transports.http.ui.enabled:
false`).

## Two builds of the same app

| | `npm run build` (the IDE) | `npm run build:embedded` |
| --- | --- | --- |
| served by | its image (nginx) | a data-gateway, at `{basePath}/ui` |
| login | none: each connection authenticates | the gateway's login |
| connections | any number, kept in the browser | the gateway's own, as *current* |

The data-gateway's build (`npx grunt dist`) runs `build:embedded` and copies `dist-embedded/` into its `/ui`.
