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

import pytz as _pytz
_TZ_JKT = _pytz.timezone("Asia/Jakarta")

def _today_jkt() -> date:
    """Return today's date in Jakarta timezone (UTC+7)."""
    return datetime.now(_TZ_JKT).date()

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

            # ── Shared lists ──────────────────────────────────────────────────
            conn.execute("""
                CREATE TABLE IF NOT EXISTS shared_lists (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    name        TEXT NOT NULL,
                    owner_id    INTEGER NOT NULL,
                    created_at  TEXT NOT NULL,
                    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_shared_lists_owner ON shared_lists(owner_id)")

            conn.execute("""
                CREATE TABLE IF NOT EXISTS list_members (
                    list_id     INTEGER NOT NULL,
                    user_id     INTEGER NOT NULL,
                    joined_at   TEXT NOT NULL,
                    PRIMARY KEY (list_id, user_id),
                    FOREIGN KEY (list_id) REFERENCES shared_lists(id) ON DELETE CASCADE,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_list_members_user ON list_members(user_id)")

            conn.execute("""
                CREATE TABLE IF NOT EXISTS list_invites (
                    code        TEXT PRIMARY KEY,
                    list_id     INTEGER NOT NULL,
                    created_by  INTEGER NOT NULL,
                    expires_at  TEXT NOT NULL,
                    used        INTEGER DEFAULT 0,
                    FOREIGN KEY (list_id) REFERENCES shared_lists(id) ON DELETE CASCADE
                )
            """)

            # Notifications table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS notifications (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id     INTEGER NOT NULL,
                    message     TEXT NOT NULL,
                    is_read     INTEGER DEFAULT 0,
                    list_id     INTEGER DEFAULT NULL,
                    task_id     INTEGER DEFAULT NULL,
                    created_at  TEXT NOT NULL,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read, created_at)")

            # Chat messages table
            conn.execute("""
                CREATE TABLE IF NOT EXISTS messages (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    list_id     INTEGER NOT NULL,
                    user_id     INTEGER NOT NULL,
                    content     TEXT NOT NULL,
                    task_id     INTEGER DEFAULT NULL,
                    msg_type    TEXT NOT NULL DEFAULT 'text',
                    created_at  TEXT NOT NULL,
                    FOREIGN KEY (list_id) REFERENCES shared_lists(id) ON DELETE CASCADE,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE SET NULL
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_list ON messages(list_id, created_at)")

            # Habits tables
            conn.execute("""
                CREATE TABLE IF NOT EXISTS habits (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    title           TEXT NOT NULL,
                    phase           TEXT NOT NULL DEFAULT 'pagi' CHECK(phase IN ('pagi','siang','malam')),
                    micro_target    TEXT DEFAULT '',
                    frequency       TEXT DEFAULT '["mon","tue","wed","thu","fri","sat","sun"]',
                    identity_pillar TEXT DEFAULT '',
                    created_at      TEXT DEFAULT (datetime('now'))
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_habits_user ON habits(user_id)")
            conn.execute("""
                CREATE TABLE IF NOT EXISTS habit_logs (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    habit_id    INTEGER NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
                    date        TEXT NOT NULL,
                    status      TEXT NOT NULL CHECK(status IN ('done','skipped','missed')),
                    skip_reason TEXT DEFAULT '',
                    created_at  TEXT DEFAULT (datetime('now')),
                    UNIQUE(habit_id, date)
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_habit_logs_habit ON habit_logs(habit_id, date)")

            # Reply/quote migration
            cols_msg = [r["name"] for r in conn.execute("PRAGMA table_info(messages)").fetchall()]
            if "reply_to_id" not in cols_msg:
                conn.execute("ALTER TABLE messages ADD COLUMN reply_to_id INTEGER DEFAULT NULL REFERENCES messages(id) ON DELETE SET NULL")

            # Migrate: add list_id and assigned_to to tasks if missing
            cols = [row["name"] for row in conn.execute("PRAGMA table_info(tasks)").fetchall()]
            if "list_id" not in cols:
                conn.execute("ALTER TABLE tasks ADD COLUMN list_id INTEGER DEFAULT NULL")
            if "assigned_to" not in cols:
                conn.execute("ALTER TABLE tasks ADD COLUMN assigned_to INTEGER DEFAULT NULL")
            if "progress" not in cols:
                conn.execute("ALTER TABLE tasks ADD COLUMN progress INTEGER DEFAULT 0")
            if "parent_id" not in cols:
                conn.execute("ALTER TABLE tasks ADD COLUMN parent_id INTEGER DEFAULT NULL REFERENCES tasks(id) ON DELETE SET NULL")

            # Migrate: add author_id and client_id to task_notes if missing
            note_cols = [row["name"] for row in conn.execute("PRAGMA table_info(task_notes)").fetchall()]
            if "author_id" not in note_cols:
                conn.execute("ALTER TABLE task_notes ADD COLUMN author_id INTEGER DEFAULT NULL")
            if "client_id" not in note_cols:
                conn.execute("ALTER TABLE task_notes ADD COLUMN client_id TEXT DEFAULT NULL")

            # Migrate: add client_id to subtasks if missing
            sub_cols = [row["name"] for row in conn.execute("PRAGMA table_info(subtasks)").fetchall()]
            if "client_id" not in sub_cols:
                conn.execute("ALTER TABLE subtasks ADD COLUMN client_id TEXT DEFAULT NULL")
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_subtasks_client_id ON subtasks(client_id) WHERE client_id IS NOT NULL")
            conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_client_id ON task_notes(client_id) WHERE client_id IS NOT NULL")

            # Scratchpad notes
            conn.execute("""
                CREATE TABLE IF NOT EXISTS scratchpad_notes (
                    id          INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    title       TEXT    NOT NULL DEFAULT '',
                    content     TEXT    NOT NULL DEFAULT '',
                    tags        TEXT    NOT NULL DEFAULT '[]',
                    linked_task_id INTEGER DEFAULT NULL REFERENCES tasks(id) ON DELETE SET NULL,
                    created_at  TEXT    DEFAULT (datetime('now')),
                    updated_at  TEXT    DEFAULT (datetime('now'))
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_scratchpad_user ON scratchpad_notes(user_id, updated_at)")

            # Migrate: add linked_to and linked_task_ids to scratchpad_notes if missing
            sp_cols = [r["name"] for r in conn.execute("PRAGMA table_info(scratchpad_notes)").fetchall()]
            if "linked_to" not in sp_cols:
                conn.execute("ALTER TABLE scratchpad_notes ADD COLUMN linked_to TEXT NOT NULL DEFAULT '[]'")
            if "linked_task_ids" not in sp_cols:
                # Migrate existing linked_task_id → linked_task_ids array
                conn.execute("ALTER TABLE scratchpad_notes ADD COLUMN linked_task_ids TEXT NOT NULL DEFAULT '[]'")
                conn.execute("""
                    UPDATE scratchpad_notes SET linked_task_ids = json_array(linked_task_id)
                    WHERE linked_task_id IS NOT NULL AND linked_task_id != ''
                """)

    # ── Row to Task mapping ────────────────────────────────────────────────

    @staticmethod
    def _row_to_task(row: sqlite3.Row) -> Task:
        def parse_dt(val):
            return datetime.fromisoformat(val) if val else None
        def parse_d(val):
            return date.fromisoformat(val) if val else None

        keys = row.keys()
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
            is_focused=bool(row["is_focused"]) if "is_focused" in keys else False,
            list_id=row["list_id"] if "list_id" in keys else None,
            assigned_to=row["assigned_to"] if "assigned_to" in keys else None,
            progress=int(row["progress"]) if "progress" in keys and row["progress"] is not None else 0,
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

    def add(self, task: Task, user_id: Optional[int] = None, list_id: Optional[int] = None) -> Task:
        now = datetime.now().isoformat()
        with self._connect() as conn:
            cur = conn.execute(
                """INSERT INTO tasks
                   (title, description, gtd_status, priority, quadrant,
                    project, context, deadline, waiting_for, user_id, list_id, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    task.title, task.description, task.gtd_status.value, task.priority.value,
                    task.quadrant.value, task.project, task.context,
                    task.deadline.isoformat() if task.deadline else None,
                    task.waiting_for, user_id, list_id, now, now,
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

    def add_subtask(self, task_id: int, title: str, client_id: Optional[str] = None) -> dict:
        now = datetime.now().isoformat()
        with self._connect() as conn:
            # Idempotency: return existing if same client_id
            if client_id:
                existing = conn.execute(
                    "SELECT * FROM subtasks WHERE client_id = ?", (client_id,)
                ).fetchone()
                if existing:
                    return dict(existing)
            row = conn.execute(
                "SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM subtasks WHERE task_id = ?",
                (task_id,),
            ).fetchone()
            order = row["next_order"]
            cur = conn.execute(
                "INSERT INTO subtasks (task_id, title, is_done, sort_order, created_at, client_id) VALUES (?,?,0,?,?,?)",
                (task_id, title, order, now, client_id),
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

    def get_child_tasks(self, parent_id: int) -> list[dict]:
        """Return all tasks that are children of parent_id."""
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM tasks WHERE parent_id = ? ORDER BY priority, created_at",
                (parent_id,),
            ).fetchall()
            return [dict(r) for r in rows]

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

    # ── Shared Lists ──────────────────────────────────────────────────────

    def create_shared_list(self, name: str, owner_id: int) -> dict:
        now = datetime.now().isoformat()
        with self._connect() as conn:
            cur = conn.execute(
                "INSERT INTO shared_lists (name, owner_id, created_at) VALUES (?,?,?)",
                (name, owner_id, now),
            )
            return {"id": cur.lastrowid, "name": name, "owner_id": owner_id, "created_at": now, "role": "owner"}

    def get_shared_list(self, list_id: int) -> Optional[dict]:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM shared_lists WHERE id = ?", (list_id,)).fetchone()
            return dict(row) if row else None

    def rename_shared_list(self, list_id: int, owner_id: int, name: str) -> bool:
        with self._connect() as conn:
            cur = conn.execute(
                "UPDATE shared_lists SET name = ? WHERE id = ? AND owner_id = ?",
                (name, list_id, owner_id),
            )
            return cur.rowcount > 0

    def delete_shared_list(self, list_id: int, owner_id: int) -> bool:
        with self._connect() as conn:
            cur = conn.execute(
                "DELETE FROM shared_lists WHERE id = ? AND owner_id = ?", (list_id, owner_id)
            )
            return cur.rowcount > 0

    def get_lists_for_user(self, user_id: int) -> list[dict]:
        """All lists where user is owner OR member, with role and member_count."""
        with self._connect() as conn:
            owned = conn.execute(
                "SELECT id, name, owner_id, created_at FROM shared_lists WHERE owner_id = ?",
                (user_id,),
            ).fetchall()
            membered = conn.execute(
                """SELECT sl.id, sl.name, sl.owner_id, sl.created_at
                   FROM shared_lists sl
                   JOIN list_members lm ON lm.list_id = sl.id
                   WHERE lm.user_id = ?""",
                (user_id,),
            ).fetchall()
            result = []
            for r in owned:
                cnt = conn.execute(
                    "SELECT COUNT(*) as c FROM list_members WHERE list_id = ?", (r["id"],)
                ).fetchone()["c"]
                result.append({**dict(r), "role": "owner", "member_count": cnt})
            for r in membered:
                cnt = conn.execute(
                    "SELECT COUNT(*) as c FROM list_members WHERE list_id = ?", (r["id"],)
                ).fetchone()["c"]
                result.append({**dict(r), "role": "member", "member_count": cnt})
            return result

    def add_list_member(self, list_id: int, user_id: int) -> bool:
        now = datetime.now().isoformat()
        with self._connect() as conn:
            try:
                conn.execute(
                    "INSERT INTO list_members (list_id, user_id, joined_at) VALUES (?,?,?)",
                    (list_id, user_id, now),
                )
                return True
            except sqlite3.IntegrityError:
                return False  # already a member

    def remove_list_member(self, list_id: int, user_id: int) -> bool:
        with self._connect() as conn:
            cur = conn.execute(
                "DELETE FROM list_members WHERE list_id = ? AND user_id = ?", (list_id, user_id)
            )
            return cur.rowcount > 0

    def get_list_members(self, list_id: int) -> list[dict]:
        with self._connect() as conn:
            rows = conn.execute(
                """SELECT u.id, u.username, u.display_name, u.telegram_id, lm.joined_at
                   FROM list_members lm
                   JOIN users u ON u.id = lm.user_id
                   WHERE lm.list_id = ?
                   ORDER BY lm.joined_at""",
                (list_id,),
            ).fetchall()
            return [dict(r) for r in rows]

    def is_list_member_or_owner(self, list_id: int, user_id: int) -> bool:
        with self._connect() as conn:
            owner = conn.execute(
                "SELECT 1 FROM shared_lists WHERE id = ? AND owner_id = ?", (list_id, user_id)
            ).fetchone()
            if owner:
                return True
            member = conn.execute(
                "SELECT 1 FROM list_members WHERE list_id = ? AND user_id = ?", (list_id, user_id)
            ).fetchone()
            return bool(member)

    def is_list_owner(self, list_id: int, user_id: int) -> bool:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT 1 FROM shared_lists WHERE id = ? AND owner_id = ?", (list_id, user_id)
            ).fetchone()
            return bool(row)

    def get_user_by_username(self, username: str) -> Optional[dict]:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
            return dict(row) if row else None

    def get_user_by_display_name(self, display_name: str) -> Optional[dict]:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM users WHERE display_name = ? LIMIT 1", (display_name,)
            ).fetchone()
            return dict(row) if row else None

    def get_user_by_id(self, user_id: int) -> Optional[dict]:
        with self._connect() as conn:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return dict(row) if row else None

    # ── List Invites ───────────────────────────────────────────────────────

    def create_list_invite(self, list_id: int, created_by: int, expire_hours: int = 48) -> str:
        from datetime import timedelta
        code = secrets.token_urlsafe(16)
        expires_at = (datetime.now() + timedelta(hours=expire_hours)).isoformat()
        with self._connect() as conn:
            conn.execute(
                "INSERT INTO list_invites (code, list_id, created_by, expires_at, used) VALUES (?,?,?,?,0)",
                (code, list_id, created_by, expires_at),
            )
        return code

    def consume_list_invite(self, code: str) -> Optional[int]:
        """Returns list_id if valid, else None."""
        with self._connect() as conn:
            row = conn.execute(
                "SELECT list_id, expires_at, used FROM list_invites WHERE code = ?", (code,)
            ).fetchone()
            if not row or row["used"]:
                return None
            if datetime.fromisoformat(row["expires_at"]) < datetime.now():
                return None
            conn.execute("UPDATE list_invites SET used = 1 WHERE code = ?", (code,))
            return row["list_id"]

    # ── Shared-list task queries ───────────────────────────────────────────

    def get_tasks_in_list(self, list_id: int) -> list[Task]:
        with self._connect() as conn:
            rows = conn.execute(
                """SELECT * FROM tasks WHERE list_id = ?
                   AND gtd_status NOT IN ('done','archived')
                   ORDER BY priority, deadline""",
                (list_id,),
            ).fetchall()
            return [self._row_to_task(r) for r in rows]

    def get_task_row(self, task_id: int) -> Optional[sqlite3.Row]:
        """Return raw sqlite3.Row for a task (used for authorization checks)."""
        with self._connect() as conn:
            return conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()

    def add_to_list(self, task: Task, user_id: int, list_id: int) -> Task:
        """Add a task directly to a shared list."""
        now = datetime.now().isoformat()
        with self._connect() as conn:
            cur = conn.execute(
                """INSERT INTO tasks
                   (title, description, gtd_status, priority, quadrant,
                    project, context, deadline, waiting_for, user_id, list_id, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    task.title, task.description, task.gtd_status.value, task.priority.value,
                    task.quadrant.value, task.project, task.context,
                    task.deadline.isoformat() if task.deadline else None,
                    task.waiting_for, user_id, list_id, now, now,
                ),
            )
            task.id = cur.lastrowid
            task.created_at = datetime.fromisoformat(now)
            task.updated_at = datetime.fromisoformat(now)
        return task

    def get_list_member_telegram_ids(self, list_id: int, exclude_user_id: int) -> list[int]:
        """Returns telegram_ids of all members (owner + members) except exclude_user_id."""
        with self._connect() as conn:
            owner_rows = conn.execute(
                """SELECT u.telegram_id FROM shared_lists sl
                   JOIN users u ON u.id = sl.owner_id
                   WHERE sl.id = ? AND sl.owner_id != ?""",
                (list_id, exclude_user_id),
            ).fetchall()
            member_rows = conn.execute(
                """SELECT u.telegram_id FROM list_members lm
                   JOIN users u ON u.id = lm.user_id
                   WHERE lm.list_id = ? AND lm.user_id != ?""",
                (list_id, exclude_user_id),
            ).fetchall()
            ids = []
            for r in owner_rows + member_rows:
                if r["telegram_id"]:
                    ids.append(r["telegram_id"])
            return ids

    # ── Notes with author ──────────────────────────────────────────────────

    def add_note_with_author(self, task_id: int, content: str, author_id: Optional[int] = None, client_id: Optional[str] = None) -> dict:
        now = datetime.now().isoformat()
        with self._connect() as conn:
            # Idempotency: return existing if same client_id
            if client_id:
                existing = conn.execute(
                    "SELECT * FROM task_notes WHERE client_id = ?", (client_id,)
                ).fetchone()
                if existing:
                    return dict(existing)
            cur = conn.execute(
                "INSERT INTO task_notes (task_id, content, created_at, author_id, client_id) VALUES (?,?,?,?,?)",
                (task_id, content, now, author_id, client_id),
            )
            return {"id": cur.lastrowid, "task_id": task_id, "content": content,
                    "created_at": now, "author_id": author_id, "author_name": None, "client_id": client_id}

    def get_notes_with_author(self, task_id: int) -> list[dict]:
        with self._connect() as conn:
            rows = conn.execute(
                """SELECT tn.id, tn.task_id, tn.content, tn.created_at, tn.author_id,
                          u.display_name AS author_name
                   FROM task_notes tn
                   LEFT JOIN users u ON u.id = tn.author_id
                   WHERE tn.task_id = ?
                   ORDER BY tn.created_at DESC""",
                (task_id,),
            ).fetchall()
            return [dict(r) for r in rows]

    # ── Notifications ─────────────────────────────────────────────────────

    def add_notification(self, user_id: int, message: str,
                         list_id: Optional[int] = None, task_id: Optional[int] = None) -> dict:
        now = datetime.now().isoformat()
        with self._connect() as conn:
            cur = conn.execute(
                "INSERT INTO notifications (user_id, message, is_read, list_id, task_id, created_at) "
                "VALUES (?,?,0,?,?,?)",
                (user_id, message, list_id, task_id, now),
            )
            return {"id": cur.lastrowid, "user_id": user_id, "message": message,
                    "is_read": False, "list_id": list_id, "task_id": task_id, "created_at": now}

    def notify_list_members(self, list_id: int, actor_user_id: int,
                            message: str, task_id: Optional[int] = None):
        """Write notification records for all list members except the actor."""
        with self._connect() as conn:
            owner = conn.execute(
                "SELECT owner_id FROM shared_lists WHERE id = ?", (list_id,)
            ).fetchone()
            members = conn.execute(
                "SELECT user_id FROM list_members WHERE list_id = ?", (list_id,)
            ).fetchall()
            recipients = set()
            if owner:
                recipients.add(owner["owner_id"])
            for r in members:
                recipients.add(r["user_id"])
            recipients.discard(actor_user_id)

            now = datetime.now().isoformat()
            for uid in recipients:
                conn.execute(
                    "INSERT INTO notifications (user_id, message, is_read, list_id, task_id, created_at) "
                    "VALUES (?,?,0,?,?,?)",
                    (uid, message, list_id, task_id, now),
                )

    def get_notifications(self, user_id: int, limit: int = 30) -> list[dict]:
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM notifications WHERE user_id = ? "
                "ORDER BY created_at DESC LIMIT ?",
                (user_id, limit),
            ).fetchall()
            return [dict(r) for r in rows]

    def get_unread_count(self, user_id: int) -> int:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT COUNT(*) as cnt FROM notifications WHERE user_id = ? AND is_read = 0",
                (user_id,),
            ).fetchone()
            return row["cnt"] or 0

    def mark_notifications_read(self, user_id: int, notif_ids: Optional[list[int]] = None):
        with self._connect() as conn:
            if notif_ids:
                placeholders = ",".join("?" * len(notif_ids))
                conn.execute(
                    f"UPDATE notifications SET is_read = 1 WHERE user_id = ? AND id IN ({placeholders})",
                    [user_id] + notif_ids,
                )
            else:
                conn.execute(
                    "UPDATE notifications SET is_read = 1 WHERE user_id = ?", (user_id,)
                )

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

    # ── Habit methods ──────────────────────────────────────────────────────────

    def get_habits_by_phase(self, user_id: int, phase: str) -> list[dict]:
        """Get all habits for a user filtered by phase."""
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM habits WHERE user_id = ? AND phase = ? ORDER BY created_at",
                (user_id, phase),
            ).fetchall()
            return [dict(r) for r in rows]

    def get_habits_for_user(self, user_id: int) -> list[dict]:
        """Get all habits for a user."""
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM habits WHERE user_id = ? ORDER BY phase, created_at",
                (user_id,),
            ).fetchall()
            return [dict(r) for r in rows]

    def get_habit_log_today(self, habit_id: int, date_str: str) -> Optional[dict]:
        """Get today's log for a habit. date_str = YYYY-MM-DD."""
        with self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM habit_logs WHERE habit_id = ? AND date = ?",
                (habit_id, date_str),
            ).fetchone()
            return dict(row) if row else None

    def upsert_habit_log(self, habit_id: int, date_str: str, status: str, skip_reason: str = "") -> dict:
        """Insert or update a habit log for a given date."""
        with self._connect() as conn:
            conn.execute(
                """INSERT INTO habit_logs (habit_id, date, status, skip_reason, created_at)
                   VALUES (?, ?, ?, ?, datetime('now'))
                   ON CONFLICT(habit_id, date) DO UPDATE SET status=excluded.status, skip_reason=excluded.skip_reason""",
                (habit_id, date_str, status, skip_reason),
            )
            row = conn.execute(
                "SELECT * FROM habit_logs WHERE habit_id = ? AND date = ?",
                (habit_id, date_str),
            ).fetchone()
            return dict(row)

    def get_habit_streak(self, habit_id: int) -> int:
        """Calculate current consecutive 'done' streak (days ending today or yesterday)."""
        import json as _json
        with self._connect() as conn:
            habit = conn.execute("SELECT frequency FROM habits WHERE id = ?", (habit_id,)).fetchone()
            if not habit:
                return 0
            try:
                freq = _json.loads(habit["frequency"])
            except Exception:
                freq = ["mon","tue","wed","thu","fri","sat","sun"]

            day_map = {0:"mon",1:"tue",2:"wed",3:"thu",4:"fri",5:"sat",6:"sun"}
            rows = conn.execute(
                "SELECT date, status FROM habit_logs WHERE habit_id = ? AND status='done' ORDER BY date DESC",
                (habit_id,),
            ).fetchall()
            done_dates = {r["date"] for r in rows}

        from datetime import timedelta
        streak = 0
        check = _today_jkt()
        # Allow today to be pending (streak still counts from yesterday)
        today_str = check.strftime("%Y-%m-%d")
        if today_str not in done_dates:
            check -= timedelta(days=1)

        for _ in range(365):
            dow = day_map[check.weekday()]
            d_str = check.strftime("%Y-%m-%d")
            if dow not in freq:
                check -= timedelta(days=1)
                continue
            if d_str in done_dates:
                streak += 1
                check -= timedelta(days=1)
            else:
                break
        return streak

    def get_habit_week_log(self, habit_id: int) -> list[str]:
        """Return list of 7 statuses Mon–Sun for current week."""
        from datetime import timedelta
        today = _today_jkt()
        monday = today - timedelta(days=today.weekday())
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT date, status FROM habit_logs WHERE habit_id = ? AND date >= ? AND date <= ?",
                (habit_id, monday.strftime("%Y-%m-%d"), today.strftime("%Y-%m-%d")),
            ).fetchall()
        log_map = {r["date"]: r["status"] for r in rows}
        result = []
        for i in range(7):
            d = monday + timedelta(days=i)
            d_str = d.strftime("%Y-%m-%d")
            if d > today:
                result.append(None)
            else:
                result.append(log_map.get(d_str, "missed"))
        return result

    def get_habits_pending_today(self, user_id: int, phase: str) -> list[dict]:
        """Get habits for a phase that have NOT been checked in today."""
        today = _today_jkt().strftime("%Y-%m-%d")
        with self._connect() as conn:
            rows = conn.execute(
                """SELECT h.* FROM habits h
                   WHERE h.user_id = ? AND h.phase = ?
                   AND h.id NOT IN (
                       SELECT habit_id FROM habit_logs
                       WHERE date = ? AND status IN ('done','skipped')
                   )
                   ORDER BY h.created_at""",
                (user_id, phase, today),
            ).fetchall()
            return [dict(r) for r in rows]

    def get_today_habit_summary(self, user_id: int) -> dict:
        """Return done/total counts per phase for today."""
        today = _today_jkt().strftime("%Y-%m-%d")
        with self._connect() as conn:
            habits = conn.execute(
                "SELECT id, phase FROM habits WHERE user_id = ?", (user_id,)
            ).fetchall()
            logs = conn.execute(
                "SELECT habit_id, status FROM habit_logs WHERE date = ? AND habit_id IN "
                "(SELECT id FROM habits WHERE user_id = ?)",
                (today, user_id),
            ).fetchall()
        log_map = {r["habit_id"]: r["status"] for r in logs}
        summary = {"pagi": [0,0], "siang": [0,0], "malam": [0,0]}
        for h in habits:
            phase = h["phase"]
            if phase not in summary:
                continue
            summary[phase][1] += 1
            if log_map.get(h["id"]) == "done":
                summary[phase][0] += 1
        return summary  # {"pagi": [done, total], ...}
