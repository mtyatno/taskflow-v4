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


def test_task_attachment_auto_sync_to_workspace_files(client):
    owner = U(client, prefix="owner_att")
    member = U(client, prefix="member_att")
    list_id = _mk_list(owner, member, name="Attachment Sync List")

    # Create task inside workspace
    r_task = member.post("/api/tasks", json={"title": "FAT Commissioning Task", "list_id": list_id})
    assert r_task.status_code == 200, r_task.text
    task_id = r_task.json()["id"]

    # Upload attachment to task
    fat_bytes = b"FAT Report content for testing"
    r_upload = member.post(
        f"/api/tasks/{task_id}/attachments",
        files={"file": ("FAT_Report.pdf", io.BytesIO(fat_bytes), "application/pdf")}
    )
    assert r_upload.status_code == 200, r_upload.text

    # Verify it automatically appeared in workspace files
    r_files = member.get(f"/api/lists/{list_id}/files")
    assert r_files.status_code == 200, r_files.text
    files = r_files.json()
    fat_file = next((f for f in files if f["original_name"] == "FAT_Report.pdf"), None)
    assert fat_file is not None
    assert fat_file["source"] == "task"
    assert fat_file["task_id"] == task_id
    assert fat_file["file_size"] == len(fat_bytes)
    assert fat_file["task_title"] == "FAT Commissioning Task"

    # Also test task WITHOUT list_id (personal task) does NOT sync to workspace_files
    r_personal_task = member.post("/api/tasks", json={"title": "Personal Task"})
    assert r_personal_task.status_code == 200
    p_task_id = r_personal_task.json()["id"]
    r_p_upload = member.post(
        f"/api/tasks/{p_task_id}/attachments",
        files={"file": ("Personal.pdf", io.BytesIO(b"personal"), "application/pdf")}
    )
    assert r_p_upload.status_code == 200
    r_files2 = member.get(f"/api/lists/{list_id}/files")
    p_file = next((f for f in r_files2.json() if f["original_name"] == "Personal.pdf"), None)
    assert p_file is None


def test_chat_message_with_file_attachment(client):
    owner = U(client, prefix="owner_chat")
    member = U(client, prefix="member_chat")
    other_list_owner = U(client, prefix="other_owner")
    list_id = _mk_list(owner, member, name="Chat File List")
    other_list_id = _mk_list(other_list_owner, name="Other List")

    # Upload a file first
    doc_bytes = b"Doc1 content for chat"
    r_file = member.post(
        f"/api/lists/{list_id}/files",
        files={"file": ("Doc1.pdf", io.BytesIO(doc_bytes), "application/pdf")},
        data={"source": "chat"}
    )
    assert r_file.status_code == 201, r_file.text
    file_id = r_file.json()["id"]

    # 1. Post message with invalid file_id (not found -> 400)
    r_bad = member.post(
        f"/api/lists/{list_id}/messages",
        json={"content": "File tidak ada", "file_id": 999999, "msg_type": "file_attach"}
    )
    assert r_bad.status_code == 400

    # 2. File from another list cannot be attached (400)
    r_other_file = other_list_owner.post(
        f"/api/lists/{other_list_id}/files",
        files={"file": ("OtherList.pdf", io.BytesIO(b"other"), "application/pdf")},
        data={"source": "chat"}
    )
    assert r_other_file.status_code == 201
    other_file_id = r_other_file.json()["id"]
    r_cross = member.post(
        f"/api/lists/{list_id}/messages",
        json={"content": "File list lain", "file_id": other_file_id, "msg_type": "file_attach"}
    )
    assert r_cross.status_code == 400

    # 3. Post message with valid file_id
    r_msg = member.post(
        f"/api/lists/{list_id}/messages",
        json={
            "content": "Ini dokumen penting",
            "file_id": file_id,
            "msg_type": "file_attach"
        }
    )
    assert r_msg.status_code == 200, r_msg.text
    msg = r_msg.json()
    assert msg["file_id"] == file_id
    assert msg["file_original_name"] == "Doc1.pdf"
    assert msg["file_size"] == len(doc_bytes)
    assert msg["file_mime_type"] == "application/pdf"
    assert msg["file_is_deleted"] == 0

    # 4. Verify get_messages includes joined file fields
    r_get = member.get(f"/api/lists/{list_id}/messages")
    assert r_get.status_code == 200
    msgs = r_get.json()
    chat_msg = next((m for m in msgs if m["id"] == msg["id"]), None)
    assert chat_msg is not None
    assert chat_msg["file_id"] == file_id
    assert chat_msg["file_original_name"] == "Doc1.pdf"
    assert chat_msg["file_size"] == len(doc_bytes)
    assert chat_msg["file_mime_type"] == "application/pdf"
    assert chat_msg["file_is_deleted"] == 0

    # 5. When file is deleted, chat message still shows file_id but file_is_deleted == 1
    r_del = member.delete(f"/api/lists/{list_id}/files/{file_id}")
    assert r_del.status_code == 200

    r_get_after = member.get(f"/api/lists/{list_id}/messages")
    assert r_get_after.status_code == 200
    chat_msg_after = next((m for m in r_get_after.json() if m["id"] == msg["id"]), None)
    assert chat_msg_after is not None
    assert chat_msg_after["file_id"] == file_id
    assert chat_msg_after["file_is_deleted"] == 1

    # 6. Attaching a deleted file should be rejected with 400
    r_post_del = member.post(
        f"/api/lists/{list_id}/messages",
        json={"content": "Coba lampirkan deleted file", "file_id": file_id, "msg_type": "file_attach"}
    )
    assert r_post_del.status_code == 400



