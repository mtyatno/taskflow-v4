"""R20 (Live Edit): notifikasi "✏️ … memperbarui task …" untuk anggota workspace digabung per aktor per task.

Panel Live Edit menyimpan otomatis per field, jadi satu sesi edit menghasilkan banyak `PUT /api/tasks/:id`. Server
melewati notifikasi "memperbarui task" (in-app dan Telegram) bila aktor yang sama sudah memicunya untuk task yang sama
dalam `TASK_UPDATE_NOTIFY_WINDOW_MIN` menit terakhir. Notifikasi penugasan (📌) tidak terpengaruh.
Spec docs/superpowers/specs/2026-10-26-live-edit-design.md; ledger .superpowers/sdd/2026-10-26-live-edit/progress.md R20.
"""
import uuid
from datetime import datetime, timedelta

import webapp
from conftest import db, client  # noqa: F401
from test_direct_messages import U, _mk_list, _rows

UPDATED = "memperbarui task"


def _put(u, task_id, **body):
    r = u._call("put", f"/api/tasks/{task_id}", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _updates(user_id, task_id):
    """Pesan "memperbarui task" milik `user_id` untuk task ini."""
    return [r["message"] for r in _rows(
        "SELECT message FROM notifications WHERE user_id = ? AND task_id = ? ORDER BY id", user_id, task_id)
        if UPDATED in r["message"]]


def _backdate(task_id, minutes):
    conn = db()
    try:
        ts = (datetime.now() - timedelta(minutes=minutes)).isoformat()
        conn.execute("UPDATE notifications SET created_at = ? WHERE task_id = ?", (ts, task_id))
        conn.commit()
    finally:
        conn.close()


def _ws_task(owner, *members, title="rapat"):
    list_id = _mk_list(owner, *members, name="ws")
    r = owner.post("/api/tasks", json={"title": title, "list_id": list_id})
    assert r.status_code == 200, r.text
    return list_id, r.json()["id"]


def test_window_constant():
    assert webapp.TASK_UPDATE_NOTIFY_WINDOW_MIN == 10


def test_two_puts_within_window_notify_each_member_once(client):
    a, b, c = U(client, "ua"), U(client, "ub"), U(client, "uc")
    _ls, tid = _ws_task(a, b, c)
    _put(a, tid, priority="P1")
    _put(a, tid, description="langkah berikutnya")
    _put(a, tid, title="rapat besar")
    for m in (b, c):
        msgs = _updates(m.id, tid)
        assert len(msgs) == 1, msgs
        assert msgs[0].startswith(f"✏️ <b>{a.username}</b> memperbarui task <b>rapat</b>"), msgs
    assert _updates(a.id, tid) == []  # aktor tidak diberi tahu tentang editnya sendiri


def test_put_after_window_notifies_again(client):
    a, b = U(client, "wa"), U(client, "wb")
    _ls, tid = _ws_task(a, b)
    _put(a, tid, priority="P1")
    _put(a, tid, priority="P2")
    assert len(_updates(b.id, tid)) == 1
    _backdate(tid, webapp.TASK_UPDATE_NOTIFY_WINDOW_MIN + 1)
    _put(a, tid, priority="P3")
    assert len(_updates(b.id, tid)) == 2
    # tepat di dalam jendela (mis. 9 menit lalu) masih digabung
    _backdate(tid, webapp.TASK_UPDATE_NOTIFY_WINDOW_MIN - 1)
    _put(a, tid, priority="P4")
    assert len(_updates(b.id, tid)) == 2


def test_different_actor_within_window_is_notified(client):
    a, b, c = U(client, "da"), U(client, "db"), U(client, "dc")
    _ls, tid = _ws_task(a, b, c)
    _put(a, tid, priority="P1")
    _put(b, tid, priority="P2")
    assert len(_updates(a.id, tid)) == 1  # dari b
    assert len(_updates(b.id, tid)) == 1  # dari a
    c_msgs = _updates(c.id, tid)
    assert len(c_msgs) == 2, c_msgs
    assert any(f"<b>{a.username}</b>" in m for m in c_msgs) and any(f"<b>{b.username}</b>" in m for m in c_msgs)
    # aktor kedua juga digabung di jendelanya sendiri
    _put(b, tid, priority="P3")
    assert len(_updates(c.id, tid)) == 2


def test_other_task_is_not_coalesced(client):
    a, b = U(client, "oa"), U(client, "ob")
    list_id, t1 = _ws_task(a, b)
    t2 = a.post("/api/tasks", json={"title": "lain", "list_id": list_id}).json()["id"]
    _put(a, t1, priority="P1")
    _put(a, t2, priority="P1")
    assert len(_updates(b.id, t1)) == 1 and len(_updates(b.id, t2)) == 1


def test_assignment_notification_still_sent(client):
    a, b = U(client, "aa"), U(client, "ab")
    _ls, tid = _ws_task(a, b)
    _put(a, tid, priority="P1")  # notifikasi "memperbarui" baru saja dibuat
    _put(a, tid, assigned_to=b.id)
    assigned = [r["message"] for r in _rows(
        "SELECT message FROM notifications WHERE user_id = ? AND task_id = ?", b.id, tid) if "menugaskan task" in r["message"]]
    assert len(assigned) == 1, assigned
    _put(a, tid, priority="P2")
    assert len(_updates(b.id, tid)) == 1


def test_prefix_is_not_a_like_pattern(client):
    a, b = U(client, "pa"), U(client, "pb")
    _ls, tid = _ws_task(a, b)
    conn = db()
    try:
        conn.execute("INSERT INTO notifications (user_id, message, is_read, task_id, created_at) VALUES (?,?,0,?,?)",
                     (b.id, "✏️ <b>aXb</b> memperbarui task <b>rapat</b>.", tid, datetime.now().isoformat()))
        conn.commit()
    finally:
        conn.close()
    assert webapp._task_update_notified_recently(tid, "✏️ <b>aXb</b> memperbarui task") is True
    assert webapp._task_update_notified_recently(tid, "✏️ <b>a_b</b> memperbarui task") is False
    assert webapp._task_update_notified_recently(tid, "✏️ <b>a%</b> memperbarui task") is False


class _FakeBot:
    def __init__(self):
        self.sent = []

    async def send_message(self, chat_id, text, parse_mode=None, **kw):
        self.sent.append((chat_id, text))


def test_skip_also_skips_telegram(client, monkeypatch):
    fake = _FakeBot()
    monkeypatch.setattr(webapp, "_tg_bot", fake)
    a, b = U(client, "ta"), U(client, "tb")
    tg_b = 7_000_000 + int(uuid.uuid4().int % 900_000)
    conn = db()
    try:
        conn.execute("UPDATE users SET telegram_id = ? WHERE id = ?", (tg_b, b.id))
        conn.commit()
    finally:
        conn.close()
    _ls, tid = _ws_task(a, b)
    _put(a, tid, priority="P1")
    _put(a, tid, priority="P2")
    texts = [t for (cid, t) in fake.sent if cid == tg_b and UPDATED in t]
    assert len(texts) == 1, fake.sent
