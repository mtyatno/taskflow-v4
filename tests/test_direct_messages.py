"""Tes Pesan Pribadi / DM 1-on-1 (spec: docs/superpowers/specs/2026-10-03-direct-messages-design.md)."""
import uuid

import webapp
from conftest import db, register_user


class U:
    """User tes: selalu bersihkan cookie sebelum request supaya Bearer header yang dipakai."""

    def __init__(self, client, prefix="dm"):
        name = f"{prefix}{uuid.uuid4().hex[:8]}"
        info = register_user(client, name, f"{name}@test.id")
        self.client = client
        self.id = info["user_id"]
        self.username = info["username"]
        self.h = {"Authorization": f"Bearer {info['token']}"}

    def _call(self, method, url, **kw):
        self.client.cookies.clear()
        return getattr(self.client, method)(url, headers=self.h, **kw)

    def get(self, url, **kw): return self._call("get", url, **kw)
    def post(self, url, **kw): return self._call("post", url, **kw)
    def delete(self, url, **kw): return self._call("delete", url, **kw)


def _rows(sql, *params):
    conn = db()
    try:
        return conn.execute(sql, params).fetchall()
    finally:
        conn.close()


def _mk_list(owner, *members, name="Grup DM"):
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


def _open(a, b):
    r = a.post("/api/dm/conversations", json={"user_id": b.id})
    assert r.status_code == 200, r.text
    return r.json()


def _send(u, conv_id, content="halo", **kw):
    r = u.post(f"/api/dm/conversations/{conv_id}/messages", json={"content": content, **kw})
    assert r.status_code == 200, r.text
    return r.json()


def _conv(u, conv_id):
    r = u.get("/api/dm/conversations")
    assert r.status_code == 200, r.text
    return next(c for c in r.json() if c["id"] == conv_id)


# ── Skema ────────────────────────────────────────────────────────────────────

def test_tables_created_by_migrate_db():
    names = {r["name"] for r in _rows("SELECT name FROM sqlite_master WHERE type IN ('table','index')")}
    assert {"dm_conversations", "dm_messages", "dm_reads", "idx_dm_messages_conv"} <= names


def test_requires_login(client):
    client.cookies.clear()
    assert client.get("/api/dm/contacts").status_code == 401
    assert client.get("/api/dm/conversations").status_code == 401


# ── Kontak ───────────────────────────────────────────────────────────────────

def test_contacts_only_users_sharing_a_list(client):
    a, b, c, d = U(client), U(client), U(client), U(client)
    _mk_list(a, b)          # a owner, b member
    _mk_list(c, a)          # c owner, a member
    _mk_list(d)             # d sendirian
    ids = {x["id"] for x in a.get("/api/dm/contacts").json()}
    assert ids == {b.id, c.id}
    row = next(x for x in a.get("/api/dm/contacts").json() if x["id"] == b.id)
    assert row["username"] == b.username and "display_name" in row
    # sesama member juga kontak
    e = U(client)
    _mk_list(d, b, e)
    assert e.id in {x["id"] for x in b.get("/api/dm/contacts").json()}
    assert d.id not in ids


# ── Membuat percakapan ───────────────────────────────────────────────────────

def test_create_requires_shared_list(client):
    a, b = U(client), U(client)
    r = a.post("/api/dm/conversations", json={"user_id": b.id})
    assert r.status_code == 403


def test_create_self_400_unknown_404(client):
    a = U(client)
    assert a.post("/api/dm/conversations", json={"user_id": a.id}).status_code == 400
    assert a.post("/api/dm/conversations", json={"user_id": 99999999}).status_code == 404


def test_get_or_create_idempotent_both_directions(client):
    a, b = U(client), U(client)
    _mk_list(b, a)
    c1 = _open(a, b)
    c2 = _open(a, b)
    c3 = _open(b, a)
    assert c1["id"] == c2["id"] == c3["id"]
    assert c1["other_user"]["id"] == b.id
    assert c3["other_user"]["id"] == a.id
    assert len(_rows("SELECT id FROM dm_conversations WHERE id = ?", c1["id"])) == 1


# ── Pesan ────────────────────────────────────────────────────────────────────

