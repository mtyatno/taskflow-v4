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
    code = a.post(f"/api/lists/{lid}/generate-link").json()["code"]
    assert b.post("/api/lists/join", json={"code": code}).status_code == 200
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
