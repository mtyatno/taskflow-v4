import pytest
import sqlite3
import os
import tempfile
from webapp import DB_PATH, migrate_db


def test_workspace_files_table_and_columns():
    migrate_db()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        # Check workspace_files table columns
        cols = {r["name"]: r["type"].upper() for r in conn.execute("PRAGMA table_info(workspace_files)").fetchall()}
        assert "id" in cols
        assert "list_id" in cols
        assert "user_id" in cols
        assert "filename" in cols
        assert "original_name" in cols
        assert "file_size" in cols
        assert "mime_type" in cols
        assert "source" in cols
        assert "task_id" in cols
        assert "is_deleted" in cols
        assert "created_at" in cols

        # Check messages table file_id column
        msg_cols = [r["name"] for r in conn.execute("PRAGMA table_info(messages)").fetchall()]
        assert "file_id" in msg_cols
    finally:
        conn.close()


def test_workspace_files_migration_is_idempotent():
    # Calling migrate_db multiple times must not fail or corrupt schema
    migrate_db()
    migrate_db()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        cols = {r["name"]: r["type"].upper() for r in conn.execute("PRAGMA table_info(workspace_files)").fetchall()}
        assert "id" in cols
        msg_cols = [r["name"] for r in conn.execute("PRAGMA table_info(messages)").fetchall()]
        assert "file_id" in msg_cols
    finally:
        conn.close()
