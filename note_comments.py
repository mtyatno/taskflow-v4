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
    # Perbandingan string di SQL aman karena semua timestamp tersimpan berformat sama (offset +07:00).
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
        parsed = datetime.fromisoformat(ts)
    except ValueError:
        return None
    if parsed.tzinfo is None:  # kursor tanpa offset akan membuat cursor_expired TypeError
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
    """Baris SELECT_COLS -> bentuk API. Tombstone (deleted_at terisi) dikosongkan body dan quote-nya."""
    r = dict(row)
    return {
        "id": r["id"], "note_id": r["note_id"], "list_id": r["list_id"], "parent_id": r["parent_id"],
        "user_id": r["user_id"], "username": r.get("author_username"), "display_name": r.get("author_display"),
        "body": "" if r["deleted_at"] else r["body"], "quote": None if r["deleted_at"] else r["quote"],
        "resolved_at": r["resolved_at"], "resolved_by": r["resolved_by"],
        "resolved_by_name": r.get("resolver_name"), "edited_at": r["edited_at"], "deleted_at": r["deleted_at"],
        "client_id": r["client_id"], "created_at": r["created_at"], "updated_at": r["updated_at"],
    }


def visible_note(conn, uid: int, note_id: int):
    """Note di scratchpad_notes yang boleh diakses uid (pemilik, atau pemilik/anggota workspace note). Sampah -> None."""
    return conn.execute(
        "SELECT id, user_id, list_id, title FROM scratchpad_notes WHERE id = ? AND (user_id = ? OR list_id IN ("
        "SELECT id FROM shared_lists WHERE owner_id = ? UNION SELECT list_id FROM list_members WHERE user_id = ?))",
        (note_id, uid, uid, uid)).fetchone()


def visible_clause(uid: int) -> tuple[str, list]:
    """Fragmen WHERE untuk alias c + `JOIN scratchpad_notes n ON n.id = c.note_id`."""
    return (
        "n.list_id IS NOT NULL AND n.list_id = c.list_id AND (n.user_id = ? OR n.list_id IN ("
        "SELECT id FROM shared_lists WHERE owner_id = ? UNION SELECT list_id FROM list_members WHERE user_id = ?))",
        [uid, uid, uid])


def get_visible(conn, uid: int, comment_id: int):
    """Komentar (termasuk tombstone) beserta n_user_id/n_title note-nya bila uid boleh melihatnya."""
    where, params = visible_clause(uid)
    return conn.execute(
        f"SELECT {SELECT_COLS}, n.user_id AS note_owner_id, n.title AS note_title {FROM_JOINS} "
        f"JOIN scratchpad_notes n ON n.id = c.note_id WHERE c.id = ? AND {where}",
        [comment_id] + params).fetchone()


def delete_for_notes(conn, note_ids: list[int]) -> None:
    """Hapus komentar + penanda baca untuk note yang dihapus permanen. Pemanggil yang commit."""
    ids = list(note_ids)
    for i in range(0, len(ids), 500):
        chunk = ids[i:i + 500]
        marks = ",".join("?" * len(chunk))
        conn.execute(f"DELETE FROM note_comments WHERE note_id IN ({marks})", chunk)
        conn.execute(f"DELETE FROM note_comment_reads WHERE note_id IN ({marks})", chunk)


def touch_for_note(conn, note_id: int, list_id: Optional[int], now: str) -> int:
    """Bump updated_at komentar note yang kembali terlihat (restore/share ulang) agar delta pull
    perangkat dengan kursor lebih baru tetap menerimanya. No-op bila list_id None. Pemanggil yang commit."""
    if list_id is None:
        return 0
    return conn.execute(
        "UPDATE note_comments SET updated_at = ? WHERE note_id = ? AND list_id = ?",
        (now, note_id, list_id)).rowcount


def summaries(conn, uid: int, note_ids: list[int]) -> dict[int, dict]:
    """Ringkasan per note untuk uid: {note_id: {"comment_open_count", "comment_unread"}}.
    Satu query agregat per chunk 500 id; note tanpa komentar terlihat tidak ada di hasil."""
    out: dict[int, dict] = {}
    ids = list(note_ids)
    where, vparams = visible_clause(uid)
    for i in range(0, len(ids), 500):
        chunk = ids[i:i + 500]
        marks = ",".join("?" * len(chunk))
        rows = conn.execute(
            "SELECT c.note_id AS note_id, "
            "SUM(CASE WHEN c.parent_id IS NULL AND c.deleted_at IS NULL AND c.resolved_at IS NULL THEN 1 ELSE 0 END) AS open_count, "
            "MAX(CASE WHEN c.deleted_at IS NULL AND c.user_id != ? AND c.created_at > COALESCE(r.last_read_at, '') "
            "THEN 1 ELSE 0 END) AS unread "
            "FROM note_comments c JOIN scratchpad_notes n ON n.id = c.note_id "
            "LEFT JOIN note_comment_reads r ON r.note_id = c.note_id AND r.user_id = ? "
            f"WHERE c.note_id IN ({marks}) AND {where} GROUP BY c.note_id",
            [uid, uid] + chunk + vparams).fetchall()
        for r in rows:
            out[r["note_id"]] = {"comment_open_count": r["open_count"] or 0, "comment_unread": bool(r["unread"])}
    return out


