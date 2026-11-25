---
'@lambdaorm/data-gateway-client': minor
---

`client.queries()` lists the queries of `application.queries` that the credential can use (their parameters and
model) and `client.query(name, data)` runs one by its name, on every transport (on MCP, the tool `query_<name>`): the
named queries of the gateway 4.1.0 (`docs/NAMED_QUERIES.md`).
