/** lambdaorm://guide/expressions: the query language for a model (tuned with the evaluation set, eval/) */
export const EXPRESSIONS_GUIDE = `# λORM query language

Queries are JavaScript-like lambda expressions over the **entities of the domain**, not SQL. λORM translates them to
the dialect of each source. Send them as text in \`query\`; values go in \`data\` and are referenced by name.

## Select

\`\`\`js
Products
  .filter(p => p.price > minPrice && p.discontinued == false)   // WHERE ("data": { "minPrice": 10 })
  .map(p => ({ name: p.name, category: p.category.name }))     // fields; relations with dots (join)
  .sort(p => [p.category, desc(p.name)])                         // ORDER BY: asc by default, desc(...)
  .page(1, 20)                                                  // page 1, 20 rows (pages start at 1)
\`\`\`

- Without \`map\` every field of the entity is returned.
- \`first(p => ...)\` / \`last(p => ...)\` return the first / last row (by the given sort or the first field).
- \`distinct(p => ({ country: p.country }))\` removes duplicated rows.
- Clause order is free, but use each clause once.
- Conditions: \`== != > >= < <=\`, \`&& || !\`, \`between(p.price, 10, 20)\`, \`isNull(p.region)\`, \`isNotNull(p.region)\`.
- A value in a list: \`in(p.id, [1, 2, 3])\` or \`[1, 2, 3].includes(p.id)\` (\`in(p.id, ids)\` with \`"ids"\` in data).
- Text: \`startsWith(p.name, 'Ch')\`, contains \`p.name.includes('ch')\`, patterns \`like(p.name, 'Ch%')\` (\`%\` any text,
  \`_\` one character); the value can also come from data (\`startsWith(p.name, prefix)\`). Whether upper and lower case
  match depends on the database (PostgreSQL tells them apart; MySQL and SQL Server usually don't).
- Literals: strings with quotes \`'France'\`, numbers, \`true\` / \`false\`, dates as \`'1997-01-31'\`.

## Aggregations (group by)

Aggregate functions in \`map\` group by the other fields of the map:

\`\`\`js
Products.map(p => ({ category: p.category.name, products: count(1), avgPrice: avg(p.price), top: max(p.price) }))
Products.having(p => max(p.price) > 50).map(p => ({ category: p.category.name, top: max(p.price) })).sort(p => desc(p.top))
Orders.map(p => ({ total: count(1) }))                                       // one row: [{ total: 830 }]
Orders.details.filter(p => p.order.customer.name == customer).map(p => ({ product: p.product.name, total: sum(p.quantity * p.unitPrice) }))
\`\`\`

\`count\`, \`sum\`, \`avg\`, \`max\`, \`min\`. \`having\` filters the groups. Group by fields (or relation fields), not by
expressions: \`year(p.orderDate)\` next to an aggregate still groups by the whole date; to count per year, filter one year
at a time (\`.filter(p => year(p.orderDate) == 1997)\`).

## Include (related rows as nested objects)

\`\`\`js
Orders.filter(p => p.id == id).include(p => p.customer)                       // manyToOne: an object
Orders.filter(p => p.id == id).include(p => [p.customer, p.details])          // several
Customers.include(p => p.orders.filter(o => year(o.orderDate) == 1997).map(o => ({ id: o.id, date: o.orderDate })))
Orders.include(p => p.details.include(d => d.product))                       // nested
\`\`\`

Use \`include\` to return nested data; use dots in \`filter\` / \`map\` to join flat.

## Functions

- Dates: \`year\`, \`month\`, \`day\`, \`weekday\`, \`hour\`, \`today()\`, \`now()\`, \`addDay(date, n)\`, \`addMonth\`, \`addYear\`,
  \`dayDiff(a, b)\`, \`dateToString(date, 'YYYY-MM-DD')\`.
- Strings: \`upper\`, \`lower\`, \`concat(a, b, …)\`, \`substr(text, from, length)\`, \`trim\`, \`replace\`, \`lpad\`, \`rpad\`, \`strCount\`.
- Numbers: \`round(x, decimals)\`, \`abs\`, \`ceil\`, \`floor\`, \`trunc\`, \`toNumber\`.
- Nulls: \`nvl(value, default)\`, \`isNull\`, \`isNotNull\`.

## Writes (need the write permission)

\`\`\`js
Categories.insert()                                            // the entity in "data": { "name": "Seafood", … }
Orders.insert().include(p => p.details)                        // order and its details in one call
Products.update(p => ({ price: price })).filter(p => p.id == id)
Orders.update().include(p => p.details)                        // the whole entity (details replaced)
Products.delete().filter(p => p.id == id)
Countries.upsert()                                             // insert or update by the unique key
\`\`\`

\`update\` / \`delete\` without filter use the primary key of "data"; to touch every row use \`updateAll\` / \`deleteAll\`.

## Tips

- Check a query with \`orm_plan\` (shows the SQL) before running it; \`orm_parameters\` lists the variables it expects.
- Ask for what you need: \`map\` the fields, aggregate in the query, and \`page(1, n)\` instead of reading many rows.
- Names are those of the domain (entities, properties, relations), not of tables or columns.
- On an error, read the message: it names the entity / property / function that doesn't exist.
`
