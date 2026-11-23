# Deploy Guide

Everything is published by GitHub Actions from `main`; `main` and `develop` take pull requests only (Git Flow).

| What | Where | Workflow | When |
| --- | --- | --- | --- |
| `@lambdaorm/ui` (`packages/ui`) | npm | `release.yml` (Changesets) | pending changesets reach `main` |
| `@lambdaorm/data-gateway-client` (`packages/client-node`) | npm | `release.yml` (Changesets) | pending changesets reach `main` |
| `flaviorita/data-gateway` (`packages/data-gateway`) | Docker Hub | `data-gateway-image.yml` | a version of `packages/data-gateway/package.json` not on Docker Hub reaches `main` |
| `flaviorita/data-gateway-ide` (`packages/ide`) | Docker Hub | `ide-image.yml` | a version of `packages/ide/package.json` not on Docker Hub reaches `main` |
| The desktop IDE (`packages/ide-desktop`): Linux, Windows, macOS | GitHub release `ide-v<version>` of this repository | `ide-desktop.yml` | a version of `packages/ide/package.json` without its release reaches `main` |

`ci.yml` builds, lints and tests every push to `develop`/`main` and every pull request, runs the integration tests of
the gateway and the conformance suite against the gateway from source, and checks the commit messages of a pull
request. `lab-ilusor.yml` runs the ilusor-cloud lab. `scripts/ci-local.sh check`, `clients` and `lab` do the same
locally.

## Secrets

Repository secrets (`Settings → Secrets and variables → Actions`):

- `NPM_TOKEN`: an npm token that publishes `@lambdaorm/ui` and `@lambdaorm/data-gateway-client` (Automation, or
  granular with Read and write on both; a granular token can't create a package, so the first publish of
  `@lambdaorm/data-gateway-client` needs an Automation token).
- `CHANGESET_TOKEN`: a GitHub token with write access to the repository (contents and pull requests). The default
  `GITHUB_TOKEN` can't trigger the CI of the pull request Changesets opens.
- `DOCKERHUB_TOKEN`: a Docker Hub access token (Read & Write) of `flaviorita`.

## npm packages (Changesets)

When a change touches `packages/ui/src` or `packages/client-node/src`, run `pnpm changeset`, pick the package and the
bump, and commit the generated `.changeset/*.md` with the code. On `main`, `release.yml` opens (or updates) the
**"chore: version packages"** pull request with the versions and the CHANGELOGs; merging it publishes the versions that
aren't on npm from each package's `dist/` (`scripts/publish.mjs`) and merges `main` back into `develop`.

## Images

The gateway and the IDE are not in Changesets (`ignore` in `.changeset/config.json`). To release one, on a
`release/data-gateway-<version>` or `release/ide-<version>` branch from `develop`: bump the version in its
`package.json`, move its CHANGELOG's *Unreleased* entries under the version, and merge it to `main` (and back to
`develop`). The workflow builds the image, tests it (the gateway with the conformance suite on its five transports, the
IDE with `/health` and its page), pushes `<version>` and `latest` (not for a prerelease such as `3.3.0-rc.1`), and tags
`data-gateway-v<version>` or `ide-v<version>`. A version already on Docker Hub is skipped; *Run workflow* with
`force` publishes it again.

The gateway image installs the latest `@lambdaorm/cli` from npm, and the gateway depends on `@lambdaorm/base`,
`@lambdaorm/lib` and `@lambdaorm/client` from npm: when it needs a change of λORM, that change is released from
[lambda-orm/core](https://github.com/lambda-orm/core) first and its version bumped here.

## The desktop IDE

`ide-desktop.yml` builds the executables of `packages/ide-desktop` (Electron) on GitHub-hosted runners, one job per OS
for both architectures (x64, arm64), and smoke-tests each architecture on a native runner:

| OS | Files |
| --- | --- |
| Linux | `data-gateway-ide-<version>-linux-x86_64.AppImage`, `…-linux-arm64.AppImage`, `…-linux-amd64.deb`, `…-linux-arm64.deb` |
| Windows | `data-gateway-ide-<version>-win.exe` (both architectures), `…-win-x64.exe`, `…-win-arm64.exe` |
| macOS | `data-gateway-ide-<version>-mac-x64.dmg` / `.zip`, `…-mac-arm64.dmg` / `.zip` |

With the `latest*.yml` and `.blockmap` files of the updater, they are published as the GitHub release `ide-v<version>`
of this repository (its notes: the entry of that version in `packages/ide/CHANGELOG.md`), with the `GITHUB_TOKEN`. The
version is the IDE's: the same release bumps the image and the executables.

**The latest release of this repository is always the IDE's**: the updater of the app (Windows, AppImage) and the IDE
page of the wiki read it. So Changesets creates no GitHub releases (`createGithubReleases: false` in `release.yml`), the
gateway's workflow only tags, and a release made by hand is never marked latest. A prerelease (`1.2.0-rc.1`) is published
as such, not latest. The executables are not signed yet: Gatekeeper (macOS) and SmartScreen (Windows) warn the first
time.

