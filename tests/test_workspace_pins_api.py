"""Endpoint pin workspace (spec sidebar-workspace-pins §5, §9)."""
import uuid
from datetime import datetime

from conftest import db, register_user


class U:
    def __init__(self, client, prefix="wp"):
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
    def put(self, url, **kw): return self._call("put", url, **kw)
    def delete(self, url, **kw): return self._call("delete", url, **kw)


def _workspace(u):
    r = u.post("/api/lists", json={"name": f"WS{uuid.uuid4().hex[:8]}"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _add_member(list_id, user_id):
    conn = db()
    conn.execute("INSERT INTO list_members(list_id, user_id, joined_at) VALUES (?,?,?)",
                 (list_id, user_id, datetime.now().isoformat()))
    conn.commit()
    conn.close()


def _item(u, lid):
    items = [x for x in u.get("/api/lists").json() if x["id"] == lid]
    return items[0] if items else None


def test_get_lists_has_pin_fields(client):
    u = U(client)
    lid = _workspace(u)
    it = _item(u, lid)
    assert it["pinned"] is True
    assert it["pin_position"] == 0


def test_put_pin_idempotent(client):
    u = U(client)
    ids = [_workspace(u) for _ in range(4)]
    u.get("/api/lists")  # seed: 3 workspace terbaru (ids[1..3]) di-pin
    lid = ids[0]
    r1 = u.put(f"/api/lists/{lid}/pin")
    r2 = u.put(f"/api/lists/{lid}/pin")
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json()["ok"] is True and r1.json()["pinned"] is True
    assert r1.json()["pin_position"] == r2.json()["pin_position"]
    assert _item(u, lid)["pinned"] is True


def test_pin_limit_409(client):
    u = U(client)
    ids = [_workspace(u) for _ in range(6)]
    u.get("/api/lists")  # seed: 3 workspace terbaru (ids[3..5]) di-pin
    assert u.put(f"/api/lists/{ids[0]}/pin").status_code == 200
    assert u.put(f"/api/lists/{ids[1]}/pin").status_code == 200
    r = u.put(f"/api/lists/{ids[2]}/pin")
    assert r.status_code == 409
    d = r.json()["detail"]
    assert d["code"] == "PIN_LIMIT"
    assert d["message"] == "Maksimal 5 workspace di-pin"


def test_put_pin_non_member_404(client):
    owner, other = U(client), U(client)
    lid = _workspace(owner)
    assert other.put(f"/api/lists/{lid}/pin").status_code == 404


def test_delete_pin_idempotent_and_orphan(client):
    owner, m = U(client), U(client)
    lid = _workspace(owner)
    _add_member(lid, m.id)
    assert m.put(f"/api/lists/{lid}/pin").status_code == 200
    r1 = m.delete(f"/api/lists/{lid}/pin")
    r2 = m.delete(f"/api/lists/{lid}/pin")
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json() == {"ok": True, "pinned": False}
    assert m.put(f"/api/lists/{lid}/pin").status_code == 200
    assert m.delete(f"/api/lists/{lid}/leave").status_code == 200
    assert m.delete(f"/api/lists/{lid}/pin").status_code == 200


def test_leave_endpoint_removes_pin(client):
    owner, m = U(client), U(client)
    lid = _workspace(owner)
    _add_member(lid, m.id)
    assert m.put(f"/api/lists/{lid}/pin").status_code == 200
    assert m.delete(f"/api/lists/{lid}/leave").status_code == 200
    _add_member(lid, m.id)
    assert _item(m, lid)["pinned"] is False


def test_owner_removes_member_removes_pin(client):
    owner, m = U(client), U(client)
    lid = _workspace(owner)
    _add_member(lid, m.id)
    assert m.put(f"/api/lists/{lid}/pin").status_code == 200
    assert owner.delete(f"/api/lists/{lid}/members/{m.id}").status_code == 200
    _add_member(lid, m.id)
    assert _item(m, lid)["pinned"] is False
