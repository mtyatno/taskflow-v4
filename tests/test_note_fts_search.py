"""
Tests for SQLite FTS5 search & tag operators.
"""
import sqlite3
import pytest
from webapp import migrate_db
from config import DB_PATH


def test_fts5_virtual_table_and_triggers_exist():
    migrate_db()
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        # Check FTS5 table
        tbl = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='scratchpad_notes_fts'"
        ).fetchone()
        assert tbl is not None, "scratchpad_notes_fts table must exist"

        # Check triggers
        triggers = {
            r["name"] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='scratchpad_notes'"
            ).fetchall()
        }
        assert "trg_scratchpad_notes_ai" in triggers
        assert "trg_scratchpad_notes_ad" in triggers
        assert "trg_scratchpad_notes_au" in triggers
