#!/bin/sh
# Records one shot with the Playwright image (same version as client/package.json).
# usage: tools/promo/run.sh tools/promo/shots/<shot>.json
# Add --device /dev/dri via PROMO_DOCKER_ARGS if the machine has a GPU. Without a GPU set
# PROMO_GL=software (very slow, see README.md). Output: ~/.cache/openradlr/promo/raw/<shot>/
set -e
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT=${PROMO_OUT:-$HOME/.cache/openradlr/promo}
mkdir -p "$OUT"
SHOT=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
# shellcheck disable=SC2086
docker run --rm --network host --shm-size=1g ${PROMO_DOCKER_ARGS:-} \
  -e PROMO_OUT=/out -e PROMO_GL="${PROMO_GL:-gpu}" \
  -v "$ROOT/tools/promo/rec.mjs:/promo/rec.mjs:ro" -v "$ROOT/client/node_modules:/promo/node_modules:ro" \
  -v "$SHOT:/promo/shot.json:ro" -v "$OUT:/out" -w /promo \
  mcr.microsoft.com/playwright:v1.64.1-noble node rec.mjs shot.json
