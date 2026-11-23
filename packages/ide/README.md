# data-gateway-ide

The IDE of the λORM data-gateway: write and run queries, model the schemas (their `lambdaORM.yaml` as YAML and as forms),
draw their diagrams and run their commands — on the data-gateways it connects to.

Like a database IDE: the schemas, workspaces (`src/`, `data/`, `workbench/`) and projects are in each data-gateway; the
IDE only connects. Each connection has the URL of the gateway's `management` port (`http`/`https`, host, port and base
path) and its credential; what the credential may do (its roles) is shown in the page of the connection.

## How it reaches the gateways

The browser talks only to the backend of the IDE (`server/server.mjs`, Node without dependencies): it serves the app
and is its proxy. A request to a gateway carries the gateway's URL in its path, `/gw/{base64url of the URL}/{path}`, so
REST, MCP and the upgrade of a WebSocket go the same way. The gateways answer no CORS: they never see the browser.

- The URL of a connection is the one **the backend** reaches (`http://data-gateway:9292` in a compose), not the
  browser. The REST, WebSocket and MCP tabs use the ports the gateway tells at `GET /transports`, on the same host, or
  the URLs the connection fixes.
- `DATA_GATEWAY_IDE_TARGETS`: the origins the proxy may reach, separated by commas, or `*` for any (a local IDE).
  Without it the proxy reaches none (`403` that says so): an open proxy would reach any host of its network.
- It keeps no connection and no credential: they stay in the browser (the key only if asked to be remembered). It
  forwards the credential headers and drops cookies, `Origin` and `Referer`.

## Run it

```bash
docker run -p 8098:8080 -e DATA_GATEWAY_IDE_TARGETS='*' flaviorita/data-gateway-ide
```

Open http://localhost:8098 and add a connection to the `management` of a gateway. Next to the gateways, in the same
network, with the management ports published to nobody else:

```yaml
services:
  data-gateway:
    image: flaviorita/data-gateway
    environment: { MANAGEMENT_PORT: 9292 }     # transports.management.port: $MANAGEMENT_PORT
  ide:
    image: flaviorita/data-gateway-ide
    environment: { DATA_GATEWAY_IDE_TARGETS: "http://data-gateway:9292,http://data-gateway:9291" }
    ports: [ "127.0.0.1:8098:8080" ]
```

## Development

```bash
npm run build && DATA_GATEWAY_IDE_TARGETS='*' npm start   # the app and its backend on :8080
npm run dev                                               # vite, with /gw/ to the backend on :8080
npm test                                                  # the backend (node --test)
```
