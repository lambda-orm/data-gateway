---
'@lambdaorm/data-gateway-client': minor
---

`client.subscribe({ entity } | { query, data } | { name, data }, listener)` over a `ws(s)://` connection: the writes
of an entity, or a query run again when what it reads changes (the subscriptions of the gateway, `docs/SUBSCRIPTIONS.md`);
it answers the subscription, the first result of a query and `unsubscribe()`.
