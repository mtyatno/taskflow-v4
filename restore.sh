#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════╗
# ║    TaskFlow V4 — Restore Script                      ║
# ║    Usage: ./restore.sh <backup-file.tar.gz>          ║
# ╚══════════════════════════════════════════════════════╝

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $1"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
err()   { echo -e "${RED}[ERROR]${NC} $1"; }

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║    🔄 TaskFlow V4 — Restore              ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}"
echo ""

# ── Validasi argumen ──
if [ -z "${1:-}" ]; then
    echo "Usage: ./restore.sh <backup-file.tar.gz> [target-dir]"
    echo ""
    echo "Contoh:"
    echo "  ./restore.sh ~/backups/taskflow-backup-20260317-200000.tar.gz"
    echo "  ./restore.sh backup.tar.gz ~/todo-system/taskflow-v4"
    echo ""
    echo "Backup yang tersedia:"
    ls -1th ~/backups/taskflow-backup-*.tar.gz 2>/dev/null | head -5 || echo "  (tidak ada)"
    exit 1
fi

BACKUP_FILE="$1"
TARGET_DIR="${2:-$(pwd)}"

if [ ! -f "$BACKUP_FILE" ]; then
    err "File backup tidak ditemukan: $BACKUP_FILE"
    exit 1
fi

info "Backup file : $BACKUP_FILE"
info "Target dir  : $TARGET_DIR"
echo ""

# ── Konfirmasi ──
echo -e "${YELLOW}${BOLD}⚠️  PERHATIAN!${NC}"
echo ""
echo "  Restore akan MENIMPA file berikut di target:"
echo "    - Semua .py files (bot, webapp, config, dll)"
echo "    - Database (taskflow.db)"
echo "    - Uploads (lampiran)"
echo "    - Static files (index.html)"
echo "    - Config (.env)"
echo ""
echo "  File yang ada sekarang akan di-backup ke .pre-restore/"
echo ""
read -rp "Lanjutkan restore? (y/N): " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "Dibatalkan."
    exit 0
fi
echo ""

# ── Stop services ──
info "Step 1/6 — Stopping services..."
sudo systemctl stop taskflow 2>/dev/null && ok "taskflow stopped" || warn "taskflow not running"
sudo systemctl stop taskflow-web 2>/dev/null && ok "taskflow-web stopped" || warn "taskflow-web not running"

# ── Extract backup ke temp dir ──
info "Step 2/6 — Extracting backup..."
TEMP_DIR=$(mktemp -d)
tar xzf "$BACKUP_FILE" -C "$TEMP_DIR"

# Find the extracted folder (could be nested)
EXTRACTED=$(find "$TEMP_DIR" -maxdepth 1 -type d -name "taskflow-backup-*" | head -1)
if [ -z "$EXTRACTED" ]; then
    # Maybe files are directly in temp dir
    EXTRACTED="$TEMP_DIR"
fi

# Check contents
if [ ! -f "$EXTRACTED/bot.py" ] && [ ! -f "$EXTRACTED/taskflow.db" ]; then
    err "Backup tidak valid — bot.py atau taskflow.db tidak ditemukan"
    rm -rf "$TEMP_DIR"
    exit 1
fi

ok "Extracted to temp dir"

# ── Pre-restore backup ──
info "Step 3/6 — Backing up current state..."
mkdir -p "$TARGET_DIR"
PRE_RESTORE="${TARGET_DIR}/.pre-restore-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$PRE_RESTORE"

# Backup existing files
for f in bot.py webapp.py repository.py models.py eisenhower.py datehelper.py config.py .env taskflow.db; do
    [ -f "$TARGET_DIR/$f" ] && cp "$TARGET_DIR/$f" "$PRE_RESTORE/"
done
[ -d "$TARGET_DIR/static" ] && cp -r "$TARGET_DIR/static" "$PRE_RESTORE/static"
[ -d "$TARGET_DIR/uploads" ] && cp -r "$TARGET_DIR/uploads" "$PRE_RESTORE/uploads"
ok "Current state saved to $PRE_RESTORE"

# ── Restore files ──
info "Step 4/6 — Restoring files..."

# Python files
for f in bot.py webapp.py repository.py models.py eisenhower.py datehelper.py config.py; do
    if [ -f "$EXTRACTED/$f" ]; then
        cp "$EXTRACTED/$f" "$TARGET_DIR/"
        ok "  $f"
    fi
done

# .env
if [ -f "$EXTRACTED/.env" ]; then
    cp "$EXTRACTED/.env" "$TARGET_DIR/"
    ok "  .env"
else
    warn "  .env not in backup (keeping current)"
