"""Undangan workspace via username: pending -> terima/tolak + notifikasi (Fase 2a §1.1, §1.2)."""
import sqlite3
import uuid
from datetime import datetime, timedelta

from conftest import db, register_user


class U:
    def __init__(self, client, prefix="wi"):
        name = f"{prefix}{uuid.uuid4().hex[:8]}"
        info = register_user(client, name, f"{name}@test.id")
        self.client = client
        self.name = name
        self.id = info["user_id"]
        self.h = {"Authorization": f"Bearer {info['token']}"}

    def _call(self, method, url, **kw):
        self.client.cookies.clear()
        return getattr(self.client, method)(url, headers=self.h, **kw)

    def get(self, url, **kw): return self._call("get", url, **kw)
    def post(self, url, **kw): return self._call("post", url, **kw)
    def delete(self, url, **kw): return self._call("delete", url, **kw)


def _workspace(u):
    r = u.post("/api/lists", json={"name": f"WS{uuid.uuid4().hex[:8]}"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _q(sql, args=()):
    conn = db()
    try:
        rows = conn.execute(sql, args).fetchall()
        conn.commit()
        return rows
    finally:
        conn.close()


def _invite(a, lid, b):
    return a.post(f"/api/lists/{lid}/invite", json={"username": b.name})


def _setup(client):
    a, b = U(client, "oa"), U(client, "ib")
    lid = _workspace(a)
    r = _invite(a, lid, b)
    assert r.status_code == 200, r.text
    return a, b, lid, r.json()["invitation"]["id"]


def _is_member(lid, uid):
    return bool(_q("SELECT 1 FROM list_members WHERE list_id=? AND user_id=?", (lid, uid)))


def test_invite_creates_pending_not_member(client):
    a, b = U(client, "oa"), U(client, "ib")
    lid = _workspace(a)
    r = _invite(a, lid, b)
    assert r.status_code == 200, r.text
    inv = r.json()["invitation"]
    assert r.json()["ok"] is True
    assert inv["invitee"] == {"id": b.id, "username": b.name, "display_name": inv["invitee"]["display_name"]}
    assert inv["created_at"]
    assert not _is_member(lid, b.id)
    row = _q("SELECT status FROM workspace_invitations WHERE id=?", (inv["id"],))[0]
    assert row["status"] == "pending"


def test_invite_duplicate_409(client):
    a, b, lid, _ = _setup(client)
    r = _invite(a, lid, b)
    assert r.status_code == 409
    assert r.json()["detail"] == f"Undangan untuk @{b.name} sudah dikirim"


def test_invite_existing_member_400(client):
    a, b = U(client, "oa"), U(client, "ib")
    lid = _workspace(a)
    _q("INSERT INTO list_members(list_id, user_id, joined_at) VALUES (?,?,?)",
       (lid, b.id, datetime.now().isoformat()))
    r = _invite(a, lid, b)
    assert r.status_code == 400
    assert r.json()["detail"] == f"User '{b.name}' sudah menjadi anggota"


def test_invitee_lists_pending_with_inviter_and_list(client):
    a, b, lid, iid = _setup(client)
    items = b.get("/api/invitations").json()
    assert len(items) == 1
    it = items[0]
    assert it["id"] == iid
    assert set(it["list"]) == {"id", "name", "avatar", "color_idx"}
    assert it["list"]["id"] == lid
    assert it["inviter_name"]
    assert it["created_at"]
    assert a.get("/api/invitations").json() == []


def test_accept_makes_member_and_notifies_owner(client):
    a, b, lid, iid = _setup(client)
    r = b.post(f"/api/invitations/{iid}/accept")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "accepted"
    assert r.json()["list"]["id"] == lid
    assert _is_member(lid, b.id)
    msgs = [n["message"] for n in a.get("/api/notifications").json()]
    assert any("menerima undangan ke" in m for m in msgs), msgs
    assert b.get("/api/invitations").json() == []


def test_decline_notifies_owner_not_member(client):
    a, b, lid, iid = _setup(client)
    r = b.post(f"/api/invitations/{iid}/decline")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "declined"
    assert not _is_member(lid, b.id)
    msgs = [n["message"] for n in a.get("/api/notifications").json()]
    assert any("menolak undangan ke" in m for m in msgs), msgs


def test_respond_not_owner_of_invitation_404(client):
    a, b, lid, iid = _setup(client)
    c = U(client, "cc")
    assert c.post(f"/api/invitations/{iid}/accept").status_code == 404
    assert a.post(f"/api/invitations/{iid}/decline").status_code == 404
    assert b.post("/api/invitations/99999999/accept").status_code == 404


def test_respond_twice_409(client):
    a, b, lid, iid = _setup(client)
    assert b.post(f"/api/invitations/{iid}/accept").status_code == 200
    assert b.post(f"/api/invitations/{iid}/accept").status_code == 409
    assert b.post(f"/api/invitations/{iid}/decline").status_code == 409


def _age(iid, days):
    old = (datetime.now() - timedelta(days=days)).isoformat()
    _q("UPDATE workspace_invitations SET created_at=? WHERE id=?", (old, iid))


def test_respond_expired_410(client):
    a, b, lid, iid = _setup(client)
    _age(iid, 15)
    r = b.post(f"/api/invitations/{iid}/accept")
    assert r.status_code == 410
    assert r.json()["detail"] == "Undangan sudah kedaluwarsa"
    assert b.post(f"/api/invitations/{iid}/decline").status_code == 410
    assert not _is_member(lid, b.id)


def test_expired_not_listed(client):
    a, b, lid, iid = _setup(client)
    _age(iid, 15)
    assert b.get("/api/invitations").json() == []
    assert a.get(f"/api/lists/{lid}/invitations").json() == []
    # undangan baru untuk pasangan yang sama diperbolehkan (pending kedaluwarsa dibatalkan)
    assert _invite(a, lid, b).status_code == 200
    assert _q("SELECT status FROM workspace_invitations WHERE id=?", (iid,))[0]["status"] == "cancelled"


def test_accept_when_already_member(client):
    a, b, lid, iid = _setup(client)
    # keanggotaan lewat jalur yang tidak menutup undangan (mis. data lama) -> terima tetap idempoten
    _q("INSERT INTO list_members(list_id, user_id, joined_at) VALUES (?,?,?)",
       (lid, b.id, datetime.now().isoformat()))
    r = b.post(f"/api/invitations/{iid}/accept")
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "accepted"
    rows = _q("SELECT 1 FROM list_members WHERE list_id=? AND user_id=?", (lid, b.id))
    assert len(rows) == 1


def test_owner_lists_and_cancels(client):
    a, b, lid, iid = _setup(client)
    items = a.get(f"/api/lists/{lid}/invitations").json()
    assert len(items) == 1
    assert items[0]["id"] == iid
    assert items[0]["invitee"]["username"] == b.name
    assert set(items[0]["invitee"]) == {"id", "username", "display_name"}
    r = a.delete(f"/api/lists/{lid}/invitations/{iid}")
    assert r.status_code == 200, r.text
    assert a.get(f"/api/lists/{lid}/invitations").json() == []
    assert b.get("/api/invitations").json() == []
    assert b.post(f"/api/invitations/{iid}/accept").status_code == 409
    assert a.delete(f"/api/lists/{lid}/invitations/99999999").status_code == 404
    other = _workspace(a)
    assert a.delete(f"/api/lists/{other}/invitations/{iid}").status_code == 404


def test_cancel_non_pending_409(client):
    a, b, lid, iid = _setup(client)
    b.post(f"/api/invitations/{iid}/decline")
    assert a.delete(f"/api/lists/{lid}/invitations/{iid}").status_code == 409


def test_non_owner_cannot_list_or_cancel_403(client):
    a, b, lid, iid = _setup(client)
    assert b.get(f"/api/lists/{lid}/invitations").status_code == 403
    assert b.delete(f"/api/lists/{lid}/invitations/{iid}").status_code == 403


def test_invitation_gone_after_workspace_delete(client):
    a, b, lid, iid = _setup(client)
    assert a.delete(f"/api/lists/{lid}").status_code == 200
    assert b.get("/api/invitations").json() == []
    assert not _q("SELECT 1 FROM workspace_invitations WHERE id=?", (iid,))


def test_notification_kind_workspace_invite(client):
    a, b, lid, iid = _setup(client)
    notes = b.get("/api/notifications").json()
    inv = [n for n in notes if n.get("kind") == "workspace_invite"]
    assert len(inv) == 1
    assert "mengundangmu ke workspace" in inv[0]["message"]
    assert inv[0]["list_id"] == lid


def test_migration_idempotent(client):
    import repository
    import webapp
    conn = sqlite3.connect(db().execute("PRAGMA database_list").fetchone()[2])
    try:
        repository.ensure_workspace_invitations_schema(conn)
        repository.ensure_workspace_invitations_schema(conn)
        cols = [r[1] for r in conn.execute("PRAGMA table_info(notifications)").fetchall()]
        assert cols.count("kind") == 1
        idx = [r[1] for r in conn.execute("PRAGMA index_list(workspace_invitations)").fetchall()]
        assert "idx_ws_invitations_pending" in idx
    finally:
        conn.close()
    webapp.migrate_db()
    webapp.migrate_db()


def test_accept_is_atomic_when_membership_insert_fails(client, monkeypatch):
    import pytest
    import repository
    from config import DB_PATH
    a, b, lid, iid = _setup(client)

    def boom(conn, list_id, user_id):
        raise sqlite3.OperationalError("database is locked")

    monkeypatch.setattr(repository.TaskRepository, "_add_list_member_conn", staticmethod(boom))
    repo = repository.TaskRepository(DB_PATH)
    with pytest.raises(sqlite3.OperationalError):
        repo.respond_workspace_invitation(iid, b.id, True)
    monkeypatch.undo()
    assert _q("SELECT status FROM workspace_invitations WHERE id=?", (iid,))[0]["status"] == "pending"
    assert not _is_member(lid, b.id)
    assert not [n for n in a.get("/api/notifications").json() if "menerima" in n["message"]]
    # retry berhasil
    assert b.post(f"/api/invitations/{iid}/accept").status_code == 200
    assert _is_member(lid, b.id)


def test_invite_telegram_dm_has_accept_decline_buttons(client, monkeypatch):
    import asyncio
    import webapp

    class FakeBot:
        def __init__(self):
            self.sent = []

        async def send_message(self, chat_id, text, parse_mode=None, reply_markup=None, **kw):
            self.sent.append((chat_id, text, reply_markup))

    fake = FakeBot()
    monkeypatch.setattr(webapp, "_tg_bot", fake)
    a, b = U(client, "oa"), U(client, "ib")
    tg = 7_000_000 + int(uuid.uuid4().int % 900_000)
    _q("UPDATE users SET telegram_id=? WHERE id=?", (tg, b.id))
    lid = _workspace(a)
    inv = {"id": 0, "list_id": lid, "invitee_id": b.id, "inviter_id": a.id}
    iid = _invite(a, lid, b).json()["invitation"]["id"]
    inv["id"] = iid
    asyncio.run(webapp._send_invitation_telegram(inv))
    assert fake.sent
    chat, text, kb = fake.sent[-1]
    assert chat == tg and "mengundangmu ke workspace" in text
    btns = kb.inline_keyboard[0]
    assert [x.callback_data for x in btns] == [f"inv_acc_{iid}", f"inv_dec_{iid}"]


def test_join_via_link_closes_pending_invitation(client):
    a, b, lid, iid = _setup(client)
    code = a.post(f"/api/lists/{lid}/generate-link").json()["code"]
    assert b.post("/api/lists/join", json={"code": code}).status_code == 200
    assert b.get("/api/invitations").json() == []
    assert a.get(f"/api/lists/{lid}/invitations").json() == []
    row = _q("SELECT status, responded_at FROM workspace_invitations WHERE id=?", (iid,))[0]
    assert row["status"] == "accepted" and row["responded_at"]
    assert b.post(f"/api/invitations/{iid}/accept").status_code == 409


def test_cancel_does_not_overwrite_concurrent_accept(client, monkeypatch):
    """Terima terjadi di antara pembacaan dan penulisan -> batal gagal 409, status tetap accepted."""
    import repository as repo_mod
    import webapp
    a, b, lid, iid = _setup(client)
    repo = repo_mod.TaskRepository(webapp.DB_PATH)
    repo.respond_workspace_invitation(iid, b.id, True)
    try:
        repo.cancel_workspace_invitation(lid, iid)
        raise AssertionError("harus InvitationClosed")
    except repo_mod.InvitationClosed:
        pass
    assert _q("SELECT status FROM workspace_invitations WHERE id=?", (iid,))[0]["status"] == "accepted"
    try:
        repo.cancel_workspace_invitation(lid + 99999, iid)
        raise AssertionError("harus InvitationNotFound")
    except repo_mod.InvitationNotFound:
        pass


def test_cancel_update_is_conditional_on_pending():
    import inspect
    import repository as repo_mod
    src = inspect.getsource(repo_mod.TaskRepository.cancel_workspace_invitation)
    assert "status='pending'" in src.split("UPDATE workspace_invitations", 1)[1].split(")", 1)[0]


def test_invitation_timestamps_are_offset_aware(client):
    a, b = U(client, "oa"), U(client, "ib")
    lid = _workspace(a)
    r = _invite(a, lid, b)
    assert datetime.fromisoformat(r.json()["invitation"]["created_at"]).tzinfo is not None
    assert datetime.fromisoformat(b.get("/api/invitations").json()[0]["created_at"]).tzinfo is not None
    assert datetime.fromisoformat(a.get(f"/api/lists/{lid}/invitations").json()[0]["created_at"]).tzinfo is not None
    iid = r.json()["invitation"]["id"]
    assert b.post(f"/api/invitations/{iid}/accept").status_code == 200
    members = a.get(f"/api/lists/{lid}").json()["members"]
    assert members and all(datetime.fromisoformat(m["joined_at"]).tzinfo is not None for m in members)
    # instan yang sama dengan stempel naive (waktu lokal server) di DB
    raw = _q("SELECT joined_at FROM list_members WHERE list_id=? AND user_id=?", (lid, b.id))[0]["joined_at"]
    assert datetime.fromisoformat(members[0]["joined_at"]) == datetime.fromisoformat(raw).astimezone()


def test_iso_with_offset_helper():
    import webapp
    assert webapp._iso_with_offset(None) is None
    assert webapp._iso_with_offset("") == ""
    assert webapp._iso_with_offset("2026-10-21T10:00:00+07:00") == "2026-10-21T10:00:00+07:00"
    out = webapp._iso_with_offset("2026-10-21T10:00:00.123456")
    assert datetime.fromisoformat(out).tzinfo is not None
    assert datetime.fromisoformat(out) == datetime.fromisoformat("2026-10-21T10:00:00.123456").astimezone()
    assert webapp._iso_with_offset("bukan-tanggal") == "bukan-tanggal"
