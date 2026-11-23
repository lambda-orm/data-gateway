---
"@lambdaorm/ui": minor
---

A connection of the `Workspace` can bring its own `fetch` (the data-gateway-ide puts its session of `management` in
every request and logs in again when it ends), a `changes` subscription (the gateway's WebSocket of events: the schemas
and what is saved are read again at once) and its own `refreshMs` (the polling, slower while the events work).
