"""Task 4: API /api/contexts (full, kelola, urutan) — spec §6, §10."""
import time
import uuid
from datetime import datetime

from conftest import db, register_user


class U:
    def __init__(self, client, prefix="ca"):
        name = f"{prefix}{uuid.uuid4().hex[:8]}"
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
    def put(self, url, **kw): return self._call("put", url, **kw)
    def delete(self, url, **kw): return self._call("delete", url, **kw)


def _n(p="Ctx"):
    return f"{p}{uuid.uuid4().hex[:8]}"


def _row(sql, *params):
    conn = db()
    try:
        return conn.execute(sql, params).fetchone()
    finally:
        conn.close()


def _workspace(u):
    r = u.post("/api/lists", json={"name": _n("WS")})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _add_member(list_id, user_id):
    conn = db()
    conn.execute("INSERT INTO list_members(list_id, user_id, joined_at) VALUES (?,?,?)",
                 (list_id, user_id, datetime.now().isoformat()))
    conn.commit()
    conn.close()


def _ctx(u, name=None, list_id=None):
    body = {"name": name or _n()}
    if list_id is not None:
        body["list_id"] = list_id
    r = u.post("/api/contexts", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _task(u, context, status="inbox", **extra):
    r = u.post("/api/tasks", json={"title": "t", "context": context, "gtd_status": status, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def _full(u, **params):
    q = {"format": "full", **params}
    r = u.get("/api/contexts", params=q)
    assert r.status_code == 200, r.text
    return r.json()


FULL_KEYS = {"id", "name", "list_id", "user_id", "position", "color", "archived", "created_by",
             "active_task_count", "task_count", "can_manage", "updated_at"}
STALE = "CONTEXT_ORDER_STALE"


def test_get_default_still_string_list(client):
    u = U(client)
    a, b, c = _n("A"), _n("B"), _n("C")
    _ctx(u, a); _ctx(u, b); _ctx(u, c)
    ws = _workspace(u)
    _ctx(u, _n("W"), ws)
    arch = _ctx(u, _n("Z"))
    assert u.patch(f"/api/contexts/{arch['id']}", json={"archived": True}).status_code == 200
    r = u.get("/api/contexts")
    assert r.status_code == 200
    assert r.json() == [a, b, c]  # urut posisi, tanpa task, tanpa arsip, tanpa W


def test_get_list_id_member_and_nonmember(client):
    a, b, d = U(client), U(client), U(client)
    ws = _workspace(a)
    _add_member(ws, b.id)
    name = _n()
    _ctx(a, name, ws)
    assert b.get("/api/contexts", params={"list_id": ws}).json() == [name]
    assert d.get("/api/contexts", params={"list_id": ws}).status_code == 404


def test_get_full_keys_and_scope_all(client):
    u = U(client)
    ws = _workspace(u)
    p = _ctx(u, _n("P"))
    w = _ctx(u, _n("W"), ws)
    arch = _ctx(u, _n("Z"))
    u.patch(f"/api/contexts/{arch['id']}", json={"archived": True})
    rows = u.get("/api/contexts", params={"format": "full", "scope": "all"}).json()
    ids = {r["id"] for r in rows}
    assert p["id"] in ids and w["id"] in ids and arch["id"] not in ids
    assert all(set(r) == FULL_KEYS for r in rows)
    assert u.get("/api/contexts", params={"scope": "all"}).status_code == 400
    rows = u.get("/api/contexts", params={"format": "full", "scope": "all", "include_archived": 1}).json()
    assert arch["id"] in {r["id"] for r in rows}


def test_post_creates_and_is_idempotent_by_name(client):
    u, d = U(client), U(client)
    name = _n("Review")
    c1 = _ctx(u, name)
    c2 = _ctx(u, name.lower())
    assert c1["id"] == c2["id"] and set(c1) == FULL_KEYS
    assert u.patch(f"/api/contexts/{c1['id']}", json={"archived": True}).status_code == 200
    c3 = _ctx(u, name)
    assert c3["id"] == c1["id"] and c3["archived"] is False
    assert u.post("/api/contexts", json={"name": "  "}).status_code == 400
    ws = _workspace(u)
    r = d.post("/api/contexts", json={"name": _n(), "list_id": ws})
    assert r.status_code == 404 and r.json()["detail"] == "Tahap tidak ditemukan"


def test_patch_archive_hides_from_default(client):
    u = U(client)
    name = _n()
    c = _ctx(u, name)
    t = _task(u, name)
    assert u.patch(f"/api/contexts/{c['id']}", json={"archived": True}).status_code == 200
    assert name not in u.get("/api/contexts").json()
    assert c["id"] in {r["id"] for r in _full(u, include_archived=1)}
    assert _row("SELECT context_id FROM tasks WHERE id=?", t["id"])["context_id"] == c["id"]
    r = u.patch(f"/api/contexts/{c['id']}", json={"archived": False})
    assert r.json()["archived"] is False
    assert name in u.get("/api/contexts").json()


def test_patch_rename_propagates_to_tasks(client):
    u = U(client)
    name, new = _n(), _n("New")
    c = _ctx(u, name)
    t = _task(u, name)
    before = _row("SELECT updated_at FROM tasks WHERE id=?", t["id"])["updated_at"]
    time.sleep(0.01)
    r = u.patch(f"/api/contexts/{c['id']}", json={"name": new})
    assert r.status_code == 200 and r.json()["name"] == new
    row = _row("SELECT context, updated_at FROM tasks WHERE id=?", t["id"])
    assert row["context"] == new and row["updated_at"] != before


def test_patch_rename_case_only_ok(client):
    u = U(client)
    name = _n("review")
    c = _ctx(u, name)
    r = u.patch(f"/api/contexts/{c['id']}", json={"name": name.capitalize()})
    assert r.status_code == 200 and r.json()["name"] == name.capitalize()


def test_patch_rename_taken_409(client):
    u = U(client)
    a, b = _ctx(u), _ctx(u)
    r = u.patch(f"/api/contexts/{b['id']}", json={"name": a["name"].upper()})
    assert r.status_code == 409
    assert r.json()["detail"] == {"code": "CONTEXT_NAME_TAKEN", "message": "Nama tahap sudah dipakai"}


def test_patch_color_validation(client):
    u = U(client)
    c = _ctx(u)
    r = u.patch(f"/api/contexts/{c['id']}", json={"color": "#12ab9F"})
    assert r.status_code == 200 and r.json()["color"] == "#12ab9F"
    assert u.patch(f"/api/contexts/{c['id']}", json={"color": "red"}).status_code == 400
    r = u.patch(f"/api/contexts/{c['id']}", json={"color": None})
    assert r.status_code == 200 and r.json()["color"] is None


def test_manage_matrix(client):
    a, b, c, d = U(client), U(client), U(client), U(client)
    ws = _workspace(a)
    _add_member(ws, b.id); _add_member(ws, c.id)
    ctx = _ctx(b, _n(), ws)
    url = f"/api/contexts/{ctx['id']}"
    assert b.patch(url, json={"color": "#112233"}).status_code == 200
    assert a.patch(url, json={"color": "#112233"}).status_code == 200
    for who in (c, d):
        r = who.patch(url, json={"color": "#112233"})
        assert r.status_code == 404 and r.json()["detail"] == "Tahap tidak ditemukan"
    can = lambda u: {r["id"]: r["can_manage"] for r in _full(u, list_id=ws)}[ctx["id"]]
    assert can(a) is True and can(b) is True and can(c) is False
    mine = _ctx(a, _n())
    assert b.patch(f"/api/contexts/{mine['id']}", json={"archived": True}).status_code == 404


def test_order_writes_positions(client):
    u = U(client)
    cs = [_ctx(u, _n(x)) for x in "ABC"]
    ids = [c["id"] for c in reversed(cs)]
    r = u.put("/api/contexts/order", json={"ids": ids})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["ok"] is True
    assert [c["id"] for c in body["contexts"]] == ids
    assert [c["position"] for c in body["contexts"]] == [0, 1, 2]
    assert u.get("/api/contexts").json() == [c["name"] for c in reversed(cs)]


def test_order_stale_variants(client):
    u, o = U(client), U(client)
    cs = [_ctx(u, _n(x)) for x in "ABC"]
    ids = [c["id"] for c in cs]
    other = _ctx(o)
    arch = _ctx(u)
    u.patch(f"/api/contexts/{arch['id']}", json={"archived": True})
    for bad in (ids[:-1], ids + [other["id"]], ids + [ids[0]], ids + [arch["id"]]):
        r = u.put("/api/contexts/order", json={"ids": bad})
        assert r.status_code == 409, bad
        assert r.json()["detail"] == {"code": STALE, "message": "Urutan tahap sudah berubah, muat ulang"}
    assert [c["id"] for c in _full(u)] == ids
    assert [c["position"] for c in _full(u)] == [0, 1, 2]


def test_order_workspace_permissions(client):
    a, b, c, d = U(client), U(client), U(client), U(client)
    ws = _workspace(a)
    _add_member(ws, b.id); _add_member(ws, c.id)
    x = _ctx(a, _n("X"), ws)   # milik A
    y = _ctx(b, _n("Y"), ws)   # buatan B
    z = _ctx(a, _n("Z"), ws)   # milik A
    X, Y, Z = x["id"], y["id"], z["id"]
    # C (bukan pembuat/owner) menggeser Y -> 404; non-anggota -> 404
    r = c.put("/api/contexts/order", json={"list_id": ws, "ids": [Y, X, Z]})
    assert r.status_code == 404 and r.json()["detail"] == "Tahap tidak ditemukan"
    assert d.put("/api/contexts/order", json={"list_id": ws, "ids": [X, Y, Z]}).status_code == 404
    # B menggeser Y ke depan: X ikut bergeser (bukan milik B) -> 404, posisi tak berubah
    assert b.put("/api/contexts/order", json={"list_id": ws, "ids": [Y, X, Z]}).status_code == 404
    assert [i["id"] for i in _full(a, list_id=ws)] == [X, Y, Z]
    # A boleh semua
    r = a.put("/api/contexts/order", json={"list_id": ws, "ids": [Y, Z, X]})
    assert r.status_code == 200
    assert [i["id"] for i in r.json()["contexts"]] == [Y, Z, X]


def test_order_member_moves_only_own_contexts(client):
    a, b = U(client), U(client)
    ws = _workspace(a)
    _add_member(ws, b.id)
    x = _ctx(a, _n("X"), ws)
    y = _ctx(b, _n("Y"), ws)
    y2 = _ctx(b, _n("Y2"), ws)
    # posisi: x0 y1 y2_2 ; B menukar y dan y2 (hanya milik B) -> 200, x tetap
    r = b.put("/api/contexts/order", json={"list_id": ws, "ids": [x["id"], y2["id"], y["id"]]})
    assert r.status_code == 200, r.text
    pos = {c["id"]: c["position"] for c in r.json()["contexts"]}
    assert pos == {x["id"]: 0, y2["id"]: 1, y["id"]: 2}


def test_delete_clears_tasks(client):
    u = U(client)
    name = _n()
    c = _ctx(u, name)
    t1 = _task(u, name)
    t2 = _task(u, name, status="done")
    time.sleep(0.01)
    before = {t["id"]: _row("SELECT updated_at FROM tasks WHERE id=?", t["id"])["updated_at"] for t in (t1, t2)}
    r = u.delete(f"/api/contexts/{c['id']}")
    assert r.status_code == 200 and r.json() == {"ok": True, "tasks_cleared": 2}
    for t in (t1, t2):
        row = _row("SELECT context, context_id, updated_at FROM tasks WHERE id=?", t["id"])
        assert row["context"] == "" and row["context_id"] is None
        assert row["updated_at"] != before[t["id"]]
    assert _row("SELECT 1 FROM contexts WHERE id=?", c["id"]) is None
    assert u.delete(f"/api/contexts/{c['id']}").status_code == 404


def test_workspace_delete_cascades(client):
    u = U(client)
    ws = _workspace(u)
    name = _n()
    c = _ctx(u, name, ws)
    t = _task(u, name, list_id=ws)
    try:
        assert _row("SELECT context_id FROM tasks WHERE id=?", t["id"])["context_id"] == c["id"]
        r = u.delete(f"/api/lists/{ws}")
        assert r.status_code == 200, r.text
        assert _row("SELECT 1 FROM contexts WHERE id=?", c["id"]) is None
        row = _row("SELECT context, context_id FROM tasks WHERE id=?", t["id"])
        assert row is None or row["context_id"] is None
    finally:  # jangan tinggalkan task bertext context + context_id NULL (tes skema bergantung hitungan global)
        conn = db()
        conn.execute("DELETE FROM tasks WHERE id=?", (t["id"],))
        conn.commit()
        conn.close()
