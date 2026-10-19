"""Temuan mindmap #4: sinyal SSE perubahan peta bersama."""
import asyncio
import os

import webapp
from conftest import register_user
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
    def put(self, url, **kw): return self._call("put", url, **kw)
    def patch(self, url, **kw): return self._call("patch", url, **kw)
    def delete(self, url, **kw): return self._call("delete", url, **kw)

    def mk_map(self, title, **kw):
        r = self.post("/api/mindmaps", json={"title": title, **kw})
        assert r.status_code == 200, r.text
        return r.json()


def _shared(owner, member, name):
    repo = TaskRepository(os.environ["DB_PATH"])
    lst = repo.create_shared_list(name, owner.id)
    repo.add_list_member(lst["id"], member.id)
    return lst["id"]


def _recorder(monkeypatch):
    calls = []

    async def rec(mid, event):
        calls.append((mid, event))
    monkeypatch.setattr(webapp, "_mindmap_broadcast", rec)
    return calls


def test_put_share_delete_broadcast(client, monkeypatch):
    calls = _recorder(monkeypatch)
    a, b = U(client, "mmlv1a"), U(client, "mmlv1b")
    lid = _shared(a, b, "WS Live 1")
    m = a.mk_map("Live", list_id=lid)
    r = b.put(f"/api/mindmaps/{m['id']}", json={"data_json": '{"nodeData":{"id":"root","topic":"x","root":true,"children":[]}}'})
    assert r.status_code == 200
    mid, ev = calls[-1]
    assert mid == m["id"] and ev["type"] == "mindmap_changed" and ev["updated_at"] == r.json()["updated_at"]
    assert ev["editor_id"] == b.id and ev["editor_name"]
    assert set(ev) == {"type", "id", "updated_at", "editor_id", "editor_name"}  # tanpa isi peta
    a.patch(f"/api/mindmaps/{m['id']}/share", json={"list_id": None})
    assert calls[-1][1]["type"] == "mindmap_changed"
    a.delete(f"/api/mindmaps/{m['id']}")
    assert calls[-1] == (m["id"], {"type": "mindmap_deleted", "id": m["id"]})


def test_restore_broadcasts_changed(client, monkeypatch):
    calls = _recorder(monkeypatch)
    a = U(client, "mmlv5")
    m = a.mk_map("Pulih")
    a.delete(f"/api/mindmaps/{m['id']}")
    n = len(calls)
    r = a.post(f"/api/mindmaps/trash/{m['id']}/restore")
    assert r.status_code == 200
    assert len(calls) == n + 1
    mid, ev = calls[-1]
    assert mid == m["id"] and ev["type"] == "mindmap_changed" and ev["editor_id"] == a.id


def test_linked_view_state_put_does_not_broadcast(client, monkeypatch):
    calls = _recorder(monkeypatch)
    a = U(client, "mmlv2")
    note = a.post("/api/scratchpad", json={"title": "C", "content": "# A\n"}).json()
    lm = a.mk_map("x", source_note_id=note["id"])
    a.put(f"/api/mindmaps/{lm['id']}", json={"data_json": '{"linked":1,"direction":1}'})
    assert calls == []


def test_broadcast_filters_subscribers_without_access(client):
    a, b, c = U(client, "mmlv3a"), U(client, "mmlv3b"), U(client, "mmlv3c")
    lid = _shared(a, b, "WS Live 3")
    m = a.mk_map("Live3", list_id=lid)

    async def run():
        qa, qb, qc = asyncio.Queue(), asyncio.Queue(), asyncio.Queue()
        webapp.mindmap_subscribers[m["id"]] |= {(a.id, qa), (b.id, qb), (c.id, qc)}
        try:
            await webapp._mindmap_broadcast(m["id"], {"type": "mindmap_changed", "id": m["id"]})
            return qa.get_nowait(), qb.get_nowait(), qc.get_nowait(), set(webapp.mindmap_subscribers.get(m["id"], set()))
        finally:
            webapp.mindmap_subscribers.pop(m["id"], None)
    ea, eb, ec, left = asyncio.run(run())
    assert ea["type"] == eb["type"] == "mindmap_changed"
    assert ec == {"type": "mindmap_access_lost", "id": m["id"]}
    assert all(uid != c.id for uid, _q in left)


def test_deleted_goes_to_all_subscribers(client):
    a, b = U(client, "mmlv6a"), U(client, "mmlv6b")
    lid = _shared(a, b, "WS Live 6")
    m = a.mk_map("Live6", list_id=lid)

    async def run():
        qa, qb = asyncio.Queue(), asyncio.Queue()
        webapp.mindmap_subscribers[m["id"]] |= {(a.id, qa), (b.id, qb)}
        try:
            await webapp._mindmap_broadcast(m["id"], {"type": "mindmap_deleted", "id": m["id"]})
            return qa.get_nowait(), qb.get_nowait()
        finally:
            webapp.mindmap_subscribers.pop(m["id"], None)
    ea, eb = asyncio.run(run())
    assert ea == eb == {"type": "mindmap_deleted", "id": m["id"]}


def test_stream_rejects_non_member(client):
    a, c = U(client, "mmlv4a"), U(client, "mmlv4c")
    m = a.mk_map("Privat")
    assert c.get(f"/api/mindmaps/{m['id']}/stream").status_code == 404
