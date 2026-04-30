"""
TaskFlow V4 - Configuration
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

# Webapp URL (untuk magic login link)
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://todo.yatno.web.id")

# Nextcloud (WebDAV)
NEXTCLOUD_URL = os.getenv("NEXTCLOUD_URL", "")
NEXTCLOUD_USER = os.getenv("NEXTCLOUD_USER", "")
NEXTCLOUD_APP_PASSWORD = os.getenv("NEXTCLOUD_APP_PASSWORD", "")
NEXTCLOUD_FOLDER = os.getenv("NEXTCLOUD_FOLDER", "/TaskFlow/attachments")
