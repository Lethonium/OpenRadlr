#!/bin/sh
# Adds settings that are new in .env.example to an existing .env.
#
#   tools/env-sync.sh [example] [env]      (defaults: .env.example .env)
#
# Only keys missing from .env are appended, each with the comment block that
# explains it in the example. Lines already in .env, including your values and
# comments, are never changed. A key counts as present when .env assigns it
# (KEY=...); commented-out keys don't count. Running it twice adds nothing.
set -eu

example=${1:-.env.example}
env=${2:-.env}

[ -f "$example" ] || { echo "env-sync: $example not found" >&2; exit 1; }
[ -f "$env" ] || { echo "env-sync: $env not found" >&2; exit 1; }

key_re='^[A-Za-z_][A-Za-z0-9_]*='

added=$(awk -v key_re="$key_re" '
  # First file (.env): remember the keys it assigns.
  FNR == NR {
    if ($0 ~ key_re) { k = $0; sub(/=.*/, "", k); have[k] = 1 }
    next
  }
  # Second file (.env.example): collect comment blocks, print a block with
  # the first missing key that follows it.
  $0 ~ key_re {
    k = $0; sub(/=.*/, "", k)
    if (!(k in have)) {
      if (block != "") { printf "%s", block; block = "" }
      print
      have[k] = 1
    } else {
      block = ""
    }
    next
  }
  # Blank line after a key ends the previous group; start a fresh block.
  /^[[:space:]]*$/ { if (block != "") block = block "\n"; next }
  { block = block $0 "\n" }
' "$env" "$example")

if [ -z "$added" ]; then
  exit 0
fi

{
  # Keep a newline between the old last line and the new section.
  [ -n "$(tail -c1 "$env")" ] && echo
  echo
  echo "# === Added from $(basename "$example") on $(date +%Y-%m-%d) ==="
  printf '%s\n' "$added"
} >> "$env"

echo "Added new settings to $env:"
printf '%s\n' "$added" | grep -E "$key_re" | sed 's/=.*//; s/^/  /'
