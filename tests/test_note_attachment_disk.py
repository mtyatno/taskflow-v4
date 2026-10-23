"""Lampiran note baru (📎 gambar/PDF) disimpan di disk VPS (UPLOAD_DIR), sama seperti file workspace — Nextcloud keluar
dari jalur unggah. Lampiran lama (storage='nextcloud') tetap dibaca/dihapus lewat Nextcloud."""
import io
import os
import uuid
import zipfile
from types import SimpleNamespace

import pytest
import requests

import webapp
from conftest import db, register_user

def _png():
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (24, 12), (40, 160, 220)).save(buf, "PNG")
    return buf.getvalue()


PNG = _png()


class _Resp(SimpleNamespace):
    def iter_content(self, chunk_size=8192):
        yield self.content

    def close(self):
        pass


@pytest.fixture
def nc(monkeypatch):
    """Nextcloud palsu: mencatat panggilan; GET mengembalikan isi 'legacy'."""
    calls = {"put": [], "mkcol": [], "get": [], "delete": []}

    def fput(url, **kw):
        calls["put"].append(url)
        return _Resp(status_code=201)

    def freq(method, url, **kw):
        calls["mkcol"].append(url)
        return _Resp(status_code=201)

    def fget(url, **kw):
        calls["get"].append(url)
        return _Resp(status_code=200, content=b"LEGACY-NC")

    def fdel(url, **kw):
        calls["delete"].append(url)
        return _Resp(status_code=204)

    monkeypatch.setattr(requests, "put", fput)
    monkeypatch.setattr(requests, "request", freq)
    monkeypatch.setattr(requests, "get", fget)
    monkeypatch.setattr(requests, "delete", fdel)
    return calls


@pytest.fixture
def owner(client):
    u = "ndisk" + uuid.uuid4().hex[:8]
    tok = register_user(client, u, u + "@ex.com")["token"]
    h = {"Authorization": "Bearer " + tok}
    note = client.post("/api/scratchpad", headers=h,
                       json={"title": "N", "content": "x", "tags": [], "client_id": str(uuid.uuid4())}).json()
    return {"h": h, "note": note["id"], "uid": note["user_id"]}


def _upload(client, owner, name="foto liburan.png", data=PNG, mime="image/png"):
    r = client.post("/api/scratchpad/%d/attachments" % owner["note"], headers=owner["h"],
                    files={"file": (name, data, mime)})
    assert r.status_code == 200, r.text
    return r.json()


def _row(att_id):
    conn = db()
    try:
        return dict(conn.execute("SELECT * FROM note_attachments WHERE id=?", (att_id,)).fetchone())
    finally:
        conn.close()


def _path(row):
    return os.path.join(webapp.UPLOAD_DIR, row["storage_key"])


def test_upload_goes_to_disk_without_nextcloud(client, nc, owner):
    att = _upload(client, owner)
    row = _row(att["id"])
    assert nc["put"] == [] and nc["mkcol"] == [], "unggah baru tidak boleh menyentuh Nextcloud"
    assert row["storage"] == "upload" and row["nextcloud_path"] == ""
    assert row["storage_key"].endswith(".png") and "/" not in row["storage_key"]
    with open(_path(row), "rb") as fh:
        assert fh.read() == PNG
    # respons tetap berbentuk sama untuk frontend (id, original_name, mime_type)
    assert att["original_name"] == "foto liburan.png" and att["mime_type"] == "image/png"


def test_upload_works_when_nextcloud_unconfigured(client, monkeypatch, owner):
    monkeypatch.setattr(webapp, "NEXTCLOUD_URL", "")

    def boom(*a, **kw):
        raise AssertionError("Nextcloud dipanggil")
    for fn in ("put", "request", "get", "delete"):
        monkeypatch.setattr(requests, fn, boom)
    att = _upload(client, owner)
    r = client.get("/api/scratchpad/attachments/%d/view" % att["id"], headers=owner["h"])
    assert r.status_code == 200 and r.content == PNG


def test_view_serves_local_file_with_safe_headers(client, nc, owner):
    att = _upload(client, owner)
    r = client.get("/api/scratchpad/attachments/%d/view" % att["id"], headers=owner["h"])
    assert r.status_code == 200 and r.content == PNG
    assert r.headers["content-type"].startswith("image/png")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["content-disposition"].startswith("inline")
    assert nc["get"] == []


def test_view_missing_local_file_is_404(client, nc, owner):
    att = _upload(client, owner)
    os.remove(_path(_row(att["id"])))
    r = client.get("/api/scratchpad/attachments/%d/view" % att["id"], headers=owner["h"])
    assert r.status_code == 404


