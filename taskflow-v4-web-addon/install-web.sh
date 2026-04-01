#!/usr/bin/env bash
# ╔══════════════════════════════════════════════════════╗
# ║    TaskFlow V4 — Web App Installer                   ║
# ║    Jalankan di folder taskflow-v4 yang sudah ada      ║
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
INSTALL_DIR="$SCRIPT_DIR"
CURRENT_USER="$(whoami)"
SERVICE_NAME="taskflow-web"

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║    🌐 TaskFlow V4 Web App Installer      ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}"
echo ""

# ── Check prerequisites ──
info "Checking prerequisites..."

if [ ! -f "$INSTALL_DIR/bot.py" ]; then
    err "Jalankan script ini di dalam folder taskflow-v4!"
    err "File bot.py tidak ditemukan di: $INSTALL_DIR"
    exit 1
fi

if [ ! -d "$INSTALL_DIR/venv" ]; then
    err "Virtual environment belum ada. Jalankan install.sh (bot) dulu!"
    exit 1
fi

if [ ! -f "$INSTALL_DIR/.env" ]; then
    err "File .env belum ada. Jalankan install.sh (bot) dulu!"
    exit 1
fi

ok "Prerequisites check passed."

# ── Step 1: Install web dependencies ──
info "Step 1/4 — Installing web dependencies..."
"$INSTALL_DIR/venv/bin/pip" install -r "$INSTALL_DIR/requirements-web.txt" -q
ok "Web dependencies installed."

# ── Step 2: Add web config to .env ──
info "Step 2/4 — Configuring web app..."

if grep -q "WEB_PORT" "$INSTALL_DIR/.env" 2>/dev/null; then
    warn "Web config sudah ada di .env, skip."
else
    echo "" >> "$INSTALL_DIR/.env"
    echo "# ── Web App Configuration ──" >> "$INSTALL_DIR/.env"

    read -rp "Web port (default 8080): " WEB_PORT
    WEB_PORT="${WEB_PORT:-8080}"
    echo "WEB_PORT=$WEB_PORT" >> "$INSTALL_DIR/.env"

    # Generate secret key
    SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_hex(32))")
    echo "WEB_SECRET_KEY=$SECRET_KEY" >> "$INSTALL_DIR/.env"

    # JWT expire hours
    echo "JWT_EXPIRE_HOURS=72" >> "$INSTALL_DIR/.env"

    ok "Web config added to .env (port: $WEB_PORT)"
fi

# Read port from .env
WEB_PORT=$(grep "^WEB_PORT=" "$INSTALL_DIR/.env" | cut -d'=' -f2)
WEB_PORT="${WEB_PORT:-8080}"

# ── Step 3: Test web app ──
info "Step 3/4 — Testing web app..."
"$INSTALL_DIR/venv/bin/python" -c "
import sys
sys.path.insert(0, '$INSTALL_DIR')
from webapp import app, migrate_db
migrate_db()
print('Web app modules OK')
print('Database migrated OK')
" && ok "Web app test passed." || { err "Web app test failed!"; exit 1; }

# ── Step 4: Setup systemd service ──
info "Step 4/4 — Setting up systemd service..."

SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

sed -e "s|__USER__|$CURRENT_USER|g" \
    -e "s|__INSTALL_DIR__|$INSTALL_DIR|g" \
    "$INSTALL_DIR/taskflow-web.service" | sudo tee "$SERVICE_FILE" > /dev/null

sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE_NAME"
ok "Systemd service installed & enabled."

# ── Nginx setup (optional) ──
echo ""
read -rp "Setup Nginx reverse proxy? (y/N): " SETUP_NGINX
if [ "$SETUP_NGINX" = "y" ] || [ "$SETUP_NGINX" = "Y" ]; then
    if ! command -v nginx &>/dev/null; then
        warn "Nginx belum terinstall. Install dulu: sudo apt install nginx"
    else
        read -rp "Subdomain (contoh: todo.yatno.web.id): " SUBDOMAIN
        if [ -n "$SUBDOMAIN" ]; then
            sed -e "s|__SUBDOMAIN__|$SUBDOMAIN|g" \
                -e "s|__PORT__|$WEB_PORT|g" \
                "$INSTALL_DIR/nginx-taskflow.conf" | sudo tee "/etc/nginx/sites-available/taskflow" > /dev/null

            sudo ln -sf /etc/nginx/sites-available/taskflow /etc/nginx/sites-enabled/taskflow

            if sudo nginx -t 2>/dev/null; then
                sudo systemctl reload nginx
                ok "Nginx configured for $SUBDOMAIN → localhost:$WEB_PORT"
                echo ""
                echo -e "  ${YELLOW}Untuk HTTPS, jalankan:${NC}"
                echo "    sudo apt install certbot python3-certbot-nginx"
                echo "    sudo certbot --nginx -d $SUBDOMAIN"
            else
                err "Nginx config test failed. Cek manual: sudo nginx -t"
            fi
        fi
    fi
fi

# ── Done ──
echo ""
echo -e "${GREEN}${BOLD}══════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  ✅ TaskFlow V4 Web App installed!       ${NC}"
echo -e "${GREEN}${BOLD}══════════════════════════════════════════${NC}"
echo ""
echo -e "  ${BOLD}Start web app:${NC}"
echo "    sudo systemctl start $SERVICE_NAME"
echo ""
echo -e "  ${BOLD}Check status:${NC}"
echo "    sudo systemctl status $SERVICE_NAME"
echo ""
echo -e "  ${BOLD}View logs:${NC}"
echo "    sudo journalctl -u $SERVICE_NAME -f"
echo ""
echo -e "  ${BOLD}Access:${NC}"
echo "    http://localhost:$WEB_PORT"
if [ -n "${SUBDOMAIN:-}" ]; then
    echo "    http://$SUBDOMAIN"
fi
echo ""
echo -e "  ${BOLD}Langkah selanjutnya:${NC}"
echo "    1. sudo systemctl start $SERVICE_NAME"
echo "    2. Buka browser → register akun pertama"
echo "    3. Mulai tambah task dari web! 🚀"
echo ""
