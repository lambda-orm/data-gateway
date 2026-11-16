# Lab — Ilusor Cloud

Reproduces how Ilusor's Cloud uses λORM, to check every pending item of
[`docs/LAMBDAORM_PENDING.md`](../../../../../../docs/LAMBDAORM_PENDING.md) before a release. Each test's name starts
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
(cd packages/base && npx tsc -b)
```

From `packages/lib`:

```sh
# Postgres on 127.0.0.1:55432 (tmpfs: every `up` starts empty)
docker compose -f src/dev/labs/ilusor-cloud/docker-compose.yaml -p ilusor-cloud-lab up -d --wait
# create the tables with the owners (stage ddl); --dry only prints the DDL
npx tsx src/dev/labs/ilusor-cloud/setup.ts
# the tests (lib)
npx jest -c src/dev/labs/ilusor-cloud/jest.config.json --verbose
# one group or one item
npx jest -c src/dev/labs/ilusor-cloud/jest.config.json -t "L10"
```

The specs are `tests/*.spec.ts` (not `*.test.ts`), so the package's own `npm test` doesn't pick them up.

| Spec | Checks |
| --- | --- |
| `types.spec.ts` | JSON, milliseconds/timestamptz, empty strings, reserved words (L1, L2, L3, L6) |
| `dml.spec.ts` | affected rows, optimistic lock, delete, upsert, bulkInsert, page, count, search (L4, L5, L18, L23) |
| `include.spec.ts` | aggregates, includes across schemas, filter across sources, transactions (L15, L16, L17, L26) |
| `listeners.spec.ts` | listeners awaited, in the sentence's transaction, errors (L10, L11) |
| `stage.spec.ts` | push -o, fetch, pull, renames, catch-all source, string length (L1, L2, L6, L19–L22, L24, L25, L27) |
| `service.spec.ts` | the REST service as Ilusor's clients call it (L4, L5, L9, L12, L14) |

### Service tests

```sh
# the published image on 59291
docker compose -f src/dev/labs/ilusor-cloud/docker-compose.yaml -p ilusor-cloud-lab --profile svc up -d --wait
ORM_SVC=1 npx jest -c src/dev/labs/ilusor-cloud/jest.config.json tests/service.spec.ts
# this repo's packages/service on 59292
(cd ../service && set -a && . ../lib/src/dev/labs/ilusor-cloud/.env && set +a && \
  WORKSPACE=../lib/src/dev/labs/ilusor-cloud PORT=59292 RATE_LIMIT_MAX=100000 npx tsx src/lib/index.ts)
ORM_SVC=1 ORM_URL=http://127.0.0.1:59292 npx jest -c src/dev/labs/ilusor-cloud/jest.config.json tests/service.spec.ts
```

## Stop

```sh
docker compose -f src/dev/labs/ilusor-cloud/docker-compose.yaml -p ilusor-cloud-lab --profile svc down
```

`orm_state/` is written by `setup.ts` (push) and is not versioned.