def test_extension_is_sanitized(client, nc, owner):
    att = _upload(client, owner, name="laporan.pdf?x=../../etc", data=b"%PDF-1.4\n", mime="application/pdf")
    key = _row(att["id"])["storage_key"]
    assert "/" not in key and ".." not in key and "?" not in key
    att2 = _upload(client, owner, name="tanpa-ekstensi", data=PNG)
    assert "." not in _row(att2["id"])["storage_key"]


def test_delete_removes_local_file(client, nc, owner):
    att = _upload(client, owner)
    path = _path(_row(att["id"]))
    r = client.delete("/api/scratchpad/attachments/%d" % att["id"], headers=owner["h"])
    assert r.status_code == 200
    assert not os.path.exists(path) and nc["delete"] == []


def test_legacy_nextcloud_rows_still_work(client, nc, owner):
    conn = db()
    cur = conn.execute(
        "INSERT INTO note_attachments (note_id, user_id, nextcloud_path, original_name, file_size, mime_type) "
        "VALUES (?,?,?,?,?,?)", (owner["note"], owner["uid"], "/TaskFlow/attachments/lama.png", "lama.png", 9,
                                 "image/png"))
    conn.commit()
    att_id = cur.lastrowid
    conn.close()
    r = client.get("/api/scratchpad/attachments/%d/view" % att_id, headers=owner["h"])
    assert r.status_code == 200 and r.content == b"LEGACY-NC" and len(nc["get"]) == 1
    r = client.delete("/api/scratchpad/attachments/%d" % att_id, headers=owner["h"])
    assert r.status_code == 200 and len(nc["delete"]) == 1


def test_published_note_serves_local_file(client, nc, owner):
    att = _upload(client, owner)
    r = client.post("/api/scratchpad/%d/publish" % owner["note"], headers=owner["h"], json={"password": None})
    assert r.status_code == 200, r.text
    r = client.get("/pub/attachments/%d" % att["id"])
    assert r.status_code == 200 and r.content == PNG and nc["get"] == []


def test_docx_export_embeds_local_image(client, nc, owner):
    att = _upload(client, owner)
    client.put("/api/scratchpad/%d" % owner["note"], headers=owner["h"],
               json={"title": "N", "content": "![foto](/api/scratchpad/attachments/%d/view)" % att["id"], "tags": []})
    path = [r.path for r in webapp.app.routes if getattr(r, "endpoint", None) is webapp.export_scratchpad_docx][0]
    r = client.get(path.replace("{note_id}", str(owner["note"])), headers=owner["h"])
    assert r.status_code == 200
    z = zipfile.ZipFile(io.BytesIO(r.content))
    media = [n for n in z.namelist() if n.startswith("word/media/")]
    assert media, "gambar lokal harus tertanam di DOCX"
    assert nc["get"] == []


def test_trash_purge_removes_local_file(client, nc, owner):
    att = _upload(client, owner)
    path = _path(_row(att["id"]))
    assert client.delete("/api/scratchpad/%d" % owner["note"], headers=owner["h"]).status_code == 200
    assert os.path.exists(path), "note di Sampah masih bisa dipulihkan → file tetap ada"
    assert client.delete("/api/scratchpad/trash/%d" % owner["note"], headers=owner["h"]).status_code == 200
    assert not os.path.exists(path)


def test_trash_restore_keeps_local_file_viewable(client, nc, owner):
    att = _upload(client, owner)
    assert client.delete("/api/scratchpad/%d" % owner["note"], headers=owner["h"]).status_code == 200
    r = client.post("/api/scratchpad/trash/%d/restore" % owner["note"], headers=owner["h"])
    assert r.status_code == 200, r.text
    r = client.get("/api/scratchpad/attachments/%d/view" % att["id"], headers=owner["h"])
    assert r.status_code == 200 and r.content == PNG


def test_failed_write_leaves_no_part_file(client, nc, owner, monkeypatch):
    real_replace = os.replace

    def boom(src, dst):
        raise OSError("disk penuh (uji)")
    monkeypatch.setattr(os, "replace", boom)
    before = set(os.listdir(webapp.UPLOAD_DIR)) if os.path.isdir(webapp.UPLOAD_DIR) else set()
    with pytest.raises(OSError):
        client.post("/api/scratchpad/%d/attachments" % owner["note"], headers=owner["h"],
                    files={"file": ("x.png", PNG, "image/png")})
    monkeypatch.setattr(os, "replace", real_replace)
    after = set(os.listdir(webapp.UPLOAD_DIR))
    assert not [n for n in after - before if n.endswith(".part")]
