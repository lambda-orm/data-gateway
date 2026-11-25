---
'@lambdaorm/ui': minor
---

The properties of an entity show their `readValue` and `writeValue` too (`PropertyInfo`, `PROPERTY_EXPRESSIONS`,
`expressionsOf`): a property with expressions has `ƒ Expression` in its row, and selecting it shows them under the table
in the colors of 3xpr. Its form edits them: the column `expressions` of the properties opens, under the table, an editor
for each one (`readExp`, `writeExp`, `readValue`, `writeValue`) whose variables are the properties of the entity
(`ExpressionInput` takes `variables` and `height`). The tables of a form line up: each cell its field without
overflowing, the checks centered, the widths by kind of column, and an empty select says what it means (`string`,
`oneToMany`).
