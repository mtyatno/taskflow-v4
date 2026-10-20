"""Komentar note: status baca dan ringkasan per note (Task 4)."""
import uuid

from starlette.testclient import TestClient

import webapp
from conftest import db
from note_comment_helpers import U, private_note, shared_note


def _u(client, p):
    return U(client, f"{p}{uuid.uuid4().hex[:8]}")


def _note_row(u, nid):
    r = u.get(f"/api/scratchpad/{nid}")
    assert r.status_code == 200, r.text
    return r.json()


def _list_row(u, nid):
    r = u.get("/api/scratchpad")
    assert r.status_code == 200
    return next(n for n in r.json() if n["id"] == nid)


def _updated_at(nid):
    conn = db()
    try:
        return conn.execute("SELECT updated_at FROM scratchpad_notes WHERE id = ?", (nid,)).fetchone()[0]
    finally:
        conn.close()


def _c(u, nid, body, **kw):
    r = u.post(f"/api/scratchpad/{nid}/comments", json={"body": body, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def test_counts_and_unread(client):
    a, b = _u(client, "ca"), _u(client, "cb")
    nid, _ = shared_note(a, [b], f"Sum {uuid.uuid4().hex[:6]}")
    t1 = _c(b, nid, "satu")
    t2 = _c(b, nid, "dua")
    _c(b, nid, "balasan", parent_id=t1["id"])
    assert b.patch(f"/api/note-comments/{t2['id']}", json={"resolved": True}).status_code == 200
    for row in (_list_row(a, nid), _note_row(a, nid)):
        assert row["comment_open_count"] == 1
        assert row["comment_unread"] is True
    assert a.post(f"/api/scratchpad/{nid}/comments/read").json() == {"ok": True}
    for row in (_list_row(a, nid), _note_row(a, nid)):
        assert row["comment_unread"] is False
        assert row["comment_open_count"] == 1
    _c(a, nid, "dari A sendiri")
    assert _note_row(a, nid)["comment_unread"] is False
    # B (penulis lain) tidak unread karena komentarnya sendiri, tapi komentar A membuatnya unread
    assert _note_row(b, nid)["comment_unread"] is True


def test_summary_does_not_bump_note(client):
    a, b = _u(client, "sa"), _u(client, "sb")
    nid, _ = shared_note(a, [b], f"Bump {uuid.uuid4().hex[:6]}")
    before = _updated_at(nid)
    t = _c(b, nid, "x")
    r = _c(a, nid, "y", parent_id=t["id"])
    assert a.patch(f"/api/note-comments/{t['id']}", json={"resolved": True}).status_code == 200
    assert a.delete(f"/api/note-comments/{r['id']}").status_code in (200, 204)
    assert a.post(f"/api/scratchpad/{nid}/comments/read").status_code == 200
    _list_row(a, nid)
    _note_row(a, nid)
    assert _updated_at(nid) == before


def test_private_note_defaults(client):
    a = _u(client, "pa")
    nid = private_note(a, f"Priv {uuid.uuid4().hex[:6]}")
    for row in (_list_row(a, nid), _note_row(a, nid)):
        assert row["comment_open_count"] == 0
        assert row["comment_unread"] is False
    assert a.post(f"/api/scratchpad/{nid}/comments/read").json() == {"ok": True}
    conn = db()
    try:
        assert conn.execute("SELECT COUNT(*) FROM note_comment_reads WHERE note_id = ?", (nid,)).fetchone()[0] == 0
    finally:
        conn.close()


def test_read_not_visible_404(client):
    a, x = _u(client, "ra"), _u(client, "rx")
    nid = private_note(a, f"Hid {uuid.uuid4().hex[:6]}")
    assert x.post(f"/api/scratchpad/{nid}/comments/read").status_code == 404
    assert x.post("/api/scratchpad/99999999/comments/read").status_code == 404


def test_list_search_branches_have_summary(client):
    a, b = _u(client, "la"), _u(client, "lb")
    tok = f"zqlist{uuid.uuid4().hex[:8]}"
    nid, _ = shared_note(a, [b], tok)
    _c(b, nid, "k")
    for q in (tok, f"{tok} (", "tidakadaxyz"):
        r = a.get("/api/scratchpad", params={"q": q})
        assert r.status_code == 200
        for n in r.json():
            assert "comment_open_count" in n and "comment_unread" in n
    hit = next(n for n in a.get("/api/scratchpad", params={"q": tok}).json() if n["id"] == nid)
    assert hit["comment_open_count"] == 1


def test_not_in_pub_export_search(client):
    a, b = _u(client, "ea"), _u(client, "eb")
    nid, _ = shared_note(a, [b], f"Pub {uuid.uuid4().hex[:6]}")
    tok = "zqkomentar123"
    _c(b, nid, f"rahasia {tok}")
    assert tok not in a.get(f"/api/scratchpad/{nid}/export/md").text
    p = a.post(f"/api/scratchpad/{nid}/publish", json={})
    assert p.status_code == 200, p.text
    slug, username = p.json()["slug"], p.json()["username"]
    page = TestClient(webapp.app).get(f"/pub/{username}/{slug}")
    assert page.status_code == 200
    assert tok not in page.text
    assert tok not in a.get("/api/search", params={"q": tok}).text
    assert tok not in b.get("/api/search", params={"q": tok}).text
