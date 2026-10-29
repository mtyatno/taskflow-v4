"""
Alurik - Configuration
"""
import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env file
ENV_PATH = Path(__file__).parent / ".env"
load_dotenv(ENV_PATH)

# Telegram Bot
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_BOT_USERNAME = os.getenv("TELEGRAM_BOT_USERNAME", "")
ALLOWED_USER_IDS = [
    int(uid.strip())
    for uid in os.getenv("ALLOWED_USER_IDS", "").split(",")
    if uid.strip().isdigit()
]

# Database
DB_PATH = os.getenv("DB_PATH", str(Path(__file__).parent / "taskflow.db"))

# Eisenhower auto-recalculation interval (minutes)
EISENHOWER_INTERVAL_MINUTES = int(os.getenv("EISENHOWER_INTERVAL_MINUTES", "15"))

# Timezone
TIMEZONE = os.getenv("TIMEZONE", "Asia/Jakarta")

# Scheduled notifications
DAILY_SUMMARY_HOUR = int(os.getenv("DAILY_SUMMARY_HOUR", "7"))      # Jam kirim summary harian (default 07:00)
DAILY_SUMMARY_MINUTE = int(os.getenv("DAILY_SUMMARY_MINUTE", "0"))
WEEKLY_REVIEW_DAY = int(os.getenv("WEEKLY_REVIEW_DAY", "4"))        # 0=Senin ... 4=Jumat, 6=Minggu
WEEKLY_REVIEW_HOUR = int(os.getenv("WEEKLY_REVIEW_HOUR", "17"))     # Jam kirim review mingguan (default 17:00)
WEEKLY_REVIEW_MINUTE = int(os.getenv("WEEKLY_REVIEW_MINUTE", "0"))

# File attachments
UPLOAD_DIR = os.getenv("UPLOAD_DIR", str(Path(__file__).parent / "uploads"))
MAX_FILE_SIZE = int(os.getenv("MAX_FILE_SIZE_MB", "10")) * 1024 * 1024  # Default 10MB

# Media audio/video pada note
MEDIA_STORAGE = os.getenv("MEDIA_STORAGE", "local")
MEDIA_ROOT = os.getenv("MEDIA_ROOT", "/var/lib/alurik/media")
MEDIA_MAX_FILE_MB = int(os.getenv("MEDIA_MAX_FILE_MB", "2048"))
MEDIA_CHUNK_MB = int(os.getenv("MEDIA_CHUNK_MB", "5"))
MEDIA_URL_SECRET = os.getenv("MEDIA_URL_SECRET", "")  # kosong -> diturunkan dari WEB_SECRET_KEY
MEDIA_ACCEL = os.getenv("MEDIA_ACCEL", "1").strip().lower() in ("1", "true", "yes", "on")
MEDIA_URL_TTL_SEC = int(os.getenv("MEDIA_URL_TTL_SEC", "21600"))
MEDIA_STUCK_HOURS = int(os.getenv("MEDIA_STUCK_HOURS", "24"))

# Webapp URL (untuk magic login link)
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://alurik.com")

# Nextcloud (WebDAV)
NEXTCLOUD_URL = os.getenv("NEXTCLOUD_URL", "")
NEXTCLOUD_USER = os.getenv("NEXTCLOUD_USER", "")
NEXTCLOUD_APP_PASSWORD = os.getenv("NEXTCLOUD_APP_PASSWORD", "")
NEXTCLOUD_FOLDER = os.getenv("NEXTCLOUD_FOLDER", "/TaskFlow/attachments")

# AI Features (Weekly Review, etc.) — default OFF (kill-switch)
AI_FEATURES_ENABLED = os.getenv("AI_FEATURES_ENABLED", "false").strip().lower() in ("1", "true", "yes")
# AI Provider: "openrouter" (default), "deepseek", atau comma-separated untuk
# auto-fallback: "openrouter,deepseek" = coba openrouter dulu, gagal → deepseek.
AI_PROVIDER = os.getenv("AI_PROVIDER", "openrouter").strip().lower()
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY", "")

# SMTP untuk email transaksional (reset password).
# SMTP_HOST kosong = dev mode: email tidak dikirim, isinya dicetak ke log server.
SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT") or 587)
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
SMTP_FROM = os.getenv("SMTP_FROM", "Alurik <noreply@localhost>")
# starttls | ssl | none. Kosong = ditebak dari port (465 -> ssl, lainnya starttls).
SMTP_SECURITY = os.getenv("SMTP_SECURITY", "")
SMTP_REPLY_TO = os.getenv("SMTP_REPLY_TO", "")
SMTP_TIMEOUT = int(os.getenv("SMTP_TIMEOUT") or 15)
