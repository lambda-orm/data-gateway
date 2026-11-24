---
'@lambdaorm/ui': minor
---

The explorer shows, by the metadata of a schema, its state (its data, the files of data/) and its source code: a node for each code, named by its language (TypeScript, Kotlin…) and, for a build of the gateway, its folder (TypeScript · node), with its files and an action that downloads its folder as a .zip; the source code has the build too (also in the commands of the schema, now `BuildDialog`). The code of each language is written in its own folder of src/ (data-gateway 4.1.0).

Each node of code is built again (its dialog on its language) or deleted (asked first); the build generates the model, the repositories or both (as -m and -r of the CLI).
