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
| `data-gateway` | `@lambdaorm/data-gateway` | **no** (image `flaviorita/data-gateway`) | The gateway. Builds with Grunt (`Gruntfile.js`); its `/ui` is the IDE in embedded mode. Depends on `@lambdaorm/base`, `lib`, `client` (npm) and `ide` (workspace). |
| `ide` | `@lambdaorm/data-gateway-ide` | **no** (image `flaviorita/data-gateway-ide`) | Vite app: the IDE (connections in the browser, no login) and, with `--mode embedded`, the UI a gateway serves. Depends on `ui`. |
| `ui` | `@lambdaorm/ui` | yes | React components (Vite library mode, Vitest). Reads `@lambdaorm/base`'s `queryable.d.ts` from node_modules at build time. |
| `client-node` | `@lambdaorm/data-gateway-client` | yes | Node client over REST, WebSocket, MCP. Depends on `@lambdaorm/base` (npm). |
| `conformance` | — | no | The conformance suite (cases, compose, reference runner) the clients pass. |

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
