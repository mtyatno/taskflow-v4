"""
TaskFlow V4 — Web Application (FastAPI)

Multi-user web interface with JWT auth, REST API, and React SPA frontend.
Runs alongside the Telegram bot, sharing the same SQLite database.
"""
from __future__ import annotations

import os
import hashlib
import secrets
import sqlite3
import uuid
import mimetypes
import asyncio
import json
import re
from collections import defaultdict
from datetime import datetime, date, timedelta
from pathlib import Path
from typing import Optional, Literal
from contextlib import contextmanager

import pytz as _pytz
_TZ_JKT = _pytz.timezone("Asia/Jakarta")

def _today_jkt() -> date:
    """Return today's date in Jakarta timezone (UTC+7)."""
    return datetime.now(_TZ_JKT).date()

from fastapi import FastAPI, HTTPException, Depends, Response, Request, status, UploadFile, File as FastAPIFile, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse, StreamingResponse
import io
import zipfile
import csv
from sse_starlette.sse import EventSourceResponse
from pydantic import BaseModel, Field, field_validator
import jwt
import uvicorn

from config import DB_PATH, EISENHOWER_INTERVAL_MINUTES, UPLOAD_DIR, MAX_FILE_SIZE, TELEGRAM_BOT_USERNAME, NEXTCLOUD_URL, NEXTCLOUD_USER, NEXTCLOUD_APP_PASSWORD, NEXTCLOUD_FOLDER

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
_tg_bot = None  # Initialized at startup if token available
from models import Task, GTDStatus, Priority, Quadrant
from eisenhower import calculate_quadrant, recalculate_all
from datehelper import parse_date
from repository import TaskRepository

# ── Config ─────────────────────────────────────────────────────────────────────
SECRET_KEY = os.getenv("WEB_SECRET_KEY", secrets.token_hex(32))
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_HOURS = int(os.getenv("JWT_EXPIRE_HOURS", "72"))
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
    TaskRepository(DB_PATH)

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


# ── Password hashing (no external deps) ───────────────────────────────────────

def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000)
    return f"{salt}${h.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, h = stored.split("$")
        return hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000).hex() == h
    except Exception:
        return False


# ── JWT helpers ────────────────────────────────────────────────────────────────

def create_token(user_id: int, username: str) -> str:
    payload = {
        "sub": str(user_id),
        "username": username,
        "exp": datetime.utcnow() + timedelta(hours=JWT_EXPIRE_HOURS),
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

async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    data = decode_token(token)
    data["sub"] = int(data["sub"])
    return data

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

class LoginReq(BaseModel):
    username: str
    password: str

class TaskCreate(BaseModel):
    title: str = Field(min_length=1)
    description: str = ""
    priority: str = "P3"
    project: str = ""
    context: str = ""
    deadline: Optional[str] = None
    gtd_status: str = "inbox"
    waiting_for: str = ""
    list_id: Optional[int] = None
    assigned_to: Optional[int] = None
    parent_id: Optional[int] = None

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    project: Optional[str] = None
    context: Optional[str] = None
    deadline: Optional[str] = None
    gtd_status: Optional[str] = None
    waiting_for: Optional[str] = None
    assigned_to: Optional[int] = None
    progress: Optional[int] = None

class SharedListCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)

class HabitCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    phase: str = "pagi"
    micro_target: str = ""
    frequency: list = ["mon","tue","wed","thu","fri","sat","sun"]
    identity_pillar: str = ""

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

class ScratchpadCreate(BaseModel):
    title: str = ""
    content: str = ""
    tags: list[str] = []
    linked_task_id: Optional[int] = None
    linked_task_ids: list[int] = []
    list_id: Optional[int] = None

class ScratchpadUpdate(BaseModel):
    title: str = ""
    content: str = ""
    tags: list[str] = []
    linked_task_id: Optional[int] = None
    linked_task_ids: list[int] = []
    list_id: Optional[int] = None

class NoteShareReq(BaseModel):
    list_id: Optional[int] = None  # None = unshare

class JoinListReq(BaseModel):
    code: str

class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=2000)
    task_id: Optional[int] = None
    msg_type: str = "text"
    reply_to_id: Optional[int] = None


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


# ══════════════════════════════════════════════════════════════════════════════
#  APP
# ══════════════════════════════════════════════════════════════════════════════

