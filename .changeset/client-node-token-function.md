---
'@lambdaorm/data-gateway-client': minor
---

`token` can be a function that gives it (`token: () => idp.accessToken()`): it is asked for on every request of REST
and MCP over HTTP, and on opening a WebSocket, so the token of an identity provider can be refreshed (the JWT of the
gateway 4.1.0, `docs/JWT.md`).
