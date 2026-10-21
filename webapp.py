"""
Alurik — Web Application (FastAPI)

Multi-user web interface with JWT auth, REST API, and React SPA frontend.
Runs alongside the Telegram bot, sharing the same SQLite database.
"""
from __future__ import annotations

import os
import hashlib
import secrets
import hmac
import sqlite3
import uuid
import mimetypes
import asyncio
import logging
import json
import math
import re
import html
import urllib.parse
from collections import defaultdict
from datetime import datetime, date, timedelta, timezone
from pathlib import Path
from typing import Optional, Literal, Any, Dict
from contextlib import contextmanager

from collections import deque
import time as _time

# Brute-force protection for published note unlock
_ip_attempts: dict[str, deque] = defaultdict(lambda: deque(maxlen=50))
_slug_fails: dict[str, dict] = {}       # slug -> {"count": int, "locked_until": float|0}
_progressive: dict[str, dict] = {}      # "ip:slug" -> {"failures": int, "last_attempt": float}

def _cleanup_bruteforce():
    """Remove expired entries from trackers."""
    now = _time.time()
    for ip in list(_ip_attempts):
        while _ip_attempts[ip] and _ip_attempts[ip][0] < now - 900:  # 15 min expiry
            _ip_attempts[ip].popleft()
        if not _ip_attempts[ip]:
            del _ip_attempts[ip]
    for slug in list(_slug_fails):
        sf = _slug_fails[slug]
        if sf.get("locked_until", 0) > 0 and sf["locked_until"] < now:
            del _slug_fails[slug]  # Lock expired — clean up
        elif not sf.get("locked_until") and sf.get("count", 0) == 0:
            del _slug_fails[slug]  # Empty tracker — clean up
    for key in list(_progressive):
        if _progressive[key]["last_attempt"] < now - 1800:  # 30 min expiry
            del _progressive[key]

def _check_bruteforce(ip: str, slug: str):
    """Check rate limits. Raise HTTPException if blocked."""
    _cleanup_bruteforce()  # Lazy cleanup every check
    now = _time.time()

    # 1. Progressive delay
    prog_key = f"{ip}:{slug}"
    if prog_key in _progressive:
        p = _progressive[prog_key]
        delay = min(2 ** (p["failures"] - 1), 8)  # 0,1,2,4,8 seconds
        elapsed = now - p["last_attempt"]
        if elapsed < delay:
            import time as _t
            _t.sleep(delay - elapsed)
            now = _time.time()  # refresh after sleep

    # 2. IP-based rate limit
    if len(_ip_attempts[ip]) >= 5:
        raise HTTPException(
            status_code=429,
            detail="Terlalu banyak percobaan, coba lagi nanti",
            headers={"Retry-After": str(max(1, int(900 - (now - _ip_attempts[ip][0]))))}
        )

    # 3. Slug-based lock
    if slug in _slug_fails:
        sf = _slug_fails[slug]
        if sf.get("locked_until", 0) > now:
            remaining = int(sf["locked_until"] - now)
            raise HTTPException(
                status_code=429,
                detail=f"Halaman ini terkunci sementara, coba lagi dalam {remaining // 60 + 1} menit",
                headers={"Retry-After": str(remaining)}
            )

def _record_failed_attempt(ip: str, slug: str):
    """Record a failed unlock attempt."""
    now = _time.time()
    _ip_attempts[ip].append(now)

    sf = _slug_fails.setdefault(slug, {"count": 0, "locked_until": 0})
    sf["count"] += 1
    if sf["count"] >= 10:
        sf["locked_until"] = now + 1800  # 30 min lock
        sf["count"] = 0

    prog_key = f"{ip}:{slug}"
    p = _progressive.setdefault(prog_key, {"failures": 0, "last_attempt": 0})
    p["failures"] += 1
    p["last_attempt"] = now

def _reset_bruteforce(ip: str, slug: str):
    """Reset trackers on successful unlock."""
    if ip in _ip_attempts:
        _ip_attempts[ip].clear()
    if slug in _slug_fails:
        del _slug_fails[slug]
    prog_key = f"{ip}:{slug}"
    if prog_key in _progressive:
        del _progressive[prog_key]

import pytz as _pytz
_TZ_JKT = _pytz.timezone("Asia/Jakarta")

def _today_jkt() -> date:
    """Return today's date in Jakarta timezone (UTC+7)."""
    return datetime.now(_TZ_JKT).date()

from fastapi import FastAPI, HTTPException, Depends, Response, Request, status, UploadFile, File as FastAPIFile, BackgroundTasks, Query, Body, Form
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse, StreamingResponse, RedirectResponse, JSONResponse
import io
import zipfile
import csv
from sse_starlette.sse import EventSourceResponse
from pydantic import BaseModel, Field, field_validator, model_validator
import jwt
import uvicorn

from config import DB_PATH, EISENHOWER_INTERVAL_MINUTES, UPLOAD_DIR, MAX_FILE_SIZE, TELEGRAM_BOT_USERNAME, NEXTCLOUD_URL, NEXTCLOUD_USER, NEXTCLOUD_APP_PASSWORD, NEXTCLOUD_FOLDER, WEBAPP_URL
from config import MEDIA_ROOT, MEDIA_MAX_FILE_MB, MEDIA_CHUNK_MB, MEDIA_ACCEL, MEDIA_URL_TTL_SEC, MEDIA_STUCK_HOURS
from config import MEDIA_URL_SECRET as _MEDIA_URL_SECRET_CFG
import config as appconfig

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
_tg_bot = None  # Initialized at startup if token available
from models import Task, GTDStatus, Priority, Quadrant
from eisenhower import calculate_quadrant, recalculate_all
from datehelper import parse_date
from repository import TaskRepository
import repository
import drawing_scope
import note_comments
import safehtml
import bookmark
import ai_review
import review_history
import mailer
import email_outbox
import email_templates

# ── Config ─────────────────────────────────────────────────────────────────────
SECRET_KEY = os.getenv("WEB_SECRET_KEY", secrets.token_hex(32))

logger = logging.getLogger("alurik.webapp")
MEDIA_MAX_FILE_BYTES = MEDIA_MAX_FILE_MB * 1024 * 1024
MEDIA_CHUNK_BYTES = MEDIA_CHUNK_MB * 1024 * 1024
MEDIA_URL_SECRET_BYTES = (
    _MEDIA_URL_SECRET_CFG.encode() if _MEDIA_URL_SECRET_CFG
    else hmac.new(SECRET_KEY.encode(), b"alurik-media-url", "sha256").digest()
)
JWT_ALGORITHM = "HS256"

import shutil
import errno
from starlette.concurrency import run_in_threadpool
from media_probe import sniff_media, final_mime, ALLOWED_INIT_EXTS, MEDIA_DIRECTIVE_RE, format_duration
from media_storage import get_storage, new_key
import media_serve
from media_worker import MediaWorker
from config import MEDIA_STORAGE


def _media_utcnow() -> datetime:
    """Waktu UTC naif (format lama `datetime.utcnow()`), tanpa API yang deprecated."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _media_db_connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


media_storage = get_storage(MEDIA_STORAGE, MEDIA_ROOT)
media_worker = MediaWorker(connect=_media_db_connect, storage=media_storage,
                           ffmpeg=shutil.which("ffmpeg"), ffprobe=shutil.which("ffprobe"))
# Worker email (outbox SQLite). Baru jalan di startup(); wake() sebelum start() tidak berbuat apa-apa.
email_worker = email_outbox.EmailWorker(connect=_media_db_connect)

# ── Cookie signing (for published note unlock) ─────────────────────────────────
def _sign_cookie(slug: str) -> str:
    """Sign a slug with HMAC-SHA256 for tamper-proof cookie."""
    h = hmac.new(SECRET_KEY.encode(), slug.encode(), "sha256").hexdigest()[:24]
    return f"{slug}:{h}"

def _verify_cookie(signed: str) -> str | None:
    """Verify HMAC cookie, return slug if valid, None if tampered."""
    try:
        slug, h = signed.rsplit(":", 1)
    except ValueError:
        return None
    expected = hmac.new(SECRET_KEY.encode(), slug.encode(), "sha256").hexdigest()[:24]
    return slug if hmac.compare_digest(h, expected) else None
JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "72"))
# Batas absolut sesi sejak login password; /api/auth/refresh menolak memperpanjang lewat dari ini
SESSION_MAX_DAYS = int(os.getenv("SESSION_MAX_DAYS", "30"))
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
USERNAME_RE = re.compile(r"[A-Za-z0-9_]{3,50}")  # dipakai dengan fullmatch
WEB_PORT = int(os.getenv("WEB_PORT", "8080"))

STATIC_DIR = Path(__file__).parent / "static"

# ── Nextcloud WebDAV helpers ────────────────────────────────────────────────
def _nc_dav_url(path: str) -> str:
    return f"{NEXTCLOUD_URL.rstrip('/')}/remote.php/dav/files/{NEXTCLOUD_USER}{path}"

def _nc_auth() -> tuple:
    return (NEXTCLOUD_USER, NEXTCLOUD_APP_PASSWORD)

def _nc_ensure_folder() -> None:
    import requests as _req
    # Create each path segment in order so parent exists before child
    # e.g. /TaskFlow/attachments → first /TaskFlow, then /TaskFlow/attachments
    segments = NEXTCLOUD_FOLDER.strip("/").split("/")
    path = ""
    for seg in segments:
        path += "/" + seg
        r = _req.request("MKCOL", _nc_dav_url(path), auth=_nc_auth(), timeout=10)
        if r.status_code not in (201, 405):  # 201=created, 405=already exists
            raise HTTPException(status_code=500, detail=f"Nextcloud folder error: {r.status_code} on {path}")

# ── Chat SSE broadcast bus ─────────────────────────────────────────────────────
chat_subscribers: dict[int, set[asyncio.Queue]] = defaultdict(set)
# DM: conversation_id → {(user_id, queue)} — user_id disimpan agar bisa tahu
# apakah penerima sedang membuka percakapan (untuk menahan notifikasi).
dm_subscribers: dict[int, set[tuple[int, asyncio.Queue]]] = defaultdict(set)
# Mindmap bersama: mindmap_id → {(user_id, queue)}. Hanya sinyal (tanpa isi peta);
# akses tiap pelanggan dicek ulang saat broadcast (lihat _mindmap_broadcast).
mindmap_subscribers: dict[int, set[tuple[int, asyncio.Queue]]] = defaultdict(set)
# Komentar note: note_id → {(user_id, queue)}. Hanya sinyal (tanpa isi komentar); akses dicek ulang saat broadcast.
note_comment_subscribers: dict[int, set[tuple[int, asyncio.Queue]]] = defaultdict(set)

# ── Database helpers ───────────────────────────────────────────────────────────

@contextmanager
def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def _upsert_tags_for_note(conn, note_id: int, user_id: int, tag_names: list):
    """Upsert tags and entity_tags relations for one note. Tags are normalized lowercase+trim."""
    from datetime import datetime as _dt
    now = _dt.utcnow().isoformat()
    for raw in tag_names:
        name = raw.strip().lower()
        if not name:
            continue
        conn.execute(
            "INSERT OR IGNORE INTO tags (user_id, name, created_at) VALUES (?, ?, ?)",
            (user_id, name, now)
        )
        tag_row = conn.execute(
            "SELECT id FROM tags WHERE user_id = ? AND name = ?", (user_id, name)
        ).fetchone()
        if tag_row:
            conn.execute(
                "INSERT OR IGNORE INTO entity_tags (tag_id, user_id, entity_type, entity_id, created_at) VALUES (?, ?, 'note', ?, ?)",
                (tag_row["id"], user_id, note_id, now)
            )


def _upsert_tags_for_entity(conn, entity_id: int, user_id: int, entity_type: str, tag_names: list):
    """Upsert tags and entity_tags for any entity type. Tags normalized lowercase+trim."""
    from datetime import datetime as _dt
    now = _dt.utcnow().isoformat()
    for raw in tag_names:
        name = raw.strip().lower()
        if not name:
            continue
        conn.execute(
            "INSERT OR IGNORE INTO tags (user_id, name, created_at) VALUES (?, ?, ?)",
            (user_id, name, now)
        )
        tag_row = conn.execute(
            "SELECT id FROM tags WHERE user_id = ? AND name = ?", (user_id, name)
        ).fetchone()
        if tag_row:
            conn.execute(
                "INSERT OR IGNORE INTO entity_tags (tag_id, user_id, entity_type, entity_id, created_at) VALUES (?, ?, ?, ?, ?)",
                (tag_row["id"], user_id, entity_type, entity_id, now)
            )


def migrate_db():
    """Ensure all tables exist via repository init."""
    from repository import TaskRepository
    TaskRepository(DB_PATH).heal_orphan_workspace_items()

    # Ensure telegram_link_tokens table exists
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS telegram_link_tokens (
                token     TEXT PRIMARY KEY,
                user_id   INTEGER NOT NULL,
                expires_at TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS password_reset_tokens (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER NOT NULL,
                token_hash  TEXT NOT NULL,
                created_at  TEXT NOT NULL,
                expires_at  TEXT NOT NULL,
                used_at     TEXT DEFAULT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_prt_token_hash ON password_reset_tokens(token_hash)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_prt_user ON password_reset_tokens(user_id)")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS app_meta (
                key   TEXT PRIMARY KEY,
                value TEXT
            )
        """)
        # Widen habit_templates.frequency CHECK to allow 'weekly'. Older DBs
        # were created with CHECK(frequency IN ('daily','monthly')); the curated
        # template set uses 'weekly', so reseed would violate the constraint and
        # crash startup. SQLite can't ALTER a CHECK, so rebuild the table.
        ht = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='habit_templates'"
        ).fetchone()
        if ht and "'weekly'" not in (ht["sql"] or ""):
            conn.execute("PRAGMA legacy_alter_table=ON")  # jangan tulis ulang trigger tabel lain ke habit_templates_old
            conn.execute("ALTER TABLE habit_templates RENAME TO habit_templates_old")
            conn.execute("""
                CREATE TABLE habit_templates (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    kategori TEXT NOT NULL,
                    subkategori TEXT NOT NULL,
                    type TEXT NOT NULL CHECK(type IN ('habit','task')),
                    item TEXT NOT NULL,
                    frequency TEXT NOT NULL CHECK(frequency IN ('daily','weekly','monthly')),
                    priority TEXT NOT NULL CHECK(priority IN ('low','medium','high')),
                    difficulty TEXT NOT NULL CHECK(difficulty IN ('easy','medium','hard')),
                    tags TEXT NOT NULL DEFAULT '[]'
                )
            """)
            conn.execute("INSERT INTO habit_templates SELECT * FROM habit_templates_old")
            conn.execute("DROP TABLE habit_templates_old")
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_habit_templates_kat ON habit_templates(kategori, subkategori)"
            )
        conn.commit()
    finally:
        conn.close()

    # Migrate scratchpad_notes.pinned column
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(scratchpad_notes)").fetchall()]
        if "pinned" not in cols:
            conn.execute("ALTER TABLE scratchpad_notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0")
            conn.commit()
    finally:
        conn.close()

    # Migrate note_attachments: kolom media audio/video (spec §4.1)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        att_cols = {r["name"] for r in conn.execute("PRAGMA table_info(note_attachments)").fetchall()}
        for name, ddl in [
            ("kind", "TEXT NOT NULL DEFAULT 'file'"),
            ("client_id", "TEXT"),
            ("storage", "TEXT NOT NULL DEFAULT 'nextcloud'"),
            ("storage_key", "TEXT"),
            ("status", "TEXT NOT NULL DEFAULT 'ready'"),
            ("media_type", "TEXT"),
            ("duration_ms", "INTEGER"),
            ("video_codec", "TEXT"),
            ("audio_codec", "TEXT"),
            ("width", "INTEGER"),
            ("height", "INTEGER"),
            ("poster_key", "TEXT"),
            ("received_bytes", "INTEGER NOT NULL DEFAULT 0"),
            ("error", "TEXT"),
            ("updated_at", "TEXT"),
        ]:
            if name not in att_cols:
                conn.execute(f"ALTER TABLE note_attachments ADD COLUMN {name} {ddl}")
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_note_attachments_client "
            "ON note_attachments(user_id, client_id) WHERE client_id IS NOT NULL"
        )
        conn.commit()
    finally:
        conn.close()

    # Ensure FTS5 virtual table for scratchpad_notes exists
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        fts_exists = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='scratchpad_notes_fts'"
        ).fetchone()
        if not fts_exists:
            conn.execute("""
                CREATE VIRTUAL TABLE IF NOT EXISTS scratchpad_notes_fts USING fts5(
                    title,
                    content,
                    content='scratchpad_notes',
                    content_rowid='id',
                    tokenize='unicode61'
                )
            """)
            conn.execute("INSERT INTO scratchpad_notes_fts(scratchpad_notes_fts) VALUES('rebuild')")

        # Ensure FTS triggers exist
        conn.execute("""
            CREATE TRIGGER IF NOT EXISTS trg_scratchpad_notes_ai AFTER INSERT ON scratchpad_notes BEGIN
                INSERT INTO scratchpad_notes_fts(rowid, title, content)
                VALUES (new.id, new.title, new.content);
            END;
        """)
        conn.execute("""
            CREATE TRIGGER IF NOT EXISTS trg_scratchpad_notes_ad AFTER DELETE ON scratchpad_notes BEGIN
                INSERT INTO scratchpad_notes_fts(scratchpad_notes_fts, rowid, title, content)
                VALUES ('delete', old.id, old.title, old.content);
            END;
        """)
        conn.execute("""
            CREATE TRIGGER IF NOT EXISTS trg_scratchpad_notes_au AFTER UPDATE ON scratchpad_notes BEGIN
                INSERT INTO scratchpad_notes_fts(scratchpad_notes_fts, rowid, title, content)
                VALUES ('delete', old.id, old.title, old.content);
                INSERT INTO scratchpad_notes_fts(rowid, title, content)
                VALUES (new.id, new.title, new.content);
            END;
        """)
        conn.commit()
    finally:
        conn.close()

    # Ensure mindmaps table exists
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS mindmaps (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL,
                title      TEXT NOT NULL DEFAULT 'Untitled',
                data_json  TEXT NOT NULL DEFAULT '{"nodeData":{"id":"root","topic":"Untitled","root":true,"children":[]}}',
                is_pinned  INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        conn.commit()
    finally:
        conn.close()

    # Ensure drawings table exists and migrate legacy schema if needed
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        table = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='drawings'").fetchone()
        if table:
            cols = [r["name"] for r in conn.execute("PRAGMA table_info(drawings)").fetchall()]
            if "title" not in cols or "note_id" in cols:
                conn.execute("PRAGMA legacy_alter_table=ON")  # jangan tulis ulang trigger tabel lain ke drawings_old
                conn.execute("ALTER TABLE drawings RENAME TO drawings_old")
                conn.execute("""
                    CREATE TABLE drawings (
                        id         INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        title      TEXT NOT NULL DEFAULT 'Untitled Drawing',
                        data_json  TEXT NOT NULL DEFAULT '{}',
                        svg_preview TEXT DEFAULT '',
                        is_pinned  INTEGER NOT NULL DEFAULT 0,
                        created_at TEXT NOT NULL,
                        updated_at TEXT NOT NULL
                    )
                """)
                old_rows = conn.execute("SELECT * FROM drawings_old").fetchall()
                for old in old_rows:
                    old_dict = dict(old)
                    note_title = "Untitled"
                    if "note_id" in old_dict and old_dict["note_id"]:
                        n = conn.execute("SELECT title FROM scratchpad_notes WHERE id = ?", (old_dict["note_id"],)).fetchone()
                        if n and n["title"]:
                            note_title = n["title"]
                    title = old_dict.get("title") or f"Gambar - {note_title}"
                    created_at = old_dict.get("created_at") or old_dict.get("updated_at") or datetime.now(_TZ_JKT).isoformat()
                    updated_at = old_dict.get("updated_at") or created_at
                    is_pinned = old_dict.get("is_pinned") or 0
                    svg_preview = old_dict.get("svg_preview") or ""
                    conn.execute(
                        "INSERT INTO drawings (id, user_id, title, data_json, svg_preview, is_pinned, created_at, updated_at) "
                        "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                        (old_dict["id"], old_dict["user_id"], title, old_dict.get("data_json", "{}"), svg_preview, is_pinned, created_at, updated_at)
                    )
                conn.execute("DROP TABLE drawings_old")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_drawings_user_updated ON drawings(user_id, updated_at DESC)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_drawings_user_pinned ON drawings(user_id, is_pinned DESC)")
                conn.commit()
        else:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS drawings (
                    id         INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    title      TEXT NOT NULL DEFAULT 'Untitled Drawing',
                    data_json  TEXT NOT NULL DEFAULT '{}',
                    svg_preview TEXT DEFAULT '',
                    is_pinned  INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_drawings_user_updated ON drawings(user_id, updated_at DESC)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_drawings_user_pinned ON drawings(user_id, is_pinned DESC)")
            conn.commit()
    finally:
        conn.close()

    # client_id: idempotensi retry sync drawings — client mengirim cid; retry POST tidak menduplikasi baris
    conn = sqlite3.connect(DB_PATH)
    try:
        try:
            conn.execute("ALTER TABLE drawings ADD COLUMN client_id TEXT")
        except sqlite3.OperationalError:
            pass  # kolom sudah ada
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_drawings_user_client ON drawings(user_id, client_id) WHERE client_id IS NOT NULL")
        conn.commit()
    finally:
        conn.close()

    # client_id: idempotensi retry sync scratchpad_notes — client mengirim cid; retry POST tidak menduplikasi baris
    conn = sqlite3.connect(DB_PATH)
    try:
        try:
            conn.execute("ALTER TABLE scratchpad_notes ADD COLUMN client_id TEXT")
        except sqlite3.OperationalError:
            pass  # kolom sudah ada
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_scratchpad_notes_user_client ON scratchpad_notes(user_id, client_id) WHERE client_id IS NOT NULL")
        conn.commit()
    finally:
        conn.close()

    # client_id: idempotensi retry sync tasks/habits/mindmaps (audit T11) — pola sama dengan drawings/notes:
    # ALTER idempoten (OperationalError = kolom sudah ada) + unique partial index (user_id, client_id).
    # CREATE UNIQUE INDEX dilindungi IntegrityError: bila DB lama sudah punya kolom dengan nilai duplikat,
    # index dilewati dan idempotensi tetap dijaga oleh SELECT di handler POST.
    for _tbl, _idx in (
        ("tasks", "idx_tasks_user_client"),
        ("habits", "idx_habits_user_client"),
        ("mindmaps", "idx_mindmaps_user_client"),
    ):
        conn = sqlite3.connect(DB_PATH)
        try:
            try:
                conn.execute(f"ALTER TABLE {_tbl} ADD COLUMN client_id TEXT")
            except sqlite3.OperationalError as e:
                if "duplicate column" not in str(e).lower():
                    raise  # "database is locked" dsb. tidak boleh ditelan — deploy harus gagal terlihat
            try:
                conn.execute(
                    f"CREATE UNIQUE INDEX IF NOT EXISTS {_idx} ON {_tbl}(user_id, client_id) WHERE client_id IS NOT NULL"
                )
            except sqlite3.IntegrityError:
                pass  # duplikat lama di DB; handler tetap idempoten lewat SELECT (user_id, client_id)
            conn.commit()
        finally:
            conn.close()

    # Trash note: snapshot note yang dihapus (dipulihkan lewat /api/scratchpad/trash/{id}/restore)
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS trashed_notes (
                note_id       INTEGER PRIMARY KEY,
                user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                title         TEXT NOT NULL DEFAULT '',
                snapshot_json TEXT NOT NULL,
                deleted_at    TEXT NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_trashed_user ON trashed_notes(user_id, deleted_at)")
        conn.commit()
    finally:
        conn.close()

    # Sampah mindmap: snapshot peta yang dihapus (dipulihkan lewat /api/mindmaps/trash/{id}/restore)
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS trashed_mindmaps (
                mindmap_id     INTEGER PRIMARY KEY,
                user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                title          TEXT NOT NULL DEFAULT '',
                list_id        INTEGER,
                source_note_id INTEGER,
                client_id      TEXT,
                snapshot_json  TEXT NOT NULL,
                deleted_at     TEXT NOT NULL,
                deleted_by     INTEGER
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_trashed_mm_user ON trashed_mindmaps(user_id, deleted_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_trashed_mm_note ON trashed_mindmaps(source_note_id) "
                     "WHERE source_note_id IS NOT NULL")
        conn.commit()
    finally:
        conn.close()

    # Pesan Pribadi / DM 1-on-1 (docs/superpowers/specs/2026-10-03-direct-messages-design.md).
    # Terpisah total dari shared list: tidak ada FK ke shared_lists, jadi hapus grup tidak menghapus DM.
    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS dm_conversations (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                user_a          INTEGER NOT NULL,
                user_b          INTEGER NOT NULL,
                created_at      TEXT NOT NULL,
                last_message_at TEXT,
                UNIQUE (user_a, user_b),
                CHECK (user_a < user_b),
                FOREIGN KEY (user_a) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (user_b) REFERENCES users(id) ON DELETE CASCADE
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS dm_messages (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                conversation_id INTEGER NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
                user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                content         TEXT NOT NULL,
                reply_to_id     INTEGER DEFAULT NULL REFERENCES dm_messages(id) ON DELETE SET NULL,
                client_id       TEXT DEFAULT NULL,
                created_at      TEXT NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_dm_messages_conv ON dm_messages(conversation_id, id)")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS dm_reads (
                conversation_id INTEGER NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
                user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                last_read_id    INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (conversation_id, user_id)
            )
        """)
        # Blokir antar-user (bukan per percakapan): berlaku bila SALAH SATU memblokir yang lain.
        conn.execute("""
            CREATE TABLE IF NOT EXISTS dm_blocks (
                blocker_id INTEGER NOT NULL,
                blocked_id INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (blocker_id, blocked_id),
                FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE
            )
        """)
        conn.commit()
    finally:
        conn.close()

    # Widen entity_tags CHECK constraint to include 'drawing' and 'mindmap'
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        et = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='entity_tags'").fetchone()
        if et and "'drawing'" not in (et["sql"] or ""):
            conn.execute("PRAGMA legacy_alter_table=ON")  # jangan tulis ulang trigger tabel lain ke entity_tags_old
            conn.execute("ALTER TABLE entity_tags RENAME TO entity_tags_old")
            conn.execute("""
                CREATE TABLE entity_tags (
                    tag_id      INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                    user_id     INTEGER NOT NULL,
                    entity_type TEXT NOT NULL CHECK(entity_type IN ('note','task','habit','goal','message','drawing','mindmap')),
                    entity_id   INTEGER NOT NULL,
                    created_at  TEXT DEFAULT (datetime('now')),
                    PRIMARY KEY (tag_id, entity_type, entity_id)
                )
            """)
            conn.execute("INSERT OR IGNORE INTO entity_tags SELECT * FROM entity_tags_old")
            conn.execute("DROP TABLE entity_tags_old")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_entity_tags_lookup   ON entity_tags(entity_type, entity_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_entity_tags_tag      ON entity_tags(tag_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_entity_tags_user     ON entity_tags(user_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_entity_tags_tag_user ON entity_tags(tag_id, user_id)")
            conn.commit()
    finally:
        conn.close()

    # Migrate scratchpad_notes.tags (JSON array) → tags + entity_tags
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        migrated = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='tags'").fetchone()
        if migrated:
            notes = conn.execute("SELECT id, user_id, tags FROM scratchpad_notes WHERE tags IS NOT NULL AND tags != '[]'").fetchall()
            for note in notes:
                try:
                    tag_names = json.loads(note["tags"] or "[]")
                    if tag_names:
                        _upsert_tags_for_note(conn, note["id"], note["user_id"], tag_names)
                except Exception:
                    pass
            conn.commit()
    finally:
        conn.close()

    # Migrate mindmaps.list_id column
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(mindmaps)").fetchall()]
        if "list_id" not in cols:
            conn.execute("ALTER TABLE mindmaps ADD COLUMN list_id INTEGER DEFAULT NULL")
            conn.commit()
    finally:
        conn.close()

    # Migrate mindmaps.last_edited_by column (collaborative shared mindmaps #2h-3)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(mindmaps)").fetchall()]
        if "last_edited_by" not in cols:
            conn.execute("ALTER TABLE mindmaps ADD COLUMN last_edited_by INTEGER")
            conn.commit()
    finally:
        conn.close()

    # Migrate mindmaps.source_note_id (Petakan: peta tertaut ke catatan, satu peta per catatan).
    # Tanpa FK (catatan bisa dihapus/dipulihkan); index unik parsial dibuat walau kolom sudah ada.
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(mindmaps)").fetchall()]
        if "source_note_id" not in cols:
            conn.execute("ALTER TABLE mindmaps ADD COLUMN source_note_id INTEGER DEFAULT NULL")
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS ux_mindmaps_source_note "
            "ON mindmaps(source_note_id) WHERE source_note_id IS NOT NULL"
        )
        # Pin pribadi per user (temuan #8a). Kolom lama mindmaps.is_pinned dibiarkan (rollback aman), tidak dipakai lagi.
        pins_existed = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='mindmap_pins'"
        ).fetchone()
        conn.execute(
            "CREATE TABLE IF NOT EXISTS mindmap_pins ("
            "user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, "
            "mindmap_id INTEGER NOT NULL, created_at TEXT, "
            "PRIMARY KEY (user_id, mindmap_id))"
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_mindmap_pins_mm ON mindmap_pins(mindmap_id)")
        if not pins_existed:
            conn.execute(
                "INSERT OR IGNORE INTO mindmap_pins (user_id, mindmap_id, created_at) "
                "SELECT user_id, id, updated_at FROM mindmaps WHERE is_pinned = 1"
            )
        conn.commit()
        # Teks node untuk pencarian (temuan #7). NULL = belum dihitung; peta tertaut = "".
        if "search_text" not in [r["name"] for r in conn.execute("PRAGMA table_info(mindmaps)").fetchall()]:
            conn.execute("ALTER TABLE mindmaps ADD COLUMN search_text TEXT")
            conn.commit()
        while True:
            batch = conn.execute(
                "SELECT id, data_json, source_note_id FROM mindmaps WHERE search_text IS NULL LIMIT 200"
            ).fetchall()
            if not batch:
                break
            for r in batch:
                st = "" if r["source_note_id"] is not None else _mindmap_search_text(r["data_json"])
                conn.execute("UPDATE mindmaps SET search_text = ? WHERE id = ?", (st, r["id"]))
            conn.commit()
    finally:
        conn.close()

    # Migrate messages.note_id column
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(messages)").fetchall()]
        if "note_id" not in cols:
            conn.execute("ALTER TABLE messages ADD COLUMN note_id INTEGER")
            conn.commit()
    finally:
        conn.close()

    # Migrate messages.client_id column (offline chat dedup)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(messages)").fetchall()]
        if "client_id" not in cols:
            conn.execute("ALTER TABLE messages ADD COLUMN client_id TEXT")
            conn.commit()
    finally:
        conn.close()

    # Create note_templates table
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS note_templates (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER NOT NULL,
                name        TEXT NOT NULL,
                group_name  TEXT NOT NULL,
                content     TEXT NOT NULL,
                is_default  INTEGER NOT NULL DEFAULT 0,
                sort_order  INTEGER NOT NULL DEFAULT 0,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            )
        """)
        conn.commit()
    finally:
        conn.close()

    # Update default template content (add hardcoded tags)
    from datetime import datetime as _dt
    _now = _dt.now().isoformat()
    conn = sqlite3.connect(DB_PATH)
    try:
        for t in _DEFAULT_NOTE_TEMPLATES:
            conn.execute(
                "UPDATE note_templates SET content = ?, updated_at = ? "
                "WHERE name = ? AND group_name = ? AND is_default = 1",
                (t["content"], _now, t["name"], t["group_name"])
            )
        conn.commit()
    finally:
        conn.close()

    # Create ext_tokens table (browser clipper auth)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS ext_tokens (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL,
                token      TEXT,
                state      TEXT UNIQUE,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_ext_tokens_state ON ext_tokens(state)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_ext_tokens_user  ON ext_tokens(user_id)")
        conn.commit()
    finally:
        conn.close()

    # Ensure note_saved_searches table exists
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS note_saved_searches (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name       TEXT NOT NULL,
                query      TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_note_saved_searches_user ON note_saved_searches(user_id, created_at)")
        conn.commit()
    finally:
        conn.close()

    # Ensure workspace_files table exists
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS workspace_files (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                list_id       INTEGER NOT NULL REFERENCES shared_lists(id) ON DELETE CASCADE,
                user_id       INTEGER NOT NULL REFERENCES users(id),
                filename      TEXT NOT NULL,
                original_name TEXT NOT NULL,
                file_size     INTEGER DEFAULT 0,
                mime_type     TEXT DEFAULT '',
                source        TEXT NOT NULL DEFAULT 'direct',
                task_id       INTEGER DEFAULT NULL,
                is_deleted    INTEGER DEFAULT 0,
                created_at    TEXT NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_workspace_files_list ON workspace_files(list_id, created_at)")
        conn.commit()
    finally:
        conn.close()

    # Migrate messages.file_id column
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(messages)").fetchall()]
        if "file_id" not in cols:
            conn.execute("ALTER TABLE messages ADD COLUMN file_id INTEGER DEFAULT NULL REFERENCES workspace_files(id)")
            conn.commit()
    finally:
        conn.close()

    # Project sebagai entitas: skema + backfill dari tasks.project (idempoten).
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA foreign_keys=ON")
        repository.ensure_projects_schema(conn)
        repository.backfill_projects(conn)
        repository.ensure_contexts_schema(conn)
        repository.ensure_workspace_pins_schema(conn)
        repository.ensure_workspace_identity_schema(conn)
        repository.ensure_workspace_invitations_schema(conn)
        repository.ensure_list_invites_schema(conn)
        repository.ensure_pomodoro_schema(conn)
        repository.backfill_contexts(conn)
        # Drawing milik workspace: kolom list_id/last_edited_by + backfill sekali jalan dari note workspace.
        drawing_scope.ensure_drawing_scope_schema(conn)
        drawing_scope.backfill_drawing_lists(conn, datetime.now(_TZ_JKT).isoformat())
        # Komentar note workspace: skema + bersihkan tombstone > 30 hari.
        note_comments.ensure_note_comments_schema(conn)
        note_comments.purge_old_tombstones(conn, datetime.now(_TZ_JKT).isoformat())
        # Outbox email (antrean kirim + retry).
        email_outbox.ensure_schema(conn)
        conn.commit()
    finally:
        conn.close()

    # Terakhir: pulihkan trigger yang rusak oleh rebuild tabel lama (lihat _heal_broken_triggers).
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        _heal_broken_triggers(conn)
        conn.commit()
    finally:
        conn.close()


_OLD_TABLE_REF = re.compile(r"\b([A-Za-z_][A-Za-z0-9_]*)_old\b")


def _heal_broken_triggers(conn) -> list:
    """Perbaiki trigger yang merujuk tabel `<nama>_old` yang sudah di-DROP.

    Rebuild tabel lama (ALTER TABLE x RENAME TO x_old → CREATE x → DROP x_old) di SQLite >= 3.26 ikut
    menulis ulang trigger tabel LAIN yang merujuk `x` menjadi `x_old` (legacy_alter_table=OFF). Setelah
    `x_old` di-drop, setiap pemicu trigger gagal "no such table: main.x_old" — insiden 2026-10-15:
    trg_delete_note_tags/task_tags/habit_tags merujuk entity_tags_old sehingga SEMUA DELETE note/task/habit
    di server gagal 500 sejak migrasi entity_tags (2026-10-11). Trigger dibuat ulang dengan `x_old` → `x`
    bila tabel `x` ada; bila tidak ada, trigger di-drop (tidak mungkin berjalan). Idempoten.
    Mengembalikan daftar nama trigger yang diperbaiki."""
    tables = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    healed = []
    for name, sql in conn.execute(
        "SELECT name, sql FROM sqlite_master WHERE type='trigger' AND sql IS NOT NULL"
    ).fetchall():
        missing = [m.group(0) for m in _OLD_TABLE_REF.finditer(sql) if m.group(0) not in tables]
        if not missing:
            continue
        conn.execute(f'DROP TRIGGER IF EXISTS "{name}"')
        fixed = sql
        restorable = True
        for old_name in set(missing):
            base = old_name[:-4]
            if base in tables:
                fixed = re.sub(rf"\b{re.escape(old_name)}\b", base, fixed)
            else:
                restorable = False
        if restorable:
            conn.execute(fixed)
        healed.append(name)
        print(f"[migrate_db] trigger rusak diperbaiki: {name} ({', '.join(sorted(set(missing)))})")
    return healed


# ── Password hashing (no external deps) ───────────────────────────────────────

def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000)
    return f"{salt}${h.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, h = stored.split("$")
        return hmac.compare_digest(hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000).hex(), h)
    except Exception:
        return False


# ── JWT helpers ────────────────────────────────────────────────────────────────

def _pw_fingerprint(password_hash: str) -> str:
    """Sidik jari pendek hash password — klaim `pwv`, berubah saat password diganti."""
    return hashlib.sha256((password_hash or "").encode()).hexdigest()[:16]


def create_token(user_id: int, username: str, auth_time: int = None, pwv: str = None) -> str:
    now = datetime.now(timezone.utc)
    iat = int(now.timestamp())
    payload = {
        "sub": str(user_id),
        "username": username,
        "iat": iat,
        # auth_time = saat login password; dibawa terus oleh refresh (batas SESSION_MAX_DAYS)
        "auth_time": int(auth_time) if auth_time is not None else iat,
        "exp": now + timedelta(hours=JWT_EXPIRE_HOURS),
    }
    if pwv:
        payload["pwv"] = pwv
    return jwt.encode(payload, SECRET_KEY, algorithm=JWT_ALGORITHM)


def create_ext_token(user_id: int, username: str) -> str:
    payload = {
        "sub": str(user_id),
        "username": username,
        "scope": "ext",
        "exp": datetime.utcnow() + timedelta(days=30),
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ── Auth dependency ────────────────────────────────────────────────────────────

def _validate_token(token: str) -> dict:
    data = decode_token(token)
    data["sub"] = int(data["sub"])
    with get_db() as conn:
        if data.get("scope") == "ext":
            ext = conn.execute(
                "SELECT id FROM ext_tokens WHERE token = ?", (token,)
            ).fetchone()
            if not ext:
                raise HTTPException(status_code=401, detail="Token sudah direvoke")
        row = conn.execute(
            "SELECT username, password_hash FROM users WHERE id = ?", (data["sub"],)
        ).fetchone()
    if data.get("scope") != "ext" and data.get("pwv"):
        # Token sesi dengan klaim pwv: tolak bila password sudah diganti (atau user hilang),
        # agar ganti/reset password langsung mengeluarkan semua perangkat lain.
        if not row or _pw_fingerprint(row["password_hash"]) != data["pwv"]:
            raise HTTPException(status_code=401, detail="Password sudah diganti — masuk lagi")
    if row:
        # Klaim username bisa basi setelah ganti username → selalu pakai nilai DB
        data["username"] = row["username"]
    return data


def _session_still_valid(user: dict) -> bool:
    """Cek ulang sesi untuk stream SSE yang berumur panjang: False bila password sudah
    diganti (pwv beda) atau user hilang. Token tanpa pwv dianggap tetap sah."""
    pwv = user.get("pwv")
    if not pwv or user.get("scope") == "ext":
        return True
    with get_db() as conn:
        row = conn.execute(
            "SELECT password_hash FROM users WHERE id = ?", (user["sub"],)
        ).fetchone()
    return bool(row) and _pw_fingerprint(row["password_hash"]) == pwv


def _unverified_sub(token: str):
    """sub dari payload tanpa cek tanda tangan/exp; None bila tak terbaca."""
    try:
        data = jwt.decode(token, options={"verify_signature": False, "verify_exp": False})
        return int(data["sub"])
    except Exception:
        return None


async def _resolve_user(request: Request, allow_query: bool) -> dict:
    # Urutan: header Bearer (identitas tab ini) → cookie → query. Cookie dipakai bersama
    # semua tab, jadi tidak boleh menimpa header; kandidat rusak/expired dilewati.
    candidates = []
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer ") and auth[7:].strip():
        candidates.append(auth[7:].strip())
    cookie_tok = request.cookies.get("token")
    if cookie_tok:
        candidates.append(cookie_tok)
    if allow_query:
        # EventSource (SSE) cannot send the Authorization header cross-origin (Tauri desktop),
        # so the stream endpoint also accepts the token as a query param. Scoped to SSE only.
        q_tok = request.query_params.get("token")
        if q_tok:
            candidates.append(q_tok)
    seen = set()
    candidates = [t for t in candidates if not (t in seen or seen.add(t))]
    if not candidates:
        raise HTTPException(status_code=401, detail="Not authenticated")
    # Identitas yang diklaim kandidat pertama (sub tanpa verifikasi). Fallback hanya
    # boleh ke token akun yang SAMA — cookie bisa milik akun lain dari tab lain.
    claimed = _unverified_sub(candidates[0])
    first_err = None
    for i, tok in enumerate(candidates):
        try:
            data = _validate_token(tok)
        except HTTPException as e:
            first_err = first_err or e
            continue
        if i == 0 or claimed is None or data["sub"] == claimed:
            return data
    raise first_err


async def get_current_user(request: Request) -> dict:
    return await _resolve_user(request, allow_query=False)


async def get_current_user_sse(request: Request) -> dict:
    return await _resolve_user(request, allow_query=True)

async def get_admin_user(user: dict = Depends(get_current_user)) -> dict:
    with get_db() as conn:
        row = conn.execute("SELECT is_admin FROM users WHERE id = ?", (user["sub"],)).fetchone()
        if not row or not row["is_admin"]:
            raise HTTPException(status_code=403, detail="Admin access required")
    return {**user, "is_admin": 1}


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class RegisterReq(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=4, max_length=100)
    display_name: str = ""
    email: str = Field(min_length=5, max_length=255)

class LoginReq(BaseModel):
    username: str
    password: str

class EmailChangeReq(BaseModel):
    email: str
    current_password: str

class PasswordChangeReq(BaseModel):
    old_password: str
    new_password: str = Field(min_length=4, max_length=100)

class UsernameChangeReq(BaseModel):
    new_username: str
    current_password: str

class CompleteAccountReq(BaseModel):
    new_username: Optional[str] = None
    email: str
    new_password: str = Field(min_length=4, max_length=100)

class ForgotReq(BaseModel):
    email: str

class ResetReq(BaseModel):
    token: str = Field(min_length=1)
    new_password: str = Field(min_length=4, max_length=100)

class TaskCreate(BaseModel):
    title: str = Field(min_length=1)
    description: str = ""
    priority: str = "P2"
    project: str = ""
    project_id: Optional[int] = None
    context: str = ""
    context_id: Optional[int] = None
    deadline: Optional[str] = None
    gtd_status: str = "inbox"
    waiting_for: str = ""
    list_id: Optional[int] = None
    assigned_to: Optional[int] = None
    parent_id: Optional[int] = None
    recurrence_type: Optional[str] = None   # daily|weekly|monthly|weekdays
    recurrence_days: Optional[list] = None  # [0,2,4] untuk weekly Sen/Rab/Jum
    estimated_pomodoros: int = Field(default=1, ge=1, le=20)
    # Idempotensi retry sync (audit T11): (user_id, client_id) sudah ada → kembalikan baris itu, bukan insert
    client_id: Optional[str] = Field(default=None, max_length=64)

class ReviewSnapshotIn(BaseModel):
    score: int
    overdue: int = 0
    p1_overdue: int = 0
    projects_without_next: int = 0
    done_this_week: int = 0
    active: int = 0

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    project: Optional[str] = None
    project_id: Optional[int] = None
    context: Optional[str] = None
    context_id: Optional[int] = None
    deadline: Optional[str] = None
    gtd_status: Optional[str] = None
    waiting_for: Optional[str] = None
    assigned_to: Optional[int] = None
    progress: Optional[int] = None
    recurrence_type: Optional[str] = None
    recurrence_days: Optional[list] = None
    recurrence_renew: Optional[bool] = None  # True = perpanjang 3 bulan
    estimated_pomodoros: Optional[int] = Field(default=None, ge=1, le=20)
    is_focused: Optional[bool] = None  # audit K6: status fokus ikut dikirim push offline (disimpan 0/1)
    # base_rev: updated_at yang diketahui klien; bila dikirim dan ≠ server → 409 REV_MISMATCH (prinsip 7)
    base_rev: Optional[str] = None

class SharedListCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)

class PinOrderReq(BaseModel):
    list_ids: list[int] = Field(max_length=50)

class WorkspacePatch(BaseModel):
    """Semua opsional; field yang tidak dikirim (model_fields_set) tidak diubah."""
    name: Optional[str] = None
    description: Optional[str] = None
    color_idx: Optional[Any] = None
    avatar: Optional[str] = None

class HabitCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    phase: str = "pagi"
    micro_target: str = ""
    frequency: list = ["mon","tue","wed","thu","fri","sat","sun"]
    identity_pillar: str = ""
    client_id: Optional[str] = Field(default=None, max_length=64)  # idempotensi retry sync (audit T11)

class HabitUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    phase: str = "pagi"
    micro_target: str = ""
    frequency: list = ["mon","tue","wed","thu","fri","sat","sun"]
    identity_pillar: str = ""

class HabitCheckinReq(BaseModel):
    status: str
    skip_reason: str = ""
    date: str = ""

class InviteUserReq(BaseModel):
    username: str

class HabitTemplateCreate(BaseModel):
    kategori: str
    subkategori: str
    type: Literal["habit", "task"]
    item: str
    frequency: Literal["daily", "monthly"]
    priority: Literal["low", "medium", "high"]
    difficulty: Literal["easy", "medium", "hard"]
    tags: list[str] = []

class HabitTemplateUpdate(BaseModel):
    kategori: str
    subkategori: str
    type: Literal["habit", "task"]
    item: str
    frequency: Literal["daily", "monthly"]
    priority: Literal["low", "medium", "high"]
    difficulty: Literal["easy", "medium", "hard"]
    tags: list[str] = []

class DrawingUpsert(BaseModel):
    data_json: str = Field(max_length=5_000_000)

    @field_validator("data_json")
    @classmethod
    def must_be_valid_json(cls, v: str) -> str:
        try:
            json.loads(v)
        except ValueError:
            raise ValueError("data_json must be valid JSON")
        return v

class DrawingCreate(BaseModel):
    title: str = Field(default="Untitled Drawing", min_length=1)
    data_json: str = Field(default="{}", max_length=5_000_000)
    svg_preview: str = Field(default="", max_length=5_000_000)
    tags: Optional[list[str]] = None
    client_id: Optional[str] = None
    list_id: Optional[int] = None

    @field_validator("data_json")
    @classmethod
    def must_be_valid_json(cls, v: str) -> str:
        try:
            json.loads(v)
        except ValueError:
            raise ValueError("data_json must be valid JSON")
        return v

class DrawingShareReq(BaseModel):
    list_id: Optional[int] = None


class DrawingCopyReq(BaseModel):
    list_id: Optional[int] = None
    title: Optional[str] = Field(default=None, min_length=1)
    client_id: Optional[str] = None


class DrawingUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1)
    data_json: Optional[str] = Field(default=None, max_length=5_000_000)
    svg_preview: Optional[str] = Field(default=None, max_length=5_000_000)
    tags: Optional[list[str]] = None
    # base_rev: updated_at yang diketahui klien; bila dikirim dan ≠ server → 409 REV_MISMATCH (prinsip 7)
    base_rev: Optional[str] = None

    @field_validator("data_json")
    @classmethod
    def must_be_valid_json_if_present(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            try:
                json.loads(v)
            except ValueError:
                raise ValueError("data_json must be valid JSON")
        return v

class MindmapCreate(BaseModel):
    title: str = Field(default="Untitled", min_length=1)
    data_json: str = Field(
        default='{"nodeData":{"id":"root","topic":"Untitled","root":true,"children":[]}}',
        max_length=5_000_000
    )
    list_id: Optional[int] = None  # audit S7: peta yang dibuat (offline) di list bersama; dicek keanggotaan
    client_id: Optional[str] = Field(default=None, max_length=64)  # idempotensi retry sync (audit T11)
    source_note_id: Optional[int] = None  # Petakan: buat/ambil peta tertaut milik catatan ini

    @field_validator("data_json")
    @classmethod
    def mindmap_json_valid(cls, v: str) -> str:
        try:
            json.loads(v)
        except ValueError:
            raise ValueError("data_json must be valid JSON")
        # XSS: dangerouslySetInnerHTML / hyperLink tidak aman di node dibuang sebelum disimpan
        return safehtml.sanitize_mind_json(v)

class MindmapUpdate(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=200)
    data_json: Optional[str] = Field(default=None, max_length=5_000_000)
    # base_rev: updated_at yang diketahui klien; bila dikirim dan ≠ server → 409 REV_MISMATCH (prinsip 7)
    base_rev: Optional[str] = None

    @field_validator("data_json")
    @classmethod
    def mindmap_json_valid(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            try:
                json.loads(v)
            except ValueError:
                raise ValueError("data_json must be valid JSON")
            # XSS: dangerouslySetInnerHTML / hyperLink tidak aman di node dibuang sebelum disimpan
            v = safehtml.sanitize_mind_json(v)
        return v

class ScratchpadCreate(BaseModel):
    title: str = ""
    content: str = ""
    tags: list[str] = []
    linked_task_id: Optional[int] = None
    linked_task_ids: list[int] = []
    list_id: Optional[int] = None
    meta_json: str = '{}'
    client_id: Optional[str] = None

class ScratchpadUpdate(BaseModel):
    title: str = ""
    content: str = ""
    tags: list[str] = []
    linked_task_id: Optional[int] = None
    linked_task_ids: list[int] = []
    # list_id: hanya diterapkan bila ADA di payload (model_fields_set); absen = tidak berubah (audit K4)
    list_id: Optional[int] = None
    meta_json: Optional[str] = None
    # base_rev: updated_at yang diketahui klien; bila dikirim dan ≠ server → 409 REV_MISMATCH (prinsip 7)
    base_rev: Optional[str] = None

class ExtAuthConfirmReq(BaseModel):
    state: str

class NoteShareReq(BaseModel):
    list_id: Optional[int] = None  # None = unshare

class PublishReq(BaseModel):
    password: Optional[str] = None  # None/empty = no password

class JoinListReq(BaseModel):
    code: str


class GenerateLinkReq(BaseModel):
    expires_in: Literal["1h", "1d", "7d"] = "1d"
    max_uses: Literal[1, 10, None] = 1


_INVITE_ERRORS = {
    "missing": "Kode tidak valid.",
    "revoked": "Link sudah dibatalkan owner.",
    "expired": "Link sudah kedaluwarsa.",
    "full": "Link sudah mencapai batas pemakaian.",
}
_INVITE_HOURS = {"1h": 1, "1d": 24, "7d": 24 * 7}

# Referensi kuat untuk task DM undangan agar tidak dibuang GC sebelum selesai.
_INVITE_DM_TASKS: set = set()


def _spawn_invite_dm(coro) -> None:
    task = asyncio.create_task(coro)
    _INVITE_DM_TASKS.add(task)
    task.add_done_callback(_INVITE_DM_TASKS.discard)


def _iso_with_offset(s):
    """Stempel naive (waktu lokal server) -> ISO ber-offset agar klien tidak salah baca zona.
    None/kosong dikembalikan apa adanya; string yang sudah ber-offset tidak diubah."""
    if not s or not isinstance(s, str):
        return s
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return s
    if dt.tzinfo is not None:
        return s
    return dt.astimezone().isoformat()

class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=2000)
    task_id: Optional[int] = None
    note_id: Optional[int] = None
    file_id: Optional[int] = None
    msg_type: str = "text"
    reply_to_id: Optional[int] = None
    client_id: Optional[str] = Field(default=None, max_length=64)

class DmConversationCreate(BaseModel):
    user_id: int

class DmMessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=2000)
    reply_to_id: Optional[int] = None
    client_id: Optional[str] = Field(default=None, max_length=64)

class RecurrenceMarkReq(BaseModel):
    status: str  # "done" | "skipped"


# ── Row → dict helper ─────────────────────────────────────────────────────────

def task_row_to_dict(row, conn=None) -> dict:
    d = dict(row)
    # Compute extra fields
    dl = d.get("deadline")
    is_overdue = False
    days_left = None
    if dl:
        try:
            dd = date.fromisoformat(dl)
            days_left = (dd - date.today()).days
            is_overdue = days_left < 0 and d.get("gtd_status") not in ("done", "archived")
        except Exception:
            pass
    d["is_overdue"] = is_overdue
    d["days_until_deadline"] = days_left
    d["is_focused"] = bool(d.get("is_focused", 0))
    # Resolve assigned_to display name
    assigned_id = d.get("assigned_to")
    if assigned_id:
        def _fetch_name(c):
            u = c.execute("SELECT username, display_name FROM users WHERE id = ?", (assigned_id,)).fetchone()
            return (u["display_name"] or u["username"]) if u else None
        if conn:
            d["assigned_to_name"] = _fetch_name(conn)
        else:
            with get_db() as c:
                d["assigned_to_name"] = _fetch_name(c)
    else:
        d["assigned_to_name"] = None
    # Resolve parent task title
    parent_id = d.get("parent_id")
    if parent_id:
        def _fetch_parent(c):
            pt = c.execute("SELECT title FROM tasks WHERE id = ?", (parent_id,)).fetchone()
            return pt["title"] if pt else None
        if conn:
            d["parent_title"] = _fetch_parent(conn)
        else:
            with get_db() as c:
                d["parent_title"] = _fetch_parent(c)
    else:
        d["parent_title"] = None
    return d


# ── Access control helpers ────────────────────────────────────────────────────

def _can_access_task(conn, task_id: int, user_id: int, write: bool = False):
    """
    Returns task row if user can access it. Raises 404/403 otherwise.
    write=True means mutations (edit/done/delete) — list members can write,
    but only task owner or list owner can delete (caller handles that distinction).
    """
    row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Task not found")
    if row["user_id"] == user_id:
        return row
    list_id = row["list_id"]
    if list_id:
        repo = TaskRepository(DB_PATH)
        if repo.is_list_member_or_owner(list_id, user_id):
            return row
    raise HTTPException(status_code=403, detail="Not authorized")


def _check_base_rev(req, existing, current_fn) -> None:
    """Konflik edit-vs-edit (prinsip 7 audit sinkron): bila klien mengirim base_rev (updated_at yang
    ia ketahui) dan nilainya ≠ updated_at server saat ini, tolak dengan 409 REV_MISMATCH dan sertakan
    baris server terkini supaya klien bisa membuat salinan konflik / merge. Tanpa base_rev → perilaku
    lama (LWW) tidak berubah. `current_fn` dipanggil malas hanya saat konflik."""
    base_rev = getattr(req, "base_rev", None)
    if base_rev is None:
        return
    if base_rev != existing["updated_at"]:
        raise HTTPException(
            status_code=409,
            detail={"code": "REV_MISMATCH", "current": current_fn()},
        )


def _esc_msg(v) -> str:
    """Escape nilai pengguna untuk pesan notifikasi (disimpan sebagai HTML dan dikirim ke Telegram HTML)."""
    return html.escape(str(v if v is not None else ""), quote=False)


async def _notify_members_bg(list_id: int, actor_user_id: int, message: str, task_id: Optional[int] = None):
    """Write in-app notifications + send Telegram to all list members except the actor."""
    if not list_id:
        return
    try:
        repo = TaskRepository(DB_PATH)
        # In-app notification (always)
        repo.notify_list_members(list_id, actor_user_id, message, task_id=task_id)
        # Telegram (if bot available)
        if _tg_bot:
            tg_ids = repo.get_list_member_telegram_ids(list_id, actor_user_id)
            for tg_id in tg_ids:
                try:
                    await _tg_bot.send_message(chat_id=tg_id, text=message, parse_mode="HTML")
                except Exception:
                    pass
    except Exception:
        pass


async def _notify_users_bg(messages: dict, list_id: int, note_id: int):
    """In-app + Telegram per penerima ({user_id: pesan}); kegagalan satu penerima tidak menghentikan yang lain."""
    for uid, msg in messages.items():
        try:
            TaskRepository(DB_PATH).add_notification(uid, msg, list_id=list_id, note_id=note_id)
            if _tg_bot:
                with get_db() as conn:
                    row = conn.execute("SELECT telegram_id FROM users WHERE id = ?", (uid,)).fetchone()
                if row and row["telegram_id"]:
                    await _tg_bot.send_message(chat_id=row["telegram_id"], text=msg, parse_mode="HTML")
        except Exception:
            pass


async def _send_tg_message(tg_id: int, text: str):
    try:
        await _tg_bot.send_message(chat_id=tg_id, text=text, parse_mode="HTML")
    except Exception:
        pass


# ══════════════════════════════════════════════════════════════════════════════
#  APP
# ══════════════════════════════════════════════════════════════════════════════

app = FastAPI(title="Alurik", docs_url="/api/docs")

from fastapi.middleware.cors import CORSMiddleware

_CORS_ORIGINS = [
    o.strip() for o in os.environ.get(
        "CORS_ALLOW_ORIGINS",
        "tauri://localhost,http://tauri.localhost,https://tauri.localhost,https://todo.yatno.web.id",
    ).split(",") if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class _NoSniffMiddleware:
    """X-Content-Type-Options: nosniff di semua respons HTTP (spec XSS §6); nilai yang sudah dipasang tidak ditimpa.
    Middleware ASGI murni (bukan BaseHTTPMiddleware) supaya respons streaming/SSE tidak ikut di-buffer."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def _send(message):
            if message["type"] == "http.response.start":
                headers = list(message.get("headers") or [])
                if not any(k.lower() == b"x-content-type-options" for k, _ in headers):
                    headers.append((b"x-content-type-options", b"nosniff"))
                    message = {**message, "headers": headers}
            await send(message)

        await self.app(scope, receive, _send)


app.add_middleware(_NoSniffMiddleware)


# Bump when the curated template content changes; a higher value than the
# stored app_meta['habit_templates_version'] triggers a wipe-and-reseed.
HABIT_TEMPLATES_SEED_VERSION = 2


def seed_habit_templates():
    """Seed habit_templates from the curated JSON, version-aware.

    On first run (no prior version) or after HABIT_TEMPLATES_SEED_VERSION is
    bumped, wipe the table and reseed from habit_templates_curated.json. The
    stored version makes this idempotent across restarts. Missing JSON is a
    no-op so startup never crashes.
    """
    import os as _os
    json_path = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'habit_templates_curated.json')
    if not _os.path.exists(json_path):
        return
    with get_db() as conn:
        row = conn.execute(
            "SELECT value FROM app_meta WHERE key = 'habit_templates_version'"
        ).fetchone()
        current = int(row[0]) if row and str(row[0]).isdigit() else 0
        if current >= HABIT_TEMPLATES_SEED_VERSION:
            return
        with open(json_path, encoding='utf-8') as f:
            items = json.load(f)
        conn.execute("DELETE FROM habit_templates")
        for item in items:
            conn.execute(
                """INSERT INTO habit_templates
                   (kategori, subkategori, type, item, frequency, priority, difficulty, tags)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (item['kategori'], item['subkategori'], item['type'], item['item'],
                 item['frequency'], item['priority'], item['difficulty'],
                 json.dumps(item.get('tags', [])))
            )
        conn.execute(
            "INSERT OR REPLACE INTO app_meta (key, value) VALUES ('habit_templates_version', ?)",
            (str(HABIT_TEMPLATES_SEED_VERSION),)
        )

@app.on_event("startup")
async def startup():
    global _tg_bot
    migrate_db()
    seed_habit_templates()
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    try:
        os.makedirs(os.path.join(MEDIA_ROOT, ".tmp"), exist_ok=True)
    except OSError as e:
        logger.warning("MEDIA_ROOT tidak bisa dibuat (%s): %s", MEDIA_ROOT, e)
    if not _MEDIA_URL_SECRET_CFG:
        logger.warning("MEDIA_URL_SECRET kosong; secret URL media diturunkan dari WEB_SECRET_KEY")
    if not media_worker.ffprobe:
        logger.warning("ffprobe tidak ditemukan di PATH: media ditandai ready tanpa metadata (durasi/ukuran), "
                       "tanpa cek format dan tanpa poster; pasang dengan `sudo apt install ffmpeg`")
    if not media_worker.ffmpeg:
        logger.warning("ffmpeg tidak ditemukan di PATH: media diproses tanpa faststart dan tanpa poster; "
                       "pasang dengan `sudo apt install ffmpeg`")
    try:
        with get_db() as _c:
            _cleanup_stuck_media_uploads(_c, _media_utcnow())
    except Exception:
        logger.warning("pembersihan unggahan macet saat start gagal", exc_info=True)
    media_worker.requeue_processing()
    media_worker.start()
    try:
        email_worker.recover_stale()
    except Exception:
        logger.warning("pemulihan email 'sending' saat start gagal", exc_info=True)
    try:
        email_worker.purge_old()
    except Exception:
        logger.warning("pembersihan outbox email saat start gagal", exc_info=True)
    try:
        email_worker.start()
    except Exception:
        logger.warning("worker email gagal start", exc_info=True)
    if TELEGRAM_BOT_TOKEN:
        try:
            from telegram import Bot as TelegramBot
            _tg_bot = TelegramBot(token=TELEGRAM_BOT_TOKEN)
        except Exception:
            pass


# ── Auth routes ────────────────────────────────────────────────────────────────

@app.post("/api/auth/register")
async def register(req: RegisterReq, response: Response):
    email = req.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Format email tidak valid")
    if req.username.lower().startswith("tg_"):
        # prefix tg_ dicadangkan untuk akun Telegram otomatis
        raise HTTPException(status_code=400, detail="Username tidak boleh diawali tg_")
    with get_db() as conn:
        existing = conn.execute("SELECT id FROM users WHERE username = ?", (req.username,)).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="Username sudah digunakan")
        dup = conn.execute("SELECT id FROM users WHERE lower(email) = ?", (email,)).fetchone()
        if dup:
            raise HTTPException(status_code=400, detail="Email sudah terdaftar")

        now = datetime.now().isoformat()
        ph = hash_password(req.password)
        cur = conn.execute(
            "INSERT INTO users (username, password_hash, display_name, email, created_at) VALUES (?,?,?,?,?)",
            (req.username, ph, req.display_name or req.username, email, now),
        )
        user_id = cur.lastrowid

    token = create_token(user_id, req.username, pwv=_pw_fingerprint(ph))
    response.set_cookie("token", token, httponly=True, samesite="lax", max_age=JWT_EXPIRE_HOURS * 3600)
    return {"user_id": user_id, "username": req.username, "email": email, "token": token}


@app.post("/api/auth/login")
async def login(req: LoginReq, response: Response):
    with get_db() as conn:
        user = conn.execute("SELECT * FROM users WHERE username = ?", (req.username,)).fetchone()
        if not user or not verify_password(req.password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Username atau password salah")

    token = create_token(user["id"], user["username"], pwv=_pw_fingerprint(user["password_hash"]))
    response.set_cookie("token", token, httponly=True, samesite="lax", max_age=JWT_EXPIRE_HOURS * 3600)
    return {"user_id": user["id"], "username": user["username"], "display_name": user["display_name"], "email": user["email"], "token": token}


@app.get("/api/auth/me")
async def get_me(user=Depends(get_current_user)):
    with get_db() as conn:
        row = conn.execute("SELECT id, username, display_name, email, created_at, telegram_id, is_admin, password_set FROM users WHERE id = ?", (user["sub"],)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
    result = dict(row)
    result["telegram_linked"] = bool(result.pop("telegram_id"))
    result["password_set"] = bool(result["password_set"])
    return result


@app.post("/api/auth/refresh")
async def refresh_token(request: Request, response: Response, user=Depends(get_current_user)):
    """Perpanjangan geser untuk klien web/app: dipanggil saat umur token ≥1/3 masa
    berlakunya. Batas absolut SESSION_MAX_DAYS sejak login password (auth_time);
    ditolak bila password sudah diganti. Tanpa revokasi token lama, jadi refresh
    bersamaan dari beberapa tab aman. Cookie hanya diperbarui bila request membawa
    cookie `token` (SPA web) — klien header-saja (Tauri) tak butuh, dan refresh
    setelah logout tidak menghidupkan lagi cookie yang sudah dihapus."""
    if user.get("scope") == "ext":
        raise HTTPException(status_code=403, detail="Token ekstensi tidak bisa diperpanjang")
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, username, password_hash FROM users WHERE id = ?", (user["sub"],)
        ).fetchone()
    if not row:
        raise HTTPException(status_code=401, detail="User not found")
    pwv = _pw_fingerprint(row["password_hash"])
    if user.get("pwv") and user["pwv"] != pwv:
        raise HTTPException(status_code=401, detail="Password sudah diganti — masuk lagi")
    auth_time = user.get("auth_time")
    if auth_time is None:
        # token lama tanpa auth_time: perkirakan dari exp
        auth_time = int(user["exp"]) - JWT_EXPIRE_HOURS * 3600
    if int(_time.time()) - int(auth_time) > SESSION_MAX_DAYS * 86400:
        return {"renewed": False, "reason": "max_age"}
    token = create_token(row["id"], row["username"], auth_time=auth_time, pwv=pwv)
    if request.cookies.get("token"):
        response.set_cookie("token", token, httponly=True, samesite="lax", max_age=JWT_EXPIRE_HOURS * 3600)
    return {"renewed": True, "token": token, "expires_in": JWT_EXPIRE_HOURS * 3600}


@app.post("/api/auth/telegram-link-token")
async def generate_telegram_link_token(user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        row = conn.execute("SELECT telegram_id FROM users WHERE id = ?", (uid,)).fetchone()
        if row and row["telegram_id"]:
            raise HTTPException(status_code=400, detail="Akun sudah terhubung ke Telegram")
        token = secrets.token_hex(3).upper()
        expires_at = (datetime.now(_TZ_JKT) + timedelta(minutes=10)).isoformat()
        conn.execute("DELETE FROM telegram_link_tokens WHERE user_id = ?", (uid,))
        conn.execute("INSERT INTO telegram_link_tokens (token, user_id, expires_at) VALUES (?,?,?)",
                     (token, uid, expires_at))
        conn.commit()
    return {"token": token, "expires_in_minutes": 10, "bot_username": TELEGRAM_BOT_USERNAME}


@app.post("/api/auth/logout")
async def logout(response: Response):
    response.delete_cookie("token")
    return {"ok": True}


@app.patch("/api/auth/profile/email")
async def change_email(req: EmailChangeReq, user=Depends(get_current_user)):
    email = req.email.strip().lower()
    if not EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Format email tidak valid")
    with get_db() as conn:
        row = conn.execute("SELECT password_hash FROM users WHERE id = ?", (user["sub"],)).fetchone()
        if not row or not verify_password(req.current_password, row["password_hash"]):
            raise HTTPException(status_code=400, detail="Password salah")
        dup = conn.execute(
            "SELECT id FROM users WHERE lower(email) = ? AND id != ?", (email, user["sub"])
        ).fetchone()
        if dup:
            raise HTTPException(status_code=400, detail="Email sudah terdaftar")
        conn.execute("UPDATE users SET email = ? WHERE id = ?", (email, user["sub"]))
    return {"ok": True, "email": email}


def _validate_new_username(username: str) -> None:
    """Aturan username baru (ganti username / lengkapi akun): format + larangan prefix tg_."""
    if not USERNAME_RE.fullmatch(username):
        raise HTTPException(status_code=400, detail="Username hanya boleh huruf, angka, dan _ (3–50 karakter)")
    if username.lower().startswith("tg_"):
        raise HTTPException(status_code=400, detail="Username tidak boleh diawali tg_")


def _reissue_token(request: Request, response: Response, user: dict,
                   user_id: int, username: str, password_hash: str) -> str:
    """Token baru setelah profil berubah: auth_time pemanggil dipertahankan, pwv dari hash
    terbaru. Cookie hanya diperbarui bila request membawa cookie `token` (aturan refresh)."""
    auth_time = user.get("auth_time")
    if auth_time is None and user.get("exp") is not None:
        # token lama tanpa auth_time: perkirakan dari exp (sama seperti refresh)
        auth_time = int(user["exp"]) - JWT_EXPIRE_HOURS * 3600
    token = create_token(user_id, username, auth_time=auth_time,
                         pwv=_pw_fingerprint(password_hash))
    if request.cookies.get("token"):
        response.set_cookie("token", token, httponly=True, samesite="lax", max_age=JWT_EXPIRE_HOURS * 3600)
    return token


def _reject_ext_scope(user: dict) -> None:
    if user.get("scope") == "ext":
        raise HTTPException(status_code=403, detail="Token ekstensi tidak bisa mengubah akun")


@app.patch("/api/auth/profile/password")
async def change_password(req: PasswordChangeReq, request: Request, response: Response,
                          user=Depends(get_current_user)):
    _reject_ext_scope(user)
    with get_db() as conn:
        row = conn.execute("SELECT username, password_hash FROM users WHERE id = ?", (user["sub"],)).fetchone()
        if not row or not verify_password(req.old_password, row["password_hash"]):
            raise HTTPException(status_code=400, detail="Password lama salah")
        ph = hash_password(req.new_password)
        conn.execute("UPDATE users SET password_hash = ?, password_set = 1 WHERE id = ?", (ph, user["sub"]))
        conn.execute("DELETE FROM ext_tokens WHERE user_id = ?", (user["sub"],))
    token = _reissue_token(request, response, user, user["sub"], row["username"], ph)
    return {"ok": True, "token": token}


@app.patch("/api/auth/profile/username")
async def change_username(req: UsernameChangeReq, request: Request, response: Response,
                          user=Depends(get_current_user)):
    _reject_ext_scope(user)
    new_username = req.new_username.strip()
    _validate_new_username(new_username)
    with get_db() as conn:
        row = conn.execute("SELECT username, password_hash FROM users WHERE id = ?", (user["sub"],)).fetchone()
        if not row or not verify_password(req.current_password, row["password_hash"]):
            raise HTTPException(status_code=400, detail="Password salah")
        if new_username != row["username"]:
            dup = conn.execute(
                "SELECT id FROM users WHERE username = ? AND id != ?", (new_username, user["sub"])
            ).fetchone()
            if dup:
                raise HTTPException(status_code=400, detail="Username sudah digunakan")
            try:
                conn.execute("UPDATE users SET username = ? WHERE id = ?", (new_username, user["sub"]))
            except sqlite3.IntegrityError:
                raise HTTPException(status_code=400, detail="Username sudah digunakan")
    token = _reissue_token(request, response, user, user["sub"], new_username, row["password_hash"])
    return {"ok": True, "username": new_username, "token": token}


@app.post("/api/auth/complete-account")
async def complete_account(req: CompleteAccountReq, request: Request, response: Response,
                           user=Depends(get_current_user)):
    """Lengkapi akun Telegram otomatis (password_set = 0): atur password, email, dan
    opsional username sekaligus — tanpa password lama karena pengguna tidak pernah tahu."""
    _reject_ext_scope(user)
    email = req.email.strip().lower()
    new_username = (req.new_username or "").strip()
    with get_db() as conn:
        row = conn.execute(
            "SELECT username, password_set FROM users WHERE id = ?", (user["sub"],)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="User not found")
        if row["password_set"]:
            raise HTTPException(status_code=400, detail="Akun sudah lengkap")
        if not EMAIL_RE.match(email):
            raise HTTPException(status_code=400, detail="Format email tidak valid")
        if new_username:
            _validate_new_username(new_username)
        dup = conn.execute(
            "SELECT id FROM users WHERE lower(email) = ? AND id != ?", (email, user["sub"])
        ).fetchone()
        if dup:
            raise HTTPException(status_code=400, detail="Email sudah terdaftar")
        username = new_username or row["username"]
        if username != row["username"]:
            dup = conn.execute(
                "SELECT id FROM users WHERE username = ? AND id != ?", (username, user["sub"])
            ).fetchone()
            if dup:
                raise HTTPException(status_code=400, detail="Username sudah digunakan")
        ph = hash_password(req.new_password)
        try:
            conn.execute(
                "UPDATE users SET password_hash = ?, email = ?, username = ?, password_set = 1 WHERE id = ?",
                (ph, email, username, user["sub"]),
            )
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=400, detail="Username atau email sudah digunakan")
        conn.execute("DELETE FROM ext_tokens WHERE user_id = ?", (user["sub"],))
    token = _reissue_token(request, response, user, user["sub"], username, ph)
    return {"ok": True, "username": username, "email": email, "token": token}


_FORGOT_GENERIC = {"message": "Jika email terdaftar, link reset sudah dikirim"}

@app.post("/api/auth/forgot")
async def forgot_password(req: ForgotReq):
    email = req.email.strip().lower()
    with get_db() as conn:
        user = conn.execute(
            "SELECT id, username FROM users WHERE lower(email) = ?", (email,)
        ).fetchone()
        if not user:
            return _FORGOT_GENERIC
        one_hour_ago = (datetime.now(_TZ_JKT) - timedelta(hours=1)).isoformat()
        recent = conn.execute(
            "SELECT COUNT(*) AS n FROM password_reset_tokens WHERE user_id = ? AND created_at > ?",
            (user["id"], one_hour_ago),
        ).fetchone()["n"]
        if recent >= 3:
            return _FORGOT_GENERIC
        token = secrets.token_urlsafe(32)
        reset_link = f"{WEBAPP_URL}/?reset_token={token}"
        # Render dulu sebelum menulis apa pun: bila gagal, token tidak tersimpan tanpa emailnya,
        # dan respons tetap sama dengan email tak dikenal (anti-enumerasi).
        try:
            rendered = email_templates.reset_password(user["username"], reset_link)
        except Exception:
            logger.exception("render email reset gagal (user_id=%s)", user["id"])
            return _FORGOT_GENERIC
        now = datetime.now(_TZ_JKT)
        conn.execute(
            "INSERT INTO password_reset_tokens (user_id, token_hash, created_at, expires_at) VALUES (?,?,?,?)",
            (
                user["id"],
                hashlib.sha256(token.encode()).hexdigest(),
                now.isoformat(),
                (now + timedelta(hours=1)).isoformat(),
            ),
        )
        # Antre di transaksi yang sama dengan token; email kedaluwarsa 10 menit sebelum token (50 mnt).
        email_outbox.enqueue(
            conn, kind="reset", user_id=user["id"], to_addr=email,
            rendered=rendered,
            expires_at=email_outbox.utcnow() + timedelta(minutes=50),
        )
    email_worker.wake()
    return _FORGOT_GENERIC


@app.post("/api/auth/reset")
async def reset_password(req: ResetReq):
    token_hash = hashlib.sha256(req.token.encode()).hexdigest()
    now = datetime.now(_TZ_JKT).isoformat()
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM password_reset_tokens WHERE token_hash = ?", (token_hash,)
        ).fetchone()
        if not row or row["used_at"] or row["expires_at"] < now:
            raise HTTPException(status_code=400, detail="Link tidak valid atau kedaluwarsa")
        conn.execute(
            "UPDATE users SET password_hash = ?, password_set = 1 WHERE id = ?",
            (hash_password(req.new_password), row["user_id"]),
        )
        # token sesi lama gugur lewat pwv; token ekstensi dicabut eksplisit
        conn.execute("DELETE FROM ext_tokens WHERE user_id = ?", (row["user_id"],))
        conn.execute(
            "UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL",
            (now, row["user_id"]),
        )
    return {"ok": True}


@app.post("/api/ext-auth/begin")
async def ext_auth_begin():
    """Extension panggil ini untuk mulai auth flow. Return state UUID."""
    state = str(uuid.uuid4())
    now = datetime.now(_TZ_JKT).isoformat()
    expires = (datetime.now(_TZ_JKT) + timedelta(minutes=5)).isoformat()
    with get_db() as conn:
        conn.execute(
            "DELETE FROM ext_tokens WHERE token IS NULL AND expires_at < ?",
            (datetime.now(_TZ_JKT).isoformat(),)
        )
        conn.execute(
            "INSERT INTO ext_tokens (user_id, token, state, created_at, expires_at) VALUES (0, NULL, ?, ?, ?)",
            (state, now, expires)
        )
    return {"state": state}


@app.get("/api/ext-auth/poll")
async def ext_auth_poll(state: str = Query(...)):
    """Extension poll ini setiap 2 detik sampai token tersedia."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT token, expires_at FROM ext_tokens WHERE state = ?", (state,)
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="State tidak ditemukan atau sudah expired")
    # Cek apakah state sudah expired
    try:
        exp = datetime.fromisoformat(row["expires_at"])
        if datetime.now().replace(tzinfo=None) > exp.replace(tzinfo=None):
            raise HTTPException(status_code=410, detail="State expired")
    except (ValueError, TypeError):
        pass
    if row["token"] is None:
        return {"pending": True}
    # Token tersedia — clear state agar tidak bisa diklaim ulang
    with get_db() as conn2:
        conn2.execute("UPDATE ext_tokens SET state = NULL WHERE state = ?", (state,))
    return {"token": row["token"]}


@app.post("/api/ext-auth/confirm")
async def ext_auth_confirm(req: ExtAuthConfirmReq, user=Depends(get_current_user)):
    """User (sudah login webapp) approve extension. Generate token."""
    uid = user["sub"]
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, token, expires_at FROM ext_tokens WHERE state = ?", (req.state,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="State tidak ditemukan")
        if row["token"] is not None:
            raise HTTPException(status_code=409, detail="State sudah diklaim")
        # Cek apakah state expired
        try:
            exp = datetime.fromisoformat(row["expires_at"])
            if datetime.now().replace(tzinfo=None) > exp.replace(tzinfo=None):
                raise HTTPException(status_code=410, detail="State expired")
        except (ValueError, TypeError):
            pass
        # Generate token, update created_at menjadi now, expires_at +30 hari
        username = user.get("username", "")
        token = create_ext_token(uid, username)
        now = datetime.now(_TZ_JKT).isoformat()
        expires = (datetime.now(_TZ_JKT) + timedelta(days=30)).isoformat()
        conn.execute(
            "UPDATE ext_tokens SET token = ?, user_id = ?, created_at = ?, expires_at = ? WHERE id = ?",
            (token, uid, now, expires, row["id"])
        )
    return {"ok": True}


@app.delete("/api/ext-auth/revoke")
async def ext_auth_revoke(user=Depends(get_current_user)):
    """User revoke semua ext tokens miliknya."""
    uid = user["sub"]
    with get_db() as conn:
        conn.execute("DELETE FROM ext_tokens WHERE user_id = ? AND token IS NOT NULL", (uid,))
    return {"ok": True}


@app.get("/api/ext-auth/status")
async def ext_auth_status(user=Depends(get_current_user)):
    """Return info token aktif milik user, tanpa expose token value."""
    uid = user["sub"]
    with get_db() as conn:
        row = conn.execute(
            "SELECT created_at, expires_at FROM ext_tokens WHERE user_id = ? AND token IS NOT NULL ORDER BY created_at DESC LIMIT 1",
            (uid,)
        ).fetchone()
    if not row:
        return {"token": None}
    return {"token": {"created_at": row["created_at"], "expires_at": row["expires_at"]}}


@app.get("/auth/magic")
async def magic_login(token: str):
    """One-time login link dari Telegram bot. Token valid 5 menit, sekali pakai."""
    from fastapi.responses import RedirectResponse, HTMLResponse as _HTML
    repo = TaskRepository(DB_PATH)
    user_id = repo.consume_magic_token(token)
    if not user_id:
        return _HTML("""
            <html><body style="font-family:sans-serif;text-align:center;padding:60px">
            <h2>⚠️ Link Tidak Valid</h2>
            <p>Link sudah digunakan atau sudah expired (5 menit).</p>
            <p>Kirim <code>/webapp</code> di Telegram untuk mendapatkan link baru.</p>
            </body></html>
        """, status_code=400)
    with get_db() as conn:
        row = conn.execute("SELECT username, password_hash FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        return _HTML("<html><body>User tidak ditemukan.</body></html>", status_code=400)
    jwt_token = create_token(user_id, row["username"], pwv=_pw_fingerprint(row["password_hash"]))
    # ?magic=1: SPA tanpa token di localStorage menukar cookie httpOnly ini jadi token
    # lewat POST /api/auth/refresh (cookie terkirim same-origin), lalu menghapus parameter.
    response = RedirectResponse(url="/?magic=1", status_code=302)
    response.set_cookie("token", jwt_token, httponly=True, max_age=JWT_EXPIRE_HOURS * 3600, samesite="lax")
    return response


# ── Task CRUD routes ──────────────────────────────────────────────────────────

@app.get("/api/tasks")
async def list_tasks(
    status: Optional[str] = None,
    priority: Optional[str] = None,
    quadrant: Optional[str] = None,
    project: Optional[str] = None,
    context: Optional[str] = None,
    include_done: bool = False,
    tag: str = "",
    user=Depends(get_current_user),
):
    uid = user["sub"]
    # Include personal tasks AND tasks in shared lists where user is owner/member
    access_clause = (
        "user_id = ? OR list_id IN ("
        "  SELECT id FROM shared_lists WHERE owner_id = ?"
        "  UNION SELECT list_id FROM list_members WHERE user_id = ?"
        ")"
    )
    clauses = [f"({access_clause})"]
    params = [uid, uid, uid]

    if status:
        clauses.append("gtd_status = ?")
        params.append(status)
    elif not include_done:
        clauses.append("gtd_status NOT IN ('done','archived')")

    if priority:
        clauses.append("priority = ?")
        params.append(priority.upper())
    if quadrant:
        clauses.append("quadrant = ?")
        params.append(quadrant.upper())
    if project:
        clauses.append("project = ?")
        params.append(project)
    if context:
        clauses.append("context = ? COLLATE NOCASE")
        params.append(context)
    if tag:
        tag_norm = tag.strip().lower()
        clauses.append(
            "id IN (SELECT et.entity_id FROM entity_tags et "
            "JOIN tags t ON t.id = et.tag_id "
            "WHERE et.entity_type = 'task' AND t.user_id = ? AND t.name = ?)"
        )
        params.extend([uid, tag_norm])

    where = " AND ".join(clauses)
    sql = f"SELECT * FROM tasks WHERE {where} ORDER BY priority, deadline"

    with get_db() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [task_row_to_dict(r) for r in rows]


@app.post("/api/tasks")
async def create_task(req: TaskCreate, background_tasks: BackgroundTasks, user=Depends(get_current_user)):
    uid = user["sub"]

    # Extract and strip #tags from title
    _tag_re = re.compile(r'#([a-zA-Z0-9_À-ɏ]+)')
    task_tags = [m.lower() for m in _tag_re.findall(req.title)]
    req.title = _tag_re.sub('', req.title).strip()
    if not req.title:
        raise HTTPException(status_code=400, detail="Judul tidak boleh kosong setelah strip tag")

    # Resolve parent task — inherit fields if not provided
    parent_id = req.parent_id
    inherited_pid = None
    if parent_id:
        with get_db() as conn:
            parent_row = conn.execute("SELECT * FROM tasks WHERE id = ?", (parent_id,)).fetchone()
        if not parent_row:
            raise HTTPException(status_code=404, detail="Parent task not found")
        # Inherit from parent if not explicitly provided
        if not req.list_id and parent_row["list_id"]:
            req.list_id = parent_row["list_id"]
        if not req.project and req.project_id is None and parent_row["project"]:
            req.project = parent_row["project"]
            inherited_pid = parent_row["project_id"]  # dipakai hanya bila scope sama
        if not req.context and parent_row["context"]:
            req.context = parent_row["context"]

    # Validate shared list access if list_id provided
    if req.list_id:
        repo = TaskRepository(DB_PATH)
        if not repo.is_list_member_or_owner(req.list_id, uid):
            raise HTTPException(status_code=403, detail="Not a member of this list")

    now = datetime.now().isoformat()
    deadline = None
    if req.deadline:
        d = parse_date(req.deadline)
        if d:
            deadline = d.isoformat()

    task_obj = Task(
        title=req.title,
        priority=Priority.from_str(req.priority),
        deadline=date.fromisoformat(deadline) if deadline else None,
    )
    quadrant = calculate_quadrant(task_obj).value

    # Recurrence
    recurrence_type = req.recurrence_type if req.recurrence_type in ("daily","weekly","monthly","weekdays") else None
    recurrence_days_json = None
    recurrence_end_date = None
    if recurrence_type:
        if recurrence_type == "weekly" and req.recurrence_days:
            recurrence_days_json = json.dumps([int(d) for d in req.recurrence_days if 0 <= int(d) <= 6])
        elif recurrence_type == "monthly" and req.recurrence_days:
            day_of_month = max(1, min(28, int(req.recurrence_days[0])))
            recurrence_days_json = json.dumps([day_of_month])
        recurrence_end_date = (date.today() + timedelta(days=90)).isoformat()

    with get_db() as conn:
        # Idempotensi retry sync (audit T11): POST ulang dengan client_id yang sama (respons hilang /
        # timeout) mengembalikan baris yang sudah ada — tanpa insert, tanpa notifikasi ulang.
        if req.client_id:
            dup = conn.execute(
                "SELECT * FROM tasks WHERE user_id = ? AND client_id = ?", (uid, req.client_id)
            ).fetchone()
            if dup:
                return task_row_to_dict(dup, conn)
        try:
            proj_id = None
            if inherited_pid:  # warisan parent: hanya bila project parent ada di scope task baru
                try:
                    proj_id, proj_name = repository.resolve_task_project(
                        conn, owner_id=uid, list_id=req.list_id, name=None,
                        project_id=inherited_pid, actor_id=uid)
                except repository.ProjectScopeError:
                    proj_id = None
            if not proj_id:
                req_pid = req.project_id
                if req_pid is not None and conn.execute(
                        "SELECT 1 FROM projects WHERE id = ?", (req_pid,)).fetchone() is None:
                    req_pid = None  # project_id tak dikenal (sudah dihapus): resolusi pakai teks
                proj_id, proj_name = repository.resolve_task_project(
                    conn, owner_id=uid, list_id=req.list_id, name=req.project,
                    project_id=req_pid, actor_id=uid)
        except repository.ProjectScopeError:
            raise HTTPException(status_code=400, detail="Project tidak berada di scope task")
        try:
            req_cid = req.context_id
            if req_cid is not None and conn.execute(
                    "SELECT 1 FROM contexts WHERE id = ?", (req_cid,)).fetchone() is None:
                req_cid = None  # context_id tak dikenal (sudah dihapus): resolusi pakai teks
            ctx_id, ctx_name = repository.resolve_task_context(
                conn, owner_id=uid, list_id=req.list_id, name=req.context,
                context_id=req_cid, actor_id=uid)
        except repository.ContextScopeError:
            raise HTTPException(status_code=400, detail="Tahap tidak berada di scope task")
        try:
            cur = conn.execute(
                """INSERT INTO tasks
                   (title, description, gtd_status, priority, quadrant,
                    project, project_id, context, context_id, deadline, waiting_for, user_id, list_id, assigned_to, parent_id,
                    recurrence_type, recurrence_days, recurrence_end_date,
                    created_at, updated_at, client_id, estimated_pomodoros)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (req.title, req.description, req.gtd_status, req.priority.upper(), quadrant,
                 proj_name, proj_id, ctx_name, ctx_id, deadline, req.waiting_for, uid, req.list_id, req.assigned_to, parent_id,
                 recurrence_type, recurrence_days_json, recurrence_end_date,
                 now, now, req.client_id, req.estimated_pomodoros),
            )
        except sqlite3.IntegrityError:
            # Race: request kembar menyisipkan (user_id, client_id) yang sama lebih dulu → ambil barisnya.
            dup = conn.execute(
                "SELECT * FROM tasks WHERE user_id = ? AND client_id = ?", (uid, req.client_id)
            ).fetchone() if req.client_id else None
            if not dup:
                raise
            return task_row_to_dict(dup, conn)
        task_id = cur.lastrowid
        if task_tags:
            _upsert_tags_for_entity(conn, task_id, uid, 'task', task_tags)
            conn.commit()
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()

    if req.list_id:
        actor = user.get("username", f"user#{uid}")
        background_tasks.add_task(
            _notify_members_bg, req.list_id, uid,
            f"➕ <b>{_esc_msg(actor)}</b> menambahkan task <b>{_esc_msg(req.title)}</b> ke shared list.",
            task_id=row["id"]
        )
    return task_row_to_dict(row)


@app.get("/api/tasks/{task_id}")
async def get_task(task_id: int, user=Depends(get_current_user)):
    with get_db() as conn:
        row = _can_access_task(conn, task_id, user["sub"])
    return task_row_to_dict(row)


@app.get("/api/tasks/{task_id}/tags")
async def get_task_tags(task_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        _can_access_task(conn, task_id, uid)
        rows = conn.execute("""
            SELECT t.id, t.name, t.color
            FROM tags t
            JOIN entity_tags et ON t.id = et.tag_id
            WHERE et.entity_type = 'task' AND et.entity_id = ? AND t.user_id = ?
            ORDER BY t.name ASC
        """, (task_id, uid)).fetchall()
        return [dict(r) for r in rows]


@app.delete("/api/tasks/{task_id}/tags/{tag_name}")
async def remove_task_tag(task_id: int, tag_name: str, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        _can_access_task(conn, task_id, uid, write=True)
        tag = conn.execute(
            "SELECT id FROM tags WHERE user_id = ? AND name = ?",
            (uid, tag_name.strip().lower())
        ).fetchone()
        if tag:
            conn.execute(
                "DELETE FROM entity_tags WHERE tag_id = ? AND entity_type = 'task' AND entity_id = ?",
                (tag["id"], task_id)
            )
            conn.commit()
    return {"ok": True}


@app.put("/api/tasks/{task_id}")
async def update_task(task_id: int, req: TaskUpdate, background_tasks: BackgroundTasks, user=Depends(get_current_user)):
    uid = user["sub"]

    _tag_re = re.compile(r'#([a-zA-Z0-9_À-ɏ]+)')
    task_tags = None
    if req.title is not None:
        task_tags = [m.lower() for m in _tag_re.findall(req.title)]
        req.title = _tag_re.sub('', req.title).strip()
        if not req.title:
            raise HTTPException(status_code=400, detail="Judul tidak boleh kosong setelah strip tag")

    with get_db() as conn:
        existing = _can_access_task(conn, task_id, uid, write=True)
        _check_base_rev(req, existing, lambda: task_row_to_dict(existing, conn))

        updates = {}
        if req.title is not None:
            updates["title"] = req.title
        if req.description is not None:
            updates["description"] = req.description
        if req.priority is not None:
            updates["priority"] = req.priority.upper()
        # Resolusi hanya bila project benar-benar berubah (null = tidak diubah, perilaku lama).
        # project_id non-null menang atas nama; selain itu bandingkan nama NOCASE dgn teks sekarang.
        stale_pid = (req.project_id is not None and req.project_id != existing["project_id"]
                     and conn.execute("SELECT 1 FROM projects WHERE id = ?",
                                      (req.project_id,)).fetchone() is None)
        if stale_pid:  # project_id basi (project sudah dihapus): anggap tidak berubah
            project_changed = False
        elif req.project_id is not None:
            project_changed = req.project_id != existing["project_id"]
        else:
            project_changed = req.project is not None and repository.project_text_changed(
                req.project, existing["project"])
        if project_changed:
            try:
                proj_id, proj_name = repository.resolve_task_project(
                    conn, owner_id=existing["user_id"], list_id=existing["list_id"],
                    name=req.project if "project_id" not in req.model_fields_set or req.project_id is None else None,
                    project_id=req.project_id, actor_id=uid)
            except repository.ProjectScopeError:
                raise HTTPException(status_code=400, detail="Project tidak berada di scope task")
            updates["project"] = proj_name
            updates["project_id"] = proj_id
        stale_cid = (req.context_id is not None and req.context_id != existing["context_id"]
                     and conn.execute("SELECT 1 FROM contexts WHERE id = ?",
                                      (req.context_id,)).fetchone() is None)
        if stale_cid:  # context_id basi (tahap sudah dihapus): seluruh perubahan context diabaikan
            context_changed = False
        elif req.context_id is not None:
            context_changed = req.context_id != existing["context_id"]
        else:
            context_changed = req.context is not None and repository.context_text_changed(
                req.context, existing["context"])
        if context_changed:
            try:
                ctx_id, ctx_name = repository.resolve_task_context(
                    conn, owner_id=existing["user_id"], list_id=existing["list_id"],
                    name=req.context if req.context_id is None else None,
                    context_id=req.context_id, actor_id=uid)
            except repository.ContextScopeError:
                raise HTTPException(status_code=400, detail="Tahap tidak berada di scope task")
            updates["context"] = ctx_name
            updates["context_id"] = ctx_id
        if req.waiting_for is not None:
            updates["waiting_for"] = req.waiting_for
        if req.gtd_status is not None:
            updates["gtd_status"] = req.gtd_status
            if req.gtd_status == "done":
                updates["completed_at"] = datetime.now().isoformat()
        if req.deadline is not None:
            if req.deadline == "" or req.deadline == "-":
                updates["deadline"] = None
            else:
                d = parse_date(req.deadline)
                updates["deadline"] = d.isoformat() if d else None
        if req.assigned_to is not None:
            updates["assigned_to"] = req.assigned_to if req.assigned_to != 0 else None
        if req.progress is not None:
            updates["progress"] = max(0, min(100, req.progress))
        if req.is_focused is not None:
            updates["is_focused"] = 1 if req.is_focused else 0
        if req.estimated_pomodoros is not None:
            updates["estimated_pomodoros"] = req.estimated_pomodoros

        if req.recurrence_renew:
            updates["recurrence_end_date"] = (date.today() + timedelta(days=90)).isoformat()
            updates["recurrence_notif_level"] = None
        elif "recurrence_type" in req.model_fields_set:
            if req.recurrence_type in ("daily","weekly","monthly","weekdays"):
                updates["recurrence_type"] = req.recurrence_type
                if req.recurrence_type == "weekly" and req.recurrence_days is not None:
                    updates["recurrence_days"] = json.dumps([int(d) for d in req.recurrence_days if 0 <= int(d) <= 6])
                elif req.recurrence_type == "monthly" and req.recurrence_days is not None:
                    day_of_month = max(1, min(28, int(req.recurrence_days[0])))
                    updates["recurrence_days"] = json.dumps([day_of_month])
                else:
                    updates["recurrence_days"] = None
                if not existing.get("recurrence_end_date"):
                    updates["recurrence_end_date"] = (date.today() + timedelta(days=90)).isoformat()
            else:
                updates["recurrence_type"] = None
                updates["recurrence_days"] = None
                updates["recurrence_end_date"] = None
                updates["recurrence_notif_level"] = None

        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")

        updates["updated_at"] = datetime.now().isoformat()

        pri = updates.get("priority", existing["priority"])
        dl_str = updates.get("deadline", existing["deadline"])
        dl = date.fromisoformat(dl_str) if dl_str else None
        task_obj = Task(title="", priority=Priority.from_str(pri), deadline=dl)
        updates["quadrant"] = calculate_quadrant(task_obj).value

        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [task_id]
        conn.execute(f"UPDATE tasks SET {set_clause} WHERE id = ?", values)

        if task_tags is not None:
            conn.execute("DELETE FROM entity_tags WHERE entity_type='task' AND entity_id=? AND user_id=?", (task_id, uid))
            if task_tags:
                _upsert_tags_for_entity(conn, task_id, uid, 'task', task_tags)
            conn.commit()

        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()

    if existing["list_id"]:
        actor = user.get("username", f"user#{uid}")
        new_assignee = updates.get("assigned_to", existing["assigned_to"])
        old_assignee = existing["assigned_to"]
        if "assigned_to" in updates and new_assignee != old_assignee and new_assignee:
            # Notify the newly assigned user directly
            background_tasks.add_task(
                _notify_members_bg, existing["list_id"], uid,
                f"📌 <b>{_esc_msg(actor)}</b> menugaskan task <b>{_esc_msg(existing['title'])}</b> kepadamu.",
                task_id=task_id
            )
        else:
            background_tasks.add_task(
                _notify_members_bg, existing["list_id"], uid,
                f"✏️ <b>{_esc_msg(actor)}</b> memperbarui task <b>{_esc_msg(existing['title'])}</b>.",
                task_id=task_id
            )
    return task_row_to_dict(row)


@app.post("/api/tasks/{task_id}/done")
async def mark_done(task_id: int, background_tasks: BackgroundTasks, user=Depends(get_current_user)):
    uid = user["sub"]
    now = datetime.now().isoformat()
    with get_db() as conn:
        row = _can_access_task(conn, task_id, uid, write=True)
        conn.execute(
            "UPDATE tasks SET gtd_status='done', completed_at=?, updated_at=? WHERE id=?",
            (now, now, task_id),
        )
        updated_row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()

    if row["list_id"]:
        actor = user.get("username", f"user#{uid}")
        background_tasks.add_task(
            _notify_members_bg, row["list_id"], uid,
            f"✅ <b>{_esc_msg(actor)}</b> menyelesaikan task <b>{_esc_msg(row['title'])}</b>.",
            task_id=task_id
        )
    return task_row_to_dict(updated_row)


@app.get("/api/tasks/{task_id}/child-tasks")
async def get_child_tasks(task_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        _can_access_task(conn, task_id, uid)
        rows = conn.execute(
            "SELECT * FROM tasks WHERE parent_id = ? ORDER BY priority, created_at",
            (task_id,),
        ).fetchall()
    return [task_row_to_dict(r) for r in rows]


@app.post("/api/tasks/{task_id}/focus")
async def toggle_focus(task_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        row = _can_access_task(conn, task_id, uid)
    repo = TaskRepository(DB_PATH)
    # For shared tasks, toggle by task_id only (no user_id restriction)
    with get_db() as conn:
        r = conn.execute("SELECT is_focused FROM tasks WHERE id = ?", (task_id,)).fetchone()
        new_val = 0 if r["is_focused"] else 1
        conn.execute("UPDATE tasks SET is_focused = ?, updated_at = ? WHERE id = ?",
                     (new_val, datetime.now().isoformat(), task_id))
        updated = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    return task_row_to_dict(updated)


@app.delete("/api/tasks/{task_id}")
async def delete_task(task_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        row = _can_access_task(conn, task_id, uid)
        # Only task owner or list owner can delete
        if row["user_id"] != uid and row["list_id"]:
            repo = TaskRepository(DB_PATH)
            if not repo.is_list_owner(row["list_id"], uid):
                raise HTTPException(status_code=403, detail="Hanya task owner atau list owner yang bisa menghapus")
        conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
    return {"ok": True, "id": task_id}


# ── Pomodoro log (ADR-021) ────────────────────────────────────────────────────

class PomodoroLogIn(BaseModel):
    client_id: str = Field(min_length=1, max_length=64)
    kind: Literal["session", "overtime"]
    pomodoros: int
    focus_seconds: int
    log_date: str
    ended_at: str

    @model_validator(mode="after")
    def _check_rules(self):
        if self.kind == "session":
            if self.pomodoros != 1 or not 1 <= self.focus_seconds <= 1500:
                raise ValueError("sesi: pomodoros=1, focus_seconds 1-1500")
        else:
            if (not 0 <= self.pomodoros <= 4 or not 60 <= self.focus_seconds <= 7200
                    or self.pomodoros != self.focus_seconds // 1500):
                raise ValueError("overtime: pomodoros 0-4, focus_seconds 60-7200, pomodoros = focus_seconds // 1500")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", self.log_date):
            raise ValueError("log_date harus YYYY-MM-DD")
        try:
            date.fromisoformat(self.log_date)
            datetime.fromisoformat(self.ended_at.replace("Z", "+00:00"))
        except ValueError:
            raise ValueError("log_date/ended_at tidak valid")
        return self


@app.post("/api/tasks/{task_id}/pomodoros")
async def log_pomodoro(task_id: int, req: PomodoroLogIn, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        _can_access_task(conn, task_id, uid)
        cur = conn.execute(
            """INSERT OR IGNORE INTO pomodoro_log
               (user_id, task_id, kind, pomodoros, focus_seconds, log_date, ended_at, client_id, created_at)
               VALUES (?,?,?,?,?,?,?,?,?)""",
            (uid, task_id, req.kind, req.pomodoros, req.focus_seconds, req.log_date,
             req.ended_at, req.client_id, datetime.now().isoformat()))
        inserted = cur.rowcount == 1
        if inserted and req.pomodoros:
            conn.execute("UPDATE tasks SET pomodoros_done = pomodoros_done + ? WHERE id = ?",
                         (req.pomodoros, task_id))
        log = conn.execute("SELECT id, task_id FROM pomodoro_log WHERE user_id = ? AND client_id = ?",
                           (uid, req.client_id)).fetchone()
        done = conn.execute("SELECT pomodoros_done FROM tasks WHERE id = ?", (task_id,)).fetchone()
    return {"id": log["id"], "task_id": task_id, "pomodoros_done": done["pomodoros_done"],
            "duplicate": not inserted}


# ── Recurring task endpoints ──────────────────────────────────────────────────

@app.post("/api/tasks/{task_id}/occurrences/{occurrence_date}/mark")
async def mark_occurrence(task_id: int, occurrence_date: str, req: RecurrenceMarkReq, user=Depends(get_current_user)):
    uid = user["sub"]
    if req.status not in ("done", "skipped"):
        raise HTTPException(status_code=400, detail="status harus 'done' atau 'skipped'")
    try:
        occ_date = date.fromisoformat(occurrence_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Format tanggal tidak valid (YYYY-MM-DD)")
    with get_db() as conn:
        task = _can_access_task(conn, task_id, uid)
        if not task["recurrence_type"]:
            raise HTTPException(status_code=400, detail="Task ini bukan recurring task")
        task_created = date.fromisoformat(task["created_at"][:10])
        task_end = date.fromisoformat(task["recurrence_end_date"])
        if occ_date < task_created or occ_date > task_end:
            raise HTTPException(status_code=400, detail="Tanggal di luar range recurring task")
        now = datetime.now().isoformat()
        conn.execute("""
            INSERT INTO recurring_exceptions (task_id, user_id, occurrence_date, status, created_at)
            VALUES (?,?,?,?,?)
            ON CONFLICT(task_id, occurrence_date) DO UPDATE SET status=excluded.status
        """, (task_id, uid, occurrence_date, req.status, now))
        row = conn.execute(
            "SELECT * FROM recurring_exceptions WHERE task_id=? AND occurrence_date=?",
            (task_id, occurrence_date)
        ).fetchone()
    return dict(row)


@app.get("/api/recurring/exceptions")
async def get_recurring_exceptions(
    from_date: str = Query(..., alias="from"),
    to_date: str = Query(..., alias="to"),
    user=Depends(get_current_user)
):
    uid = user["sub"]
    try:
        date.fromisoformat(from_date)
        date.fromisoformat(to_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Format tanggal tidak valid (YYYY-MM-DD)")
    with get_db() as conn:
        rows = conn.execute("""
            SELECT re.task_id, re.occurrence_date, re.status
            FROM recurring_exceptions re
            JOIN tasks t ON t.id = re.task_id
            WHERE re.user_id = ?
              AND re.occurrence_date >= ?
              AND re.occurrence_date <= ?
        """, (uid, from_date, to_date)).fetchall()
    result = {}
    for r in rows:
        key = str(r["task_id"])
        if key not in result:
            result[key] = []
        result[key].append({"occurrence_date": r["occurrence_date"], "status": r["status"]})
    return result


@app.post("/api/recurring/check-expiry")
async def check_recurring_expiry(background_tasks: BackgroundTasks, user=Depends(get_current_user)):
    uid = user["sub"]
    today = date.today()
    with get_db() as conn:
        tasks_rows = conn.execute("""
            SELECT id, title, recurrence_end_date, recurrence_notif_level, user_id
            FROM tasks
            WHERE user_id = ? AND recurrence_type IS NOT NULL AND recurrence_end_date IS NOT NULL
        """, (uid,)).fetchall()

    notified = []
    expiring_tasks = []

    # Batch lookup telegram_id — satu koneksi di luar loop
    with get_db() as conn:
        user_row = conn.execute("SELECT telegram_id FROM users WHERE id=?", (uid,)).fetchone()
    tg_id = user_row["telegram_id"] if user_row else None

    for t in tasks_rows:
        end_date = date.fromisoformat(t["recurrence_end_date"])
        days_left = (end_date - today).days
        current_level = t["recurrence_notif_level"]
        new_level = None
        msg = None
        tg_msg = None
        title_e = _esc_msg(t["title"])

        if days_left < 0 and current_level in (None, "week", "day"):
            new_level = "expired"
            msg = f'🔄 Recurring task "{title_e}" telah berakhir. Buat ulang jika masih diperlukan.'
            tg_msg = f'🔄 <b>Recurring Task Berakhir</b>\n"{title_e}" telah berakhir.\nBuka Alurik untuk membuat ulang.'
        elif days_left <= 1 and current_level == "week":
            new_level = "day"
            msg = f'⚠️ Recurring task "{title_e}" berakhir besok. Perpanjang jika masih diperlukan.'
            tg_msg = f'⚠️ <b>Recurring Task Reminder</b>\n"{title_e}" berakhir besok.\nBuka Alurik untuk memperpanjang.'
        elif days_left <= 7 and current_level is None:
            new_level = "week"
            msg = f'⚠️ Recurring task "{title_e}" akan berakhir dalam {days_left} hari. Perpanjang jika masih diperlukan.'
            tg_msg = f'⚠️ <b>Recurring Task Reminder</b>\n"{title_e}" akan berakhir dalam {days_left} hari.\nBuka Alurik untuk memperpanjang.'
        else:
            continue

        # Atomic update: only update if level hasn't changed since we read it
        with get_db() as conn:
            if current_level is None:
                conn.execute(
                    "UPDATE tasks SET recurrence_notif_level=? WHERE id=? AND recurrence_notif_level IS NULL",
                    (new_level, t["id"])
                )
            else:
                conn.execute(
                    "UPDATE tasks SET recurrence_notif_level=? WHERE id=? AND recurrence_notif_level=?",
                    (new_level, t["id"], current_level)
                )

        repo = TaskRepository(DB_PATH)
        repo.add_notification(uid, msg, task_id=t["id"])

        if _tg_bot and tg_id:
            background_tasks.add_task(_send_tg_message, tg_id, tg_msg)

        notified.append(new_level)
        expiring_tasks.append({"id": t["id"], "title": t["title"], "level": new_level, "days_left": days_left})

    return {"notified": notified, "tasks": expiring_tasks}


# ── Dashboard / summary ───────────────────────────────────────────────────────

@app.get("/api/summary")
async def get_summary(user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        by_status = {}
        for row in conn.execute("SELECT gtd_status, COUNT(*) as cnt FROM tasks WHERE user_id=? GROUP BY gtd_status", (uid,)):
            by_status[row["gtd_status"]] = row["cnt"]

        by_quad = {}
        for row in conn.execute(
            "SELECT quadrant, COUNT(*) as cnt FROM tasks WHERE user_id=? AND gtd_status NOT IN ('done','archived') GROUP BY quadrant",
            (uid,),
        ):
            by_quad[row["quadrant"]] = row["cnt"]

        overdue_count = conn.execute(
            "SELECT COUNT(*) as cnt FROM tasks WHERE user_id=? AND deadline < ? AND gtd_status NOT IN ('done','archived')",
            (uid, date.today().isoformat()),
        ).fetchone()["cnt"]

        total_active = sum(v for k, v in by_status.items() if k not in ("done", "archived"))
        total_done = by_status.get("done", 0)

        cutoff_7d = (date.today() - timedelta(days=7)).isoformat()
        done_last_7_days = conn.execute(
            "SELECT COUNT(*) as cnt FROM tasks WHERE user_id=? AND gtd_status='done' AND completed_at >= ?",
            (uid, cutoff_7d),
        ).fetchone()["cnt"]

    return {
        "by_status": by_status,
        "by_quadrant": by_quad,
        "overdue": overdue_count,
        "total_active": total_active,
        "total_done": total_done,
        "done_last_7_days": done_last_7_days,
        "date": date.today().isoformat(),
    }


class ProjectCreate(BaseModel):
    name: str
    list_id: Optional[int] = None


_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}\Z")


class ProjectPatch(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    archived: Optional[bool] = None


def _project_visible(conn, row, uid) -> bool:
    if row["list_id"] is None:
        return row["user_id"] == uid
    return conn.execute(
        "SELECT 1 FROM shared_lists WHERE id = ? AND owner_id = ? "
        "UNION SELECT 1 FROM list_members WHERE list_id = ? AND user_id = ?",
        (row["list_id"], uid, row["list_id"], uid)).fetchone() is not None


def _project_can_manage(conn, row, uid) -> bool:
    if row["list_id"] is None:
        return row["user_id"] == uid
    if row["created_by"] == uid:
        return True
    return conn.execute("SELECT 1 FROM shared_lists WHERE id = ? AND owner_id = ?",
                        (row["list_id"], uid)).fetchone() is not None


def _project_full(conn, row, uid) -> dict:
    cnt = conn.execute(
        "SELECT COUNT(*) FROM tasks WHERE project_id = ? AND gtd_status NOT IN ('done','archived')",
        (row["id"],)).fetchone()[0]
    # semua task project ini (status apa pun) = yang dikosongkan DELETE /api/projects/{id}
    total = conn.execute("SELECT COUNT(*) FROM tasks WHERE project_id = ?", (row["id"],)).fetchone()[0]
    return {
        "id": row["id"], "name": row["name"], "list_id": row["list_id"],
        "user_id": row["user_id"], "color": row["color"], "archived": bool(row["archived"]),
        "created_by": row["created_by"], "active_task_count": cnt, "task_count": total,
        "can_manage": _project_can_manage(conn, row, uid),
    }


def _require_ws_member(conn, list_id, uid):
    ok = conn.execute(
        "SELECT 1 FROM shared_lists WHERE id = ? AND owner_id = ? "
        "UNION SELECT 1 FROM list_members WHERE list_id = ? AND user_id = ?",
        (list_id, uid, list_id, uid)).fetchone()
    if ok is None:
        raise HTTPException(403, "Kamu bukan anggota list ini")


def _project_for_manage(conn, project_id, uid):
    row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
    if row is None or not _project_visible(conn, row, uid):
        raise HTTPException(404, "Project tidak ditemukan")
    if not _project_can_manage(conn, row, uid):
        raise HTTPException(403, "Hanya pembuat project atau owner workspace")
    return row


@app.get("/api/projects")
async def get_projects(list_id: Optional[int] = None, format: Optional[str] = None,
                       include_archived: int = 0, scope: Optional[str] = None,
                       user=Depends(get_current_user)):
    uid = user["sub"]
    if scope == "all" and format != "full":
        raise HTTPException(400, "scope=all hanya untuk format=full")
    with get_db() as conn:
        if scope == "all":
            arch = "" if include_archived else " AND archived = 0"
            rows = conn.execute(
                "SELECT * FROM projects WHERE ((list_id IS NULL AND user_id = ?) OR list_id IN ("
                "SELECT id FROM shared_lists WHERE owner_id = ? "
                "UNION SELECT list_id FROM list_members WHERE user_id = ?))" + arch +
                " ORDER BY name COLLATE NOCASE, id", (uid, uid, uid)).fetchall()
            return [_project_full(conn, r, uid) for r in rows]
        if list_id is not None:
            _require_ws_member(conn, list_id, uid)
            scope_sql, args = "list_id = ?", (list_id,)
        else:
            scope_sql, args = "user_id = ? AND list_id IS NULL", (uid,)
        arch = "" if (format == "full" and include_archived) else " AND archived = 0"
        rows = conn.execute(
            f"SELECT * FROM projects WHERE {scope_sql}{arch} ORDER BY name COLLATE NOCASE, id",
            args).fetchall()
        if format == "full":
            return [_project_full(conn, r, uid) for r in rows]
        return [r["name"] for r in rows]


@app.post("/api/projects")
async def create_project(body: ProjectCreate, user=Depends(get_current_user)):
    uid = user["sub"]
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Nama project tidak boleh kosong")
    with get_db() as conn:
        if body.list_id is not None:
            _require_ws_member(conn, body.list_id, uid)
        try:
            pid, _ = repository.resolve_task_project(
                conn, owner_id=uid, list_id=body.list_id, name=name,
                project_id=None, actor_id=uid)
        except repository.ProjectScopeError:
            raise HTTPException(403, "Kamu bukan anggota list ini")
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (pid,)).fetchone()
        return _project_full(conn, row, uid)


@app.patch("/api/projects/{project_id}")
async def update_project(project_id: int, body: ProjectPatch, user=Depends(get_current_user)):
    uid = user["sub"]
    fields = body.model_fields_set
    with get_db() as conn:
        row = _project_for_manage(conn, project_id, uid)
        now = datetime.now().isoformat()
        sets, args = [], []
        if "name" in fields and body.name is not None:
            new = body.name.strip()
            if not new:
                raise HTTPException(400, "Nama project tidak boleh kosong")
            if row["list_id"] is None:
                dup = conn.execute(
                    "SELECT 1 FROM projects WHERE user_id = ? AND list_id IS NULL "
                    "AND name = ? COLLATE NOCASE AND id <> ?", (row["user_id"], new, project_id)).fetchone()
            else:
                dup = conn.execute(
                    "SELECT 1 FROM projects WHERE list_id = ? AND name = ? COLLATE NOCASE AND id <> ?",
                    (row["list_id"], new, project_id)).fetchone()
            if dup:
                raise HTTPException(409, "Nama project sudah dipakai")
            sets.append("name = ?"); args.append(new)
            conn.execute("UPDATE tasks SET project = ?, updated_at = ? WHERE project_id = ?",
                         (new, now, project_id))
        if "color" in fields:
            if body.color is not None and not _COLOR_RE.match(body.color):
                raise HTTPException(400, "Warna harus format #rrggbb")
            sets.append("color = ?"); args.append(body.color)
        if "archived" in fields and body.archived is not None:
            sets.append("archived = ?"); args.append(1 if body.archived else 0)
        if sets:
            sets.append("updated_at = ?"); args.append(now)
            try:
                conn.execute(f"UPDATE projects SET {', '.join(sets)} WHERE id = ?", args + [project_id])
            except sqlite3.IntegrityError:
                raise HTTPException(409, "Nama project sudah dipakai")
        row = conn.execute("SELECT * FROM projects WHERE id = ?", (project_id,)).fetchone()
        return _project_full(conn, row, uid)


@app.delete("/api/projects/{project_id}")
async def delete_project(project_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        _project_for_manage(conn, project_id, uid)
        cur = conn.execute(
            "UPDATE tasks SET project_id = NULL, project = '', updated_at = ? WHERE project_id = ?",
            (datetime.now().isoformat(), project_id))
        conn.execute("DELETE FROM projects WHERE id = ?", (project_id,))
        return {"ok": True, "tasks_cleared": cur.rowcount}


class ContextCreate(BaseModel):
    name: str = Field(max_length=50)
    list_id: Optional[int] = None
    client_id: Optional[str] = Field(default=None, max_length=64)  # diterima, tidak disimpan (idempoten lewat nama)


class ContextPatch(BaseModel):
    name: Optional[str] = Field(default=None, max_length=50)
    color: Optional[str] = None
    archived: Optional[bool] = None


class ContextOrder(BaseModel):
    list_id: Optional[int] = None
    ids: list[int]


_CTX_404 = "Tahap tidak ditemukan"
_CTX_ORDER = "ORDER BY COALESCE(list_id, 0), position, name COLLATE NOCASE, id"


def _require_ws_member_404(conn, list_id, uid) -> None:
    ok = conn.execute(
        "SELECT 1 FROM shared_lists WHERE id = ? AND owner_id = ? "
        "UNION SELECT 1 FROM list_members WHERE list_id = ? AND user_id = ?",
        (list_id, uid, list_id, uid)).fetchone()
    if ok is None:
        raise HTTPException(404, _CTX_404)


def _context_full(conn, row, uid) -> dict:
    cnt = conn.execute(
        "SELECT COUNT(*) FROM tasks WHERE context_id = ? AND gtd_status NOT IN ('done','archived')",
        (row["id"],)).fetchone()[0]
    total = conn.execute("SELECT COUNT(*) FROM tasks WHERE context_id = ?", (row["id"],)).fetchone()[0]
    return {
        "id": row["id"], "name": row["name"], "list_id": row["list_id"],
        "user_id": row["user_id"], "position": row["position"], "color": row["color"],
        "archived": bool(row["archived"]), "created_by": row["created_by"],
        "active_task_count": cnt, "task_count": total,
        # baris contexts punya list_id/user_id/created_by yang sama dengan projects
        "can_manage": _project_can_manage(conn, row, uid),
        "updated_at": row["updated_at"],
    }


def _context_for_manage(conn, context_id, uid):
    row = conn.execute("SELECT * FROM contexts WHERE id = ?", (context_id,)).fetchone()
    # semua penolakan = 404 (spec §6), bukan oracle keberadaan
    if row is None or not _project_visible(conn, row, uid) or not _project_can_manage(conn, row, uid):
        raise HTTPException(404, _CTX_404)
    return row


def _ctx_taken() -> HTTPException:
    return HTTPException(409, detail={"code": "CONTEXT_NAME_TAKEN", "message": "Nama tahap sudah dipakai"})


@app.get("/api/contexts")
async def get_contexts(list_id: Optional[int] = None, format: Optional[str] = None,
                       include_archived: int = 0, scope: Optional[str] = None,
                       user=Depends(get_current_user)):
    uid = user["sub"]
    if scope == "all" and format != "full":
        raise HTTPException(400, "scope=all hanya untuk format=full")
    with get_db() as conn:
        if scope == "all":
            arch = "" if include_archived else " AND archived = 0"
            rows = conn.execute(
                "SELECT * FROM contexts WHERE ((list_id IS NULL AND user_id = ?) OR list_id IN ("
                "SELECT id FROM shared_lists WHERE owner_id = ? "
                "UNION SELECT list_id FROM list_members WHERE user_id = ?))" + arch +
                " " + _CTX_ORDER, (uid, uid, uid)).fetchall()
            return [_context_full(conn, r, uid) for r in rows]
        if list_id is not None:
            _require_ws_member_404(conn, list_id, uid)
            scope_sql, args = "list_id = ?", (list_id,)
        else:
            scope_sql, args = "user_id = ? AND list_id IS NULL", (uid,)
        arch = "" if (format == "full" and include_archived) else " AND archived = 0"
        rows = conn.execute(
            f"SELECT * FROM contexts WHERE {scope_sql}{arch} {_CTX_ORDER}", args).fetchall()
        if format == "full":
            return [_context_full(conn, r, uid) for r in rows]
        return [r["name"] for r in rows]


@app.post("/api/contexts")
async def create_context(body: ContextCreate, user=Depends(get_current_user)):
    uid = user["sub"]
    name = body.name.strip()
    if not name:
        raise HTTPException(400, "Nama tahap tidak boleh kosong")
    with get_db() as conn:
        if body.list_id is not None:
            _require_ws_member_404(conn, body.list_id, uid)
        try:
            cid, _ = repository.resolve_task_context(
                conn, owner_id=uid, list_id=body.list_id, name=name,
                context_id=None, actor_id=uid)
        except repository.ContextScopeError:
            raise HTTPException(404, _CTX_404)
        row = conn.execute("SELECT * FROM contexts WHERE id = ?", (cid,)).fetchone()
        return _context_full(conn, row, uid)


# IMPORTANT: /api/contexts/order didaftarkan sebelum rute berparameter /api/contexts/{context_id}
@app.put("/api/contexts/order")
async def reorder_contexts(body: ContextOrder, user=Depends(get_current_user)):
    uid = user["sub"]
    stale = HTTPException(409, detail={"code": "CONTEXT_ORDER_STALE",
                                       "message": "Urutan tahap sudah berubah, muat ulang"})
    with get_db() as conn:
        if body.list_id is not None:
            _require_ws_member_404(conn, body.list_id, uid)
            scope_sql, args = "list_id = ?", (body.list_id,)
        else:
            scope_sql, args = "user_id = ? AND list_id IS NULL", (uid,)
        rows = conn.execute(
            f"SELECT * FROM contexts WHERE {scope_sql} AND archived = 0 {_CTX_ORDER}", args).fetchall()
        if len(set(body.ids)) != len(body.ids) or sorted(body.ids) != sorted(r["id"] for r in rows):
            raise stale
        old_pos = {r["id"]: i for i, r in enumerate(rows)}
        by_id = {r["id"]: r for r in rows}
        changed = [cid for i, cid in enumerate(body.ids) if old_pos[cid] != i]
        for cid in changed:  # hak kelola untuk setiap context yang posisinya berubah
            if not _project_can_manage(conn, by_id[cid], uid):
                raise HTTPException(404, _CTX_404)
        now = datetime.now().isoformat()
        moved = set(changed)
        for i, cid in enumerate(body.ids):
            if cid in moved:
                conn.execute("UPDATE contexts SET position = ?, updated_at = ? WHERE id = ?", (i, now, cid))
            elif by_id[cid]["position"] != i:  # renormalisasi padat saja; updated_at tak disentuh
                conn.execute("UPDATE contexts SET position = ? WHERE id = ?", (i, cid))
        out = conn.execute(
            f"SELECT * FROM contexts WHERE {scope_sql} AND archived = 0 {_CTX_ORDER}", args).fetchall()
        return {"ok": True, "contexts": [_context_full(conn, r, uid) for r in out]}


@app.patch("/api/contexts/{context_id}")
async def update_context(context_id: int, body: ContextPatch, user=Depends(get_current_user)):
    uid = user["sub"]
    fields = body.model_fields_set
    with get_db() as conn:
        row = _context_for_manage(conn, context_id, uid)
        now = datetime.now().isoformat()
        sets, args = [], []
        if "name" in fields and body.name is not None:
            new = body.name.strip()
            if not new:
                raise HTTPException(400, "Nama tahap tidak boleh kosong")
            if new != row["name"]:  # nama persis sama: bukan rename, jangan sentuh task terkait
                if row["list_id"] is None:
                    dup = conn.execute(
                        "SELECT 1 FROM contexts WHERE user_id = ? AND list_id IS NULL "
                        "AND name = ? COLLATE NOCASE AND id <> ?", (row["user_id"], new, context_id)).fetchone()
                else:
                    dup = conn.execute(
                        "SELECT 1 FROM contexts WHERE list_id = ? AND name = ? COLLATE NOCASE AND id <> ?",
                        (row["list_id"], new, context_id)).fetchone()
                if dup:
                    raise _ctx_taken()
                sets.append("name = ?"); args.append(new)
                conn.execute("UPDATE tasks SET context = ?, updated_at = ? WHERE context_id = ?",
                             (new, now, context_id))
        if "color" in fields:
            if body.color is not None and not _COLOR_RE.match(body.color):
                raise HTTPException(400, "Warna harus format #rrggbb")
            sets.append("color = ?"); args.append(body.color)
        if "archived" in fields and body.archived is not None:
            sets.append("archived = ?"); args.append(1 if body.archived else 0)
        if sets:
            sets.append("updated_at = ?"); args.append(now)
            try:
                conn.execute(f"UPDATE contexts SET {', '.join(sets)} WHERE id = ?", args + [context_id])
            except sqlite3.IntegrityError:
                raise _ctx_taken()
        row = conn.execute("SELECT * FROM contexts WHERE id = ?", (context_id,)).fetchone()
        return _context_full(conn, row, uid)


@app.delete("/api/contexts/{context_id}")
async def delete_context(context_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        _context_for_manage(conn, context_id, uid)
        cur = conn.execute(
            "UPDATE tasks SET context_id = NULL, context = '', updated_at = ? WHERE context_id = ?",
            (datetime.now().isoformat(), context_id))
        conn.execute("DELETE FROM contexts WHERE id = ?", (context_id,))
        return {"ok": True, "tasks_cleared": cur.rowcount}


# ── Recalculate Eisenhower (manual trigger) ───────────────────────────────────

@app.post("/api/recalculate")
async def recalculate_eisenhower(user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM tasks WHERE user_id = ? AND gtd_status NOT IN ('done','archived')",
            (uid,),
        ).fetchall()
        changed = 0
        for row in rows:
            dl = date.fromisoformat(row["deadline"]) if row["deadline"] else None
            task_obj = Task(priority=Priority.from_str(row["priority"]), deadline=dl)
            new_q = calculate_quadrant(task_obj).value
            if new_q != row["quadrant"]:
                # Kuadran = field turunan: tidak mem-bump updated_at (audit K2, lihat repository.update_quadrant)
                conn.execute("UPDATE tasks SET quadrant=? WHERE id=?", (new_q, row["id"]))
                changed += 1
    return {"changed": changed, "total": len(rows)}


# ── Subtask API routes ─────────────────────────────────────────────────────

class SubtaskCreate(BaseModel):
    title: str = Field(min_length=1)
    client_id: Optional[str] = None

@app.get("/api/tasks/{task_id}/subtasks")
async def get_subtasks(task_id: int, user=Depends(get_current_user)):
    with get_db() as conn:
        _can_access_task(conn, task_id, user["sub"])
    repo = TaskRepository(DB_PATH)
    return repo.get_subtasks(task_id)

@app.post("/api/tasks/{task_id}/subtasks")
async def create_subtask(task_id: int, req: SubtaskCreate, background_tasks: BackgroundTasks, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        row = _can_access_task(conn, task_id, uid, write=True)
    repo = TaskRepository(DB_PATH)
    result = repo.add_subtask(task_id, req.title, client_id=req.client_id)
    if row["list_id"]:
        actor = user.get("username", f"user#{uid}")
        background_tasks.add_task(
            _notify_members_bg, row["list_id"], uid,
            f"📝 <b>{_esc_msg(actor)}</b> menambah subtask di task <b>{_esc_msg(row['title'])}</b>.",
            task_id=task_id
        )
    return result

@app.post("/api/subtasks/{subtask_id}/toggle")
async def toggle_subtask(subtask_id: int, user=Depends(get_current_user)):
    repo = TaskRepository(DB_PATH)
    with get_db() as conn:
        sub = conn.execute("SELECT task_id FROM subtasks WHERE id = ?", (subtask_id,)).fetchone()
        if not sub:
            raise HTTPException(status_code=404, detail="Subtask not found")
        _can_access_task(conn, sub["task_id"], user["sub"])
    result = repo.toggle_subtask(subtask_id)
    if not result:
        raise HTTPException(status_code=404, detail="Subtask not found")
    return result

@app.delete("/api/subtasks/{subtask_id}")
async def delete_subtask(subtask_id: int, user=Depends(get_current_user)):
    repo = TaskRepository(DB_PATH)
    with get_db() as conn:
        sub = conn.execute("SELECT task_id FROM subtasks WHERE id = ?", (subtask_id,)).fetchone()
        if not sub:
            raise HTTPException(status_code=404, detail="Subtask not found")
        _can_access_task(conn, sub["task_id"], user["sub"], write=True)
    repo.delete_subtask(subtask_id)
    return {"ok": True}


# ── Task Notes API routes ──────────────────────────────────────────────────

class NoteCreate(BaseModel):
    content: str = Field(min_length=1)
    client_id: Optional[str] = None

@app.get("/api/tasks/{task_id}/notes")
async def get_notes(task_id: int, user=Depends(get_current_user)):
    with get_db() as conn:
        _can_access_task(conn, task_id, user["sub"])
    repo = TaskRepository(DB_PATH)
    return repo.get_notes_with_author(task_id)

@app.post("/api/tasks/{task_id}/notes")
async def create_note(task_id: int, req: NoteCreate, background_tasks: BackgroundTasks, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        row = _can_access_task(conn, task_id, uid, write=True)
    repo = TaskRepository(DB_PATH)
    note = repo.add_note_with_author(task_id, req.content, uid, client_id=req.client_id)
    if row["list_id"]:
        actor = user.get("username", f"user#{uid}")
        background_tasks.add_task(
            _notify_members_bg, row["list_id"], uid,
            f"💬 <b>{_esc_msg(actor)}</b> menambahkan komentar di task <b>{_esc_msg(row['title'])}</b>:\n{_esc_msg(req.content[:100])}",
            task_id=task_id
        )
    return note

@app.delete("/api/notes/{note_id}")
async def delete_note(note_id: int, user=Depends(get_current_user)):
    repo = TaskRepository(DB_PATH)
    with get_db() as conn:
        note = conn.execute("SELECT task_id FROM task_notes WHERE id = ?", (note_id,)).fetchone()
        if not note:
            raise HTTPException(status_code=404, detail="Note not found")
        _can_access_task(conn, note["task_id"], user["sub"], write=True)
    repo.delete_note(note_id)
    return {"ok": True}


# ── Attachment API routes ──────────────────────────────────────────────────

@app.get("/api/tasks/{task_id}/attachments")
async def get_attachments(task_id: int, user=Depends(get_current_user)):
    with get_db() as conn:
        _can_access_task(conn, task_id, user["sub"])
    repo = TaskRepository(DB_PATH)
    return repo.get_attachments(task_id)

@app.post("/api/tasks/{task_id}/attachments")
async def upload_attachment(task_id: int, background_tasks: BackgroundTasks, file: UploadFile = FastAPIFile(...), user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        task_row = _can_access_task(conn, task_id, uid, write=True)

    # Read file
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail=f"File terlalu besar. Maks {MAX_FILE_SIZE // (1024*1024)}MB")

    original_name = file.filename or "file"
    ext = Path(original_name).suffix or ""
    stored_name = f"{uuid.uuid4().hex}{ext}"
    stored_path = os.path.join(UPLOAD_DIR, stored_name)

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    with open(stored_path, "wb") as f:
        f.write(content)

    mime_type = _safe_upload_mime(
        file.content_type or mimetypes.guess_type(original_name)[0] or "application/octet-stream")

    repo = TaskRepository(DB_PATH)
    result = repo.add_attachment(task_id, stored_name, original_name, len(content), mime_type)
    if task_row["list_id"]:
        now_str = datetime.now().isoformat()
        with get_db() as conn:
            _ensure_workspace_files_table(conn)
            conn.execute(
                """INSERT INTO workspace_files
                   (list_id, user_id, filename, original_name, file_size, mime_type, source, task_id, is_deleted, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, 'task', ?, 0, ?)""",
                (task_row["list_id"], uid, stored_name, original_name, len(content), mime_type, task_id, now_str)
            )
            conn.commit()
        actor = user.get("username", f"user#{uid}")
        background_tasks.add_task(
            _notify_members_bg, task_row["list_id"], uid,
            f"📎 <b>{_esc_msg(actor)}</b> mengunggah file <b>{_esc_msg(original_name)}</b> di task <b>{_esc_msg(task_row['title'])}</b>.",
            task_id=task_id
        )
    return result

@app.delete("/api/attachments/{attachment_id}")
async def delete_attachment(attachment_id: int, user=Depends(get_current_user)):
    repo = TaskRepository(DB_PATH)
    with get_db() as conn:
        att = conn.execute("SELECT task_id, filename FROM task_attachments WHERE id = ?", (attachment_id,)).fetchone()
        if not att:
            raise HTTPException(status_code=404, detail="Attachment not found")
        _can_access_task(conn, att["task_id"], user["sub"], write=True)
        task_row = conn.execute("SELECT list_id FROM tasks WHERE id = ?", (att["task_id"],)).fetchone()
    info = repo.delete_attachment(attachment_id)
    if info:
        filepath = os.path.join(UPLOAD_DIR, info["filename"])
        if os.path.exists(filepath):
            os.unlink(filepath)
        if task_row and task_row["list_id"]:
            with get_db() as conn:
                _ensure_workspace_files_table(conn)
                conn.execute(
                    "UPDATE workspace_files SET is_deleted = 1 WHERE list_id = ? AND filename = ?",
                    (task_row["list_id"], info["filename"])
                )
    return {"ok": True}

@app.get("/api/attachments/{attachment_id}/download")
async def download_attachment(attachment_id: int, user=Depends(get_current_user_sse)):
    with get_db() as conn:
        att = conn.execute("SELECT * FROM task_attachments WHERE id = ?", (attachment_id,)).fetchone()
        if not att:
            raise HTTPException(status_code=404, detail="Attachment not found")
        _can_access_task(conn, att["task_id"], user["sub"])

    filepath = os.path.join(UPLOAD_DIR, att["filename"])
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="File not found on disk")

    # Baris lama bisa menyimpan tipe yang bisa dirender (sebelum _safe_upload_mime) → disaring juga saat disajikan.
    return FileResponse(filepath, filename=att["original_name"], media_type=_safe_upload_mime(att["mime_type"]),
                        headers={"X-Content-Type-Options": "nosniff"})


# ── Collaborators (mention autocomplete) ──────────────────────────────────────

@app.get("/api/collaborators")
async def get_collaborators(user=Depends(get_current_user)):
    """All unique users across all shared lists the current user is in, excluding self."""
    uid = user["sub"]
    with get_db() as conn:
        list_rows = conn.execute(
            "SELECT id FROM shared_lists WHERE owner_id = ? "
            "UNION SELECT list_id FROM list_members WHERE user_id = ?",
            (uid, uid),
        ).fetchall()
        list_ids = [r["id"] for r in list_rows]
        if not list_ids:
            return []
        ph = ",".join("?" * len(list_ids))
        owners = conn.execute(
            f"SELECT DISTINCT u.id, u.username, u.display_name FROM shared_lists sl "
            f"JOIN users u ON u.id = sl.owner_id WHERE sl.id IN ({ph}) AND u.id != ?",
            list_ids + [uid],
        ).fetchall()
        members = conn.execute(
            f"SELECT DISTINCT u.id, u.username, u.display_name FROM list_members lm "
            f"JOIN users u ON u.id = lm.user_id WHERE lm.list_id IN ({ph}) AND u.id != ?",
            list_ids + [uid],
        ).fetchall()
    seen = set()
    result = []
    for r in owners + members:
        if r["id"] not in seen:
            seen.add(r["id"])
            result.append(dict(r))
    return result


# ── Notifications API ─────────────────────────────────────────────────────────

@app.get("/api/notifications")
async def get_notifications(user=Depends(get_current_user)):
    repo = TaskRepository(DB_PATH)
    return repo.get_notifications(user["sub"], limit=30)


@app.get("/api/notifications/count")
async def get_unread_count(user=Depends(get_current_user)):
    repo = TaskRepository(DB_PATH)
    return {"unread": repo.get_unread_count(user["sub"])}


@app.post("/api/notifications/read")
async def mark_read(user=Depends(get_current_user)):
    repo = TaskRepository(DB_PATH)
    repo.mark_notifications_read(user["sub"])
    return {"ok": True}


# ── Shared Lists API ──────────────────────────────────────────────────────────

@app.get("/api/lists")
async def get_lists(user=Depends(get_current_user)):
    repo = TaskRepository(DB_PATH)
    return repo.get_lists_for_user(user["sub"])


@app.post("/api/lists")
async def create_list(req: SharedListCreate, user=Depends(get_current_user)):
    repo = TaskRepository(DB_PATH)
    return repo.create_shared_list(req.name, user["sub"])


# IMPORTANT: /api/lists/join must be defined before /api/lists/{list_id}
@app.post("/api/lists/join")
async def join_list_by_code(req: JoinListReq, user=Depends(get_current_user)):
    uid = user["sub"]
    repo = TaskRepository(DB_PATH)
    st = repo.invite_status(req.code)
    if st["status"] == "full" and repo.is_list_member_or_owner(st["list_id"], uid):
        # kirim ganda pada link sekali pakai: penjelasan yang tepat adalah "sudah anggota"
        detail = ("Kamu adalah owner list ini." if repo.is_list_owner(st["list_id"], uid)
                  else "Kamu sudah menjadi anggota list ini.")
        raise HTTPException(status_code=400, detail=detail)
    if st["status"] != "ok":
        raise HTTPException(status_code=400, detail=_INVITE_ERRORS[st["status"]])
    list_id = st["list_id"]
    lst = repo.get_shared_list(list_id)
    if not lst:
        raise HTTPException(status_code=404, detail="List tidak ditemukan.")
    if lst["owner_id"] == uid:
        raise HTTPException(status_code=400, detail="Kamu adalah owner list ini.")
    if repo.is_list_member_or_owner(list_id, uid):
        raise HTTPException(status_code=400, detail="Kamu sudah menjadi anggota list ini.")
    # Pakai kuota + tambah anggota dalam satu transaksi; sudah anggota -> rollback (kuota utuh).
    res = repo.join_list_via_invite(req.code, uid)
    if res["status"] == "owner":
        raise HTTPException(status_code=400, detail="Kamu adalah owner list ini.")
    if res["status"] == "already_member" or (
            res["status"] != "ok" and repo.is_list_member_or_owner(list_id, uid)):
        raise HTTPException(status_code=400, detail="Kamu sudah menjadi anggota list ini.")
    if res["status"] != "ok":
        st = repo.invite_status(req.code)
        raise HTTPException(status_code=400, detail=_INVITE_ERRORS.get(st["status"], _INVITE_ERRORS["missing"]))
    # Notify owner
    with get_db() as conn:
        owner = conn.execute(
            "SELECT telegram_id FROM users WHERE id = ?", (lst["owner_id"],)
        ).fetchone()
    if owner and owner["telegram_id"] and _tg_bot:
        try:
            joiner = user.get("username", f"user#{uid}")
            _spawn_invite_dm(_tg_bot.send_message(
                chat_id=owner["telegram_id"],
                text=f"👥 <b>{_esc_msg(joiner)}</b> bergabung ke shared list <b>{_esc_msg(lst['name'])}</b>.",
                parse_mode="HTML",
            ))
        except Exception:
            pass
    return {"ok": True, "list_id": list_id, "list_name": lst["name"]}


@app.put("/api/lists/pins/order")
async def reorder_workspace_pins(req: PinOrderReq, user=Depends(get_current_user)):
    if not TaskRepository(DB_PATH).reorder_workspace_pins(user["sub"], req.list_ids):
        raise HTTPException(status_code=409, detail={
            "code": "PIN_ORDER_MISMATCH", "message": "Urutan pin sudah berubah di perangkat lain"})
    return {"ok": True, "list_ids": req.list_ids}


@app.get("/api/lists/preview/{code}")
async def preview_invite_code(code: str, user=Depends(get_current_user)):
    """Preview list info from an invite code without consuming it."""
    st = TaskRepository(DB_PATH).invite_status(code)
    if st["status"] != "ok":
        raise HTTPException(status_code=400, detail=_INVITE_ERRORS[st["status"]])
    with get_db() as conn:
        row = conn.execute(
            "SELECT li.list_id, li.expires_at, sl.name, "
            "COALESCE(NULLIF(u.display_name, ''), u.username) AS owner_name, "
            "1 + (SELECT COUNT(*) FROM list_members lm WHERE lm.list_id = sl.id) AS member_count "
            "FROM list_invites li "
            "JOIN shared_lists sl ON sl.id = li.list_id "
            "LEFT JOIN users u ON u.id = sl.owner_id WHERE li.code = ?",
            (code,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=400, detail=_INVITE_ERRORS["missing"])
    return {"list_id": row["list_id"], "list_name": row["name"], "expires_at": _iso_with_offset(row["expires_at"]),
            "owner_name": row["owner_name"], "member_count": row["member_count"]}


@app.get("/api/lists/{list_id}")
async def get_list(list_id: int, user=Depends(get_current_user)):
    repo = TaskRepository(DB_PATH)
    lst = repo.get_shared_list(list_id)
    if not lst:
        raise HTTPException(status_code=404, detail="List not found")
    if not repo.is_list_member_or_owner(list_id, user["sub"]):
        raise HTTPException(status_code=403, detail="Not a member of this list")
    members = [{**m, "joined_at": _iso_with_offset(m.get("joined_at"))}
               for m in repo.get_list_members(list_id)]
    # Include owner info
    with get_db() as conn:
        owner = conn.execute(
            "SELECT id, username, display_name FROM users WHERE id = ?", (lst["owner_id"],)
        ).fetchone()
    return {**lst, "members": members, "owner": dict(owner) if owner else None}


@app.patch("/api/lists/{list_id}")
async def patch_list(list_id: int, req: WorkspacePatch, user=Depends(get_current_user)):
    import workspace_identity as wi
    uid = user["sub"]
    repo = TaskRepository(DB_PATH)
    if not repo.get_shared_list(list_id):
        raise HTTPException(status_code=404, detail="List not found")
    if not repo.is_list_owner(list_id, uid):
        raise HTTPException(status_code=403, detail="Hanya owner yang bisa mengubah workspace.")
    sent = req.model_fields_set
    fields: dict = {}
    try:
        if "name" in sent:
            name = (req.name or "").strip()
            if not 1 <= len(name) <= 100:
                raise ValueError("Nama harus 1–100 karakter")
            fields["name"] = name
        if "description" in sent:
            fields["description"] = wi.normalize_description(req.description)
        if "color_idx" in sent:
            fields["color_idx"] = wi.normalize_color_idx(req.color_idx)
        if "avatar" in sent:
            fields["avatar"] = wi.normalize_avatar(req.avatar)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    if repo.update_workspace_identity(list_id, uid, fields) is None:
        raise HTTPException(status_code=403, detail="Hanya owner yang bisa mengubah workspace.")
    row = next((x for x in repo.get_lists_for_user(uid) if x["id"] == list_id), None)
    if row is None:  # workspace terhapus di tengah permintaan
        raise HTTPException(status_code=404, detail="Workspace tidak ditemukan")
    return row


@app.get("/api/lists/{list_id}/members")
async def get_list_members_for_assign(list_id: int, user=Depends(get_current_user)):
    """Members of a specific list for assignee dropdown — includes self, owner, and members."""
    uid = user["sub"]
    repo = TaskRepository(DB_PATH)
    if not repo.is_list_member_or_owner(list_id, uid):
        raise HTTPException(status_code=403, detail="Not a member of this list")
    with get_db() as conn:
        self_row = conn.execute(
            "SELECT id, username, display_name FROM users WHERE id = ?", (uid,)
        ).fetchone()
        owner_row = conn.execute(
            "SELECT u.id, u.username, u.display_name FROM shared_lists sl "
            "JOIN users u ON u.id = sl.owner_id WHERE sl.id = ?", (list_id,)
        ).fetchone()
        member_rows = conn.execute(
            "SELECT u.id, u.username, u.display_name FROM list_members lm "
            "JOIN users u ON u.id = lm.user_id WHERE lm.list_id = ? ORDER BY lm.joined_at",
            (list_id,)
        ).fetchall()
    seen = set()
    result = []
    for row in ([self_row, owner_row] + list(member_rows)):
        if row and row["id"] not in seen:
            seen.add(row["id"])
            d = dict(row)
            d["is_self"] = (row["id"] == uid)
            result.append(d)
    return result


@app.delete("/api/lists/{list_id}")
async def delete_list(list_id: int, user=Depends(get_current_user)):
    repo = TaskRepository(DB_PATH)
    deleted = repo.delete_shared_list(list_id, user["sub"])
    if not deleted:
        raise HTTPException(status_code=404, detail="List not found or not owner")
    return {"ok": True}


@app.delete("/api/lists/{list_id}/leave")
async def leave_list(list_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    repo = TaskRepository(DB_PATH)
    lst = repo.get_shared_list(list_id)
    if not lst:
        raise HTTPException(status_code=404, detail="List not found")
    if lst["owner_id"] == uid:
        raise HTTPException(status_code=400, detail="Owner tidak bisa leave — gunakan delete list")
    removed = repo.remove_list_member(list_id, uid)
    if not removed:
        raise HTTPException(status_code=400, detail="Kamu bukan anggota list ini")
    return {"ok": True}


@app.delete("/api/lists/{list_id}/members/{member_id}")
async def remove_member(list_id: int, member_id: int, user=Depends(get_current_user)):
    repo = TaskRepository(DB_PATH)
    if not repo.is_list_owner(list_id, user["sub"]):
        raise HTTPException(status_code=403, detail="Hanya owner yang bisa menghapus anggota")
    removed = repo.remove_list_member(list_id, member_id)
    if not removed:
        raise HTTPException(status_code=404, detail="Member not found")
    return {"ok": True}


@app.put("/api/lists/{list_id}/pin")
async def pin_workspace(list_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    repo = TaskRepository(DB_PATH)
    if not repo.is_list_member_or_owner(list_id, uid):
        raise HTTPException(status_code=404, detail="List not found")
    try:
        position = repo.pin_workspace(uid, list_id)
    except repository.PinLimitError:
        raise HTTPException(status_code=409, detail={"code": "PIN_LIMIT", "message": "Maksimal 5 workspace di-pin"})
    return {"ok": True, "pinned": True, "pin_position": position}


@app.delete("/api/lists/{list_id}/pin")
async def unpin_workspace(list_id: int, user=Depends(get_current_user)):
    TaskRepository(DB_PATH).unpin_workspace(user["sub"], list_id)
    return {"ok": True, "pinned": False}


@app.post("/api/lists/{list_id}/invite")
async def invite_to_list(list_id: int, req: InviteUserReq, user=Depends(get_current_user)):
    uid = user["sub"]
    repo = TaskRepository(DB_PATH)
    if not repo.is_list_owner(list_id, uid):
        raise HTTPException(status_code=403, detail="Hanya owner yang bisa mengundang anggota")

    # Find user by username
    target = repo.get_user_by_username(req.username)
    if not target:
        raise HTTPException(status_code=404, detail=f"User '{req.username}' tidak ditemukan")
    if target["id"] == uid:
        raise HTTPException(status_code=400, detail="Tidak bisa mengundang diri sendiri")

    lst = repo.get_shared_list(list_id)
    if not lst:
        raise HTTPException(status_code=404, detail="List not found")

    if repo.is_list_member_or_owner(list_id, target["id"]):
        raise HTTPException(status_code=400, detail=f"User '{req.username}' sudah menjadi anggota")

    try:
        inv = repo.create_workspace_invitation(list_id, uid, target["id"])
    except repository.AlreadyMember:
        raise HTTPException(status_code=400, detail=f"User '{req.username}' sudah menjadi anggota")
    except repository.InvitationExists:
        raise HTTPException(status_code=409, detail=f"Undangan untuk @{req.username} sudah dikirim")
    _spawn_invite_dm(_send_invitation_telegram(inv))
    return {
        "ok": True,
        "invitation": {
            "id": inv["id"],
            "invitee": {"id": target["id"], "username": target["username"],
                        "display_name": target["display_name"]},
            "created_at": _iso_with_offset(inv["created_at"]),
        },
    }


async def _send_invitation_telegram(invitation: dict) -> None:
    """DM Telegram undangan workspace dengan tombol Terima/Tolak; galat hanya di-log."""
    if not _tg_bot:
        return
    try:
        repo = TaskRepository(DB_PATH)
        target = repo.get_user_by_id(invitation["invitee_id"])
        if not target or not target.get("telegram_id"):
            return
        inviter = repo.get_user_by_id(invitation["inviter_id"]) or {}
        lst = repo.get_shared_list(invitation["list_id"]) or {}
        inviter_name = inviter.get("display_name") or inviter.get("username") or "Seseorang"
        from telegram import InlineKeyboardButton, InlineKeyboardMarkup
        kb = InlineKeyboardMarkup([[
            InlineKeyboardButton("Terima", callback_data=f"inv_acc_{invitation['id']}"),
            InlineKeyboardButton("Tolak", callback_data=f"inv_dec_{invitation['id']}"),
        ]])
        await _tg_bot.send_message(
            chat_id=target["telegram_id"],
            text=f"{_esc_msg(inviter_name)} mengundangmu ke workspace <b>{_esc_msg(lst.get('name', ''))}</b>.",
            parse_mode="HTML",
            reply_markup=kb,
        )
    except Exception:
        logger.warning("Gagal kirim undangan workspace via Telegram", exc_info=True)


@app.get("/api/invitations")
async def list_my_invitations(user=Depends(get_current_user)):
    return [{**i, "created_at": _iso_with_offset(i["created_at"])}
            for i in TaskRepository(DB_PATH).list_pending_invitations_for_user(user["sub"])]


def _respond_invitation(invitation_id: int, user, accept: bool) -> dict:
    try:
        return TaskRepository(DB_PATH).respond_workspace_invitation(invitation_id, user["sub"], accept)
    except repository.InvitationNotFound:
        raise HTTPException(status_code=404, detail="Undangan tidak ditemukan")
    except repository.InvitationClosed:
        raise HTTPException(status_code=409, detail="Undangan sudah dijawab atau dibatalkan")
    except repository.InvitationExpired:
        raise HTTPException(status_code=410, detail="Undangan sudah kedaluwarsa")


@app.post("/api/invitations/{invitation_id}/accept")
async def accept_invitation(invitation_id: int, user=Depends(get_current_user)):
    return {"ok": True, **_respond_invitation(invitation_id, user, True)}


@app.post("/api/invitations/{invitation_id}/decline")
async def decline_invitation(invitation_id: int, user=Depends(get_current_user)):
    return {"ok": True, **_respond_invitation(invitation_id, user, False)}


@app.get("/api/lists/{list_id}/invitations")
async def list_workspace_invitations(list_id: int, user=Depends(get_current_user)):
    repo = TaskRepository(DB_PATH)
    if not repo.is_list_owner(list_id, user["sub"]):
        raise HTTPException(status_code=403, detail="Hanya owner yang bisa melihat undangan")
    return [{**i, "created_at": _iso_with_offset(i["created_at"])}
            for i in repo.list_pending_invitations_for_workspace(list_id)]


@app.delete("/api/lists/{list_id}/invitations/{invitation_id}")
async def cancel_workspace_invitation(list_id: int, invitation_id: int, user=Depends(get_current_user)):
    repo = TaskRepository(DB_PATH)
    if not repo.is_list_owner(list_id, user["sub"]):
        raise HTTPException(status_code=403, detail="Hanya owner yang bisa membatalkan undangan")
    try:
        repo.cancel_workspace_invitation(list_id, invitation_id)
    except repository.InvitationNotFound:
        raise HTTPException(status_code=404, detail="Undangan tidak ditemukan")
    except repository.InvitationClosed:
        raise HTTPException(status_code=409, detail="Undangan sudah tidak menunggu jawaban")
    return {"ok": True}


def _require_list_owner(repo, list_id: int, uid: int):
    if not repo.is_list_owner(list_id, uid):
        raise HTTPException(status_code=403, detail="Hanya owner yang bisa mengelola invite link.")


def _link_out(inv: dict) -> dict:
    from config import WEBAPP_URL
    return {"code": inv["code"], "join_url": f"{WEBAPP_URL}/join?code={inv['code']}",
            "expires_at": _iso_with_offset(inv["expires_at"]), "max_uses": inv["max_uses"], "uses": inv["uses"]}


@app.post("/api/lists/{list_id}/generate-link")
async def generate_invite_link(list_id: int, req: Optional[GenerateLinkReq] = None,
                               user=Depends(get_current_user)):
    """Buat link undangan (masa berlaku 1h/1d/7d, batas 1/10/tanpa batas)."""
    uid = user["sub"]
    repo = TaskRepository(DB_PATH)
    if not repo.is_list_owner(list_id, uid):
        raise HTTPException(status_code=403, detail="Hanya owner yang bisa membuat invite link.")
    req = req or GenerateLinkReq()
    inv = repo.create_list_invite(list_id, uid, expire_hours=_INVITE_HOURS[req.expires_in],
                                 max_uses=req.max_uses)
    return _link_out(inv)


@app.get("/api/lists/{list_id}/links")
async def list_invite_links(list_id: int, user=Depends(get_current_user)):
    repo = TaskRepository(DB_PATH)
    _require_list_owner(repo, list_id, user["sub"])
    return [{**_link_out(i), "created_at": _iso_with_offset(i["created_at"])} for i in repo.list_active_invites(list_id)]


@app.delete("/api/lists/{list_id}/links/{code}")
async def revoke_invite_link(list_id: int, code: str, user=Depends(get_current_user)):
    repo = TaskRepository(DB_PATH)
    _require_list_owner(repo, list_id, user["sub"])
    if not repo.revoke_list_invite(list_id, code):
        raise HTTPException(status_code=404, detail="Link tidak ditemukan.")
    return {"ok": True}


@app.delete("/api/lists/{list_id}/links")
async def revoke_all_invite_links(list_id: int, user=Depends(get_current_user)):
    repo = TaskRepository(DB_PATH)
    _require_list_owner(repo, list_id, user["sub"])
    return {"revoked": repo.revoke_all_list_invites(list_id)}


@app.get("/api/lists/{list_id}/tasks")
async def get_list_tasks(list_id: int, user=Depends(get_current_user)):
    repo = TaskRepository(DB_PATH)
    if not repo.is_list_member_or_owner(list_id, user["sub"]):
        raise HTTPException(status_code=403, detail="Not a member of this list")
    with get_db() as conn:
        rows = conn.execute(
            """SELECT * FROM tasks WHERE list_id = ?
               AND gtd_status NOT IN ('done','archived')
               ORDER BY priority, deadline""",
            (list_id,),
        ).fetchall()
    return [task_row_to_dict(r) for r in rows]


def _ensure_workspace_files_table(conn) -> None:
    """Lazy-create workspace_files table if missing (self-healing after deploy tanpa restart)."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS workspace_files (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            list_id       INTEGER NOT NULL REFERENCES shared_lists(id) ON DELETE CASCADE,
            user_id       INTEGER NOT NULL REFERENCES users(id),
            filename      TEXT NOT NULL,
            original_name TEXT NOT NULL,
            file_size     INTEGER DEFAULT 0,
            mime_type     TEXT DEFAULT '',
            source        TEXT NOT NULL DEFAULT 'direct',
            task_id       INTEGER DEFAULT NULL,
            is_deleted    INTEGER DEFAULT 0,
            created_at    TEXT NOT NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_workspace_files_list ON workspace_files(list_id, created_at)")


def _ensure_chat_schema(conn) -> None:
    """Lazy-migrate messages table columns & workspace_files table (self-healing after deploy tanpa restart)."""
    _ensure_workspace_files_table(conn)
    cols = [r["name"] for r in conn.execute("PRAGMA table_info(messages)").fetchall()]
    if "reply_to_id" not in cols:
        conn.execute("ALTER TABLE messages ADD COLUMN reply_to_id INTEGER DEFAULT NULL REFERENCES messages(id) ON DELETE SET NULL")
    if "note_id" not in cols:
        conn.execute("ALTER TABLE messages ADD COLUMN note_id INTEGER")
    if "client_id" not in cols:
        conn.execute("ALTER TABLE messages ADD COLUMN client_id TEXT")
    if "file_id" not in cols:
        conn.execute("ALTER TABLE messages ADD COLUMN file_id INTEGER DEFAULT NULL REFERENCES workspace_files(id)")


# ── Chat API ──────────────────────────────────────────────────────────────────

@app.get("/api/lists/{list_id}/messages")
async def get_messages(list_id: int, limit: int = 50, before_id: Optional[int] = None, user=Depends(get_current_user)):
    uid = user["sub"]
    repo = TaskRepository(DB_PATH)
    if not repo.is_list_member_or_owner(list_id, uid):
        raise HTTPException(status_code=403, detail="Not a member of this list")
    with get_db() as conn:
        _ensure_chat_schema(conn)
        base_select = """
            SELECT m.id, m.list_id, m.user_id, m.content, m.task_id, m.note_id, m.msg_type,
                   m.client_id,
                   m.created_at, m.reply_to_id,
                   m.file_id,
                   wf.original_name as file_original_name,
                   wf.file_size as file_size,
                   wf.mime_type as file_mime_type,
                   wf.is_deleted as file_is_deleted,
                   u.username, u.display_name,
                   t.title as task_title, t.priority as task_priority,
                   t.deadline as task_deadline, t.quadrant as task_quadrant,
                   t.gtd_status as task_status,
                   sn.title as note_title,
                   ru.username as reply_to_username,
                   ru.display_name as reply_to_display_name,
                   rm.content as reply_to_content
            FROM messages m
            JOIN users u ON u.id = m.user_id
            LEFT JOIN tasks t ON t.id = m.task_id
            LEFT JOIN scratchpad_notes sn ON sn.id = m.note_id
            LEFT JOIN workspace_files wf ON wf.id = m.file_id
            LEFT JOIN messages rm ON rm.id = m.reply_to_id
            LEFT JOIN users ru ON ru.id = rm.user_id
        """
        if before_id:
            rows = conn.execute(
                base_select + "WHERE m.list_id = ? AND m.id < ? ORDER BY m.created_at DESC LIMIT ?",
                (list_id, before_id, limit),
            ).fetchall()
            rows = list(reversed(rows))
        else:
            rows = conn.execute(
                base_select + "WHERE m.list_id = ? ORDER BY m.created_at DESC LIMIT ?",
                (list_id, limit),
            ).fetchall()
            rows = list(reversed(rows))
    return [dict(r) for r in rows]


@app.get("/api/lists/{list_id}/members/usernames")
async def get_list_member_usernames(list_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    repo = TaskRepository(DB_PATH)
    if not repo.is_list_member_or_owner(list_id, uid):
        raise HTTPException(status_code=403, detail="Not a member of this list")
    with get_db() as conn:
        owner_row = conn.execute(
            "SELECT u.id, u.username, u.display_name FROM shared_lists sl "
            "JOIN users u ON u.id = sl.owner_id WHERE sl.id = ?", (list_id,)
        ).fetchone()
        member_rows = conn.execute(
            "SELECT u.id, u.username, u.display_name FROM list_members lm "
            "JOIN users u ON u.id = lm.user_id WHERE lm.list_id = ? ORDER BY lm.joined_at",
            (list_id,)
        ).fetchall()
    seen = set()
    result = []
    for row in ([owner_row] + list(member_rows)):
        if row and row["id"] not in seen:
            seen.add(row["id"])
            result.append({"username": row["username"], "display_name": row["display_name"]})
    return result


@app.get("/api/lists/{list_id}/notes")
async def get_list_notes(list_id: int, user=Depends(get_current_user)):
    """Return shared notes that belong to this list."""
    uid = user["sub"]
    repo = TaskRepository(DB_PATH)
    if not repo.is_list_member_or_owner(list_id, uid):
        raise HTTPException(status_code=403, detail="Not a member of this list")
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, title, updated_at FROM scratchpad_notes WHERE list_id = ? ORDER BY updated_at DESC",
            (list_id,)
        ).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/lists/{list_id}/messages")
async def post_message(list_id: int, req: MessageCreate, user=Depends(get_current_user)):
    uid = user["sub"]
    repo = TaskRepository(DB_PATH)
    if not repo.is_list_member_or_owner(list_id, uid):
        raise HTTPException(status_code=403, detail="Not a member of this list")
    now = datetime.now().isoformat()
    with get_db() as conn:
        _ensure_chat_schema(conn)
        # Validate task_id belongs to this list (if provided)
        if req.task_id:
            task_row = conn.execute(
                "SELECT id FROM tasks WHERE id = ? AND list_id = ?", (req.task_id, list_id)
            ).fetchone()
            if not task_row:
                raise HTTPException(status_code=400, detail="Task tidak ditemukan di list ini")
        # Validate file_id belongs to this list and is not deleted (if provided)
        if req.file_id:
            file_row = conn.execute(
                "SELECT id FROM workspace_files WHERE id = ? AND list_id = ? AND is_deleted = 0",
                (req.file_id, list_id)
            ).fetchone()
            if not file_row:
                raise HTTPException(status_code=400, detail="Berkas tidak ditemukan atau telah dihapus di workspace ini")
        # Idempotensi retry sync (audit T11): pesan dengan (list_id, user_id, client_id) yang sama sudah
        # tersimpan (respons hilang → outbox mengirim ulang) → kembalikan yang ada, tanpa insert,
        # tanpa notifikasi mention ulang, tanpa siaran SSE ulang.
        existing_id = None
        if req.client_id:
            dup = conn.execute(
                "SELECT id FROM messages WHERE list_id = ? AND user_id = ? AND client_id = ? ORDER BY id LIMIT 1",
                (list_id, uid, req.client_id),
            ).fetchone()
            if dup:
                existing_id = dup["id"]
        if existing_id is None:
            # Save message
            cur = conn.execute(
                "INSERT INTO messages (list_id, user_id, content, task_id, note_id, file_id, msg_type, reply_to_id, client_id, created_at) "
                "VALUES (?,?,?,?,?,?,?,?,?,?)",
                (list_id, uid, req.content, req.task_id, req.note_id, req.file_id, req.msg_type, req.reply_to_id, req.client_id, now),
            )
            msg_id = cur.lastrowid
        else:
            msg_id = existing_id
        # Fetch with joined data for broadcast
        row = conn.execute(
            """SELECT m.id, m.list_id, m.user_id, m.content, m.task_id, m.note_id, m.msg_type,
                      m.client_id,
                      m.created_at, m.reply_to_id,
                      m.file_id,
                      wf.original_name as file_original_name,
                      wf.file_size as file_size,
                      wf.mime_type as file_mime_type,
                      wf.is_deleted as file_is_deleted,
                      u.username, u.display_name,
                      t.title as task_title, t.priority as task_priority,
                      t.deadline as task_deadline, t.quadrant as task_quadrant,
                      t.gtd_status as task_status,
                      sn.title as note_title,
                      ru.username as reply_to_username,
                      ru.display_name as reply_to_display_name,
                      rm.content as reply_to_content
               FROM messages m
               JOIN users u ON u.id = m.user_id
               LEFT JOIN tasks t ON t.id = m.task_id
               LEFT JOIN scratchpad_notes sn ON sn.id = m.note_id
               LEFT JOIN workspace_files wf ON wf.id = m.file_id
               LEFT JOIN messages rm ON rm.id = m.reply_to_id
               LEFT JOIN users ru ON ru.id = rm.user_id
               WHERE m.id = ?""",
            (msg_id,),
        ).fetchone()
        msg_dict = dict(row)
        if existing_id is not None:
            return msg_dict
        # Process @mentions
        mentions = set(re.findall(r'@(\w+)', req.content))
        if mentions:
            list_row = conn.execute(
                "SELECT name FROM shared_lists WHERE id = ?", (list_id,)
            ).fetchone()
            list_name = list_row["name"] if list_row else f"List #{list_id}"
            sender_username = user["username"]
            for username in mentions:
                if username == sender_username:
                    continue
                mentioned = conn.execute(
                    "SELECT u.id FROM users u "
                    "WHERE u.username = ? AND ("
                    "  u.id IN (SELECT owner_id FROM shared_lists WHERE id = ?) "
                    "  OR u.id IN (SELECT user_id FROM list_members WHERE list_id = ?)"
                    ")",
                    (username, list_id, list_id),
                ).fetchone()
                if mentioned:
                    conn.execute(
                        "INSERT INTO notifications (user_id, message, is_read, list_id, task_id, created_at) "
                        "VALUES (?,?,0,?,NULL,?)",
                        (mentioned["id"],
                         f"💬 {_esc_msg(sender_username)} menyebut kamu di diskusi '{_esc_msg(list_name)}'",
                         list_id, now),
                    )
    # Broadcast to all SSE subscribers of this list
    for q in list(chat_subscribers.get(list_id, set())):
        await q.put(msg_dict)
    return msg_dict


@app.get("/api/lists/{list_id}/messages/stream")
async def chat_stream(list_id: int, request: Request, user=Depends(get_current_user_sse)):
    uid = user["sub"]
    repo = TaskRepository(DB_PATH)
    if not repo.is_list_member_or_owner(list_id, uid):
        raise HTTPException(status_code=403, detail="Not a member of this list")

    async def event_generator():
        q: asyncio.Queue = asyncio.Queue()
        chat_subscribers[list_id].add(q)
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=20.0)
                    yield {"data": json.dumps(msg)}
                except asyncio.TimeoutError:
                    if not _session_still_valid(user):
                        break  # password diganti → tutup stream
                    # Keepalive ping agar koneksi tidak timeout
                    yield {"data": json.dumps({"type": "ping"})}
        finally:
            chat_subscribers[list_id].discard(q)

    return EventSourceResponse(event_generator())


# ── Workspace Files API ───────────────────────────────────────────────────────
# Central file repository for shared workspaces (spec: docs/superpowers/specs/2026-10-05-workspace-files-and-chat-attachments-design.md)

@app.get("/api/lists/{list_id}/files")
async def list_workspace_files(
    list_id: int,
    q: Optional[str] = Query(None),
    type: Optional[str] = Query(None),
    user=Depends(get_current_user_sse)
):
    uid = user["sub"]
    repo = TaskRepository(DB_PATH)
    if not repo.is_list_member_or_owner(list_id, uid):
        raise HTTPException(status_code=403, detail="Not a member of this list")

    sql = """
        SELECT wf.id, wf.list_id, wf.user_id, wf.filename, wf.original_name,
               wf.file_size, wf.mime_type, wf.source, wf.task_id, wf.is_deleted,
               wf.created_at,
               COALESCE(NULLIF(u.display_name, ''), u.username) AS uploader_name,
               u.username, u.display_name,
               t.title AS task_title
        FROM workspace_files wf
        LEFT JOIN users u ON wf.user_id = u.id
        LEFT JOIN tasks t ON wf.task_id = t.id
        WHERE wf.list_id = ? AND wf.is_deleted = 0
    """
    params = [list_id]

    if q and q.strip():
        sql += " AND wf.original_name LIKE ?"
        params.append(f"%{q.strip()}%")

    if type and type.strip():
        t = type.strip().lower()
        if t == "pdf":
            sql += " AND (wf.mime_type LIKE '%pdf%' OR wf.original_name LIKE '%.pdf')"
        elif t == "image":
            sql += (" AND (wf.mime_type LIKE 'image/%' OR wf.original_name LIKE '%.png' "
                    "OR wf.original_name LIKE '%.jpg' OR wf.original_name LIKE '%.jpeg' "
                    "OR wf.original_name LIKE '%.webp' OR wf.original_name LIKE '%.gif')")
        elif t in ("document", "doc", "sheet"):
            sql += (" AND (wf.mime_type LIKE '%document%' OR wf.mime_type LIKE '%sheet%' "
                    "OR wf.mime_type LIKE '%presentation%' OR wf.mime_type LIKE '%text%' "
                    "OR wf.mime_type LIKE '%csv%' OR wf.mime_type LIKE '%excel%' "
                    "OR wf.original_name LIKE '%.doc%' OR wf.original_name LIKE '%.docx' "
                    "OR wf.original_name LIKE '%.xls%' OR wf.original_name LIKE '%.xlsx' "
                    "OR wf.original_name LIKE '%.ppt%' OR wf.original_name LIKE '%.pptx' "
                    "OR wf.original_name LIKE '%.txt' OR wf.original_name LIKE '%.csv')")
        elif t == "other":
            sql += (" AND NOT (wf.mime_type LIKE '%pdf%' OR wf.original_name LIKE '%.pdf' "
                    "OR wf.mime_type LIKE 'image/%' OR wf.original_name LIKE '%.png' "
                    "OR wf.original_name LIKE '%.jpg' OR wf.original_name LIKE '%.jpeg' "
                    "OR wf.original_name LIKE '%.webp' OR wf.original_name LIKE '%.gif' "
                    "OR wf.mime_type LIKE '%document%' OR wf.mime_type LIKE '%sheet%' "
                    "OR wf.mime_type LIKE '%presentation%' OR wf.mime_type LIKE '%text%' "
                    "OR wf.mime_type LIKE '%csv%' OR wf.mime_type LIKE '%excel%' "
                    "OR wf.original_name LIKE '%.doc%' OR wf.original_name LIKE '%.docx' "
                    "OR wf.original_name LIKE '%.xls%' OR wf.original_name LIKE '%.xlsx' "
                    "OR wf.original_name LIKE '%.ppt%' OR wf.original_name LIKE '%.pptx' "
                    "OR wf.original_name LIKE '%.txt' OR wf.original_name LIKE '%.csv')")
        else:
            sql += " AND (wf.mime_type LIKE ? OR wf.original_name LIKE ?)"
            params.extend([f"%{t}%", f"%.{t}%"])

    sql += " ORDER BY wf.created_at DESC, wf.id DESC"

    with get_db() as conn:
        _ensure_workspace_files_table(conn)
        rows = conn.execute(sql, params).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/lists/{list_id}/files", status_code=status.HTTP_201_CREATED)
async def upload_workspace_file(
    list_id: int,
    file: UploadFile = FastAPIFile(...),
    source: str = Form("direct"),
    task_id: Optional[int] = Form(None),
    user=Depends(get_current_user)
):
    uid = user["sub"]
    repo = TaskRepository(DB_PATH)
    if not repo.is_list_member_or_owner(list_id, uid):
        raise HTTPException(status_code=403, detail="Not a member of this list")

    if task_id:
        with get_db() as conn:
            task_row = conn.execute(
                "SELECT id FROM tasks WHERE id = ? AND list_id = ?", (task_id, list_id)
            ).fetchone()
            if not task_row:
                raise HTTPException(status_code=400, detail="Task tidak ditemukan di workspace ini")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail=f"File terlalu besar. Maks {MAX_FILE_SIZE // (1024*1024)}MB")

    original_name = file.filename or "file"
    ext = Path(original_name).suffix or ""
    stored_name = f"{uuid.uuid4().hex}{ext}"
    stored_path = os.path.join(UPLOAD_DIR, stored_name)

    os.makedirs(UPLOAD_DIR, exist_ok=True)
    with open(stored_path, "wb") as f:
        f.write(content)

    mime_type = _safe_upload_mime(
        file.content_type or mimetypes.guess_type(original_name)[0] or "application/octet-stream")
    now = datetime.now().isoformat()

    with get_db() as conn:
        _ensure_workspace_files_table(conn)
        cur = conn.execute(
            """INSERT INTO workspace_files
               (list_id, user_id, filename, original_name, file_size, mime_type, source, task_id, is_deleted, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)""",
            (list_id, uid, stored_name, original_name, len(content), mime_type, source, task_id, now)
        )
        file_id = cur.lastrowid
        row = conn.execute(
            """SELECT wf.id, wf.list_id, wf.user_id, wf.filename, wf.original_name,
                      wf.file_size, wf.mime_type, wf.source, wf.task_id, wf.is_deleted,
                      wf.created_at,
                      COALESCE(NULLIF(u.display_name, ''), u.username) AS uploader_name,
                      u.username, u.display_name,
                      t.title AS task_title
               FROM workspace_files wf
               LEFT JOIN users u ON wf.user_id = u.id
               LEFT JOIN tasks t ON wf.task_id = t.id
               WHERE wf.id = ?""",
            (file_id,)
        ).fetchone()

    return dict(row)


@app.get("/api/lists/{list_id}/files/{file_id}/download")
async def download_workspace_file(
    list_id: int,
    file_id: int,
    user=Depends(get_current_user_sse)
):
    uid = user["sub"]
    repo = TaskRepository(DB_PATH)
    if not repo.is_list_member_or_owner(list_id, uid):
        raise HTTPException(status_code=403, detail="Not a member of this list")

    with get_db() as conn:
        _ensure_workspace_files_table(conn)
        row = conn.execute(
            "SELECT * FROM workspace_files WHERE id = ? AND list_id = ?",
            (file_id, list_id)
        ).fetchone()

    if not row or row["is_deleted"] == 1:
        raise HTTPException(status_code=404, detail="File not found")

    filepath = os.path.join(UPLOAD_DIR, row["filename"])
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="File not found on disk")

    # Baris lama bisa menyimpan tipe yang bisa dirender (sebelum _safe_upload_mime) → disaring juga saat disajikan.
    return FileResponse(filepath, filename=row["original_name"], media_type=_safe_upload_mime(row["mime_type"]),
                        headers={"X-Content-Type-Options": "nosniff"})


@app.delete("/api/lists/{list_id}/files/{file_id}")
async def delete_workspace_file(
    list_id: int,
    file_id: int,
    user=Depends(get_current_user)
):
    uid = user["sub"]
    repo = TaskRepository(DB_PATH)
    if not repo.is_list_member_or_owner(list_id, uid):
        raise HTTPException(status_code=403, detail="Not a member of this list")

    with get_db() as conn:
        _ensure_workspace_files_table(conn)
        row = conn.execute(
            "SELECT * FROM workspace_files WHERE id = ? AND list_id = ?",
            (file_id, list_id)
        ).fetchone()

    if not row or row["is_deleted"] == 1:
        raise HTTPException(status_code=404, detail="File not found")

    is_uploader = (row["user_id"] == uid)
    is_owner = repo.is_list_owner(list_id, uid)
    if not (is_uploader or is_owner):
        raise HTTPException(status_code=403, detail="Hanya pengunggah berkas atau owner workspace yang dapat menghapus berkas")

    with get_db() as conn:
        conn.execute("UPDATE workspace_files SET is_deleted = 1 WHERE id = ?", (file_id,))

    filepath = os.path.join(UPLOAD_DIR, row["filename"])
    if os.path.exists(filepath):
        try:
            os.unlink(filepath)
        except OSError:
            pass

    return {"success": True, "message": "Berkas berhasil dihapus"}


# ── Direct Messages API ───────────────────────────────────────────────────────
# DM 1-on-1 (spec: docs/superpowers/specs/2026-10-03-direct-messages-design.md).
# Memulai percakapan BARU wajib berbagi ≥1 shared list; percakapan yang sudah ada
# tetap aktif selamanya (kirim hanya mensyaratkan peserta). Online-only: tidak
# didaftarkan di router lokal/SW. Percakapan milik orang lain → 404.

def _ensure_dm_schema(conn) -> None:
    """Lazy-create DM tables if missing (self-healing after deploy tanpa restart)."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS dm_conversations (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            user_a          INTEGER NOT NULL,
            user_b          INTEGER NOT NULL,
            created_at      TEXT NOT NULL,
            last_message_at TEXT,
            UNIQUE (user_a, user_b),
            CHECK (user_a < user_b),
            FOREIGN KEY (user_a) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (user_b) REFERENCES users(id) ON DELETE CASCADE
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS dm_messages (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            conversation_id INTEGER NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
            user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            content         TEXT NOT NULL,
            reply_to_id     INTEGER DEFAULT NULL REFERENCES dm_messages(id) ON DELETE SET NULL,
            client_id       TEXT DEFAULT NULL,
            created_at      TEXT NOT NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_dm_messages_conv ON dm_messages(conversation_id, id)")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS dm_reads (
            conversation_id INTEGER NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
            user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            last_read_id    INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (conversation_id, user_id)
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS dm_blocks (
            blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL,
            PRIMARY KEY (blocker_id, blocked_id)
        )
    """)


_DM_MSG_SELECT = """
    SELECT m.id, m.conversation_id, m.user_id, m.content, m.client_id,
           m.created_at, m.reply_to_id,
           u.username, u.display_name,
           ru.username as reply_to_username,
           ru.display_name as reply_to_display_name,
           rm.content as reply_to_content
    FROM dm_messages m
    JOIN users u ON u.id = m.user_id
    LEFT JOIN dm_messages rm ON rm.id = m.reply_to_id
    LEFT JOIN users ru ON ru.id = rm.user_id
"""


def _dm_share_list(conn, uid: int, other_id: int) -> bool:
    """True bila kedua user saat ini owner/member dari setidaknya satu list yang sama."""
    row = conn.execute(
        """
        WITH mine AS (
            SELECT id AS list_id FROM shared_lists WHERE owner_id = ?
            UNION SELECT list_id FROM list_members WHERE user_id = ?
        )
        SELECT 1 FROM mine WHERE list_id IN (
            SELECT id FROM shared_lists WHERE owner_id = ?
            UNION SELECT list_id FROM list_members WHERE user_id = ?
        ) LIMIT 1
        """,
        (uid, uid, other_id, other_id),
    ).fetchone()
    return row is not None


def _dm_get_conv_or_404(conn, conv_id: int, uid: int):
    _ensure_dm_schema(conn)
    row = conn.execute(
        "SELECT * FROM dm_conversations WHERE id = ? AND (user_a = ? OR user_b = ?)",
        (conv_id, uid, uid),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Percakapan tidak ditemukan")
    return row


DM_BLOCKED_DETAIL = "Obrolan ini diblokir"


def _dm_block_flags(conn, uid: int, other_id: int) -> tuple[bool, bool]:
    """(blocked_by_me, blocked_by_other)."""
    _ensure_dm_schema(conn)
    rows = conn.execute(
        "SELECT blocker_id FROM dm_blocks WHERE (blocker_id = ? AND blocked_id = ?) "
        "OR (blocker_id = ? AND blocked_id = ?)",
        (uid, other_id, other_id, uid),
    ).fetchall()
    blockers = {r[0] for r in rows}
    return uid in blockers, other_id in blockers


def _dm_other_id(conv, uid: int) -> int:
    return conv["user_b"] if conv["user_a"] == uid else conv["user_a"]


def _dm_conv_to_dict(conn, conv, uid: int) -> dict:
    _ensure_dm_schema(conn)
    other_id = conv["user_b"] if conv["user_a"] == uid else conv["user_a"]
    other = conn.execute(
        "SELECT id, username, display_name FROM users WHERE id = ?", (other_id,)
    ).fetchone()
    last = conn.execute(
        "SELECT content, user_id, created_at FROM dm_messages WHERE conversation_id = ? "
        "ORDER BY id DESC LIMIT 1",
        (conv["id"],),
    ).fetchone()
    read = conn.execute(
        "SELECT last_read_id FROM dm_reads WHERE conversation_id = ? AND user_id = ?",
        (conv["id"], uid),
    ).fetchone()
    unread = conn.execute(
        "SELECT COUNT(*) FROM dm_messages WHERE conversation_id = ? AND user_id != ? AND id > ?",
        (conv["id"], uid, read["last_read_id"] if read else 0),
    ).fetchone()[0]
    blocked_by_me, blocked_by_other = _dm_block_flags(conn, uid, other_id)
    return {
        "id": conv["id"],
        "other_user": dict(other) if other else {"id": other_id, "username": "?", "display_name": None},
        "last_message": dict(last) if last else None,
        "unread": unread,
        "last_message_at": conv["last_message_at"],
        "created_at": conv["created_at"],
        "blocked_by_me": blocked_by_me,
        "blocked_by_other": blocked_by_other,
    }


@app.get("/api/dm/contacts")
async def dm_contacts(user=Depends(get_current_user)):
    """Pengguna yang berbagi ≥1 shared list dengan saya (owner atau member), tanpa diri sendiri."""
    uid = user["sub"]
    with get_db() as conn:
        _ensure_dm_schema(conn)
        rows = conn.execute(
            """
            WITH mine AS (
                SELECT id AS list_id FROM shared_lists WHERE owner_id = ?
                UNION SELECT list_id FROM list_members WHERE user_id = ?
            ),
            people AS (
                SELECT sl.owner_id AS user_id FROM shared_lists sl JOIN mine ON mine.list_id = sl.id
                UNION SELECT lm.user_id FROM list_members lm JOIN mine ON mine.list_id = lm.list_id
            )
            SELECT u.id, u.username, u.display_name FROM users u
            JOIN people p ON p.user_id = u.id
            WHERE u.id != ?
            ORDER BY LOWER(COALESCE(NULLIF(u.display_name, ''), u.username))
            """,
            (uid, uid, uid),
        ).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/dm/conversations")
async def dm_list_conversations(user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        _ensure_dm_schema(conn)
        convs = conn.execute(
            "SELECT * FROM dm_conversations WHERE user_a = ? OR user_b = ? "
            "ORDER BY COALESCE(last_message_at, created_at) DESC, id DESC",
            (uid, uid),
        ).fetchall()
        return [_dm_conv_to_dict(conn, c, uid) for c in convs]


@app.post("/api/dm/conversations")
async def dm_create_conversation(req: DmConversationCreate, user=Depends(get_current_user)):
    """Get-or-create. Sudah ada → kembalikan tanpa cek grup; baru → wajib berbagi grup."""
    uid = user["sub"]
    other_id = req.user_id
    if other_id == uid:
        raise HTTPException(status_code=400, detail="Tidak bisa mengirim pesan pribadi ke diri sendiri")
    a, b = min(uid, other_id), max(uid, other_id)
    with get_db() as conn:
        _ensure_dm_schema(conn)
        if not conn.execute("SELECT 1 FROM users WHERE id = ?", (other_id,)).fetchone():
            raise HTTPException(status_code=404, detail="Pengguna tidak ditemukan")
        conv = conn.execute(
            "SELECT * FROM dm_conversations WHERE user_a = ? AND user_b = ?", (a, b)
        ).fetchone()
        if not conv:
            if any(_dm_block_flags(conn, uid, other_id)):
                raise HTTPException(status_code=403, detail=DM_BLOCKED_DETAIL)
            if not _dm_share_list(conn, uid, other_id):
                raise HTTPException(
                    status_code=403,
                    detail="Pesan pribadi baru hanya bisa dimulai dengan anggota grup yang sama",
                )
            conn.execute(
                "INSERT OR IGNORE INTO dm_conversations (user_a, user_b, created_at) VALUES (?,?,?)",
                (a, b, datetime.now().isoformat()),
            )
            conv = conn.execute(
                "SELECT * FROM dm_conversations WHERE user_a = ? AND user_b = ?", (a, b)
            ).fetchone()
        return _dm_conv_to_dict(conn, conv, uid)


@app.get("/api/dm/conversations/{conv_id}/messages")
async def dm_get_messages(conv_id: int, limit: int = 50, before_id: Optional[int] = None,
                          user=Depends(get_current_user)):
    uid = user["sub"]
    limit = max(1, min(limit, 200))
    with get_db() as conn:
        _dm_get_conv_or_404(conn, conv_id, uid)
        if before_id:
            rows = conn.execute(
                _DM_MSG_SELECT + "WHERE m.conversation_id = ? AND m.id < ? ORDER BY m.id DESC LIMIT ?",
                (conv_id, before_id, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                _DM_MSG_SELECT + "WHERE m.conversation_id = ? ORDER BY m.id DESC LIMIT ?",
                (conv_id, limit),
            ).fetchall()
    return [dict(r) for r in reversed(rows)]


@app.post("/api/dm/conversations/{conv_id}/messages")
async def dm_post_message(conv_id: int, req: DmMessageCreate, user=Depends(get_current_user)):
    uid = user["sub"]
    now = datetime.now().isoformat()
    with get_db() as conn:
        conv = _dm_get_conv_or_404(conn, conv_id, uid)
        if any(_dm_block_flags(conn, uid, _dm_other_id(conv, uid))):
            # Tanpa simpan, tanpa notifikasi, tanpa siaran SSE.
            raise HTTPException(status_code=403, detail=DM_BLOCKED_DETAIL)
        if req.reply_to_id is not None:
            ok = conn.execute(
                "SELECT 1 FROM dm_messages WHERE id = ? AND conversation_id = ?",
                (req.reply_to_id, conv_id),
            ).fetchone()
            if not ok:
                raise HTTPException(status_code=400, detail="Pesan yang dibalas tidak ada di percakapan ini")
        # Idempotensi retry sync (audit T11): (conversation_id, user_id, client_id) sudah ada →
        # kembalikan pesan itu tanpa insert/notifikasi/siaran SSE ulang.
        if req.client_id:
            dup = conn.execute(
                "SELECT id FROM dm_messages WHERE conversation_id = ? AND user_id = ? AND client_id = ? ORDER BY id LIMIT 1",
                (conv_id, uid, req.client_id),
            ).fetchone()
            if dup:
                return dict(conn.execute(_DM_MSG_SELECT + "WHERE m.id = ?", (dup["id"],)).fetchone())
        cur = conn.execute(
            "INSERT INTO dm_messages (conversation_id, user_id, content, reply_to_id, client_id, created_at) "
            "VALUES (?,?,?,?,?,?)",
            (conv_id, uid, req.content, req.reply_to_id, req.client_id, now),
        )
        msg_id = cur.lastrowid
        conn.execute("UPDATE dm_conversations SET last_message_at = ? WHERE id = ?", (now, conv_id))
        # Pesan sendiri otomatis terbaca bagi pengirim.
        conn.execute(
            "INSERT INTO dm_reads (conversation_id, user_id, last_read_id) VALUES (?,?,?) "
            "ON CONFLICT(conversation_id, user_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)",
            (conv_id, uid, msg_id),
        )
        msg_dict = dict(conn.execute(_DM_MSG_SELECT + "WHERE m.id = ?", (msg_id,)).fetchone())
        recipient = conv["user_b"] if conv["user_a"] == uid else conv["user_a"]
        watching = any(sub_uid == recipient for sub_uid, _q in dm_subscribers.get(conv_id, set()))
        if not watching:
            # Nama dari DB (bukan klaim JWT) agar teks & dedup konsisten setelah user ganti username.
            notif = f"💬 {_esc_msg(msg_dict['username'])} mengirim pesan pribadi"
            dup = conn.execute(
                "SELECT 1 FROM notifications WHERE user_id = ? AND message = ? AND is_read = 0 LIMIT 1",
                (recipient, notif),
            ).fetchone()
            if not dup:
                conn.execute(
                    "INSERT INTO notifications (user_id, message, is_read, list_id, task_id, created_at) "
                    "VALUES (?,?,0,NULL,NULL,?)",
                    (recipient, notif, now),
                )
    for _sub_uid, q in list(dm_subscribers.get(conv_id, set())):
        await q.put(msg_dict)
    return msg_dict


@app.post("/api/dm/conversations/{conv_id}/read")
async def dm_mark_read(conv_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        _dm_get_conv_or_404(conn, conv_id, uid)
        last_id = conn.execute(
            "SELECT COALESCE(MAX(id), 0) FROM dm_messages WHERE conversation_id = ?", (conv_id,)
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO dm_reads (conversation_id, user_id, last_read_id) VALUES (?,?,?) "
            "ON CONFLICT(conversation_id, user_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)",
            (conv_id, uid, last_id),
        )
    return {"ok": True, "last_read_id": last_id}


@app.post("/api/dm/conversations/{conv_id}/block")
async def dm_block(conv_id: int, user=Depends(get_current_user)):
    """Blokir peserta lain percakapan ini. Idempoten."""
    uid = user["sub"]
    with get_db() as conn:
        conv = _dm_get_conv_or_404(conn, conv_id, uid)
        conn.execute(
            "INSERT OR IGNORE INTO dm_blocks (blocker_id, blocked_id, created_at) VALUES (?,?,?)",
            (uid, _dm_other_id(conv, uid), datetime.now().isoformat()),
        )
        return _dm_conv_to_dict(conn, conv, uid)


@app.delete("/api/dm/conversations/{conv_id}/block")
async def dm_unblock(conv_id: int, user=Depends(get_current_user)):
    """Buka blokir saya terhadap peserta lain (blokir dari pihak lain tidak tersentuh). Idempoten."""
    uid = user["sub"]
    with get_db() as conn:
        conv = _dm_get_conv_or_404(conn, conv_id, uid)
        conn.execute(
            "DELETE FROM dm_blocks WHERE blocker_id = ? AND blocked_id = ?",
            (uid, _dm_other_id(conv, uid)),
        )
        return _dm_conv_to_dict(conn, conv, uid)


@app.get("/api/dm/conversations/{conv_id}/stream")
async def dm_stream(conv_id: int, request: Request, user=Depends(get_current_user_sse)):
    uid = user["sub"]
    with get_db() as conn:
        _dm_get_conv_or_404(conn, conv_id, uid)

    async def event_generator():
        q: asyncio.Queue = asyncio.Queue()
        entry = (uid, q)
        dm_subscribers[conv_id].add(entry)
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=20.0)
                    yield {"data": json.dumps(msg)}
                except asyncio.TimeoutError:
                    if not _session_still_valid(user):
                        break  # password diganti → tutup stream
                    yield {"data": json.dumps({"type": "ping"})}
        finally:
            dm_subscribers[conv_id].discard(entry)

    return EventSourceResponse(event_generator())


# ── Serve SPA ──────────────────────────────────────────────────────────────────

@app.get("/join")
async def join_redirect(code: str = ""):
    """Redirect invite link to SPA with code in hash."""
    from fastapi.responses import RedirectResponse
    return RedirectResponse(url=f"/?join={code}", status_code=302)


@app.get("/", response_class=HTMLResponse)
async def serve_spa():
    index = STATIC_DIR / "index.html"
    if index.exists():
        return HTMLResponse(
            index.read_text(encoding="utf-8"),
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0",
            },
        )
    return HTMLResponse("<h1>Alurik</h1><p>Static files not found.</p>")


@app.get("/sw.js")
async def serve_sw():
    sw = STATIC_DIR / "sw.js"
    return FileResponse(
        str(sw),
        media_type="application/javascript",
        headers={
            "Service-Worker-Allowed": "/",
            "Cache-Control": "no-cache, no-store, must-revalidate, max-age=0",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


@app.get("/api/version")
async def get_app_version():
    sw_cache = "taskflow-v453-email-mailer"
    return JSONResponse(
        content={
            "app_version": "4.0.0",
            "sw_version": sw_cache,
            "cache_name": sw_cache,
            "timestamp": int(datetime.utcnow().timestamp()),
        },
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        },
    )


@app.get("/manifest.json")
async def serve_manifest():
    mf = STATIC_DIR / "manifest.json"
    return FileResponse(str(mf), media_type="application/manifest+json",
                        headers={"Cache-Control": "no-cache"})


@app.get("/config.js")
async def serve_config():
    base = (STATIC_DIR / "config.js").read_text(encoding="utf-8")
    flag = "true" if appconfig.AI_FEATURES_ENABLED else "false"
    body = base + f"\ntry {{ window.__AI_ENABLED = {flag}; }} catch (e) {{}}\n"
    return Response(content=body, media_type="application/javascript")


# Mount static files
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# ── Habits ────────────────────────────────────────────────────────────────────

@app.get("/api/habits")
async def get_habits(tag: str = "", user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        if tag:
            tag_norm = tag.strip().lower()
            rows = conn.execute("""
                SELECT * FROM habits WHERE user_id = ?
                AND id IN (SELECT et.entity_id FROM entity_tags et
                           JOIN tags t ON t.id = et.tag_id
                           WHERE et.entity_type = 'habit' AND t.user_id = ? AND t.name = ?)
                ORDER BY phase, id
            """, (uid, uid, tag_norm)).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM habits WHERE user_id = ? ORDER BY phase, id",
                (uid,)
            ).fetchall()
    return [dict(r) for r in rows]


@app.post("/api/habits")
async def create_habit(req: HabitCreate, user=Depends(get_current_user)):
    uid = user["sub"]
    _tag_re = re.compile(r'#([a-zA-Z0-9_À-ɏ]+)')
    habit_tags = [m.lower() for m in _tag_re.findall(req.title)]
    req.title = _tag_re.sub('', req.title).strip()
    if not req.title:
        raise HTTPException(status_code=400, detail="Nama habit tidak boleh kosong setelah strip tag")
    if req.phase not in ("pagi", "siang", "malam"):
        raise HTTPException(status_code=400, detail="phase harus pagi/siang/malam")
    freq_json = json.dumps(req.frequency)
    with get_db() as conn:
        # Idempotensi retry sync (audit T11): (user_id, client_id) sudah ada → kembalikan baris itu.
        if req.client_id:
            dup = conn.execute(
                "SELECT * FROM habits WHERE user_id = ? AND client_id = ?", (uid, req.client_id)
            ).fetchone()
            if dup:
                return dict(dup)
        try:
            cur = conn.execute(
                """INSERT INTO habits (user_id, title, phase, micro_target, frequency, identity_pillar, client_id)
                   VALUES (?,?,?,?,?,?,?)""",
                (uid, req.title, req.phase, req.micro_target, freq_json, req.identity_pillar, req.client_id)
            )
        except sqlite3.IntegrityError:
            dup = conn.execute(
                "SELECT * FROM habits WHERE user_id = ? AND client_id = ?", (uid, req.client_id)
            ).fetchone() if req.client_id else None
            if not dup:
                raise
            return dict(dup)
        habit_id = cur.lastrowid
        if habit_tags:
            _upsert_tags_for_entity(conn, habit_id, uid, 'habit', habit_tags)
            conn.commit()
        row = conn.execute("SELECT * FROM habits WHERE id = ?", (habit_id,)).fetchone()
    return dict(row)


@app.post("/api/habits/{habit_id}/update")
async def update_habit(habit_id: int, req: HabitUpdate, user=Depends(get_current_user)):
    uid = user["sub"]
    _tag_re = re.compile(r'#([a-zA-Z0-9_À-ɏ]+)')
    habit_tags = [m.lower() for m in _tag_re.findall(req.title)]
    req.title = _tag_re.sub('', req.title).strip()
    if not req.title:
        raise HTTPException(status_code=400, detail="Nama habit tidak boleh kosong setelah strip tag")
    if req.phase not in ("pagi", "siang", "malam"):
        raise HTTPException(status_code=400, detail="phase tidak valid")
    import json as _json
    with get_db() as conn:
        row = conn.execute("SELECT id FROM habits WHERE id = ? AND user_id = ?", (habit_id, uid)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Habit tidak ditemukan")
        conn.execute(
            "UPDATE habits SET title=?, phase=?, micro_target=?, frequency=?, identity_pillar=? WHERE id=?",
            (req.title, req.phase, req.micro_target, _json.dumps(req.frequency), req.identity_pillar, habit_id)
        )
        conn.execute("DELETE FROM entity_tags WHERE entity_type='habit' AND entity_id=? AND user_id=?", (habit_id, uid))
        if habit_tags:
            _upsert_tags_for_entity(conn, habit_id, uid, 'habit', habit_tags)
        conn.commit()
    return {"ok": True, "id": habit_id}


@app.get("/api/habits/{habit_id}/tags")
async def get_habit_tags(habit_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        row = conn.execute("SELECT id FROM habits WHERE id = ? AND user_id = ?", (habit_id, uid)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Habit tidak ditemukan")
        rows = conn.execute("""
            SELECT t.id, t.name, t.color
            FROM tags t
            JOIN entity_tags et ON t.id = et.tag_id
            WHERE et.entity_type = 'habit' AND et.entity_id = ? AND t.user_id = ?
            ORDER BY t.name ASC
        """, (habit_id, uid)).fetchall()
        return [dict(r) for r in rows]


@app.delete("/api/habits/{habit_id}/tags/{tag_name}")
async def remove_habit_tag(habit_id: int, tag_name: str, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        row = conn.execute("SELECT id FROM habits WHERE id = ? AND user_id = ?", (habit_id, uid)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Habit tidak ditemukan")
        tag = conn.execute(
            "SELECT id FROM tags WHERE user_id = ? AND name = ?",
            (uid, tag_name.strip().lower())
        ).fetchone()
        if tag:
            conn.execute(
                "DELETE FROM entity_tags WHERE tag_id = ? AND entity_type = 'habit' AND entity_id = ?",
                (tag["id"], habit_id)
            )
            conn.commit()
    return {"ok": True}


@app.delete("/api/habits/{habit_id}")
async def delete_habit(habit_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        row = conn.execute("SELECT id FROM habits WHERE id = ? AND user_id = ?", (habit_id, uid)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Habit tidak ditemukan")
        conn.execute("DELETE FROM habits WHERE id = ?", (habit_id,))
    return {"ok": True}


@app.get("/api/habits/today")
async def get_habits_today(user=Depends(get_current_user)):
    uid = user["sub"]
    _t = _today_jkt()
    today = _t.isoformat()
    # Senin minggu ini s/d Minggu (7 hari, index 0=Sen ... 6=Min)
    today_dow = _t.weekday()  # 0=Mon ... 6=Sun
    week_dates = [(_t - timedelta(days=today_dow - i)).isoformat() for i in range(7)]

    with get_db() as conn:
        habits = conn.execute(
            "SELECT * FROM habits WHERE user_id = ? ORDER BY phase, id", (uid,)
        ).fetchall()

        result = []
        for h in habits:
            hid = h["id"]
            today_log = conn.execute(
                "SELECT status, skip_reason FROM habit_logs WHERE habit_id = ? AND date = ?",
                (hid, today)
            ).fetchone()
            logs = conn.execute(
                "SELECT date, status FROM habit_logs WHERE habit_id = ? AND date IN ({})".format(
                    ",".join("?" * len(week_dates))
                ),
                [hid] + week_dates
            ).fetchall()
            log_map = {l["date"]: l["status"] for l in logs}
            week_log = [log_map.get(d, None) for d in week_dates]
            month_dates = [(_t - timedelta(days=29 - i)).isoformat() for i in range(30)]
            month_rows = conn.execute(
                "SELECT date, status FROM habit_logs WHERE habit_id = ? AND date >= ? AND date <= ?",
                (hid, month_dates[0], month_dates[-1])
            ).fetchall()
            month_map = {r["date"]: r["status"] for r in month_rows}
            month_log = [{"date": d, "status": month_map.get(d)} for d in month_dates]
            # Streak: hitung dari hari ini ke belakang
            streak = 0
            check_date = _today_jkt()
            while True:
                log = conn.execute(
                    "SELECT status FROM habit_logs WHERE habit_id = ? AND date = ?",
                    (hid, check_date.isoformat())
                ).fetchone()
                if log and log["status"] == "done":
                    streak += 1
                    check_date -= timedelta(days=1)
                elif log and log["status"] == "skipped":
                    check_date -= timedelta(days=1)
                else:
                    break

            result.append({
                "id": hid,
                "title": h["title"],
                "phase": h["phase"],
                "micro_target": h["micro_target"],
                "frequency": json.loads(h["frequency"]) if h["frequency"] else [],
                "identity_pillar": h["identity_pillar"],
                "today_status": today_log["status"] if today_log else None,
                "skip_reason": today_log["skip_reason"] if today_log else "",
                "streak": streak,
                "week_log": week_log,
                "month_log": month_log,
            })
    return result


@app.get("/api/habits/monthly")
async def get_habits_monthly(user=Depends(get_current_user)):
    uid = user["sub"]
    today = _today_jkt()
    year, month = today.year, today.month
    import calendar as cal_mod
    days_in_month = cal_mod.monthrange(year, month)[1]
    month_start = f"{year}-{month:02d}-01"
    month_end = f"{year}-{month:02d}-{days_in_month:02d}"
    with get_db() as conn:
        rows = conn.execute(
            """SELECT CAST(strftime('%d', hl.date) AS INTEGER) as day, COUNT(*) as done_count
               FROM habit_logs hl
               JOIN habits h ON h.id = hl.habit_id
               WHERE h.user_id = ? AND hl.status = 'done'
                 AND hl.date >= ? AND hl.date <= ?
               GROUP BY hl.date ORDER BY hl.date""",
            (uid, month_start, month_end)
        ).fetchall()
    done_by_day = {r["day"]: r["done_count"] for r in rows}
    today_day = today.day
    result = [{"day": d, "done": done_by_day.get(d, 0)} for d in range(1, days_in_month + 1)]
    days_with_data = [r for r in result if r["day"] <= today_day]
    avg = round(sum(r["done"] for r in days_with_data) / max(len(days_with_data), 1), 1) if days_with_data else 0
    return {"days": result, "avg": avg, "today_day": today_day, "days_in_month": days_in_month}


@app.get("/api/habits/logs")
async def get_habit_logs(since: str = "", user=Depends(get_current_user)):
    uid = user["sub"]
    if not since:
        since = (_today_jkt() - timedelta(days=90)).isoformat()
    with get_db() as conn:
        rows = conn.execute(
            """SELECT hl.habit_id, hl.date, hl.status, hl.skip_reason
               FROM habit_logs hl JOIN habits h ON h.id = hl.habit_id
               WHERE h.user_id = ? AND hl.date >= ?
               ORDER BY hl.date""",
            (uid, since),
        ).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/habits/monthly-completion")
async def get_habits_monthly_completion(user=Depends(get_current_user)):
    """
    Returns daily habit completion data for the last 30 days.
    Used for calendar heatmap visualization.
    """
    uid = user["sub"]
    since = (_today_jkt() - timedelta(days=29)).isoformat()
    with get_db() as conn:
        total_habits = conn.execute(
            "SELECT COUNT(*) AS n FROM habits WHERE user_id = ?", (uid,)
        ).fetchone()["n"]
        rows = conn.execute(
            """SELECT hl.date AS date,
                      SUM(CASE WHEN hl.status = 'done' THEN 1 ELSE 0 END) AS done_count
               FROM habit_logs hl
               JOIN habits h ON h.id = hl.habit_id
               WHERE h.user_id = ? AND hl.date >= ?
               GROUP BY hl.date
               ORDER BY hl.date DESC""",
            (uid, since),
        ).fetchall()
        days = [
            {"date": r["date"], "total_habits": total_habits, "done_count": r["done_count"]}
            for r in rows
        ]
        return {"days": days}


@app.post("/api/habits/{habit_id}/checkin")
async def checkin_habit(habit_id: int, req: HabitCheckinReq, user=Depends(get_current_user)):
    uid = user["sub"]
    if req.status not in ("done", "skipped", "uncheck"):
        raise HTTPException(status_code=400, detail="status harus done, skipped, atau uncheck")
    log_date = req.date if req.date else _today_jkt().isoformat()
    with get_db() as conn:
        row = conn.execute("SELECT id FROM habits WHERE id = ? AND user_id = ?", (habit_id, uid)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Habit tidak ditemukan")
        if req.status == "uncheck":
            conn.execute("DELETE FROM habit_logs WHERE habit_id = ? AND date = ?", (habit_id, log_date))
        else:
            conn.execute(
                """INSERT INTO habit_logs (habit_id, date, status, skip_reason)
                   VALUES (?,?,?,?)
                   ON CONFLICT(habit_id, date) DO UPDATE SET status=excluded.status, skip_reason=excluded.skip_reason""",
                (habit_id, log_date, req.status, req.skip_reason)
            )
    return {"ok": True, "habit_id": habit_id, "date": log_date, "status": req.status}


# ── Scratchpad Notes ──────────────────────────────────────────────────────────

def _note_with_drawing_sync(conn, note_id: int, uid: int, now: str, move: bool = False) -> dict:
    """Jalankan sinkron drawing (spec §4.4) untuk note sebagaimana tersimpan; kembalikan dua daftar respons.
    move=True hanya bila tulisan ini menetapkan atau mengubah list_id note (POST note baru ber-list_id, PATCH share,
    PUT/POST idempoten yang mengganti list_id): semua token drawing pribadi aktor dipindah ke workspace note.
    Tulisan lain (PUT/autosave biasa, POST idempoten tanpa ganti list_id, restore dari trash) tidak memindah apa pun;
    token yang tak dipindah dilaporkan di unresolved_drawings. Lihat drawing_scope.pull_note_drawings_into_list."""
    stored = conn.execute("SELECT list_id, content FROM scratchpad_notes WHERE id = ?", (note_id,)).fetchone()
    return drawing_scope.pull_note_drawings_into_list(conn, stored, uid, now, move)


def _scratchpad_row_synced(row, conn, uid, sync: dict) -> dict:
    out = _scratchpad_row(row, conn, uid)
    out["moved_drawings"] = sync["moved_drawings"]
    out["unresolved_drawings"] = sync["unresolved_drawings"]
    return out


def _scratchpad_row(row, conn=None, uid=None) -> dict:
    d = dict(row)
    d["server_id"] = d.get("id")
    if conn and d.get("id"):
        # DISTINCT: baris entity_tags lama per-editor bisa memuat nama tag yang sama dari user berbeda (audit T7)
        tag_rows = conn.execute("""
            SELECT DISTINCT t.name FROM tags t
            JOIN entity_tags et ON t.id = et.tag_id
            WHERE et.entity_type = 'note' AND et.entity_id = ?
            ORDER BY t.name ASC
        """, (d["id"],)).fetchall()
        d["tags"] = [r["name"] for r in tag_rows]
    else:
        try: d["tags"] = json.loads(d.get("tags") or "[]")
        except Exception: d["tags"] = []
    try: d["linked_task_ids"] = json.loads(d.get("linked_task_ids") or "[]")
    except Exception: d["linked_task_ids"] = []
    try: d["linked_to"] = json.loads(d.get("linked_to") or "[]")
    except Exception: d["linked_to"] = []

    # Per-user pinning from note_pins table
    if conn and uid is not None and d.get("id"):
        pin_row = conn.execute(
            "SELECT 1 FROM note_pins WHERE user_id = ? AND note_id = ?", (uid, d["id"])
        ).fetchone()
        d["pinned"] = bool(pin_row)
    else:
        d["pinned"] = bool(d.get("pinned", 0))

    # Owner info
    if conn and d.get("user_id"):
        owner = conn.execute(
            "SELECT username, display_name FROM users WHERE id = ?", (d["user_id"],)
        ).fetchone()
        if owner:
            d["owner_username"] = owner["username"]
            d["owner_display_name"] = owner["display_name"]

    # Last editor info
    if conn and d.get("last_edited_by") and d["last_edited_by"] != d.get("user_id"):
        editor = conn.execute(
            "SELECT username, display_name FROM users WHERE id = ?", (d["last_edited_by"],)
        ).fetchone()
        if editor:
            d["last_editor_username"] = editor["username"]
            d["last_editor_display_name"] = editor["display_name"]

    if not d["linked_task_ids"] and d.get("linked_task_id"):
        d["linked_task_ids"] = [d["linked_task_id"]]
    if conn and d["linked_task_ids"]:
        ids = d["linked_task_ids"]
        ph = ",".join("?" * len(ids))
        tasks = conn.execute(
            f"SELECT id, title, priority, gtd_status FROM tasks WHERE id IN ({ph})", ids
        ).fetchall()
        d["linked_tasks"] = [dict(t) for t in tasks]
    else:
        d["linked_tasks"] = []
    if not d.get("linked_task_title") and d["linked_tasks"]:
        d["linked_task_title"] = d["linked_tasks"][0]["title"]
    return d

def _parse_wikilinks(content: str) -> list[str]:
    """Extract [[Title]] references, handling remark-stringify escaped form \\[\\[...\\]\\]."""
    import re as _re
    raw = _re.findall(r"(?:\\?\[){2}([^\[\]\\]+)(?:\\?\]){2}", content)
    parsed = [t.split("|")[0].strip() for t in raw]
    return list(dict.fromkeys(t for t in parsed if t))

def _slugify(title: str) -> str:
    """Convert note title to URL-safe slug fragment."""
    import re as _re
    s = (title or "untitled").strip().lower()
    s = _re.sub(r'[^\w\s-]', '', s)  # remove non-word chars (keep spaces, hyphens)
    s = _re.sub(r'[-\s]+', '-', s)   # spaces/hyphens → single hyphen
    return s.strip('-')[:80] or "untitled"

def _generate_publish_slug(conn, title: str = "") -> str:
    """Generate unique slug: slugified-title + 4-char random suffix."""
    import secrets as _secrets
    base = _slugify(title or "untitled")
    for _ in range(999):
        suffix = _secrets.token_urlsafe(3)[:4].lower()
        slug = f"{base}-{suffix}"
        exists = conn.execute("SELECT 1 FROM published_notes WHERE slug = ?", (slug,)).fetchone()
        if not exists:
            return slug
    raise HTTPException(status_code=500, detail="Gagal generate slug unik — coba lagi")

# ── Akses publik drawing ───────────────────────────────────────────────────────
# Drawing tampil di halaman publik hanya bila dirujuk ::draw[token] oleh note publish yang terbuka bagi request dan:
# (a) note TEPERCAYA (isinya hanya ditulis penerbit: pribadi/list_id kosong, milik penerbit, dan terakhir disunting
# pemiliknya, last_edited_by kosong atau = pemilik) dan drawing itu bisa diakses PENERBIT (miliknya, atau di workspace
# tempat ia owner/anggota); atau (b) note publish BERSAMA di workspace W dan drawings.list_id = W (spec §3 setelah PR 2).
# Pada (b) rujukan saja tidak membuka drawing di luar W: anggota ikut mengedit isi note bersama, jadi ::draw[1..N] yang
# disisipkan anggota tidak boleh membuka drawing pribadi pemilik. Drawing W memang milik bersama anggota W.
# list_id kosong saja tidak cukup untuk (a): note yang sempat diedit orang lain lalu kembali pribadi (workspace dihapus =
# list_id SET NULL, atau di-unshare) tetap membawa isi suntikan itu, sehingga last_edited_by harus pemiliknya.
# Token = id angka atau client_id (UUID, format default sejak offline-first). Bentuk ter-escape oleh
# serializer markdown (::draw\[x\]) ikut dikenali.
_DRAW_DIRECTIVE_RE = drawing_scope.DRAW_DIRECTIVE_RE  # definisi di drawing_scope.py (dipakai bersama)
_DRAW_TOKEN_RE = re.compile(r'[0-9a-zA-Z_-]+')
_DRAWING_COLS = "id, user_id, client_id, title, svg_preview, data_json, list_id"

_draw_tokens = drawing_scope.draw_tokens
_draw_token_id = drawing_scope.draw_token_id

def _pub_note_unlocked(request: Request, slug: str, password_hash: Optional[str]) -> bool:
    """True bila note publish tanpa password, atau request membawa cookie unlock yang valid untuk slug-nya."""
    if not password_hash:
        return True
    cookie_val = request.cookies.get(f"pub_unlock_{slug}", "")
    try:
        return bool(cookie_val) and _verify_cookie(cookie_val) == slug
    except TypeError:  # hmac.compare_digest menolak str non-ASCII: cookie rusak = terkunci, bukan 500
        return False

def _published_drawing_for_request(conn, token: str, request: Request) -> Optional[sqlite3.Row]:
    """Drawing yang boleh dibaca publik lewat /pub/drawings/{token}, atau None.
    Kandidat: drawing ber-id token (bila angka) dan drawing ber-client_id token (milik siapa pun).
    Kandidat D lolos bila note publish TEPERCAYA milik D.user_id merujuknya lewat ::draw[...] (id atau client_id)
    dan note itu terbuka bagi request ini (tanpa password, atau cookie unlock valid). Tepercaya = pribadi (list_id
    kosong), milik penerbit, dan terakhir disunting pemiliknya (lihat catatan di atas). Rujukan saja tidak cukup:
    note bersama, atau note yang terakhir disunting orang lain, tidak dihitung karena isinya bukan tulisan penerbit."""
    if not _DRAW_TOKEN_RE.fullmatch(token):
        return None
    candidates = []
    did = _draw_token_id(token)
    if did is not None:
        row = conn.execute(f"SELECT {_DRAWING_COLS} FROM drawings WHERE id = ?", (did,)).fetchone()
        if row:
            candidates.append(row)
    candidates.extend(conn.execute(
        f"SELECT {_DRAWING_COLS} FROM drawings WHERE client_id = ? ORDER BY id", (token,)).fetchall())
    for d in candidates:
        refs = drawing_scope.refs_of(d)
        # Penerbit dibatasi di SQL (endpoint tanpa login): note tepercaya hanya dari pemilik drawing, atau owner/anggota
        # workspace drawing (mereka yang bisa mengaksesnya); note bersama hanya di workspace drawing.
        published = conn.execute(
            "SELECT p.slug, p.password_hash, n.content "
            "FROM published_notes p JOIN scratchpad_notes n ON n.id = p.note_id "
            # SQLite LIKE tak peka huruf besar/kecil untuk ASCII: ::DRAW ikut lolos prefilter ini
            "WHERE n.content LIKE '%::draw%' AND ("
            "  (n.list_id IS NULL AND n.user_id = p.user_id "
            "   AND (n.last_edited_by IS NULL OR n.last_edited_by = n.user_id) "
            "   AND (p.user_id = ? OR p.user_id IN ("
            "     SELECT owner_id FROM shared_lists WHERE id = ? UNION SELECT user_id FROM list_members WHERE list_id = ?))) "
            "  OR (n.list_id IS NOT NULL AND n.list_id = ?))",
            (d["user_id"], d["list_id"], d["list_id"], d["list_id"])
        ).fetchall()
        for p in published:
            if (_draw_tokens(p["content"]) & refs) and _pub_note_unlocked(request, p["slug"], p["password_hash"]):
                return d
    return None

_PUB_MD_PLUGINS = ['table', 'url', 'strikethrough', 'task_lists']


def _pub_markdown(plugins):
    """mistune 3 untuk isi note publik: HTML mentah di-escape (escape=True), href/src lewat safehtml.safe_url.
    Link ditolak → teksnya saja; gambar ditolak → teks alt saja. ImportError bila mistune tidak ada."""
    import mistune
    from mistune.renderers.html import HTMLRenderer
    from mistune.util import safe_entity, striptags, unescape

    class _PubHTMLRenderer(HTMLRenderer):
        def text(self, text):
            # entity tetap didecode lalu di-escape ulang (perilaku lama escape=False), keluaran selalu ter-escape
            return safe_entity(text)

        def block_html(self, html):
            # HTML blok mentah → teks ter-escape TANPA pembungkus <p> (bawaan mistune escape=True membungkus <p>),
            # sama dengan renderer html() klien; allowlist (<details>/<summary>/…) dikembalikan sesudahnya, jadi
            # <details> tidak berada di dalam <p>.
            return safehtml.escape_html(html.strip()) + "\n"

        def link(self, text, url, title=None):
            href = safehtml.safe_url(url)
            if href is None:
                return text
            s = '<a href="' + safehtml.escape_attr(href) + '"'
            if title:
                s += ' title="' + safehtml.escape_attr(unescape(title)) + '"'
            return s + '>' + text + '</a>'

        def image(self, text, url, title=None):
            alt = striptags(text)  # anak-anaknya sudah ter-escape (termasuk ")
            src = safehtml.safe_url(url, image=True)
            if src is None:
                return alt
            s = '<img src="' + safehtml.escape_attr(src) + '" alt="' + alt + '"'
            if title:
                s += ' title="' + safehtml.escape_attr(unescape(title)) + '"'
            return s + ' />'

    return mistune.create_markdown(escape=True, renderer=_PubHTMLRenderer(escape=True), plugins=plugins)


def _render_pub_markdown_fallback(text: str) -> str:
    """Renderer cadangan (mistune tidak bisa di-import / gagal): semua teks di-escape, hanya heading, paragraf,
    dan tabel. Link/gambar tidak dibuat (tampil sebagai teks markdown). Allowlist dikembalikan pemanggil."""
    esc = safehtml.escape_html
    out = []
    tbl_rows = []

    def _cells(row):
        return [c.strip() for c in row.strip('|').split('|')]

    def _flush_tbl():
        if not tbl_rows:
            return
        res = ['<table>']
        has_header = len(tbl_rows) >= 2 and all(c in '-: |' for c in tbl_rows[1])
        start_idx = 0
        if has_header:
            res.append('<thead><tr>' + ''.join(f'<th>{esc(c)}</th>' for c in _cells(tbl_rows[0])) + '</tr></thead>')
            start_idx = 2
        res.append('<tbody>')
        for r in tbl_rows[start_idx:]:
            res.append('<tr>' + ''.join(f'<td>{esc(c)}</td>' for c in _cells(r)) + '</tr>')
        res.append('</tbody></table>')
        out.append(''.join(res))
        tbl_rows.clear()

    for line in (text or '').split('\n'):
        stripped = line.strip()
        if stripped.startswith('|') and (stripped.endswith('|') or '|' in stripped[1:]):
            tbl_rows.append(stripped)
            continue
        _flush_tbl()
        if not stripped:
            continue
        m = re.match(r'(#{1,3}) (.*)$', stripped)
        if m:
            lvl = len(m.group(1))
            out.append(f'<h{lvl}>{esc(m.group(2))}</h{lvl}>')
        else:
            out.append(f'<p>{esc(line)}</p>')
    _flush_tbl()
    return '\n'.join(out)


def _render_pub_markdown(content: str) -> str:
    """Markdown isi note publik → HTML ter-escape (sebelum allowlist dan placeholder kartu)."""
    for plugins in (_PUB_MD_PLUGINS, None):
        try:
            return _pub_markdown(plugins)(content)
        except ImportError:
            break
        except Exception:
            logging.getLogger(__name__).exception("mistune gagal merender note publik (plugins=%s)", plugins)
    return _render_pub_markdown_fallback(content)


def _fill_pub_placeholders(rendered: str, cards: dict, fallback: dict, nonce: str) -> str:
    """Ganti placeholder kartu dengan HTML buatan Alurik dalam satu lintasan (HTML sisipan tidak dipindai ulang).
    Kartu drawing yang berdiri sendiri sebagai paragraf dipasang tanpa <p>. Placeholder di dalam tag (mis. alt
    gambar, title link) diganti teks ter-escape, bukan markup, supaya tidak bisa keluar dari atribut."""
    if not cards:
        return rendered
    # semua kunci berbentuk TFM(WIKI|DRAWBLK)<nonce>X<n>END (nonce hex per render); pola umum + lookup dict
    # (bukan alternation semua kunci, yang lambat untuk note dengan ribuan wikilink)
    key_pat = rf'TFM(?:WIKI|DRAWBLK|MEDIA){re.escape(nonce)}X\d+END'
    key_re = re.compile(key_pat)

    def _card(key):
        return cards.get(key, '')

    def _sub(m):
        if m.group(1):
            key = m.group(1)
            return _card(key) if key.startswith(('TFMDRAWBLK', 'TFMMEDIA')) else f'<p>{_card(key)}</p>'
        if m.group(2):
            return key_re.sub(lambda k: fallback.get(k.group(0), ''), m.group(2))
        return _card(m.group(3))

    return re.sub(rf'<p>({key_pat})</p>|(<[^>]*>)|({key_pat})', _sub, rendered)


# Ukuran pratinjau SVG drawing di kartu publik (img mengikuti container; script halaman memakai nilai sama)
_PUB_SVG_IMG_STYLE = "width:100%;height:auto;max-height:100%;display:block;object-fit:contain"


def _pub_path(username: str, slug: str) -> str:
    """Path /pub/{username}/{slug} untuk header Location: tiap segmen di-percent-encode (tanpa escape HTML),
    supaya username/slug berisi %xx, /, ?, # tetap kembali ke halaman yang sama."""
    return f"/pub/{urllib.parse.quote(username, safe='')}/{urllib.parse.quote(slug, safe='')}"


def _pub_href(username: str, slug: str) -> str:
    """Path /pub/{username}/{slug} yang aman ditanam di atribut href. Username dan slug target berasal dari
    data user lain (username tidak dibatasi karakternya): tiap segmen di-percent-encode lalu di-escape HTML."""
    def seg(value):
        return html.escape(urllib.parse.quote(value, safe=''), quote=True)
    return f"/pub/{seg(username)}/{seg(slug)}"

def _render_published_content(raw_content: str, conn, note_id: int = None, owner_id: int = None,
                              list_id: int = None) -> str:
    """Process raw markdown for public page: strip internal tokens, resolve wikilinks, render to HTML.
    owner_id = penerbit note publish tepercaya (pribadi, milik penerbit, terakhir disunting pemiliknya); token
    ::draw[...] di-resolve ke drawing yang bisa diakses penerbit, dan wikilink ke note berpassword hanya di-resolve bila note
    target milik penerbit yang sama.
    owner_id=None = tidak ada note berpassword yang di-resolve; drawing hanya di-resolve bila list_id terisi (note bersama di W):
    drawing ber-list_id = W. Note yang terakhir disunting orang lain tanpa list_id = tidak ada drawing."""
    import re as _re
    content = raw_content or ""
    # Kartu buatan Alurik (wikilink ter-resolve, drawing) disisipkan lewat placeholder SETELAH markdown di-escape dan
    # allowlist dikembalikan (spec XSS §2.3). Nonce per render: teks placeholder yang diketik pengguna tidak cocok.
    ph_nonce = secrets.token_hex(4)
    cards = {}          # placeholder -> HTML aman
    card_fallback = {}  # placeholder -> teks ter-escape bila placeholder berada di dalam atribut (mis. alt gambar)

    # 1. Strip tasklink tokens
    content = _re.sub(r'\\?\[tasklink:[0-9a-f-]+\]', '', content)

    # 2. ==highlight== → <mark>…</mark>. Tag ini ikut di-escape mistune lalu dikembalikan oleh allowlist
    # (safehtml.restore_allowed_tags), jadi isi highlight selalu ter-escape.
    content = _re.sub(r'\\?==([^=\n]+)==', r'<mark>\1</mark>', content)

    # 3. Build wikilink map: title → (username, slug) for published notes.
    # Target berpassword hanya jadi target bila owner_id (penerbit note tepercaya) = penerbit target; selain itu
    # diperlakukan seperti note yang tidak dipublish (teks biasa), supaya slug dan judulnya tidak bocor lewat note orang lain.
    def _wikilink_target_ok(password_hash, target_user_id):
        return not password_hash or (owner_id is not None and target_user_id == owner_id)

    published_map = {}
    for row in conn.execute(
        "SELECT n.title, p.slug, p.password_hash, p.user_id, u.username FROM published_notes p JOIN scratchpad_notes n ON n.id = p.note_id JOIN users u ON u.id = p.user_id"
    ).fetchall():
        if not _wikilink_target_ok(row["password_hash"], row["user_id"]):
            continue
        key = row["title"].strip().lower()
        published_map[key] = (row["username"], row["slug"])

    # 4. Rewrite [[wikilink]] → placeholder kartu tautan (judul di-escape); tidak ter-resolve → teks markdown biasa
    def _wikilink_card(title, href):
        key = f"TFMWIKI{ph_nonce}X{len(cards)}END"
        cards[key] = f'<a href="{href}">[[{safehtml.escape_html(title)}]]</a>'
        card_fallback[key] = safehtml.escape_attr(f'[[{title}]]')
        return key

    def _replace_wikilink(m):
        raw = m.group(1).replace('\\(', '(').replace('\\)', ')')
        title = raw.split("|")[0].strip()
        norm = title.strip().lower()
        # Check by title
        if norm in published_map:
            uname, uslug = published_map[norm]
            return _wikilink_card(title, _pub_href(uname, uslug))
        # Check by id: "id:N" / "note:N" / N polos. Id yang tidak bisa jadi id baris (digit Unicode, di luar
        # INTEGER SQLite) = tidak ditemukan, bukan 500 (note bersama bisa disunting anggota lain).
        m_id = _re.match(r'^(?:(?:id|note)\s*:\s*)?(\d+)$', norm)
        nid = _draw_token_id(m_id.group(1)) if m_id else None
        if nid is not None:
            row2 = conn.execute(
                "SELECT p.slug, p.password_hash, p.user_id, u.username FROM published_notes p JOIN users u ON u.id = p.user_id WHERE p.note_id = ?", (nid,)
            ).fetchone()
            if row2 and _wikilink_target_ok(row2["password_hash"], row2["user_id"]):
                return _wikilink_card(title, _pub_href(row2["username"], row2["slug"]))
        # Not published → plain text
        return f'[[{title}]]'

    content = _re.sub(r'(?:\\?\[){2}([^\[\]\\]+)(?:\\?\]){2}', _replace_wikilink, content)

    # 5. Unescape markdown image / link escapes that serializer might produce
    content = _re.sub(
        r'\\?!\s*\\?\[\s*(.*?)\s*\\?\]\s*\\?\(\s*(.*?)\s*\\?\)',
        lambda m: '![' + m.group(1).replace(r'\]', ']').replace(r'\[', '[').strip() + '](' + m.group(2).replace(r'\)', ')').replace(r'\(', '(').strip() + ')',
        content
    )
    content = _re.sub(
        r'(?<!\!)(\[|\\\[)\s*(.*?)\s*\\?\]\s*\\?\(\s*(.*?)\s*\\?\)',
        lambda m: '[' + m.group(2).replace(r'\]', ']').replace(r'\[', '[').strip() + '](' + m.group(3).replace(r'\)', ')').replace(r'\(', '(').strip() + ')',
        content
    )

    # 5.1 Rewrite all attachment URLs to public endpoint
    content = _re.sub(
        r'/api/scratchpad/attachments/(\d+)(?:/view|/download)?',
        r'/pub/attachments/\1',
        content
    )

    # 5.2 Promote image links and resolve local attachment filenames
    IMAGE_EXTS = ('.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico')
    att_map = {}
    if note_id:
        try:
            for a in conn.execute("SELECT id, original_name FROM note_attachments WHERE note_id = ? AND kind != 'media'", (note_id,)).fetchall():
                name = a["original_name"] if isinstance(a, sqlite3.Row) or isinstance(a, dict) else a[1]
                aid = a["id"] if isinstance(a, sqlite3.Row) or isinstance(a, dict) else a[0]
                if name:
                    att_map[str(name).strip().lower()] = aid
        except Exception:
            pass

    import os as _os
    def _replace_img_target(m):
        prefix = m.group(1)
        label = m.group(2)
        target = m.group(3).strip()

        bname = _os.path.basename(target).lower()
        label_clean = label.replace('\\', '').strip().lower()

        is_image_file = (
            prefix.startswith('!') or
            any(label_clean.endswith(ext) for ext in IMAGE_EXTS) or
            any(bname.endswith(ext) for ext in IMAGE_EXTS) or
            bname in att_map or
            label_clean in att_map
        )
        pfx = '![' if is_image_file else prefix

        if target.startswith('/pub/attachments/') or target.startswith('http://') or target.startswith('https://') or target.startswith('data:'):
            return f'{pfx}{label}]({target})'

        if bname in att_map:
            return f'{pfx}{label}](/pub/attachments/{att_map[bname]})'

        if label_clean in att_map and (not target or target == bname or target == label_clean):
            return f'{pfx}{label}](/pub/attachments/{att_map[label_clean]})'

        return f'{pfx}{label}]({target})'

    content = _re.sub(r'(!?\[)([^\]]*?)\]\(([^)]*?)\)', _replace_img_target, content)

    if att_map:
        for name, aid in att_map.items():
            if any(name.endswith(ext) for ext in IMAGE_EXTS):
                # Replace [name.png] without URL
                content = _re.sub(rf'(?<!\!)\[\s*{_re.escape(name)}\s*\](?!\()', f'![{name}](/pub/attachments/{aid})', content, flags=_re.IGNORECASE)
                # Replace standalone name.png on its own line
                content = _re.sub(rf'(?m)^\s*{_re.escape(name)}\s*$', f'![{name}](/pub/attachments/{aid})', content, flags=_re.IGNORECASE)

    # 5.3 Normalize and unescape markdown tables for mistune
    lines = content.split('\n')
    new_lines = []
    in_table = False

    for line in lines:
        stripped = line.strip()
        is_table_row = bool(
            _re.search(r'^\s*\\?\|', stripped) or
            _re.search(r'\\?\|\s*$', stripped) or
            _re.search(r'\\?\|.*\\?\|', stripped)
        ) and bool(_re.search(r'\\?\|', stripped))

        is_delimiter = bool(_re.search(r'\\?\|\s*\\?:?-{2,}\\?:?\s*\\?\|', stripped)) or bool(_re.search(r'^\s*\\?:?-{2,}\\?:?\s*\\?\|\s*\\?:?-{2,}\\?:?', stripped))

        if is_delimiter or (is_table_row and ('\\|' in line or '\\-' in line or '\\:' in line)):
            line = _re.sub(r'\\([|:\-])', r'\1', line)
            stripped = line.strip()

        is_now_table = bool(_re.search(r'^\s*\|', stripped)) and bool(_re.search(r'\|\s*$', stripped) or '|' in stripped[1:])
        if is_now_table and not in_table:
            if new_lines and new_lines[-1].strip() != '':
                new_lines.append('')
            in_table = True
        elif not is_now_table and in_table:
            if stripped != '':
                new_lines.append('')
            in_table = False

        new_lines.append(line)

    content = '\n'.join(new_lines)

    # 6. Checklist [ ] / [x] → read-only
    content = _re.sub(r'^(\s*)- \[ \]', r'\1- ☐', content, flags=_re.MULTILINE)
    content = _re.sub(r'^(\s*)- \[[xX]\]', r'\1- ☑', content, flags=_re.MULTILINE)

    # 6.4. ::media[client_id]{name="..."} -> kartu pemutar. Hanya lampiran media milik note yang sedang dirender
    # (note_id + client_id + kind='media') dan berstatus ready; selain itu kartu "tidak tersedia" tanpa nama file.
    def _replace_media(m):
        key = f"TFMMEDIA{ph_nonce}X{len(cards)}END"
        card_fallback[key] = ""
        cid = m.group(1)
        attr_name = ""
        if m.group(2):
            nm = _re.search(r'\bname\s*=\s*(?:\\?"([^"\\]*)\\?"|\\?\'([^\'\\]*)\\?\')', m.group(2))
            if nm:
                attr_name = nm.group(1) or nm.group(2) or ""
        row = None
        if note_id is not None:
            row = conn.execute(
                "SELECT id, original_name, media_type, duration_ms, poster_key, status FROM note_attachments "
                "WHERE note_id = ? AND client_id = ? AND kind = 'media'", (note_id, cid)).fetchone()
        if not row or row["status"] != "ready":
            cards[key] = '<figure class="pub-media pub-media-missing">Media tidak tersedia</figure>'
            return key
        urls = _media_urls(row["id"], bool(row["poster_key"]), int(_time.time()))
        src = safehtml.escape_attr(urls["play_url"])
        if row["media_type"] == "video":
            poster = f' poster="{safehtml.escape_attr(urls["poster_url"])}"' if urls["poster_url"] else ""
            player = f'<video controls preload="metadata" playsinline src="{src}"{poster}></video>'
        else:
            player = f'<audio controls preload="metadata" src="{src}"></audio>'
        caption = safehtml.escape_html(row["original_name"] or attr_name)
        dur = format_duration(row["duration_ms"])
        if dur:
            caption += f" · {dur}"
        cards[key] = (f'<figure class="pub-media">{player}<figcaption>{caption}</figcaption>'
                      f'<a href="{safehtml.escape_attr(urls["download_url"])}">Unduh</a></figure>')
        return key

    content = MEDIA_DIRECTIVE_RE.sub(_replace_media, content)

    # 6.5. Process ::draw[id]{...} tokens → extract and replace with placeholder
    def _replace_draw(m):
        key = f"TFMDRAWBLK{ph_nonce}X{len(cards)}END"
        card_fallback[key] = ""
        drawing_id = m.group(1)
        attr_raw = m.group(2) or ""

        # Parse attributes (title, width, height, size)
        attrs = {}
        if attr_raw:
            unescaped = _re.sub(r'\\(["\'])', r'\1', attr_raw)
            for am in _re.finditer(r'([a-zA-Z0-9_-]+)\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s\}]+))', unescaped):
                k = am.group(1).lower()
                v = am.group(2) or am.group(3) or am.group(4) or ''
                attrs[k] = v
        # size/width/height berasal dari isi note dan masuk ke atribut style/data-*: hanya nilai valid yang dipakai,
        # selebihnya default (spec XSS §2.3). Semua nilai tetap ditulis lewat escape_attr.
        attrs = safehtml.safe_draw_attrs(attrs)

        title = attrs.get('title')
        size = attrs.get('size', '').upper()
        width = attrs.get('width', '')
        height = attrs.get('height', '')

        if not size:
            if width in ('40%', '50%', 'small'):
                size = 'S'
            elif width in ('70%', '75%', 'medium'):
                size = 'M'
            else:
                size = 'L'

        width_val = width or ('50%' if size == 'S' else '75%' if size == 'M' else '100%')
        height_val = height or ('200px' if size == 'S' else '300px' if size == 'M' else '400px')

        # Note tepercaya (owner_id): drawing yang bisa diakses penerbit (id angka, lalu client_id). Note bersama
        # (list_id): hanya drawing ber-list_id = W. Keduanya None = tidak ada. Judul dan id note tidak jadi kunci.
        d_row = drawing_scope.resolve_for_publish(conn, drawing_id, owner_id, list_id, _DRAWING_COLS)

        if d_row and not title:
            title = d_row["title"]
        if not title:
            title = "Gambar"

        safe_title = safehtml.escape_html(title)
        card_style = f"width:{width_val};max-width:{width_val};margin:16px auto;" if width_val != '100%' else "width:100%;margin:16px 0;"
        a_size = safehtml.escape_attr(size)
        a_style = safehtml.escape_attr(card_style)
        a_height = safehtml.escape_attr(height_val)

        if not d_row:
            # Token tak ter-resolve: kartu netral tanpa data-drawing-id/-preview dan tanpa iframe,
            # supaya halaman tidak memanggil /pub/drawings/<token> dan tidak menanam gambar siapa pun.
            cards[key] = (
                f'<div class="note-draw-card" data-size="{a_size}" style="{a_style}">'
                f'<div class="note-draw-header"><span>🎨 {safe_title}</span></div>'
                f'<div class="note-draw-preview-container" style="height:{a_height};max-height:{a_height};">Gambar tidak tersedia</div>'
                f'</div>'
            )
            return key

        actual_id = d_row["id"]
        a_id = safehtml.escape_attr(str(actual_id))
        # SVG tidak pernah ditanam sebagai markup (spec XSS §3): <img data:> base64, alt = judul ter-escape
        svg_html = safehtml.svg_img_tag(d_row["svg_preview"] or "", title, style=_PUB_SVG_IMG_STYLE)
        if svg_html is None:
            svg_html = f'<iframe src="/static/vendor/tldraw/index.html?noteId={a_id}" style="width:100%;height:{a_height};border:none;" title="Drawing"></iframe>'

        cards[key] = (
            f'<div class="note-draw-card" data-drawing-id="{a_id}" data-size="{a_size}" style="{a_style}">'
            f'<div class="note-draw-header"><span>🎨 {safe_title}</span></div>'
            f'<div class="note-draw-preview-container" data-drawing-preview="{a_id}" style="height:{a_height};max-height:{a_height};">{svg_html}</div>'
            f'</div>'
        )
        return key

    content = _DRAW_DIRECTIVE_RE.sub(_replace_draw, content)

    # 7. Markdown → HTML: mistune escape=True (HTML mentah jadi teks), link/gambar lewat safehtml.safe_url;
    # 7.1 allowlist tag (<br>, <details>, <summary>, <mark>) dikembalikan dari bentuk ter-escape (bukan di dalam kode);
    # 8. baru setelah itu placeholder kartu diganti HTML buatan Alurik. Urutan ini wajib (spec XSS §2.4).
    rendered_html = _render_pub_markdown(content)
    rendered_html = safehtml.restore_allowed_tags(rendered_html)
    return _fill_pub_placeholders(rendered_html, cards, card_fallback, ph_nonce)

def _resolve_linked_to(titles: list[str], user_id: int, conn) -> list[int]:
    """Resolve note titles/IDs to note IDs. Handles plain titles, id:N, and numeric IDs."""
    if not titles:
        return []
    import re as _re
    by_title, by_id = [], []
    for t in titles:
        m = _re.match(r'^(?:id|note)\s*:\s*(\d+)$', t, _re.IGNORECASE)
        if m:
            by_id.append(int(m.group(1)))
        elif _re.match(r'^\d+$', t):
            by_id.append(int(t))
        else:
            by_title.append(t)

    access_clause, access_params = _note_access_clause(user_id)
    ids: list[int] = []

    if by_title:
        placeholders = ",".join("?" * len(by_title))
        rows = conn.execute(
            f"SELECT id, title FROM scratchpad_notes WHERE {access_clause} AND title IN ({placeholders})",
            access_params + by_title,
        ).fetchall()
        title_map = {r["title"].strip().lower(): r["id"] for r in rows}
        for t in by_title:
            found = title_map.get(t.strip().lower())
            if found and found not in ids:
                ids.append(found)

    if by_id:
        placeholders = ",".join("?" * len(by_id))
        ac2, ap2 = _note_access_clause(user_id)
        rows = conn.execute(
            f"SELECT id FROM scratchpad_notes WHERE {ac2} AND id IN ({placeholders})",
            ap2 + by_id,
        ).fetchall()
        for r in rows:
            if r["id"] not in ids:
                ids.append(r["id"])

    return ids

def _note_access_clause(uid: int, prefix: str = "") -> tuple[str, list]:
    """SQL WHERE fragment + params: notes owned by uid OR shared via list membership.
    Use prefix='s' when scratchpad_notes is aliased as 's' in the query.
    """
    p = f"{prefix}." if prefix else ""
    clause = (
        f"({p}user_id = ? OR {p}list_id IN ("
        "  SELECT id FROM shared_lists WHERE owner_id = ?"
        "  UNION SELECT list_id FROM list_members WHERE user_id = ?"
        "))"
    )
    return clause, [uid, uid, uid]

def _mindmap_access_clause(uid: int, prefix: str = "") -> tuple[str, list]:
    """SQL WHERE fragment + params: mindmaps owned by uid OR shared via list membership."""
    p = f"{prefix}." if prefix else ""
    clause = (
        f"({p}user_id = ? OR {p}list_id IN ("
        "  SELECT id FROM shared_lists WHERE owner_id = ?"
        "  UNION SELECT list_id FROM list_members WHERE user_id = ?"
        "))"
    )
    return clause, [uid, uid, uid]


# Petakan: data_json peta tertaut hanya pengaturan tampilan; isi pohon selalu dari catatan.
LINKED_VIEW_STATE_DEFAULT = '{"linked":1,"direction":2,"justify":false,"collapsed":[],"summary":true}'


def _mindmap_enrich(d: dict, conn, uid: Optional[int] = None) -> dict:
    """Add last_editor_username/display_name when last_edited_by is set and != owner.
    Bila uid diberikan, is_pinned dihitung dari mindmap_pins (pin pribadi per user)."""
    if uid is not None:
        d["is_pinned"] = 1 if conn.execute(
            "SELECT 1 FROM mindmap_pins WHERE user_id = ? AND mindmap_id = ?", (uid, d["id"])
        ).fetchone() else 0
    if d.get("last_edited_by") and d["last_edited_by"] != d.get("user_id"):
        editor = conn.execute(
            "SELECT username, display_name FROM users WHERE id = ?", (d["last_edited_by"],)
        ).fetchone()
        if editor:
            d["last_editor_username"] = editor["username"]
            d["last_editor_display_name"] = editor["display_name"]
    d.pop("search_text", None)  # kolom pencarian internal (hingga 1 MB), jangan ikut respons
    return d

def _sync_linked_mindmap(conn, note_id: int) -> None:
    """Petakan: peta tertaut mengikuti list_id/judul/pemilik catatannya (dipanggil setelah tiap tulis catatan,
    di koneksi/transaksi yang sama). No-op bila catatan tidak ada; updated_at hanya berubah bila ada yang berubah."""
    note = conn.execute(
        "SELECT user_id, list_id, title FROM scratchpad_notes WHERE id = ?", (note_id,)
    ).fetchone()
    if not note:
        return
    title = note["title"] or "Tanpa judul"
    conn.execute(
        "UPDATE mindmaps SET list_id = ?, title = ?, user_id = ?, updated_at = ? "
        "WHERE source_note_id = ? AND (list_id IS NOT ? OR title IS NOT ? OR user_id IS NOT ?)",
        (note["list_id"], title, note["user_id"], datetime.now(_TZ_JKT).isoformat(), note_id,
         note["list_id"], title, note["user_id"]),
    )


def _delete_linked_mindmaps(conn, note_ids: list) -> None:
    """Petakan: hapus permanen peta tertaut milik catatan yang dihapus permanen (purge Sampah),
    beserta pin pribadinya (mindmap_pins) dan peta tertaut yang sedang di Sampah mindmap."""
    ids = [int(i) for i in dict.fromkeys(note_ids) if i is not None]
    for i in range(0, len(ids), 500):
        chunk = ids[i:i + 500]
        marks = ','.join('?' * len(chunk))
        conn.execute(
            "DELETE FROM mindmap_pins WHERE mindmap_id IN "
            f"(SELECT id FROM mindmaps WHERE source_note_id IN ({marks}))", chunk
        )
        conn.execute(f"DELETE FROM mindmaps WHERE source_note_id IN ({marks})", chunk)
        _ensure_trashed_mindmaps_table(conn)
        conn.execute(f"DELETE FROM trashed_mindmaps WHERE source_note_id IN ({marks})", chunk)


def _sanitize_fts5_token(token: str) -> str:
    cleaned = re.sub(r'[^\w\s-]', '', token).strip(' -')
    if not cleaned:
        return ""
    return f'"{cleaned}"*'


def _parse_note_search_query(q: str = "", tag: str = "") -> tuple[list[str], list[str], str, str]:
    positive_tags: list[str] = []
    if tag and tag.strip():
        positive_tags.append(tag.strip().lower())

    negative_tags: list[str] = []
    if q:
        neg_matches = re.findall(r'(?:^|\s)-tag:(\S+)', q, flags=re.IGNORECASE)
        for t in neg_matches:
            nt = t.strip().lower()
            if nt and nt not in negative_tags:
                negative_tags.append(nt)

        pos_matches = re.findall(r'(?:^|\s)tag:(\S+)', q, flags=re.IGNORECASE)
        for t in pos_matches:
            pt = t.strip().lower()
            if pt and pt not in positive_tags:
                positive_tags.append(pt)

        # Clean text
        clean = re.sub(r'(?:^|\s)-tag:\S+', ' ', q, flags=re.IGNORECASE)
        clean = re.sub(r'(?:^|\s)tag:\S+', ' ', clean, flags=re.IGNORECASE).strip()
    else:
        clean = ""

    # Build FTS match expression
    fts_parts = []
    if clean:
        words = clean.split()
        for w in words:
            san = _sanitize_fts5_token(w)
            if san:
                fts_parts.append(san)
    fts_query = " ".join(fts_parts)

    return positive_tags, negative_tags, clean, fts_query


@app.get("/api/scratchpad")
async def list_scratchpad(q: str = "", tag: str = "", user=Depends(get_current_user)):
    uid = user["sub"]
    access_clause, access_params = _note_access_clause(uid, prefix="s")
    pos_tags, neg_tags, clean_text, fts_query = _parse_note_search_query(q, tag)

    with get_db() as conn:
        where_clauses = [f"({access_clause})"]
        params = list(access_params)

        for pt in pos_tags:
            where_clauses.append("""
                EXISTS (
                    SELECT 1 FROM entity_tags et
                    JOIN tags t ON t.id = et.tag_id
                    WHERE et.entity_id = s.id AND et.entity_type = 'note' AND t.name = ?
                )
            """)
            params.append(pt)

        for nt in neg_tags:
            where_clauses.append("""
                NOT EXISTS (
                    SELECT 1 FROM entity_tags et
                    JOIN tags t ON t.id = et.tag_id
                    WHERE et.entity_id = s.id AND et.entity_type = 'note' AND t.name = ?
                )
            """)
            params.append(nt)

        if fts_query:
            fts_where = list(where_clauses)
            fts_params = list(params)
            fts_where.append("fts.scratchpad_notes_fts MATCH ?")
            fts_params.append(fts_query)
            sql = f"""
                SELECT s.* FROM scratchpad_notes s
                JOIN scratchpad_notes_fts fts ON fts.rowid = s.id
                WHERE {' AND '.join(fts_where)}
                ORDER BY fts.rank, s.updated_at DESC
            """
            try:
                rows = conn.execute(sql, fts_params).fetchall()
                return note_comments.apply_summaries(conn, uid, [_scratchpad_row(r, conn, uid) for r in rows])
            except sqlite3.OperationalError:
                pass  # Fallback to LIKE query if FTS expression fails

        # Fallback / non-FTS query
        fallback_clauses = list(where_clauses)
        fallback_params = list(params)
        if clean_text:
            fallback_clauses.append("(s.title LIKE ? OR s.content LIKE ?)")
            fallback_params.extend([f"%{clean_text}%", f"%{clean_text}%"])

        sql = f"""
            SELECT s.* FROM scratchpad_notes s
            WHERE {' AND '.join(fallback_clauses)}
            ORDER BY s.updated_at DESC
        """
        rows = conn.execute(sql, fallback_params).fetchall()
        return note_comments.apply_summaries(conn, uid, [_scratchpad_row(r, conn, uid) for r in rows])

# ── Note Trash (snapshot ke trashed_notes; lihat docs/superpowers/specs/2026-10-02-note-trash-design.md) ──

NOTE_TRASH_RETENTION_DAYS = 30

def _ensure_trashed_notes_table(conn) -> None:
    """Lazy-create trashed_notes table if missing (self-healing after deploy tanpa restart)."""
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS trashed_notes (
                note_id       INTEGER PRIMARY KEY,
                user_id       INTEGER NOT NULL,
                title         TEXT NOT NULL DEFAULT '',
                snapshot_json TEXT NOT NULL,
                deleted_at    TEXT NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_trashed_user ON trashed_notes(user_id, deleted_at)")
    except Exception:
        pass

def _table_columns(conn, table: str) -> list[str]:
    try:
        return [r["name"] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()]
    except Exception:
        return []

def _snapshot_note_to_trash(conn, note_row, fallback_uid=None) -> None:
    """Tulis snapshot lengkap note (semua kolom + tag + pin + publish + lampiran) ke trashed_notes.
    Dipanggil di dalam transaksi hapus; JANGAN commit di sini."""
    _ensure_trashed_notes_table(conn)
    nid = note_row["id"]
    note = dict(note_row)  # SELECT * -> semua kolom, termasuk hasil migrasi
    note_uid = note.get("user_id") or fallback_uid
    if note_uid is None:
        try:
            u_row = conn.execute("SELECT id FROM users ORDER BY id ASC LIMIT 1").fetchone()
            note_uid = u_row[0] if u_row else 1
        except Exception:
            note_uid = 1
    tags = []
    try:
        tags = [r["name"] for r in conn.execute(
            "SELECT t.name FROM tags t JOIN entity_tags et ON et.tag_id = t.id "
            "WHERE et.entity_type = 'note' AND et.entity_id = ? ORDER BY t.name", (nid,)).fetchall()]
    except Exception:
        pass
    pins = []
    try:
        pins = [r["user_id"] for r in conn.execute(
            "SELECT user_id FROM note_pins WHERE note_id = ?", (nid,)).fetchall()]
    except Exception:
        pass
    pub = None
    try:
        pub_row = conn.execute(
            "SELECT slug, password_hash, published_at, user_id FROM published_notes WHERE note_id = ?", (nid,)
        ).fetchone()
        if pub_row:
            pub = dict(pub_row)
    except Exception:
        pass
    atts = []
    try:
        atts = [dict(r) for r in conn.execute(
            "SELECT * FROM note_attachments WHERE note_id = ? ORDER BY id", (nid,)).fetchall()]
    except Exception:
        pass
    snap = {"note": note, "tags": tags, "pins": pins,
            "published": pub, "attachments": atts}
    try:
        conn.execute(
            "INSERT OR REPLACE INTO trashed_notes (note_id, user_id, title, snapshot_json, deleted_at) VALUES (?,?,?,?,?)",
            (nid, note_uid, note.get("title") or "", json.dumps(snap, ensure_ascii=False),
             datetime.now(_TZ_JKT).isoformat()))
    except Exception:
        try:
            conn.execute("PRAGMA foreign_keys=OFF")
            conn.execute(
                "INSERT OR REPLACE INTO trashed_notes (note_id, user_id, title, snapshot_json, deleted_at) VALUES (?,?,?,?,?)",
                (nid, note_uid, note.get("title") or "", json.dumps(snap, ensure_ascii=False),
                 datetime.now(_TZ_JKT).isoformat()))
            conn.execute("PRAGMA foreign_keys=ON")
        except Exception:
            pass

def _purge_expired_trashed_notes(conn) -> None:
    """Lazy purge: hapus permanen item trash yang lewat masa retensi."""
    _ensure_trashed_notes_table(conn)
    cutoff = (datetime.now(_TZ_JKT) - timedelta(days=NOTE_TRASH_RETENTION_DAYS)).isoformat()
    try:
        expired = [r["note_id"] for r in conn.execute(
            "SELECT note_id FROM trashed_notes WHERE deleted_at < ?", (cutoff,)).fetchall()]
        # Peta tertaut dihapus DULU, baru baris sampah: kegagalan tidak boleh meninggalkan peta yatim.
        _delete_linked_mindmaps(conn, expired)
        _purge_trashed_media(conn, expired)
        conn.execute("DELETE FROM trashed_notes WHERE deleted_at < ?", (cutoff,))
        note_comments.delete_for_notes(conn, expired)
    except Exception:
        pass
    _cleanup_stuck_media_uploads(conn, _media_utcnow())

def _trash_preview(content: str, limit: int = 120) -> str:
    # Potong dulu: regex link di bawah bisa kuadratik pada content panjang (mis. 'a[' * 50000 ≈ 18 dtk,
    # memblokir event loop); preview hanya memakai ≤limit char pertama.
    s = (content or "")[:2000]
    s = re.sub(r"::draw\[[^\]]*\]", " ", s, flags=re.IGNORECASE)
    s = MEDIA_DIRECTIVE_RE.sub(" ", s)
    s = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", s)               # [teks](url) -> teks
    s = re.sub(r"(?:\\?\[){2}([^\[\]\\|]*)(?:\|[^\[\]\\]*)?(?:\\?\]){2}", r"\1", s)  # [[Judul|alias]] -> Judul
    s = re.sub(r"[#*_`~>|\[\]\\]", "", s)
    return re.sub(r"\s+", " ", s).strip()[:limit]

def _trash_days_left(deleted_at: str, days: int = NOTE_TRASH_RETENTION_DAYS) -> int:
    try:
        dt = datetime.fromisoformat(deleted_at)
        if dt.tzinfo is None:
            dt = _TZ_JKT.localize(dt)
    except Exception:
        return 0
    remaining = dt + timedelta(days=days) - datetime.now(_TZ_JKT)
    return max(0, math.ceil(remaining.total_seconds() / 86400))

# ── Sampah mindmap (snapshot ke trashed_mindmaps; spec 2026-10-19 mindmap findings §5) ──

MINDMAP_TRASH_RETENTION_DAYS = 30


def _ensure_trashed_mindmaps_table(conn) -> None:
    """Lazy-create trashed_mindmaps (self-healing setelah deploy tanpa restart)."""
    try:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS trashed_mindmaps (
                mindmap_id     INTEGER PRIMARY KEY,
                user_id        INTEGER NOT NULL,
                title          TEXT NOT NULL DEFAULT '',
                list_id        INTEGER,
                source_note_id INTEGER,
                client_id      TEXT,
                snapshot_json  TEXT NOT NULL,
                deleted_at     TEXT NOT NULL,
                deleted_by     INTEGER
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_trashed_mm_user ON trashed_mindmaps(user_id, deleted_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_trashed_mm_note ON trashed_mindmaps(source_note_id) "
                     "WHERE source_note_id IS NOT NULL")
    except Exception:
        pass


def _mindmap_plain(topic) -> str:
    """Teks polos topic node mindmap (tanpa HTML/markdown inline)."""
    s = str(topic or "")[:2000]
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", s)
    s = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", s)
    s = re.sub(r"\*\*|__|~~|==|`", "", s)
    s = re.sub(r"^#{1,6}\s*", "", s)
    return re.sub(r"\s+", " ", s).strip()


def _mindmap_topics(data_json) -> list:
    """Topic polos semua node, pre-order (root dulu), yang kosong dilewati. JSON rusak/tanpa nodeData → []."""
    try:
        data = json.loads(data_json or "")
    except Exception:
        return []
    root = data.get("nodeData") if isinstance(data, dict) else None
    if not isinstance(root, dict):
        return []
    out = []
    stack = [root]
    while stack:
        node = stack.pop()
        if not isinstance(node, dict):
            continue
        t = _mindmap_plain(node.get("topic"))
        if t:
            out.append(t)
        kids = node.get("children")
        if isinstance(kids, list):
            stack.extend(reversed(kids))
    return out


def _mindmap_search_text(data_json) -> str:
    return "\n".join(_mindmap_topics(data_json))[:1_000_000]


def _mindmap_match_snippet(search_text: str, q: str, length: int = 80) -> str:
    """Baris pertama teks node yang memuat q (tanpa beda huruf), dipotong di sekitar kecocokan."""
    ql = q.casefold()
    if not ql:
        return ""
    for line in (search_text or "").split("\n"):
        lc = line.casefold()
        if ql not in lc:
            continue
        if len(line) <= length:
            return line
        i = lc.index(ql)
        start = max(0, min(i - (length - len(q)) // 2, len(line) - length))
        out = line[start:start + length]
        if start > 0:
            out = "…" + out
        if start + length < len(line):
            out += "…"
        return out
    return ""


def _mindmap_outline_md(data: dict) -> str:
    root = data["nodeData"]
    lines = ["# " + (_mindmap_plain(root.get("topic")) or "Tanpa judul")]
    stack = [(c, 1) for c in reversed(root.get("children") or [])]
    body = []
    while stack:
        node, d = stack.pop()
        if not isinstance(node, dict):
            continue
        body.append("  " * (d - 1) + "- " + _mindmap_plain(node.get("topic")))
        stack.extend((c, d + 1) for c in reversed(node.get("children") or []))
    if body:
        lines.append("")
        lines.extend(body)
    return "\n".join(lines) + "\n"


def _snapshot_mindmap_to_trash(conn, row, uid) -> None:
    """Tulis snapshot peta (SELECT * + pin) ke trashed_mindmaps. Dipanggil di transaksi hapus; JANGAN commit."""
    _ensure_trashed_mindmaps_table(conn)
    mm = dict(row)
    pins = [r["user_id"] for r in conn.execute(
        "SELECT user_id FROM mindmap_pins WHERE mindmap_id = ?", (mm["id"],)).fetchall()]
    snap = {"mindmap": mm, "pins": pins}
    conn.execute(
        "INSERT OR REPLACE INTO trashed_mindmaps (mindmap_id, user_id, title, list_id, source_note_id, client_id, "
        "snapshot_json, deleted_at, deleted_by) VALUES (?,?,?,?,?,?,?,?,?)",
        (mm["id"], mm["user_id"], mm.get("title") or "", mm.get("list_id"), mm.get("source_note_id"),
         mm.get("client_id"), json.dumps(snap, ensure_ascii=False), datetime.now(_TZ_JKT).isoformat(), uid))


def _purge_expired_trashed_mindmaps(conn) -> None:
    """Lazy purge: hapus permanen item Sampah mindmap yang lewat masa retensi."""
    _ensure_trashed_mindmaps_table(conn)
    cutoff = (datetime.now(_TZ_JKT) - timedelta(days=MINDMAP_TRASH_RETENTION_DAYS)).isoformat()
    try:
        conn.execute("DELETE FROM trashed_mindmaps WHERE deleted_at < ?", (cutoff,))
    except Exception:
        pass

# Rute statis /trash HARUS di atas /api/scratchpad/{note_id} (int) agar tidak 422.
@app.get("/api/scratchpad/trash")
async def list_trashed_notes(user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        _purge_expired_trashed_notes(conn)
        rows = conn.execute(
            "SELECT note_id, title, snapshot_json, deleted_at FROM trashed_notes "
            "WHERE user_id = ? OR user_id = ? OR user_id IS NULL OR user_id = '' ORDER BY deleted_at DESC",
            (uid, str(uid))).fetchall()
    out = []
    for r in rows:
        try:
            snap = json.loads(r["snapshot_json"])
        except Exception:
            snap = {}
        note = snap.get("note") or {}
        out.append({
            "id": r["note_id"],
            "title": r["title"],
            "preview": _trash_preview(note.get("content", "")),
            "tags": snap.get("tags") or [],
            "list_id": note.get("list_id"),
            "deleted_at": r["deleted_at"],
            "days_left": _trash_days_left(r["deleted_at"]),
        })
    return out

@app.post("/api/scratchpad/trash/{note_id}/restore")
async def restore_trashed_note(note_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        _purge_expired_trashed_notes(conn)
        trow = conn.execute(
            "SELECT snapshot_json FROM trashed_notes WHERE note_id = ? AND (user_id = ? OR user_id = ? OR user_id IS NULL OR user_id = '')",
            (note_id, uid, str(uid))
        ).fetchone()
        if not trow:
            raise HTTPException(status_code=404, detail="Note tidak ada di Sampah")
        if conn.execute("SELECT 1 FROM scratchpad_notes WHERE id = ?", (note_id,)).fetchone():
            raise HTTPException(status_code=409, detail="Note dengan id ini sudah ada")
        snap = json.loads(trow["snapshot_json"])
        note = dict(snap.get("note") or {})
        note["id"] = note_id
        note["user_id"] = uid

        def _user_exists(user_id) -> bool:
            return user_id is not None and conn.execute(
                "SELECT 1 FROM users WHERE id = ?", (user_id,)).fetchone() is not None

        # list_id: harus masih ada dan user masih owner/anggota, kalau tidak -> NULL
        lid = note.get("list_id")
        if lid is not None:
            ok = conn.execute(
                "SELECT 1 FROM shared_lists WHERE id = ? AND (owner_id = ? OR id IN "
                "(SELECT list_id FROM list_members WHERE user_id = ?))", (lid, uid, uid)).fetchone()
            if not ok:
                note["list_id"] = None
        # task tertaut yang sudah hilang dibuang
        def _task_exists(tid) -> bool:
            return conn.execute("SELECT 1 FROM tasks WHERE id = ?", (tid,)).fetchone() is not None
        if note.get("linked_task_id") is not None and not _task_exists(note["linked_task_id"]):
            note["linked_task_id"] = None
        try:
            ids = json.loads(note.get("linked_task_ids") or "[]")
        except Exception:
            ids = []
        note["linked_task_ids"] = json.dumps([t for t in ids if _task_exists(t)])
        # client_id bentrok dengan note lain milik user -> NULL
        if note.get("client_id") and conn.execute(
            "SELECT 1 FROM scratchpad_notes WHERE user_id = ? AND client_id = ?",
            (uid, note["client_id"])).fetchone():
            note["client_id"] = None
        # last_edited_by user yang sudah tidak ada -> NULL
        if note.get("last_edited_by") is not None and not _user_exists(note["last_edited_by"]):
            note["last_edited_by"] = None

        live_cols = set(_table_columns(conn, "scratchpad_notes"))
        cols = [c for c in note if c in live_cols]
        conn.execute(
            f"INSERT INTO scratchpad_notes ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
            [note[c] for c in cols])

        _upsert_tags_for_note(conn, note_id, uid, snap.get("tags") or [])
        for pid in dict.fromkeys(snap.get("pins") or []):
            if _user_exists(pid):
                conn.execute("INSERT OR IGNORE INTO note_pins (user_id, note_id) VALUES (?, ?)", (pid, note_id))

        pub = snap.get("published")
        if pub and not conn.execute(
                "SELECT 1 FROM published_notes WHERE slug = ?", (pub.get("slug"),)).fetchone():
            conn.execute(
                "INSERT INTO published_notes (note_id, user_id, slug, password_hash, published_at) VALUES (?,?,?,?,?)",
                (note_id, pub["user_id"] if _user_exists(pub.get("user_id")) else uid,
                 pub["slug"], pub.get("password_hash"), pub["published_at"]))

        att_cols = set(_table_columns(conn, "note_attachments"))
        for a in snap.get("attachments") or []:
            a = dict(a)
            a["note_id"] = note_id
            if not _user_exists(a.get("user_id")):
                a["user_id"] = uid
            acols = [c for c in a if c in att_cols]
            conn.execute(
                f"INSERT OR IGNORE INTO note_attachments ({','.join(acols)}) VALUES ({','.join('?' * len(acols))})",
                [a[c] for c in acols])

        conn.execute("DELETE FROM trashed_notes WHERE note_id = ?", (note_id,))
        _sync_linked_mindmap(conn, note_id)
        sync = _note_with_drawing_sync(conn, note_id, uid, datetime.now(_TZ_JKT).isoformat(), move=False)
        note_comments.touch_for_note(conn, note_id, note.get("list_id"), datetime.now(_TZ_JKT).isoformat())
        conn.commit()
        # Media yang dibuang saat masih 'processing' diantrekan lagi sekarang, bukan menunggu restart.
        for r in conn.execute("SELECT id FROM note_attachments WHERE note_id = ? AND status = 'processing'",
                              (note_id,)).fetchall():
            media_worker.enqueue(r["id"])
        restored = conn.execute(_NOTE_SELECT, (note_id,)).fetchone()
        return _scratchpad_row_synced(restored, conn, uid, sync)

@app.delete("/api/scratchpad/trash/{note_id}")
async def purge_trashed_note(note_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        _ensure_trashed_notes_table(conn)
        allowed = "note_id = ? AND (user_id = ? OR user_id = ? OR user_id IS NULL OR user_id = '')"
        if conn.execute(f"SELECT 1 FROM trashed_notes WHERE {allowed}", (note_id, uid, str(uid))).fetchone():
            _purge_trashed_media(conn, [note_id])
        cur = conn.execute(f"DELETE FROM trashed_notes WHERE {allowed}", (note_id, uid, str(uid)))
        if cur.rowcount:
            _delete_linked_mindmaps(conn, [note_id])
            note_comments.delete_for_notes(conn, [note_id])
    return {"ok": True}

@app.delete("/api/scratchpad/trash")
async def empty_trashed_notes(user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        _ensure_trashed_notes_table(conn)
        mine = [r["note_id"] for r in conn.execute(
            "SELECT note_id FROM trashed_notes WHERE user_id = ? OR user_id = ? OR user_id IS NULL OR user_id = ''",
            (uid, str(uid))).fetchall()]
        _purge_trashed_media(conn, mine)
        # Atomik: RETURNING memberi id persis baris yang terhapus (tanpa celah SELECT→DELETE).
        gone = [r["note_id"] for r in conn.execute(
            "DELETE FROM trashed_notes WHERE user_id = ? OR user_id = ? OR user_id IS NULL OR user_id = '' RETURNING note_id",
            (uid, str(uid))).fetchall()]
        deleted = len(gone)
        _delete_linked_mindmaps(conn, gone)
        note_comments.delete_for_notes(conn, gone)
    return {"ok": True, "deleted": deleted}

@app.get("/api/scratchpad/recent")
async def recent_scratchpad(user=Depends(get_current_user)):
    uid = user["sub"]
    access_clause, access_params = _note_access_clause(uid)
    with get_db() as conn:
        rows = conn.execute(f"""
            SELECT * FROM scratchpad_notes
            WHERE {access_clause}
            ORDER BY updated_at DESC LIMIT 5
        """, access_params).fetchall()
        return [_scratchpad_row(r, conn, uid) for r in rows]

@app.get("/api/scratchpad/pinned")
async def pinned_scratchpad(user=Depends(get_current_user)):
    uid = user["sub"]
    access_clause, access_params = _note_access_clause(uid, prefix="s")
    with get_db() as conn:
        rows = conn.execute(f"""
            SELECT s.* FROM scratchpad_notes s
            JOIN note_pins np ON np.note_id = s.id AND np.user_id = ?
            WHERE {access_clause}
            ORDER BY s.updated_at DESC
        """, [uid] + access_params).fetchall()
        return [_scratchpad_row(r, conn, uid) for r in rows]

_NOTE_SELECT = "SELECT * FROM scratchpad_notes WHERE id = ?"

@app.get("/api/scratchpad/titles")
async def get_note_titles(user=Depends(get_current_user)):
    """Return all accessible note id+title pairs for wikilink autocomplete."""
    uid = user["sub"]
    access_clause, access_params = _note_access_clause(uid, prefix="s")
    with get_db() as conn:
        rows = conn.execute(f"""
            SELECT s.id, s.title, s.user_id, s.list_id,
                   u.username AS owner_username, u.display_name AS owner_display_name
            FROM scratchpad_notes s
            LEFT JOIN users u ON u.id = s.user_id
            WHERE {access_clause}
              AND s.title != ''
            ORDER BY s.updated_at DESC
        """, access_params).fetchall()
    return [dict(r) for r in rows]


# ── Note Saved Searches ───────────────────────────────────────────────────────

@app.get("/api/scratchpad/saved-searches")
async def list_saved_searches(user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, name, query, created_at FROM note_saved_searches WHERE user_id = ? ORDER BY created_at DESC",
            (uid,)
        ).fetchall()
        return [dict(r) for r in rows]

@app.post("/api/scratchpad/saved-searches")
async def create_saved_search(payload: dict, user=Depends(get_current_user)):
    uid = user["sub"]
    name = (payload.get("name") or "").strip()
    query = (payload.get("query") or "").strip()
    if not name or not query:
        raise HTTPException(status_code=400, detail="Nama dan kueri pencarian wajib diisi")
    now_iso = datetime.now(_TZ_JKT).isoformat()
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO note_saved_searches (user_id, name, query, created_at) VALUES (?, ?, ?, ?)",
            (uid, name, query, now_iso)
        )
        return {"id": cur.lastrowid, "name": name, "query": query, "created_at": now_iso}

@app.delete("/api/scratchpad/saved-searches/{sid}")
async def delete_saved_search(sid: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        row = conn.execute(
            "SELECT id FROM note_saved_searches WHERE id = ? AND user_id = ?",
            (sid, uid)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Pencarian tersimpan tidak ditemukan")
        conn.execute("DELETE FROM note_saved_searches WHERE id = ? AND user_id = ?", (sid, uid))
        return {"ok": True}


@app.get("/api/habit-templates")
async def list_habit_templates():
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM habit_templates ORDER BY kategori, subkategori, id"
        ).fetchall()
        return [dict(r) for r in rows]

@app.post("/api/habit-templates")
async def create_habit_template(req: HabitTemplateCreate, user=Depends(get_admin_user)):
    with get_db() as conn:
        cur = conn.execute(
            """INSERT INTO habit_templates (kategori, subkategori, type, item, frequency, priority, difficulty, tags)
               VALUES (?,?,?,?,?,?,?,?)""",
            (req.kategori, req.subkategori, req.type, req.item,
             req.frequency, req.priority, req.difficulty, json.dumps(req.tags))
        )
        row = conn.execute("SELECT * FROM habit_templates WHERE id = ?", (cur.lastrowid,)).fetchone()
        return dict(row)

@app.put("/api/habit-templates/{template_id}")
async def update_habit_template(template_id: int, req: HabitTemplateUpdate, user=Depends(get_admin_user)):
    with get_db() as conn:
        existing = conn.execute("SELECT id FROM habit_templates WHERE id = ?", (template_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Template tidak ditemukan")
        conn.execute(
            """UPDATE habit_templates SET
               kategori=?, subkategori=?, type=?, item=?, frequency=?, priority=?, difficulty=?, tags=?
               WHERE id=?""",
            (req.kategori, req.subkategori, req.type, req.item,
             req.frequency, req.priority, req.difficulty, json.dumps(req.tags), template_id)
        )
        row = conn.execute("SELECT * FROM habit_templates WHERE id = ?", (template_id,)).fetchone()
        return dict(row)

@app.delete("/api/habit-templates/{template_id}")
async def delete_habit_template(template_id: int, user=Depends(get_admin_user)):
    with get_db() as conn:
        existing = conn.execute("SELECT id FROM habit_templates WHERE id = ?", (template_id,)).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Template tidak ditemukan")
        conn.execute("DELETE FROM habit_templates WHERE id = ?", (template_id,))
    return {"ok": True}

class AdminEmailTestReq(BaseModel):
    to: Optional[str] = None


@app.get("/api/admin/email/status")
async def admin_email_status(user=Depends(get_admin_user)):
    summary = mailer.smtp_summary()
    since = email_outbox.iso(email_outbox.utcnow() - timedelta(days=7))
    with get_db() as conn:
        counts = {"sent": 0, "failed": 0, "queued": 0, "expired": 0}
        for r in conn.execute(
                "SELECT status, COUNT(*) AS n FROM email_outbox WHERE created_at >= ? GROUP BY status", (since,)):
            key = "queued" if r["status"] in ("queued", "sending") else r["status"]
            if key in counts:
                counts[key] += r["n"]
        rows = conn.execute(
            "SELECT id, kind, to_addr, status, attempts, last_error, created_at, sent_at"
            " FROM email_outbox ORDER BY id DESC LIMIT 20").fetchall()
    return {
        **summary,
        "worker_alive": email_worker.is_alive(),
        "counts_7d": counts,
        "recent": [{"id": r["id"], "kind": r["kind"], "to": email_outbox.mask_email(r["to_addr"]),
                    "status": r["status"], "attempts": r["attempts"], "last_error": r["last_error"],
                    "created_at": r["created_at"], "sent_at": r["sent_at"]} for r in rows],
    }


@app.post("/api/admin/email/test")
async def admin_email_send_test(req: AdminEmailTestReq, user=Depends(get_admin_user)):
    to = (req.to or "").strip()
    with get_db() as conn:
        if not to:
            row = conn.execute("SELECT email FROM users WHERE id = ?", (user["sub"],)).fetchone()
            to = ((row["email"] if row else None) or "").strip()
        if not to:
            raise HTTPException(status_code=400, detail="Isi alamat tujuan atau tambahkan email di Pengaturan")
        if not EMAIL_RE.match(to):
            raise HTTPException(status_code=400, detail="Format email tidak valid")
        now = email_outbox.utcnow()
        hour_ago = email_outbox.iso(now - timedelta(hours=1))
        n = conn.execute("SELECT COUNT(*) FROM email_outbox WHERE kind = 'test' AND created_at >= ?",
                         (hour_ago,)).fetchone()[0]
        if n >= 5:
            raise HTTPException(status_code=429, detail="Batas 5 email tes per jam tercapai, coba lagi nanti")
        summary = mailer.smtp_summary()
        sent_at = now.replace(tzinfo=timezone.utc).astimezone(_TZ_JKT).strftime("%d %b %Y %H:%M WIB")
        rendered = email_templates.smtp_test(summary["host"], summary["port"], summary["security"], sent_at)
        email_id = email_outbox.enqueue(conn, kind="test", to_addr=to, rendered=rendered,
                                        user_id=user["sub"], now=now)
    email_worker.wake()
    return {"id": email_id}


@app.post("/api/admin/email/{email_id}/retry")
async def admin_email_retry(email_id: int, user=Depends(get_admin_user)):
    with get_db() as conn:
        row = conn.execute("SELECT status, kind, expires_at FROM email_outbox WHERE id = ?",
                           (email_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Email tidak ditemukan")
        if row["status"] != "failed":
            raise HTTPException(status_code=400, detail="Hanya email berstatus gagal yang bisa dicoba lagi")
        now = email_outbox.utcnow()
        if row["kind"] == "reset" and row["expires_at"] and row["expires_at"] <= email_outbox.iso(now):
            raise HTTPException(status_code=400, detail="Link reset sudah kedaluwarsa — minta reset baru")
        ts = email_outbox.iso(now)
        conn.execute("UPDATE email_outbox SET status='queued', attempts=0, next_attempt_at=?, updated_at=?"
                     " WHERE id = ? AND status = 'failed'", (ts, ts, email_id))
    email_worker.wake()
    return {"ok": True}


@app.get("/api/admin/users")
async def list_admin_users(user=Depends(get_admin_user)):
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, username, display_name, is_admin, created_at FROM users ORDER BY id"
        ).fetchall()
        return [dict(r) for r in rows]

@app.put("/api/admin/users/{target_id}/toggle-admin")
async def toggle_admin(target_id: int, user=Depends(get_admin_user)):
    if target_id == user["sub"]:
        raise HTTPException(status_code=400, detail="Tidak bisa mengubah status admin diri sendiri")
    with get_db() as conn:
        row = conn.execute("SELECT id, is_admin FROM users WHERE id = ?", (target_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User tidak ditemukan")
        new_val = 0 if row["is_admin"] else 1
        conn.execute("UPDATE users SET is_admin = ? WHERE id = ?", (new_val, target_id))
    return {"id": target_id, "is_admin": new_val}

_ALLOWED_ATTACH_MIME = {
    "image/png", "image/jpeg", "image/webp", "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.visio",
    "application/vnd.ms-visio.drawing",
    "application/vnd.ms-visio.drawing.macroEnabled",
    "application/vnd.ms-project",
    "image/vnd.dwg",
    "image/vnd.dxf",
    "application/acad",
    "application/x-acad",
    "application/dwg",
    "application/dxf",
}

# Lampiran task & file workspace (tipe bebas, lintas anggota): mime_type klien hanya disimpan bila ada di daftar ini;
# selain itu application/octet-stream (XSS: text/html, image/svg+xml, XML, JS tidak pernah tersimpan sebagai tipe
# yang bisa dirender). Unduhan tetap Content-Disposition: attachment.
_SAFE_UPLOAD_MIME = frozenset(_ALLOWED_ATTACH_MIME | {
    "image/gif",
    "text/plain", "text/csv", "text/markdown",
    "application/rtf",
    "application/vnd.oasis.opendocument.text",
    "application/vnd.oasis.opendocument.spreadsheet",
    "application/vnd.oasis.opendocument.presentation",
    "application/zip", "application/x-zip-compressed", "application/x-7z-compressed",
    "application/vnd.rar", "application/x-rar-compressed", "application/gzip", "application/x-tar",
})
_UNSAFE_UPLOAD_MIME = frozenset({
    "text/html", "image/svg+xml", "application/xhtml+xml", "text/xml", "application/xml",
    "application/javascript", "text/javascript",
})
assert not (_SAFE_UPLOAD_MIME & _UNSAFE_UPLOAD_MIME)


def _safe_upload_mime(mime_type) -> str:
    """Tipe dasar (tanpa parameter, huruf kecil) bila ada di _SAFE_UPLOAD_MIME, selain itu octet-stream."""
    base = (mime_type or "").split(";", 1)[0].strip().lower()
    return base if base in _SAFE_UPLOAD_MIME else "application/octet-stream"


@app.post("/api/scratchpad/{note_id}/attachments")
async def upload_note_attachment(note_id: int, file: UploadFile = FastAPIFile(...), user=Depends(get_current_user)):
    import requests as _req
    uid = user["sub"]
    with get_db() as conn:
        note = _accessible_note(conn, uid, note_id)
        if not note:
            raise HTTPException(status_code=404, detail="Note tidak ditemukan")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail=f"File terlalu besar. Maks {MAX_FILE_SIZE // (1024*1024)}MB")

    original_name = file.filename or "file"
    mime_type = file.content_type or mimetypes.guess_type(original_name)[0] or "application/octet-stream"
    if mime_type not in _ALLOWED_ATTACH_MIME:
        raise HTTPException(status_code=415, detail="Tipe file tidak diizinkan. Gunakan PNG, JPG, WebP, atau PDF")

    ext = Path(original_name).suffix or ""
    nc_path = f"{NEXTCLOUD_FOLDER}/{uuid.uuid4()}{ext}"

    _nc_ensure_folder()
    r = _req.put(_nc_dav_url(nc_path), data=content, auth=_nc_auth(), timeout=60,
                 headers={"Content-Type": mime_type})
    if r.status_code not in (200, 201, 204):
        raise HTTPException(status_code=500, detail=f"Upload ke Nextcloud gagal: {r.status_code}")

    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO note_attachments (note_id, user_id, nextcloud_path, original_name, file_size, mime_type) VALUES (?,?,?,?,?,?)",
            (note_id, uid, nc_path, original_name, len(content), mime_type)
        )
        conn.commit()
        row = conn.execute("SELECT * FROM note_attachments WHERE id=?", (cur.lastrowid,)).fetchone()
        return dict(row)

@app.get("/api/scratchpad/{note_id}/attachments")
async def list_note_attachments(note_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        note = _accessible_note(conn, uid, note_id)
        if not note:
            raise HTTPException(status_code=404, detail="Note tidak ditemukan")
        rows = conn.execute(
            "SELECT * FROM note_attachments WHERE note_id=? ORDER BY id", (note_id,)
        ).fetchall()
        return [dict(r) for r in rows]

def _row_get(row, col):
    """Baca kolom dari sqlite3.Row atau dict tanpa pernah melempar; kolom hilang -> None."""
    try:
        return row[col]
    except (KeyError, IndexError, TypeError):
        return None


def _delete_media_files(row) -> None:
    """Hapus file media (storage_key, poster_key) dan semua sisa sementara `.tmp/<id>.*` milik baris itu.
    Menerima sqlite3.Row atau dict (kolom boleh hilang). Tidak pernah melempar: kegagalan hanya dicatat di log."""
    try:
        att_id = int(_row_get(row, "id"))
    except (TypeError, ValueError):
        att_id = None
    for col in ("storage_key", "poster_key"):
        key = _row_get(row, col)
        if not key:
            continue
        try:
            media_storage.delete(key)
        except Exception:
            logger.warning("hapus file media gagal: id=%s kolom=%s", att_id, col, exc_info=True)
    if att_id is None:
        return
    try:
        tmp_dir = media_storage.temp_path(att_id).parent
        for p in tmp_dir.glob(f"{att_id}.*"):
            try:
                p.unlink()
            except FileNotFoundError:
                pass
            except OSError:
                logger.warning("hapus file sementara gagal: %s", p, exc_info=True)
    except Exception:
        logger.warning("pindai .tmp gagal: id=%s", att_id, exc_info=True)


def _purge_trashed_media(conn, note_ids) -> None:
    """Hapus file media lampiran (storage='local') dari snapshot note di Sampah. Tidak pernah melempar."""
    try:
        ids = [int(i) for i in note_ids]
        for i in range(0, len(ids), 500):
            chunk = ids[i:i + 500]
            rows = conn.execute(
                f"SELECT note_id, snapshot_json FROM trashed_notes WHERE note_id IN ({','.join('?' * len(chunk))})",
                chunk).fetchall()
            for r in rows:
                try:
                    snap = json.loads(r["snapshot_json"] or "{}")
                    atts = snap.get("attachments") or []
                except (ValueError, TypeError, AttributeError):
                    logger.warning("snapshot_json rusak untuk note %s; file media dilewati", r["note_id"])
                    continue
                for a in atts:
                    if isinstance(a, dict) and a.get("storage") == "local":
                        _delete_media_files(a)
    except Exception:
        logger.warning("purge media Sampah gagal", exc_info=True)


def _cleanup_stuck_media_uploads(conn, now) -> int:
    """Hapus unggahan media 'uploading' yang macet > MEDIA_STUCK_HOURS (file + baris), lalu berkas
    `.tmp/<id>.*` yatim yang juga lebih tua dari batas. `now` = naive UTC. Mengembalikan jumlah baris dihapus."""
    removed = 0
    try:
        limit = timedelta(hours=MEDIA_STUCK_HOURS)
        cutoff = (now - limit).isoformat()
        rows = conn.execute(
            "SELECT * FROM note_attachments WHERE kind='media' AND status='uploading' AND updated_at < ?",
            (cutoff,)).fetchall()
        for r in rows:
            _delete_media_files(r)
            conn.execute("DELETE FROM note_attachments WHERE id=?", (r["id"],))
            removed += 1
        tmp_dir = media_storage.temp_path(0).parent
        live = {r["id"] for r in conn.execute(
            "SELECT id FROM note_attachments WHERE status IN ('uploading','processing')").fetchall()}
        mtime_cut = now.replace(tzinfo=timezone.utc).timestamp() - limit.total_seconds()
        for p in tmp_dir.iterdir():
            try:
                head = p.name.split(".", 1)[0]
                if not head.isdigit() or int(head) in live:
                    continue
                if p.is_file() and p.stat().st_mtime < mtime_cut:
                    p.unlink()
            except OSError:
                logger.warning("hapus berkas .tmp yatim gagal: %s", p, exc_info=True)
    except Exception:
        logger.warning("pembersihan unggahan macet gagal", exc_info=True)
    return removed


@app.delete("/api/scratchpad/attachments/{att_id}")
async def delete_note_attachment(att_id: int, user=Depends(get_current_user)):
    import requests as _req
    uid = user["sub"]
    with get_db() as conn:
        att = _accessible_attachment(conn, uid, att_id)
        if not att:
            raise HTTPException(status_code=404, detail="Attachment tidak ditemukan")
        if att["user_id"] != uid and att["note_owner_id"] != uid:
            raise HTTPException(status_code=403, detail="Bukan attachment milikmu")
        if att["storage"] == "local":
            _delete_media_files(att)
        else:
            r = _req.delete(_nc_dav_url(att["nextcloud_path"]), auth=_nc_auth(), timeout=10)
            if r.status_code not in (200, 204, 404):  # 404 = already deleted, still OK
                raise HTTPException(status_code=500, detail=f"Nextcloud delete gagal: {r.status_code}")
        conn.execute("DELETE FROM note_attachments WHERE id=?", (att_id,))
        conn.commit()
    return {"ok": True}

@app.get("/api/scratchpad/attachments/{att_id}/view")
async def view_note_attachment(att_id: int, user=Depends(get_current_user_sse)):
    import requests as _req
    uid = user["sub"]
    with get_db() as conn:
        att = _accessible_attachment(conn, uid, att_id)
        if not att:
            raise HTTPException(status_code=404, detail="Attachment tidak ditemukan")
    if att["kind"] == "media":
        if att["status"] != "ready":
            raise HTTPException(status_code=404, detail="Attachment tidak ditemukan")
        urls = _media_urls(att["id"], bool(att["poster_key"]), int(_time.time()))
        return RedirectResponse(urls["play_url"], status_code=302)
    r = _req.get(_nc_dav_url(att["nextcloud_path"]), auth=_nc_auth(), timeout=30, stream=True)
    if r.status_code != 200:
        raise HTTPException(status_code=404, detail="File tidak ditemukan di Nextcloud")
    safe_name = att["original_name"].replace('"', '_').replace('\r', '').replace('\n', '')
    return StreamingResponse(
        r.iter_content(chunk_size=8192),
        media_type=_served_file_mime(att["mime_type"]),
        headers=_inline_file_headers(att["mime_type"], safe_name),
    )

# ── Media note (audio/video): unggah bertahap ─────────────────────────────────
# Kontrak 409 pada PATCH: JSONResponse {"detail": "...", "received_bytes": N} (bukan HTTPException)
# supaya klien bisa melanjutkan dari received_bytes tanpa GET tambahan.
_MEDIA_CLIENT_ID_RE = re.compile(r"^[0-9a-zA-Z_-]{1,64}$")
# C0/C1 + karakter yang bukan XML (surrogate tunggal, U+FFFE/U+FFFF): python-docx/SQLite menolaknya.
_MEDIA_CTRL_CHARS_RE = re.compile(r"[\x00-\x1f\x7f-\x9f\ud800-\udfff\ufffe\uffff]")
_media_upload_locks: dict[int, asyncio.Lock] = {}


def _media_not_found() -> HTTPException:
    return HTTPException(status_code=404, detail="Media tidak ditemukan")


def _accessible_note(conn, uid: int, note_id: int):
    clause, params = _note_access_clause(uid)
    return conn.execute(
        f"SELECT * FROM scratchpad_notes WHERE id = ? AND {clause}", [note_id, *params]
    ).fetchone()


def _accessible_attachment(conn, uid: int, att_id: int):
    clause, params = _note_access_clause(uid, "n")
    return conn.execute(
        "SELECT a.*, n.user_id AS note_owner_id FROM note_attachments a "
        "JOIN scratchpad_notes n ON n.id = a.note_id "
        f"WHERE a.id = ? AND {clause}", [att_id, *params]
    ).fetchone()


def _media_quota_check(conn, uid: int, size: int) -> None:
    """v1 no-op. Titik pasang sesi kuota per-user/workspace."""
    return None


def _media_urls(att_id: int, has_poster: bool, now: int) -> dict:
    exp = now + MEDIA_URL_TTL_SEC

    def _u(variant: str) -> str:
        return "/media/" + media_serve.sign_token(att_id, variant, exp, MEDIA_URL_SECRET_BYTES)

    return {"play_url": _u("play"), "poster_url": _u("poster") if has_poster else None,
            "download_url": _u("download"), "expires_at": exp}


def _media_payload(conn, row, now: int) -> dict:
    u = conn.execute("SELECT display_name, username FROM users WHERE id = ?",
                     (row["user_id"],)).fetchone()
    name = (u["display_name"] or u["username"]) if u else None
    urls = {"play_url": None, "poster_url": None, "download_url": None, "expires_at": None}
    if row["status"] == "ready":
        urls = _media_urls(row["id"], bool(row["poster_key"]), now)
    return {
        "id": row["id"], "client_id": row["client_id"], "note_id": row["note_id"],
        "original_name": row["original_name"], "media_type": row["media_type"],
        "mime_type": row["mime_type"], "file_size": row["file_size"],
        "duration_ms": row["duration_ms"], "width": row["width"], "height": row["height"],
        "status": row["status"], "error": row["error"],
        "received_bytes": row["received_bytes"],
        "uploaded_by": row["user_id"], "uploaded_by_name": name,
        **urls,
    }


def _media_now_iso() -> str:
    return _media_utcnow().isoformat()


def _media_write_chunk(path: Path, offset: int, data: bytes) -> None:
    # offset > 0 hanya ke .part yang ada (FileNotFoundError bila hilang): jangan pernah membuat file sparse.
    mode = "r+b" if offset > 0 or path.exists() else "w+b"
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, mode) as f:
        f.seek(offset)
        f.write(data)
        f.truncate()


def _media_read_head(path: Path) -> bytes:
    with open(path, "rb") as f:
        return f.read(64)


@app.post("/api/scratchpad/{note_id}/media")
async def init_note_media(note_id: int, body: dict = Body(...), user=Depends(get_current_user)):
    uid = user["sub"]
    client_id = body.get("client_id")
    if not isinstance(client_id, str) or not _MEDIA_CLIENT_ID_RE.fullmatch(client_id):
        raise HTTPException(status_code=400, detail="client_id tidak valid")
    filename = body.get("filename") if isinstance(body.get("filename"), str) else ""
    filename = _MEDIA_CTRL_CHARS_RE.sub("", filename)  # nama kotor → ekspor DOCX 500
    size = body.get("size")
    mime = body.get("mime") if isinstance(body.get("mime"), str) else ""
    with get_db() as conn:
        if not _accessible_note(conn, uid, note_id):
            raise _media_not_found()
        if isinstance(size, bool) or not isinstance(size, int) or size <= 0:
            raise HTTPException(status_code=400, detail="Ukuran file tidak valid")
        if size > MEDIA_MAX_FILE_BYTES:
            raise HTTPException(status_code=413, detail="File terlalu besar")
        ext = filename.rsplit(".", 1)[1].lower() if "." in filename else ""
        if ext not in ALLOWED_INIT_EXTS:
            raise HTTPException(status_code=415, detail="Format file tidak didukung")
        m = mime.strip().lower()
        if m and m != "application/octet-stream" and not (m.startswith("audio/") or m.startswith("video/")):
            raise HTTPException(status_code=415, detail="Format file tidak didukung")
        def _existing_row():
            return conn.execute("SELECT * FROM note_attachments WHERE user_id = ? AND client_id = ?",
                                (uid, client_id)).fetchone()

        def _reuse(existing):
            if existing["note_id"] != note_id:
                raise HTTPException(status_code=409, detail="client_id sudah dipakai")
            return _media_payload(conn, existing, int(_time.time()))

        existing = _existing_row()
        if existing:
            return _reuse(existing)
        _media_quota_check(conn, uid, size)
        now_iso = _media_now_iso()
        try:
            cur = conn.execute(
                "INSERT INTO note_attachments (note_id, user_id, nextcloud_path, original_name, "
                "file_size, mime_type, created_at, kind, client_id, storage, status, received_bytes, updated_at) "
                "VALUES (?, ?, '', ?, ?, 'application/octet-stream', ?, 'media', ?, 'local', 'uploading', 0, ?)",
                (note_id, uid, (filename[:255] or "media"), size, now_iso, client_id, now_iso))
        except sqlite3.IntegrityError:
            # init bersamaan dengan client_id sama (dua tab/ulang kirim): pakai baris pemenang
            conn.rollback()
            existing = _existing_row()
            if not existing:
                raise
            return _reuse(existing)
        att_id = cur.lastrowid
        # .part dibuat SEBELUM commit: MEDIA_ROOT tak bisa ditulis → tidak ada baris yatim.
        try:
            media_storage.temp_path(att_id).touch()
        except OSError as e:
            conn.rollback()
            if e.errno == errno.ENOSPC:
                raise HTTPException(status_code=507, detail="Penyimpanan server penuh")
            logger.warning("MEDIA_ROOT/.tmp tidak bisa ditulis: %s", e)
            raise HTTPException(status_code=503, detail="Penyimpanan media tidak tersedia")
        conn.commit()
        row = conn.execute("SELECT * FROM note_attachments WHERE id = ?", (att_id,)).fetchone()
        return _media_payload(conn, row, int(_time.time()))


def _media_uploader_row(conn, uid: int, att_id: int):
    row = _accessible_attachment(conn, uid, att_id)
    if not row or row["kind"] != "media":
        raise _media_not_found()
    return row


@app.get("/api/media/{att_id}/upload")
async def get_media_upload(att_id: int, user=Depends(get_current_user)):
    with get_db() as conn:
        row = _accessible_attachment(conn, user["sub"], att_id)
        if not row or row["kind"] != "media":
            raise _media_not_found()
        return _media_payload(conn, row, int(_time.time()))


def _media_busy(received: int) -> JSONResponse:
    return JSONResponse(status_code=409, content={
        "detail": "Unggahan sedang diproses", "received_bytes": received})


def _media_reset_upload(conn, att_id: int) -> int:
    """`.part` hilang: setel received_bytes ke 0 supaya klien mengulang unggahan dari awal."""
    conn.execute("UPDATE note_attachments SET received_bytes = 0, updated_at = ? "
                 "WHERE id = ? AND status = 'uploading'", (_media_now_iso(), att_id))
    conn.commit()
    return 0


@app.patch("/api/media/{att_id}/upload")
async def patch_media_upload(att_id: int, request: Request, user=Depends(get_current_user)):
    uid = user["sub"]
    raw = request.headers.get("upload-offset")
    try:
        offset = int(raw) if raw is not None and raw.strip().isdigit() else -1
    except ValueError:
        offset = -1
    if offset < 0:
        raise HTTPException(status_code=400, detail="Header Upload-Offset wajib")
    with get_db() as conn:
        row = _media_uploader_row(conn, uid, att_id)
        if row["user_id"] != uid:
            raise _media_not_found()
        if row["status"] != "uploading":
            raise HTTPException(status_code=409, detail="Media tidak sedang diunggah")
    lock = _media_upload_locks.setdefault(att_id, asyncio.Lock())
    if lock.locked():
        return _media_busy(row["received_bytes"])
    await lock.acquire()
    try:
        with get_db() as conn:
            row = _media_uploader_row(conn, uid, att_id)
            if row["user_id"] != uid:
                raise _media_not_found()
            if row["status"] != "uploading":
                raise HTTPException(status_code=409, detail="Media tidak sedang diunggah")
            received = row["received_bytes"]
            part = media_storage.temp_path(att_id)
            if received > 0 and not part.exists():
                received = _media_reset_upload(conn, att_id)  # .part hilang: klien mulai lagi dari 0
            if offset != received:
                return _media_busy(received)
            max_body = MEDIA_CHUNK_BYTES + 1024 * 1024
            chunks, total = [], 0
            async for piece in request.stream():
                total += len(piece)
                if total > max_body or offset + total > row["file_size"]:
                    raise HTTPException(status_code=413, detail="Potongan terlalu besar")
                chunks.append(piece)
            data = b"".join(chunks)
            try:
                await run_in_threadpool(_media_write_chunk, part, offset, data)
            except FileNotFoundError:
                return _media_busy(_media_reset_upload(conn, att_id))
            except OSError as e:
                if e.errno == errno.ENOSPC:
                    raise HTTPException(status_code=507, detail="Penyimpanan server penuh")
                raise
            cur = conn.execute("UPDATE note_attachments SET received_bytes = ?, updated_at = ? WHERE id = ?",
                               (offset + len(data), _media_now_iso(), att_id))
            conn.commit()
            row = conn.execute("SELECT * FROM note_attachments WHERE id = ?", (att_id,)).fetchone()
            if cur.rowcount == 0 or row is None:
                raise _media_not_found()  # note dibuang/dihapus selama menulis; .part disapu pembersihan
            return _media_payload(conn, row, int(_time.time()))
    finally:
        lock.release()
        if _media_upload_locks.get(att_id) is lock:
            _media_upload_locks.pop(att_id, None)


@app.post("/api/media/{att_id}/complete")
async def complete_media_upload(att_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    lock = _media_upload_locks.setdefault(att_id, asyncio.Lock())
    if lock.locked():
        with get_db() as conn:
            row = _media_uploader_row(conn, uid, att_id)
        return _media_busy(row["received_bytes"])
    await lock.acquire()
    try:
        with get_db() as conn:
            row = _media_uploader_row(conn, uid, att_id)
            if row["user_id"] != uid:
                raise _media_not_found()
            if row["status"] != "uploading":
                raise HTTPException(status_code=409, detail="Media tidak sedang diunggah")
            if row["received_bytes"] != row["file_size"]:
                raise HTTPException(status_code=400, detail="Unggahan belum lengkap")
            part = media_storage.temp_path(att_id)
            try:
                head = await run_in_threadpool(_media_read_head, part)
            except FileNotFoundError:
                head = b""
            sniff = sniff_media(head)
            if sniff is None:
                try:
                    part.unlink()
                except FileNotFoundError:
                    pass
                conn.execute("UPDATE note_attachments SET status='failed', error=?, updated_at=? WHERE id=?",
                             ("Format file tidak didukung", _media_now_iso(), att_id))
                conn.commit()  # get_db me-rollback bila exception, jadi commit dulu
                raise HTTPException(status_code=415, detail="Format file tidak didukung")
            now = _media_utcnow()
            key = new_key(sniff.ext, now)
            media_storage.commit(key, part)
            cur = conn.execute(
                "UPDATE note_attachments SET storage_key=?, mime_type=?, media_type=?, "
                "status='processing', updated_at=? WHERE id=?",
                (key, final_mime(sniff, sniff.default_media_type), sniff.default_media_type,
                 now.isoformat(), att_id))
            conn.commit()
            if cur.rowcount == 0:
                media_storage.delete(key)  # baris hilang (note dibuang/dihapus): jangan tinggalkan file yatim
                raise _media_not_found()
            media_worker.enqueue(att_id)
            row = conn.execute("SELECT * FROM note_attachments WHERE id = ?", (att_id,)).fetchone()
            return _media_payload(conn, row, int(_time.time()))
    finally:
        lock.release()
        if _media_upload_locks.get(att_id) is lock:
            _media_upload_locks.pop(att_id, None)


@app.get("/api/media/{att_id}")
async def get_media_meta(att_id: int, user=Depends(get_current_user)):
    with get_db() as conn:
        row = _accessible_attachment(conn, user["sub"], att_id)
        if not row or row["kind"] != "media":
            raise _media_not_found()
        return _media_payload(conn, row, int(_time.time()))


@app.get("/api/scratchpad/{note_id}/media/by-client/{client_id}")
async def get_media_by_client(note_id: int, client_id: str, user=Depends(get_current_user)):
    if not _MEDIA_CLIENT_ID_RE.fullmatch(client_id):
        raise _media_not_found()
    with get_db() as conn:
        if not _accessible_note(conn, user["sub"], note_id):
            raise _media_not_found()
        row = conn.execute(
            "SELECT * FROM note_attachments WHERE note_id = ? AND client_id = ? AND kind = 'media'",
            (note_id, client_id)).fetchone()
        if not row:
            raise _media_not_found()
        return _media_payload(conn, row, int(_time.time()))


_MEDIA_BLOCK = 256 * 1024


def _media_iter(path: Path, start: int, length: int):
    with open(path, "rb") as f:
        f.seek(start)
        left = length
        while left > 0:
            chunk = f.read(min(_MEDIA_BLOCK, left))
            if not chunk:
                break
            left -= len(chunk)
            yield chunk


@app.api_route("/media/{token}", methods=["GET", "HEAD"])
async def serve_media(token: str, request: Request):
    now = int(_time.time())
    parsed = media_serve.verify_token(token, MEDIA_URL_SECRET_BYTES, now)
    if not parsed:
        raise _media_not_found()
    att_id, variant, exp = parsed
    with get_db() as conn:
        row = conn.execute("SELECT * FROM note_attachments WHERE id = ?", (att_id,)).fetchone()
    if (not row or row["kind"] != "media" or row["status"] != "ready"
            or row["storage"] != "local"):
        raise _media_not_found()
    key = row["poster_key"] if variant == "poster" else row["storage_key"]
    if not key:
        raise _media_not_found()
    try:
        path = media_storage.path(key)
        size = os.stat(path).st_size
    except (OSError, ValueError):
        raise _media_not_found()
    name = row["original_name"] or "media"
    if variant == "poster":
        mime = "image/jpeg"
        name = name.rsplit(".", 1)[0] + ".jpg" if "." in name else name + ".jpg"
    else:
        mime = row["mime_type"] or "application/octet-stream"
    headers = {
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "Cache-Control": f"private, max-age={max(0, exp - now)}",
        "Accept-Ranges": "bytes",
        "Content-Disposition": media_serve.content_disposition(
            "attachment" if variant == "download" else "inline", name),
    }
    if MEDIA_ACCEL:
        headers["X-Accel-Redirect"] = media_storage.accel_uri(key)
        return Response(status_code=200, content=b"", headers=headers, media_type=mime)
    rng = media_serve.parse_range(request.headers.get("range"), size)
    if rng == "invalid":
        headers["Content-Range"] = f"bytes */{size}"
        return Response(status_code=416, content=b"", headers=headers, media_type=mime)
    if rng is None:
        start, end, code = 0, size - 1, 200
    else:
        (start, end), code = rng, 206
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    length = end - start + 1
    headers["Content-Length"] = str(length)
    if request.method == "HEAD":
        return Response(status_code=code, content=b"", headers=headers, media_type=mime)
    return StreamingResponse(_media_iter(path, start, length), status_code=code,
                             headers=headers, media_type=mime)


@app.get("/api/export/download")
async def export_user_data(user=Depends(get_current_user)):
    uid = user["sub"]
    today = datetime.now(_TZ_JKT).strftime("%Y-%m-%d")

    def _sanitize(title: str, note_id: int) -> str:
        name = re.sub(r'[/\\:*?"<>|]', '-', (title or "").strip())
        return name or f"untitled-{note_id}"

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:

        # ── Notes ──────────────────────────────────────────────────
        with get_db() as conn:
            notes = conn.execute(
                """SELECT n.id, n.title, n.content, n.created_at, n.updated_at,
                          GROUP_CONCAT(t.name) AS tag_names
                   FROM scratchpad_notes n
                   LEFT JOIN entity_tags et ON et.entity_type='note' AND et.entity_id=n.id
                   LEFT JOIN tags t ON t.id=et.tag_id
                   WHERE n.user_id=?
                   GROUP BY n.id ORDER BY n.id""",
                (uid,)
            ).fetchall()

        def _unique(base: str, used: set) -> str:
            cand, n = base, 0
            while cand.lower() in used:
                n += 1
                cand = f"{base} ({n})"
            used.add(cand.lower())
            return cand

        used: set = set()
        for note in notes:
            fname = f"{_unique(_sanitize(note['title'], note['id']), used)}.md"

            tags = [t.strip() for t in (note["tag_names"] or "").split(",") if t.strip()]
            tag_str = ", ".join(tags)
            frontmatter = (
                f"---\ntags: [{tag_str}]\n"
                f"created_at: {note['created_at']}\n"
                f"updated_at: {note['updated_at']}\n---\n\n"
            )
            content = frontmatter + (note["content"] or "")
            zf.writestr(f"notes/{fname}", content.encode("utf-8"))

        # ── Tasks ──────────────────────────────────────────────────
        with get_db() as conn:
            tasks_rows = conn.execute(
                "SELECT * FROM tasks WHERE user_id=? ORDER BY id", (uid,)
            ).fetchall()
            tasks_list = []
            for t in tasks_rows:
                td = dict(t)
                subs = conn.execute(
                    "SELECT title, is_done FROM subtasks WHERE task_id=? ORDER BY sort_order",
                    (t["id"],)
                ).fetchall()
                notes_rows = conn.execute(
                    "SELECT content FROM task_notes WHERE task_id=? ORDER BY id",
                    (t["id"],)
                ).fetchall()
                td["subtasks"] = [{"title": s["title"], "done": bool(s["is_done"])} for s in subs]
                td["notes"] = [n["content"] for n in notes_rows]
                tasks_list.append(td)

        zf.writestr(
            "tasks.json",
            json.dumps(tasks_list, ensure_ascii=False, indent=2).encode("utf-8")
        )

        csv_buf = io.StringIO()
        w = csv.writer(csv_buf)
        task_cols = ["id", "title", "description", "gtd_status", "priority", "quadrant",
                     "project", "context", "deadline", "waiting_for", "created_at", "completed_at"]
        w.writerow(task_cols)
        for t in tasks_list:
            w.writerow([t.get(c, "") or "" for c in task_cols])
        zf.writestr("tasks.csv", csv_buf.getvalue().encode("utf-8"))

        # ── Habits ─────────────────────────────────────────────────
        with get_db() as conn:
            habits_rows = conn.execute(
                "SELECT * FROM habits WHERE user_id=? ORDER BY id", (uid,)
            ).fetchall()
            habits_list = []
            for h in habits_rows:
                hd = dict(h)
                logs = conn.execute(
                    "SELECT date, status, skip_reason FROM habit_logs WHERE habit_id=? ORDER BY date DESC",
                    (h["id"],)
                ).fetchall()
                hd["logs"] = [dict(l) for l in logs]
                habits_list.append(hd)

        zf.writestr(
            "habits.json",
            json.dumps(habits_list, ensure_ascii=False, indent=2).encode("utf-8")
        )

        csv_buf2 = io.StringIO()
        w2 = csv.writer(csv_buf2)
        w2.writerow(["habit_title", "phase", "micro_target", "date", "status", "skip_reason"])
        for h in habits_list:
            for log in h["logs"]:
                w2.writerow([
                    h.get("title", ""), h.get("phase", ""), h.get("micro_target", "") or "",
                    log["date"], log["status"], log.get("skip_reason", "") or ""
                ])
        zf.writestr("habits.csv", csv_buf2.getvalue().encode("utf-8"))

        # ── Mindmaps ───────────────────────────────────────────────
        with get_db() as conn:
            mm_rows = conn.execute(
                "SELECT m.*, n.title AS source_note_title FROM mindmaps m "
                "LEFT JOIN scratchpad_notes n ON n.id = m.source_note_id "
                "WHERE m.user_id = ? ORDER BY m.id", (uid,)
            ).fetchall()
        used_mm: set = set()
        for m in mm_rows:
            base = _unique(_sanitize(m["title"], m["id"]), used_mm)
            try:
                parsed = json.loads(m["data_json"])
            except Exception:
                parsed = None
            if m["source_note_id"] is not None:
                doc = {"title": m["title"], "created_at": m["created_at"], "updated_at": m["updated_at"],
                       "linked": True, "source_note_id": m["source_note_id"],
                       "source_note_title": m["source_note_title"], "view_state": parsed}
                zf.writestr(f"mindmaps/{base}.json", json.dumps(doc, ensure_ascii=False, indent=2).encode("utf-8"))
                continue
            doc = {"title": m["title"], "created_at": m["created_at"], "updated_at": m["updated_at"],
                   "workspace_id": m["list_id"]}
            if parsed is not None:
                doc["data"] = parsed
            else:
                doc["data_json"] = m["data_json"]
            zf.writestr(f"mindmaps/{base}.json", json.dumps(doc, ensure_ascii=False, indent=2).encode("utf-8"))
            if isinstance(parsed, dict) and isinstance(parsed.get("nodeData"), dict):
                zf.writestr(f"mindmaps/{base}.md", _mindmap_outline_md(parsed).encode("utf-8"))

    buf.seek(0)
    filename = f"alurik-export-{today}.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )




@app.get("/api/scratchpad/published")
async def list_published(user=Depends(get_current_user)):
    """List all published notes owned by the current user."""
    uid = user["sub"]
    with get_db() as conn:
        rows = conn.execute(
            """SELECT p.note_id, n.title, p.slug, p.password_hash, p.published_at, u.username
               FROM published_notes p
               JOIN scratchpad_notes n ON n.id = p.note_id
               JOIN users u ON u.id = p.user_id
               WHERE p.user_id = ?
               ORDER BY p.published_at DESC""",
            (uid,)
        ).fetchall()
        return [{
            "note_id": r["note_id"],
            "title": r["title"],
            "slug": r["slug"],
            "username": r["username"],
            "password_set": bool(r["password_hash"]),
            "published_at": r["published_at"]
        } for r in rows]

@app.get("/api/scratchpad/{note_id}")
async def get_scratchpad_note(note_id: int, user=Depends(get_current_user)):
    """Fetch a single note — used by frontend for polling (checks updated_at)."""
    uid = user["sub"]
    access_clause, access_params = _note_access_clause(uid)
    with get_db() as conn:
        row = conn.execute(f"""
            SELECT * FROM scratchpad_notes
            WHERE id = ? AND {access_clause}
        """, [note_id] + access_params).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Note tidak ditemukan")
        return note_comments.apply_summaries(conn, uid, [_scratchpad_row(row, conn, uid)])[0]


_UUID_TOKEN_RE = re.compile(r'[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}')

def _make_drawing_resolver(uid: int):
    """Resolver drawing untuk ekspor DOCX. Semua pencarian terscope ke pengekspor (user_id = uid): isi note
    bisa berisi ::draw[...] apa pun (POST /api/scratchpad/export/docx menerima isi bebas dari klien), jadi
    drawing user lain, walau di-pin, tidak pernah ter-resolve. Tidak ada fallback ke drawing ber-id sama
    dengan id note. Aplikasi menulis direktif ::draw[<id atau uuid>]{title="<judul>"}: token berbentuk id/UUID
    yang tidak ter-resolve (drawing orang lain, mis. anggota mengekspor note bersama pemilik) tidak boleh
    ditebak lewat judul, karena akan menyematkan drawing pengekspor sendiri yang kebetulan berjudul sama."""
    _dclause, _dparams = drawing_scope.access_clause(uid)

    def _resolve_drawing(did, title=None):
        token = str(did)
        id_like = _draw_token_id(token) is not None or bool(_UUID_TOKEN_RE.fullmatch(token))
        with get_db() as conn:
            # 1. By numeric ID, then client_id (format default direktif sejak offline-first)
            row = drawing_scope.find_accessible(conn, token, uid, "id, title, svg_preview")

            # 2. By title parameter (hanya untuk token yang bukan id/UUID)
            if not row and title and not id_like:
                row = conn.execute(
                    f"SELECT id, title, svg_preview FROM drawings WHERE title = ? AND {_dclause} ORDER BY (user_id = ?) DESC, id LIMIT 1",
                    (title.strip(), *_dparams, uid)
                ).fetchone()
                if not row:
                    clean_t = re.sub(r'^(?:gambar|canvas)\s*[-:]*\s*', '', title, flags=re.IGNORECASE).strip()
                    if clean_t:
                        row = conn.execute(
                            f"SELECT id, title, svg_preview FROM drawings WHERE title LIKE ? AND {_dclause} ORDER BY (user_id = ?) DESC, id LIMIT 1",
                            (f"%{clean_t}%", *_dparams, uid)
                        ).fetchone()

            if row:
                return {
                    "id": row["id"],
                    "title": row["title"] or title or f"Gambar {did}",
                    "svg": row["svg_preview"] or ""
                }
        return None
    return _resolve_drawing


def _make_image_resolver(uid: int, note_id: int = None):
    """Resolver lampiran gambar untuk ekspor DOCX. File diambil server dari Nextcloud dengan kredensial server,
    sedangkan isi note dan note_id bisa datang bebas dari klien (POST /api/scratchpad/export/docx), jadi
    lampiran hanya ter-resolve bila note-nya bisa diakses pengekspor (_note_access_clause: miliknya, atau di
    workspace tempat ia owner/anggota), baik lewat id lampiran maupun lewat nama di note_id. Pengecualian hanya
    untuk id lampiran: lampiran note publish TANPA password milik siapa pun juga boleh, karena file itu sudah
    bisa dibuka siapa pun di /pub/attachments/<id> (note_id dari request tetap hanya dicek aksesnya). Nama yang
    tidak ketemu di note_id (atau tanpa note_id) hanya jatuh ke lampiran milik uid sendiri."""
    _img_cache: dict[str, Optional[bytes]] = {}
    _nc_disabled = False
    access_clause, access_params = _note_access_clause(uid, "n")

    def _resolve_image(src: str, alt: str = None):
        nonlocal _nc_disabled
        if not src:
            return None
        cache_key = f"{src}|{alt or ''}"
        if cache_key in _img_cache:
            return _img_cache[cache_key]

        clean_src = src.replace('\\', '').strip()
        clean_fn = re.sub(r'^[!\[\]\(\)\s]+|[!\[\]\(\)\s]+$', '', clean_src).strip().lower()
        clean_alt = re.sub(r'^[!\[\]\(\)\s]+|[!\[\]\(\)\s]+$', '', (alt or '')).strip().lower()

        m = re.search(r'/(?:api/scratchpad/attachments|pub/attachments)/(\d+)', clean_src)
        att_id = int(m.group(1)) if m else None

        with get_db() as conn:
            att = None
            if att_id:
                att = conn.execute(
                    "SELECT a.* FROM note_attachments a JOIN scratchpad_notes n ON n.id = a.note_id "
                    f"WHERE a.id = ? AND ({access_clause} OR EXISTS ("
                    "SELECT 1 FROM published_notes p WHERE p.note_id = a.note_id "
                    "AND (p.password_hash IS NULL OR p.password_hash = '')))",
                    [att_id] + access_params
                ).fetchone()
            else:
                # 1. Look in attachments of this note (only if the exporter can access that note)
                if note_id:
                    for row in conn.execute(
                        "SELECT a.* FROM note_attachments a JOIN scratchpad_notes n ON n.id = a.note_id "
                        f"WHERE a.note_id = ? AND {access_clause}",
                        [note_id] + access_params
                    ).fetchall():
                        orig = (row["original_name"] or "").strip().lower()
                        no_ext = os.path.splitext(orig)[0]
                        if orig in (clean_fn, clean_alt) or no_ext in (clean_fn, clean_alt) or (clean_fn and (clean_fn.endswith(orig) or orig.endswith(clean_fn))):
                            att = row
                            break
                # 2. Fallback: look across all user's attachments
                if not att and uid:
                    for row in conn.execute("SELECT * FROM note_attachments WHERE user_id = ? ORDER BY id DESC LIMIT 50", (uid,)).fetchall():
                        orig = (row["original_name"] or "").strip().lower()
                        no_ext = os.path.splitext(orig)[0]
                        if orig in (clean_fn, clean_alt) or no_ext in (clean_fn, clean_alt) or (clean_fn and (clean_fn.endswith(orig) or orig.endswith(clean_fn))):
                            att = row
                            break

            if att and att["nextcloud_path"] and not _nc_disabled:
                try:
                    import requests as _req
                    r = _req.get(_nc_dav_url(att["nextcloud_path"]), auth=_nc_auth(), timeout=15)
                    if r.status_code == 200:
                        _img_cache[cache_key] = r.content
                        return r.content
                except Exception as e:
                    _nc_disabled = True  # Avoid further delays on unreachable Nextcloud
                    logger.warning(f"Error fetching attachment {att['id']} from Nextcloud: {e}")

        _img_cache[cache_key] = None
        return None
    return _resolve_image


def _make_media_resolver(uid: int, note_id):
    """Resolver media untuk DOCX: hanya lampiran media dari note yang bisa diakses uid (note_id wajib)."""
    def _resolve(client_id: str):
        if note_id is None:
            return None
        with get_db() as conn:
            if not _accessible_note(conn, uid, note_id):
                return None
            row = conn.execute(
                "SELECT original_name, media_type, duration_ms, status FROM note_attachments "
                "WHERE note_id = ? AND client_id = ? AND kind = 'media'", (note_id, client_id)).fetchone()
        if not row or row["status"] != "ready":
            return None
        return {"name": row["original_name"], "media_type": row["media_type"], "duration_ms": row["duration_ms"]}
    return _resolve


@app.get("/api/scratchpad/{note_id}/export/docx")
async def export_scratchpad_docx(note_id: int, user=Depends(get_current_user)):
    """Export note as Microsoft Word (.docx) document."""
    uid = user["sub"]
    access_clause, access_params = _note_access_clause(uid)
    with get_db() as conn:
        row = conn.execute(f"""
            SELECT * FROM scratchpad_notes
            WHERE id = ? AND {access_clause}
        """, [note_id] + access_params).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Note tidak ditemukan")
        note_dict = _scratchpad_row(row, conn, uid)

    from docx_exporter import markdown_to_docx
    title = note_dict.get("title") or "Catatan"
    content = note_dict.get("content") or ""
    meta = {
        "tags": note_dict.get("tags") or [],
        "updated_at": note_dict.get("updated_at")
    }
    drawing_res = _make_drawing_resolver(uid)
    image_res = _make_image_resolver(uid, note_id=note_id)
    try:
        doc_io = markdown_to_docx(title, content, meta, drawing_resolver=drawing_res, image_resolver=image_res,
                                 media_resolver=_make_media_resolver(uid, note_id))
        safe_name = re.sub(r'[\\/*?:"<>|]', '', title).strip() or "Catatan"
        return Response(
            content=doc_io.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}.docx"'}
        )
    except Exception as e:
        import traceback
        return Response(content=traceback.format_exc(), status_code=500, media_type="text/plain")


@app.get("/api/scratchpad/{note_id}/export/md")
async def export_scratchpad_md(note_id: int, user=Depends(get_current_user)):
    """Export note as raw Markdown (.md) file."""
    uid = user["sub"]
    access_clause, access_params = _note_access_clause(uid)
    with get_db() as conn:
        row = conn.execute(f"""
            SELECT * FROM scratchpad_notes
            WHERE id = ? AND {access_clause}
        """, [note_id] + access_params).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Note tidak ditemukan")
        note_dict = _scratchpad_row(row, conn, uid)

    title = note_dict.get("title") or "Catatan"
    content = note_dict.get("content") or ""
    safe_name = re.sub(r'[\\/*?:"<>|]', '', title).strip() or "Catatan"
    return Response(
        content=content.encode("utf-8"),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}.md"'}
    )


class NoteExportLiveRequest(BaseModel):
    note_id: Optional[int] = None
    title: Optional[str] = "Catatan"
    content: Optional[str] = ""
    drawings: Optional[dict[str, Any]] = None
    images: Optional[dict[str, Any]] = None


@app.post("/api/scratchpad/export/docx")
async def export_scratchpad_docx_live(req: NoteExportLiveRequest, user=Depends(get_current_user)):
    """Export live unsaved note content as Microsoft Word (.docx) document."""
    uid = user["sub"]
    from docx_exporter import markdown_to_docx, _resolve_image_bytes
    title = req.title or "Catatan"
    content = req.content or ""
    client_drawings = req.drawings or {}
    client_images = req.images or {}

    db_draw_res = _make_drawing_resolver(uid)

    def combined_drawing_res(did, title=None):
        if client_drawings:
            did_str = str(did)
            if did_str in client_drawings and (client_drawings[did_str].get("png") or client_drawings[did_str].get("svg")):
                return client_drawings[did_str]
            if title:
                t_clean = title.strip().lower()
                for k, v in client_drawings.items():
                    vt = (v.get("title") or "").strip().lower()
                    if vt and (t_clean in vt or vt in t_clean):
                        if v.get("png") or v.get("svg"):
                            return v
        return db_draw_res(did, title=title)

    db_img_res = _make_image_resolver(uid, note_id=req.note_id)

    def combined_image_res(src, alt=None):
        if client_images:
            if src in client_images and client_images[src]:
                return _resolve_image_bytes(client_images[src])
            if alt and alt in client_images and client_images[alt]:
                return _resolve_image_bytes(client_images[alt])
            clean_s = src.replace('\\', '').strip()
            if clean_s in client_images and client_images[clean_s]:
                return _resolve_image_bytes(client_images[clean_s])
            bname = os.path.basename(clean_s).lower()
            if bname and bname != 'view':
                for k, v in client_images.items():
                    if v and (bname == k.lower() or bname == os.path.basename(k).lower()):
                        return _resolve_image_bytes(v)
            # fallback for absolute urls matching path
            for k, v in client_images.items():
                if v and (k in clean_s or clean_s in k):
                    return _resolve_image_bytes(v)
        return db_img_res(src, alt=alt)

    try:
        doc_io = markdown_to_docx(title, content, drawing_resolver=combined_drawing_res, image_resolver=combined_image_res,
                                 media_resolver=_make_media_resolver(uid, req.note_id))
        safe_name = re.sub(r'[\\/*?:"<>|]', '', title).strip() or "Catatan"
        return Response(
            content=doc_io.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={"Content-Disposition": f'attachment; filename="{safe_name}.docx"'}
        )
    except Exception as e:
        import traceback
        err_msg = traceback.format_exc()
        return Response(content=err_msg, status_code=200, media_type="text/plain")


@app.post("/api/scratchpad")
async def create_scratchpad(req: ScratchpadCreate, user=Depends(get_current_user)):
    uid = user["sub"]
    now = datetime.now(_TZ_JKT).isoformat()
    tag_names = [t.strip().lower() for t in req.tags if t.strip()]
    task_ids = list(dict.fromkeys(req.linked_task_ids + ([req.linked_task_id] if req.linked_task_id else [])))
    if req.list_id is not None:
        repo = TaskRepository(DB_PATH)
        if not repo.is_list_member_or_owner(req.list_id, uid):
            raise HTTPException(status_code=403, detail="Kamu bukan anggota list ini")
    with get_db() as conn:
        titles = _parse_wikilinks(req.content)
        linked_ids = _resolve_linked_to(titles, uid, conn)
        if req.client_id:
            existing = conn.execute(
                "SELECT id, content, list_id FROM scratchpad_notes WHERE user_id = ? AND client_id = ?",
                (uid, req.client_id)
            ).fetchone()
            if existing:
                note_id = existing["id"]
                conn.execute(
                    """UPDATE scratchpad_notes
                       SET title = ?, content = ?, tags = ?, linked_task_id = ?, linked_task_ids = ?,
                           linked_to = ?, list_id = ?, last_edited_by = ?, updated_at = ?, meta_json = ?
                       WHERE id = ?""",
                    (req.title, req.content, "[]",
                     task_ids[0] if task_ids else None, json.dumps(task_ids),
                     json.dumps(linked_ids), req.list_id, uid, now, req.meta_json, note_id)
                )
                conn.execute("DELETE FROM entity_tags WHERE entity_type='note' AND entity_id=? AND user_id=?", (note_id, uid))
                _upsert_tags_for_note(conn, note_id, uid, tag_names)
                _sync_linked_mindmap(conn, note_id)
                sync = _note_with_drawing_sync(conn, note_id, uid, now, move=existing["list_id"] != req.list_id)
                conn.commit()
                row = conn.execute(_NOTE_SELECT, (note_id,)).fetchone()
                return _scratchpad_row_synced(row, conn, uid, sync)

        conn.execute(
            """INSERT INTO scratchpad_notes
               (user_id, title, content, tags, linked_task_id, linked_task_ids, linked_to,
                list_id, last_edited_by, created_at, updated_at, meta_json, client_id)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (uid, req.title, req.content, "[]",
             task_ids[0] if task_ids else None, json.dumps(task_ids),
             json.dumps(linked_ids), req.list_id, uid, now, now, req.meta_json, req.client_id)
        )
        note_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        _upsert_tags_for_note(conn, note_id, uid, tag_names)
        sync = _note_with_drawing_sync(conn, note_id, uid, now, move=True)
        conn.commit()
        row = conn.execute(_NOTE_SELECT, (note_id,)).fetchone()
        return _scratchpad_row_synced(row, conn, uid, sync)

class BookmarkExtractIn(BaseModel):
    url: str


@app.post("/api/bookmark/extract")
async def bookmark_extract(body: BookmarkExtractIn, user=Depends(get_current_user)):
    import requests as _req
    url = (body.url or "").strip()
    err = bookmark.validate_bookmark_url(url)
    if err:
        raise HTTPException(status_code=400, detail=err)
    headers = {"User-Agent": "Mozilla/5.0 (compatible; AlurikBookmark/1.0)"}
    # Follow redirects manually, re-validating every hop — otherwise a public URL
    # could 30x-redirect to an internal host and bypass the SSRF guard.
    from urllib.parse import urljoin
    current = url
    resp = None
    try:
        for _ in range(6):
            resp = _req.get(current, headers=headers, timeout=10, stream=True,
                            allow_redirects=False)
            if resp.is_redirect or resp.is_permanent_redirect:
                loc = resp.headers.get("location", "")
                resp.close()
                if not loc:
                    raise HTTPException(status_code=502, detail="Redirect tidak valid")
                nxt = urljoin(current, loc)
                if bookmark.validate_bookmark_url(nxt):
                    raise HTTPException(status_code=400, detail="Redirect ke host tidak diizinkan")
                current = nxt
                continue
            break
        else:
            raise HTTPException(status_code=502, detail="Terlalu banyak redirect")
    except _req.RequestException:
        raise HTTPException(status_code=502, detail="Gagal mengambil halaman")
    ctype = resp.headers.get("content-type", "")
    if "html" not in ctype.lower():
        resp.close()
        return {"title": "", "content": "", "url": url}
    # Size cap: read up to 5 MB.
    chunks = []
    total = 0
    for chunk in resp.iter_content(chunk_size=65536):
        chunks.append(chunk)
        total += len(chunk)
        if total > 5_000_000:
            break
    resp.close()
    html = b"".join(chunks).decode("utf-8", errors="replace")
    out = bookmark.extract_readable(html, url)
    return {"title": out["title"], "content": out["content"], "url": url}


class ReviewRequest(BaseModel):
    queue: list[str] = []


class NoteAiRequest(BaseModel):
    instruction: str
    text: str


@app.post("/api/ai/note-action")
async def ai_note_action(req: NoteAiRequest, user=Depends(get_current_user)):
    """AI transform note text. Freeform instruction + target text → transformed result.
    Gated by AI_FEATURES_ENABLED (both config + user opt-in checked by frontend)."""
    if not appconfig.AI_FEATURES_ENABLED:
        raise HTTPException(status_code=404, detail="AI features disabled")
    if not req.text.strip() or not req.instruction.strip():
        raise HTTPException(status_code=400, detail="instruction and text required")
    try:
        result = _call_note_ai(req.instruction.strip(), req.text.strip())
        return {"result": result}
    except ai_review.AIReviewError as e:
        raise HTTPException(status_code=503, detail=str(e))


def _call_note_ai(instruction: str, text: str) -> str:
    """AI note transform via the configured provider (see config.AI_PROVIDER)."""
    system = (
        "Kamu adalah asisten penulisan catatan di Alurik. "
        "Ikuti instruksi pengguna untuk mengubah TEKS INPUT menjadi output. "
        "Instruksi bisa berupa: ringkas, perbaiki grammar, terjemahkan, "
        "ubah tone, ekstrak action items, expand, atau instruksi bebas lainnya. "
        "Balas HANYA dengan teks hasil transformasi dalam format MARKDOWN. "
        "Gunakan bold, italic, heading, list, code block, tabel, atau format "
        "markdown lain yang sesuai untuk hasil yang rapi dan terstruktur. "
        "JANGAN beri pengantar atau penjelasan — langsung hasil transformasi."
    )
    return ai_review._call_llm(
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": f"INSTRUKSI: {instruction}\n\nTEKS INPUT:\n{text}"},
        ],
        max_tokens=4000,
        timeout=45,
        extra_headers={"X-Title": "Alurik Note AI"},
    )


@app.post("/api/ai/review")
async def ai_weekly_review(req: ReviewRequest = Body(default=ReviewRequest()),
                           user=Depends(get_current_user)):
    if not appconfig.AI_FEATURES_ENABLED:
        raise HTTPException(status_code=404, detail="AI features disabled")
    uid = user["sub"]
    access_clause = (
        "user_id = ? OR list_id IN ("
        "  SELECT id FROM shared_lists WHERE owner_id = ?"
        "  UNION SELECT list_id FROM list_members WHERE user_id = ?)"
    )
    sql = (f"SELECT * FROM tasks WHERE ({access_clause}) "
           "AND gtd_status NOT IN ('archived')")
    with get_db() as conn:
        rows = conn.execute(sql, [uid, uid, uid]).fetchall()
        tasks = [task_row_to_dict(r, conn) for r in rows]
    payload = ai_review.build_payload(tasks, queue=req.queue)
    try:
        return ai_review.generate_review(payload)
    except ai_review.AIReviewError as e:
        raise HTTPException(status_code=503, detail=str(e))


@app.post("/api/review/snapshot")
async def review_snapshot(req: ReviewSnapshotIn, user=Depends(get_current_user)):
    uid = user["sub"]
    week = review_history.current_iso_week()
    now = datetime.utcnow().isoformat()
    with get_db() as conn:
        review_history.upsert_snapshot(conn, uid, week, now, {
            "score": req.score, "overdue": req.overdue,
            "p1_overdue": req.p1_overdue,
            "projects_without_next": req.projects_without_next,
            "done_this_week": req.done_this_week, "active": req.active})
    return {"ok": True}


@app.get("/api/review/history")
async def review_history_route(user=Depends(get_current_user)):
    uid = user["sub"]
    week = review_history.current_iso_week()
    with get_db() as conn:
        return review_history.get_history(conn, uid, week)


@app.put("/api/scratchpad/{note_id}")
async def update_scratchpad(note_id: int, req: ScratchpadUpdate, user=Depends(get_current_user)):
    uid = user["sub"]
    now = datetime.now(_TZ_JKT).isoformat()
    tag_names = [t.strip().lower() for t in req.tags if t.strip()]
    task_ids = list(dict.fromkeys(req.linked_task_ids + ([req.linked_task_id] if req.linked_task_id else [])))
    access_clause, access_params = _note_access_clause(uid)
    with get_db() as conn:
        existing = conn.execute(f"""
            SELECT * FROM scratchpad_notes
            WHERE id = ? AND {access_clause}
        """, [note_id] + access_params).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Note tidak ditemukan")
        _check_base_rev(req, existing, lambda: _scratchpad_row(existing, conn, uid))
        titles = _parse_wikilinks(req.content)
        linked_ids = _resolve_linked_to(titles, uid, conn)
        # list_id: only owner can change it; members cannot move the note to another list.
        # Absen di payload = tidak berubah (audit K4: autosave tanpa list_id tidak boleh meng-unshare).
        if existing["user_id"] == uid and "list_id" in req.model_fields_set:
            new_list_id = req.list_id
        else:
            new_list_id = existing["list_id"]
        conn.execute(
            """UPDATE scratchpad_notes
               SET title=?, content=?, tags=?, linked_task_id=?, linked_task_ids=?,
                   linked_to=?, list_id=?, last_edited_by=?, updated_at=?, meta_json=COALESCE(?, meta_json)
               WHERE id=?""",
            (req.title, req.content, "[]",
             task_ids[0] if task_ids else None, json.dumps(task_ids),
             json.dumps(linked_ids), new_list_id, uid, now, req.meta_json, note_id)
        )
        # Tag note berskop NOTE (audit T7): hapus semua relasi tag note ini (milik siapa pun),
        # lalu upsert di bawah user_id PEMILIK note agar tidak ada tag "zombie" per editor.
        conn.execute("DELETE FROM entity_tags WHERE entity_type='note' AND entity_id=?", (note_id,))
        _upsert_tags_for_note(conn, note_id, existing["user_id"], tag_names)
        _sync_linked_mindmap(conn, note_id)
        sync = _note_with_drawing_sync(conn, note_id, uid, now, move=existing["list_id"] != new_list_id)
        if new_list_id is not None and existing["list_id"] != new_list_id:
            note_comments.touch_for_note(conn, note_id, new_list_id, now)
        conn.commit()
        updated = conn.execute(_NOTE_SELECT, (note_id,)).fetchone()
        return _scratchpad_row_synced(updated, conn, uid, sync)

@app.delete("/api/scratchpad/{note_id}")
async def delete_scratchpad(note_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        row = conn.execute("SELECT * FROM scratchpad_notes WHERE id = ?", (note_id,)).fetchone()
        if not row:
            return {"ok": True, "detail": "Note already deleted"}
        if row["user_id"] is not None and str(row["user_id"]) != str(uid):
            raise HTTPException(status_code=403, detail="Hanya pemilik yang bisa menghapus catatan ini")
        # Snapshot + cascade delete dalam SATU transaksi (get_db rollback bila ada exception).
        # Error tak terduga saat snapshot HARUS menggagalkan hapus (500) agar note tidak hilang
        # tanpa salinan di Sampah; self-healing tabel ada di dalam _snapshot_note_to_trash.
        _snapshot_note_to_trash(conn, row, fallback_uid=uid)
        try:
            conn.execute("DELETE FROM entity_tags WHERE entity_type='note' AND entity_id=?", (note_id,))
        except Exception:
            pass
        try:
            conn.execute("DELETE FROM note_pins WHERE note_id=?", (note_id,))
        except Exception:
            pass
        try:
            conn.execute("DELETE FROM published_notes WHERE note_id=?", (note_id,))
        except Exception:
            pass
        try:
            conn.execute("DELETE FROM note_attachments WHERE note_id=?", (note_id,))
        except Exception:
            pass
        try:
            conn.execute("DELETE FROM scratchpad_notes WHERE id = ?", (note_id,))
        except Exception:
            # FTS5 trigger sync mismatch: drop delete trigger, delete note, recreate trigger
            try:
                conn.execute("DROP TRIGGER IF EXISTS trg_scratchpad_notes_ad")
                conn.execute("DELETE FROM scratchpad_notes WHERE id = ?", (note_id,))
                conn.execute("""
                    CREATE TRIGGER IF NOT EXISTS trg_scratchpad_notes_ad AFTER DELETE ON scratchpad_notes BEGIN
                        INSERT INTO scratchpad_notes_fts(scratchpad_notes_fts, rowid, title, content)
                        VALUES ('delete', old.id, old.title, old.content);
                    END;
                """)
            except Exception:
                conn.execute("DELETE FROM scratchpad_notes WHERE id = ?", (note_id,))
        conn.commit()
    return {"ok": True}

@app.patch("/api/scratchpad/{note_id}/share")
async def share_scratchpad(note_id: int, req: NoteShareReq, user=Depends(get_current_user)):
    """Toggle sharing of a note to a list. Only the note owner can share/unshare."""
    uid = user["sub"]
    with get_db() as conn:
        row = conn.execute(
            "SELECT id FROM scratchpad_notes WHERE id = ? AND user_id = ?", (note_id, uid)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=403, detail="Hanya pemilik catatan yang bisa berbagi")
        if req.list_id is not None:
            repo = TaskRepository(DB_PATH)
            if not repo.is_list_member_or_owner(req.list_id, uid):
                raise HTTPException(status_code=403, detail="Kamu bukan anggota list ini")
        # Bump updated_at (audit K4): share/unshare adalah edit pengguna; tanpa bump, pull klien
        # tidak mengadopsi list_id baru dan PUT berikutnya meng-unshare / me-re-share catatan.
        now = datetime.now(_TZ_JKT).isoformat()
        conn.execute(
            "UPDATE scratchpad_notes SET list_id = ?, updated_at = ? WHERE id = ?", (req.list_id, now, note_id)
        )
        _sync_linked_mindmap(conn, note_id)
        sync = _note_with_drawing_sync(conn, note_id, uid, now, move=True)
        note_comments.touch_for_note(conn, note_id, req.list_id, now)
        conn.commit()
        updated = conn.execute(_NOTE_SELECT, (note_id,)).fetchone()
        return _scratchpad_row_synced(updated, conn, uid, sync)

@app.patch("/api/scratchpad/{note_id}/pin")
async def toggle_pin_scratchpad(note_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    access_clause, access_params = _note_access_clause(uid)
    with get_db() as conn:
        row = conn.execute(f"""
            SELECT id FROM scratchpad_notes
            WHERE id = ? AND {access_clause}
        """, [note_id] + access_params).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Note tidak ditemukan")
        existing_pin = conn.execute(
            "SELECT 1 FROM note_pins WHERE user_id = ? AND note_id = ?", (uid, note_id)
        ).fetchone()
        if existing_pin:
            conn.execute("DELETE FROM note_pins WHERE user_id = ? AND note_id = ?", (uid, note_id))
        else:
            conn.execute("INSERT OR IGNORE INTO note_pins (user_id, note_id) VALUES (?, ?)", (uid, note_id))
        conn.commit()
        updated = conn.execute(_NOTE_SELECT, (note_id,)).fetchone()
        return _scratchpad_row(updated, conn, uid)

@app.post("/api/scratchpad/{note_id}/publish")
async def publish_scratchpad(note_id: int, req: PublishReq, user=Depends(get_current_user)):
    """Publish a note (or update password). Only the note owner can publish."""
    uid = user["sub"]
    now = datetime.now(_TZ_JKT).isoformat()
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, user_id, title FROM scratchpad_notes WHERE id = ?", (note_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Note tidak ditemukan")
        if row["user_id"] != uid:
            raise HTTPException(status_code=403, detail="Hanya pemilik note yang bisa publish")

        slug = _generate_publish_slug(conn, row["title"] or "")
        password = (req.password or "").strip()
        pw_hash = hash_password(password) if password else None
        conn.execute(
            """INSERT OR REPLACE INTO published_notes (note_id, user_id, slug, password_hash, published_at)
               VALUES (?, ?, ?, ?, ?)""",
            (note_id, uid, slug, pw_hash, now)
        )
        conn.commit()
        # Get username for frontend URL building
        uname = conn.execute("SELECT username FROM users WHERE id = ?", (uid,)).fetchone()["username"]
        return {"slug": slug, "published_at": now, "password_set": bool(password), "username": uname}

@app.delete("/api/scratchpad/{note_id}/publish")
async def unpublish_scratchpad(note_id: int, user=Depends(get_current_user)):
    """Unpublish a note. Only the note owner can unpublish."""
    uid = user["sub"]
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, user_id FROM scratchpad_notes WHERE id = ?", (note_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Note tidak ditemukan")
        if row["user_id"] != uid:
            raise HTTPException(status_code=403, detail="Hanya pemilik note yang bisa unpublish")
        conn.execute("DELETE FROM published_notes WHERE note_id = ? AND user_id = ?", (note_id, uid))
        conn.commit()
        return {"ok": True}

class CommentCreate(BaseModel):
    body: str
    quote: Optional[str] = None
    parent_id: Optional[int] = None
    client_id: Optional[str] = None

    @field_validator("body")
    @classmethod
    def _body_ok(cls, v):
        v = (v or "").strip()
        if not 1 <= len(v) <= 4000:
            raise ValueError("Isi komentar 1-4000 karakter")
        return v

    @field_validator("quote")
    @classmethod
    def _quote_ok(cls, v):
        if v is not None and len(v) > 500:
            raise ValueError("Kutipan maksimal 500 karakter")
        return v

    @field_validator("client_id")
    @classmethod
    def _client_ok(cls, v):
        if v is not None and len(v) > 64:
            raise ValueError("client_id maksimal 64 karakter")
        return v


class CommentPatch(BaseModel):
    body: Optional[str] = None
    resolved: Optional[bool] = None

    @field_validator("body")
    @classmethod
    def _body_ok(cls, v):
        if v is None:
            return v
        v = v.strip()
        if not 1 <= len(v) <= 4000:
            raise ValueError("Isi komentar 1-4000 karakter")
        return v

    @model_validator(mode="after")
    def _exactly_one(self):
        if (self.body is None) == (self.resolved is None):
            raise ValueError("Isi tepat satu dari body atau resolved")
        return self


def _comment_out(conn, cid: int) -> dict:
    row = conn.execute(
        f"SELECT {note_comments.SELECT_COLS} {note_comments.FROM_JOINS} WHERE c.id = ?", (cid,)).fetchone()
    return note_comments.serialize(row)


def _schedule_comment_notify(background_tasks, conn, note, comment, actor_uid: int, event: str) -> None:
    """Susun pesan per penerima (dalam transaksi yang sama) lalu jadwalkan pengiriman setelah respons."""
    kinds = note_comments.recipients(conn, note=note, comment=comment, actor_uid=actor_uid, event=event)
    if not kinds:
        return
    a = conn.execute("SELECT username, display_name FROM users WHERE id = ?", (actor_uid,)).fetchone()
    actor = (a["display_name"] or a["username"]) if a else ""
    body = comment.get("body") or ""
    messages = {u: note_comments.message(k, actor, note["title"], body, _esc_msg) for u, k in kinds.items()}
    background_tasks.add_task(_notify_users_bg, messages, note["list_id"], note["id"])


@app.get("/api/scratchpad/{note_id}/comments")
async def list_note_comments(note_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        note = note_comments.visible_note(conn, uid, note_id)
        if not note:
            raise HTTPException(status_code=404, detail="Note tidak ditemukan")
        if note["list_id"] is None:
            return []
        rows = conn.execute(
            f"SELECT {note_comments.SELECT_COLS} {note_comments.FROM_JOINS} "
            "WHERE c.note_id = ? AND c.list_id = ? AND c.deleted_at IS NULL ORDER BY c.created_at, c.id",
            (note_id, note["list_id"])).fetchall()
        return [note_comments.serialize(r) for r in rows]


@app.get("/api/note-comments")
async def pull_note_comments(since: str = "", limit: int = 500, user=Depends(get_current_user)):
    uid = user["sub"]
    limit = max(1, min(limit, 1000))
    now = datetime.now(_TZ_JKT).isoformat()
    cur = note_comments.parse_cursor(since.replace(" ", "+"))  # "+07:00" tak ter-encode tiba sebagai spasi
    if note_comments.cursor_expired(cur, now):
        return {"reset": True, "items": [], "cursor": "", "more": False}
    where, params = note_comments.visible_clause(uid)
    cond = ""
    if cur is not None:
        cond = "(c.updated_at > ? OR (c.updated_at = ? AND c.id > ?)) AND "
        params = [cur[0], cur[0], cur[1]] + params
    with get_db() as conn:
        rows = conn.execute(
            f"SELECT {note_comments.SELECT_COLS} {note_comments.FROM_JOINS} "
            f"JOIN scratchpad_notes n ON n.id = c.note_id WHERE {cond}{where} "
            "ORDER BY c.updated_at, c.id LIMIT ?", params + [limit + 1]).fetchall()
    more = len(rows) > limit
    items = [note_comments.serialize(r) for r in rows[:limit]]
    if more:
        cursor = note_comments.make_cursor(items[-1]["updated_at"], items[-1]["id"])
    else:
        # Kursor boleh maju tanpa item: max(updated_at terakhir, sekarang - 5 menit) agar tidak kedaluwarsa saat sepi.
        margin = (datetime.now(_TZ_JKT) - timedelta(minutes=5)).isoformat()
        last, last_id = (items[-1]["updated_at"], items[-1]["id"]) if items else cur or ("", 0)
        # Item terakhir lebih baru dari margin: pakai (updated_at, id)-nya agar tak terkirim ulang.
        cursor = note_comments.make_cursor(last, last_id) if last >= margin else note_comments.make_cursor(margin, 0)
    return {"items": items, "cursor": cursor, "more": more}


@app.post("/api/scratchpad/{note_id}/comments")
async def create_note_comment(note_id: int, req: CommentCreate, background_tasks: BackgroundTasks,
                              user=Depends(get_current_user)):
    uid = user["sub"]
    now = datetime.now(_TZ_JKT).isoformat()
    with get_db() as conn:
        note = note_comments.visible_note(conn, uid, note_id)
        if not note:
            raise HTTPException(status_code=404, detail="Note tidak ditemukan")
        if note["list_id"] is None:
            raise HTTPException(status_code=409, detail={"code": "NOTE_NOT_SHARED"})
        if req.client_id:
            dup = conn.execute(
                "SELECT id FROM note_comments WHERE user_id = ? AND client_id = ?", (uid, req.client_id)).fetchone()
            if dup:
                return _comment_out(conn, dup["id"])
        parent_id = None
        if req.parent_id is not None:
            parent = note_comments.get_visible(conn, uid, req.parent_id)
            if not parent or parent["deleted_at"] or parent["note_id"] != note_id:
                raise HTTPException(status_code=404, detail="Komentar tidak ditemukan")
            parent_id = parent["parent_id"] or parent["id"]
        quote = req.quote if parent_id is None else None
        cur = conn.execute(
            "INSERT INTO note_comments (note_id, list_id, user_id, parent_id, body, quote, client_id, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (note_id, note["list_id"], uid, parent_id, req.body, quote, req.client_id, now, now))
        out = _comment_out(conn, cur.lastrowid)
        _schedule_comment_notify(background_tasks, conn, note, out, uid, "create")
    await _note_comment_broadcast(note_id, {"type": "comments_changed", "note_id": note_id})
    return out


@app.post("/api/scratchpad/{note_id}/comments/read")
async def mark_note_comments_read(note_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    now = datetime.now(_TZ_JKT).isoformat()
    with get_db() as conn:
        note = note_comments.visible_note(conn, uid, note_id)
        if not note:
            raise HTTPException(status_code=404, detail="Note tidak ditemukan")
        if note["list_id"] is not None:
            note_comments.mark_read(conn, uid, note_id, now)
        return {"ok": True}


@app.patch("/api/note-comments/{cid}")
async def patch_note_comment(cid: int, req: CommentPatch, background_tasks: BackgroundTasks,
                             user=Depends(get_current_user)):
    uid = user["sub"]
    now = datetime.now(_TZ_JKT).isoformat()
    with get_db() as conn:
        c = note_comments.get_visible(conn, uid, cid)
        if not c or c["deleted_at"]:
            raise HTTPException(status_code=404, detail="Komentar tidak ditemukan")
        if req.body is not None:
            if c["user_id"] != uid:
                raise HTTPException(status_code=403, detail="Hanya penulis yang bisa mengedit komentar")
            conn.execute("UPDATE note_comments SET body = ?, edited_at = ?, updated_at = ? WHERE id = ?",
                         (req.body, now, now, cid))
        else:
            if c["parent_id"] is not None:
                raise HTTPException(status_code=422, detail="Hanya thread yang bisa diselesaikan")
            if uid not in (c["user_id"], c["note_owner_id"]):
                raise HTTPException(status_code=403, detail="Tidak berhak menyelesaikan thread ini")
            if bool(req.resolved) == bool(c["resolved_at"]):
                pass  # sudah di keadaan yang diminta: no-op (tanpa UPDATE, notifikasi, atau sinyal)
            elif req.resolved:
                conn.execute("UPDATE note_comments SET resolved_at = ?, resolved_by = ?, updated_at = ? WHERE id = ?",
                             (now, uid, now, cid))
                _schedule_comment_notify(
                    background_tasks, conn, {"user_id": c["note_owner_id"], "list_id": c["list_id"], "title": c["note_title"],
                                             "id": c["note_id"]}, dict(c), uid, "resolve")
            else:
                conn.execute("UPDATE note_comments SET resolved_at = NULL, resolved_by = NULL, updated_at = ? WHERE id = ?",
                             (now, cid))
        out = _comment_out(conn, cid)
        note_id = c["note_id"]
    if req.body is not None or bool(req.resolved) != bool(c["resolved_at"]):
        await _note_comment_broadcast(note_id, {"type": "comments_changed", "note_id": note_id})
    return out


@app.delete("/api/note-comments/{cid}")
async def delete_note_comment(cid: int, user=Depends(get_current_user)):
    uid = user["sub"]
    now = datetime.now(_TZ_JKT).isoformat()
    with get_db() as conn:
        c = note_comments.get_visible(conn, uid, cid)
        if not c:
            raise HTTPException(status_code=404, detail="Komentar tidak ditemukan")
        if uid not in (c["user_id"], c["note_owner_id"]):
            raise HTTPException(status_code=403, detail="Tidak berhak menghapus komentar ini")
        # Hapus thread -> semua balasannya ikut; tombstone yang sudah ada tidak disentuh lagi.
        cur = conn.execute(
            "UPDATE note_comments SET deleted_at = ?, body = '', quote = NULL, updated_at = ? "
            "WHERE (id = ? OR parent_id = ?) AND deleted_at IS NULL", (now, now, cid, cid))
        changed = cur.rowcount > 0
        note_id = c["note_id"]
    if changed:
        await _note_comment_broadcast(note_id, {"type": "comments_changed", "note_id": note_id})
    return {"ok": True}


def _note_comment_push(note_id: int, uid: int, q: asyncio.Queue, event: dict) -> None:
    """Antrean dibatasi (100): bila penuh pelanggan dilepas; klien menyambung ulang dan menarik delta."""
    try:
        q.put_nowait(event)
    except asyncio.QueueFull:
        note_comment_subscribers.get(note_id, set()).discard((uid, q))


async def _note_comment_broadcast(note_id: int, event: dict) -> None:
    """Kirim sinyal ke pelanggan stream komentar note. Pelanggan yang tak lagi bisa melihat note
    (atau note-nya kembali pribadi) menerima 'comments_access_lost' dan dilepas.
    Dipanggil setelah commit: kegagalan hanya dicatat."""
    try:
        subs = list(note_comment_subscribers.get(note_id, set()))
        if not subs:
            return
        verdicts = []
        with get_db() as conn:
            for uid, q in subs:
                n = note_comments.visible_note(conn, uid, note_id)
                verdicts.append((uid, q, bool(n) and n["list_id"] is not None))
        for uid, q, ok in verdicts:
            if ok:
                _note_comment_push(note_id, uid, q, event)
            else:
                _note_comment_push(note_id, uid, q, {"type": "comments_access_lost", "note_id": note_id})
                note_comment_subscribers.get(note_id, set()).discard((uid, q))
    except Exception:
        logging.getLogger(__name__).exception("note comment broadcast gagal (note_id=%s)", note_id)


@app.get("/api/scratchpad/{note_id}/comments/stream")
async def note_comments_stream(note_id: int, request: Request, user=Depends(get_current_user_sse)):
    uid = user["sub"]
    with get_db() as conn:
        note = note_comments.visible_note(conn, uid, note_id)
        if not note or note["list_id"] is None:
            raise HTTPException(status_code=404, detail="Note tidak ditemukan")

    terminal = ("comments_access_lost",)

    async def event_generator():
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        entry = (uid, q)
        note_comment_subscribers[note_id].add(entry)
        try:
            while True:
                if await request.is_disconnected():
                    break
                if entry not in note_comment_subscribers.get(note_id, ()):
                    while not q.empty():
                        msg = q.get_nowait()
                        if msg.get("type") in terminal:
                            yield {"data": json.dumps(msg)}
                            break
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=20.0)
                    yield {"data": json.dumps(msg)}
                    if msg.get("type") in terminal:
                        break
                except asyncio.TimeoutError:
                    if not _session_still_valid(user):
                        break
                    yield {"data": json.dumps({"type": "ping"})}
        finally:
            note_comment_subscribers[note_id].discard(entry)
            if not note_comment_subscribers.get(note_id):
                note_comment_subscribers.pop(note_id, None)

    return EventSourceResponse(event_generator())


# ── Public publish pages (/pub/*) ──────────────────────────────────────────────

_PUBLIC_CSS = """<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #fafbfc;
    --card-bg: #ffffff;
    --text: #1a1a2e;
    --text-secondary: #6b7280;
    --accent: #a8c500;
    --accent-hover: #96b000;
    --border: #e5e7eb;
    --header-bg: #ffffff;
    --code-bg: #f0f0f0;
    --pre-bg: #f5f5f5;
    --blockquote-border: #ddd;
    --blockquote-text: #666;
    --table-border: #ddd;
    --table-header-bg: #f5f5f5;
    --tag-bg: #f0f0f0;
    --tag-text: #555;
    --highlight-bg: #fff3b0;
    --input-bg: #f5f5f5;
    --input-border: #e5e7eb;
    --scrollbar-thumb: #ccc;
    --scrollbar-track: transparent;
  }

  html.dark {
    --bg: #0f1117;
    --card-bg: #1a1d2e;
    --text: #e2e2e2;
    --text-secondary: #8b8fa3;
    --accent: #a8c500;
    --accent-hover: #96b000;
    --border: #2a2d3e;
    --header-bg: #1a1d2e;
    --code-bg: #2a2a3e;
    --pre-bg: #1e2030;
    --blockquote-border: #555;
    --blockquote-text: #bbb;
    --table-border: #444;
    --table-header-bg: #2a2a3e;
    --tag-bg: #2a2d3e;
    --tag-text: #aaa;
    --highlight-bg: #4a4520;
    --input-bg: #1e2030;
    --input-border: #2a2d3e;
    --scrollbar-thumb: #444;
    --scrollbar-track: transparent;
  }

  @media (prefers-color-scheme: dark) {
    :root:not(.light) {
      --bg: #0f1117;
      --card-bg: #1a1d2e;
      --text: #e2e2e2;
      --text-secondary: #8b8fa3;
      --border: #2a2d3e;
      --header-bg: #1a1d2e;
      --code-bg: #2a2a3e;
      --pre-bg: #1e2030;
      --blockquote-border: #555;
      --blockquote-text: #bbb;
      --table-border: #444;
      --table-header-bg: #2a2a3e;
      --tag-bg: #2a2d3e;
      --tag-text: #aaa;
      --highlight-bg: #4a4520;
      --input-bg: #1e2030;
      --input-border: #2a2d3e;
      --scrollbar-thumb: #444;
    }
  }

  body {
    font-family: 'Nunito Sans', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    line-height: 1.7;
    color: var(--text);
    background: var(--bg);
    min-height: 100vh;
  }

  /* Header */
  .pub-header {
    position: sticky;
    top: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 48px;
    padding: 0 24px;
    background: var(--header-bg);
    border-bottom: 1px solid var(--border);
    font-size: 13px;
    color: var(--text-secondary);
    gap: 12px;
  }
  .pub-header a { color: var(--accent); text-decoration: none; }
  .pub-header a:hover { text-decoration: underline; }
  .pub-header-left { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
  .pub-header-right { display: flex; align-items: center; gap: 8px; }

  .pub-search-wrap { position: relative; }
  .pub-search-wrap::before {
    content: '\2315';
    position: absolute;
    left: 10px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 14px;
    color: var(--text-secondary);
    pointer-events: none;
  }
  .pub-header input[type="text"] {
    padding: 6px 10px 6px 30px;
    border: 1px solid var(--input-border);
    border-radius: 6px;
    font-size: 13px;
    font-family: inherit;
    background: var(--input-bg);
    color: var(--text);
    width: 180px;
    outline: none;
  }
  .pub-header input[type="text"]:focus { border-color: var(--accent); }

  .pub-header button {
    background: none;
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 6px 12px;
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
    color: var(--text-secondary);
    background: var(--card-bg);
    white-space: nowrap;
  }
  .pub-header button:hover { border-color: var(--accent); color: var(--accent); }
  #dark-toggle { font-size: 16px; padding: 4px 8px; }

  /* Layout */
  .pub-layout {
    display: grid;
    grid-template-columns: 220px 1fr 200px;
    gap: 32px;
    max-width: 1200px;
    margin: 0 auto;
    padding: 32px 24px 60px;
  }

  /* Sidebar common */
  .pub-sidebar-left, .pub-sidebar-right { font-size: 13px; color: var(--text-secondary); }
  .pub-sidebar-left {
    position: sticky;
    top: 80px;
    align-self: start;
    max-height: calc(100vh - 100px);
    overflow-y: auto;
  }
  .pub-sidebar-right { position: sticky; top: 80px; align-self: start; }
  .pub-sidebar-left section, .pub-sidebar-right section {
    margin-bottom: 24px;
    padding: 16px;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .pub-sidebar-left h3, .pub-sidebar-right h3 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 12px;
    color: var(--text-secondary);
    font-weight: 600;
  }

  /* TOC */
  .pub-toc ul { list-style: none; padding: 0; }
  .pub-toc li { margin-bottom: 4px; }
  .pub-toc li.toc-h2 { padding-left: 12px; }
  .pub-toc li.toc-h3 { padding-left: 24px; }
  .pub-toc a {
    color: var(--text-secondary);
    text-decoration: none;
    display: block;
    padding: 2px 0;
    border-radius: 3px;
  }
  .pub-toc a:hover { color: var(--accent); }

  /* Tags */
  .pub-tags { display: flex; flex-wrap: wrap; gap: 6px; }
  .pub-tag {
    display: inline-block;
    padding: 3px 10px;
    background: var(--tag-bg);
    color: var(--tag-text);
    border-radius: 12px;
    font-size: 12px;
  }

  /* Backlinks */
  .pub-sidebar-left ul { list-style: none; padding: 0; }
  .pub-sidebar-left li { margin-bottom: 4px; }
  .pub-sidebar-left a { color: var(--text-secondary); text-decoration: none; }
  .pub-sidebar-left a:hover { color: var(--accent); }

  /* Main content */
  .pub-main { min-width: 0; }

  /* Cover */
  .pub-cover { margin-bottom: 24px; }
  .pub-cover img { display: block; width: 100%; max-height: 300px; object-fit: cover; border-radius: 8px; }

  /* Title */
  .pub-title { font-size: 2em; font-weight: 800; line-height: 1.2; margin-bottom: 8px; color: var(--text); }

  /* Meta line */
  .pub-meta {
    font-size: 13px;
    color: var(--text-secondary);
    margin-bottom: 28px;
    display: flex;
    flex-wrap: wrap;
    gap: 4px 16px;
  }

  /* Content body */
  .pub-body { color: var(--text); }
  .pub-body h1, .pub-body h2, .pub-body h3 {
    margin-top: 1.5em;
    margin-bottom: 0.4em;
    scroll-margin-top: 70px;
  }
  .pub-body h1:first-child, .pub-body h2:first-child, .pub-body h3:first-child { margin-top: 0; }
  .pub-body h1 { font-size: 1.5em; }
  .pub-body h2 { font-size: 1.25em; }
  .pub-body h3 { font-size: 1.1em; }
  .pub-body p { margin-bottom: 0.8em; }
  .pub-body a { color: var(--accent); text-decoration: none; }
  .pub-body a:hover { text-decoration: underline; }
  .pub-body pre {
    background: var(--pre-bg);
    padding: 12px 16px;
    border-radius: 6px;
    overflow-x: auto;
    font-size: 0.9em;
    margin-bottom: 1em;
  }
  .pub-body code { font-size: 0.9em; background: var(--code-bg); padding: 2px 5px; border-radius: 3px; }
  .pub-body pre code { background: none; padding: 0; }
  .pub-body blockquote {
    border-left: 3px solid var(--blockquote-border);
    padding-left: 16px;
    color: var(--blockquote-text);
    margin-bottom: 0.8em;
  }
  .pub-body ul, .pub-body ol { margin-bottom: 0.8em; padding-left: 1.5em; }
  .pub-body li { margin-bottom: 0.3em; }
  .pub-body table { border-collapse: collapse; width: 100%; margin-bottom: 1em; }
  .pub-body table th, .pub-body table td {
    border: 1px solid var(--table-border);
    padding: 8px 12px;
    text-align: left;
  }
  .pub-body table th { background: var(--table-header-bg); font-weight: 600; }
  .pub-body img { max-width: 100%; height: auto; border-radius: 4px; }
  .pub-body hr { border: none; border-top: 1px solid var(--border); margin: 24px 0; }
  .pub-body mark { background: var(--highlight-bg); color: inherit; padding: 1px 3px; border-radius: 2px; }

  /* Search highlight */
  mark.search-highlight { background: #ffeb3b; color: #000; padding: 1px 2px; border-radius: 2px; }
  html.dark mark.search-highlight { background: #ffeb3b; color: #000; }

  /* Attachments */
  .pub-media { margin: 16px 0; }
  .pub-media video, .pub-media audio { display: block; width: 100%; max-width: 100%; border-radius: 8px; }
  .pub-media figcaption { font-size: 13px; color: var(--text-muted, #64748b); margin-top: 6px; }
  .pub-media a { font-size: 13px; }
  .pub-media-missing { padding: 12px 14px; border: 1px dashed var(--border); border-radius: 8px; color: var(--text-muted, #64748b); }
  .pub-attachments {
    margin-top: 32px;
    padding: 20px;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .pub-attachments h3 { font-size: 14px; margin-bottom: 12px; color: var(--text); }
  .pub-attachment-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    margin-bottom: 8px;
    text-decoration: none;
    color: var(--text);
    transition: border-color 0.15s;
  }
  .pub-attachment-item:hover { border-color: var(--accent); }
  .pub-attachment-icon { font-size: 20px; flex-shrink: 0; }
  .pub-attachment-name { font-size: 13px; font-weight: 500; word-break: break-all; }
  .pub-attachment-meta { font-size: 11px; color: var(--text-secondary); }
  /* Inline Note Drawing Card */
  .note-draw-card {
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--card-bg);
    overflow: hidden;
    margin: 16px 0;
    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    box-sizing: border-box;
  }
  .note-draw-card[data-size="S"] { width: 50%; max-width: 50%; margin: 16px auto; }
  .note-draw-card[data-size="M"] { width: 75%; max-width: 75%; margin: 16px auto; }
  .note-draw-card[data-size="L"], .note-draw-card[data-size="FULL"] { width: 100%; max-width: 100%; margin: 16px 0; }
  .note-draw-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    background: var(--code-bg);
    border-bottom: 1px solid var(--border);
    font-size: 13px;
    font-weight: 600;
    color: var(--text);
  }
  .note-draw-preview-container {
    padding: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 120px;
    overflow: hidden;
    background: var(--bg);
    box-sizing: border-box;
  }
  .note-draw-preview-container svg {
    max-width: 100%;
    max-height: 100%;
    width: 100%;
    height: auto;
    display: block;
  }
  .note-draw-preview-container iframe {
    width: 100%;
    height: 100%;
    min-height: 280px;
    border: none;
    display: block;
  }
  .pub-drawing { margin-top: 32px; }
  .pub-drawing h3 { font-size: 14px; margin-bottom: 12px; color: var(--text); }
  .pub-drawing-container { position: relative; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; height: 450px; }
  .pub-drawing-container iframe { width: 100%; height: 100%; border: none; }
  /* Right sidebar */
  .pub-about-item { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 13px; }
  .pub-actions { display: flex; flex-direction: column; gap: 6px; }
  .pub-actions button {
    width: 100%;
    padding: 8px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--card-bg);
    color: var(--text);
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
    text-align: left;
  }
  .pub-actions button:hover { border-color: var(--accent); }

  /* Footer */
  .pub-footer {
    text-align: center;
    padding: 24px;
    font-size: 12px;
    color: var(--text-secondary);
    border-top: 1px solid var(--border);
  }
  .pub-footer a { color: var(--accent); text-decoration: none; }

  /* Password gate */
  .pub-password {
    max-width: 360px;
    margin: 80px auto;
    text-align: center;
    padding: 32px;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 12px;
  }
  .pub-password h1 { font-size: 1.2em; margin-bottom: 16px; color: var(--text); }
  .pub-password input {
    width: 100%;
    padding: 10px 14px;
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 14px;
    font-family: inherit;
    margin-bottom: 10px;
    background: var(--input-bg);
    color: var(--text);
  }
  .pub-password button {
    width: 100%;
    padding: 10px;
    background: var(--accent);
    color: #1a1a2e;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    font-family: inherit;
  }
  .pub-password button:hover { background: var(--accent-hover); }
  .pub-error { color: #ef4444; font-size: 13px; margin-top: 6px; }

  /* 404 page */
  .pub-notfound { text-align: center; padding-top: 80px; color: var(--text); }
  .pub-notfound h1 { font-size: 3em; margin-bottom: 12px; }
  .pub-notfound p { color: var(--text-secondary); }

  /* Scrollbar */
  .pub-sidebar-left::-webkit-scrollbar { display: none; }
  .pub-sidebar-left { scrollbar-width: none; }

  /* Responsive: Tablet (hide right sidebar) */
  @media (max-width: 1100px) {
    .pub-layout { grid-template-columns: 180px 1fr; gap: 24px; padding: 24px 20px 40px; }
    .pub-sidebar-right { display: none; }
  }

  /* Responsive: Mobile (single column, hide sidebars) */
  @media (max-width: 900px) {
    .pub-layout { grid-template-columns: 1fr; padding: 20px 16px 40px; }
    .pub-sidebar-left { display: none; }
    .pub-sidebar-right { display: none; }
    .pub-header { padding: 0 16px; }
    .pub-header input[type="text"] { width: 120px; }
    .pub-header .pub-search-wrap { display: none; }
    .pub-title { font-size: 1.5em; }
  }
</style>"""

# ── Header pengaman (spec XSS §6) ─────────────────────────────────────────────
# Halaman HTML /pub/… (halaman note, halaman password, 404). Bukan untuk /pub/drawings (JSON) dan /pub/attachments.
_PUB_PAGE_CSP = (
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
    "font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; media-src 'self' blob:; frame-src 'self'; "
    "connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'"
)
# File unggahan yang disajikan langsung (lampiran publik, view lampiran note). CSP sandbox untuk semua KECUALI PDF:
# Chromium memblokir penampil PDF-nya di dokumen sandbox; PDF bukan konteks HTML/skrip (tetap nosniff, MIME persis,
# inline).
_INLINE_FILE_CSP = "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'"
_INLINE_SAFE_MIMES = frozenset({"image/png", "image/jpeg", "image/webp", "image/gif", "application/pdf"})
_INLINE_NO_SANDBOX_MIMES = frozenset({"application/pdf"})


def _base_mime(mime_type) -> str:
    return (mime_type or "").split(";", 1)[0].strip().lower()


def _served_file_mime(mime_type) -> str:
    """media_type respons file unggahan: tipe inline persis (tanpa parameter), selain itu nilai tersimpan
    (kosong → application/octet-stream)."""
    mime = _base_mime(mime_type)
    if mime in _INLINE_SAFE_MIMES:
        return mime
    return mime_type or "application/octet-stream"


def _inline_file_headers(mime_type: str, safe_name: str) -> dict:
    """Header file unggahan: inline hanya untuk gambar raster dan PDF, selebihnya attachment; nosniff; CSP sandbox
    kecuali PDF (_INLINE_NO_SANDBOX_MIMES). Nama file non-ASCII lewat filename* (RFC 5987) seperti FileResponse."""
    mime = _base_mime(mime_type)
    disposition = "inline" if mime in _INLINE_SAFE_MIMES else "attachment"
    ascii_name = safe_name.encode("ascii", "replace").decode("ascii").replace("?", "_")
    cd = f'{disposition}; filename="{ascii_name}"'
    if ascii_name != safe_name:
        cd += "; filename*=utf-8''" + urllib.parse.quote(safe_name, safe="")
    headers = {
        "Content-Disposition": cd,
        "X-Content-Type-Options": "nosniff",
    }
    if mime not in _INLINE_NO_SANDBOX_MIMES:
        headers["Content-Security-Policy"] = _INLINE_FILE_CSP
    return headers


def _pub_html_response(content: str, status_code: int = 200) -> HTMLResponse:
    """Respons HTML halaman /pub/… dengan CSP halaman publik."""
    return HTMLResponse(content=content, status_code=status_code, headers={"Content-Security-Policy": _PUB_PAGE_CSP})


_TEMPLATE_SLOT_RE = re.compile(r"@@([a-z_]+)@@")


def _fill_template(template: str, values: dict) -> str:
    """Isi slot @@nama@@ dalam satu lintasan: nilai yang disisipkan tidak dipindai ulang dan kurung kurawal/$ di
    dalamnya tidak bermakna (pengganti .format()). Nilai harus sudah aman untuk konteksnya; slot tanpa nilai = KeyError."""
    return _TEMPLATE_SLOT_RE.sub(lambda m: str(values[m.group(1)]), template)


_PUBLIC_PAGE_HTML = """<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>@@title@@ — Alurik Publish</title>
<meta name="description" content="@@description@@">
<meta property="og:title" content="@@title@@">
<meta property="og:description" content="@@description@@">
<meta property="og:type" content="article">
<meta property="og:url" content="@@og_url@@">
<link href="https://fonts.googleapis.com/css2?family=Nunito+Sans:ital,opsz,wght@0,6..12,400;0,6..12,500;0,6..12,600;0,6..12,700;1,6..12,400;1,6..12,600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/static/vendor/katex/katex.min.css">
@@css@@
</head>
<body>
<header class="pub-header">
  <div class="pub-header-left">&#128279; <a href="@@base_url@@">Published via Alurik</a></div>
  <div class="pub-header-right">
    <div class="pub-search-wrap">
      <input type="text" id="doc-search" placeholder="Search in document...">
    </div>
    <button id="dark-toggle" title="Toggle dark mode">&#127769;</button>
    <button id="copy-link-btn">&#128203; Copy Link</button>
  </div>
</header>

<div class="pub-layout">
  <aside class="pub-sidebar-left">
    @@toc_html@@
    @@backlinks@@
    @@tags_html@@
  </aside>

  <main class="pub-main">
    @@cover_html@@
    <h1 class="pub-title">@@title@@</h1>
    <div class="pub-meta">
      <span>&#128100; @@author@@</span>
      <span>&#128197; @@date@@</span>
      <span>&#9201; @@reading_time@@ min read</span>
      <span>&#128221; @@word_count@@ words</span>
    </div>
    <div class="pub-body">@@body@@</div>
    @@attachments_html@@
    @@drawing_html@@
  </main>

  <aside class="pub-sidebar-right">
    <section>
      <h3>About this page</h3>
      <div class="pub-about-item">&#128100; @@author@@</div>
      <div class="pub-about-item">&#128197; Created: @@created_date@@</div>
      <div class="pub-about-item">&#128339; Updated: @@updated_date@@</div>
      <div class="pub-about-item">&#9201; @@reading_time@@ min read</div>
      <div class="pub-about-item">&#128221; @@word_count@@ words</div>
    </section>
    <section>
      <h3>Actions</h3>
      <div class="pub-actions">
        <button id="copy-link-btn-2">&#128203; Copy Link</button>
        <button onclick="window.print()">&#128424; Print</button>
      </div>
    </section>
  </aside>
</div>

<footer class="pub-footer">
  Published with &#10084; by <a href="@@base_url@@">Alurik</a>
</footer>

<script src="/static/vendor/katex/katex.min.js"></script>
<script>
  // Inline KaTeX renderer (no auto-render.min.js needed). Dirender per text node (spec XSS §5, fix round 1):
  // tidak pernah membaca/menulis ulang innerHTML, jadi `$` di nilai atribut tidak bisa dipasangkan dengan `$` di teks.
  try {
    var body = document.querySelector('.pub-body');
    if (body && window.katex) {
      var _KX_SKIP = { CODE: 1, PRE: 1, SCRIPT: 1, STYLE: 1, TEXTAREA: 1 };
      var _kxWalker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
      var _kxNodes = [];
      while (_kxWalker.nextNode()) {
        var _n = _kxWalker.currentNode;
        if (!_n.nodeValue || _n.nodeValue.indexOf('$') === -1) continue;
        var _skip = false;
        for (var _p = _n.parentNode; _p && _p !== body; _p = _p.parentNode) {
          if (_KX_SKIP[_p.nodeName]) { _skip = true; break; }
        }
        if (!_skip) _kxNodes.push(_n);
      }
      // Display math: $$ ... $$ (dicoba lebih dulu), inline math: $ ... $
      var _KX_RE = /\\$\\$([\\s\\S]*?)\\$\\$|\\$([^$]+?)\\$/g;
      _kxNodes.forEach(function(node) {
        var text = node.nodeValue, last = 0, m, found = false;
        var frag = document.createDocumentFragment();
        _KX_RE.lastIndex = 0;
        while ((m = _KX_RE.exec(text)) !== null) {
          var display = m[1] !== undefined;
          var tex = (display ? m[1] : m[2]).trim();
          if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
          var el = document.createElement(display ? 'div' : 'span');
          try { katex.render(tex, el, { displayMode: display, throwOnError: false }); }
          catch (e) { el = document.createTextNode(m[0]); }
          frag.appendChild(el);
          last = m.index + m[0].length;
          found = true;
        }
        if (!found) return;
        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
        node.parentNode.replaceChild(frag, node);
      });
    }
  } catch(e) {}
</script>
<script>
  // Dark mode toggle
  (function() {
    if (localStorage.getItem('pub-dark') === '1' ||
        (!localStorage.getItem('pub-dark') && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
      document.documentElement.classList.add('dark');
    }
    var dt = document.getElementById('dark-toggle');
    if (dt) {
      dt.addEventListener('click', function() {
        var isDark = document.documentElement.classList.toggle('dark');
        localStorage.setItem('pub-dark', isDark ? '1' : '0');
        dt.textContent = isDark ? '\\u2600\\uFE0F' : '\\uD83C\\uDF19';
      });
      if (document.documentElement.classList.contains('dark')) {
        dt.textContent = '\\u2600\\uFE0F';
      }
    }
  })();

  // Copy link buttons
  function setupCopyBtn(btn) {
    if (!btn) return;
    btn.addEventListener('click', function() {
      navigator.clipboard.writeText(window.location.href).then(function() {
        btn.textContent = '\\u2705 Copied!';
        setTimeout(function() { btn.textContent = '\\uD83D\\uDCCB Copy Link'; }, 2000);
      }).catch(function() {});
    });
  }
  setupCopyBtn(document.getElementById('copy-link-btn'));
  setupCopyBtn(document.getElementById('copy-link-btn-2'));

  // Search in document
  var searchInput = document.getElementById('doc-search');
  var _pubBody = document.querySelector('.pub-body');
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      var query = searchInput.value.trim();
      if (!_pubBody) return;
      // Hapus sorotan sebelumnya tanpa re-parse innerHTML (mark sorotan -> teks biasa)
      _pubBody.querySelectorAll('mark.search-highlight').forEach(function(mk) {
        mk.parentNode.replaceChild(document.createTextNode(mk.textContent), mk);
      });
      _pubBody.normalize();
      if (!query) return;
      // Walk text nodes and highlight all occurrences
      var walker = document.createTreeWalker(_pubBody, NodeFilter.SHOW_TEXT);
      var textNodes = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode);
      var lowerQuery = query.toLowerCase();
      for (var i = textNodes.length - 1; i >= 0; i--) {
        var node = textNodes[i];
        var text = node.textContent;
        var lower = text.toLowerCase();
        var idx = 0, lastIdx = 0;
        var frag = document.createDocumentFragment();
        while ((idx = lower.indexOf(lowerQuery, lastIdx)) !== -1) {
          if (idx > lastIdx) frag.appendChild(document.createTextNode(text.substring(lastIdx, idx)));
          var mark = document.createElement('mark');
          mark.className = 'search-highlight';
          mark.textContent = text.substring(idx, idx + query.length);
          frag.appendChild(mark);
          lastIdx = idx + query.length;
        }
        if (lastIdx > 0) {
          if (lastIdx < text.length) frag.appendChild(document.createTextNode(text.substring(lastIdx)));
          node.parentNode.replaceChild(frag, node);
        }
      }
    });
  }

  // Drawing canvas: load data from server into iframe
  var _drawData = @@drawing_data_js@@;
  var drawIframe = document.getElementById('drawing-iframe');
  if (drawIframe && _drawData) {
    window.addEventListener('message', function _onDrawMsg(e) {
      if (e.origin !== window.location.origin) return;
      if (e.data && e.data.type === 'ready') {
        drawIframe.contentWindow.postMessage({ type: 'load', data: _drawData }, '*');
        _drawData = null;
      }
    });
  }

  // Pratinjau SVG drawing: tidak pernah masuk DOM sebagai markup (spec XSS §3) — selalu <img src=data:>.
  // Bukan blob: (blob URL mewarisi origin halaman; dibuka top-level, skrip SVG jalan same-origin).
  function _svgBase64(svg) {
    var bin = '';
    if (typeof TextEncoder === 'function') {
      var bytes = new TextEncoder().encode(svg);
      for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    } else {
      bin = unescape(encodeURIComponent(svg));
    }
    return btoa(bin);
  }
  function _showSvg(container, svg) {
    var b64;
    try { b64 = _svgBase64(svg); } catch (err) { return; }
    var img = document.createElement('img');
    img.alt = 'Drawing';
    img.setAttribute('style', '@@svg_img_style@@');
    img.src = 'data:image/svg+xml;base64,' + b64;
    container.textContent = '';
    container.appendChild(img);
  }
  function _isSvg(v) { return typeof v === 'string' && v.trim().startsWith('<svg'); }

  // Hydrate inline drawing previews if needed
  try {
    document.querySelectorAll('.note-draw-preview-container[data-drawing-preview]').forEach(function(el) {
      var did = el.getAttribute('data-drawing-preview');
      if (!did) return;
      if (!el.querySelector('img') && !el.querySelector('iframe')) {
        fetch('/pub/drawings/' + encodeURIComponent(did))
          .then(function(r) { return r.ok ? r.json() : null; })
          .then(function(d) {
            if (d && _isSvg(d.svg_preview)) {
              _showSvg(el, d.svg_preview);
            } else if (d && d.data_json && d.data_json.trim() !== '{}') {
              var fr = document.createElement('iframe');
              fr.src = '/static/vendor/tldraw/index.html?noteId=' + encodeURIComponent(did);
              fr.setAttribute('style', 'width:100%;height:300px;border:none;');
              fr.title = 'Drawing';
              el.textContent = '';
              el.appendChild(fr);
            }
          }).catch(function() {});
      }
    });
  } catch(e) {}

  // Swap iframe with rendered SVG when ready — hanya dari iframe drawing milik halaman ini, ke container-nya sendiri
  window.addEventListener('message', function(e) {
    if (e.origin !== window.location.origin) return;
    if (!e.data || e.data.type !== 'change' || !e.data.noteId || !_isSvg(e.data.svg)) return;
    var frames = document.querySelectorAll('.note-draw-preview-container[data-drawing-preview] iframe');
    var srcFrame = null;
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow && e.source === frames[i].contentWindow) { srcFrame = frames[i]; break; }
    }
    if (!srcFrame) return;
    var cands = document.querySelectorAll('.note-draw-preview-container[data-drawing-preview="' + CSS.escape(String(e.data.noteId)) + '"]');
    for (var j = 0; j < cands.length; j++) {
      if (cands[j].contains(srcFrame)) { _showSvg(cands[j], e.data.svg); return; }
    }
  });
</script>
</body>
</html>"""

_NOT_FOUND_HTML = """<!DOCTYPE html>
<html lang="id">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Not Found — Alurik</title>""" + _PUBLIC_CSS + """</head>
<body>
<div class="pub-notfound">
<h1>404</h1>
<p>Halaman tidak ditemukan atau sudah di-unpublish.</p>
<p style="margin-top:16px"><a href="/" style="color:var(--accent);text-decoration:none">&#8592; Back to Alurik</a></p>
</div>
</body></html>"""

_PASSWORD_GATE_HTML = """<!DOCTYPE html>
<html lang="id">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>🔒 Protected — Alurik</title>@@css@@</head>
<body>
<div class="pub-password">
  <h1>🔒 Halaman ini dilindungi password</h1>
  <form method="post" action="@@action@@">
    <input type="password" name="password" placeholder="Masukkan password" autofocus required>
    <button type="submit">Buka</button>
  </form>
  @@error_html@@
</div>
</body></html>"""

def _password_gate_html(username: str, slug: str, error_html: str = "") -> str:
    """Halaman password note publish. username/slug di action di-percent-encode lalu di-escape (_pub_href)."""
    return _fill_template(_PASSWORD_GATE_HTML, {
        "css": _PUBLIC_CSS,
        "action": _pub_href(username, slug) + "/unlock",
        "error_html": error_html,
    })


@app.get("/pub/attachments/{att_id}")
async def view_published_attachment(att_id: str, request: Request):
    """Public attachment view — only if the parent note is published and, when it is
    password-protected, unlocked for this request (valid unlock cookie)."""
    import requests as _req
    att_row_id = _draw_token_id(att_id)
    if att_row_id is None:
        # bukan id angka dalam INTEGER SQLite: pasti tidak ada, 404 yang sama dan bukan OverflowError → 500
        raise HTTPException(status_code=404, detail="Attachment tidak ditemukan")
    with get_db() as conn:
        att = conn.execute(
            """SELECT a.*, p.slug, p.password_hash FROM note_attachments a
               JOIN published_notes p ON p.note_id = a.note_id
               WHERE a.id = ?""",
            (att_row_id,)
        ).fetchone()
        if not att or not _pub_note_unlocked(request, att["slug"], att["password_hash"]):
            raise HTTPException(status_code=404, detail="Attachment tidak ditemukan")

        if att["kind"] == "media":
            if att["status"] != "ready":
                raise HTTPException(status_code=404, detail="Attachment tidak ditemukan")
            return RedirectResponse(
                _media_urls(att["id"], bool(att["poster_key"]), int(_time.time()))["download_url"],
                status_code=302)

        safe_name = (att["original_name"] or "file").replace('"', '_').replace('\r', '').replace('\n', '')
        mime_type = att["mime_type"] or "application/octet-stream"
        nc_path = att["nextcloud_path"] or ""

        # Local storage fallback
        if nc_path:
            try:
                local_path = os.path.join(UPLOAD_DIR, os.path.basename(nc_path))
                if os.path.exists(local_path):
                    # kebijakan header sama dengan cabang Nextcloud (disposition, nosniff, CSP sandbox)
                    return FileResponse(local_path, media_type=_served_file_mime(mime_type),
                                        headers=_inline_file_headers(mime_type, safe_name))
            except Exception:
                pass

        # Nextcloud storage check
        if NEXTCLOUD_URL and nc_path:
            try:
                r = _req.get(_nc_dav_url(nc_path), auth=_nc_auth(), timeout=15)
                if r.status_code == 200:
                    return Response(
                        content=r.content,
                        media_type=_served_file_mime(mime_type),
                        headers=_inline_file_headers(mime_type, safe_name),
                    )
                r.close()
            except Exception:
                pass

        # If not found in Nextcloud or local, return 404 cleanly
        raise HTTPException(status_code=404, detail="File tidak ditemukan")

@app.get("/pub/drawings/{drawing_id}")
async def get_published_drawing(drawing_id: str, request: Request):
    """Public drawing retrieval: hanya drawing yang di-embed penerbit di note publish pribadi yang tepercaya (isinya
    terakhir ditulis pemiliknya, bukan note bersama) dan terbuka bagi request ini."""
    with get_db() as conn:
        row = _published_drawing_for_request(conn, drawing_id, request)
        if not row:
            raise HTTPException(status_code=404, detail="Drawing tidak ditemukan")
        return {
            "id": row["id"],
            "title": row["title"],
            "data_json": row["data_json"] or "{}",
            "svg_preview": row["svg_preview"] or ""
        }

@app.get("/pub/{slug}")
async def view_published_note_legacy(slug: str):
    """Redirect old /pub/{slug} URLs to new /pub/{username}/{slug} format."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT u.username FROM published_notes p JOIN users u ON u.id = p.user_id WHERE p.slug = ?",
            (slug,)
        ).fetchone()
        if not row:
            return _pub_html_response(_NOT_FOUND_HTML, status_code=404)
        return RedirectResponse(url=_pub_path(row["username"], slug), status_code=301)

@app.get("/pub/{username}/{slug}")
async def view_published_note(username: str, slug: str, request: Request):
    """Public page for a published note. Server-side rendered HTML with OG meta."""
    with get_db() as conn:
        row = conn.execute(
            """SELECT n.title, n.content, n.updated_at, n.list_id, n.user_id AS note_user_id, n.last_edited_by,
                      p.published_at, p.password_hash, p.note_id, p.user_id, u.username
               FROM published_notes p
               JOIN scratchpad_notes n ON n.id = p.note_id
               JOIN users u ON u.id = p.user_id
               WHERE p.slug = ? AND u.username = ?""",
            (slug, username)
        ).fetchone()
        if not row:
            return _pub_html_response(_NOT_FOUND_HTML, status_code=404)

        # Password gate
        if not _pub_note_unlocked(request, slug, row["password_hash"]):
            return _pub_html_response(_password_gate_html(username, slug))

        import re as _re
        _e, _ea = safehtml.escape_html, safehtml.escape_attr

        def _safe_date(d_str):
            if not d_str:
                return ""
            try:
                clean = str(d_str).replace('Z', '+00:00')
                return datetime.fromisoformat(clean).strftime("%d %B %Y")
            except Exception:
                try:
                    import dateparser
                    d = dateparser.parse(str(d_str))
                    return d.strftime("%d %B %Y") if d else str(d_str)[:10]
                except Exception:
                    return str(d_str)[:10]

        raw_content = row["content"] or ""
        desc_clean = _re.sub(r'\\?::draw\\?\[[^\]]*\](?:\s*\\?\{[^}]*\\?\})?', '', raw_content, flags=_re.IGNORECASE)
        desc_clean = MEDIA_DIRECTIVE_RE.sub('', desc_clean)
        desc_clean = _re.sub(r'\\?\[tasklink:[^\]]*\]', '', desc_clean)
        desc_clean = _re.sub(r'==([^=\n]+)==', r'\1', desc_clean)
        desc_clean = _re.sub(r'\[\[([^\]|]+)(?:\|[^\]]+)?\]\]', r'\1', desc_clean)
        description = html.escape(desc_clean[:200].replace('\n', ' ').strip())
        # Note tepercaya = isinya hanya ditulis penerbit: pribadi (list_id kosong), milik penerbit, dan terakhir disunting
        # pemiliknya (aturan sama dengan _published_drawing_for_request). Selain itu (note bersama, atau note yang pernah
        # diedit orang lain lalu kembali pribadi) token ::draw di dalamnya bukan bukti pemilik drawing mau menampilkannya.
        # trusted_owner_id gerbang resolusi drawing DAN wikilink berpassword; None -> semua token jadi kartu "tidak tersedia".
        trusted = (
            row["list_id"] is None and row["note_user_id"] == row["user_id"]
            and (row["last_edited_by"] is None or row["last_edited_by"] == row["note_user_id"])
        )
        trusted_owner_id = row["user_id"] if trusted else None
        body_html = _render_published_content(raw_content, conn, note_id=row["note_id"], owner_id=trusted_owner_id,
                                             list_id=None if trusted else row["list_id"])

        # Dates
        created_date = _safe_date(row["published_at"])
        updated_date = _safe_date(row["updated_at"] or row["published_at"])
        date_str = updated_date or created_date

        # Reading time & word count
        word_count = len(raw_content.split())
        reading_time = max(1, -(-word_count // 200))  # ceil division

        author = row["username"]

        # Tags
        tags_html = ""
        tags = conn.execute(
            "SELECT t.name FROM tags t JOIN entity_tags et ON et.tag_id = t.id WHERE et.entity_type = 'note' AND et.entity_id = ?",
            (row["note_id"],)
        ).fetchall()
        if tags:
            tag_pills = "".join(
                f'<span class="pub-tag">{_e(t["name"])}</span>'
                for t in tags
            )
            tags_html = f'<section><h3>&#127991; Tags</h3><div class="pub-tags">{tag_pills}</div></section>'

        # Attachments
        attachments_html = ""
        atts = conn.execute(
            "SELECT id, original_name, mime_type FROM note_attachments WHERE note_id = ? AND kind != 'media'",
            (row["note_id"],)
        ).fetchall()
        if atts:
            mime_icons = {
                'image': '&#128444;', 'video': '&#127916;', 'audio': '&#127925;',
                'pdf': '&#128196;', 'text': '&#128221;', 'application': '&#128206;'
            }
            att_items = ""
            for a in atts:
                mime = a["mime_type"] or ""
                orig_name = a["original_name"] or "file"
                is_img = mime.startswith("image/") or any(orig_name.lower().endswith(ext) for ext in ('.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'))
                icon = '&#128206;'
                for prefix, ico in mime_icons.items():
                    if mime.startswith(prefix):
                        icon = ico
                        break
                img_preview = (
                    f'<div style="margin-top:8px"><img src="/pub/attachments/{a["id"]}" alt="{_ea(orig_name)}" style="max-height:180px;max-width:100%;border-radius:6px;object-fit:contain;background:var(--code-bg);border:1px solid var(--border);display:block;" loading="lazy"></div>'
                    if is_img else ''
                )
                att_items += (
                    f'<div class="pub-attachment-item" style="display:block;margin-bottom:12px;">'
                    f'<a href="/pub/attachments/{a["id"]}" style="display:flex;align-items:center;gap:8px;text-decoration:none;color:inherit;">'
                    f'<span class="pub-attachment-icon">{icon}</span>'
                    f'<div><div class="pub-attachment-name">{_e(orig_name)}</div>'
                    f'<div class="pub-attachment-meta">{_e(mime)}</div></div>'
                    f'</a>'
                    f'{img_preview}'
                    f'</div>'
                )
            attachments_html = (
                f'<section class="pub-attachments">'
                f'<h3>&#128206; Attachments</h3>{att_items}</section>'
            )

        # Cover image — only if the note content starts with an image on the very first line
        cover_html = ""
        first_line = (raw_content or "").strip().split('\n')[0].strip() if raw_content else ""
        if _re.match(r'^!\[.*?\]\(.*?\)$', first_line):
            # gambar pertama yang bukan pratinjau SVG drawing (kartu drawing tidak pernah jadi cover)
            cover_match = next((cm for cm in _re.finditer(r'<img[^>]+src="([^"]+)"[^>]*>', body_html)
                                if not cm.group(1).startswith('data:image/svg+xml')), None)
            if cover_match:
                cover_img = cover_match.group(0).replace(
                    '<img',
                    '<img style="width:100%;max-height:300px;object-fit:cover;border-radius:8px"'
                )
                # elemen <img> diambil dari body_html yang sudah aman (atributnya ter-escape), tidak di-parse ulang
                cover_html = f'<div class="pub-cover">{cover_img}</div>'
                body_html = body_html.replace(cover_match.group(0), '', 1)

        # TOC — parse h1-h3 from raw content, generate slugs, add ids to body_html
        toc_html = ""
        toc_items = []
        for m in _re.finditer(r'^(#{1,3})\s+(.+)$', raw_content, _re.MULTILINE):
            level = len(m.group(1))
            title = m.group(2).strip()
            slug_heading = _re.sub(r'[^\w-]', '', title.lower().replace(' ', '-'))[:50]
            toc_items.append((level, title, slug_heading))

        if toc_items:
            # Add id attributes to heading tags in body_html (assumes same order as raw content)
            heading_idx = [0]
            def _add_heading_id(m):
                if heading_idx[0] < len(toc_items):
                    lvl, tit, sid = toc_items[heading_idx[0]]
                    heading_idx[0] += 1
                    return f'<h{lvl} id="{sid}">'
                return m.group(0)
            body_html = _re.sub(r'<(h[1-3])>', _add_heading_id, body_html)

            # Build TOC list
            toc_list = ""
            for level, title, slug_heading in toc_items:
                cls = f"toc-h{level}" if level > 1 else ""
                toc_list += f'<li class="{cls}"><a href="#{_ea(slug_heading)}">{_e(title)}</a></li>'
            toc_html = f'<section class="pub-toc"><h3>&#128211; Contents</h3><ul>{toc_list}</ul></section>'

        # Build backlinks: other published notes that link to this note
        # (password-protected ones are never listed: their title and slug must not leak to other pages)
        note_title = row["title"] or ""
        backlinks_html = ""
        if note_title.strip():
            t = note_title.strip()
            all_pub = conn.execute(
                """SELECT n.title, n.content, p2.slug, u2.username FROM scratchpad_notes n
                   JOIN published_notes p2 ON p2.note_id = n.id
                   JOIN users u2 ON u2.id = p2.user_id
                   WHERE n.id != ? AND (p2.password_hash IS NULL OR p2.password_hash = '')
                   ORDER BY n.title""",
                (row["note_id"],)
            ).fetchall()
            backlinks = []
            for b in all_pub:
                c = b["content"] or ""
                if f"[[{t}]]" in c or f"\\[\\[{t}]]" in c:
                    backlinks.append(b)
            if backlinks:
                # judul, username, dan slug berasal dari note user lain: di-escape, bukan ditanam mentah
                items = "".join(
                    f'<li><a href="{_pub_href(b["username"], b["slug"])}">{html.escape(b["title"] or "Untitled")}</a></li>'
                    for b in backlinks
                )
                backlinks_html = f'<section><h3>&#128279; Related</h3><ul>{items}</ul></section>'

        try:
            page_html = _fill_template(_PUBLIC_PAGE_HTML, {
                "title": _ea(row["title"] or "Untitled"),
                "description": description,  # sudah html.escape(quote=True)
                "base_url": _ea(WEBAPP_URL),
                "og_url": _ea(WEBAPP_URL) + _pub_href(username, slug),
                "date": _e(date_str),
                "body": body_html,
                "backlinks": backlinks_html,
                "css": _PUBLIC_CSS,
                "author": _e(author),
                "created_date": _e(created_date),
                "updated_date": _e(updated_date),
                "reading_time": str(reading_time),
                "word_count": str(word_count),
                "toc_html": toc_html,
                "tags_html": tags_html,
                "cover_html": cover_html,
                "attachments_html": attachments_html,
                "drawing_html": '',  # kanvas legacy per-note sudah dihapus; slot template dibiarkan kosong
                "drawing_data_js": 'null',
                "svg_img_style": _PUB_SVG_IMG_STYLE,
            })
            return _pub_html_response(page_html)
        except Exception:
            logging.getLogger(__name__).exception("halaman publik gagal disusun (%s/%s)", username, slug)
            # Fallback simple HTML response if formatting fails
            return _pub_html_response(f"""<!DOCTYPE html><html><head><meta charset="utf-8"><title>{html.escape(row["title"] or "Untitled")}</title>{_PUBLIC_CSS}</head><body style="padding:24px;max-width:800px;margin:0 auto;"><div class="pub-body">{body_html}</div></body></html>""")

@app.post("/pub/{username}/{slug}/unlock")
async def unlock_published_note(username: str, slug: str, request: Request):
    """Verify password for a published note, set signed cookie on success."""
    ip = request.client.host if request.client else "unknown"

    # Check brute-force limits
    _check_bruteforce(ip, slug)

    with get_db() as conn:
        row = conn.execute(
            "SELECT p.password_hash, u.username FROM published_notes p JOIN users u ON u.id = p.user_id WHERE p.slug = ? AND u.username = ?",
            (slug, username)
        ).fetchone()
        if not row or not row["password_hash"]:
            return RedirectResponse(url=_pub_path(username, slug), status_code=302)

        # Read password from form
        form = await request.form()
        password = str(form.get("password", ""))

        if not verify_password(password, row["password_hash"]):
            _record_failed_attempt(ip, slug)
            remaining = 5 - len(_ip_attempts.get(ip, deque()))
            return _pub_html_response(_password_gate_html(
                username, slug, f'<p class="pub-error">Password salah. {max(0, remaining)} percobaan tersisa</p>'))

        # Success
        _reset_bruteforce(ip, slug)
        cookie_key = f"pub_unlock_{slug}"
        cookie_val = _sign_cookie(slug)
        response = RedirectResponse(url=_pub_path(username, slug), status_code=302)
        response.set_cookie(
            key=cookie_key,
            value=cookie_val,
            max_age=30 * 24 * 3600,   # 30 days
            httponly=True,
            samesite="lax",
            secure=True
        )
        return response

@app.get("/api/scratchpad/{note_id}/backlinks")
async def get_backlinks(note_id: int, user=Depends(get_current_user)):
    """Return all accessible notes that link to this note."""
    uid = user["sub"]
    access_clause, access_params = _note_access_clause(uid)
    with get_db() as conn:
        target = conn.execute(f"""
            SELECT id, title FROM scratchpad_notes
            WHERE id = ? AND {access_clause}
        """, [note_id] + access_params).fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="Note tidak ditemukan")
        title = (target["title"] or "").strip()
        ac2, ap2 = _note_access_clause(uid)
        if title:
            rows = conn.execute(f"""
                SELECT DISTINCT id, title, updated_at FROM scratchpad_notes
                WHERE {ac2} AND id != ?
                  AND (
                      (json_type(linked_to) = 'array'
                       AND EXISTS (SELECT 1 FROM json_each(linked_to) WHERE value = ?))
                      OR content LIKE ?
                      OR content LIKE ?
                      OR content LIKE ?
                      OR content LIKE ?
                  )
                ORDER BY updated_at DESC
            """, ap2 + [note_id, note_id,
                        f"%[[{title}]]%", f"%[[{title}|%",
                        f"%\\[\\[{title}\\]\\]%", f"%\\[\\[{title}|%"]).fetchall()
        else:
            rows = conn.execute(f"""
                SELECT id, title, updated_at FROM scratchpad_notes
                WHERE {ac2} AND id != ?
                  AND json_type(linked_to) = 'array'
                  AND EXISTS (SELECT 1 FROM json_each(linked_to) WHERE value = ?)
                ORDER BY updated_at DESC
            """, ap2 + [note_id, note_id]).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/tags")
async def list_tags(entity_type: str = "", user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        if entity_type:
            rows = conn.execute("""
                SELECT DISTINCT t.id, t.name, t.color, COUNT(et.entity_id) as count
                FROM tags t
                JOIN entity_tags et ON t.id = et.tag_id
                WHERE t.user_id = ? AND et.entity_type = ?
                GROUP BY t.id ORDER BY count DESC, t.name ASC
            """, (uid, entity_type)).fetchall()
        else:
            rows = conn.execute("""
                SELECT t.id, t.name, t.color, COUNT(et.entity_id) as count
                FROM tags t
                LEFT JOIN entity_tags et ON t.id = et.tag_id
                WHERE t.user_id = ?
                GROUP BY t.id ORDER BY count DESC, t.name ASC
            """, (uid,)).fetchall()
        return [dict(r) for r in rows]

class TagUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None

@app.patch("/api/tags/{tag_id}")
async def update_tag(tag_id: int, req: TagUpdate, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        tag = conn.execute("SELECT id FROM tags WHERE id = ? AND user_id = ?", (tag_id, uid)).fetchone()
        if not tag:
            raise HTTPException(status_code=404, detail="Tag tidak ditemukan")
        if req.name is not None:
            name = req.name.strip().lower()
            if not name:
                raise HTTPException(status_code=400, detail="Nama tag tidak boleh kosong")
            try:
                conn.execute("UPDATE tags SET name = ? WHERE id = ?", (name, tag_id))
            except sqlite3.IntegrityError:
                raise HTTPException(status_code=409, detail="Tag dengan nama ini sudah ada")
        if req.color is not None:
            conn.execute("UPDATE tags SET color = ? WHERE id = ?", (req.color, tag_id))
        conn.commit()
        return dict(conn.execute("SELECT * FROM tags WHERE id = ?", (tag_id,)).fetchone())

@app.delete("/api/tags/{tag_id}")
async def delete_tag(tag_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        tag = conn.execute("SELECT id FROM tags WHERE id = ? AND user_id = ?", (tag_id, uid)).fetchone()
        if not tag:
            raise HTTPException(status_code=404, detail="Tag tidak ditemukan")
        conn.execute("DELETE FROM entity_tags WHERE tag_id = ?", (tag_id,))
        conn.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
        conn.commit()
    return {"ok": True}


@app.get("/api/search")
async def global_search(q: str = "", user=Depends(get_current_user)):
    q = q.strip()
    if len(q) < 2:
        raise HTTPException(status_code=400, detail="Query minimal 2 karakter")
    uid = user["sub"]
    like = f"%{q}%"
    with get_db() as conn:
        # Tags
        tag_rows = conn.execute("""
            SELECT t.id, t.name, COUNT(et.entity_id) as count
            FROM tags t
            LEFT JOIN entity_tags et ON t.id = et.tag_id
            WHERE t.user_id = ? AND t.name LIKE ?
            GROUP BY t.id ORDER BY count DESC, t.name ASC
            LIMIT 5
        """, (uid, like)).fetchall()

        # Tasks (exclude done/archived)
        access_clause = (
            "user_id = ? OR list_id IN ("
            "  SELECT id FROM shared_lists WHERE owner_id = ?"
            "  UNION SELECT list_id FROM list_members WHERE user_id = ?"
            ")"
        )
        task_rows = conn.execute(f"""
            SELECT id, title, priority, gtd_status, deadline, quadrant, client_id
            FROM tasks
            WHERE ({access_clause})
              AND gtd_status NOT IN ('done','archived')
              AND (title LIKE ? OR description LIKE ?)
            ORDER BY priority, deadline
            LIMIT 8
        """, (uid, uid, uid, like, like)).fetchall()

        # Notes (personal + shared)
        note_ac, note_ap = _note_access_clause(uid)
        note_rows = conn.execute(f"""
            SELECT id, title, content, updated_at, client_id
            FROM scratchpad_notes
            WHERE {note_ac} AND (title LIKE ? OR content LIKE ?)
            ORDER BY updated_at DESC
            LIMIT 8
        """, note_ap + [like, like]).fetchall()

        # Mindmaps (personal + shared)
        mm_ac, mm_ap = _mindmap_access_clause(uid)
        mindmap_rows = conn.execute(f"""
            SELECT id, title, updated_at, client_id, search_text
            FROM mindmaps
            WHERE {mm_ac} AND (title LIKE ? OR search_text LIKE ?)
            ORDER BY updated_at DESC
            LIMIT 8
        """, mm_ap + [like, like]).fetchall()

        # Drawings
        dr_ac, dr_ap = drawing_scope.access_clause(uid)
        drawing_rows = conn.execute(f"""
            SELECT id, title, updated_at
            FROM drawings
            WHERE {dr_ac} AND (title LIKE ? OR data_json LIKE ?)
            ORDER BY is_pinned DESC, updated_at DESC
            LIMIT 8
        """, dr_ap + [like, like]).fetchall()

    def snippet(text, length=80):
        if not text:
            return ""
        text = text.strip()
        return text[:length] + ("…" if len(text) > length else "")

    return {
        "tags": [dict(r) for r in tag_rows],
        "tasks": [dict(r) for r in task_rows],
        "notes": [
            {**dict(r), "content": snippet(r["content"])}
            for r in note_rows
        ],
        "mindmaps": [
            {"id": r["id"], "title": r["title"], "updated_at": r["updated_at"], "client_id": r["client_id"],
             "snippet": _mindmap_match_snippet(r["search_text"] or "", q)}
            for r in mindmap_rows
        ],
        "drawings": [dict(r) for r in drawing_rows],
    }


# ── Mindmap endpoints ────────────────────────────────────────────────────────

@app.get("/api/mindmaps")
async def list_mindmaps(linked: int = 0, user=Depends(get_current_user)):
    # Petakan: klien lama tidak mengenal peta tertaut → disembunyikan kecuali ?linked=1.
    uid = user["sub"]
    with get_db() as conn:
        access_clause, access_params = _mindmap_access_clause(uid)
        linked_clause = "" if linked == 1 else " AND source_note_id IS NULL"
        rows = conn.execute(
            "SELECT id, title, list_id, user_id, last_edited_by, created_at, updated_at, client_id, source_note_id, "
            "EXISTS(SELECT 1 FROM mindmap_pins p WHERE p.mindmap_id = mindmaps.id AND p.user_id = ?) AS is_pinned "
            f"FROM mindmaps WHERE {access_clause}{linked_clause} ORDER BY is_pinned DESC, updated_at DESC",
            [uid] + access_params
        ).fetchall()
        return [_mindmap_enrich(dict(r), conn) for r in rows]


# Rute statis /api/mindmaps/trash… HARUS di atas /api/mindmaps/{mid} (int) agar tidak 422.
@app.get("/api/mindmaps/trash")
async def list_trashed_mindmaps(user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        _purge_expired_trashed_mindmaps(conn)
        rows = conn.execute(
            "SELECT mindmap_id, title, list_id, source_note_id, client_id, snapshot_json, deleted_at "
            "FROM trashed_mindmaps WHERE user_id = ? ORDER BY deleted_at DESC", (uid,)).fetchall()
    out = []
    for r in rows:
        linked = r["source_note_id"] is not None
        preview = ""
        if not linked:
            try:
                mm = (json.loads(r["snapshot_json"]) or {}).get("mindmap") or {}
            except Exception:
                mm = {}
            preview = " · ".join(_mindmap_topics(mm.get("data_json"))[1:4])
        out.append({
            "id": r["mindmap_id"],
            "title": r["title"],
            "preview": preview,
            "list_id": r["list_id"],
            "source_note_id": r["source_note_id"],
            "linked": linked,
            "client_id": r["client_id"],
            "deleted_at": r["deleted_at"],
            "days_left": _trash_days_left(r["deleted_at"], MINDMAP_TRASH_RETENTION_DAYS),
        })
    return out


@app.post("/api/mindmaps/trash/{mid}/restore")
async def restore_trashed_mindmap(mid: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        _purge_expired_trashed_mindmaps(conn)
        trow = conn.execute(
            "SELECT snapshot_json FROM trashed_mindmaps WHERE mindmap_id = ? AND user_id = ?", (mid, uid)
        ).fetchone()
        if not trow:
            raise HTTPException(status_code=404, detail="Mindmap tidak ada di Sampah")
        if conn.execute("SELECT 1 FROM mindmaps WHERE id = ?", (mid,)).fetchone():
            raise HTTPException(status_code=409, detail="Mindmap dengan id ini sudah ada")
        snap = json.loads(trow["snapshot_json"])
        mm = dict(snap.get("mindmap") or {})
        mm["id"] = mid
        mm["user_id"] = uid

        def _user_exists(user_id) -> bool:
            return user_id is not None and conn.execute(
                "SELECT 1 FROM users WHERE id = ?", (user_id,)).fetchone() is not None

        sn = mm.get("source_note_id")
        if sn is not None:
            if not conn.execute("SELECT id FROM scratchpad_notes WHERE id = ?", (sn,)).fetchone():
                raise HTTPException(status_code=409, detail={"code": "SOURCE_NOTE_MISSING"})
            existing = conn.execute("SELECT * FROM mindmaps WHERE source_note_id = ?", (sn,)).fetchone()
            if existing:
                # Isi peta tertaut hanya view-state: item Sampah dibuang, peta yang ada dikembalikan.
                conn.execute("DELETE FROM trashed_mindmaps WHERE mindmap_id = ?", (mid,))
                conn.commit()
                return _mindmap_enrich(dict(existing), conn, uid)
        else:
            lid = mm.get("list_id")
            if lid is not None and not conn.execute(
                    "SELECT 1 FROM shared_lists WHERE id = ? AND (owner_id = ? OR id IN "
                    "(SELECT list_id FROM list_members WHERE user_id = ?))", (lid, uid, uid)).fetchone():
                mm["list_id"] = None
        if mm.get("client_id") and conn.execute(
                "SELECT 1 FROM mindmaps WHERE user_id = ? AND client_id = ?", (uid, mm["client_id"])).fetchone():
            mm["client_id"] = None
        if mm.get("last_edited_by") is not None and not _user_exists(mm["last_edited_by"]):
            mm["last_edited_by"] = None

        if isinstance(mm.get("data_json"), str):
            mm["data_json"] = safehtml.sanitize_mind_json(mm["data_json"])
        live_cols = set(_table_columns(conn, "mindmaps"))
        if "search_text" in live_cols:
            mm["search_text"] = "" if sn is not None else _mindmap_search_text(mm.get("data_json"))
        cols = [c for c in mm if c in live_cols]
        conn.execute(
            f"INSERT INTO mindmaps ({','.join(cols)}) VALUES ({','.join('?' * len(cols))})",
            [mm[c] for c in cols])
        for pid in dict.fromkeys(snap.get("pins") or []):
            if _user_exists(pid):
                conn.execute(
                    "INSERT OR IGNORE INTO mindmap_pins (user_id, mindmap_id, created_at) VALUES (?, ?, ?)",
                    (pid, mid, datetime.now(_TZ_JKT).isoformat()))
        conn.execute("DELETE FROM trashed_mindmaps WHERE mindmap_id = ?", (mid,))
        if sn is not None:
            _sync_linked_mindmap(conn, sn)
        conn.commit()
        restored = conn.execute("SELECT * FROM mindmaps WHERE id = ?", (mid,)).fetchone()
        linked = restored["source_note_id"] is not None
        editor_name = _mindmap_editor_name(conn, uid)
        result = _mindmap_enrich(dict(restored), conn, uid)
    if not linked:
        # Pelanggan lama sudah terputus oleh mindmap_deleted; sinyal ini menjangkau stream baru (mis. sambung ulang).
        await _mindmap_broadcast(mid, {
            "type": "mindmap_changed", "id": mid, "updated_at": restored["updated_at"],
            "editor_id": uid, "editor_name": editor_name,
        })
    return result


@app.delete("/api/mindmaps/trash/{mid}")
async def purge_trashed_mindmap(mid: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        _ensure_trashed_mindmaps_table(conn)
        conn.execute("DELETE FROM trashed_mindmaps WHERE mindmap_id = ? AND user_id = ?", (mid, uid))
    return {"ok": True}


@app.delete("/api/mindmaps/trash")
async def empty_trashed_mindmaps(user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        _ensure_trashed_mindmaps_table(conn)
        gone = conn.execute(
            "DELETE FROM trashed_mindmaps WHERE user_id = ? RETURNING mindmap_id", (uid,)).fetchall()
    return {"ok": True, "deleted": len(gone)}


class MindmapShareReq(BaseModel):
    list_id: Optional[int] = None


class NoteTemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    group_name: str = Field(min_length=1, max_length=100)
    content: str = Field(min_length=1)


class NoteTemplateUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    group_name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    content: Optional[str] = Field(default=None, min_length=1)


_DEFAULT_NOTE_TEMPLATES = [
    {
        "group_name": "Umum & Penangkapan Cepat",
        "name": "Catatan Cepat",
        "sort_order": 0,
        "content": "# Catatan Cepat\n\n## Inti Pikiran\n- \n\n## Detail\n- \n\n## Tindakan Selanjutnya\n- [ ] \n\n---\n\n#catatan #cepat",
    },
    {
        "group_name": "Umum & Penangkapan Cepat",
        "name": "Curah Pikiran",
        "sort_order": 1,
        "content": "# Curah Pikiran\n\n## Apa yang Sedang Saya Pikirkan\n- \n\n---\n\n#ide #brainstorm",
    },
    {
        "group_name": "Pekerjaan & Proyek",
        "name": "Log Harian",
        "sort_order": 0,
        "content": "# Log Harian - [Tanggal]\n\n## Fokus Hari Ini\n- \n\n## Progress\n- \n\n## Hambatan\n- \n\n## Besok\n- \n\n---\n\n#log #harian",
    },
    {
        "group_name": "Pekerjaan & Proyek",
        "name": "Catatan Rapat",
        "sort_order": 1,
        "content": "# Judul Rapat\n\n**Tanggal:**  \n**Peserta:**  \n\n## Agenda\n- \n\n## Diskusi\n- \n\n## Keputusan\n- \n\n## Tindak Lanjut\n- [ ] \n\n---\n\n#rapat #meeting",
    },
    {
        "group_name": "Pekerjaan & Proyek",
        "name": "Perencanaan Proyek",
        "sort_order": 2,
        "content": "# Nama Proyek\n\n## Tujuan\n- \n\n## Ruang Lingkup\n- \n\n## Timeline & Milestone\n- \n\n## Tugas\n- [ ] \n\n---\n\n#proyek #planning",
    },
    {
        "group_name": "Pekerjaan & Proyek",
        "name": "Pemecahan Masalah",
        "sort_order": 3,
        "content": "# Masalah / Isu\n\n## Kondisi Saat Ini\n- \n\n## Akar Penyebab\n- \n\n## Dampak\n- \n\n## Solusi\n- \n\n## Tindakan Lanjutan\n- [ ] \n\n---\n\n#masalah #solusi",
    },
    {
        "group_name": "Pekerjaan & Proyek",
        "name": "Pengambilan Keputusan",
        "sort_order": 4,
        "content": "# Topik Keputusan\n\n## Opsi\n- \n\n## Kelebihan & Kekurangan\n- **Opsi A:** (+)... (-) ...\n- **Opsi B:** (+)... (-) ...\n\n## Keputusan Akhir\n- \n\n---\n\n#keputusan #analisis",
    },
    {
        "group_name": "Evaluasi & Pembelajaran",
        "name": "Tinjauan Mingguan",
        "sort_order": 0,
        "content": "# Tinjauan Mingguan\n\n## Pencapaian\n- \n\n## Kegagalan / Tantangan\n- \n\n## Pelajaran yang Dipetik\n- \n\n## Fokus Minggu Depan\n- \n\n---\n\n#review #mingguan",
    },
    {
        "group_name": "Evaluasi & Pembelajaran",
        "name": "Catatan Pembelajaran",
        "sort_order": 1,
        "content": "# Topik\n\n**Sumber:**  \n\n## Insight Utama\n- \n\n## Kutipan Penting\n> \n\n## Hal yang Dapat Diterapkan\n- \n\n---\n\n#belajar #insight",
    },
]


@app.get("/api/note-templates")
async def list_note_templates(user=Depends(get_current_user)):
    uid = user["sub"]
    now = datetime.now(_TZ_JKT).isoformat()
    _q = ("SELECT id, name, group_name, content, is_default, sort_order FROM note_templates "
          "WHERE user_id = ? ORDER BY group_name, sort_order, name")
    with get_db() as conn:
        rows = conn.execute(_q, (uid,)).fetchall()
        if not rows:
            for t in _DEFAULT_NOTE_TEMPLATES:
                conn.execute(
                    "INSERT INTO note_templates (user_id, name, group_name, content, is_default, sort_order, created_at, updated_at) "
                    "VALUES (?, ?, ?, ?, 1, ?, ?, ?)",
                    (uid, t["name"], t["group_name"], t["content"], t["sort_order"], now, now)
                )
            conn.commit()
            rows = conn.execute(_q, (uid,)).fetchall()
        return [dict(r) for r in rows]


@app.post("/api/note-templates")
async def create_note_template(body: NoteTemplateCreate, user=Depends(get_current_user)):
    uid = user["sub"]
    now = datetime.now(_TZ_JKT).isoformat()
    with get_db() as conn:
        max_order = conn.execute(
            "SELECT COALESCE(MAX(sort_order), -1) FROM note_templates WHERE user_id = ? AND group_name = ?",
            (uid, body.group_name)
        ).fetchone()[0]
        cur = conn.execute(
            "INSERT INTO note_templates (user_id, name, group_name, content, is_default, sort_order, created_at, updated_at) "
            "VALUES (?, ?, ?, ?, 0, ?, ?, ?)",
            (uid, body.name, body.group_name, body.content, max_order + 1, now, now)
        )
        conn.commit()
        row = conn.execute(
            "SELECT id, name, group_name, content, is_default, sort_order FROM note_templates WHERE id = ?",
            (cur.lastrowid,)
        ).fetchone()
    return dict(row)


@app.put("/api/note-templates/{tid}")
async def update_note_template(tid: int, body: NoteTemplateUpdate, user=Depends(get_current_user)):
    uid = user["sub"]
    now = datetime.now(_TZ_JKT).isoformat()
    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM note_templates WHERE id = ? AND user_id = ?", (tid, uid)
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=403, detail="Not found or forbidden")
        _allowed = {"name", "group_name", "content"}
        updates = {k: v for k, v in body.dict().items() if v is not None and k in _allowed}
        if not updates:
            row = conn.execute(
                "SELECT id, name, group_name, content, is_default, sort_order FROM note_templates WHERE id = ?", (tid,)
            ).fetchone()
            return dict(row)
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [now, tid]
        conn.execute(f"UPDATE note_templates SET {set_clause}, updated_at = ? WHERE id = ?", values)
        conn.commit()
        row = conn.execute(
            "SELECT id, name, group_name, content, is_default, sort_order FROM note_templates WHERE id = ?", (tid,)
        ).fetchone()
    return dict(row)


@app.delete("/api/note-templates/{tid}")
async def delete_note_template(tid: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        existing = conn.execute(
            "SELECT id FROM note_templates WHERE id = ? AND user_id = ?", (tid, uid)
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=403, detail="Not found or forbidden")
        conn.execute("DELETE FROM note_templates WHERE id = ?", (tid,))
        conn.commit()
    return {"ok": True}


@app.patch("/api/mindmaps/{mid}/share")
async def share_mindmap(mid: str, req: MindmapShareReq, user=Depends(get_current_user)):
    uid = user["sub"]
    list_id = req.list_id
    with get_db() as conn:
        if mid.isdigit():
            mm = conn.execute("SELECT id, user_id, source_note_id FROM mindmaps WHERE id = ?", (int(mid),)).fetchone()
        else:
            cols = [r["name"] for r in conn.execute("PRAGMA table_info(mindmaps)").fetchall()]
            if "client_id" in cols:
                mm = conn.execute("SELECT id, user_id, source_note_id FROM mindmaps WHERE client_id = ?", (mid,)).fetchone()
            else:
                mm = None
        if not mm:
            raise HTTPException(status_code=404, detail="Mindmap tidak ditemukan")
        if mm["user_id"] != uid:
            raise HTTPException(status_code=403, detail="Hanya pemilik mindmap yang bisa berbagi")
        if mm["source_note_id"] is not None:
            raise HTTPException(status_code=409, detail="Peta tertaut mengikuti catatan")
        real_mid = mm["id"]
        if list_id is not None:
            repo = TaskRepository(DB_PATH)
            if not repo.is_list_member_or_owner(list_id, uid):
                raise HTTPException(status_code=403, detail="Bukan anggota list ini")
        now = datetime.now(_TZ_JKT).isoformat()
        conn.execute("UPDATE mindmaps SET list_id = ?, updated_at = ? WHERE id = ?", (list_id, now, real_mid))
        updated = conn.execute("SELECT id, title, is_pinned, list_id, user_id, last_edited_by, created_at, updated_at, client_id FROM mindmaps WHERE id = ?", (real_mid,)).fetchone()
        editor_name = _mindmap_editor_name(conn, uid)
        result = _mindmap_enrich(dict(updated), conn, uid)
    await _mindmap_broadcast(real_mid, {
        "type": "mindmap_changed", "id": real_mid, "updated_at": updated["updated_at"],
        "editor_id": uid, "editor_name": editor_name,
    })
    return result



@app.get("/api/lists/{list_id}/mindmaps")
async def get_list_mindmaps(list_id: int, linked: int = 0, user=Depends(get_current_user)):
    uid = user["sub"]
    repo = TaskRepository(DB_PATH)
    if not repo.is_list_member_or_owner(list_id, uid):
        raise HTTPException(status_code=403, detail="Bukan anggota list ini")
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, title, updated_at, source_note_id FROM mindmaps WHERE list_id = ?"
            + ("" if linked == 1 else " AND source_note_id IS NULL")
            + " ORDER BY updated_at DESC",
            (list_id,)
        ).fetchall()
    return [dict(r) for r in rows]

@app.post("/api/mindmaps")
async def create_mindmap(req: MindmapCreate, user=Depends(get_current_user)):
    uid = user["sub"]
    now = datetime.now(_TZ_JKT).isoformat()
    if req.source_note_id is not None:
        # Petakan: satu peta tertaut per catatan (idempoten per catatan, abaikan title/data_json/list_id klien).
        note_ac, note_params = _note_access_clause(uid)
        with get_db() as conn:
            note = conn.execute(
                f"SELECT id, user_id, list_id, title FROM scratchpad_notes WHERE id = ? AND {note_ac}",
                [req.source_note_id] + note_params
            ).fetchone()
            if not note:
                raise HTTPException(status_code=404, detail="Catatan tidak ditemukan")
            existing = conn.execute(
                "SELECT * FROM mindmaps WHERE source_note_id = ?", (note["id"],)
            ).fetchone()
            if existing:
                return _mindmap_enrich(dict(existing), conn, uid)
            # Idempotensi peta tertaut hanya per catatan. Indeks unik (user_id, client_id) memakai pemilik
            # catatan; bila pemilik sudah punya baris dengan client_id itu, simpan NULL agar INSERT tidak bentrok.
            link_cid = req.client_id
            if link_cid and conn.execute(
                "SELECT 1 FROM mindmaps WHERE user_id = ? AND client_id = ?", (note["user_id"], link_cid)
            ).fetchone():
                link_cid = None
            try:
                cur = conn.execute(
                    "INSERT INTO mindmaps (user_id, title, data_json, is_pinned, created_at, updated_at, "
                    "list_id, client_id, last_edited_by, source_note_id, search_text) "
                    "VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?, ?, '')",
                    (note["user_id"], note["title"] or "Tanpa judul", LINKED_VIEW_STATE_DEFAULT, now, now,
                     note["list_id"], link_cid, uid, note["id"])
                )
            except sqlite3.IntegrityError:
                existing = conn.execute(
                    "SELECT * FROM mindmaps WHERE source_note_id = ?", (note["id"],)
                ).fetchone()
                if not existing:
                    raise
                return _mindmap_enrich(dict(existing), conn, uid)
            row = conn.execute("SELECT * FROM mindmaps WHERE id = ?", (cur.lastrowid,)).fetchone()
            return _mindmap_enrich(dict(row), conn, uid)
    # audit S7: list_id saat create disimpan (dulu diabaikan → peta offline di list bersama jadi pribadi);
    # keanggotaan dicek seperti di /share.
    if req.list_id is not None:
        repo = TaskRepository(DB_PATH)
        if not repo.is_list_member_or_owner(req.list_id, uid):
            raise HTTPException(status_code=403, detail="Bukan anggota list ini")
    with get_db() as conn:
        # Idempotensi retry sync (audit T11): (user_id, client_id) sudah ada → kembalikan baris itu.
        if req.client_id:
            dup = conn.execute(
                "SELECT * FROM mindmaps WHERE user_id = ? AND client_id = ?", (uid, req.client_id)
            ).fetchone()
            if dup:
                return _mindmap_enrich(dict(dup), conn, uid)
        try:
            cur = conn.execute(
                "INSERT INTO mindmaps (user_id, title, data_json, is_pinned, created_at, updated_at, list_id, client_id, search_text) "
                "VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)",
                (uid, req.title, req.data_json, now, now, req.list_id, req.client_id,
                 _mindmap_search_text(req.data_json))
            )
        except sqlite3.IntegrityError:
            dup = conn.execute(
                "SELECT * FROM mindmaps WHERE user_id = ? AND client_id = ?", (uid, req.client_id)
            ).fetchone() if req.client_id else None
            if not dup:
                raise
            return _mindmap_enrich(dict(dup), conn, uid)
        row = conn.execute("SELECT * FROM mindmaps WHERE id = ?", (cur.lastrowid,)).fetchone()
        return _mindmap_enrich(dict(row), conn, uid)

def _mindmap_push(mid: int, uid: int, q: asyncio.Queue, event: dict) -> None:
    """Antrean pelanggan dibatasi (100): bila penuh (klien macet) pelanggan dilepas;
    klien akan menyambung ulang dan menarik keadaan terbaru."""
    try:
        q.put_nowait(event)
    except asyncio.QueueFull:
        mindmap_subscribers.get(mid, set()).discard((uid, q))


async def _mindmap_broadcast(mid: int, event: dict) -> None:
    """Kirim sinyal ke pelanggan stream peta `mid`. Event bukan 'mindmap_deleted' hanya
    sampai ke pelanggan yang MASIH punya akses; sisanya menerima 'mindmap_access_lost'
    dan dilepas dari daftar pelanggan. Tidak pernah membawa isi peta.
    Dipanggil setelah commit: kegagalan apa pun hanya dicatat, tidak pernah menggagalkan request."""
    try:
        subs = list(mindmap_subscribers.get(mid, set()))
        if not subs:
            return
        if event.get("type") == "mindmap_deleted":
            for uid, q in subs:
                _mindmap_push(mid, uid, q, event)
            return
        verdicts = []
        with get_db() as conn:
            for uid, q in subs:
                ac, ap = _mindmap_access_clause(uid)
                ok = conn.execute(
                    f"SELECT 1 FROM mindmaps WHERE id = ? AND {ac}", [mid] + ap
                ).fetchone() is not None
                verdicts.append((uid, q, ok))
        for uid, q, ok in verdicts:
            if ok:
                _mindmap_push(mid, uid, q, event)
            else:
                _mindmap_push(mid, uid, q, {"type": "mindmap_access_lost", "id": mid})
                mindmap_subscribers.get(mid, set()).discard((uid, q))
    except Exception:
        logging.getLogger(__name__).exception("mindmap broadcast gagal (mid=%s)", mid)


def _mindmap_editor_name(conn, uid: int) -> str:
    r = conn.execute("SELECT username, display_name FROM users WHERE id = ?", (uid,)).fetchone()
    return ((r["display_name"] or r["username"]) if r else "") or ""


@app.get("/api/mindmaps/{mid}/stream")
async def mindmap_stream(mid: int, request: Request, user=Depends(get_current_user_sse)):
    # EventSource tidak bisa mengirim header Authorization → get_current_user_sse (token query/cookie).
    uid = user["sub"]
    with get_db() as conn:
        ac, ap = _mindmap_access_clause(uid)
        row = conn.execute(
            f"SELECT source_note_id FROM mindmaps WHERE id = ? AND {ac}", [mid] + ap
        ).fetchone()
        # Peta tertaut (Petakan) tidak berlangganan SSE.
        if not row or row["source_note_id"] is not None:
            raise HTTPException(status_code=404, detail="Mindmap tidak ditemukan")

    async def event_generator():
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        entry = (uid, q)
        mindmap_subscribers[mid].add(entry)
        try:
            while True:
                if await request.is_disconnected():
                    break
                if entry not in mindmap_subscribers.get(mid, ()):
                    # Dilepas broadcast (antrean penuh / akses dicabut): kirim sinyal penutup yang masih antre, lalu
                    # tutup stream → EventSource klien menyambung ulang dan menarik keadaan terbaru (tanpa ini
                    # pelanggan yang dilepas tetap menerima ping dan terlihat hidup selamanya).
                    while not q.empty():
                        msg = q.get_nowait()
                        if msg.get("type") in ("mindmap_access_lost", "mindmap_deleted"):
                            yield {"data": json.dumps(msg)}
                            break
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=20.0)
                    yield {"data": json.dumps(msg)}
                    if msg.get("type") in ("mindmap_access_lost", "mindmap_deleted"):
                        break
                except asyncio.TimeoutError:
                    if not _session_still_valid(user):
                        break  # password diganti → tutup stream
                    yield {"data": json.dumps({"type": "ping"})}
        finally:
            mindmap_subscribers[mid].discard(entry)
            if not mindmap_subscribers.get(mid):
                mindmap_subscribers.pop(mid, None)

    return EventSourceResponse(event_generator())


@app.get("/api/mindmaps/{mid}")
async def get_mindmap(mid: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        access_clause, access_params = _mindmap_access_clause(uid)
        row = conn.execute(
            f"SELECT * FROM mindmaps WHERE id = ? AND {access_clause}", [mid] + access_params
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Mindmap tidak ditemukan")
        return _mindmap_enrich(dict(row), conn, uid)

@app.put("/api/mindmaps/{mid}")
async def update_mindmap(mid: int, req: MindmapUpdate, user=Depends(get_current_user)):
    uid = user["sub"]
    now = datetime.now(_TZ_JKT).isoformat()
    with get_db() as conn:
        access_clause, access_params = _mindmap_access_clause(uid)
        row = conn.execute(
            f"SELECT * FROM mindmaps WHERE id = ? AND {access_clause}", [mid] + access_params
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Mindmap tidak ditemukan")
        if row["source_note_id"] is not None:
            # Peta tertaut: data_json hanya view-state; judul/list mengikuti catatan; tanpa base_rev.
            if req.data_json is not None:
                try:
                    parsed = json.loads(req.data_json)
                except ValueError:
                    parsed = None
                if not isinstance(parsed, dict) or "nodeData" in parsed:
                    raise HTTPException(status_code=400, detail={"code": "LINKED_TREE_REJECTED"})
            new_title = row["title"]
        else:
            _check_base_rev(req, row, lambda: _mindmap_enrich(dict(row), conn, uid))
            new_title = req.title if req.title is not None else row["title"]
        new_data = req.data_json if req.data_json is not None else row["data_json"]
        if req.data_json is not None:
            st = "" if row["source_note_id"] is not None else _mindmap_search_text(new_data)
            conn.execute(
                "UPDATE mindmaps SET title = ?, data_json = ?, last_edited_by = ?, updated_at = ?, "
                "search_text = ? WHERE id = ?",
                (new_title, new_data, uid, now, st, mid)
            )
        else:
            conn.execute(
                "UPDATE mindmaps SET title = ?, data_json = ?, last_edited_by = ?, updated_at = ? WHERE id = ?",
                (new_title, new_data, uid, now, mid)
            )
        updated = conn.execute("SELECT * FROM mindmaps WHERE id = ?", (mid,)).fetchone()
        linked = row["source_note_id"] is not None
        editor_name = _mindmap_editor_name(conn, uid)
        result = _mindmap_enrich(dict(updated), conn, uid)
    if not linked:
        await _mindmap_broadcast(mid, {
            "type": "mindmap_changed", "id": mid, "updated_at": updated["updated_at"],
            "editor_id": uid, "editor_name": editor_name,
        })
    return result

class MindmapPinReq(BaseModel):
    pinned: Optional[bool] = None


@app.patch("/api/mindmaps/{mid}/pin")
async def toggle_pin_mindmap(mid: int, req: Optional[MindmapPinReq] = None, user=Depends(get_current_user)):
    """Pin pribadi per user (anggota list bersama boleh pin). Tanpa body = toggle; tidak menyentuh updated_at."""
    uid = user["sub"]
    with get_db() as conn:
        access_clause, access_params = _mindmap_access_clause(uid)
        row = conn.execute(
            f"SELECT id FROM mindmaps WHERE id = ? AND {access_clause}", [mid] + access_params
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Mindmap tidak ditemukan")
        currently = conn.execute(
            "SELECT 1 FROM mindmap_pins WHERE user_id = ? AND mindmap_id = ?", (uid, mid)
        ).fetchone() is not None
        want = req.pinned if req and req.pinned is not None else not currently
        if want:
            conn.execute(
                "INSERT OR IGNORE INTO mindmap_pins (user_id, mindmap_id, created_at) VALUES (?, ?, ?)",
                (uid, mid, datetime.now(_TZ_JKT).isoformat())
            )
        else:
            conn.execute("DELETE FROM mindmap_pins WHERE user_id = ? AND mindmap_id = ?", (uid, mid))
        updated = conn.execute("SELECT * FROM mindmaps WHERE id = ?", (mid,)).fetchone()
        return _mindmap_enrich(dict(updated), conn, uid)

@app.delete("/api/mindmaps/{mid}")
async def delete_mindmap(mid: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        row = conn.execute("SELECT * FROM mindmaps WHERE id = ?", (mid,)).fetchone()
        if not row:
            _ensure_trashed_mindmaps_table(conn)
            # Idempoten untuk perangkat kedua: peta sudah di Sampah milik user.
            if conn.execute(
                "SELECT 1 FROM trashed_mindmaps WHERE mindmap_id = ? AND user_id = ?", (mid, uid)
            ).fetchone():
                return {"ok": True, "trashed": True}
            raise HTTPException(status_code=404, detail="Mindmap tidak ditemukan")
        if row["user_id"] != uid:
            raise HTTPException(status_code=403, detail="Hanya pemilik yang bisa menghapus mindmap ini")
        _snapshot_mindmap_to_trash(conn, row, uid)
        conn.execute("DELETE FROM mindmap_pins WHERE mindmap_id = ?", (mid,))
        conn.execute("DELETE FROM mindmaps WHERE id = ?", (mid,))
    await _mindmap_broadcast(mid, {"type": "mindmap_deleted", "id": mid})
    return {"ok": True, "trashed": True}


# ── Standalone Drawings endpoints ────────────────────────────────────────────

def _drawing_note_index(conn, viewer_uid: int) -> list:
    """Note yang bisa diakses viewer dan memuat ::draw, urut updated_at DESC, sebagai [(id, title, tokens)].
    Satu query untuk seluruh daftar drawing (jalur pull sinkron), bukan satu per drawing."""
    note_ac, note_ap = _note_access_clause(viewer_uid)
    # SQLite LIKE tak peka huruf besar/kecil untuk ASCII: ::DRAW ikut lolos prefilter ini
    rows = conn.execute(
        f"SELECT id, title, content FROM scratchpad_notes WHERE {note_ac} AND content LIKE '%::draw%' "
        "ORDER BY updated_at DESC",
        note_ap
    ).fetchall()
    return [(r["id"], r["title"], drawing_scope.draw_tokens(r["content"])) for r in rows]


def _drawing_enrich(row_dict: dict, conn, viewer_uid: int, note_index: Optional[list] = None) -> dict:
    did = row_dict["id"]
    # Penanda baris server: client mengecek d.server_id == null untuk mengenali baris
    # LOKAL yang belum tersinkron (junk-row guard di selectDrawing). Semua baris yang
    # berasal dari DB server membawa server_id == id.
    row_dict["server_id"] = row_dict["id"]
    tag_rows = conn.execute(
        "SELECT t.name FROM tags t JOIN entity_tags et ON t.id = et.tag_id "
        "WHERE et.entity_type = 'drawing' AND et.entity_id = ? ORDER BY t.name",
        (did,)
    ).fetchall()
    row_dict["tags"] = [r["name"] for r in tag_rows]
    row_dict.setdefault("list_id", None)
    row_dict.setdefault("last_edited_by", None)
    if row_dict["last_edited_by"] and row_dict["last_edited_by"] != row_dict.get("user_id"):
        editor = conn.execute(
            "SELECT username, display_name FROM users WHERE id = ?", (row_dict["last_edited_by"],)
        ).fetchone()
        if editor:
            row_dict["last_editor_username"] = editor["username"]
            row_dict["last_editor_display_name"] = editor["display_name"]
    # Note yang merujuk drawing ini DAN bisa diakses viewer. Prefilter LIKE, lalu cocokkan token persis
    # (bentuk ter-escape ::draw\[x\] ikut dihitung).
    refs = drawing_scope.refs_of(row_dict)
    if note_index is None:
        # Jalur satu drawing: prefilter SQL per rujukan (id/client_id) alih-alih memuat semua note ber-::draw.
        # LIKE tak peka huruf besar/kecil untuk ASCII (::DRAW lolos); '%' '_' pada client_id lolos lebih luas
        # tetapi dibuang oleh pencocokan token persis di bawah.
        note_ac, note_ap = _note_access_clause(viewer_uid)
        ref_list = sorted(refs)
        like = " OR ".join("content LIKE ?" for _ in ref_list)
        rows = conn.execute(
            f"SELECT id, title, content FROM scratchpad_notes WHERE {note_ac} AND ({like}) ORDER BY updated_at DESC",
            [*note_ap, *[f"%::draw%[%{r}%]%" for r in ref_list]]
        ).fetchall()
        note_index = [(r["id"], r["title"], drawing_scope.draw_tokens(r["content"])) for r in rows]
    row_dict["linked_notes"] = [
        {"id": nid, "title": title} for nid, title, tokens in note_index if tokens & refs
    ][:5]
    return row_dict


@app.get("/api/drawings")
async def list_drawings(shared: int = 0, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        # client_id ikut dikirim: pull di perangkat lain memakai cid yang sama dengan direktif ::draw[...] di note.
        # Tanpa ?shared=1 hanya milik sendiri (kompat klien lama); shared=1 = semua yang bisa diakses.
        if shared:
            ac, ap = drawing_scope.access_clause(uid)
        else:
            ac, ap = "user_id = ?", [uid]
        rows = conn.execute(
            "SELECT id, user_id, client_id, title, svg_preview, is_pinned, list_id, last_edited_by, created_at, updated_at "
            f"FROM drawings WHERE {ac} ORDER BY is_pinned DESC, updated_at DESC",
            ap
        ).fetchall()
        note_index = _drawing_note_index(conn, uid)
        return [_drawing_enrich(dict(r), conn, uid, note_index) for r in rows]


@app.post("/api/drawings")
async def create_drawing(req: DrawingCreate, user=Depends(get_current_user)):
    uid = user["sub"]
    now = datetime.now(_TZ_JKT).isoformat()
    with get_db() as conn:
        # Idempotensi retry sync: client yang sama (client_id) + user yang sama → baris yang sama,
        # tidak pernah menduplikasi walau POST diulang (503/putus jaringan → retry). list_id baris lama tidak diubah.
        if req.client_id:
            existing = conn.execute(
                "SELECT id FROM drawings WHERE user_id = ? AND client_id = ?",
                (uid, req.client_id)
            ).fetchone()
            if existing:
                did = existing["id"]
                conn.execute(
                    "UPDATE drawings SET title = ?, data_json = ?, svg_preview = ?, updated_at = ? WHERE id = ?",
                    (req.title, req.data_json, req.svg_preview, now, did)
                )
                if req.tags:
                    _upsert_tags_for_entity(conn, did, uid, "drawing", req.tags)
                row = conn.execute("SELECT * FROM drawings WHERE id = ?", (did,)).fetchone()
                return _drawing_enrich(dict(row), conn, uid)
        if req.list_id is not None and not TaskRepository(DB_PATH).is_list_member_or_owner(req.list_id, uid):
            raise HTTPException(status_code=403, detail="Bukan anggota list ini")
        cur = conn.execute(
            "INSERT INTO drawings (user_id, title, data_json, svg_preview, is_pinned, created_at, updated_at, client_id, list_id) "
            "VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)",
            (uid, req.title, req.data_json, req.svg_preview, now, now, req.client_id, req.list_id)
        )
        did = cur.lastrowid
        if req.tags:
            _upsert_tags_for_entity(conn, did, uid, "drawing", req.tags)
        row = conn.execute("SELECT * FROM drawings WHERE id = ?", (did,)).fetchone()
        return _drawing_enrich(dict(row), conn, uid)


@app.get("/api/drawings/{did}")
async def get_drawing_detail(did: str, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        row = drawing_scope.find_accessible(conn, did, uid)
        if not row:
            raise HTTPException(status_code=404, detail="Drawing tidak ditemukan")
        return _drawing_enrich(dict(row), conn, uid)


@app.put("/api/drawings/{did}")
async def update_drawing_detail(did: str, req: DrawingUpdate, user=Depends(get_current_user)):
    uid = user["sub"]
    now = datetime.now(_TZ_JKT).isoformat()
    with get_db() as conn:
        row = drawing_scope.find_accessible(conn, did, uid)
        if not row:
            raise HTTPException(status_code=404, detail="Drawing tidak ditemukan")
        _check_base_rev(req, row, lambda: _drawing_enrich(dict(row), conn, uid))
        target_id = row["id"]
        new_title = req.title if req.title is not None else row["title"]
        new_data = req.data_json if req.data_json is not None else row["data_json"]
        new_svg = req.svg_preview if req.svg_preview is not None else row["svg_preview"]
        conn.execute(
            "UPDATE drawings SET title = ?, data_json = ?, svg_preview = ?, last_edited_by = ?, updated_at = ? WHERE id = ?",
            (new_title, new_data, new_svg, uid, now, target_id)
        )
        if req.tags is not None:
            conn.execute("DELETE FROM entity_tags WHERE entity_type = 'drawing' AND entity_id = ?", (target_id,))
            if req.tags:
                # Tag drawing selalu di bawah pemilik drawing, bukan anggota yang menyunting.
                _upsert_tags_for_entity(conn, target_id, row["user_id"], "drawing", req.tags)
        updated = conn.execute("SELECT * FROM drawings WHERE id = ?", (target_id,)).fetchone()
        return _drawing_enrich(dict(updated), conn, uid)


def _owned_drawing_or_error(conn, did: str, uid: int, cols: str):
    """Drawing untuk aksi khusus pemilik (pin/hapus): tidak terlihat → 404, terlihat tapi bukan milik → 403."""
    row = drawing_scope.find_accessible(conn, did, uid, cols=cols)
    if not row:
        raise HTTPException(status_code=404, detail="Drawing tidak ditemukan")
    if row["user_id"] != uid:
        raise HTTPException(status_code=403, detail="Hanya pemilik drawing")
    return row


@app.patch("/api/drawings/{did}/pin")
async def toggle_pin_drawing(did: str, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        row = _owned_drawing_or_error(conn, did, uid, "id, user_id, is_pinned")
        target_id = row["id"]
        new_pin = 0 if row["is_pinned"] else 1
        conn.execute("UPDATE drawings SET is_pinned = ? WHERE id = ?", (new_pin, target_id))
        updated = conn.execute("SELECT * FROM drawings WHERE id = ?", (target_id,)).fetchone()
        return dict(updated)


@app.patch("/api/drawings/{did}/share")
async def share_drawing(did: str, req: DrawingShareReq, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        row = _owned_drawing_or_error(conn, did, uid, "*")
        if req.list_id is not None and not TaskRepository(DB_PATH).is_list_member_or_owner(req.list_id, uid):
            raise HTTPException(status_code=403, detail="Bukan anggota list ini")
        if req.list_id == row["list_id"]:
            return _drawing_enrich(dict(row), conn, uid)
        if row["list_id"] is not None:
            # Keluar dari workspace asal: note workspace itu yang merujuknya akan kehilangan drawing.
            notes, hidden = drawing_scope.notes_in_list_using(conn, row, row["list_id"], uid)
            if notes or hidden:
                raise HTTPException(status_code=409, detail={
                    "code": "DRAWING_IN_USE", "notes": notes, "hidden_count": hidden})
        now = datetime.now(_TZ_JKT).isoformat()
        conn.execute("UPDATE drawings SET list_id = ?, updated_at = ? WHERE id = ?", (req.list_id, now, row["id"]))
        updated = conn.execute("SELECT * FROM drawings WHERE id = ?", (row["id"],)).fetchone()
        return _drawing_enrich(dict(updated), conn, uid)


@app.post("/api/drawings/{did}/copy")
async def copy_drawing(did: str, req: DrawingCopyReq, user=Depends(get_current_user)):
    uid = user["sub"]
    now = datetime.now(_TZ_JKT).isoformat()
    with get_db() as conn:
        if req.client_id:
            existing = conn.execute(
                "SELECT * FROM drawings WHERE user_id = ? AND client_id = ?", (uid, req.client_id)
            ).fetchone()
            if existing:
                return _drawing_enrich(dict(existing), conn, uid)
        src = drawing_scope.find_accessible(conn, did, uid)
        if not src:
            raise HTTPException(status_code=404, detail="Drawing tidak ditemukan")
        if req.list_id is not None and not TaskRepository(DB_PATH).is_list_member_or_owner(req.list_id, uid):
            raise HTTPException(status_code=403, detail="Bukan anggota list ini")
        cur = conn.execute(
            "INSERT INTO drawings (user_id, title, data_json, svg_preview, is_pinned, created_at, updated_at, client_id, list_id) "
            "VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)",
            (uid, req.title or src["title"], src["data_json"], src["svg_preview"], now, now, req.client_id, req.list_id)
        )
        row = conn.execute("SELECT * FROM drawings WHERE id = ?", (cur.lastrowid,)).fetchone()
        return _drawing_enrich(dict(row), conn, uid)


@app.get("/api/lists/{list_id}/drawings")
async def get_list_drawings(list_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    if not TaskRepository(DB_PATH).is_list_member_or_owner(list_id, uid):
        raise HTTPException(status_code=403, detail="Bukan anggota list ini")
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, user_id, client_id, title, svg_preview, is_pinned, list_id, last_edited_by, updated_at "
            "FROM drawings WHERE list_id = ? ORDER BY updated_at DESC, id DESC", (list_id,)
        ).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/lists/{list_id}/leave-impact")
async def get_list_leave_impact(list_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    if not TaskRepository(DB_PATH).is_list_member_or_owner(list_id, uid):
        raise HTTPException(status_code=403, detail="Bukan anggota list ini")
    with get_db() as conn:
        return {"items": drawing_scope.leave_impact(conn, list_id, uid)}


@app.get("/api/lists/{list_id}/delete-impact")
async def get_list_delete_impact(list_id: int, user=Depends(get_current_user)):
    repo = TaskRepository(DB_PATH)
    if not repo.get_shared_list(list_id):
        raise HTTPException(status_code=404, detail="Workspace tidak ditemukan")
    if not repo.is_list_owner(list_id, user["sub"]):
        raise HTTPException(status_code=403, detail="Hanya owner yang dapat menghapus workspace")
    return repo.workspace_delete_impact(list_id)


@app.delete("/api/drawings/{did}")
async def delete_drawing_detail(did: str, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        row = _owned_drawing_or_error(conn, did, uid, "id, user_id")
        target_id = row["id"]
        conn.execute("DELETE FROM entity_tags WHERE entity_type = 'drawing' AND entity_id = ?", (target_id,))
        conn.execute("DELETE FROM drawings WHERE id = ?", (target_id,))
    return {"ok": True}


# ══════════════════════════════════════════════════════════════════════════════

import requests as _requests

HOLIDAY_API_KEY = "v66wqUTF8Y11V3ME31fHIuPaEWfuc22JkELVQtyVsc1rlJxcdK"

@app.get("/api/holidays")
async def get_holidays(year: int, user=Depends(get_current_user)):
    url = f"https://use.api.co.id/holidays/indonesia/?year={year}&page=1"
    try:
        resp = _requests.get(url, headers={"x-api-co-id": HOLIDAY_API_KEY}, timeout=8)
        resp.raise_for_status()
        data = resp.json()
        holidays = [
            {"date": h["date"], "name": h["name"], "is_joint": h["is_joint_holiday"]}
            for h in data.get("data", [])
            if h.get("is_holiday") or h.get("is_joint_holiday")
        ]
        return {"data": holidays}
    except Exception:
        return {"data": []}


if __name__ == "__main__":
    migrate_db()
    uvicorn.run("webapp:app", host="0.0.0.0", port=WEB_PORT, reload=False)
