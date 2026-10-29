#!/bin/sh
# Starts the promo server on 127.0.0.1:8080 with bots.
# usage: tools/promo/server.sh [route] [riders] [time-scale]
# A time scale other than 1 needs the image built with time-scale.patch (see README.md).
set -e
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
IMAGE=${PROMO_IMAGE:-openradlr-server:promo}
docker rm -f openradlr-promo >/dev/null 2>&1 || true
docker run -d --name openradlr-promo -p 127.0.0.1:8080:8080 \
  -v "$ROOT/routes:/app/routes:ro" \
  -e OPENRADLR_ROUTE_FILE="/app/routes/${1:-rolling-hills}.json" -e OPENRADLR_ROUTES_DIR=/app/routes \
  -e OPENRADLR_TARGET_RIDERS="${2:-20}" -e OPENRADLR_BOT_SEED=7 -e OPENRADLR_RACE_COUNTDOWN_S=10 \
  -e OPENRADLR_MAX_CONNECTIONS_PER_IP=20 \
  -e OPENRADLR_TIME_SCALE="${3:-1}" "$IMAGE" >/dev/null
sleep 2
curl -sf localhost:8080/healthz >/dev/null && echo "server up (time scale ${3:-1})"
