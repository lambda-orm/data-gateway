#!/usr/bin/env bash
# What the GitHub workflows do, run locally, before a push.
#
#   scripts/ci-local.sh check             build, lint and test every package in a clean checkout of HEAD, the
#                                         integration tests of the gateway, and the READMEs' links to the wiki (ci.yml)
#   scripts/ci-local.sh lab               the ilusor-cloud lab (packages/lab-ilusor) on its Postgres and FerretDB in
#                                         Docker (lab-ilusor.yml)
#   scripts/ci-local.sh clients [<image>] the conformance suite (packages/conformance) on its five transports, with the
#                                         reference runner and the Node client, against the gateway from source, or
#                                         against <image> (e.g. flaviorita/data-gateway:3.2.0)
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# what to undo on exit, also when a step fails: worktrees, containers, processes
CLEANUP=()
cleanup () { for action in "${CLEANUP[@]}"; do eval "$action" > /dev/null 2>&1 || true; done; }
trap cleanup EXIT
on_exit () { CLEANUP+=("$1"); }

# pnpm (the version of packageManager) through corepack when it isn't on the PATH: an executable, since the npm scripts
# of the repository call pnpm too
if ! command -v pnpm > /dev/null; then
	PNPM_SHIM=$(mktemp -d)
	printf '#!/bin/sh\nexec corepack pnpm "$@"\n' > "$PNPM_SHIM/pnpm"
	chmod +x "$PNPM_SHIM/pnpm"
	PATH="$PNPM_SHIM:$PATH"
	on_exit "rm -r '$PNPM_SHIM'"
fi

step () { printf '\n\033[1m→ %s\033[0m\n' "$*"; }
ok () { printf '\033[32m✓ %s\033[0m\n' "$*"; }
fail () { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

check () {
	local tree
	tree=$(mktemp -d)
	on_exit "git -C '$ROOT' worktree remove --force '$tree'"
	step "Clean checkout of $(git -C "$ROOT" rev-parse --short HEAD)"
	git -C "$ROOT" worktree add -q --detach "$tree" HEAD
	cd "$tree"
	step 'Install';  pnpm install --frozen-lockfile
	step 'Build';    pnpm build
	step 'Lint';     pnpm lint
	step 'Typecheck (IDE)'; pnpm --filter @lambdaorm/data-gateway-ide run typecheck
	step 'Test';     pnpm test
	step 'Integration test (data-gateway)'; pnpm --filter @lambdaorm/data-gateway run test:integration
	step 'Links to the wiki'; node scripts/check-wiki-links.mjs
	ok 'check passed'
}

lab () {
	local dir="$ROOT/packages/lab-ilusor"
	step 'ilusor-cloud lab: the databases'
	on_exit "(cd '$dir' && npm run down)"
	(cd "$dir" && npm run up && npm run setup > /dev/null)
	step 'ilusor-cloud lab'
	(cd "$dir" && npm run lab -- --verbose)
	ok 'ilusor-cloud lab passed'
}

clients () {
	local suite log svc
	suite="$ROOT/packages/conformance"
	on_exit "'$suite/conformance.sh' down"
	if [ -n "${1:-}" ]; then
		step "Conformance suite: the image $1"
		DATA_GATEWAY_IMAGE=$1 "$suite/conformance.sh" up image
		DATA_GATEWAY_IMAGE=$1 "$suite/conformance.sh" data
	else
		step 'Conformance suite: the gateway from source'
		pnpm --dir "$ROOT" build
		"$suite/conformance.sh" up db
		log=$(mktemp)
		# in a process group of its own (setsid), so that the exit stops npx, tsx and node together
		setsid bash -c "cd '$ROOT/packages/data-gateway' && exec env DATA_GATEWAY_CONFIG_PATH='$suite/data-gateway.config.yaml' \
			CONFORMANCE_WORKSPACE='$suite/workspace' \
			NORTHWIND_DB='{\"host\":\"127.0.0.1\",\"port\":19432,\"user\":\"northwind\",\"password\":\"northwind\",\"database\":\"northwind\"}' \
			CONFORMANCE_HTTP_PORT=19080 CONFORMANCE_MCP_HTTP_PORT=19081 CONFORMANCE_MCP_WS_PORT=19082 CONFORMANCE_WS_PORT=19083 \
			npx tsx src/lib/index.ts" > "$log" 2>&1 &
		svc=$!
		on_exit "kill -- -$svc"
		"$suite/conformance.sh" data || { cat "$log"; fail 'the gateway from source did not start'; }
	fi
	step 'Conformance suite: the reference runner (runner/index.mjs)'
	node "$suite/runner/index.mjs"
	step 'Conformance suite: the Node client (@lambdaorm/data-gateway-client)'
	(cd "$ROOT/packages/client-node" && npx tsx conformance/run.ts)
	ok 'conformance suite passed'
}

command=${1:-}
shift || true
case "$command" in
check) check ;;
lab) lab ;;
clients) clients "${1:-}" ;;
*) sed -n '2,10p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
