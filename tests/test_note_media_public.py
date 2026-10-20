"""Tes media di halaman publik, redirect /pub/attachments, pratinjau Sampah."""
import re
import time
import uuid

import webapp
from conftest import db
from drawing_ws_helpers import auth
from media_probe import format_duration
from media_serve import verify_token
from starlette.testclient import TestClient


def _uniq(p):
    return f"{p}{uuid.uuid4().hex[:8]}"


def anon():
    return TestClient(webapp.app)


def _publish(client, h, content, password=None):
    r = client.post("/api/scratchpad", json={"title": "T", "content": content}, headers=h)
    nid = r.json()["id"]
    p = client.post(f"/api/scratchpad/{nid}/publish",
                    json={"password": password} if password else {}, headers=h)
    assert p.status_code == 200, p.text
    return nid, p.json()["slug"], p.json()["username"]


def _media_row(note_id, uid, cid, name="rapat.mp4", media_type="video", status="ready",
               duration_ms=62000, poster=False):
    c = db()
    try:
        cur = c.execute(
            "INSERT INTO note_attachments (note_id, user_id, nextcloud_path, original_name, file_size, "
            "mime_type, kind, storage, client_id, storage_key, status, media_type, duration_ms, poster_key) "
            "VALUES (?, ?, '', ?, 10, ?, 'media', 'local', ?, '2026/10/x.mp4', ?, ?, ?, ?)",
            (note_id, uid, name, "video/mp4" if media_type == "video" else "audio/mpeg", cid,
             status, media_type, duration_ms, "2026/10/x.poster.jpg" if poster else None))
        c.commit()
        return cur.lastrowid
    finally:
        c.close()


def _uid(client, h):
    return client.get("/api/auth/me", headers=h).json().get("id")


def _uid_db(name):
    c = db()
    try:
        return c.execute("SELECT id FROM users WHERE username=?", (name,)).fetchone()["id"]
    finally:
        c.close()


def _setup(client, content_fmt, **row_kw):
    uname = _uniq("pm")
    h = auth(client, uname)
    uid = _uid_db(uname)
    cid = _uniq("c")
    nid, slug, username = _publish(client, h, content_fmt.format(cid=cid))
    att = _media_row(nid, uid, cid, **row_kw)
    return h, uid, nid, slug, username, cid, att


def test_format_duration():
    assert format_duration(62000) == "1:02"
    assert format_duration(3600000) == "1:00:00"
    assert format_duration(3723000) == "1:02:03"
    assert format_duration(None) is None
    assert format_duration(0) is None


def test_public_page_renders_player_for_own_media(client):
    h, uid, nid, slug, username, cid, att = _setup(
        client, '::media[{cid}]{{name="fallback.mp4"}}', poster=True)
    page = anon().get(f"/pub/{username}/{slug}")
    assert page.status_code == 200
    assert '<video controls preload="metadata" playsinline src="/media/' in page.text
    assert 'poster="/media/' in page.text
    assert "rapat.mp4 · 1:02" in page.text
    assert ">Unduh</a>" in page.text
    urls = re.findall(r'(?:src|poster|href)="/media/([^"]+)"', page.text)
    assert len(urls) == 3
    variants = set()
    for t in urls:
        v = verify_token(t, webapp.MEDIA_URL_SECRET_BYTES, int(time.time()))
        assert v and v[0] == att
        variants.add(v[1])
    assert variants == {"play", "poster", "download"}


def test_public_page_audio_has_no_poster(client):
    h, uid, nid, slug, username, cid, att = _setup(
        client, "::media[{cid}]", name="lagu.mp3", media_type="audio", duration_ms=None)
    page = anon().get(f"/pub/{username}/{slug}")
    assert '<audio controls preload="metadata" src="/media/' in page.text
    assert "<video" not in page.text
    assert "poster=" not in page.text
    assert "<figcaption>lagu.mp3</figcaption>" in page.text


def test_public_page_password_locked_has_no_media_urls(client):
    uname = _uniq("pm")
    h = auth(client, uname)
    uid = _uid_db(uname)
    cid = _uniq("c")
    nid, slug, username = _publish(client, h, f"::media[{cid}]", password="rahasia123")
    _media_row(nid, uid, cid)
    page = anon().get(f"/pub/{username}/{slug}")
    assert "/media/" not in page.text
    assert "rapat.mp4" not in page.text


