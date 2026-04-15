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
from datetime import datetime, date, timedelta
from pathlib import Path
from typing import Optional
from contextlib import contextmanager

from fastapi import FastAPI, HTTPException, Depends, Response, Request, status
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse, FileResponse
from pydantic import BaseModel, Field
import jwt
import uvicorn

from config import DB_PATH, EISENHOWER_INTERVAL_MINUTES
from models import Task, GTDStatus, Priority, Quadrant
from eisenhower import calculate_quadrant, recalculate_all
from datehelper import parse_date

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
    """Add users table and user_id to tasks if not present."""
    # Ensure tasks table exists (via repository init)
    from repository import TaskRepository
    TaskRepository(DB_PATH)

    with get_db() as conn:
        # Users table
        conn.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                username        TEXT NOT NULL UNIQUE,
                password_hash   TEXT NOT NULL,
                display_name    TEXT DEFAULT '',
                telegram_id     INTEGER DEFAULT NULL,
                created_at      TEXT NOT NULL
            )
        """)
        # Check if tasks has user_id
        cols = [row["name"] for row in conn.execute("PRAGMA table_info(tasks)").fetchall()]
        if "user_id" not in cols:
            conn.execute("ALTER TABLE tasks ADD COLUMN user_id INTEGER DEFAULT NULL")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id)")
        # Check if users has email
        ucols = [row["name"] for row in conn.execute("PRAGMA table_info(users)").fetchall()]
        if "email" not in ucols:
            conn.execute("ALTER TABLE users ADD COLUMN email TEXT DEFAULT ''")


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
        "sub": user_id,
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
    return decode_token(token)


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class RegisterReq(BaseModel):
    username: str = Field(min_length=3, max_length=50)
    password: str = Field(min_length=4, max_length=100)
    display_name: str = ""

class LoginReq(BaseModel):
    username: str
    password: str

class ChangeUsernameReq(BaseModel):
    new_username: str = Field(min_length=3, max_length=50)
    current_password: str

class ChangePasswordReq(BaseModel):
    old_password: str
    new_password: str = Field(min_length=4, max_length=100)

class ChangeEmailReq(BaseModel):
    email: str = Field(max_length=100)

class TaskCreate(BaseModel):
    title: str = Field(min_length=1)
    description: str = ""
    priority: str = "P3"
    project: str = ""
    context: str = ""
    deadline: Optional[str] = None
    gtd_status: str = "inbox"
    waiting_for: str = ""

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    project: Optional[str] = None
    context: Optional[str] = None
    deadline: Optional[str] = None
    gtd_status: Optional[str] = None
    waiting_for: Optional[str] = None


# ── Row → dict helper ─────────────────────────────────────────────────────────

def task_row_to_dict(row) -> dict:
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
    return d


# ══════════════════════════════════════════════════════════════════════════════
#  APP
# ══════════════════════════════════════════════════════════════════════════════

app = FastAPI(title="TaskFlow V4", docs_url="/api/docs")


@app.on_event("startup")
async def startup():
    migrate_db()


# ── Auth routes ────────────────────────────────────────────────────────────────

@app.post("/api/auth/register")
async def register(req: RegisterReq, response: Response):
    username = req.username.strip()
    with get_db() as conn:
        existing = conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="Username sudah digunakan")

        now = datetime.now().isoformat()
        cur = conn.execute(
            "INSERT INTO users (username, password_hash, display_name, created_at) VALUES (?,?,?,?)",
            (username, hash_password(req.password), req.display_name.strip() or username, now),
        )
        user_id = cur.lastrowid

    token = create_token(user_id, username)
    response.set_cookie("token", token, httponly=True, samesite="lax", max_age=JWT_EXPIRE_HOURS * 3600)
    return {"user_id": user_id, "username": username, "token": token}


@app.post("/api/auth/login")
async def login(req: LoginReq, response: Response):
    username = req.username.strip()
    with get_db() as conn:
        user = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
        if not user or not verify_password(req.password, user["password_hash"]):
            raise HTTPException(status_code=401, detail="Username atau password salah")

    token = create_token(user["id"], user["username"])
    response.set_cookie("token", token, httponly=True, samesite="lax", max_age=JWT_EXPIRE_HOURS * 3600)
    return {"user_id": user["id"], "username": user["username"], "display_name": user["display_name"], "token": token}


@app.get("/api/auth/me")
async def get_me(user=Depends(get_current_user)):
    with get_db() as conn:
        row = conn.execute("SELECT id, username, display_name, email, created_at FROM users WHERE id = ?", (user["sub"],)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
    return dict(row)


@app.post("/api/auth/logout")
async def logout(response: Response):
    response.delete_cookie("token")
    return {"ok": True}


@app.patch("/api/auth/profile/username")
async def change_username(req: ChangeUsernameReq, response: Response, user=Depends(get_current_user)):
    new_username = req.new_username.strip()
    with get_db() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user["sub"],)).fetchone()
        if not row or not verify_password(req.current_password, row["password_hash"]):
            raise HTTPException(status_code=401, detail="Password salah")
        existing = conn.execute("SELECT id FROM users WHERE username = ? AND id != ?", (new_username, user["sub"])).fetchone()
        if existing:
            raise HTTPException(status_code=400, detail="Username sudah digunakan")
        conn.execute("UPDATE users SET username = ? WHERE id = ?", (new_username, user["sub"]))
    token = create_token(user["sub"], new_username)
    response.set_cookie("token", token, httponly=True, samesite="lax", max_age=JWT_EXPIRE_HOURS * 3600)
    return {"username": new_username, "token": token}


@app.patch("/api/auth/profile/password")
async def change_password(req: ChangePasswordReq, user=Depends(get_current_user)):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user["sub"],)).fetchone()
        if not row or not verify_password(req.old_password, row["password_hash"]):
            raise HTTPException(status_code=401, detail="Password lama salah")
        conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(req.new_password), user["sub"]))
    return {"ok": True}


@app.patch("/api/auth/profile/email")
async def change_email(req: ChangeEmailReq, user=Depends(get_current_user)):
    with get_db() as conn:
        conn.execute("UPDATE users SET email = ? WHERE id = ?", (req.email.strip(), user["sub"]))
    return {"ok": True}


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
    clauses = ["user_id = ?"]
    params = [user["sub"]]

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
async def create_task(req: TaskCreate, user=Depends(get_current_user)):
    now = datetime.now().isoformat()
    deadline = None
    if req.deadline:
        d = parse_date(req.deadline)
        if d:
            deadline = d.isoformat()

    # Calculate quadrant
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
                project, context, deadline, waiting_for, user_id, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (req.title, req.description, req.gtd_status, req.priority.upper(), quadrant,
             req.project, req.context, deadline, req.waiting_for, user["sub"], now, now),
        )
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (cur.lastrowid,)).fetchone()
    return task_row_to_dict(row)


@app.get("/api/tasks/{task_id}")
async def get_task(task_id: int, user=Depends(get_current_user)):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", (task_id, user["sub"])).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Task not found")
    return task_row_to_dict(row)


@app.put("/api/tasks/{task_id}")
async def update_task(task_id: int, req: TaskUpdate, user=Depends(get_current_user)):
    with get_db() as conn:
        existing = conn.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", (task_id, user["sub"])).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Task not found")

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

        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update")

        updates["updated_at"] = datetime.now().isoformat()

        # Recalculate quadrant
        pri = updates.get("priority", existing["priority"])
        dl_str = updates.get("deadline", existing["deadline"])
        dl = date.fromisoformat(dl_str) if dl_str else None
        task_obj = Task(title="", priority=Priority.from_str(pri), deadline=dl)
        updates["quadrant"] = calculate_quadrant(task_obj).value

        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [task_id, user["sub"]]
        conn.execute(f"UPDATE tasks SET {set_clause} WHERE id = ? AND user_id = ?", values)

        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    return task_row_to_dict(row)


@app.post("/api/tasks/{task_id}/done")
async def mark_done(task_id: int, user=Depends(get_current_user)):
    now = datetime.now().isoformat()
    with get_db() as conn:
        cur = conn.execute(
            "UPDATE tasks SET gtd_status='done', completed_at=?, updated_at=? WHERE id=? AND user_id=?",
            (now, now, task_id, user["sub"]),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Task not found")
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
    return task_row_to_dict(row)


@app.delete("/api/tasks/{task_id}")
async def delete_task(task_id: int, user=Depends(get_current_user)):
    with get_db() as conn:
        cur = conn.execute("DELETE FROM tasks WHERE id = ? AND user_id = ?", (task_id, user["sub"]))
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Task not found")
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


# ── Serve SPA ──────────────────────────────────────────────────────────────────

@app.get("/", response_class=HTMLResponse)
async def serve_spa():
    index = STATIC_DIR / "index.html"
    if index.exists():
        return HTMLResponse(index.read_text(encoding="utf-8"))
    return HTMLResponse("<h1>TaskFlow V4</h1><p>Static files not found.</p>")


# Mount static files
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


# ══════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    migrate_db()
    uvicorn.run("webapp:app", host="0.0.0.0", port=WEB_PORT, reload=False)
