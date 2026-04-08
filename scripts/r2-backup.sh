#!/usr/bin/env bash
# r2-backup.sh — DB + ログを Cloudflare R2 にバックアップ
#
# Docker 内から実行:
#   docker compose -f docker-compose.prod.yml run --rm batch bash scripts/r2-backup.sh
#
# 必要な環境変数:
#   R2_BUCKET   - バックアップ先バケット名
#   DB_HOST, DB_PORT, DB_USER, DB_NAME, PGPASSWORD
#
# rclone.conf は /etc/rclone/rclone.conf にマウントされている前提

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/backup}"
LOG_DIR="${LOG_DIR:-/var/log/open-regime}"
RCLONE_CONFIG="${RCLONE_CONFIG:-/etc/rclone/rclone.conf}"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DB_FILE="open_regime_db_${TIMESTAMP}.sql.gz"
LOG_FILE="open_regime_logs_${TIMESTAMP}.tar.gz"

mkdir -p "$BACKUP_DIR"

# 1. DB ダンプ
echo "=== DB backup: ${DB_FILE} ==="
pg_dump \
  -h "${DB_HOST:-postgres}" \
  -p "${DB_PORT:-5432}" \
  -U "${DB_USER:-app}" \
  -d "${DB_NAME:-open_regime}" \
  --no-owner \
  --no-privileges \
  | gzip > "${BACKUP_DIR}/${DB_FILE}"
echo "DB dump size: $(du -sh "${BACKUP_DIR}/${DB_FILE}" | cut -f1)"

# 2. ログ tar.gz
echo "=== Logs backup: ${LOG_FILE} ==="
if [ -d "$LOG_DIR" ]; then
  tar czf "${BACKUP_DIR}/${LOG_FILE}" -C "$LOG_DIR" . 2>/dev/null || echo "(tar warning ignored)"
  echo "Logs size: $(du -sh "${BACKUP_DIR}/${LOG_FILE}" | cut -f1)"
else
  echo "(no log dir, skipping)"
fi

# 3. R2 アップロード (rclone)
if [ -f "$RCLONE_CONFIG" ] && [ -n "${R2_BUCKET:-}" ]; then
  echo "=== Upload to R2: ${R2_BUCKET} ==="
  rclone copy "${BACKUP_DIR}/${DB_FILE}" "r2:${R2_BUCKET}/db/" --config "$RCLONE_CONFIG" --s3-no-check-bucket
  if [ -f "${BACKUP_DIR}/${LOG_FILE}" ]; then
    rclone copy "${BACKUP_DIR}/${LOG_FILE}" "r2:${R2_BUCKET}/logs/" --config "$RCLONE_CONFIG" --s3-no-check-bucket
  fi

  # R2 側の古いファイル削除 (7日以上)
  rclone delete "r2:${R2_BUCKET}/db/" --min-age 7d --config "$RCLONE_CONFIG" --s3-no-check-bucket || true
  rclone delete "r2:${R2_BUCKET}/logs/" --min-age 7d --config "$RCLONE_CONFIG" --s3-no-check-bucket || true
else
  echo "(rclone config or R2_BUCKET not set, skipping upload)"
fi

# 4. ローカルの古いファイル削除 (7日以上)
find "$BACKUP_DIR" -name "open_regime_db_*.sql.gz" -mtime +7 -delete 2>/dev/null || true
find "$BACKUP_DIR" -name "open_regime_logs_*.tar.gz" -mtime +7 -delete 2>/dev/null || true

echo "=== Backup complete ==="
