"""Tes server Petakan (catatan <-> mindmap tertaut), Bagian B.

Spec: docs/superpowers/specs/2026-10-18-petakan-note-mindmap-design.md
"""
import sqlite3

import pytest

import webapp
from conftest import db


def test_migration_adds_source_note_id_and_unique_index():
    webapp.migrate_db(); webapp.migrate_db()  # idempoten
    conn = db()
    cols = [r["name"] for r in conn.execute("PRAGMA table_info(mindmaps)")]
    assert "source_note_id" in cols
    idx = {r["name"]: r["unique"] for r in conn.execute("PRAGMA index_list(mindmaps)")}
    assert idx.get("ux_mindmaps_source_note") == 1
    conn.execute("INSERT INTO mindmaps (user_id,title,created_at,updated_at,source_note_id) VALUES (1,'a','x','x',424242)")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO mindmaps (user_id,title,created_at,updated_at,source_note_id) VALUES (1,'b','x','x',424242)")
    conn.rollback(); conn.close()