app = FastAPI(title="TaskFlow V4", docs_url="/api/docs")


def seed_habit_templates():
    """Seed habit_templates from JSON if table is empty."""
    import os as _os
    json_path = _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'habits_tasks_1000.json')
    if not _os.path.exists(json_path):
        return
    with get_db() as conn:
        count = conn.execute("SELECT COUNT(*) FROM habit_templates").fetchone()[0]
        if count > 0:
            return
        with open(json_path, encoding='utf-8') as f:
            items = json.load(f)
        for item in items:
            conn.execute(
                """INSERT OR IGNORE INTO habit_templates
                   (kategori, subkategori, type, item, frequency, priority, difficulty, tags)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (item['kategori'], item['subkategori'], item['type'], item['item'],
                 item['frequency'], item['priority'], item['difficulty'],
                 json.dumps(item.get('tags', [])))
            )

@app.on_event("startup")
async def startup():
    global _tg_bot
    migrate_db()
    seed_habit_templates()
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    if TELEGRAM_BOT_TOKEN:
        try:
            from telegram import Bot as TelegramBot
            _tg_bot = TelegramBot(token=TELEGRAM_BOT_TOKEN)
        except Exception:
            pass


# ── Auth routes ────────────────────────────────────────────────────────────────

@app.post("/api/auth/register")
async def register(req: RegisterReq, response: Response):
    with get_db() as conn:
        existing = conn.execute("SELECT id FROM users WHERE username = ?", (req.username,)).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="Username sudah digunakan")

        now = datetime.now().isoformat()
        cur = conn.execute(
            "INSERT INTO users (username, password_hash, display_name, created_at) VALUES (?,?,?,?)",
            (req.username, hash_password(req.password), req.display_name or req.username, now),
        )
        user_id = cur.lastrowid

    token = create_token(user_id, req.username)
    response.set_cookie("token", token, httponly=True, samesite="lax", max_age=JWT_EXPIRE_HOURS * 3600)
    return {"user_id": user_id, "username": req.username, "token": token}


@app.post("/api/auth/login")
async def login(req: LoginReq, response: Response):
    with get_db() as conn:
        user = conn.execute("SELECT * FROM users WHERE username = ?", (req.username,)).fetchone()
        if not user or not verify_password(req.password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Username atau password salah")

    token = create_token(user["id"], user["username"])
    response.set_cookie("token", token, httponly=True, samesite="lax", max_age=JWT_EXPIRE_HOURS * 3600)
    return {"user_id": user["id"], "username": user["username"], "display_name": user["display_name"], "token": token}


@app.get("/api/auth/me")
async def get_me(user=Depends(get_current_user)):
    with get_db() as conn:
        row = conn.execute("SELECT id, username, display_name, created_at, telegram_id, is_admin FROM users WHERE id = ?", (user["sub"],)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
    result = dict(row)
    result["telegram_linked"] = bool(result.pop("telegram_id"))
    return result


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
        row = conn.execute("SELECT username FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        return _HTML("<html><body>User tidak ditemukan.</body></html>", status_code=400)
    jwt_token = create_token(user_id, row["username"])
    response = RedirectResponse(url="/", status_code=302)
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
        clauses.append("context = ?")
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
    if parent_id:
        with get_db() as conn:
            parent_row = conn.execute("SELECT * FROM tasks WHERE id = ?", (parent_id,)).fetchone()
        if not parent_row:
            raise HTTPException(status_code=404, detail="Parent task not found")
        # Inherit from parent if not explicitly provided
        if not req.list_id and parent_row["list_id"]:
            req.list_id = parent_row["list_id"]
        if not req.project and parent_row["project"]:
            req.project = parent_row["project"]
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

    with get_db() as conn:
        cur = conn.execute(
            """INSERT INTO tasks
               (title, description, gtd_status, priority, quadrant,
                project, context, deadline, waiting_for, user_id, list_id, assigned_to, parent_id, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (req.title, req.description, req.gtd_status, req.priority.upper(), quadrant,
             req.project, req.context, deadline, req.waiting_for, uid, req.list_id, req.assigned_to, parent_id, now, now),
        )
        task_id = cur.lastrowid
        if task_tags:
            _upsert_tags_for_entity(conn, task_id, uid, 'task', task_tags)
            conn.commit()
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()

    if req.list_id:
        actor = user.get("username", f"user#{uid}")
        background_tasks.add_task(
            _notify_members_bg, req.list_id, uid,
            f"➕ <b>{actor}</b> menambahkan task <b>{req.title}</b> ke shared list.",
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

        updates = {}
        if req.title is not None:
            updates["title"] = req.title
        if req.description is not None:
            updates["description"] = req.description
        if req.priority is not None:
            updates["priority"] = req.priority.upper()
        if req.project is not None:
            updates["project"] = req.project
        if req.context is not None:
            updates["context"] = req.context
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
                f"📌 <b>{actor}</b> menugaskan task <b>{existing['title']}</b> kepadamu.",
                task_id=task_id
            )
        else:
            background_tasks.add_task(
                _notify_members_bg, existing["list_id"], uid,
                f"✏️ <b>{actor}</b> memperbarui task <b>{existing['title']}</b>.",
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
            f"✅ <b>{actor}</b> menyelesaikan task <b>{row['title']}</b>.",
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


@app.get("/api/projects")
async def get_projects(user=Depends(get_current_user)):
    with get_db() as conn:
        rows = conn.execute(
            """SELECT DISTINCT project FROM tasks
               WHERE project != '' AND user_id = ? AND gtd_status NOT IN ('done','archived')
               ORDER BY project""",
            (user["sub"],),
        ).fetchall()
    return [r["project"] for r in rows]


@app.get("/api/contexts")
async def get_contexts(user=Depends(get_current_user)):
    with get_db() as conn:
        rows = conn.execute(
            """SELECT DISTINCT context FROM tasks
               WHERE context != '' AND user_id = ? AND gtd_status NOT IN ('done','archived')
               ORDER BY context""",
            (user["sub"],),
        ).fetchall()
    return [r["context"] for r in rows]


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
                conn.execute("UPDATE tasks SET quadrant=?, updated_at=? WHERE id=?",
                             (new_q, datetime.now().isoformat(), row["id"]))
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
            f"📝 <b>{actor}</b> menambah subtask di task <b>{row['title']}</b>.",
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
            f"💬 <b>{actor}</b> menambahkan komentar di task <b>{row['title']}</b>:\n{req.content[:100]}",
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

    with open(stored_path, "wb") as f:
        f.write(content)

    mime_type = file.content_type or mimetypes.guess_type(original_name)[0] or "application/octet-stream"

    repo = TaskRepository(DB_PATH)
    result = repo.add_attachment(task_id, stored_name, original_name, len(content), mime_type)
    if task_row["list_id"]:
        actor = user.get("username", f"user#{uid}")
        background_tasks.add_task(
            _notify_members_bg, task_row["list_id"], uid,
            f"📎 <b>{actor}</b> mengunggah file <b>{original_name}</b> di task <b>{task_row['title']}</b>.",
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
    info = repo.delete_attachment(attachment_id)
    if info:
        filepath = os.path.join(UPLOAD_DIR, info["filename"])
        if os.path.exists(filepath):
            os.unlink(filepath)
    return {"ok": True}

@app.get("/api/attachments/{attachment_id}/download")
async def download_attachment(attachment_id: int, user=Depends(get_current_user)):
    with get_db() as conn:
        att = conn.execute("SELECT * FROM task_attachments WHERE id = ?", (attachment_id,)).fetchone()
        if not att:
            raise HTTPException(status_code=404, detail="Attachment not found")
        _can_access_task(conn, att["task_id"], user["sub"])

    filepath = os.path.join(UPLOAD_DIR, att["filename"])
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="File not found on disk")

    return FileResponse(filepath, filename=att["original_name"], media_type=att["mime_type"])


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
    list_id = repo.consume_list_invite(req.code)
    if not list_id:
        raise HTTPException(status_code=400, detail="Kode tidak valid, sudah digunakan, atau kadaluarsa.")
    lst = repo.get_shared_list(list_id)
    if not lst:
        raise HTTPException(status_code=404, detail="List tidak ditemukan.")
    if lst["owner_id"] == uid:
        raise HTTPException(status_code=400, detail="Kamu adalah owner list ini.")
    if repo.is_list_member_or_owner(list_id, uid):
        raise HTTPException(status_code=400, detail="Kamu sudah menjadi anggota list ini.")
    repo.add_list_member(list_id, uid)
    # Notify owner
    with get_db() as conn:
        owner = conn.execute(
            "SELECT telegram_id FROM users WHERE id = ?", (lst["owner_id"],)
        ).fetchone()
    if owner and owner["telegram_id"] and _tg_bot:
        try:
            import asyncio
            joiner = user.get("username", f"user#{uid}")
            asyncio.create_task(_tg_bot.send_message(
                chat_id=owner["telegram_id"],
                text=f"👥 <b>{joiner}</b> bergabung ke shared list <b>{lst['name']}</b>.",
                parse_mode="HTML",
            ))
        except Exception:
            pass
    return {"ok": True, "list_id": list_id, "list_name": lst["name"]}


@app.get("/api/lists/preview/{code}")
async def preview_invite_code(code: str, user=Depends(get_current_user)):
    """Preview list info from an invite code without consuming it."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT li.list_id, li.expires_at, li.used, sl.name FROM list_invites li "
            "JOIN shared_lists sl ON sl.id = li.list_id WHERE li.code = ?",
            (code,),
        ).fetchone()
    if not row or row["used"]:
        raise HTTPException(status_code=400, detail="Kode tidak valid atau sudah digunakan.")
    from datetime import datetime as _dt
    if _dt.fromisoformat(row["expires_at"]) < _dt.now():
        raise HTTPException(status_code=400, detail="Kode sudah kadaluarsa.")
    return {"list_id": row["list_id"], "list_name": row["name"], "expires_at": row["expires_at"]}


@app.get("/api/lists/{list_id}")
async def get_list(list_id: int, user=Depends(get_current_user)):
    repo = TaskRepository(DB_PATH)
    lst = repo.get_shared_list(list_id)
    if not lst:
        raise HTTPException(status_code=404, detail="List not found")
    if not repo.is_list_member_or_owner(list_id, user["sub"]):
        raise HTTPException(status_code=403, detail="Not a member of this list")
    members = repo.get_list_members(list_id)
    # Include owner info
    with get_db() as conn:
        owner = conn.execute(
            "SELECT id, username, display_name FROM users WHERE id = ?", (lst["owner_id"],)
        ).fetchone()
    return {**lst, "members": members, "owner": dict(owner) if owner else None}


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

    added = repo.add_list_member(list_id, target["id"])
    # Notify via Telegram if user has telegram_id
    if added and target.get("telegram_id") and _tg_bot:
        try:
            inviter = user.get("username", f"user#{uid}")
            import asyncio
            asyncio.create_task(
                _tg_bot.send_message(
                    chat_id=target["telegram_id"],
                    text=f"👥 <b>{inviter}</b> mengundangmu ke shared list <b>{lst['name']}</b>!\n"
                         f"Kamu sekarang bisa melihat dan mengedit task di list ini.",
                    parse_mode="HTML"
                )
            )
        except Exception:
            pass
    return {
        "ok": True,
        "added_user": {"id": target["id"], "username": target["username"], "display_name": target["display_name"]}
    }


@app.post("/api/lists/{list_id}/generate-link")
async def generate_invite_link(list_id: int, user=Depends(get_current_user)):
    """Generate a one-use invite link (48h) for sharing via URL."""
    from config import WEBAPP_URL
    uid = user["sub"]
    repo = TaskRepository(DB_PATH)
    if not repo.is_list_owner(list_id, uid):
        raise HTTPException(status_code=403, detail="Hanya owner yang bisa membuat invite link.")
    code = repo.create_list_invite(list_id, uid, expire_hours=48)
    join_url = f"{WEBAPP_URL}/join?code={code}"
    return {"code": code, "join_url": join_url, "expires_in_hours": 48}


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


# ── Chat API ──────────────────────────────────────────────────────────────────

@app.get("/api/lists/{list_id}/messages")
async def get_messages(list_id: int, limit: int = 50, before_id: Optional[int] = None, user=Depends(get_current_user)):
    uid = user["sub"]
    repo = TaskRepository(DB_PATH)
    if not repo.is_list_member_or_owner(list_id, uid):
        raise HTTPException(status_code=403, detail="Not a member of this list")
    with get_db() as conn:
        base_select = """
            SELECT m.id, m.list_id, m.user_id, m.content, m.task_id, m.msg_type,
                   m.created_at, m.reply_to_id,
                   u.username, u.display_name,
                   t.title as task_title, t.priority as task_priority,
                   t.deadline as task_deadline, t.quadrant as task_quadrant,
                   t.gtd_status as task_status,
                   ru.username as reply_to_username,
                   ru.display_name as reply_to_display_name,
                   rm.content as reply_to_content
            FROM messages m
            JOIN users u ON u.id = m.user_id
            LEFT JOIN tasks t ON t.id = m.task_id
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


@app.post("/api/lists/{list_id}/messages")
async def post_message(list_id: int, req: MessageCreate, user=Depends(get_current_user)):
    uid = user["sub"]
    repo = TaskRepository(DB_PATH)
    if not repo.is_list_member_or_owner(list_id, uid):
        raise HTTPException(status_code=403, detail="Not a member of this list")
    now = datetime.now().isoformat()
    with get_db() as conn:
        # Validate task_id belongs to this list (if provided)
        if req.task_id:
            task_row = conn.execute(
                "SELECT id FROM tasks WHERE id = ? AND list_id = ?", (req.task_id, list_id)
            ).fetchone()
            if not task_row:
                raise HTTPException(status_code=400, detail="Task tidak ditemukan di list ini")
        # Save message
        cur = conn.execute(
            "INSERT INTO messages (list_id, user_id, content, task_id, msg_type, reply_to_id, created_at) "
            "VALUES (?,?,?,?,?,?,?)",
            (list_id, uid, req.content, req.task_id, req.msg_type, req.reply_to_id, now),
        )
        msg_id = cur.lastrowid
        # Fetch with joined data for broadcast
        row = conn.execute(
            """SELECT m.id, m.list_id, m.user_id, m.content, m.task_id, m.msg_type,
                      m.created_at, m.reply_to_id,
                      u.username, u.display_name,
                      t.title as task_title, t.priority as task_priority,
                      t.deadline as task_deadline, t.quadrant as task_quadrant,
                      t.gtd_status as task_status,
                      ru.username as reply_to_username,
                      ru.display_name as reply_to_display_name,
                      rm.content as reply_to_content
               FROM messages m
               JOIN users u ON u.id = m.user_id
               LEFT JOIN tasks t ON t.id = m.task_id
               LEFT JOIN messages rm ON rm.id = m.reply_to_id
               LEFT JOIN users ru ON ru.id = rm.user_id
               WHERE m.id = ?""",
            (msg_id,),
        ).fetchone()
        msg_dict = dict(row)
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
                         f"💬 {sender_username} menyebut kamu di diskusi '{list_name}'",
                         list_id, now),
                    )
    # Broadcast to all SSE subscribers of this list
    for q in list(chat_subscribers.get(list_id, set())):
        await q.put(msg_dict)
    return msg_dict


