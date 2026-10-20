"""Komentar note: notifikasi in-app dan Telegram (Task 5)."""
import webapp
from conftest import db
from note_comment_helpers import U, shared_note


def _notifs(uid):
    conn = db()
    try:
        return [dict(r) for r in conn.execute(
            "SELECT * FROM notifications WHERE user_id = ? ORDER BY id", (uid,)).fetchall()]
    finally:
        conn.close()


def _post(u, nid, body, **kw):
    r = u.post(f"/api/scratchpad/{nid}/comments", json={"body": body, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def test_new_thread_notifies_owner(client):
    a, b = U(client, "ncn1a"), U(client, "ncn1b")
    nid, lid = shared_note(a, [b], "ncn1 note")
    _post(b, nid, "halo")
    n = _notifs(a.id)
    assert len(n) == 1
    assert n[0]["message"].startswith("ncn1b mengomentari catatanmu ")
    assert n[0]["note_id"] == nid and n[0]["list_id"] == lid
    assert _notifs(b.id) == []


def test_mention_priority_and_dedup(client):
    a, b, c, _o = U(client, "ncn2a"), U(client, "ncn2b"), U(client, "ncn2c"), U(client, "ncn2out")
    nid, _ = shared_note(a, [b, c], "ncn2 note")
    _post(b, nid, "@ncn2a @NCN2A @ncn2b @ncn2c @ncn2out")
    na, nc = _notifs(a.id), _notifs(c.id)
    assert len(na) == 1 and " menyebutmu di " in na[0]["message"]
    assert len(nc) == 1 and " menyebutmu di " in nc[0]["message"]
    assert _notifs(b.id) == [] and _notifs(_o.id) == []


def test_reply_notifies_participants(client):
    a, b, c = U(client, "ncn3a"), U(client, "ncn3b"), U(client, "ncn3c")
    d = U(client, "ncn3d")
    nid, _ = shared_note(a, [b, c, d], "ncn3 note")
    t = _post(a, nid, "thread")
    r_c = _post(c, nid, "balasan c", parent_id=t["id"])
    r_d = _post(d, nid, "balasan d", parent_id=t["id"])
    assert d.delete(f"/api/note-comments/{r_d['id']}").status_code == 200
    base_a, base_c, base_d = len(_notifs(a.id)), len(_notifs(c.id)), len(_notifs(d.id))
    _post(b, nid, "balasan b", parent_id=t["id"])
    na, nc = _notifs(a.id)[base_a:], _notifs(c.id)[base_c:]
    assert len(na) == 1 and " membalas komentar di " in na[0]["message"]
    assert len(nc) == 1 and " membalas komentar di " in nc[0]["message"]
    assert len(_notifs(d.id)) == base_d  # balasan terhapus: bukan peserta
    assert _notifs(b.id) == []
    assert r_c["parent_id"] == t["id"]


def test_resolve_notifies_author(client):
    a, b = U(client, "ncn4a"), U(client, "ncn4b")
    nid, _ = shared_note(a, [b], "ncn4 note")
    tb = _post(b, nid, "thread b")
    before = len(_notifs(b.id))
    assert a.patch(f"/api/note-comments/{tb['id']}", json={"resolved": True}).status_code == 200
    n = _notifs(b.id)[before:]
    assert len(n) == 1 and n[0]["message"].startswith("ncn4a menyelesaikan komentarmu di ")
    assert n[0]["note_id"] == nid
    before_a = len(_notifs(a.id))
    assert b.patch(f"/api/note-comments/{tb['id']}", json={"resolved": False}).status_code == 200
    assert b.patch(f"/api/note-comments/{tb['id']}", json={"resolved": True}).status_code == 200
    assert len(_notifs(a.id)) == before_a  # penulis menyelesaikan miliknya sendiri
    assert len(_notifs(b.id)) == before + 1  # reopen/self-resolve tidak menotifikasi


def test_edit_reopen_delete_silent(client):
    a, b = U(client, "ncn5a"), U(client, "ncn5b")
    nid, _ = shared_note(a, [b], "ncn5 note")
    t = _post(b, nid, "thread")
    a.patch(f"/api/note-comments/{t['id']}", json={"resolved": True})
    total = lambda: len(_notifs(a.id)) + len(_notifs(b.id))
    before = total()
    assert b.patch(f"/api/note-comments/{t['id']}", json={"body": "diedit @ncn5a"}).status_code == 200
    assert a.patch(f"/api/note-comments/{t['id']}", json={"resolved": False}).status_code == 200
    assert b.delete(f"/api/note-comments/{t['id']}").status_code == 200
    assert total() == before


def test_message_escaped_and_truncated(client):
    a, b = U(client, "ncn6a"), U(client, "ncn6b")
    nid, _ = shared_note(a, [b], "<i>judul</i>")
    body = "<b>x</b>" + "a" * 100
    j = _post(b, nid, body)
    assert j["body"] == body
    msg = _notifs(a.id)[0]["message"]
    assert "&lt;b&gt;x&lt;/b&gt;" in msg and "<b>x</b>" not in msg
    assert "&lt;i&gt;judul&lt;/i&gt;" in msg
    isi = msg.split(': "', 1)[1][:-1]
    assert isi == "&lt;b&gt;x&lt;/b&gt;" + "a" * 72 + "…"
    # judul kosong
    nid2, _ = shared_note(a, [b], "  ")
    _post(b, nid2, "hai")
    assert "Tanpa judul" in _notifs(a.id)[-1]["message"]


def test_telegram_sent(client, monkeypatch):
    a, b = U(client, "ncn7a"), U(client, "ncn7b")
    nid, _ = shared_note(a, [b], "ncn7 note")
    conn = db()
    conn.execute("UPDATE users SET telegram_id = ? WHERE id = ?", (987001, a.id))
    conn.commit()
    conn.close()
    calls = []

    class Bot:
        async def send_message(self, **kw):
            calls.append(kw)

    monkeypatch.setattr(webapp, "_tg_bot", Bot())
    _post(b, nid, "halo tg")
    assert len(calls) == 1
    assert calls[0]["chat_id"] == 987001 and calls[0]["parse_mode"] == "HTML"
    assert calls[0]["text"].startswith("ncn7b mengomentari catatanmu ")
