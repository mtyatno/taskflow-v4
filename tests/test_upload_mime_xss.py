"""XSS lampiran task / file workspace: mime_type klien hanya disimpan bila ada di allowlist aman; text/html,
image/svg+xml, dll. disimpan (dan disajikan) sebagai application/octet-stream, unduhan tetap attachment."""
import io

import pytest

from conftest import db
from test_workspace_files import U, _mk_list

UNSAFE = [
    ("evil.pdf", "text/html", b"<script>window.__xss=1</script>"),
    ("evil.svg", "image/svg+xml", b"<svg onload=window.__xss=1></svg>"),
    ("evil.xhtml", "application/xhtml+xml", b"<html/>"),
    ("evil.xml", "text/xml", b"<x/>"),
    ("evil.xml", "application/xml", b"<x/>"),
    ("evil.js", "application/javascript", b"x"),
    ("evil.png", "TEXT/HTML; charset=utf-8", b"x"),
]


def _stored_mime(table, filename):
    conn = db()
    try:
        return conn.execute(f"SELECT mime_type FROM {table} WHERE filename = ?", (filename,)).fetchone()["mime_type"]
    finally:
        conn.close()


@pytest.mark.parametrize("name,ctype,body", UNSAFE)
def test_workspace_upload_unsafe_mime_stored_as_octet_stream(client, name, ctype, body):
    owner = U(client, prefix="mimeown")
    list_id = _mk_list(owner, name="Mime WS")
    r = owner.post(f"/api/lists/{list_id}/files", files={"file": (name, io.BytesIO(body), ctype)},
                   data={"source": "direct"})
    assert r.status_code == 201, r.text
    assert r.json()["mime_type"] == "application/octet-stream"
    assert _stored_mime("workspace_files", r.json()["filename"]) == "application/octet-stream"
    d = owner.get(f"/api/lists/{list_id}/files/{r.json()['id']}/download")
    assert d.status_code == 200
    assert d.headers["content-type"].startswith("application/octet-stream")
    assert d.headers["content-disposition"].startswith("attachment")
    assert d.headers["x-content-type-options"] == "nosniff"


@pytest.mark.parametrize("name,ctype,body", UNSAFE)
def test_task_attachment_unsafe_mime_stored_as_octet_stream(client, name, ctype, body):
    owner = U(client, prefix="mimetask")
    list_id = _mk_list(owner, name="Mime Task WS")
    task_id = owner.post("/api/tasks", json={"title": "T", "list_id": list_id}).json()["id"]
    r = owner.post(f"/api/tasks/{task_id}/attachments", files={"file": (name, io.BytesIO(body), ctype)})
    assert r.status_code == 200, r.text
    stored = r.json()["filename"]
    assert _stored_mime("task_attachments", stored) == "application/octet-stream"
    assert _stored_mime("workspace_files", stored) == "application/octet-stream"
    d = owner.get(f"/api/attachments/{r.json()['id']}/download")
    assert d.status_code == 200
    assert d.headers["content-type"].startswith("application/octet-stream")
    assert d.headers["content-disposition"].startswith("attachment")


def test_safe_mimes_kept(client):
    owner = U(client, prefix="mimesafe")
    list_id = _mk_list(owner, name="Mime Safe WS")
    for name, ctype in [("a.png", "image/png"), ("a.pdf", "application/pdf"), ("a.txt", "text/plain"),
                        ("a.zip", "application/zip"),
                        ("a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")]:
        r = owner.post(f"/api/lists/{list_id}/files", files={"file": (name, io.BytesIO(b"x"), ctype)},
                       data={"source": "direct"})
        assert r.status_code == 201, r.text
        assert r.json()["mime_type"] == ctype
    task_id = owner.post("/api/tasks", json={"title": "T", "list_id": list_id}).json()["id"]
    r = owner.post(f"/api/tasks/{task_id}/attachments", files={"file": ("p.png", io.BytesIO(b"x"), "image/png")})
    assert _stored_mime("task_attachments", r.json()["filename"]) == "image/png"
    d = owner.get(f"/api/attachments/{r.json()['id']}/download")
    assert d.headers["content-type"] == "image/png"


def test_legacy_unsafe_row_served_as_octet_stream(client):
    owner = U(client, prefix="mimelegacy")
    list_id = _mk_list(owner, name="Mime Legacy WS")
    r = owner.post(f"/api/lists/{list_id}/files", files={"file": ("x.pdf", io.BytesIO(b"<b>x</b>"), "application/pdf")},
                   data={"source": "direct"})
    conn = db()
    try:
        conn.execute("UPDATE workspace_files SET mime_type = 'text/html' WHERE id = ?", (r.json()["id"],))
        conn.commit()
    finally:
        conn.close()
    d = owner.get(f"/api/lists/{list_id}/files/{r.json()['id']}/download")
    assert d.headers["content-type"].startswith("application/octet-stream")
