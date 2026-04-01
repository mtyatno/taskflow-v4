#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════╗
# ║    TaskFlow V4 — Backup Script                       ║
# ║    Jalankan dari folder taskflow-v4                   ║
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

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_BASE="${HOME}/backups"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
BACKUP_NAME="taskflow-backup-${TIMESTAMP}"
BACKUP_DIR="${BACKUP_BASE}/${BACKUP_NAME}"

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║    📦 TaskFlow V4 — Backup               ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}"
echo ""

# ── Validasi ──
if [ ! -f "${SCRIPT_DIR}/bot.py" ]; then
    err "Jalankan script ini dari folder taskflow-v4!"
    exit 1
fi

info "Source: ${SCRIPT_DIR}"
info "Backup: ${BACKUP_DIR}"
echo ""

# ── Buat folder backup ──
mkdir -p "${BACKUP_DIR}"

# ── 1. Database ──
info "Step 1/5 — Backup database..."
if [ -f "${SCRIPT_DIR}/taskflow.db" ]; then
    # Gunakan sqlite3 backup jika tersedia (safe copy saat DB sedang diakses)
    if command -v sqlite3 &>/dev/null; then
        sqlite3 "${SCRIPT_DIR}/taskflow.db" ".backup '${BACKUP_DIR}/taskflow.db'"
        ok "Database (sqlite3 safe backup)"
    else
        cp "${SCRIPT_DIR}/taskflow.db" "${BACKUP_DIR}/"
        ok "Database (file copy)"
    fi
    # Juga backup WAL/SHM jika ada
    [ -f "${SCRIPT_DIR}/taskflow.db-wal" ] && cp "${SCRIPT_DIR}/taskflow.db-wal" "${BACKUP_DIR}/"
    [ -f "${SCRIPT_DIR}/taskflow.db-shm" ] && cp "${SCRIPT_DIR}/taskflow.db-shm" "${BACKUP_DIR}/"
else
    warn "Database tidak ditemukan, skip."
fi

# ── 2. Uploads (lampiran) ──
info "Step 2/5 — Backup uploads..."
if [ -d "${SCRIPT_DIR}/uploads" ]; then
    cp -r "${SCRIPT_DIR}/uploads" "${BACKUP_DIR}/uploads"
    FILE_COUNT=$(find "${BACKUP_DIR}/uploads" -type f | wc -l)
    ok "Uploads (${FILE_COUNT} files)"
else
    mkdir -p "${BACKUP_DIR}/uploads"
    warn "Folder uploads tidak ditemukan, buat kosong."
fi

# ── 3. Source code ──
info "Step 3/5 — Backup source code..."
for f in bot.py webapp.py repository.py models.py eisenhower.py datehelper.py config.py; do
    if [ -f "${SCRIPT_DIR}/${f}" ]; then
        cp "${SCRIPT_DIR}/${f}" "${BACKUP_DIR}/"
    fi
done
ok "Python files"

# ── 4. Config & static ──
info "Step 4/5 — Backup config & static..."
# .env
if [ -f "${SCRIPT_DIR}/.env" ]; then
    cp "${SCRIPT_DIR}/.env" "${BACKUP_DIR}/"
    ok ".env"
else
    warn ".env tidak ditemukan"
fi
# .env.example
[ -f "${SCRIPT_DIR}/.env.example" ] && cp "${SCRIPT_DIR}/.env.example" "${BACKUP_DIR}/"
# requirements
for f in requirements.txt requirements-web.txt; do
    [ -f "${SCRIPT_DIR}/${f}" ] && cp "${SCRIPT_DIR}/${f}" "${BACKUP_DIR}/"
done
# service files
for f in taskflow.service taskflow-web.service; do
    [ -f "${SCRIPT_DIR}/${f}" ] && cp "${SCRIPT_DIR}/${f}" "${BACKUP_DIR}/"
done
# scripts
for f in install.sh install-web.sh backup.sh restore.sh; do
    [ -f "${SCRIPT_DIR}/${f}" ] && cp "${SCRIPT_DIR}/${f}" "${BACKUP_DIR}/"
done
# nginx config
[ -f "${SCRIPT_DIR}/nginx-taskflow.conf" ] && cp "${SCRIPT_DIR}/nginx-taskflow.conf" "${BACKUP_DIR}/"
# static folder
if [ -d "${SCRIPT_DIR}/static" ]; then
    cp -r "${SCRIPT_DIR}/static" "${BACKUP_DIR}/static"
    ok "Static files"
fi
# README
[ -f "${SCRIPT_DIR}/README.md" ] && cp "${SCRIPT_DIR}/README.md" "${BACKUP_DIR}/"

# ── 5. Compress ──
info "Step 5/5 — Compressing..."
cd "${BACKUP_BASE}"
tar czf "${BACKUP_NAME}.tar.gz" "${BACKUP_NAME}/"

# Hitung ukuran
BACKUP_SIZE=$(du -sh "${BACKUP_NAME}.tar.gz" | cut -f1)
DB_SIZE=$(du -sh "${BACKUP_DIR}/taskflow.db" 2>/dev/null | cut -f1 || echo "0")
UPLOAD_SIZE=$(du -sh "${BACKUP_DIR}/uploads" 2>/dev/null | cut -f1 || echo "0")

# Cleanup folder (keep only tar.gz)
rm -rf "${BACKUP_DIR}"

ok "Compressed"

# ── Summary ──
echo ""
echo -e "${GREEN}${BOLD}══════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  ✅ Backup selesai!                      ${NC}"
echo -e "${GREEN}${BOLD}══════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}File:${NC}     ${BACKUP_BASE}/${BACKUP_NAME}.tar.gz"
echo -e "  ${BOLD}Ukuran:${NC}   ${BACKUP_SIZE}"
echo -e "  ${BOLD}Database:${NC} ${DB_SIZE}"
echo -e "  ${BOLD}Uploads:${NC}  ${UPLOAD_SIZE}"
echo -e "  ${BOLD}Waktu:${NC}    $(date '+%d-%m-%Y %H:%M:%S')"
echo ""
echo -e "  ${BOLD}Download ke local:${NC}"
echo "    rsync -avz -e ssh $(whoami)@$(hostname -I | awk '{print $1}'):${BACKUP_BASE}/${BACKUP_NAME}.tar.gz ./"
echo ""

# ── Cleanup old backups (keep last 7) ──
BACKUP_COUNT=$(ls -1 "${BACKUP_BASE}"/taskflow-backup-*.tar.gz 2>/dev/null | wc -l)
if [ "$BACKUP_COUNT" -gt 7 ]; then
    REMOVE_COUNT=$((BACKUP_COUNT - 7))
    ls -1t "${BACKUP_BASE}"/taskflow-backup-*.tar.gz | tail -n "$REMOVE_COUNT" | while read f; do
        rm -f "$f"
        warn "Old backup removed: $(basename $f)"
    done
fi
