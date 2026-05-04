#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${CHEMISTRY_CACHE_SYNC_ENV:-$ROOT_DIR/services/chemistry/cache-sync.env}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

: "${CHEMISTRY_SERVICE_URL:?CHEMISTRY_SERVICE_URL is required}"
: "${CHEMISTRY_SERVICE_TOKEN:?CHEMISTRY_SERVICE_TOKEN is required}"

cd "$ROOT_DIR"
python3 scripts/warm-pubchem-cache.py \
  --sync-url "$CHEMISTRY_SERVICE_URL" \
  --token "$CHEMISTRY_SERVICE_TOKEN" \
  --delay "${CHEMISTRY_CACHE_SYNC_DELAY:-1.5}" \
  --max "${CHEMISTRY_CACHE_SYNC_MAX:-100}"
