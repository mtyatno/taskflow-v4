"""Panggilan Nextcloud (requests sinkron) tidak boleh menahan event loop server.

Bug 2026-10-23: upload/tampil/hapus lampiran note, /pub/attachments dan ekspor DOCX memanggil `requests` langsung di
endpoint `async` → selama meneruskan file ke Nextcloud, SEMUA request lain (termasuk pengguna lain) ikut menunggu.
Tes: Nextcloud palsu lambat (SLOW dtk); sementara endpoint itu berjalan, GET /api/version harus tetap cepat.
"""
import asyncio
import io
import time
import uuid
from types import SimpleNamespace

import httpx
import pytest
import requests

import webapp
from conftest import db, register_user

SLOW = 1.2
FAST_LIMIT = 0.8  # sejak request lambat dimulai; tertahan = ≥ SLOW (1,2 dtk)


class _Resp(SimpleNamespace):
    def iter_content(self, chunk_size=8192):
        yield self.content

    def close(self):
        pass


def _png():
    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (24, 12), (40, 160, 220)).save(buf, "PNG")
    return buf.getvalue()


PNG = _png()


@pytest.fixture
def slow_nc(monkeypatch):
    state = {"slow": False}

    def maybe_sleep():
        if state["slow"]:
            time.sleep(SLOW)

    def fput(url, **kw):
        maybe_sleep()
        return _Resp(status_code=201)

    def freq(*a, **kw):
        maybe_sleep()
        return _Resp(status_code=201)

    def fget(url, **kw):
        maybe_sleep()
        return _Resp(status_code=200, content=PNG)

    def fdel(url, **kw):
        maybe_sleep()
        return _Resp(status_code=204)

    monkeypatch.setattr(requests, "put", fput)
    monkeypatch.setattr(requests, "request", freq)
    monkeypatch.setattr(requests, "get", fget)
    monkeypatch.setattr(requests, "delete", fdel)
    monkeypatch.setattr(webapp, "NEXTCLOUD_URL", "http://nc.invalid")
    return state


@pytest.fixture
def owner(client):
    u = "ncloop" + uuid.uuid4().hex[:8]
    tok = register_user(client, u, u + "@ex.com")["token"]
    h = {"Authorization": "Bearer " + tok}
    note = client.post("/api/scratchpad", headers=h,
                       json={"title": "N", "content": "x", "tags": [], "client_id": str(uuid.uuid4())}).json()
    return {"h": h, "note": note["id"]}


def _upload(client, owner):
    """Baris lampiran LAMA (storage='nextcloud'): sejak lampiran baru disimpan di disk, Nextcloud hanya dipakai
    untuk membaca/menghapus lampiran lama — itu yang diuji di sini."""
    conn = db()
    try:
        uid = conn.execute("SELECT user_id FROM scratchpad_notes WHERE id=?", (owner["note"],)).fetchone()[0]
        cur = conn.execute(
            "INSERT INTO note_attachments (note_id, user_id, nextcloud_path, original_name, file_size, mime_type) "
            "VALUES (?,?,?,?,?,?)", (owner["note"], uid, "/TaskFlow/attachments/lama.png", "a.png", len(PNG),
                                     "image/png"))
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


async def _measure(method, path, headers=None, **kw):
    """Jalankan `method path` (memanggil Nextcloud palsu yang lambat) sambil mengukur GET /api/version."""
    transport = httpx.ASGITransport(app=webapp.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://t") as ac:
        # Diukur sejak request lambat dimulai: bila event loop tertahan, /api/version baru selesai setelah
        # Nextcloud palsu selesai (≥ SLOW), termasuk tertahan selama asyncio.sleep di bawah.
        t0 = time.monotonic()
        slow_task = asyncio.create_task(ac.request(method, path, headers=headers, **kw))
        await asyncio.sleep(0.15)  # beri waktu request lambat masuk ke pemanggilan Nextcloud
        r = await ac.get("/api/version")
        quick = time.monotonic() - t0
        slow = await slow_task
        if hasattr(slow, "aread"):
            await slow.aread()
    assert r.status_code == 200
    return quick, slow


def test_upload_does_not_block_event_loop(client, slow_nc, owner):
    # unggah baru ke disk (tanpa Nextcloud) — tetap tidak boleh menahan event loop
    slow_nc["slow"] = True
    quick, slow = asyncio.run(_measure("POST", "/api/scratchpad/%d/attachments" % owner["note"], headers=owner["h"],
                                       files={"file": ("a.png", PNG, "image/png")}))
    assert slow.status_code == 200, slow.text
    assert quick < FAST_LIMIT, "upload menahan event loop %.2f dtk" % quick


def test_view_does_not_block_event_loop(client, slow_nc, owner):
    att = _upload(client, owner)
    slow_nc["slow"] = True
    quick, slow = asyncio.run(_measure("GET", "/api/scratchpad/attachments/%d/view" % att, headers=owner["h"]))
    assert slow.status_code == 200 and slow.content == PNG
    assert quick < FAST_LIMIT, "view menahan event loop %.2f dtk" % quick


def test_delete_does_not_block_event_loop(client, slow_nc, owner):
    att = _upload(client, owner)
    slow_nc["slow"] = True
    quick, slow = asyncio.run(_measure("DELETE", "/api/scratchpad/attachments/%d" % att, headers=owner["h"]))
    assert slow.status_code == 200, slow.text
    assert quick < FAST_LIMIT, "delete menahan event loop %.2f dtk" % quick


def test_docx_export_does_not_block_event_loop(client, slow_nc, owner):
    att = _upload(client, owner)
    client.put("/api/scratchpad/%d" % owner["note"], headers=owner["h"],
               json={"title": "N", "content": "![a.png](/api/scratchpad/attachments/%d/view)" % att, "tags": []})
    slow_nc["slow"] = True
    path = [r.path for r in webapp.app.routes if getattr(r, "endpoint", None) is webapp.export_scratchpad_docx][0]
    quick, slow = asyncio.run(_measure("GET", path.replace("{note_id}", str(owner["note"])), headers=owner["h"]))
    assert slow.status_code == 200, slow.text
    assert quick < FAST_LIMIT, "ekspor DOCX menahan event loop %.2f dtk" % quick


def test_pub_attachment_does_not_block_event_loop(client, slow_nc, owner):
    att = _upload(client, owner)
    r = client.post("/api/scratchpad/%d/publish" % owner["note"], headers=owner["h"], json={"password": None})
    assert r.status_code == 200, r.text
    slow_nc["slow"] = True
    quick, slow = asyncio.run(_measure("GET", "/pub/attachments/%d" % att))
    assert slow.status_code == 200 and slow.content == PNG
    assert quick < FAST_LIMIT, "/pub/attachments menahan event loop %.2f dtk" % quick
