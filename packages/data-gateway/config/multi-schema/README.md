# Several schemas

`northwind/v1` is discovered (`workspace/northwind/v1` has a `lambdaORM.yaml`); `northwind/v2` is declared with the
same model and runs in its own process. Both read the database from `EVAL_DB_CONNECTION`, and each worker gets its own
value: `NORTHWIND_V1_DB` and `NORTHWIND_V2_DB` of the gateway. Here both point to the northwind of the evaluation set.

From `packages/data-gateway`:

```bash
docker compose -f eval/docker-compose.yaml -p data-gateway-eval up -d --wait
npx grunt build
DB='{"host":"127.0.0.1","port":53316,"user":"test","password":"test","database":"northwind"}'
MULTI_WORKSPACE=$PWD/config/multi-schema/workspace NORTHWIND_V1_DB=$DB NORTHWIND_V2_DB=$DB \
READER_KEY=reader BACKEND_KEY=backend HTTP_PORT=8080 MCP_PORT=8081 \
DATA_GATEWAY_CONFIG_PATH=$PWD/config/multi-schema/data-gateway.config.yaml node build/lib/index.js

curl -s localhost:8080/schemas
curl -s localhost:8080/northwind/v1/execute -H 'X-Api-Key: reader' -H 'content-type: application/json' \
  -d '{"query":"Products.map(p => ({ total: count(1) }))"}'
claude mcp add --transport http northwind-v1 http://localhost:8081/northwind/v1/mcp --header "X-Api-Key: reader"
claude mcp add --transport http northwind-v2 http://localhost:8081/northwind/v2/mcp --header "X-Api-Key: reader"
```

With `@lambdaorm/client`, each schema is a URL: `http://localhost:8080/northwind/v1`, `http://localhost:8080/northwind/v2`.
