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


import io
import uuid
from conftest import db, register_user, client


class U:
    def __init__(self, client, prefix="user"):
        name = f"{prefix}_{uuid.uuid4().hex[:8]}"
        info = register_user(client, name, f"{name}@test.id")
        self.client = client
        self.id = info["user_id"]
        self.username = info["username"]
        self.token = info["token"]
        self.h = {"Authorization": f"Bearer {info['token']}"}

    def _call(self, method, url, **kw):
        self.client.cookies.clear()
        headers = dict(self.h)
        if "headers" in kw:
            headers.update(kw.pop("headers"))
        return getattr(self.client, method)(url, headers=headers, **kw)

    def get(self, url, **kw): return self._call("get", url, **kw)
    def post(self, url, **kw): return self._call("post", url, **kw)
    def delete(self, url, **kw): return self._call("delete", url, **kw)


def _mk_list(owner, *members, name="Workspace Files Test"):
    r = owner.post("/api/lists", json={"name": name})
    assert r.status_code == 200, r.text
    list_id = r.json()["id"]
    conn = db()
    try:
        for m in members:
            conn.execute(
                "INSERT INTO list_members (list_id, user_id, joined_at) VALUES (?,?,datetime('now'))",
                (list_id, m.id),
            )
        conn.commit()
    finally:
        conn.close()
    return list_id


def test_workspace_files_crud_and_permissions(client):
    owner = U(client, prefix="owner")
    member = U(client, prefix="member")
    other_member = U(client, prefix="other")
    outsider = U(client, prefix="outsider")

    list_id = _mk_list(owner, member, other_member)

    # 1. Outsider cannot list or upload
    r = outsider.get(f"/api/lists/{list_id}/files")
    assert r.status_code == 403

    r = outsider.post(
        f"/api/lists/{list_id}/files",
        files={"file": ("hacked.txt", io.BytesIO(b"hack"), "text/plain")},
        data={"source": "direct"},
    )
    assert r.status_code == 403

    # 2. Member uploads file
    content_pdf = b"%PDF-1.4 Mock PDF file for testing workspace files"
    r = member.post(
        f"/api/lists/{list_id}/files",
        files={"file": ("SOP_Commissioning.pdf", io.BytesIO(content_pdf), "application/pdf")},
        data={"source": "direct"},
    )
    assert r.status_code == 201, r.text
    file_data = r.json()
    assert file_data["original_name"] == "SOP_Commissioning.pdf"
    assert file_data["file_size"] == len(content_pdf)
    assert file_data["mime_type"] == "application/pdf"
    assert file_data["source"] == "direct"
    assert file_data["uploader_name"] == member.username
    file_id = file_data["id"]

    # 3. List files shows uploaded file
    r = member.get(f"/api/lists/{list_id}/files")
    assert r.status_code == 200
    files = r.json()
    assert len(files) == 1
    assert files[0]["id"] == file_id
    assert files[0]["original_name"] == "SOP_Commissioning.pdf"
    assert files[0]["uploader_name"] == member.username

    # Search & type filtering
    r_search = member.get(f"/api/lists/{list_id}/files?q=Commissioning")
    assert r_search.status_code == 200
    assert len(r_search.json()) == 1

    r_empty = member.get(f"/api/lists/{list_id}/files?q=NonExistentFile")
    assert r_empty.status_code == 200
    assert len(r_empty.json()) == 0

    r_type_pdf = member.get(f"/api/lists/{list_id}/files?type=pdf")
    assert r_type_pdf.status_code == 200
    assert len(r_type_pdf.json()) == 1

    r_type_img = member.get(f"/api/lists/{list_id}/files?type=image")
    assert r_type_img.status_code == 200
    assert len(r_type_img.json()) == 0

    # 4. Download file
    # 4a. Authenticated download via Bearer token (owner)
    r_dl = owner.get(f"/api/lists/{list_id}/files/{file_id}/download")
    assert r_dl.status_code == 200
    assert r_dl.content == content_pdf
    assert "SOP_Commissioning.pdf" in r_dl.headers.get("content-disposition", "")

    # 4b. Authenticated download via query token
    client.cookies.clear()
    r_dl_query = client.get(f"/api/lists/{list_id}/files/{file_id}/download?token={member.token}")
    assert r_dl_query.status_code == 200
    assert r_dl_query.content == content_pdf

    # 4c. Outsider download rejected (403)
    r_dl_out = outsider.get(f"/api/lists/{list_id}/files/{file_id}/download")
    assert r_dl_out.status_code == 403

    # 5. Permission check on delete
    # 5a. Non-uploader member cannot delete (403)
    r_del_denied = other_member.delete(f"/api/lists/{list_id}/files/{file_id}")
    assert r_del_denied.status_code == 403

    # 5b. Outsider cannot delete (403)
    r_del_out = outsider.delete(f"/api/lists/{list_id}/files/{file_id}")
    assert r_del_out.status_code == 403

    # 6. Upload a second file to test workspace owner delete capability
    content_txt = b"Hello from second file"
    r2 = member.post(
        f"/api/lists/{list_id}/files",
        files={"file": ("notes.txt", io.BytesIO(content_txt), "text/plain")},
        data={"source": "direct"},
    )
    assert r2.status_code == 201
    file2_id = r2.json()["id"]

    # Owner deletes file 2 (even though member uploaded it)
    r_del_owner = owner.delete(f"/api/lists/{list_id}/files/{file2_id}")
    assert r_del_owner.status_code == 200
    assert r_del_owner.json()["success"] is True

    # 7. Uploader deletes file 1
    r_del_uploader = member.delete(f"/api/lists/{list_id}/files/{file_id}")
    assert r_del_uploader.status_code == 200
    assert r_del_uploader.json()["success"] is True

    # 8. Deleted files no longer returned in active list
    r_active = member.get(f"/api/lists/{list_id}/files")
    assert r_active.status_code == 200
    assert len(r_active.json()) == 0

    # 9. Download of deleted file returns 404
    r_dl_deleted = owner.get(f"/api/lists/{list_id}/files/{file_id}/download")
    assert r_dl_deleted.status_code == 404


def test_workspace_files_edge_cases(client, monkeypatch):
    owner = U(client, prefix="edge_owner")
    member = U(client, prefix="edge_member")
    list_id = _mk_list(owner, member)

    # 1. Invalid task_id returns 400
    r_bad_task = member.post(
        f"/api/lists/{list_id}/files",
        files={"file": ("test.txt", io.BytesIO(b"data"), "text/plain")},
        data={"source": "direct", "task_id": 999999},
    )
    assert r_bad_task.status_code == 400

    # 2. Oversized file returns 413
    import config
    monkeypatch.setattr(config, "MAX_FILE_SIZE", 100)
    import webapp
    monkeypatch.setattr(webapp, "MAX_FILE_SIZE", 100)

    large_content = b"x" * 200
    r_too_large = member.post(
        f"/api/lists/{list_id}/files",
        files={"file": ("large.dat", io.BytesIO(large_content), "application/octet-stream")},
        data={"source": "direct"},
    )
    assert r_too_large.status_code == 413

    # Reset MAX_FILE_SIZE for subsequent operations
    monkeypatch.undo()

    # 3. Download non-existent file returns 404
    r_dl_none = member.get(f"/api/lists/{list_id}/files/999999/download")
    assert r_dl_none.status_code == 404

    # 4. Delete non-existent file returns 404
    r_del_none = member.delete(f"/api/lists/{list_id}/files/999999")
    assert r_del_none.status_code == 404


