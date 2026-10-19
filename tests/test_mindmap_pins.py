"""Temuan mindmap #8a: pin mindmap pribadi per user (spec 2026-10-19 §8a)."""
import os

import webapp
from conftest import db, register_user
from repository import TaskRepository


class U:
    def __init__(self, client, name):
        info = register_user(client, name, f"{name}@test.id")
        self.client = client
        self.id = info["user_id"]
        self.h = {"Authorization": f"Bearer {info['token']}"}

    def _call(self, method, url, **kw):
        self.client.cookies.clear()
        return getattr(self.client, method)(url, headers=self.h, **kw)

    def get(self, url, **kw): return self._call("get", url, **kw)
    def post(self, url, **kw): return self._call("post", url, **kw)
    def patch(self, url, **kw): return self._call("patch", url, **kw)

    def mk_map(self, title, **kw):
        r = self.post("/api/mindmaps", json={"title": title, **kw})
        assert r.status_code == 200, r.text
        return r.json()


def _shared(owner, member, name):
    repo = TaskRepository(os.environ["DB_PATH"])
    lst = repo.create_shared_list(name, owner.id)
    repo.add_list_member(lst["id"], member.id)
    return lst["id"]


def _item(user, mid):
    return next(x for x in user.get("/api/mindmaps").json() if x["id"] == mid)


def test_member_pins_shared_map_without_affecting_owner(client):
    a, b = U(client, "pinown1"), U(client, "pinmem1")
    lid = _shared(a, b, "WS Pin 1")
    m = a.mk_map("Peta Tim", list_id=lid)
    r = b.patch(f"/api/mindmaps/{m['id']}/pin", json={"pinned": True})
    assert r.status_code == 200, r.text
    assert r.json()["is_pinned"] == 1
    assert _item(b, m["id"])["is_pinned"] == 1
    assert _item(a, m["id"])["is_pinned"] == 0
    assert a.get(f"/api/mindmaps/{m['id']}").json()["is_pinned"] == 0


def test_explicit_pin_is_idempotent_and_legacy_toggle_still_works(client):
    a = U(client, "pinown2")
    m = a.mk_map("Satu")
    before = a.get(f"/api/mindmaps/{m['id']}").json()["updated_at"]
    for _ in range(2):
        assert a.patch(f"/api/mindmaps/{m['id']}/pin", json={"pinned": True}).json()["is_pinned"] == 1
    assert a.patch(f"/api/mindmaps/{m['id']}/pin").json()["is_pinned"] == 0  # tanpa body = toggle
    assert a.patch(f"/api/mindmaps/{m['id']}/pin").json()["is_pinned"] == 1
    assert a.get(f"/api/mindmaps/{m['id']}").json()["updated_at"] == before


def test_list_orders_by_own_pins(client):
    a = U(client, "pinown3")
    m1, m2 = a.mk_map("Lama"), a.mk_map("Baru")
    a.patch(f"/api/mindmaps/{m1['id']}/pin", json={"pinned": True})
    ids = [x["id"] for x in a.get("/api/mindmaps").json()]
    assert ids.index(m1["id"]) < ids.index(m2["id"])


def test_non_member_gets_404(client):
    a, c = U(client, "pinown4"), U(client, "pinout4")
    m = a.mk_map("Rahasia")
    assert c.patch(f"/api/mindmaps/{m['id']}/pin", json={"pinned": True}).status_code == 404


def test_migration_copies_owner_is_pinned_once(client):
    a = U(client, "pinmig5")
    m = a.mk_map("Warisan")
    conn = db()
    conn.execute("DROP TABLE IF EXISTS mindmap_pins")
    conn.execute("UPDATE mindmaps SET is_pinned = 1 WHERE id = ?", (m["id"],))
    conn.commit(); conn.close()
    webapp.migrate_db()
    assert a.get(f"/api/mindmaps/{m['id']}").json()["is_pinned"] == 1
    a.patch(f"/api/mindmaps/{m['id']}/pin", json={"pinned": False})
    webapp.migrate_db()  # tabel sudah ada → kolom lama tidak disalin ulang
    assert a.get(f"/api/mindmaps/{m['id']}").json()["is_pinned"] == 0
