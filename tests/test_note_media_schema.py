import sqlite3

import pytest

import webapp
from conftest import db


def test_note_attachments_media_columns():
    cols = {r["name"]: r for r in db().execute("PRAGMA table_info(note_attachments)")}
    for c in ["kind", "client_id", "storage", "storage_key", "status", "media_type", "duration_ms",
              "video_codec", "audio_codec", "width", "height", "poster_key", "received_bytes",
              "error", "updated_at"]:
        assert c in cols
    assert cols["kind"]["dflt_value"] == "'file'" and cols["storage"]["dflt_value"] == "'nextcloud'"
    assert cols["status"]["dflt_value"] == "'ready'" and cols["received_bytes"]["dflt_value"] == "0"


def test_migrate_db_idempotent():
    webapp.migrate_db()
    webapp.migrate_db()


def test_client_id_unique_per_user():
    conn = db()
    try:
        conn.execute("PRAGMA foreign_keys=OFF")
        ins = ("INSERT INTO note_attachments (note_id, user_id, nextcloud_path, original_name, file_size, "
               "mime_type, client_id) VALUES (1, ?, '', 'a.mp3', 1, 'audio/mpeg', ?)")
        conn.execute(ins, (901, "cid-1"))
        conn.execute(ins, (902, "cid-1"))  # user lain boleh
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(ins, (901, "cid-1"))
        conn.execute(ins, (901, None))
        conn.execute(ins, (901, None))  # NULL boleh berulang
    finally:
        conn.rollback()
        conn.close()


def test_media_secret_derived_when_unset():
    assert isinstance(webapp.MEDIA_URL_SECRET_BYTES, bytes) and len(webapp.MEDIA_URL_SECRET_BYTES) == 32


def test_media_constants():
    assert webapp.MEDIA_MAX_FILE_BYTES == 2048 * 1024 * 1024
    assert webapp.MEDIA_CHUNK_BYTES == 5 * 1024 * 1024
    assert webapp.MEDIA_ACCEL is False
    assert webapp.MEDIA_URL_TTL_SEC == 21600 and webapp.MEDIA_STUCK_HOURS == 24
