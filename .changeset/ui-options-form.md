---
"@lambdaorm/ui": minor
---

The options of a query are a form (`OptionsForm`): each field may stay empty and says what is valid; `stage` and `view`
offer those of the schema (the new optional `stages` and `views` of `QueryApiPort`, from `GET /{schema}/stages` and
`/views` in `RestQueryApi`), `chunkSize` takes a whole number, `tryAllCan` default / yes / no, `headers` pairs of name and
value, and a script adds `timeout` and `maxIterations`. The JSON is still what a query keeps (saved, in its history): the
form can switch to it, keeps the options it doesn't know, and an invalid JSON is fixed as JSON.
