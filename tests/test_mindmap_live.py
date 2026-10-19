"""Temuan mindmap #4: sinyal SSE perubahan peta bersama."""
import asyncio
import os
import sys

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


def test_broadcast_failure_never_breaks_request(client, monkeypatch):
    a, b = U(client, "mmlv7a"), U(client, "mmlv7b")
    lid = _shared(a, b, "WS Live 7")
    m = a.mk_map("Live7", list_id=lid)
    q = asyncio.Queue()
    webapp.mindmap_subscribers[m["id"]].add((b.id, q))
    try:
        real_get_db = webapp.get_db

        def flaky_get_db():
            if sys._getframe(1).f_code.co_name == "_mindmap_broadcast":
                raise RuntimeError("boom")
            return real_get_db()
        monkeypatch.setattr(webapp, "get_db", flaky_get_db)
        r = a.put(f"/api/mindmaps/{m['id']}", json={"title": "Baru"})
        assert r.status_code == 200
        monkeypatch.undo()
        assert a.patch(f"/api/mindmaps/{m['id']}/share", json={"list_id": lid}).status_code == 200
        assert a.delete(f"/api/mindmaps/{m['id']}").status_code == 200
    finally:
        webapp.mindmap_subscribers.pop(m["id"], None)


def test_stream_rejects_linked_map(client):
    a = U(client, "mmlv8")
    note = a.post("/api/scratchpad", json={"title": "C", "content": "# A\n"}).json()
    lm = a.mk_map("x", source_note_id=note["id"])
    assert a.get(f"/api/mindmaps/{lm['id']}/stream").status_code == 404


def test_stream_generator_ends_on_deleted_and_cleans_up(client):
    a = U(client, "mmlv9")
    m = a.mk_map("Gen")

    class Req:
        async def is_disconnected(self):
            return False

    async def run():
        resp = await webapp.mindmap_stream(m["id"], Req(), user={"sub": a.id})
        it = resp.body_iterator
        first = asyncio.ensure_future(it.__anext__())
        for _ in range(50):
            if webapp.mindmap_subscribers.get(m["id"]):
                break
            await asyncio.sleep(0.01)
        assert webapp.mindmap_subscribers.get(m["id"])
        await webapp._mindmap_broadcast(m["id"], {"type": "mindmap_deleted", "id": m["id"]})
        ev = await asyncio.wait_for(first, 5)
        ended = False
        try:
            await asyncio.wait_for(it.__anext__(), 5)
        except StopAsyncIteration:
            ended = True
        return ev, ended
    ev, ended = asyncio.run(run())
    assert '"mindmap_deleted"' in ev["data"]
    assert ended
    assert m["id"] not in webapp.mindmap_subscribers


def test_full_queue_drops_subscriber(client):
    a = U(client, "mmlv10")
    m = a.mk_map("Full")

    async def run():
        q = asyncio.Queue(maxsize=1)
        q.put_nowait({"type": "x"})
        webapp.mindmap_subscribers[m["id"]].add((a.id, q))
        try:
            await webapp._mindmap_broadcast(m["id"], {"type": "mindmap_changed", "id": m["id"]})
            return set(webapp.mindmap_subscribers.get(m["id"], set()))
        finally:
            webapp.mindmap_subscribers.pop(m["id"], None)
    assert asyncio.run(run()) == set()


def test_stream_generator_stops_after_full_queue_drop(client):
    """Pelanggan yang dilepas karena antrean penuh harus ditutup (klien menyambung ulang), bukan tetap
    menerima ping selamanya sambil terlihat hidup."""
    a = U(client, "mmlv11")
    m = a.mk_map("Lambat")

    class Req:
        async def is_disconnected(self):
            return False

    async def run():
        resp = await webapp.mindmap_stream(m["id"], Req(), user={"sub": a.id})
        it = resp.body_iterator
        first = asyncio.ensure_future(it.__anext__())
        for _ in range(50):
            if webapp.mindmap_subscribers.get(m["id"]):
                break
            await asyncio.sleep(0.01)
        assert webapp.mindmap_subscribers.get(m["id"])
        # klien macet: 101 sinyal tanpa dikonsumsi → antrean (100) penuh → pelanggan dilepas
        for _ in range(101):
            await webapp._mindmap_broadcast(m["id"], {"type": "mindmap_changed", "id": m["id"], "updated_at": "t"})
        assert not webapp.mindmap_subscribers.get(m["id"])
        events = [await asyncio.wait_for(first, 5)]
        try:
            for _ in range(200):
                events.append(await asyncio.wait_for(it.__anext__(), 1))
        except StopAsyncIteration:
            return events, True
        except asyncio.TimeoutError:
            return events, False
        return events, False
    events, ended = asyncio.run(run())
    assert ended, "stream harus berakhir setelah pelanggan dilepas"
    assert not any('"ping"' in e["data"] for e in events)
