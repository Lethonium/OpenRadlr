#!/bin/sh
# Runs the server with accounts (ADR 0032) on http://localhost:${OPENRADLR_ID_PORT:-8090}:
# `make dev-id`. Its data and a generated secret key stay in .data/id, so sign-ins
# survive restarts. Sign-in codes are mailed with the OPENRADLR_SMTP_* settings
# from .env; without them they appear in this log. Values are passed on, never printed.
set -eu
cd "$(dirname "$0")/.."
port="${OPENRADLR_ID_PORT:-8090}"
mkdir -p .data/id
[ -s .data/id/secret ] || openssl rand -hex 32 > .data/id/secret

if [ -f .env ]; then
  smtp_lines=$(grep -E '^OPENRADLR_SMTP_[A-Z]+=' .env || true)
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    key=${line%%=*}
    value=${line#*=}
    # Docker Compose drops quotes around a value; so does this.
    case $value in
      \"*\") value=${value#\"}; value=${value%\"} ;;
      \'*\') value=${value#\'}; value=${value%\'} ;;
    esac
    export "$key=$value"
  done <<LINES
$smtp_lines
LINES
fi

if [ -n "${OPENRADLR_SMTP_HOST:-}" ]; then
  echo "Accounts on http://localhost:$port; sign-in codes are mailed via $OPENRADLR_SMTP_HOST."
else
  echo "Accounts on http://localhost:$port; no OPENRADLR_SMTP_* in .env, so sign-in codes appear in this log."
fi

cd server
OPENRADLR_ID=on \
OPENRADLR_PUBLIC_URL="http://localhost:$port" \
OPENRADLR_DATA_DIR=../.data/id \
OPENRADLR_SECRET_KEY="$(cat ../.data/id/secret)" \
OPENRADLR_STATIC_DIR=../client/public \
OPENRADLR_ROUTES_DIR=../routes \
OPENRADLR_ROUTE_FILE=../routes/rolling-hills.json \
OPENRADLR_BIND="127.0.0.1:$port" \
RUST_LOG="${RUST_LOG:-info}" \
exec cargo run --bin openradlr-server
