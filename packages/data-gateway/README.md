# λORM data-gateway

> Formerly `packages/service` (`@lambdaorm/service`, image `flaviorita/lambdaorm-svc`). It is being redesigned:
> see [`docs/DATA_GATEWAY.md`](../../docs/DATA_GATEWAY.md) and [`docs/DATA_GATEWAY_PLAN.md`](../../docs/DATA_GATEWAY_PLAN.md).

Gateway that exposes the functionality of the [LambdaOrm](https://github.com/lambda-orm/lambdaorm) library

## Configuration

Everything is configured in one mounted YAML file, `DATA_GATEWAY_CONFIG_PATH` (default
`/config/data-gateway.config.yaml`). It is mandatory: without it the gateway doesn't start. `$VAR` / `${VAR}` take the
environment variables; one that is not defined counts as not set.

```yaml
orm:
  workspacePath: /workspace          # folder with lambdaORM.yaml
authentication:                      # none (default) or local: bearer | apikey | basic
  adapter: local
  type: apikey
  header: X-Api-Key
  keys:
    - { name: agent,   value: $AGENT_KEY,   permissions: [ read ] }
    - { name: backend, value: $BACKEND_KEY, permissions: [ read, write, script, queue, stageImport ] }
scripts:
  enabled: true                      # POST /script, off by default
rateLimit:
  max: 0                             # 0 = no rate limit
transports:
  http:
    port: $DATA_GATEWAY_HTTP_PORT    # no port, no transport: there are no default ports
```

- **Permissions:** `read` (schema, plan, metadata, … and `execute` of queries that only select), `write` (`execute`
  that inserts, updates, deletes, …), `script`, `queue`, `stageImport`. A single `token` / `value` / `username` +
  `password` has every permission. A local credential whose secret is not defined stops the start.
- **Audit:** every write (and every script, queued execution and stage import) leaves a JSON line with
  `"type":"audit"` on stdout: credential, operation, actions, entities, query, rows, duration, result.
- **Not used anymore:** `infrastructure.service` of `lambdaORM.yaml` and the variables `PORT`, `SERVICE_TOKEN`,
  `RATE_LIMIT_*`, `SCRIPT_*` read directly. Migration table and every key: [`docs/DATA_GATEWAY.md`](../../docs/DATA_GATEWAY.md) §2.

```sh
docker run -v $(pwd)/workspace:/workspace -v $(pwd)/data-gateway.config.yaml:/config/data-gateway.config.yaml:ro \
  -e DATA_GATEWAY_HTTP_PORT=8080 -e AGENT_KEY=… -e BACKEND_KEY=… --network host flaviorita/data-gateway
```

Tests: `npm test` (unit), `npm run test:integration` (real sockets and λORM, no database). The service tests of the
[ilusor-cloud lab](../lib/src/dev/labs/ilusor-cloud/README.md) run against it with Postgres.

## Service

The service exposes the following endpoints:

### queries endpoints

![query-methods](https://raw.githubusercontent.com/lambda-orm/core/HEAD/packages/data-gateway/images/query-methods.png)

### General endpoints

![general-methods](https://raw.githubusercontent.com/lambda-orm/core/HEAD/packages/data-gateway/images/general-methods.png)

### Schema endpoints

![schema-methods](https://raw.githubusercontent.com/lambda-orm/core/HEAD/packages/data-gateway/images/schema-methods.png)

### Stage endpoints

![stage-methods](https://raw.githubusercontent.com/lambda-orm/core/HEAD/packages/data-gateway/images/stage-methods.png)

## Usage

### Ping

```sh
curl -X GET "http://localhost:9291/ping?format=beautiful"
```

Result:

```json
{
  "message": "pong",
  "time": "2023-12-08T19:41:00.543Z"
}
```

### Model

```sh
curl -X POST "http://localhost:9291/model?format=beautiful" -H "Content-Type: application/json" -d '{"query": "Orders.filter(p=>p.customerId==customerId).include(p=>p.details)"}'
```

Result:

```json
[
  {
    "name": "id",
    "type": "integer"
  },
  {
    "name": "customerId",
    "type": "string"
  },
  {
    "name": "orderDate",
    "type": "dateTime"
  },
  {
    "name": "details",
    "type": "Orders.details[]",
    "children": [
      {
        "name": "orderId",
        "type": "integer"
      },
      {
        "name": "productId",
        "type": "integer"
      },
      {
        "name": "unitPrice",
        "type": "decimal"
      },
      {
        "name": "quantity",
        "type": "decimal"
      },
      {
        "name": "LambdaOrmParentId",
        "type": "integer"
      }
    ]
  }
]
```

### Parameters

```sh
curl -X POST "http://localhost:9291/parameters?format=beautiful" -H "Content-Type: application/json" -d '{"query": "Orders.filter(p=>p.customerId==customerId).include(p=>p.details)"}'
```

Result:

```json
[
  {
    "name": "customerId",
    "type": "string"
  },
  {
    "name": "details",
    "type": "Orders.details",
    "children": [
      {
        "name": "LambdaOrmParentId",
        "type": "any"
      }
    ]
  }
]
```

### Constraints

```sh
curl -X POST "http://localhost:9291/constraints?format=beautiful" -H "Content-Type: application/json" -d '{"query": "Orders.filter(p=>p.customerId==customerId).include(p=>p.details)"}'
```

Result:

```json
{
  "entity": "Orders",
  "constraints": [],
  "children": [
    {
      "entity": "Orders.details",
      "constraints": []
    }
  ]
}
```

### Plan

```sh
curl -X POST "http://localhost:9291/plan?format=beautiful" -H "Content-Type: application/json" -d '{"query": "Orders.filter(p=>p.customerId==customerId).include(p=>p.details)"}'
```

Result:

```json
{
  "entity": "Orders",
  "dialect": "PostgreSQL",
  "source": "default",
  "sentence": "SELECT o.OrderID AS \"id\", o.CustomerID AS \"customerId\", o.OrderDate AS \"orderDate\", o.OrderID AS \"__id\" FROM Orders o  WHERE o.CustomerID = $1 ",
  "children": [
    {
      "entity": "Orders.details",
      "dialect": "PostgreSQL",
      "source": "default",
      "sentence": "SELECT o1.OrderID AS \"orderId\", o1.ProductID AS \"productId\", o1.UnitPrice AS \"unitPrice\", o1.Quantity AS \"quantity\", o1.OrderID AS \"LambdaOrmParentId\" FROM \"Order Details\" o1  WHERE  o1.OrderID IN ($1) "
    }
  ]
}
```

### Import

```sh
curl -X POST -H "Content-Type: application/json" -d @data.json http://localhost:9291/stages/default/import
```

### Execute

```sh
curl -X POST "http://localhost:9291/execute?format=beautiful" -H "Content-Type: application/json" -d '{"query": "Orders.filter(p=>p.customerId==customerId).include(p=>p.details)", "data": "{\"customerId\": \"CENTC\"}" }'
```

Result:

```json
[
  {
    "id": 12,
    "customerId": "CENTC",
    "orderDate": "1996-07-18T00:00:00.000Z",
    "details": [
      {
        "orderId": 12,
        "productId": 21,
        "unitPrice": 8,
        "quantity": 10
      },
      {
        "orderId": 12,
        "productId": 37,
        "unitPrice": 20.8,
        "quantity": 1
      }
    ]
  }
]
```

## Documentation

Full documentation is available in the [Wiki](https://github.com/lambda-orm/lambdaorm-svc/wiki).

## Docker Image

You can access to image at [flaviorita/lambdaorm-svc](https://hub.docker.com/repository/docker/flaviorita/lambdaorm-svc/general)

## Clients

The following clients allow consuming this service

- [Node Client](https://github.com/lambda-orm/lambdaorm-client-node)
- [Kotlin Client](https://github.com/lambda-orm/lambdaorm-client-kotlin)

Soon:

- Python Client
- CSharp Client
- Go Client

## Labs

You can access various labs at [github.com/lambda-orm/lambdaorm-labs](https://github.com/lambda-orm/lambdaorm-labs)
