#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
set -a
# shellcheck disable=SC1091
source ./.env.production
set +a
: "${BACKUP_S3_URI:?Set BACKUP_S3_URI in .env.production}"
command -v aws >/dev/null
stamp="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
# Pipe directly to off-host storage. pipefail makes upload or dump failures visible to the scheduler.
docker compose -f docker-compose.prod.yml --env-file .env.production exec -T mongo sh -c \
  'set -eu; umask 077; cfg=$(mktemp); trap '\''rm -f "$cfg"'\'' EXIT; printf "password: %s\n" "$MONGO_BACKUP_PASSWORD" > "$cfg"; mongodump --config "$cfg" --username "$MONGO_BACKUP_USER" --authenticationDatabase admin --db technews --archive --gzip' \
  | aws s3 cp - "${BACKUP_S3_URI%/}/technews-${stamp}.archive.gz" --sse AES256
