---
'@lambdaorm/ui': minor
---

The commands of a workspace (`CommandsPanel`) for the gateway 4.1.0: the preview of `push` (and of `migrate`) lists
the changes that can lose data, and runs them only once they are allowed (`allowDestructive`); `migrations` shows the
history of the stage, with a button to go back to an applied version (`migrate`, after its preview with the undo of
each later migration); `seed` shows its files and inserts the rows that are not there. `CommandName` takes
`migrations`, `migrate` and `seed`; `CommandPreview` takes `destructive`, `version` and `files`. A gateway without
them (4.0.0) doesn't offer them.