def test_public_page_foreign_client_id_shows_unavailable(client):
    uname = _uniq("pm")
    h = auth(client, uname)
    uid = _uid_db(uname)
    other = client.post("/api/scratchpad", json={"title": "o", "content": "x"}, headers=h).json()["id"]
    cid = _uniq("c")
    _media_row(other, uid, cid, name="rahasia-orang-lain.mp4")
    nid, slug, username = _publish(client, h, f"::media[{cid}]")
    page = anon().get(f"/pub/{username}/{slug}")
    assert 'class="pub-media pub-media-missing">Media tidak tersedia</figure>' in page.text
    assert "rahasia-orang-lain" not in page.text
    assert "/media/" not in page.text


def test_public_page_not_ready_shows_unavailable(client):
    for status in ("uploading", "processing", "failed"):
        h, uid, nid, slug, username, cid, att = _setup(client, "::media[{cid}]", status=status)
        page = anon().get(f"/pub/{username}/{slug}")
        assert "Media tidak tersedia" in page.text, status
        assert "/media/" not in page.text
        assert "rapat.mp4" not in page.text


def test_public_page_unknown_cid_shows_unavailable(client):
    uname = _uniq("pm")
    h = auth(client, uname)
    nid, slug, username = _publish(client, h, "::media[nope]")
    page = anon().get(f"/pub/{username}/{slug}")
    assert "Media tidak tersedia" in page.text


def test_public_page_escapes_name_and_ignores_unknown_attrs(client):
    h, uid, nid, slug, username, cid, att = _setup(
        client, '::media[{cid}]{{name="x" onerror=alert(1) src=evil}}',
        name='"><script>alert(1)</script>.mp4')
    page = anon().get(f"/pub/{username}/{slug}")
    assert "<script>alert(1)" not in page.text
    assert "&lt;script&gt;" in page.text
    assert "onerror" not in page.text
    assert "evil" not in page.text


def test_public_page_name_attr_fallback_when_no_original_name(client):
    h, uid, nid, slug, username, cid, att = _setup(
        client, '::media[{cid}]{{name="<b>x</b>"}}', name="")
    page = anon().get(f"/pub/{username}/{slug}")
    assert "&lt;b&gt;x&lt;/b&gt;" in page.text
    assert "<b>x</b>" not in page.text


def test_typed_media_tags_stay_text(client):
    uname = _uniq("pm")
    h = auth(client, uname)
    nid, slug, username = _publish(client, h, "<video src=x></video> <audio src=y>")
    page = anon().get(f"/pub/{username}/{slug}")
    assert "&lt;video" in page.text
    assert "<video src=x" not in page.text
    assert "<audio src=y" not in page.text


def test_pub_attachment_media_redirects_to_download(client):
    h, uid, nid, slug, username, cid, att = _setup(client, "::media[{cid}]")
    r = anon().get(f"/pub/attachments/{att}", follow_redirects=False)
    assert r.status_code == 302
    m = re.fullmatch(r"/media/(.+)", r.headers["location"])
    v = verify_token(m.group(1), webapp.MEDIA_URL_SECRET_BYTES, int(time.time()))
    assert v == (att, "download", v[2])


def test_pub_attachment_media_not_ready_is_404(client):
    h, uid, nid, slug, username, cid, att = _setup(client, "::media[{cid}]", status="processing")
    assert anon().get(f"/pub/attachments/{att}", follow_redirects=False).status_code == 404


def test_pub_attachment_media_password_without_cookie_404(client):
    uname = _uniq("pm")
    h = auth(client, uname)
    uid = _uid_db(uname)
    cid = _uniq("c")
    nid, slug, username = _publish(client, h, f"::media[{cid}]", password="rahasia123")
    att = _media_row(nid, uid, cid)
    assert anon().get(f"/pub/attachments/{att}", follow_redirects=False).status_code == 404
    ok = anon().get(f"/pub/attachments/{att}", follow_redirects=False,
                    headers={"Cookie": f"pub_unlock_{slug}={webapp._sign_cookie(slug)}"})
    assert ok.status_code == 302


def test_trash_preview_strips_media_directive():
    out = webapp._trash_preview('halo ::media[abc_1]{name="rapat.mp4"} dunia \\::media\\[x\\]')
    assert "media" not in out and "rapat" not in out
    assert out.startswith("halo") and "dunia" in out
