# Evaluation set of the MCP

30 questions in natural language over northwind (filters, text, dates, aggregations, groups, relations, top-N and two
writes), each with a reference query. Claude answers them only through the MCP of a running gateway, and its answer is
compared with the result of the reference. It measures whether models use the λORM query language well with the guide
(`lambdaorm://guide/expressions`), the description of `orm_execute` and the errors the gateway returns.

**Optional.** For now no LLM consumes the MCP, so the set doesn't gate any release (docs/DATA_GATEWAY_PLAN.md, D23).
`--check` uses no model (it only checks the references, the grader and the writes against the database); running the
questions with a model is for when an LLM starts using the MCP, or the guide, the tool descriptions or the error
messages change.

**Target:** at least 80% right without a failed tool call (`firstTry`), and 95% right with at most two failed calls
(`withUpToTwoRetries`).

## Run

From `packages/data-gateway`:

```bash
# 1. northwind with data (MySQL 8.4 on 127.0.0.1:53316, loaded from packages/lib/src/dev/northwind/db)
docker compose -f eval/docker-compose.yaml -p data-gateway-eval up -d --wait

# 2. the gateway: REST on 58090 (references, setup, cleanup), MCP on 58091
EVAL_DB_CONNECTION='{"host":"127.0.0.1","port":53316,"user":"test","password":"test","database":"northwind"}' \
EVAL_WORKSPACE=$PWD/eval/workspace EVAL_HTTP_PORT=58090 EVAL_MCP_PORT=58091 \
DATA_GATEWAY_CONFIG_PATH=$PWD/eval/data-gateway.config.yaml npx tsx src/lib/index.ts &

# 3. without a model: the references answer, the grader accepts them, the writes and their cleanup work
npx tsx eval/run.ts --check

# 4. with Claude (ANTHROPIC_API_KEY, or a profile of `ant auth login`); it costs API tokens
npx tsx eval/run.ts                      # all; --only id1,id2 for some
EVAL_MODEL=claude-sonnet-5-5 EVAL_EFFORT=low npx tsx eval/run.ts

docker compose -f eval/docker-compose.yaml -p data-gateway-eval down -v
```

Results go to `eval/results/` (not committed): the summary and, per question, the answer, the expected rows, the tool
calls and errors, and the tokens.

## How it works

- Read questions run with the `reader` credential (`read`); writes with `writer` (`read`, `write`). The REST transport,
  with `runner` (every permission), runs the references, the `setup` of a question and its `cleanup` (before and after).
- The model gets the tools of the MCP plus `submit_answer`, and the guide in the system prompt (as a client would give
  it the resource). Model `claude-opus-5-5` with adaptive thinking, effort `medium` and server-side refusal fallbacks
  (`fallbacks: "default"`); `EVAL_MODEL`, `EVAL_EFFORT` and `EVAL_MAX_TURNS` change them.
- Grading: the same number of rows; each expected row matches a different answer row that contains all its values (the
  model may add fields); numbers to 2 decimals, text trimmed and case insensitive, dates by day. `"compare": "ordered"`
  also checks the order; `reference.columns` keeps only those fields of the reference. A write is graded by reading
  the database after it, not by what the model answers.
- `--check` runs every reference and, for the writes, a `solution`, so a question whose reference doesn't answer, or
  whose setup or cleanup fails, is caught without spending tokens.

## Limits of λORM found while writing it

`like` with a literal pattern, `includes` of a text ("contains"), `startsWith` / `includes` with a variable and the
date functions on PostgreSQL were fixed in `@lambdaorm/lib` 3.5.1 / 3.5.2. Still open (the guide steers around the
first one):

- An expression next to an aggregate (`map(p => ({ year: year(p.orderDate), n: count(1) }))`) groups by the field
  (`GROUP BY o.OrderDate`), not by the expression.
- Date functions on a column fail on SQL Server, Oracle and MongoDB; text matching fails on MongoDB (the engines lab
  marks them `test.failing`).
- The `sql.js` (SQLite) adapter doesn't work.