def test_send_and_list_messages(client):
    a, b = U(client), U(client)
    _mk_list(a, b)
    cid = _open(a, b)["id"]
    m1 = _send(a, cid, "halo b", client_id="c-1")
    assert m1["conversation_id"] == cid and m1["user_id"] == a.id
    assert m1["username"] == a.username and m1["client_id"] == "c-1"
    m2 = _send(b, cid, "halo juga", reply_to_id=m1["id"])
    assert m2["reply_to_id"] == m1["id"]
    assert m2["reply_to_content"] == "halo b"
    assert m2["reply_to_username"] == a.username
    msgs = b.get(f"/api/dm/conversations/{cid}/messages").json()
    assert [m["id"] for m in msgs] == [m1["id"], m2["id"]]
    for k in ("id", "conversation_id", "user_id", "content", "client_id", "created_at", "reply_to_id",
              "username", "display_name", "reply_to_username", "reply_to_display_name", "reply_to_content"):
        assert k in msgs[0]
    conv = _conv(a, cid)
    assert conv["last_message"]["content"] == "halo juga"
    assert conv["last_message"]["user_id"] == b.id
    assert conv["last_message_at"]


def test_message_validation(client):
    a, b = U(client), U(client)
    _mk_list(a, b)
    cid = _open(a, b)["id"]
    assert a.post(f"/api/dm/conversations/{cid}/messages", json={"content": ""}).status_code == 422
    assert a.post(f"/api/dm/conversations/{cid}/messages", json={"content": "x" * 2001}).status_code == 422
    assert a.post(f"/api/dm/conversations/{cid}/messages",
                  json={"content": "x", "client_id": "c" * 65}).status_code == 422


def test_pagination_before_id(client):
    a, b = U(client), U(client)
    _mk_list(a, b)
    cid = _open(a, b)["id"]
    ids = [_send(a, cid, f"m{i}")["id"] for i in range(5)]
    last2 = a.get(f"/api/dm/conversations/{cid}/messages?limit=2").json()
    assert [m["id"] for m in last2] == ids[3:]
    older = a.get(f"/api/dm/conversations/{cid}/messages?limit=2&before_id={ids[3]}").json()
    assert [m["id"] for m in older] == ids[1:3]


def test_reply_to_other_conversation_rejected(client):
    a, b, c = U(client), U(client), U(client)
    _mk_list(a, b, c)
    ab = _open(a, b)["id"]
    ac = _open(a, c)["id"]
    m = _send(a, ac, "untuk c")
    r = a.post(f"/api/dm/conversations/{ab}/messages", json={"content": "x", "reply_to_id": m["id"]})
    assert r.status_code == 400
    r = a.post(f"/api/dm/conversations/{ab}/messages", json={"content": "x", "reply_to_id": 99999999})
    assert r.status_code == 400


def test_non_participant_gets_404(client):
    a, b, c = U(client), U(client), U(client)
    _mk_list(a, b, c)
    cid = _open(a, b)["id"]
    _send(a, cid)
    assert c.get(f"/api/dm/conversations/{cid}/messages").status_code == 404
    assert c.post(f"/api/dm/conversations/{cid}/messages", json={"content": "intip"}).status_code == 404
    assert c.post(f"/api/dm/conversations/{cid}/read").status_code == 404
    assert c.get(f"/api/dm/conversations/{cid}/stream?token=x").status_code in (401, 404)
    assert a.get("/api/dm/conversations/99999999/messages").status_code == 404
    assert cid not in {x["id"] for x in c.get("/api/dm/conversations").json()}


def test_stream_non_participant_404(client):
    a, b, c = U(client), U(client), U(client)
    _mk_list(a, b, c)
    cid = _open(a, b)["id"]
    r = c.get(f"/api/dm/conversations/{cid}/stream")
    assert r.status_code == 404


def test_conversation_stays_active_after_leaving_list(client):
    a, b = U(client), U(client)
    list_id = _mk_list(a, b)
    cid = _open(a, b)["id"]
    _send(a, cid, "sebelum")
    assert b.delete(f"/api/lists/{list_id}/leave").status_code == 200
    assert b.id not in {x["id"] for x in a.get("/api/dm/contacts").json()}
    _send(b, cid, "sesudah keluar")
    _send(a, cid, "masih bisa")
    assert _open(a, b)["id"] == cid
    assert _open(b, a)["id"] == cid


def test_deleting_shared_list_keeps_dm(client):
    a, b = U(client), U(client)
    list_id = _mk_list(a, b)
    cid = _open(a, b)["id"]
    _send(a, cid, "tetap ada")
    assert a.delete(f"/api/lists/{list_id}").status_code == 200
    msgs = b.get(f"/api/dm/conversations/{cid}/messages").json()
    assert [m["content"] for m in msgs] == ["tetap ada"]


