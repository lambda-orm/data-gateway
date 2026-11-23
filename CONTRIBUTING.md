# Contributing to the λORM Data Gateway

Thanks for helping. Bugs and ideas: [issues](https://github.com/lambda-orm/data-gateway/issues). A security problem:
see [SECURITY.md](SECURITY.md), not a public issue.

## Pull requests

1. Branch from `develop` following Git Flow: `feature/<name>`, `bugfix/<name>`.
2. `pnpm install`, then `pnpm build`, `pnpm lint` and `pnpm test` (or `scripts/ci-local.sh check`).
3. If you changed `packages/ui/src` or `packages/client-node/src`, add a changeset: `pnpm changeset`.
4. Commits: [Conventional Commits](https://www.conventionalcommits.org/) with the number of the issue in the body
   (`#123`); types `ci`, `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `revert`, `chore`.
5. Open the pull request against `develop`. The CI must pass.

A change the gateway needs in λORM itself (the query language, the schema, the dialects) belongs to
[lambda-orm/core](https://github.com/lambda-orm/core).

## Code of conduct

[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