@app.get("/api/lists/{list_id}/messages/stream")
async def chat_stream(list_id: int, request: Request, user=Depends(get_current_user)):
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
                    # Keepalive ping agar koneksi tidak timeout
                    yield {"data": json.dumps({"type": "ping"})}
        finally:
            chat_subscribers[list_id].discard(q)

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
    return HTMLResponse("<h1>TaskFlow V4</h1><p>Static files not found.</p>")


@app.get("/sw.js")
async def serve_sw():
    sw = STATIC_DIR / "sw.js"
    return FileResponse(str(sw), media_type="application/javascript",
                        headers={"Service-Worker-Allowed": "/"})


@app.get("/manifest.json")
async def serve_manifest():
    mf = STATIC_DIR / "manifest.json"
    return FileResponse(str(mf), media_type="application/manifest+json")


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
        cur = conn.execute(
            """INSERT INTO habits (user_id, title, phase, micro_target, frequency, identity_pillar)
               VALUES (?,?,?,?,?,?)""",
            (uid, req.title, req.phase, req.micro_target, freq_json, req.identity_pillar)
        )
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


@app.post("/api/habits/{habit_id}/checkin")
async def checkin_habit(habit_id: int, req: HabitCheckinReq, user=Depends(get_current_user)):
    uid = user["sub"]
    if req.status not in ("done", "skipped"):
        raise HTTPException(status_code=400, detail="status harus done atau skipped")
    log_date = req.date if req.date else _today_jkt().isoformat()
    with get_db() as conn:
        row = conn.execute("SELECT id FROM habits WHERE id = ? AND user_id = ?", (habit_id, uid)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Habit tidak ditemukan")
        conn.execute(
            """INSERT INTO habit_logs (habit_id, date, status, skip_reason)
               VALUES (?,?,?,?)
               ON CONFLICT(habit_id, date) DO UPDATE SET status=excluded.status, skip_reason=excluded.skip_reason""",
            (habit_id, log_date, req.status, req.skip_reason)
        )
    return {"ok": True, "habit_id": habit_id, "date": log_date, "status": req.status}


# ── Scratchpad Notes ──────────────────────────────────────────────────────────

def _scratchpad_row(row, conn=None, uid=None) -> dict:
    d = dict(row)
    if conn and d.get("id"):
        tag_rows = conn.execute("""
            SELECT t.name FROM tags t
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
    """Extract [[Title]] references from note content."""
    import re as _re
    return list(dict.fromkeys(_re.findall(r"\[\[([^\[\]]+)\]\]", content)))

def _resolve_linked_to(titles: list[str], user_id: int, conn) -> list[int]:
    """Resolve note titles to IDs — searches personal and shared notes accessible by user."""
    if not titles:
        return []
    placeholders = ",".join("?" * len(titles))
    access_clause, access_params = _note_access_clause(user_id)
    rows = conn.execute(
        f"SELECT id, title FROM scratchpad_notes WHERE {access_clause} AND title IN ({placeholders})",
        access_params + titles,
    ).fetchall()
    title_map = {r["title"].strip().lower(): r["id"] for r in rows}
    return [title_map[t.strip().lower()] for t in titles if t.strip().lower() in title_map]

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

@app.get("/api/scratchpad")
async def list_scratchpad(q: str = "", tag: str = "", user=Depends(get_current_user)):
    uid = user["sub"]
    access_clause, access_params = _note_access_clause(uid, prefix="s")
    with get_db() as conn:
        if tag:
            tag_norm = tag.strip().lower()
            rows = conn.execute(f"""
                SELECT s.* FROM scratchpad_notes s
                JOIN entity_tags et ON et.entity_id = s.id AND et.entity_type = 'note'
                JOIN tags t ON t.id = et.tag_id
                WHERE ({access_clause})
                  AND t.name = ?
                ORDER BY s.updated_at DESC
            """, access_params + [tag_norm]).fetchall()
        elif q:
            rows = conn.execute(f"""
                SELECT s.* FROM scratchpad_notes s
                WHERE ({access_clause})
                  AND (s.title LIKE ? OR s.content LIKE ?)
                ORDER BY s.updated_at DESC
            """, access_params + [f"%{q}%", f"%{q}%"]).fetchall()
        else:
            rows = conn.execute(f"""
                SELECT s.* FROM scratchpad_notes s
                WHERE {access_clause}
                ORDER BY s.updated_at DESC
            """, access_params).fetchall()
        return [_scratchpad_row(r, conn, uid) for r in rows]

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
}

@app.post("/api/scratchpad/{note_id}/attachments")
async def upload_note_attachment(note_id: int, file: UploadFile = FastAPIFile(...), user=Depends(get_current_user)):
    import requests as _req
    uid = user["sub"]
    with get_db() as conn:
        note = conn.execute(
            "SELECT id FROM scratchpad_notes WHERE id=? AND user_id=?", (note_id, uid)
        ).fetchone()
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
        note = conn.execute(
            "SELECT id FROM scratchpad_notes WHERE id=? AND user_id=?", (note_id, uid)
        ).fetchone()
        if not note:
            raise HTTPException(status_code=404, detail="Note tidak ditemukan")
        rows = conn.execute(
            "SELECT * FROM note_attachments WHERE note_id=? ORDER BY id", (note_id,)
        ).fetchall()
        return [dict(r) for r in rows]

@app.delete("/api/scratchpad/attachments/{att_id}")
async def delete_note_attachment(att_id: int, user=Depends(get_current_user)):
    import requests as _req
    uid = user["sub"]
    with get_db() as conn:
        att = conn.execute("SELECT * FROM note_attachments WHERE id=?", (att_id,)).fetchone()
        if not att:
            raise HTTPException(status_code=404, detail="Attachment tidak ditemukan")
        if att["user_id"] != uid:
            raise HTTPException(status_code=403, detail="Bukan attachment milikmu")
        r = _req.delete(_nc_dav_url(att["nextcloud_path"]), auth=_nc_auth(), timeout=10)
        if r.status_code not in (200, 204, 404):  # 404 = already deleted, still OK
            raise HTTPException(status_code=500, detail=f"Nextcloud delete gagal: {r.status_code}")
        conn.execute("DELETE FROM note_attachments WHERE id=?", (att_id,))
        conn.commit()
    return {"ok": True}

@app.get("/api/scratchpad/attachments/{att_id}/view")
async def view_note_attachment(att_id: int, user=Depends(get_current_user)):
    import requests as _req
    uid = user["sub"]
    with get_db() as conn:
        att = conn.execute("SELECT * FROM note_attachments WHERE id=?", (att_id,)).fetchone()
        if not att:
            raise HTTPException(status_code=404, detail="Attachment tidak ditemukan")
        if att["user_id"] != uid:
            raise HTTPException(status_code=403, detail="Bukan attachment milikmu")
    r = _req.get(_nc_dav_url(att["nextcloud_path"]), auth=_nc_auth(), timeout=30, stream=True)
    if r.status_code != 200:
        raise HTTPException(status_code=404, detail="File tidak ditemukan di Nextcloud")
    safe_name = att["original_name"].replace('"', '_').replace('\r', '').replace('\n', '')
    return StreamingResponse(
        r.iter_content(chunk_size=8192),
        media_type=att["mime_type"],
        headers={"Content-Disposition": f'inline; filename="{safe_name}"'}
    )

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

        used: dict[str, int] = {}
        for note in notes:
            base = _sanitize(note["title"], note["id"])
            if base in used:
                used[base] += 1
                fname = f"{base} ({used[base]}).md"
            else:
                used[base] = 0
                fname = f"{base}.md"

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

    buf.seek(0)
    filename = f"taskflow-export-{today}.zip"
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )

@app.get("/api/drawings/{note_id}")
async def get_drawing(note_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    access_clause, access_params = _note_access_clause(uid)
    with get_db() as conn:
        note = conn.execute(
            f"SELECT id, user_id FROM scratchpad_notes WHERE id = ? AND {access_clause}",
            [note_id] + access_params
        ).fetchone()
        if not note:
            raise HTTPException(status_code=404, detail="Note tidak ditemukan")
        row = conn.execute(
            "SELECT data_json, updated_at FROM drawings WHERE note_id = ?",
            (note_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Drawing belum ada")
        return {"data_json": row["data_json"], "updated_at": row["updated_at"]}


@app.put("/api/drawings/{note_id}")
async def upsert_drawing(note_id: int, req: DrawingUpsert, user=Depends(get_current_user)):
    uid = user["sub"]
    now = datetime.now(_TZ_JKT).isoformat()
    access_clause, access_params = _note_access_clause(uid)
    with get_db() as conn:
        note = conn.execute(
            f"SELECT id, user_id FROM scratchpad_notes WHERE id = ? AND {access_clause}",
            [note_id] + access_params
        ).fetchone()
        if not note:
            raise HTTPException(status_code=404, detail="Note tidak ditemukan")
        if note["user_id"] != uid:
            raise HTTPException(status_code=403, detail="Hanya pemilik note yang bisa mengedit drawing")
        conn.execute(
            """INSERT INTO drawings (note_id, user_id, data_json, updated_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(note_id) DO UPDATE SET
                 data_json = excluded.data_json,
                 updated_at = excluded.updated_at""",
            (note_id, uid, req.data_json, now)
        )
        return {"updated_at": now}


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
        return _scratchpad_row(row, conn, uid)

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
        conn.execute(
            """INSERT INTO scratchpad_notes
               (user_id, title, content, tags, linked_task_id, linked_task_ids, linked_to,
                list_id, last_edited_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (uid, req.title, req.content, "[]",
             task_ids[0] if task_ids else None, json.dumps(task_ids),
             json.dumps(linked_ids), req.list_id, uid, now, now)
        )
        note_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        _upsert_tags_for_note(conn, note_id, uid, tag_names)
        conn.commit()
        row = conn.execute(_NOTE_SELECT, (note_id,)).fetchone()
        return _scratchpad_row(row, conn, uid)

@app.put("/api/scratchpad/{note_id}")
async def update_scratchpad(note_id: int, req: ScratchpadUpdate, user=Depends(get_current_user)):
    uid = user["sub"]
    now = datetime.now(_TZ_JKT).isoformat()
    tag_names = [t.strip().lower() for t in req.tags if t.strip()]
    task_ids = list(dict.fromkeys(req.linked_task_ids + ([req.linked_task_id] if req.linked_task_id else [])))
    access_clause, access_params = _note_access_clause(uid)
    with get_db() as conn:
        existing = conn.execute(f"""
            SELECT id, user_id, list_id FROM scratchpad_notes
            WHERE id = ? AND {access_clause}
        """, [note_id] + access_params).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Note tidak ditemukan")
        titles = _parse_wikilinks(req.content)
        linked_ids = _resolve_linked_to(titles, uid, conn)
        # list_id: only owner can change it; members cannot move the note to another list
        new_list_id = req.list_id if existing["user_id"] == uid else existing["list_id"]
        conn.execute(
            """UPDATE scratchpad_notes
               SET title=?, content=?, tags=?, linked_task_id=?, linked_task_ids=?,
                   linked_to=?, list_id=?, last_edited_by=?, updated_at=?
               WHERE id=?""",
            (req.title, req.content, "[]",
             task_ids[0] if task_ids else None, json.dumps(task_ids),
             json.dumps(linked_ids), new_list_id, uid, now, note_id)
        )
        conn.execute("DELETE FROM entity_tags WHERE entity_type='note' AND entity_id=? AND user_id=?", (note_id, uid))
        _upsert_tags_for_note(conn, note_id, uid, tag_names)
        conn.commit()
        updated = conn.execute(_NOTE_SELECT, (note_id,)).fetchone()
        return _scratchpad_row(updated, conn, uid)

@app.delete("/api/scratchpad/{note_id}")
async def delete_scratchpad(note_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        if not conn.execute(
            "SELECT id FROM scratchpad_notes WHERE id = ? AND user_id = ?", (note_id, uid)
        ).fetchone():
            raise HTTPException(status_code=403, detail="Hanya pemilik yang bisa menghapus catatan ini")
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
        conn.execute(
            "UPDATE scratchpad_notes SET list_id = ? WHERE id = ?", (req.list_id, note_id)
        )
        conn.commit()
        updated = conn.execute(_NOTE_SELECT, (note_id,)).fetchone()
        return _scratchpad_row(updated, conn, uid)

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
                  )
                ORDER BY updated_at DESC
            """, ap2 + [note_id, note_id, f"%[[{title}]]%"]).fetchall()
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
            SELECT id, title, priority, gtd_status, deadline, quadrant
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
            SELECT id, title, content, updated_at
            FROM scratchpad_notes
            WHERE {note_ac} AND (title LIKE ? OR content LIKE ?)
            ORDER BY updated_at DESC
            LIMIT 8
        """, note_ap + [like, like]).fetchall()

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
    }


# ══════════════════════════════════════════════════════════════════════════════

import urllib.request as _urllib_req

HOLIDAY_API_KEY = "v66wqUTF8Y11V3ME31fHIuPaEWfuc22JkELVQtyVsc1rlJxcdK"

@app.get("/api/holidays")
async def get_holidays(year: int, user=Depends(get_current_user)):
    url = f"https://use.api.co.id/holidays/indonesia/?year={year}&page=1"
    req = _urllib_req.Request(url, headers={"x-api-co-id": HOLIDAY_API_KEY})
    try:
        with _urllib_req.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read())
        holidays = [
            {"date": h["date"], "name": h["name"], "is_joint": h["is_joint_holiday"]}
            for h in data.get("data", [])
            if h.get("is_holiday") or h.get("is_joint_holiday")
        ]
        return {"data": holidays}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Gagal ambil data libur: {e}")


if __name__ == "__main__":
    migrate_db()
    uvicorn.run("webapp:app", host="0.0.0.0", port=WEB_PORT, reload=False)
