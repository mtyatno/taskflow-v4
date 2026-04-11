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
from datetime import datetime, date, timedelta
from pathlib import Path
from typing import Optional
from contextlib import contextmanager

from fastapi import FastAPI, HTTPException, Depends, Response, Request, status, UploadFile, File as FastAPIFile, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse
from pydantic import BaseModel, Field
import jwt
import uvicorn

from config import DB_PATH, EISENHOWER_INTERVAL_MINUTES, UPLOAD_DIR, MAX_FILE_SIZE

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


def migrate_db():
    """Ensure all tables exist via repository init."""
    from repository import TaskRepository
    TaskRepository(DB_PATH)


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

class InviteUserReq(BaseModel):
    username: str

class JoinListReq(BaseModel):
    code: str


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


@app.on_event("startup")
async def startup():
    global _tg_bot
    migrate_db()
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
        row = conn.execute("SELECT id, username, display_name, created_at FROM users WHERE id = ?", (user["sub"],)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
    return dict(row)


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

    where = " AND ".join(clauses)
    sql = f"SELECT * FROM tasks WHERE {where} ORDER BY priority, deadline"

    with get_db() as conn:
        rows = conn.execute(sql, params).fetchall()
    return [task_row_to_dict(r) for r in rows]


@app.post("/api/tasks")
async def create_task(req: TaskCreate, background_tasks: BackgroundTasks, user=Depends(get_current_user)):
    uid = user["sub"]
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
                project, context, deadline, waiting_for, user_id, list_id, assigned_to, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (req.title, req.description, req.gtd_status, req.priority.upper(), quadrant,
             req.project, req.context, deadline, req.waiting_for, uid, req.list_id, req.assigned_to, now, now),
        )
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (cur.lastrowid,)).fetchone()

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


@app.put("/api/tasks/{task_id}")
async def update_task(task_id: int, req: TaskUpdate, background_tasks: BackgroundTasks, user=Depends(get_current_user)):
    uid = user["sub"]
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

    return {
        "by_status": by_status,
        "by_quadrant": by_quad,
        "overdue": overdue_count,
        "total_active": total_active,
        "total_done": total_done,
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
        return HTMLResponse(index.read_text(encoding="utf-8"))
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


# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    migrate_db()
    uvicorn.run("webapp:app", host="0.0.0.0", port=WEB_PORT, reload=False)
