---
'@lambdaorm/ui': minor
---

The query wizard opened on a query it didn't write, or on one it wrote and that was edited by hand since, reads it: the entity it starts from, its includes (each with the fields of its map and its own includes), the fields of its map, the filter, the order and the page. What it can't show (a computed or renamed field, the filter of an include, a groupBy…) is listed in the wizard, which leaves it out of the query it writes; a query it wrote is updated in its tab, its boxes where they were. Several boxes selected in the diagram of the wizard are taken out at once.
