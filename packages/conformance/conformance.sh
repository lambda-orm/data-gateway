#!/usr/bin/env bash
# The environment of the conformance suite (README.md).
#
#   ./conformance.sh up image   Postgres and the gateway of an image (DATA_GATEWAY_IMAGE), fresh
#   ./conformance.sh up db      only Postgres, fresh: then start a gateway from source on the same ports (see
#                               scripts/ci-local.sh clients) and run `data`
#   ./conformance.sh data       wait for the gateway, create the tables of northwind (lambdaorm push, with the CLI of
#                               the image) and import its data through the REST API
#   ./conformance.sh down       stop and remove everything
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

IMAGE=${DATA_GATEWAY_IMAGE:-flaviorita/data-gateway:3.0.3}
export DATA_GATEWAY_IMAGE=$IMAGE
HTTP=http://127.0.0.1:19080
BACKEND_KEY=conformance-backend-key

wait_ready () {
	for _ in $(seq 1 90); do
		curl -sf "$HTTP/schemas" 2> /dev/null | grep -q '"status":"ready"' && return 0
		sleep 1
	done
	echo 'the schema northwind is not ready on the gateway' >&2
	return 1
}

# the gateway of the image runs as the user that owns the workspace (its stage state, orm_state, is written by the push
# of data and then by the gateway): the uid of a CI runner (1001) is not the one of the image (1000)
export CONFORMANCE_UID="${CONFORMANCE_UID:-$(id -u)}" CONFORMANCE_GID="${CONFORMANCE_GID:-$(id -g)}"

case "${1:-}" in
up)
	case "${2:-}" in
	image) profile=(--profile image) ;;
	db) profile=() ;;
	*) echo 'usage: ./conformance.sh up image|db' >&2; exit 2 ;;
	esac
	docker compose --profile image down -v > /dev/null 2>&1 || true
	rm -rf workspace/northwind/orm_state
	docker compose "${profile[@]}" up -d --wait
	;;
data)
	wait_ready
	# the tables: the CLI of the image, against the published Postgres
	docker run --rm --network host --user "$CONFORMANCE_UID:$CONFORMANCE_GID" -v "$PWD/workspace:/workspace" \
		-e NORTHWIND_DB='{"host":"127.0.0.1","port":19432,"user":"northwind","password":"northwind","database":"northwind"}' \
		"$IMAGE" lambdaorm push -w /workspace/northwind -s default > /dev/null
	status=$(curl -s -o "${TMPDIR:-/tmp}/conformance-import.json" -w '%{http_code}' -X POST "$HTTP/northwind/stages/default/import" \
		-H "X-Api-Key: $BACKEND_KEY" -H 'Content-Type: application/json' -d @data.json)
	[ "$status" = 204 ] || { echo "the import of northwind answered $status: $(head -c 600 "${TMPDIR:-/tmp}/conformance-import.json")" >&2; exit 1; }
	echo 'northwind is ready'
	;;
down)
	docker compose --profile image down -v
	rm -rf workspace/northwind/orm_state
	;;
*)
	echo 'usage: ./conformance.sh up image|db | data | down' >&2
	exit 2
	;;
esac
