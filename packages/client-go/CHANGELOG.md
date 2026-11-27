# Changelog

## 0.1.0

- The Go client of the Data Gateway: `gateway.Connect` with the five transports chosen by the scheme of the connection
  string (REST, JSON-RPC over WebSocket, MCP Streamable HTTP, MCP HTTP+SSE, MCP over WebSocket), the same API as
  `@lambdaorm/data-gateway-client-node` (`Execute`, `ExecuteInto[T]`, `ExecuteScript`, `ExecuteQueued`, `Plan`,
  `Metadata`, `Query`, `Queries`, `Approval`, `Subscribe`, `On`, `Schema.*`, `Stage.*`, `General.*`, `Whoami`), the
  errors with the codes of the conformance suite, and the suite in green on the five transports.
