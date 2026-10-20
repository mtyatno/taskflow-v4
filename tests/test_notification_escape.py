"""Notifikasi dalam aplikasi dan pesan Telegram dari server: nilai pengguna ter-escape saat disusun.

Spec: docs/superpowers/specs/2026-10-19-xss-hardening-design.md §4. Notifikasi disimpan sebagai string HTML
dan dirender klien lewat allowlist (<b>, <i>, <br>); pesan yang sama dikirim ke Telegram ParseMode.HTML.
"""
import asyncio
import io
import uuid

import pytest

import webapp
from conftest import db, client  # noqa: F401
from test_direct_messages import U, _mk_list, _rows

PAYLOAD = "<img src=x onerror=1> & co"
ESC = "&lt;img src=x onerror=1&gt; &amp; co"


def _msgs(user_id):
    return [r["message"] for r in _rows("SELECT message FROM notifications WHERE user_id = ?", user_id)]


def _assert_escaped(messages, *needles):
    joined = "\n".join(messages)
    assert "<img" not in joined, joined
    for n in needles:
        assert n in joined, joined


def test_task_title_in_notification_is_escaped(client):
    a, b = U(client, "na"), U(client, "nb")
    list_id = _mk_list(a, b)
    r = a.post("/api/tasks", json={"title": PAYLOAD, "list_id": list_id})
    assert r.status_code == 200, r.text
    msgs = _msgs(b.id)
    _assert_escaped(msgs, "&lt;img", "&amp; co", "<b>")
    assert any(f"<b>{ESC}</b>" in m for m in msgs)  # tag template tetap, nilai ter-escape


def test_comment_subtask_and_done_notifications_escaped(client):
    a, b = U(client, "ca"), U(client, "cb")
    list_id = _mk_list(a, b)
    tid = a.post("/api/tasks", json={"title": PAYLOAD, "list_id": list_id}).json()["id"]
    assert a.post(f"/api/tasks/{tid}/notes", json={"content": PAYLOAD}).status_code == 200
    assert a.post(f"/api/tasks/{tid}/subtasks", json={"title": "s"}).status_code == 200
    assert a.post(f"/api/tasks/{tid}/done").status_code == 200
    msgs = _msgs(b.id)
    assert len(msgs) >= 4
    _assert_escaped(msgs, ESC)


def test_list_name_and_filename_escaped_in_notifications(client):
    a, b = U(client, "fa"), U(client, "fb")
    list_id = _mk_list(a, b, name=PAYLOAD)
    tid = a.post("/api/tasks", json={"title": "t", "list_id": list_id}).json()["id"]
    r = a.post(f"/api/tasks/{tid}/attachments",
               files={"file": ("<svg onload=1>&.txt", io.BytesIO(b"x"), "text/plain")})
    assert r.status_code == 200, r.text
    msgs = _msgs(b.id)
    joined = "\n".join(msgs)
    assert "<svg" not in joined
    assert "&lt;svg onload=1&gt;&amp;.txt" in joined


def test_mention_and_dm_notifications_escape_names_and_list(client):
    a, b = U(client, "ma"), U(client, "mb")
    list_id = _mk_list(a, b, name=PAYLOAD)
    r = a.post(f"/api/lists/{list_id}/messages", json={"content": f"hai @{b.username}"})
    assert r.status_code == 200, r.text
    msgs = _msgs(b.id)
    _assert_escaped(msgs, ESC)


class _FakeBot:
    def __init__(self):
        self.sent = []

    async def send_message(self, chat_id, text, parse_mode=None, **kw):
        self.sent.append((chat_id, text, parse_mode))


def _set_tg(user_id, tg):
    conn = db()
    try:
        conn.execute("UPDATE users SET telegram_id = ? WHERE id = ?", (tg, user_id))
        conn.commit()
    finally:
        conn.close()


def test_telegram_messages_from_server_are_escaped(client, monkeypatch):
    fake = _FakeBot()
    monkeypatch.setattr(webapp, "_tg_bot", fake)
    a, b = U(client, "ta"), U(client, "tb")
    tg_b = 9_000_000 + int(uuid.uuid4().int % 900_000)
    _set_tg(b.id, tg_b)
    list_id = _mk_list(a, name=PAYLOAD)
    # undangan langsung: pesan Telegram ke target memuat nama list
    r = a.post(f"/api/lists/{list_id}/invite", json={"username": b.username})
    assert r.status_code == 200, r.text
    # task baru di list: pesan Telegram lewat _notify_members_bg
    a.post("/api/tasks", json={"title": PAYLOAD, "list_id": list_id})
    texts = [t for (cid, t, pm) in fake.sent if cid == tg_b]
    assert len(texts) >= 2, fake.sent
    assert all(pm == "HTML" for (_c, _t, pm) in fake.sent)
    _assert_escaped(texts, ESC)


def test_join_telegram_message_escapes_list_name(client, monkeypatch):
    fake = _FakeBot()
    monkeypatch.setattr(webapp, "_tg_bot", fake)
    a, b = U(client, "ja"), U(client, "jb")
    tg_a = 8_000_000 + int(uuid.uuid4().int % 900_000)
    _set_tg(a.id, tg_a)
    list_id = _mk_list(a, name=PAYLOAD)
    code = a.post(f"/api/lists/{list_id}/generate-link").json()
    code = code.get("code") or code.get("invite_code")
    assert code, code

    async def run():
        r = b.post("/api/lists/join", json={"code": code})
        assert r.status_code == 200, r.text
    asyncio.run(run())
    texts = [t for (cid, t, _pm) in fake.sent if cid == tg_a]
    assert texts, fake.sent
    _assert_escaped(texts, ESC)


def test_recurring_expiry_messages_escape_title(client, monkeypatch):
    fake = _FakeBot()
    monkeypatch.setattr(webapp, "_tg_bot", fake)
    a = U(client, "ra")
    tg = 7_000_000 + int(uuid.uuid4().int % 900_000)
    _set_tg(a.id, tg)
    from datetime import date, timedelta
    r = a.post("/api/tasks", json={"title": PAYLOAD, "recurrence_type": "daily"})
    assert r.status_code == 200, r.text
    conn = db()
    try:  # tanggal akhir dihitung server (+90 hari); majukan ke kemarin supaya notifikasi "berakhir" terbentuk
        conn.execute("UPDATE tasks SET recurrence_end_date = ? WHERE id = ?",
                     ((date.today() - timedelta(days=1)).isoformat(), r.json()["id"]))
        conn.commit()
    finally:
        conn.close()
    r = a.post("/api/recurring/check-expiry")
    assert r.status_code == 200, r.text
    msgs = _msgs(a.id)
    assert msgs, "notifikasi recurring tidak terbentuk"
    _assert_escaped(msgs, ESC)
    _assert_escaped([t for (cid, t, _p) in fake.sent if cid == tg], ESC)