# ── Belum dibaca & notifikasi ────────────────────────────────────────────────

def test_unread_and_mark_read(client):
    a, b = U(client), U(client)
    _mk_list(a, b)
    cid = _open(a, b)["id"]
    assert _conv(b, cid)["unread"] == 0
    _send(a, cid, "1")
    _send(a, cid, "2")
    assert _conv(b, cid)["unread"] == 2
    assert _conv(a, cid)["unread"] == 0  # pesan sendiri tidak dihitung
    r = b.post(f"/api/dm/conversations/{cid}/read")
    assert r.status_code == 200, r.text
    assert _conv(b, cid)["unread"] == 0
    _send(a, cid, "3")
    assert _conv(b, cid)["unread"] == 1


def test_conversations_sorted_by_activity(client):
    a, b, c = U(client), U(client), U(client)
    _mk_list(a, b, c)
    ab = _open(a, b)["id"]
    ac = _open(a, c)["id"]
    _send(a, ac, "pertama")
    _send(a, ab, "terbaru")
    ids = [x["id"] for x in a.get("/api/dm/conversations").json()]
    assert ids.index(ab) < ids.index(ac)


def test_notification_created_and_not_duplicated(client):
    a, b = U(client), U(client)
    _mk_list(a, b)
    cid = _open(a, b)["id"]
    expected = f"💬 {a.username} mengirim pesan pribadi"
    _send(a, cid, "satu")
    _send(a, cid, "dua")
    rows = _rows("SELECT * FROM notifications WHERE user_id = ? AND message = ?", b.id, expected)
    assert len(rows) == 1
    assert rows[0]["is_read"] == 0 and rows[0]["list_id"] is None
    # pengirim tidak dapat notifikasi
    assert not _rows("SELECT id FROM notifications WHERE user_id = ? AND message LIKE '%pesan pribadi%'", a.id)
    # setelah dibaca, pesan baru → notifikasi baru
    conn = db()
    conn.execute("UPDATE notifications SET is_read = 1 WHERE user_id = ?", (b.id,))
    conn.commit()
    conn.close()
    _send(a, cid, "tiga")
    assert len(_rows("SELECT id FROM notifications WHERE user_id = ? AND message = ?", b.id, expected)) == 2


def test_no_notification_when_recipient_subscribed(client):
    import asyncio
    a, b = U(client), U(client)
    _mk_list(a, b)
    cid = _open(a, b)["id"]
    q = asyncio.Queue()
    entry = (b.id, q)
    webapp.dm_subscribers[cid].add(entry)
    try:
        msg = _send(a, cid, "langsung terbaca")
    finally:
        webapp.dm_subscribers[cid].discard(entry)
    assert not _rows("SELECT id FROM notifications WHERE user_id = ? AND message LIKE '%pesan pribadi%'", b.id)
    assert q.get_nowait()["id"] == msg["id"]


def test_notification_uses_db_username_after_rename(client):
    a, b = U(client), U(client)
    _mk_list(a, b)
    cid = _open(a, b)["id"]
    new_name = f"ren{a.id}x"
    conn = db()
    conn.execute("UPDATE users SET username = ? WHERE id = ?", (new_name, a.id))
    conn.commit()
    conn.close()
    # Token lama (klaim username lama) tetap dipakai.
    msg = _send(a, cid, "nama baru")
    assert msg["username"] == new_name
    _send(a, cid, "lagi")
    rows = _rows("SELECT message FROM notifications WHERE user_id = ? AND message LIKE '%pesan pribadi%'", b.id)
    assert [r["message"] for r in rows] == [f"💬 {new_name} mengirim pesan pribadi"]


# ── Blokir ───────────────────────────────────────────────────────────────────

def _block(u, cid):
    r = u.post(f"/api/dm/conversations/{cid}/block")
    assert r.status_code == 200, r.text
    return r.json()


def _unblock(u, cid):
    r = u.delete(f"/api/dm/conversations/{cid}/block")
    assert r.status_code == 200, r.text
    return r.json()


def test_block_table_created():
    cols = {r["name"] for r in _rows("PRAGMA table_info(dm_blocks)")}
    assert {"blocker_id", "blocked_id", "created_at"} <= cols


