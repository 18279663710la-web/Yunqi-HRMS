#!/usr/bin/env bash
# MySQL + 上传文件 + 运行时密钥备份（Linux / Git Bash）
#
# 备份开关、目录、保留天数从 server/.env 读取：
#   BACKUP_ENABLED=true|false
#   BACKUP_DIR=/var/backups/yunqi
#   BACKUP_RETENTION_DAYS=14
#   MYSQLDUMP_BIN=mysqldump
# 也可用同名环境变量覆盖；日志写入 LOG_DIR/ops/backup/YYYY-MM-DD.log。

set -euo pipefail
umask 077

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
ENV_FILE="$APP_DIR/server/.env"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR 找不到 $ENV_FILE" >&2
  exit 1
fi

read_env() {
  local key="$1" value
  value="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
  value="${value%$'\r'}"
  value="${value%\"}"; value="${value#\"}"
  value="${value%\'}"; value="${value#\'}"
  printf '%s' "$value"
}

LOG_DIR_VALUE="${LOG_DIR:-$(read_env LOG_DIR)}"
LOG_DIR_VALUE="${LOG_DIR_VALUE:-logs}"
if [[ "$LOG_DIR_VALUE" = /* ]]; then
  LOG_ROOT="$LOG_DIR_VALUE"
else
  LOG_ROOT="$APP_DIR/server/$LOG_DIR_VALUE"
fi
LOG_FILE_DIR="$LOG_ROOT/ops/backup"
mkdir -p "$LOG_FILE_DIR"
LOG_FILE="$LOG_FILE_DIR/$(date '+%Y-%m-%d').log"

log() {
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" | tee -a "$LOG_FILE"
}

BACKUP_ENABLED="${BACKUP_ENABLED:-$(read_env BACKUP_ENABLED)}"
BACKUP_ENABLED="${BACKUP_ENABLED:-true}"
if [[ "${BACKUP_ENABLED,,}" == "false" ]]; then
  log "备份已关闭（BACKUP_ENABLED=false）"
  exit 0
fi

BACKUP_DIR="${BACKUP_DIR:-$(read_env BACKUP_DIR)}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/yunqi}"
RETENTION_DAYS="${RETENTION_DAYS:-$(read_env BACKUP_RETENTION_DAYS)}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
MYSQLDUMP_BIN="${MYSQLDUMP_BIN:-$(read_env MYSQLDUMP_BIN)}"
MYSQLDUMP_BIN="${MYSQLDUMP_BIN:-mysqldump}"
mkdir -p "$BACKUP_DIR"

if ! command -v "$MYSQLDUMP_BIN" >/dev/null 2>&1; then
  log "ERROR 找不到 mysqldump：$MYSQLDUMP_BIN"
  exit 1
fi

DB_HOST="$(read_env MYSQL_HOST)"
DB_PORT="$(read_env MYSQL_PORT)"
DB_USER="$(read_env MYSQL_USER)"
DB_PASSWORD="$(read_env MYSQL_PASSWORD)"
DB_NAME="$(read_env MYSQL_DATABASE)"
DB_HOST="${DB_HOST:-127.0.0.1}"
if [[ -z "$DB_USER" || -z "$DB_NAME" ]]; then
  log "ERROR server/.env 缺少 MYSQL_USER / MYSQL_DATABASE"
  exit 1
fi
DB_PORT="${DB_PORT:-3306}"

STAMP="$(date '+%Y%m%d_%H%M%S')"
DUMP_FILE="$BACKUP_DIR/yunqi_${STAMP}.sql.gz"
DEFAULTS_FILE="$(mktemp)"
trap 'rm -f "$DEFAULTS_FILE"' EXIT

cat > "$DEFAULTS_FILE" <<EOF
[client]
host=$DB_HOST
port=$DB_PORT
user=$DB_USER
password=$DB_PASSWORD
default-character-set=utf8mb4
EOF

log "开始备份数据库 $DB_NAME@$DB_HOST:$DB_PORT"
if "$MYSQLDUMP_BIN" --defaults-extra-file="$DEFAULTS_FILE" \
  --single-transaction --quick --routines --triggers --events --set-gtid-purged=OFF \
  --databases "$DB_NAME" | gzip -c > "$DUMP_FILE"; then
  log "数据库备份完成：$DUMP_FILE（$(du -h "$DUMP_FILE" | cut -f1)）"
else
  rm -f "$DUMP_FILE"
  log "ERROR 数据库备份失败"
  exit 1
fi

for dir in uploads .runtime; do
  if [[ -d "$APP_DIR/server/$dir" ]]; then
    ARCHIVE="$BACKUP_DIR/yunqi_${dir#.}_${STAMP}.tar.gz"
    tar -czf "$ARCHIVE" -C "$APP_DIR/server" "$dir"
    log "已备份 $dir：$ARCHIVE（$(du -h "$ARCHIVE" | cut -f1)）"
  fi
done

log "清理 ${RETENTION_DAYS} 天前的备份"
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'yunqi_*' -mtime "+$RETENTION_DAYS" -print -delete | while read -r file; do
  log "已删除旧备份：$file"
done

log "备份完成"