def apply_summaries(conn, uid: int, rows: list[dict]) -> list[dict]:
    """Isi comment_open_count/comment_unread (default 0/False) pada daftar dict note, in place."""
    summ = summaries(conn, uid, [r["id"] for r in rows])
    for r in rows:
        r.update(summ.get(r["id"], {"comment_open_count": 0, "comment_unread": False}))
    return rows


def mark_read(conn, uid: int, note_id: int, now: str) -> None:
    """Upsert penanda baca. Pemanggil yang commit."""
    conn.execute(
        "INSERT INTO note_comment_reads (user_id, note_id, last_read_at) VALUES (?, ?, ?) "
        "ON CONFLICT(user_id, note_id) DO UPDATE SET last_read_at = excluded.last_read_at",
        (uid, note_id, now))


# ── Notifikasi (spec §5.1–5.2) ─────────────────────────────────────────────────

_PRIORITY = {"mention": 3, "comment": 2, "reply": 2, "resolve": 1}
_SNIPPET_LEN = 80


def _eligible_ids(conn, note) -> set[int]:
    """Pemilik note + pemilik/anggota workspace note saat ini."""
    ids = {note["user_id"]}
    if note["list_id"] is not None:
        r = conn.execute("SELECT owner_id FROM shared_lists WHERE id = ?", (note["list_id"],)).fetchone()
        if r:
            ids.add(r["owner_id"])
        ids.update(m["user_id"] for m in conn.execute(
            "SELECT user_id FROM list_members WHERE list_id = ?", (note["list_id"],)).fetchall())
    return ids


def recipients(conn, *, note, comment, actor_uid: int, event: str) -> dict[int, str]:
    """{user_id: kind} penerima notifikasi; kind: mention | comment | reply | resolve. Aktor tidak pernah termasuk."""
    found: dict[int, str] = {}

    def add(uid: int, kind: str) -> None:
        if found.get(uid, "") == "" or _PRIORITY[kind] > _PRIORITY[found[uid]]:
            found[uid] = kind

    if event == "resolve":
        add(comment["user_id"], "resolve")
    elif event == "create":
        names = mention_usernames(comment["body"])
        if names:
            marks = ",".join("?" * len(names))
            for r in conn.execute(f"SELECT id FROM users WHERE lower(username) IN ({marks})", sorted(names)).fetchall():
                add(r["id"], "mention")
        if comment["parent_id"] is None:
            add(note["user_id"], "comment")
        else:
            add(conn.execute("SELECT user_id FROM note_comments WHERE id = ?", (comment["parent_id"],)).fetchone()["user_id"], "reply")
            for r in conn.execute(
                    "SELECT DISTINCT user_id FROM note_comments WHERE parent_id = ? AND deleted_at IS NULL",
                    (comment["parent_id"],)).fetchall():
                add(r["user_id"], "reply")
    else:
        raise ValueError(event)
    eligible = _eligible_ids(conn, note)
    return {u: k for u, k in found.items() if u != actor_uid and u in eligible}


def message(kind: str, actor_name: str, title: str, body: str, esc) -> str:
    """Teks notifikasi (HTML aman). `esc` = escape pesan; isi dipotong 80 karakter mentah sebelum di-escape."""
    nama = esc(actor_name)
    judul = esc((title or "").strip() or "Tanpa judul")
    isi = esc(body[:_SNIPPET_LEN] + ("…" if len(body) > _SNIPPET_LEN else ""))
    if kind == "mention":
        return f'{nama} menyebutmu di {judul}: "{isi}"'
    if kind == "comment":
        return f'{nama} mengomentari catatanmu {judul}: "{isi}"'
    if kind == "reply":
        return f'{nama} membalas komentar di {judul}: "{isi}"'
    if kind == "resolve":
        return f"{nama} menyelesaikan komentarmu di {judul}"
    raise ValueError(kind)
