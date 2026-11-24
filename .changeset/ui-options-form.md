---
"@lambdaorm/ui": minor
---

The options of a query are a form (`OptionsForm`): each field may stay empty and says what is valid; `stage` and `view`
offer those of the schema (the new optional `stages` and `views` of `QueryApiPort`, from `GET /{schema}/stages` and
`/views` in `RestQueryApi`), `chunkSize` takes a whole number, `tryAllCan` default / yes / no, `headers` pairs of name and
value, and a script adds `timeout` and `maxIterations`. The JSON is still what a query keeps (saved, in its history): the
form can switch to it, keeps the options it doesn't know, and an invalid JSON is fixed as JSON.

Under the query, the options are one line (what is set, or that none is) with an Edit button that opens them in a
dialog, as a form or JSON; the data folds while it is empty and opens when something fills it; the editor of the query
is taller.