fi

# .env.example
[ -f "$EXTRACTED/.env.example" ] && cp "$EXTRACTED/.env.example" "$TARGET_DIR/"

# Requirements
for f in requirements.txt requirements-web.txt; do
    [ -f "$EXTRACTED/$f" ] && cp "$EXTRACTED/$f" "$TARGET_DIR/"
done

# Service files
for f in taskflow.service taskflow-web.service; do
    [ -f "$EXTRACTED/$f" ] && cp "$EXTRACTED/$f" "$TARGET_DIR/"
done

# Scripts
for f in install.sh install-web.sh backup.sh restore.sh; do
    if [ -f "$EXTRACTED/$f" ]; then
        cp "$EXTRACTED/$f" "$TARGET_DIR/"
        chmod +x "$TARGET_DIR/$f"
    fi
done

# Nginx config
[ -f "$EXTRACTED/nginx-taskflow.conf" ] && cp "$EXTRACTED/nginx-taskflow.conf" "$TARGET_DIR/"

# README
[ -f "$EXTRACTED/README.md" ] && cp "$EXTRACTED/README.md" "$TARGET_DIR/"

# ── Restore database ──
info "Step 5/6 — Restoring database..."
if [ -f "$EXTRACTED/taskflow.db" ]; then
    cp "$EXTRACTED/taskflow.db" "$TARGET_DIR/"
    # WAL/SHM jika ada
    [ -f "$EXTRACTED/taskflow.db-wal" ] && cp "$EXTRACTED/taskflow.db-wal" "$TARGET_DIR/"
    [ -f "$EXTRACTED/taskflow.db-shm" ] && cp "$EXTRACTED/taskflow.db-shm" "$TARGET_DIR/"
    ok "Database restored"
    
    # Show DB stats
    if command -v sqlite3 &>/dev/null; then
        TASK_COUNT=$(sqlite3 "$TARGET_DIR/taskflow.db" "SELECT COUNT(*) FROM tasks;" 2>/dev/null || echo "?")
        USER_COUNT=$(sqlite3 "$TARGET_DIR/taskflow.db" "SELECT COUNT(*) FROM users;" 2>/dev/null || echo "?")
        echo -e "     Tasks: ${TASK_COUNT} | Users: ${USER_COUNT}"
    fi
else
    warn "Database not in backup"
fi

# ── Restore uploads ──
if [ -d "$EXTRACTED/uploads" ]; then
    mkdir -p "$TARGET_DIR/uploads"
    cp -r "$EXTRACTED/uploads/"* "$TARGET_DIR/uploads/" 2>/dev/null || true
    FILE_COUNT=$(find "$TARGET_DIR/uploads" -type f | wc -l)
    ok "Uploads restored (${FILE_COUNT} files)"
else
    mkdir -p "$TARGET_DIR/uploads"
    warn "Uploads not in backup"
fi

# ── Restore static ──
if [ -d "$EXTRACTED/static" ]; then
    mkdir -p "$TARGET_DIR/static"
    cp -r "$EXTRACTED/static/"* "$TARGET_DIR/static/"
    ok "Static files restored"
fi

# ── Cleanup temp ──
rm -rf "$TEMP_DIR"

# ── Restart services ──
info "Step 6/6 — Restarting services..."

# Check if venv exists
if [ ! -d "$TARGET_DIR/venv" ]; then
    warn "Virtual environment not found. Run install.sh first:"
    echo "    cd $TARGET_DIR && ./install.sh"
else
    sudo systemctl start taskflow 2>/dev/null && ok "taskflow started" || warn "taskflow failed to start"
    sudo systemctl start taskflow-web 2>/dev/null && ok "taskflow-web started" || warn "taskflow-web failed to start"
fi

# ── Summary ──
echo ""
echo -e "${GREEN}${BOLD}══════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  ✅ Restore selesai!                     ${NC}"
echo -e "${GREEN}${BOLD}══════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}Restored to:${NC}  $TARGET_DIR"
echo -e "  ${BOLD}Pre-restore:${NC}  $PRE_RESTORE"
echo -e "  ${BOLD}Waktu:${NC}        $(date '+%d-%m-%Y %H:%M:%S')"
echo ""
echo -e "  ${BOLD}Cek status:${NC}"
echo "    sudo systemctl status taskflow"
echo "    sudo systemctl status taskflow-web"
echo ""
echo -e "  ${BOLD}Rollback jika bermasalah:${NC}"
echo "    cp ${PRE_RESTORE}/* ${TARGET_DIR}/"
echo "    sudo systemctl restart taskflow taskflow-web"
echo ""
