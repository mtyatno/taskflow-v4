"""Komentar level halaman untuk note workspace: skema, kursor pull, mention, serialisasi (spec komentar-note §2, §4).

Modul ini TIDAK boleh mengimpor webapp (webapp yang mengimpor modul ini)."""
import re
from datetime import datetime, timedelta
from typing import Optional

TOMBSTONE_DAYS = 30

_MENTION_RE = re.compile(r"@(\w+)")

# Dipakai semua query komentar: alias c (komentar), ua (penulis), ur (penyelesai).
SELECT_COLS = (
    "c.*, ua.username AS author_username, ua.display_name AS author_display, "
    "COALESCE(ur.display_name, ur.username) AS resolver_name"
)
FROM_JOINS = (
    "FROM note_comments c "
    "LEFT JOIN users ua ON ua.id = c.user_id "
    "LEFT JOIN users ur ON ur.id = c.resolved_by"
)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS note_comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id     INTEGER NOT NULL,
  list_id     INTEGER NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id   INTEGER DEFAULT NULL,
  body        TEXT NOT NULL,
  quote       TEXT DEFAULT NULL,
  resolved_at TEXT DEFAULT NULL,
  resolved_by INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE SET NULL,
  edited_at   TEXT DEFAULT NULL,
  deleted_at  TEXT DEFAULT NULL,
  client_id   TEXT DEFAULT NULL,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_note_comments_client ON note_comments(user_id, client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_note_comments_note ON note_comments(note_id, list_id, created_at);
CREATE INDEX IF NOT EXISTS idx_note_comments_updated ON note_comments(updated_at, id);

CREATE TABLE IF NOT EXISTS note_comment_reads (
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id      INTEGER NOT NULL,
  last_read_at TEXT NOT NULL,
  PRIMARY KEY (user_id, note_id)
);
"""


def ensure_note_comments_schema(conn) -> None:
    """Tabel komentar + penanda baca + notifications.note_id (idempoten). Pemanggil yang commit."""
    for stmt in _SCHEMA.split(";"):
        if stmt.strip():
            conn.execute(stmt)
    cols = {r[1] for r in conn.execute("PRAGMA table_info(notifications)").fetchall()}
    if "note_id" not in cols:
        conn.execute("ALTER TABLE notifications ADD COLUMN note_id INTEGER DEFAULT NULL")


def _cutoff(now: str, days: int) -> str:
    return (datetime.fromisoformat(now) - timedelta(days=days)).isoformat()


def purge_old_tombstones(conn, now: str, days: int = TOMBSTONE_DAYS) -> int:
    """Hapus permanen baris yang di-soft-delete lebih dari `days` hari lalu. Pemanggil yang commit."""
    cur = conn.execute(
        "DELETE FROM note_comments WHERE deleted_at IS NOT NULL AND deleted_at < ?", (_cutoff(now, days),))
    return cur.rowcount


def parse_cursor(s: Optional[str]) -> Optional[tuple[str, int]]:
    """"<updated_at>|<id>" -> (updated_at, id); kosong/rusak -> None."""
    if not s or "|" not in s:
        return None
    ts, _, raw_id = s.rpartition("|")
    if not ts or not raw_id.isascii() or not raw_id.isdigit():
        return None
    try:
        datetime.fromisoformat(ts)
    except ValueError:
        return None
    return ts, int(raw_id)


def make_cursor(updated_at: str, cid: int) -> str:
    return f"{updated_at}|{cid}"


def cursor_expired(cursor: Optional[tuple[str, int]], now: str, days: int = TOMBSTONE_DAYS) -> bool:
    if cursor is None:
        return False
    return datetime.fromisoformat(cursor[0]) < datetime.fromisoformat(now) - timedelta(days=days)


def mention_usernames(body: str) -> set[str]:
    return {m.lower() for m in _MENTION_RE.findall(body or "")}


def serialize(row) -> dict:
    """Baris SELECT_COLS -> bentuk API. Tombstone (deleted_at terisi) dikosongkan body-nya."""
    r = dict(row)
    return {
        "id": r["id"], "note_id": r["note_id"], "list_id": r["list_id"], "parent_id": r["parent_id"],
        "user_id": r["user_id"], "username": r.get("author_username"), "display_name": r.get("author_display"),
        "body": "" if r["deleted_at"] else r["body"], "quote": r["quote"],
        "resolved_at": r["resolved_at"], "resolved_by": r["resolved_by"],
        "resolved_by_name": r.get("resolver_name"), "edited_at": r["edited_at"], "deleted_at": r["deleted_at"],
        "client_id": r["client_id"], "created_at": r["created_at"], "updated_at": r["updated_at"],
    }
