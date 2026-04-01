#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════╗
# ║      TaskFlow V4 — Installer                        ║
# ║      Tested on Ubuntu 20.04 / 22.04 / 24.04        ║
# ╚══════════════════════════════════════════════════════╝

set -euo pipefail

# ── Colors ─────────────────────────────────────────────
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
echo -e "${BOLD}║       🚀 TaskFlow V4 Installer           ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}"
echo ""

# ── Detect install directory (where this script lives) ──
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_DIR="$SCRIPT_DIR"
CURRENT_USER="$(whoami)"
SERVICE_NAME="taskflow"

info "Install directory : $INSTALL_DIR"
info "Running as user   : $CURRENT_USER"
echo ""

# ── Step 1: Check Python ──────────────────────────────
info "Step 1/6 — Checking Python..."

PYTHON_CMD=""
for cmd in python3.12 python3.11 python3.10 python3; do
    if command -v "$cmd" &>/dev/null; then
        PYTHON_CMD="$cmd"
        break
    fi
done

if [ -z "$PYTHON_CMD" ]; then
    err "Python 3.10+ tidak ditemukan!"
    err "Install dulu: sudo apt install python3 python3-venv python3-pip"
    exit 1
fi

PYTHON_VER=$($PYTHON_CMD --version 2>&1 | awk '{print $2}')
ok "Python found: $PYTHON_CMD ($PYTHON_VER)"

# Check python3-venv
if ! $PYTHON_CMD -m venv --help &>/dev/null; then
    warn "python3-venv belum terinstall. Mencoba install..."
    sudo apt update && sudo apt install -y python3-venv
fi

# ── Step 2: Create virtual environment ────────────────
info "Step 2/6 — Creating virtual environment..."

if [ -d "$INSTALL_DIR/venv" ]; then
    warn "venv sudah ada, skip."
else
    $PYTHON_CMD -m venv "$INSTALL_DIR/venv"
    ok "Virtual environment created."
fi

# ── Step 3: Install dependencies ──────────────────────
info "Step 3/6 — Installing dependencies..."

"$INSTALL_DIR/venv/bin/pip" install --upgrade pip -q
"$INSTALL_DIR/venv/bin/pip" install -r "$INSTALL_DIR/requirements.txt" -q

ok "Dependencies installed."

# ── Step 4: Setup .env ────────────────────────────────
info "Step 4/6 — Configuring .env..."

if [ -f "$INSTALL_DIR/.env" ]; then
    warn ".env sudah ada, skip. Edit manual jika perlu."
else
    cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"

    echo ""
    echo -e "${BOLD}── Konfigurasi Bot ──${NC}"
    echo ""

    read -rp "Masukkan TELEGRAM_BOT_TOKEN: " BOT_TOKEN
    if [ -z "$BOT_TOKEN" ]; then
        err "Token tidak boleh kosong!"
        exit 1
    fi
    sed -i "s|your_bot_token_here|$BOT_TOKEN|" "$INSTALL_DIR/.env"

    read -rp "Masukkan Telegram User ID kamu (atau Enter untuk skip): " USER_ID
    if [ -n "$USER_ID" ]; then
        sed -i "s|ALLOWED_USER_IDS=123456789|ALLOWED_USER_IDS=$USER_ID|" "$INSTALL_DIR/.env"
    else
        sed -i "s|ALLOWED_USER_IDS=123456789|ALLOWED_USER_IDS=|" "$INSTALL_DIR/.env"
    fi

    ok ".env configured."
fi

# ── Step 5: Test bot startup ─────────────────────────
info "Step 5/6 — Testing import..."

"$INSTALL_DIR/venv/bin/python" -c "
import sys
sys.path.insert(0, '$INSTALL_DIR')
from models import Task, GTDStatus, Priority, Quadrant
from repository import TaskRepository
from eisenhower import calculate_quadrant
print('All modules OK')
" && ok "Module test passed." || { err "Module test failed!"; exit 1; }

# ── Step 6: Install systemd service ──────────────────
info "Step 6/6 — Setting up systemd service..."

SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

if [ -f "$SERVICE_FILE" ]; then
    warn "Service file sudah ada."
    read -rp "Overwrite? (y/N): " OVERWRITE
    if [ "$OVERWRITE" != "y" ] && [ "$OVERWRITE" != "Y" ]; then
        warn "Skip systemd setup."
        echo ""
        echo -e "${GREEN}${BOLD}══════════════════════════════════════════${NC}"
        echo -e "${GREEN}${BOLD}  ✅ TaskFlow V4 installed successfully!  ${NC}"
        echo -e "${GREEN}${BOLD}══════════════════════════════════════════${NC}"
        echo ""
        echo "  Jalankan manual:  $INSTALL_DIR/venv/bin/python $INSTALL_DIR/bot.py"
        echo "  Atau restart:     sudo systemctl restart $SERVICE_NAME"
        echo ""
        exit 0
    fi
fi

# Generate service file from template
sed -e "s|__USER__|$CURRENT_USER|g" \
    -e "s|__INSTALL_DIR__|$INSTALL_DIR|g" \
    "$INSTALL_DIR/taskflow.service" | sudo tee "$SERVICE_FILE" > /dev/null

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"

ok "Systemd service installed & enabled."

# ── Done ──────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}══════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  ✅ TaskFlow V4 installed successfully!  ${NC}"
echo -e "${GREEN}${BOLD}══════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}Start bot:${NC}"
echo "    sudo systemctl start $SERVICE_NAME"
echo ""
echo -e "  ${BOLD}Check status:${NC}"
echo "    sudo systemctl status $SERVICE_NAME"
echo ""
echo -e "  ${BOLD}View logs:${NC}"
echo "    sudo journalctl -u $SERVICE_NAME -f"
echo ""
echo -e "  ${BOLD}Stop bot:${NC}"
echo "    sudo systemctl stop $SERVICE_NAME"
echo ""
echo -e "  ${BOLD}Config:${NC}"
echo "    $INSTALL_DIR/.env"
echo ""
echo -e "  ${BOLD}Database:${NC}"
echo "    $INSTALL_DIR/taskflow.db"
echo ""
echo -e "  Buka Telegram, cari bot kamu, dan ketik ${BOLD}/start${NC} 🚀"
echo ""
