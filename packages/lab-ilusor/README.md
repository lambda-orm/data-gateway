# Lab — Ilusor Cloud

Reproduces how Ilusor's Cloud uses λORM, to check every pending item of
`docs/LAMBDAORM_PENDING.md` of [lambda-orm/core](https://github.com/lambda-orm/core) before a release. Each test's name starts
with the item it checks (`L1 …`); a release is ready for Ilusor when the whole lab passes.

## The shape

- **One Postgres, one schema per service** (`catalog`, `accounts`, `site`), each owned by its own role (DDL) and
  used through a DML-only role (`<schema>_rw`) — `db/01-schemas.sql`.
- **One `lambdaORM.yaml`**: one domain with every entity and relation, **also between schemas** (`QuoteLines.deviceModel`
  accounts → catalog, `Areas.location` site → accounts, `weak`); one mapping and one source per schema; stage
  `default` (DML users) routes entities by `entity.in([...])`; stage `ddl` (owners) only for push/fetch/pull.
- A **listener** (`InstallationFiles` insert → `Installations.lastEventAt`), the way Ilusor writes what an insert
  drags to other tables.

## Run

From the repo root, once:

```sh
corepack pnpm install
```

From `packages/lab-ilusor`:

```sh
# Postgres on 127.0.0.1:55432 (tmpfs: every `up` starts empty)
docker compose -f docker-compose.yaml -p ilusor-cloud-lab up -d --wait
# create the tables with the owners (stage ddl); --dry only prints the DDL
npx tsx setup.ts
# the tests (lib)
npx jest -c jest.config.json --verbose
# one group or one item
npx jest -c jest.config.json -t "L10"
```

The same with the package's scripts: `npm run up`, `setup`, `lab`, `down`,
and `reset` (down + up + setup: empty tables, as the model creates them now).

The specs are `tests/*.spec.ts` and the package has no `test` script, so `pnpm test` of the repository doesn't run them:
they need the lab's Postgres. λORM comes from npm (`@lambdaorm/lib`, `base`, `client` in `package.json`): a fix of
λORM is checked here once it is released from lambda-orm/core, or with a local build linked in (`pnpm link`).

Before the tests, `globalSetup.ts` checks that Postgres is up, the tables exist and are **in step with the model**
(`stage.fetch`, L22). After a fix that changes the DDL (a type, a length, a default) the tables of an earlier setup are
out of step: it stops with the differing columns and asks for `npm run reset`. The specs never apply DDL
to the lab's tables (`stage.spec.ts` only generates it, on a copy of the workspace), so the lab passes twice in a row
and in any order (`--randomize`).

| Spec | Checks |
| --- | --- |
| `types.spec.ts` | JSON, milliseconds/timestamptz, empty strings, reserved words (L1, L2, L3, L6) |
| `dml.spec.ts` | affected rows, optimistic lock, delete, upsert, bulkInsert, page, count, search (L4, L5, L18, L23) |
| `include.spec.ts` | aggregates, includes across schemas, filter across sources, transactions (L15, L16, L17, L26, L31) |
| `listeners.spec.ts` | listeners awaited, in the sentence's transaction, errors (L10, L11) |
| `script.spec.ts` | `orm.executeScript`: several queries in one transaction across sources, throw, try/catch, for (L32) |
| `stage.spec.ts` | push -o, fetch, pull, renames, catch-all source, string length (L1, L2, L6, L19–L22, L24, L25, L27) |
| `service.spec.ts` | the REST service as Ilusor's clients call it (L4, L5, L9, L12, L14) |
| `composite.spec.ts` | relations of several fields, `(locationId, x)` as Ilusor's iot_location (schema `lab_composite`, created by push) (L34) |
| `documents.spec.ts` | FerretDB (MongoDB API) next to Postgres: no transactions, UUIDs and Decimal128 (L35, L37); FerretDB on 127.0.0.1:57017 (`up` starts it) |
| `model.spec.ts` | the relations of a model, without a database: pairs of existing fields of the same type, the one side a key, `locationId` never dropped, no relation of several fields to MongoDB (L34). The lab's models, and Ilusor's real one when it is on this machine (`ILUSOR_MODEL`, by default `~/ilusor/dev/cloud/data-gateway/workspace/ilusor/lambdaORM.yaml`). `npm run model` runs it alone, without Postgres |
| `uuid.spec.ts` | `uuid` columns, with a model and tables of its own (schema `lab_uuid`, `tests/uuid/lambdaORM.yaml`) so the lab's drift check is untouched (L36, L38) |

### Adding a test

- **Name**: start with the item of `docs/LAMBDAORM_PENDING.md` of [lambda-orm/core](https://github.com/lambda-orm/core) it checks,
  `L<n> <what it expects>` (a new item: add its row with the next `L<n>` first). `-t "L<n>"` then runs it.
- **File**: the spec of its area (table above); a new area, a new `tests/<area>.spec.ts`.
- **Own data**: every test writes its own rows with new ids (`id()`), and only reads those. Never rely on what another
  test (or an earlier run) left, never empty tables, never change the lab's tables (DDL): a change to the model goes to
  a copy of the workspace (`copyWorkspace` in `stage.spec.ts`) and is only generated (`push().sentence()`).
- **Its own Orm**: `newOrm()` in `beforeAll`, `orm.end()` in `afterAll`. Another model (listeners, a property): write
  the changed `lambdaORM.yaml` to a temp folder and `newOrm(thatPath)` (see `ormWithListeners` in `listeners.spec.ts`).
- **Helpers** (`tests/helpers.ts`): `newOrm`, `id`, `affected` (the number an update/delete answered), `pgColumn`
  (a column as Postgres has it, for DDL checks), `svc`/`describeSvc` (service tests, only with `ORM_SVC=1`), `sleep`.
- **What it asserts**: what Ilusor needs (the expected behaviour), not what λORM does today; a test of an open item
  fails until it is fixed.
- Something every engine shares (DML, types, transactions) also belongs in the
  engines lab of lambda-orm/core (`packages/lib/src/dev/labs/engines`), which runs on PostgreSQL, MySQL, MariaDB, SQL Server, Oracle and MongoDB.

### Service tests

```sh
# the published image on 59291
docker compose -f docker-compose.yaml -p ilusor-cloud-lab --profile svc up -d --wait
ORM_SVC=1 npx jest -c jest.config.json tests/service.spec.ts
# the gateway from source on 59292 (packages/data-gateway)
# (--env-file, not `set -a && . .env`: the shell strips the quotes inside the JSON connections)
(LAB=$(pwd) && cd ../data-gateway && \
  DATA_GATEWAY_CONFIG_PATH=$LAB/data-gateway.config.yaml WORKSPACE=$LAB PORT=59292 RATE_LIMIT_MAX=0 SCRIPT_ENABLED=true \
  SERVICE_TOKEN=lab-token npx tsx --env-file=$LAB/.env src/lib/index.ts)
ORM_SVC=1 ORM_URL=http://127.0.0.1:59292 ORM_SVC_TOKEN=lab-token npx jest -c jest.config.json tests/service.spec.ts
```

## Stop

```sh
docker compose -f docker-compose.yaml -p ilusor-cloud-lab --profile svc down
```

`orm_state/` is written by `setup.ts` (push) and is not versioned.
