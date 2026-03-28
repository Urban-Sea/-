#!/usr/bin/env bash
# r2-backup.sh — PostgreSQL ダンプを gzip 圧縮で出力
#
# Docker内から実行:
#   docker compose run --rm batch bash scripts/r2-backup.sh
#
# 出力: /backup/open_regime_YYYYMMDD_HHMMSS.sql.gz
# R2 アップロードは VPS 契約後に追加予定。

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backup}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="open_regime_${TIMESTAMP}.sql.gz"

mkdir -p "$BACKUP_DIR"

echo "=== PostgreSQL backup: ${FILENAME} ==="

pg_dump \
  -h "${DB_HOST:-postgres}" \
  -p "${DB_PORT:-5432}" \
  -U "${DB_USER:-app}" \
  -d "${DB_NAME:-open_regime}" \
  --no-owner \
  --no-privileges \
  | gzip > "${BACKUP_DIR}/${FILENAME}"

SIZE=$(du -sh "${BACKUP_DIR}/${FILENAME}" | cut -f1)
echo "=== Done: ${BACKUP_DIR}/${FILENAME} (${SIZE}) ==="

# 7日以上前のバックアップを削除
find "$BACKUP_DIR" -name "open_regime_*.sql.gz" -mtime +7 -delete 2>/dev/null || true
echo "=== Cleaned backups older than 7 days ==="

# TODO: R2 アップロード（VPS契約後に追加）
# aws s3 cp "${BACKUP_DIR}/${FILENAME}" "s3://open-regime-backups/${FILENAME}" \
#   --endpoint-url "${R2_ENDPOINT}" \
#   --region auto