def test_block_prevents_sending_both_directions(client):
    a, b = U(client), U(client)
    _mk_list(a, b)
    cid = _open(a, b)["id"]
    _send(a, cid, "sebelum blokir")
    _block(a, cid)
    _block(a, cid)  # idempoten
    assert len(_rows("SELECT 1 FROM dm_blocks WHERE blocker_id = ? AND blocked_id = ?", a.id, b.id)) == 1
    for u in (a, b):
        r = u.post(f"/api/dm/conversations/{cid}/messages", json={"content": "x"})
        assert r.status_code == 403
        assert r.json()["detail"] == "Obrolan ini diblokir"
    # riwayat tetap terbaca kedua pihak
    for u in (a, b):
        msgs = u.get(f"/api/dm/conversations/{cid}/messages").json()
        assert [m["content"] for m in msgs] == ["sebelum blokir"]


def test_blocked_send_no_notification_or_broadcast(client):
    import asyncio
    a, b = U(client), U(client)
    _mk_list(a, b)
    cid = _open(a, b)["id"]
    _block(b, cid)
    q = asyncio.Queue()
    entry = (b.id, q)
    webapp.dm_subscribers[cid].add(entry)
    try:
        assert a.post(f"/api/dm/conversations/{cid}/messages", json={"content": "x"}).status_code == 403
    finally:
        webapp.dm_subscribers[cid].discard(entry)
    assert q.empty()
    assert not _rows("SELECT id FROM notifications WHERE user_id = ? AND message LIKE '%pesan pribadi%'", b.id)
    assert not _rows("SELECT id FROM dm_messages WHERE conversation_id = ?", cid)


def test_block_flags_in_list_and_create(client):
    a, b = U(client), U(client)
    _mk_list(a, b)
    cid = _open(a, b)["id"]
    ca = _conv(a, cid)
    assert ca["blocked_by_me"] is False and ca["blocked_by_other"] is False
    _block(a, cid)
    ca, cb = _conv(a, cid), _conv(b, cid)
    assert ca["blocked_by_me"] is True and ca["blocked_by_other"] is False
    assert cb["blocked_by_me"] is False and cb["blocked_by_other"] is True
    # percakapan yang sudah ada tetap dikembalikan, dengan flag
    r = b.post("/api/dm/conversations", json={"user_id": a.id})
    assert r.status_code == 200, r.text
    assert r.json()["id"] == cid and r.json()["blocked_by_other"] is True
    assert a.post("/api/dm/conversations", json={"user_id": b.id}).json()["blocked_by_me"] is True


def test_block_prevents_new_conversation(client):
    a, b, c = U(client), U(client), U(client)
    _mk_list(a, b, c)
    ab = _open(a, b)["id"]
    _block(a, ab)
    # blokir antar user (bukan per percakapan): hapus percakapan → membuat baru ditolak kedua arah
    _exec_sql("DELETE FROM dm_conversations WHERE id = ?", ab)
    assert a.post("/api/dm/conversations", json={"user_id": b.id}).status_code == 403
    assert b.post("/api/dm/conversations", json={"user_id": a.id}).status_code == 403
    assert a.post("/api/dm/conversations", json={"user_id": c.id}).status_code == 200


def test_block_non_participant_404(client):
    a, b, c = U(client), U(client), U(client)
    _mk_list(a, b, c)
    cid = _open(a, b)["id"]
    assert c.post(f"/api/dm/conversations/{cid}/block").status_code == 404
    assert c.delete(f"/api/dm/conversations/{cid}/block").status_code == 404
    assert a.post("/api/dm/conversations/99999999/block").status_code == 404


def test_unblock_restores_sending(client):
    a, b = U(client), U(client)
    _mk_list(a, b)
    cid = _open(a, b)["id"]
    _block(a, cid)
    _block(b, cid)
    _unblock(a, cid)
    _unblock(a, cid)  # idempoten
    # b masih memblokir a → tetap diblokir
    assert a.post(f"/api/dm/conversations/{cid}/messages", json={"content": "x"}).status_code == 403
    assert b.delete(f"/api/dm/conversations/{cid}/block").status_code == 200
    _send(a, cid, "pulih")
    _send(b, cid, "ya")
    ca = _conv(a, cid)
    assert ca["blocked_by_me"] is False and ca["blocked_by_other"] is False


def _exec_sql(sql, *params):
    conn = db()
    try:
        conn.execute(sql, params)
        conn.commit()
    finally:
        conn.close()
