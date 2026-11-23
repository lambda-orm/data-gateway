# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`lambdaorm-data-gateway` is a public **pnpm monorepo** (`packages/*`) for the λORM Data Gateway, split from
[lambda-orm/core](https://github.com/lambda-orm/core) with its history. λORM itself (`@lambdaorm/base`, `@lambdaorm/lib`,
`@lambdaorm/client`, `@lambdaorm/cli`) stays in core and is consumed **from npm**: a change the gateway needs in λORM is
released from core first, then its version is bumped here.

## Packages

| Package | npm name | Published? | Purpose |
| --- | --- | --- | --- |
| `data-gateway` | `@lambdaorm/data-gateway` | **no** (image `flaviorita/data-gateway`) | The gateway. Builds with Grunt (`Gruntfile.js`); serves no UI: its `management` port (optional) is the API of the IDE and the administration. No CORS. Depends on `@lambdaorm/base`, `lib`, `client` (npm). |
| `ide` | `@lambdaorm/data-gateway-ide` | **no** (image `flaviorita/data-gateway-ide`) | Vite app (connections in the browser, no login) and its backend `server/server.mjs` (Node, no dependencies), which serves it and proxies to the gateways' `management` (`/gw/{base64url}/…`, `DATA_GATEWAY_IDE_TARGETS`). Depends on `ui`. |
| `ide-desktop` | `@lambdaorm/data-gateway-ide-desktop` | **no** (GitHub releases `ide-v<version>`) | The IDE as a desktop app (Electron): `packages/ide/dist` and its `server.mjs` inside, served at `app://ide`, the proxy on 127.0.0.1 with a token per run. electron-builder (`electron-builder.config.cjs`), built by `ide-desktop.yml`. |
| `ui` | `@lambdaorm/ui` | yes | React components (Vite library mode, Vitest). Reads `@lambdaorm/base`'s `queryable.d.ts` from node_modules at build time. |
| `client-node` | `@lambdaorm/data-gateway-client` | yes | Node client over REST, WebSocket, MCP. Depends on `@lambdaorm/base` (npm). |
| `conformance` | — | no | The conformance suite (cases, compose, reference runner) the clients pass. |
| `lab-ilusor` | `@lambdaorm/lab-ilusor` | no | The ilusor-cloud lab (from core's `packages/lib/src/dev/labs/ilusor-cloud`): λORM from npm on Postgres and FerretDB as Ilusor's Cloud uses it; specs named after the items `L<n>` of core's `docs/LAMBDAORM_PENDING.md`. No `test` script: `npm run up && npm run setup && npm run lab`. |

## Commands

From the repo root with `pnpm`:

```bash
pnpm install
pnpm build    # ui → tsc -b (data-gateway, client-node) → ide
pnpm lint
pnpm test
pnpm --filter @lambdaorm/data-gateway run test:integration
scripts/ci-local.sh check             # the CI in a clean checkout of HEAD
scripts/ci-local.sh clients [<image>] # the conformance suite (Docker)
scripts/ci-local.sh lab               # the ilusor-cloud lab (Docker)
```

Per package (`packages/<pkg>`): `npm run lint|build|test|dist`. `client-node` and `ui` use the shared
`scripts/dist.mjs` for `dist`; `data-gateway` uses Grunt.

## Releasing

See [DEPLOY.md](./DEPLOY.md). `ui` and `client-node` go to npm through **Changesets** (`pnpm changeset` when you touch
their `src/`). The gateway and the IDE are Docker images published by their workflows when their `package.json` version
reaches `main` (bump it with its CHANGELOG entry on a `release/data-gateway-<version>` or `release/ide-<version>` branch).

## Architecture

Each TypeScript package under `src/lib/` follows the same layering: `domain/` (pure interfaces and value objects),
`application/` (use cases), `infrastructure/` (I/O, transports, serialization). The UI library follows the same split
under `src/` (`components/`, `domain/`, `infrastructure/`).

## Commit and branch conventions

Commits follow **Conventional Commits** plus a ticket number (e.g. `#235`) required in the body (`commitlint.config.js`,
checked on pull requests). Allowed types: `ci`, `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `revert`,
`chore`. Header max 72 chars. Branches follow Git Flow (`feature/`, `bugfix/`, `hotfix/`, `release/`, `support/`);
`main` and `develop` take pull requests only.
