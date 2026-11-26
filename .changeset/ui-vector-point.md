---
'@lambdaorm/ui': minor
---

`vector` and `point` (λORM 3.15): the forms of the schema offer them (a vector's dimensions in `length`) and the
indexes of the engine (`hnsw`, `ivfflat`, `spatial`, with their distance); the data table shows a point as "longitude,
latitude" with a link to a map and edits it in two fields (sent as GeoJSON), and a vector by its first numbers and how
many, edited only in the form of a row as JSON checked against its dimensions.
