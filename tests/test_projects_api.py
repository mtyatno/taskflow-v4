"""Task 3 (PR 4): API kelola project + pembaca lama (spec §5.2-5.3, §5.8)."""
import uuid
from datetime import datetime

import repository
from conftest import db, register_user


class U:
    def __init__(self, client, prefix="pa"):
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
    def delete(self, url, **kw): return self._call("delete", url, **kw)


def _n(p="Proj"):
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


def _mk(u, **body):
    body.setdefault("title", "t")
    r = u.post("/api/tasks", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _proj(u, name=None, list_id=None):
    body = {"name": name or _n()}
    if list_id is not None:
        body["list_id"] = list_id
    r = u.post("/api/projects", json=body)
    assert r.status_code == 200, r.text
    return r.json()


FULL_KEYS = {"id", "name", "list_id", "user_id", "color", "archived", "created_by",
             "active_task_count", "can_manage"}


def test_post_personal_returns_full_object(client):
    u = U(client)
    name = _n()
    p = _proj(u, f"  {name}  ")
    assert set(p) == FULL_KEYS
    assert p["name"] == name and p["user_id"] == u.id and p["list_id"] is None
    assert p["created_by"] == u.id and p["archived"] is False
    assert p["active_task_count"] == 0 and p["can_manage"] is True


def test_post_empty_name_400(client):
    u = U(client)
    assert u.post("/api/projects", json={"name": "   "}).status_code == 400


def test_post_reuses_nocase_and_reactivates_archived(client):
    u = U(client)
    p = _proj(u, "Alpha" + uuid.uuid4().hex[:6])
    assert u.patch(f"/api/projects/{p['id']}", json={"archived": True}).json()["archived"] is True
    p2 = _proj(u, p["name"].upper())
    assert p2["id"] == p["id"] and p2["archived"] is False


def test_get_legacy_string_list_personal_only_includes_empty_projects(client):
    u = U(client)
    b, a = _n("b"), _n("a")
    _proj(u, b)
    _proj(u, a)
    ws = _workspace(u)
    wsname = _n("wsonly")
    _proj(u, wsname, list_id=ws)
    r = u.get("/api/projects")
    assert r.status_code == 200
    names = r.json()
    assert all(isinstance(x, str) for x in names)
    assert names == sorted(names, key=str.lower)
    assert a in names and b in names and wsname not in names


def test_get_legacy_hides_archived(client):
    u = U(client)
    p = _proj(u)
    u.patch(f"/api/projects/{p['id']}", json={"archived": True})
    assert p["name"] not in u.get("/api/projects").json()
    full = u.get("/api/projects?format=full").json()
    assert p["id"] not in [x["id"] for x in full]
    full = u.get("/api/projects?format=full&include_archived=1").json()
    assert p["id"] in [x["id"] for x in full]


def test_get_workspace_names_and_membership(client):
    owner, member, outsider = U(client), U(client), U(client)
    ws = _workspace(owner)
    _add_member(ws, member.id)
    n = _n()
    _proj(member, n, list_id=ws)
    assert n in owner.get(f"/api/projects?list_id={ws}").json()
    assert n in member.get(f"/api/projects?list_id={ws}").json()
    r = outsider.get(f"/api/projects?list_id={ws}")
    assert r.status_code == 403 and r.json()["detail"] == "Kamu bukan anggota list ini"
    assert n not in owner.get("/api/projects").json()


def test_get_full_workspace_has_can_manage_per_user(client):
    owner, creator, other = U(client), U(client), U(client)
    ws = _workspace(owner)
    _add_member(ws, creator.id)
    _add_member(ws, other.id)
    p = _proj(creator, list_id=ws)
    assert p["list_id"] == ws and p["user_id"] is None and p["created_by"] == creator.id
    def cm(u):
        rows = u.get(f"/api/projects?format=full&list_id={ws}").json()
        return [x for x in rows if x["id"] == p["id"]][0]["can_manage"]
    assert cm(owner) is True and cm(creator) is True and cm(other) is False


def test_active_task_count(client):
    u = U(client)
    p = _proj(u)
    t1 = _mk(u, project=p["name"])
    _mk(u, project=p["name"])
    done = _mk(u, project=p["name"])
    u.client.cookies.clear()
    conn = db()
    conn.execute("UPDATE tasks SET gtd_status='done' WHERE id=?", (done["id"],))
    conn.commit(); conn.close()
    full = {x["id"]: x for x in u.get("/api/projects?format=full").json()}
    assert full[p["id"]]["active_task_count"] == 2
    assert t1["project_id"] == p["id"]


def test_patch_matrix_workspace(client):
    owner, creator, other, outsider = U(client), U(client), U(client), U(client)
    ws = _workspace(owner)
    _add_member(ws, creator.id)
    _add_member(ws, other.id)
    p = _proj(creator, list_id=ws)
    url = f"/api/projects/{p['id']}"
    r = other.patch(url, json={"name": _n()})
    assert r.status_code == 403 and r.json()["detail"] == "Hanya pembuat project atau owner workspace"
    r = other.delete(url)
    assert r.status_code == 403
    r = outsider.patch(url, json={"name": _n()})
    assert r.status_code == 404 and r.json()["detail"] == "Project tidak ditemukan"
    assert outsider.delete(url).status_code == 404
    assert creator.patch(url, json={"color": "#ff0000"}).json()["color"] == "#ff0000"
    assert owner.patch(url, json={"archived": True}).json()["archived"] is True
    assert owner.delete(url).status_code == 200


def test_personal_project_other_user_404_and_missing_404(client):
    a, b = U(client), U(client)
    p = _proj(a)
    assert b.patch(f"/api/projects/{p['id']}", json={"color": "x"}).status_code == 404
    assert b.delete(f"/api/projects/{p['id']}").status_code == 404
    assert a.patch("/api/projects/99999999", json={"color": "x"}).status_code == 404


def test_post_workspace_member_ok_nonmember_403(client):
    owner, member, outsider = U(client), U(client), U(client)
    ws = _workspace(owner)
    _add_member(ws, member.id)
    assert member.post("/api/projects", json={"name": _n(), "list_id": ws}).status_code == 200
    r = outsider.post("/api/projects", json={"name": _n(), "list_id": ws})
    assert r.status_code == 403 and r.json()["detail"] == "Kamu bukan anggota list ini"


def test_rename_propagates_to_tasks(client):
    u = U(client)
    p = _proj(u)
    t = _mk(u, project=p["name"])
    new = _n("Renamed")
    r = u.patch(f"/api/projects/{p['id']}", json={"name": f" {new} "})
    assert r.status_code == 200 and r.json()["name"] == new
    row = _row("SELECT project, project_id, updated_at FROM tasks WHERE id=?", t["id"])
    assert row["project"] == new and row["project_id"] == p["id"]
    assert row["updated_at"] >= t["updated_at"]


def test_rename_collision_409_nocase_and_same_name_ok(client):
    u = U(client)
    a, b = _proj(u), _proj(u)
    r = u.patch(f"/api/projects/{b['id']}", json={"name": a["name"].upper()})
    assert r.status_code == 409 and r.json()["detail"] == "Nama project sudah dipakai"
    # ganti kapital milik sendiri boleh
    assert u.patch(f"/api/projects/{b['id']}", json={"name": b["name"].upper()}).status_code == 200
    assert u.patch(f"/api/projects/{b['id']}", json={"name": "  "}).status_code == 400


def test_same_name_in_other_scope_does_not_collide(client):
    u = U(client)
    ws = _workspace(u)
    n = _n()
    _proj(u, n)
    w = _proj(u, n, list_id=ws)
    assert w["list_id"] == ws


def test_delete_clears_tasks(client):
    u = U(client)
    p = _proj(u)
    t1 = _mk(u, project=p["name"])
    _mk(u, project=p["name"])
    r = u.delete(f"/api/projects/{p['id']}")
    assert r.status_code == 200 and r.json() == {"ok": True, "tasks_cleared": 2}
    row = _row("SELECT project, project_id FROM tasks WHERE id=?", t1["id"])
    assert row["project"] == "" and row["project_id"] is None
    assert _row("SELECT 1 FROM projects WHERE id=?", p["id"]) is None


def test_repo_list_projects_reads_table(client):
    u = U(client)
    ws = _workspace(u)
    keep, arch, wsn = _n("k"), _n("a"), _n("w")
    _proj(u, keep)
    pa = _proj(u, arch)
    _proj(u, wsn, list_id=ws)
    u.patch(f"/api/projects/{pa['id']}", json={"archived": True})
    names = repository.TaskRepository(__import__("os").environ["DB_PATH"]).list_projects(u.id)
    assert keep in names and arch not in names and wsn not in names
    assert names == sorted(names, key=str.lower)


def test_patch_color_validation(client):
    u = U(client)
    p = _proj(u)
    url = f"/api/projects/{p['id']}"
    for bad in ("red", "#fff", "#12345g", "#1234567", ""):
        r = u.patch(url, json={"color": bad})
        assert r.status_code == 400 and r.json()["detail"] == "Warna harus format #rrggbb", bad
    assert u.patch(url, json={"color": "#A1b2C3"}).json()["color"] == "#A1b2C3"
    assert u.patch(url, json={"color": None}).json()["color"] is None


# ── PR 5 Task 1: scope=all ──

def test_scope_all_personal_and_member_workspaces(client):
    owner, member, outsider = U(client), U(client), U(client)
    ws = _workspace(owner)
    _add_member(ws, member.id)
    other_ws = _workspace(outsider)
    pn, wn, on = _n("pers"), _n("wsp"), _n("oth")
    pp = _proj(member, pn)
    wp = _proj(owner, wn, list_id=ws)
    _proj(outsider, on, list_id=other_ws)
    r = member.get("/api/projects", params={"format": "full", "scope": "all"})
    assert r.status_code == 200, r.text
    by_id = {p["id"]: p for p in r.json()}
    assert pp["id"] in by_id and wp["id"] in by_id
    assert set(by_id[wp["id"]]) == FULL_KEYS
    assert by_id[wp["id"]]["can_manage"] is False  # anggota bukan pembuat
    assert by_id[pp["id"]]["list_id"] is None
    assert on not in {p["name"] for p in by_id.values()}
    # owner juga melihat project workspace miliknya
    ro = owner.get("/api/projects", params={"format": "full", "scope": "all"}).json()
    assert wp["id"] in {p["id"] for p in ro}


def test_scope_all_include_archived(client):
    u = U(client)
    ws = _workspace(u)
    a = _proj(u, _n("arc"), list_id=ws)
    b = _proj(u, _n("arc"))
    for p in (a, b):
        assert u.patch(f"/api/projects/{p['id']}", json={"archived": True}).status_code == 200
    q = {"format": "full", "scope": "all"}
    ids = {p["id"] for p in u.get("/api/projects", params=q).json()}
    assert a["id"] not in ids and b["id"] not in ids
    ids = {p["id"] for p in u.get("/api/projects", params={**q, "include_archived": 1}).json()}
    assert a["id"] in ids and b["id"] in ids


def test_scope_all_requires_format_full(client):
    u = U(client)
    r = u.get("/api/projects", params={"scope": "all"})
    assert r.status_code == 400
    assert r.json()["detail"] == "scope=all hanya untuk format=full"


def test_no_query_still_returns_string_list(client):
    u = U(client)
    name = _n()
    _proj(u, name)
    r = u.get("/api/projects")
    assert r.status_code == 200 and name in r.json()
    assert all(isinstance(x, str) for x in r.json())
