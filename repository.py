"""
TaskFlow V4 - Database Repository (SQLite)
Multi-user: all task queries filter by user_id.
"""
from __future__ import annotations

import sqlite3
import secrets
import hashlib
from datetime import datetime, date
from typing import Optional
from contextlib import contextmanager

from models import Task, GTDStatus, Priority, Quadrant
from config import DB_PATH


class TaskRepository:
    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self._init_db()

    @contextmanager
    def _connect(self):
        conn = sqlite3.connect(self.db_path)
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

    def _init_db(self):
        with self._connect() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS tasks (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    title           TEXT NOT NULL,
                    description     TEXT DEFAULT '',
                    gtd_status      TEXT NOT NULL DEFAULT 'inbox',
                    priority        TEXT NOT NULL DEFAULT 'P3',
                    quadrant        TEXT NOT NULL DEFAULT 'Q4',
                    project         TEXT DEFAULT '',
                    context         TEXT DEFAULT '',
                    deadline        TEXT DEFAULT NULL,
                    waiting_for     TEXT DEFAULT '',
                    user_id         INTEGER DEFAULT NULL,
                    created_at      TEXT NOT NULL,
                    updated_at      TEXT NOT NULL,
                    completed_at    TEXT DEFAULT NULL
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_gtd_status ON tasks(gtd_status)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_quadrant ON tasks(quadrant)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_tasks_user_id ON tasks(user_id)")

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
            conn.execute("CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id)")

            # Migrate: add user_id column if missing (for existing DBs)
            cols = [row["name"] for row in conn.execute("PRAGMA table_info(tasks)").fetchall()]
            if "user_id" not in cols:
                conn.execute("ALTER TABLE tasks ADD COLUMN user_id INTEGER DEFAULT NULL")
            if "is_focused" not in cols:
                conn.execute("ALTER TABLE tasks ADD COLUMN is_focused INTEGER DEFAULT 0")

            # Subtasks table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS subtasks (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id     INTEGER NOT NULL,
                    title       TEXT NOT NULL,
                    is_done     INTEGER DEFAULT 0,
                    sort_order  INTEGER DEFAULT 0,
                    created_at  TEXT NOT NULL,
                    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_subtasks_task_id ON subtasks(task_id)")

            # Task notes/log table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS task_notes (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id     INTEGER NOT NULL,
                    content     TEXT NOT NULL,
                    created_at  TEXT NOT NULL,
                    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_task_notes_task_id ON task_notes(task_id)")

            # Task attachments table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS task_attachments (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    task_id         INTEGER NOT NULL,
                    filename        TEXT NOT NULL,
                    original_name   TEXT NOT NULL,
                    file_size       INTEGER DEFAULT 0,
                    mime_type       TEXT DEFAULT '',
                    created_at      TEXT NOT NULL,
                    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_task_attachments_task_id ON task_attachments(task_id)")

            # Magic login tokens table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS magic_tokens (
                    token       TEXT PRIMARY KEY,
                    user_id     INTEGER NOT NULL,
                    expires_at  TEXT NOT NULL,
                    used        INTEGER DEFAULT 0
                )
            """)

    # ── Row to Task mapping ────────────────────────────────────────────────

    @staticmethod
    def _row_to_task(row: sqlite3.Row) -> Task:
        def parse_dt(val):
            return datetime.fromisoformat(val) if val else None
        def parse_d(val):
            return date.fromisoformat(val) if val else None

        return Task(
            id=row["id"],
            title=row["title"],
            description=row["description"] or "",
            gtd_status=GTDStatus.from_str(row["gtd_status"]),
            priority=Priority.from_str(row["priority"]),
            quadrant=Quadrant(row["quadrant"]),
            project=row["project"] or "",
            context=row["context"] or "",
            deadline=parse_d(row["deadline"]),
            waiting_for=row["waiting_for"] or "",
            created_at=parse_dt(row["created_at"]),
            updated_at=parse_dt(row["updated_at"]),
            completed_at=parse_dt(row["completed_at"]),
        )

    # ── User management ────────────────────────────────────────────────────

    def get_user_by_telegram_id(self, telegram_id: int) -> Optional[dict]:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM users WHERE telegram_id = ?", (telegram_id,)).fetchone()
            return dict(row) if row else None

    def auto_register_telegram_user(self, telegram_id: int, display_name: str) -> int:
        """Auto-register a Telegram user. Returns user_id."""
        with self._connect() as conn:
            existing = conn.execute("SELECT id FROM users WHERE telegram_id = ?", (telegram_id,)).fetchone()
            if existing:
                return existing["id"]

            username = f"tg_{telegram_id}"
            salt = secrets.token_hex(16)
            h = hashlib.pbkdf2_hmac("sha256", secrets.token_hex(8).encode(), salt.encode(), 100_000)
            password_hash = f"{salt}${h.hex()}"

            now = datetime.now().isoformat()
            cur = conn.execute(
                "INSERT INTO users (username, password_hash, display_name, telegram_id, created_at) VALUES (?,?,?,?,?)",
                (username, password_hash, display_name, telegram_id, now),
            )
            return cur.lastrowid

    def link_telegram_to_web_user(self, telegram_id: int, username: str, password: str) -> Optional[int]:
        """Link Telegram account to existing web user via username+password. Returns user_id or None."""
        with self._connect() as conn:
            user = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
            if not user:
                return None

            # Verify password
            try:
                salt, stored_hash = user["password_hash"].split("$")
                computed = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 100_000).hex()
                if computed != stored_hash:
                    return None
            except Exception:
                return None

            # Check if already linked to different telegram
            if user["telegram_id"] and user["telegram_id"] != telegram_id:
                raise ValueError("Akun web ini sudah terhubung ke Telegram lain")

            # Link
            conn.execute("UPDATE users SET telegram_id = ? WHERE id = ?", (telegram_id, user["id"]))

            # Migrate tasks from old auto-registered user to this user
            old_user = conn.execute("SELECT id FROM users WHERE telegram_id = ? AND id != ?", (telegram_id, user["id"])).fetchone()
            if old_user:
                conn.execute("UPDATE tasks SET user_id = ? WHERE user_id = ?", (user["id"], old_user["id"]))

            return user["id"]

    def assign_orphan_tasks(self, user_id: int) -> int:
        """Assign all tasks without user_id to the given user."""
        with self._connect() as conn:
            cur = conn.execute("UPDATE tasks SET user_id = ? WHERE user_id IS NULL", (user_id,))
            return cur.rowcount

    # ── User clause helper ─────────────────────────────────────────────────

    def _uc(self, user_id: Optional[int]) -> tuple[str, list]:
        if user_id is not None:
            return "user_id = ?", [user_id]
        return "1=1", []

    # ── CRUD ───────────────────────────────────────────────────────────────

    def add(self, task: Task, user_id: Optional[int] = None) -> Task:
        now = datetime.now().isoformat()
        with self._connect() as conn:
            cur = conn.execute(
                """INSERT INTO tasks
                   (title, description, gtd_status, priority, quadrant,
                    project, context, deadline, waiting_for, user_id, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    task.title, task.description, task.gtd_status.value, task.priority.value,
                    task.quadrant.value, task.project, task.context,
                    task.deadline.isoformat() if task.deadline else None,
                    task.waiting_for, user_id, now, now,
                ),
            )
            task.id = cur.lastrowid
            task.created_at = datetime.fromisoformat(now)
            task.updated_at = datetime.fromisoformat(now)
        return task

    def get(self, task_id: int, user_id: Optional[int] = None) -> Optional[Task]:
        with self._connect() as conn:
            if user_id is not None:
                row = conn.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", (task_id, user_id)).fetchone()
            else:
                row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
            return self._row_to_task(row) if row else None

    def update(self, task: Task) -> Task:
        now = datetime.now().isoformat()
        task.updated_at = datetime.fromisoformat(now)
        with self._connect() as conn:
            conn.execute(
                """UPDATE tasks SET
                   title=?, description=?, gtd_status=?, priority=?, quadrant=?,
                   project=?, context=?, deadline=?, waiting_for=?,
                   updated_at=?, completed_at=?
                   WHERE id=?""",
                (
                    task.title, task.description, task.gtd_status.value, task.priority.value,
                    task.quadrant.value, task.project, task.context,
                    task.deadline.isoformat() if task.deadline else None,
                    task.waiting_for, now,
                    task.completed_at.isoformat() if task.completed_at else None,
                    task.id,
                ),
            )
        return task

    def delete(self, task_id: int, user_id: Optional[int] = None) -> bool:
        with self._connect() as conn:
            if user_id is not None:
                cur = conn.execute("DELETE FROM tasks WHERE id = ? AND user_id = ?", (task_id, user_id))
            else:
                cur = conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
            return cur.rowcount > 0

    # ── Queries ────────────────────────────────────────────────────────────

    def list_by_status(self, status: GTDStatus, user_id: Optional[int] = None) -> list[Task]:
        uc, up = self._uc(user_id)
        with self._connect() as conn:
            rows = conn.execute(
                f"SELECT * FROM tasks WHERE gtd_status = ? AND {uc} ORDER BY priority, deadline",
                [status.value] + up,
            ).fetchall()
            return [self._row_to_task(r) for r in rows]

    def list_by_quadrant(self, quadrant: Quadrant, user_id: Optional[int] = None) -> list[Task]:
        uc, up = self._uc(user_id)
        with self._connect() as conn:
            rows = conn.execute(
                f"""SELECT * FROM tasks WHERE quadrant = ?
                   AND gtd_status NOT IN ('done','archived') AND {uc}
                   ORDER BY priority, deadline""",
                [quadrant.value] + up,
            ).fetchall()
            return [self._row_to_task(r) for r in rows]

    def list_by_project(self, project: str, user_id: Optional[int] = None) -> list[Task]:
        uc, up = self._uc(user_id)
        proj = project.value if hasattr(project, "value") else project
        with self._connect() as conn:
            rows = conn.execute(
                f"""SELECT * FROM tasks WHERE project = ?
                   AND gtd_status NOT IN ('done','archived') AND {uc}
                   ORDER BY priority, deadline""",
                [proj] + up,
            ).fetchall()
            return [self._row_to_task(r) for r in rows]

    def list_active(self, user_id: Optional[int] = None) -> list[Task]:
        uc, up = self._uc(user_id)
        with self._connect() as conn:
            rows = conn.execute(
                f"""SELECT * FROM tasks
                   WHERE gtd_status NOT IN ('done','archived') AND {uc}
                   ORDER BY priority, deadline""",
                up,
            ).fetchall()
            return [self._row_to_task(r) for r in rows]

    def list_filtered(self, status=None, priority=None, quadrant=None,
                      project=None, context=None, include_done=False,
                      user_id: Optional[int] = None) -> list[Task]:
        clauses, params = [], []
        uc, up = self._uc(user_id)
        clauses.append(uc)
        params.extend(up)

        if status:
            clauses.append("gtd_status = ?")
            params.append(status.value)
        elif not include_done:
            clauses.append("gtd_status NOT IN ('done','archived')")

        if priority:
            clauses.append("priority = ?")
            params.append(priority.value)
        if quadrant:
            clauses.append("quadrant = ?")
            params.append(quadrant.value)
        if project:
            clauses.append("project = ?")
            params.append(project)
        if context:
            clauses.append("context = ?")
            params.append(context)

        where = " AND ".join(clauses)
        with self._connect() as conn:
            rows = conn.execute(f"SELECT * FROM tasks WHERE {where} ORDER BY priority, deadline", params).fetchall()
            return [self._row_to_task(r) for r in rows]

    def list_overdue(self, user_id: Optional[int] = None) -> list[Task]:
        uc, up = self._uc(user_id)
        today = date.today().isoformat()
        with self._connect() as conn:
            rows = conn.execute(
                f"""SELECT * FROM tasks
                   WHERE deadline < ? AND gtd_status NOT IN ('done','archived') AND {uc}
                   ORDER BY deadline""",
                [today] + up,
            ).fetchall()
            return [self._row_to_task(r) for r in rows]

    def list_projects(self, user_id: Optional[int] = None) -> list[str]:
        uc, up = self._uc(user_id)
        with self._connect() as conn:
            rows = conn.execute(
                f"""SELECT DISTINCT project FROM tasks
                   WHERE project != '' AND gtd_status NOT IN ('done','archived') AND {uc}
                   ORDER BY project""", up,
            ).fetchall()
            return [r["project"] for r in rows]

    def list_contexts(self, user_id: Optional[int] = None) -> list[str]:
        uc, up = self._uc(user_id)
        with self._connect() as conn:
            rows = conn.execute(
                f"""SELECT DISTINCT context FROM tasks
                   WHERE context != '' AND gtd_status NOT IN ('done','archived') AND {uc}
                   ORDER BY context""", up,
            ).fetchall()
            return [r["context"] for r in rows]

    def count_by_status(self, user_id: Optional[int] = None) -> dict[str, int]:
        uc, up = self._uc(user_id)
        with self._connect() as conn:
            rows = conn.execute(
                f"SELECT gtd_status, COUNT(*) as cnt FROM tasks WHERE {uc} GROUP BY gtd_status", up,
            ).fetchall()
            return {r["gtd_status"]: r["cnt"] for r in rows}

    def count_by_quadrant(self, user_id: Optional[int] = None) -> dict[str, int]:
        uc, up = self._uc(user_id)
        with self._connect() as conn:
            rows = conn.execute(
                f"""SELECT quadrant, COUNT(*) as cnt FROM tasks
                   WHERE gtd_status NOT IN ('done','archived') AND {uc}
                   GROUP BY quadrant""", up,
            ).fetchall()
            return {r["quadrant"]: r["cnt"] for r in rows}

    # ── Eisenhower recalculation ───────────────────────────────────────────

    def update_quadrant(self, task_id: int, quadrant: Quadrant):
        now = datetime.now().isoformat()
        with self._connect() as conn:
            conn.execute(
                "UPDATE tasks SET quadrant = ?, updated_at = ? WHERE id = ?",
                (quadrant.value, now, task_id),
            )

    def list_for_eisenhower_calc(self) -> list[Task]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM tasks WHERE gtd_status NOT IN ('done','archived')"
            ).fetchall()
            return [self._row_to_task(r) for r in rows]

    # ── Subtask CRUD ───────────────────────────────────────────────────────

    def add_subtask(self, task_id: int, title: str) -> dict:
        now = datetime.now().isoformat()
        with self._connect() as conn:
            # Get next sort order
            row = conn.execute(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM subtasks WHERE task_id = ?",
                (task_id,),
            ).fetchone()
            order = row["next_order"]
            cur = conn.execute(
                "INSERT INTO subtasks (task_id, title, is_done, sort_order, created_at) VALUES (?,?,0,?,?)",
                (task_id, title, order, now),
            )
            return {"id": cur.lastrowid, "task_id": task_id, "title": title, "is_done": False, "sort_order": order}

    def get_subtasks(self, task_id: int) -> list[dict]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM subtasks WHERE task_id = ? ORDER BY sort_order",
                (task_id,),
            ).fetchall()
            return [{"id": r["id"], "task_id": r["task_id"], "title": r["title"],
                      "is_done": bool(r["is_done"]), "sort_order": r["sort_order"]} for r in rows]

    def toggle_subtask(self, subtask_id: int) -> Optional[dict]:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM subtasks WHERE id = ?", (subtask_id,)).fetchone()
            if not row:
                return None
            new_val = 0 if row["is_done"] else 1
            conn.execute("UPDATE subtasks SET is_done = ? WHERE id = ?", (new_val, subtask_id))
            return {"id": row["id"], "task_id": row["task_id"], "title": row["title"],
                    "is_done": bool(new_val), "sort_order": row["sort_order"]}

    def delete_subtask(self, subtask_id: int) -> bool:
        with self._connect() as conn:
            cur = conn.execute("DELETE FROM subtasks WHERE id = ?", (subtask_id,))
            return cur.rowcount > 0

    def get_subtask_progress(self, task_id: int) -> tuple[int, int]:
        """Returns (done_count, total_count)."""
        with self._connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) as total, SUM(CASE WHEN is_done THEN 1 ELSE 0 END) as done FROM subtasks WHERE task_id = ?",
                (task_id,),
            ).fetchone()
            return (row["done"] or 0, row["total"] or 0)

    # ── Focus toggle ───────────────────────────────────────────────────────

    def toggle_focus(self, task_id: int, user_id: Optional[int] = None) -> bool:
        """Toggle is_focused flag. Returns new value."""
        with self._connect() as conn:
            if user_id is not None:
                row = conn.execute("SELECT is_focused FROM tasks WHERE id = ? AND user_id = ?", (task_id, user_id)).fetchone()
            else:
                row = conn.execute("SELECT is_focused FROM tasks WHERE id = ?", (task_id,)).fetchone()
            if not row:
                return False
            new_val = 0 if row["is_focused"] else 1
            now = datetime.now().isoformat()
            conn.execute("UPDATE tasks SET is_focused = ?, updated_at = ? WHERE id = ?", (new_val, now, task_id))
            return bool(new_val)

    def is_focused(self, task_id: int) -> bool:
        with self._connect() as conn:
            row = conn.execute("SELECT is_focused FROM tasks WHERE id = ?", (task_id,)).fetchone()
            return bool(row["is_focused"]) if row else False

    # ── Task Notes / Log ───────────────────────────────────────────────────

    def add_note(self, task_id: int, content: str) -> dict:
        now = datetime.now().isoformat()
        with self._connect() as conn:
            cur = conn.execute(
                "INSERT INTO task_notes (task_id, content, created_at) VALUES (?,?,?)",
                (task_id, content, now),
            )
            return {"id": cur.lastrowid, "task_id": task_id, "content": content, "created_at": now}

    def get_notes(self, task_id: int) -> list[dict]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM task_notes WHERE task_id = ? ORDER BY created_at DESC",
                (task_id,),
            ).fetchall()
            return [{"id": r["id"], "task_id": r["task_id"], "content": r["content"],
                      "created_at": r["created_at"]} for r in rows]

    def delete_note(self, note_id: int) -> bool:
        with self._connect() as conn:
            cur = conn.execute("DELETE FROM task_notes WHERE id = ?", (note_id,))
            return cur.rowcount > 0

    def count_notes(self, task_id: int) -> int:
        with self._connect() as conn:
            row = conn.execute("SELECT COUNT(*) as cnt FROM task_notes WHERE task_id = ?", (task_id,)).fetchone()
            return row["cnt"] or 0

    # ── Task Attachments ───────────────────────────────────────────────────

    def add_attachment(self, task_id: int, filename: str, original_name: str,
                       file_size: int = 0, mime_type: str = "") -> dict:
        now = datetime.now().isoformat()
        with self._connect() as conn:
            cur = conn.execute(
                "INSERT INTO task_attachments (task_id, filename, original_name, file_size, mime_type, created_at) VALUES (?,?,?,?,?,?)",
                (task_id, filename, original_name, file_size, mime_type, now),
            )
            return {"id": cur.lastrowid, "task_id": task_id, "filename": filename,
                    "original_name": original_name, "file_size": file_size,
                    "mime_type": mime_type, "created_at": now}

    def get_attachments(self, task_id: int) -> list[dict]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM task_attachments WHERE task_id = ? ORDER BY created_at DESC",
                (task_id,),
            ).fetchall()
            return [{"id": r["id"], "task_id": r["task_id"], "filename": r["filename"],
                      "original_name": r["original_name"], "file_size": r["file_size"],
                      "mime_type": r["mime_type"], "created_at": r["created_at"]} for r in rows]

    def delete_attachment(self, attachment_id: int) -> Optional[dict]:
        """Delete attachment record and return info for file cleanup."""
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM task_attachments WHERE id = ?", (attachment_id,)).fetchone()
            if not row:
                return None
            conn.execute("DELETE FROM task_attachments WHERE id = ?", (attachment_id,))
            return {"id": row["id"], "filename": row["filename"], "task_id": row["task_id"]}

    def count_attachments(self, task_id: int) -> int:
        with self._connect() as conn:
            row = conn.execute("SELECT COUNT(*) as cnt FROM task_attachments WHERE task_id = ?", (task_id,)).fetchone()
            return row["cnt"] or 0

    # ── Magic login tokens ─────────────────────────────────────────────────

    def create_magic_token(self, user_id: int, expire_minutes: int = 5) -> str:
        """Generate a one-time login token valid for `expire_minutes` minutes."""
        from datetime import timedelta
        token = secrets.token_urlsafe(32)
        expires_at = (datetime.now() + timedelta(minutes=expire_minutes)).isoformat()
        with self._connect() as conn:
            # Hapus token lama milik user yang belum dipakai
            conn.execute("DELETE FROM magic_tokens WHERE user_id = ? AND used = 0", (user_id,))
            conn.execute(
                "INSERT INTO magic_tokens (token, user_id, expires_at, used) VALUES (?, ?, ?, 0)",
                (token, user_id, expires_at),
            )
        return token

    def consume_magic_token(self, token: str) -> Optional[int]:
        """Validate and consume token. Returns user_id or None if invalid/expired/used."""
        with self._connect() as conn:
            row = conn.execute(
                "SELECT user_id, expires_at, used FROM magic_tokens WHERE token = ?",
                (token,),
            ).fetchone()
            if not row:
                return None
            if row["used"]:
                return None
            if datetime.fromisoformat(row["expires_at"]) < datetime.now():
                return None
            conn.execute("UPDATE magic_tokens SET used = 1 WHERE token = ?", (token,))
            return row["user_id"]
