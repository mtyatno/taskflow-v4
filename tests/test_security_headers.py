"""Header pengaman: nosniff di semua respons, CSP halaman /pub, sandbox untuk file inline.

Spec: docs/superpowers/specs/2026-10-19-xss-hardening-design.md §6.
"""
import pytest

import webapp
from test_pub_access import _auth, _publish, _uid, _uniq, anon
from conftest import db

PUB_CSP = ("default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' "
           "https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; "
           "media-src 'self' blob:; frame-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; "
           "form-action 'self'; frame-ancestors 'self'")
SANDBOX_CSP = "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'"


def test_nosniff_on_api_and_pub(client):
    tag = _uniq()
    h = _auth(client, f"hdrns_{tag}")
    _, slug, username = _publish(client, h, f"Hdr {tag}", "isi")
    for r in (client.get("/api/scratchpad", headers=h), client.get("/api/scratchpad"),
              anon().get(f"/pub/{username}/{slug}"), anon().get("/pub/tidak-ada-sama-sekali"),
              anon().get("/pub/x/tidak-ada")):
        assert r.headers.get("x-content-type-options") == "nosniff", (r.request.url, r.status_code)
        assert len(r.headers.get_list("x-content-type-options")) == 1


def test_pub_csp_exact(client):
    tag = _uniq()
    h = _auth(client, f"hdrcsp_{tag}")
    note_id, slug, username = _publish(client, h, f"Csp {tag}", "isi")
    _, lslug, _ = _publish(client, h, f"Csp kunci {tag}", "isi", password="rahasia123")
    pub = anon()
    try:
        resps = (pub.get(f"/pub/{username}/{slug}"), pub.get(f"/pub/{username}/{lslug}"),
                 pub.post(f"/pub/{username}/{lslug}/unlock", data={"password": "salah"}),
                 pub.get(f"/pub/{username}/tidak-ada-{tag}"), pub.get(f"/pub/tidak-ada-{tag}"))
    finally:
        webapp._ip_attempts.clear()  # batas percobaan per IP dipakai bersama seluruh sesi tes
        webapp._progressive.clear()
    for r in resps:
        assert r.headers.get("content-type", "").startswith("text/html"), r.request.url
        assert r.headers.get("content-security-policy") == PUB_CSP, r.request.url
    # JSON drawing publik tidak memakai CSP halaman
    assert "content-security-policy" not in pub.get(f"/pub/drawings/999999999").headers
    # API biasa tidak memakai CSP halaman
    assert "content-security-policy" not in client.get("/api/scratchpad", headers=h).headers


class _FakeResp:
    def __init__(self, content=b"BYTES"):
        self.status_code = 200
        self.content = content

    def iter_content(self, chunk_size=8192):
        yield self.content

    def close(self):
        pass


def _nc_att(note_id, user_id, name, mime):
    conn = db()
    try:
        cur = conn.execute(
            "INSERT INTO note_attachments (note_id, user_id, nextcloud_path, original_name, file_size, mime_type) "
            "VALUES (?, ?, ?, ?, 5, ?)",
            (note_id, user_id, f"{webapp.NEXTCLOUD_FOLDER}/nc-only-{_uniq()}-{name}", name, mime),
        )
        conn.commit()
        return cur.lastrowid
    finally:
        conn.close()


@pytest.fixture
def fake_nc(monkeypatch):
    import requests
    monkeypatch.setattr(webapp, "NEXTCLOUD_URL", "https://nc.example")
    monkeypatch.setattr(webapp, "_nc_dav_url", lambda p: "https://nc.example/dav/" + p)
    monkeypatch.setattr(webapp, "_nc_auth", lambda: ("u", "p"))
    monkeypatch.setattr(requests, "get", lambda *a, **k: _FakeResp())


CASES = [
    ("a.png", "image/png", "inline"),
    ("a.jpg", "image/jpeg", "inline"),
    ("a.webp", "image/webp", "inline"),
    ("a.gif", "image/gif", "inline"),
    ("a.pdf", "application/pdf", "inline"),
    ("a.doc", "application/msword", "attachment"),
    ("a.svg", "image/svg+xml", "attachment"),
    ("a.html", "text/html", "attachment"),
    ("a.bin", "", "attachment"),
]


@pytest.mark.parametrize("name,mime,disp", CASES)
def test_inline_attachment_headers(client, fake_nc, name, mime, disp):
    tag = _uniq()
    uname = f"hdratt_{tag}"
    h = _auth(client, uname)
    note_id, _, _ = _publish(client, h, f"Att {tag}", "isi")
    aid = _nc_att(note_id, _uid(uname), name, mime)
    r = anon().get(f"/pub/attachments/{aid}")
    assert r.status_code == 200, r.text
    assert r.content == b"BYTES"
    assert r.headers["content-disposition"].startswith(f"{disp};"), r.headers["content-disposition"]
    assert r.headers["content-security-policy"] == SANDBOX_CSP
    assert r.headers["x-content-type-options"] == "nosniff"


@pytest.mark.parametrize("name,mime,disp", CASES)
def test_view_attachment_headers(client, fake_nc, name, mime, disp):
    tag = _uniq()
    uname = f"hdrview_{tag}"
    h = _auth(client, uname)
    r = client.post("/api/scratchpad", json={"title": f"V {tag}", "content": "x"}, headers=h)
    aid = _nc_att(r.json()["id"], _uid(uname), name, mime)
    r = client.get(f"/api/scratchpad/attachments/{aid}/view", headers=h)
    assert r.status_code == 200, r.text
    assert r.headers["content-disposition"].startswith(f"{disp};"), r.headers["content-disposition"]
    assert r.headers["content-security-policy"] == SANDBOX_CSP
    assert r.headers["x-content-type-options"] == "nosniff"
