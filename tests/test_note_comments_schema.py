from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import note_comments
import webapp
from conftest import db

JKT = ZoneInfo("Asia/Jakarta")


def _tables(conn):
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def test_schema_idempotent():
    conn = db()
    try:
        note_comments.ensure_note_comments_schema(conn)
        note_comments.ensure_note_comments_schema(conn)
        conn.commit()
        assert {"note_comments", "note_comment_reads"} <= _tables(conn)
        assert "note_id" in {r[1] for r in conn.execute("PRAGMA table_info(notifications)")}
        idx = [r for r in conn.execute("PRAGMA index_list(note_comments)") if r[1] == "idx_note_comments_client"]
        assert idx and idx[0][2] == 1  # unik
    finally:
        conn.close()


def test_migrate_db_creates_tables():
    webapp.migrate_db()
    conn = db()
    try:
        assert {"note_comments", "note_comment_reads"} <= _tables(conn)
    finally:
        conn.close()


def test_cursor_roundtrip():
    c = note_comments.make_cursor("2026-10-21T05:00:00+07:00", 7)
    assert note_comments.parse_cursor(c) == ("2026-10-21T05:00:00+07:00", 7)
    assert note_comments.parse_cursor(None) is None
    assert note_comments.parse_cursor("") is None
    assert note_comments.parse_cursor("x") is None
    assert note_comments.parse_cursor("a|b") is None


def test_cursor_expired():
    now = datetime(2026, 10, 21, 12, 0, tzinfo=JKT)
    old = (now - timedelta(days=31)).isoformat()
    fresh = (now - timedelta(days=29)).isoformat()
    assert note_comments.cursor_expired((old, 1), now.isoformat()) is True
    assert note_comments.cursor_expired((fresh, 1), now.isoformat()) is False
    assert note_comments.cursor_expired(None, now.isoformat()) is False


def test_mention_usernames():
    assert note_comments.mention_usernames("hai @Rina dan @budi_2, @rina lagi") == {"rina", "budi_2"}
    assert note_comments.mention_usernames("tanpa mention") == set()


def test_purge_old_tombstones():
    now = datetime.now(JKT)
    conn = db()
    try:
        note_comments.ensure_note_comments_schema(conn)
        conn.execute("DELETE FROM note_comments")
        ts = now.isoformat()
        for deleted in ((now - timedelta(days=40)).isoformat(), (now - timedelta(days=5)).isoformat(), None):
            conn.execute(
                "INSERT INTO note_comments (note_id, list_id, user_id, body, deleted_at, created_at, updated_at) "
                "VALUES (1, 1, 1, 'x', ?, ?, ?)", (deleted, ts, ts))
        assert note_comments.purge_old_tombstones(conn, ts) == 1
        assert conn.execute("SELECT COUNT(*) FROM note_comments").fetchone()[0] == 2
        conn.execute("DELETE FROM note_comments")
        conn.commit()
    finally:
        conn.close()


def test_serialize_and_select_cols():
    base = {"id": 3, "note_id": 1, "list_id": 2, "parent_id": None, "user_id": 4, "body": "halo", "quote": None,
            "resolved_at": None, "resolved_by": None, "edited_at": None, "deleted_at": None, "client_id": "c",
            "created_at": "a", "updated_at": "b", "author_username": "rina", "author_display": "Rina",
            "resolver_name": None}
    out = note_comments.serialize(base)
    assert list(out) == ["id", "note_id", "list_id", "parent_id", "user_id", "username", "display_name", "body",
                         "quote", "resolved_at", "resolved_by", "resolved_by_name", "edited_at", "deleted_at",
                         "client_id", "created_at", "updated_at"]
    assert out["username"] == "rina" and out["display_name"] == "Rina" and out["body"] == "halo"
    assert note_comments.serialize({**base, "deleted_at": "t"})["body"] == ""
    conn = db()
    try:
        note_comments.ensure_note_comments_schema(conn)
        conn.execute(f"SELECT {note_comments.SELECT_COLS} {note_comments.FROM_JOINS} LIMIT 1").fetchall()
    finally:
        conn.close()
