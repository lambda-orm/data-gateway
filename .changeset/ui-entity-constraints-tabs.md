---
'@lambdaorm/ui': minor
---

The validations of an entity are its Constraints, as λORM names them: its tab `Constraints (n)` and, under a property,
the constraints that use it. The form of an entity has tabs (Properties, Relations, Indexes, Constraints, each with how
many it has) under its general fields. Its Edit (in the entity or the explorer) opens the form already in edit, with
Cancel and Save; an open form of it goes to edit (`SchemaForms` takes `editRequest`, `onOpenElement` an `edit`).

Opened by Edit, its Cancel or its Save closes the form and goes back to the view of the entity (`SchemaForms` takes
`onDone`). Each expression of a property says what it is (`readExp: replaces the column when reading…`) and, under
it, its editor (Monaco, with the properties and the functions suggested) or the expression in colors; the constraints
that use the property, the same way. `abstract` and `view` share a line.
