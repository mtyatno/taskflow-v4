"""Temuan mindmap #5: Sampah mindmap (spec 2026-10-19 §5)."""
import json
import os
from datetime import datetime, timedelta

import pytz

from conftest import db, register_user
from repository import TaskRepository

JKT = pytz.timezone("Asia/Jakarta")
DATA = json.dumps({"nodeData": {"id": "root", "topic": "Rencana", "root": True, "children": [
    {"id": "a", "topic": "Satu", "children": []},
    {"id": "b", "topic": "**Dua**", "children": []}]}})


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
    def put(self, url, **kw): return self._call("put", url, **kw)
    def patch(self, url, **kw): return self._call("patch", url, **kw)
    def delete(self, url, **kw): return self._call("delete", url, **kw)

    def mk_map(self, title, **kw):
        r = self.post("/api/mindmaps", json={"title": title, **kw})
        assert r.status_code == 200, r.text
        return r.json()

    def trash_ids(self):
        r = self.get("/api/mindmaps/trash")
        assert r.status_code == 200, r.text
        return [i["id"] for i in r.json()]


def _shared(owner, member, name):
    repo = TaskRepository(os.environ["DB_PATH"])
    lst = repo.create_shared_list(name, owner.id)
    repo.add_list_member(lst["id"], member.id)
    return lst["id"]


def _row(sql, *params):
    conn = db()
    try:
        return conn.execute(sql, params).fetchone()
    finally:
        conn.close()


def test_delete_moves_to_trash_and_restore_keeps_id_client_id_pin(client):
    a = U(client, "mmtr1")
    m = a.mk_map("Rencana", data_json=DATA, client_id="cid-tr-1")
    a.patch(f"/api/mindmaps/{m['id']}/pin", json={"pinned": True})
    r = a.delete(f"/api/mindmaps/{m['id']}")
    assert r.status_code == 200 and r.json() == {"ok": True, "trashed": True}
    assert m["id"] not in [x["id"] for x in a.get("/api/mindmaps?linked=1").json()]
    assert a.get(f"/api/mindmaps/{m['id']}").status_code == 404
    it = next(i for i in a.get("/api/mindmaps/trash").json() if i["id"] == m["id"])
    assert it["title"] == "Rencana" and it["client_id"] == "cid-tr-1" and it["linked"] is False
    assert it["preview"] == "Satu · Dua" and it["days_left"] == 30
    r = a.post(f"/api/mindmaps/trash/{m['id']}/restore")
    assert r.status_code == 200, r.text
    row = r.json()
    assert (row["id"], row["client_id"], row["is_pinned"], row["data_json"]) == (m["id"], "cid-tr-1", 1, DATA)
    assert m["id"] not in a.trash_ids()


def test_member_cannot_delete_and_repeat_delete_is_idempotent(client):
    a, b = U(client, "mmtr2a"), U(client, "mmtr2b")
    lid = _shared(a, b, "WS Trash 2")
    m = a.mk_map("Tim", list_id=lid)
    assert b.delete(f"/api/mindmaps/{m['id']}").status_code == 403
    assert a.delete(f"/api/mindmaps/{m['id']}").status_code == 200
    assert a.delete(f"/api/mindmaps/{m['id']}").json() == {"ok": True, "trashed": True}
    assert b.delete(f"/api/mindmaps/{m['id']}").status_code == 404
    assert b.post(f"/api/mindmaps/trash/{m['id']}/restore").status_code == 404
    assert a.delete("/api/mindmaps/987654321").status_code == 404


def test_expired_items_are_purged_lazily(client):
    a = U(client, "mmtr3")
    m = a.mk_map("Tua")
    a.delete(f"/api/mindmaps/{m['id']}")
    old = (datetime.now(JKT) - timedelta(days=31)).isoformat()
    conn = db()
    conn.execute("UPDATE trashed_mindmaps SET deleted_at = ? WHERE mindmap_id = ?", (old, m["id"]))
    conn.commit(); conn.close()
    assert m["id"] not in a.trash_ids()
    assert _row("SELECT 1 FROM trashed_mindmaps WHERE mindmap_id = ?", m["id"]) is None


def test_purge_one_and_empty(client):
    a = U(client, "mmtr4")
    maps = [a.mk_map(t) for t in ("P1", "P2", "P3")]
    for m in maps:
        a.delete(f"/api/mindmaps/{m['id']}")
    assert a.delete(f"/api/mindmaps/trash/{maps[0]['id']}").json() == {"ok": True}
    assert a.post(f"/api/mindmaps/trash/{maps[0]['id']}/restore").status_code == 404
    assert a.delete("/api/mindmaps/trash").json() == {"ok": True, "deleted": 2}
    assert a.trash_ids() == []


def test_linked_map_restore_rules(client):
    a = U(client, "mmtr5")
    note = a.post("/api/scratchpad", json={"title": "Catatan", "content": "# A\n"}).json()
    lm = a.mk_map("x", source_note_id=note["id"])
    a.delete(f"/api/mindmaps/{lm['id']}")
    it = next(i for i in a.get("/api/mindmaps/trash").json() if i["id"] == lm["id"])
    assert it["linked"] is True and it["source_note_id"] == note["id"]
    lm2 = a.mk_map("x", source_note_id=note["id"])  # catatan dipetakan ulang
    assert lm2["id"] != lm["id"]
    r = a.post(f"/api/mindmaps/trash/{lm['id']}/restore")
    assert r.status_code == 200 and r.json()["id"] == lm2["id"]
    assert lm["id"] not in a.trash_ids()
    a.delete(f"/api/mindmaps/{lm2['id']}")
    a.delete(f"/api/scratchpad/{note['id']}")  # catatan ke Sampah catatan
    r = a.post(f"/api/mindmaps/trash/{lm2['id']}/restore")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "SOURCE_NOTE_MISSING"
    a.delete(f"/api/scratchpad/trash/{note['id']}")  # catatan dihapus permanen
    assert lm2["id"] not in a.trash_ids()


def test_restore_drops_list_id_when_workspace_gone(client):
    a, b = U(client, "mmtr6a"), U(client, "mmtr6b")
    lid = _shared(a, b, "WS Hilang")
    m = a.mk_map("Tim", list_id=lid)
    a.delete(f"/api/mindmaps/{m['id']}")
    conn = db()
    conn.execute("DELETE FROM list_members WHERE list_id = ?", (lid,))
    conn.execute("DELETE FROM shared_lists WHERE id = ?", (lid,))
    conn.commit(); conn.close()
    row = a.post(f"/api/mindmaps/trash/{m['id']}/restore").json()
    assert row["list_id"] is None
