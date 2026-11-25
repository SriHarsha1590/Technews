#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 ]]; then
  echo "Usage: $0 s3://bucket/path/technews-TIMESTAMP.archive.gz" >&2
  exit 2
fi
cd "$(dirname "$0")/.."
# Requires an existing empty/recoverable stack; --drop replaces collections in technews.
aws s3 cp "$1" - | docker compose -f docker-compose.prod.yml --env-file .env.production exec -T mongo sh -c \
  'set -eu; umask 077; cfg=$(mktemp); trap '\''rm -f "$cfg"'\'' EXIT; printf "password: %s\n" "$MONGO_BACKUP_PASSWORD" > "$cfg"; mongorestore --config "$cfg" --username "$MONGO_BACKUP_USER" --authenticationDatabase admin --db technews --drop --archive --gzip'
