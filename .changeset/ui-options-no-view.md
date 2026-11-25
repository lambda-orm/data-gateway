---
'@lambdaorm/ui': minor
---

The options of a query (`OptionsForm`, `optionsFieldsOf`, `optionsTextOf`) no longer have a view: the gateway decides
it by the identity and drops the one of a client. `OptionsFields` loses `view` and `OptionsMessages` loses `view` and
`viewHint`; a view in the options of a query saved before is kept as an option the form doesn't know.
