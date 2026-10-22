"""Pindah task pribadi ke workspace: PATCH /api/tasks/{id}/workspace."""
import io

from test_contexts_tasks import U, _n, _row, _workspace, _add_member, _mk


def _move(u, task_id, list_id):
    return u.patch(f"/api/tasks/{task_id}/workspace", json={"list_id": list_id})


def test_move_sets_list_and_rescopes_project_context(client):
    u = U(client, "mv")
    ws = _workspace(u)
    proj, ctx = _n("Proj"), _n("Tahap")
    t = _mk(u, project=proj, context=ctx)
    old = _row("SELECT project_id, context_id, updated_at FROM tasks WHERE id = ?", t["id"])
    r = _move(u, t["id"], ws)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["list_id"] == ws and out["project"] == proj and out["context"] == ctx
    assert out["moved_ids"] == [t["id"]]
    p = _row("SELECT * FROM projects WHERE id = ?", out["project_id"])
    c = _row("SELECT * FROM contexts WHERE id = ?", out["context_id"])
    assert p["list_id"] == ws and p["user_id"] is None and out["project_id"] != old["project_id"]
    assert c["list_id"] == ws and out["context_id"] != old["context_id"]
    assert out["updated_at"] != old["updated_at"]


def test_move_reuses_existing_workspace_project_nocase(client):
    u = U(client, "mv")
    ws = _workspace(u)
    proj = _n("Proj")
    w = _mk(u, title="w", project=proj, list_id=ws)
    t = _mk(u, project=proj.upper())
    out = _move(u, t["id"], ws).json()
    assert out["project_id"] == w["project_id"] and out["project"] == proj


def test_move_member_sees_task_and_children_follow(client):
    owner, member = U(client, "mo"), U(client, "mm")
    ws = _workspace(owner)
    _add_member(ws, member.id)
    parent = _mk(member, title="induk")
    child = _mk(member, title="anak", parent_id=parent["id"])
    grand = _mk(member, title="cucu", parent_id=child["id"])
    r = _move(member, parent["id"], ws)
    assert r.status_code == 200, r.text
    assert r.json()["moved_ids"] == [parent["id"], child["id"], grand["id"]]
    for tid in (parent["id"], child["id"], grand["id"]):
        assert _row("SELECT list_id FROM tasks WHERE id = ?", tid)["list_id"] == ws
    ids = {x["id"] for x in owner.get("/api/tasks?include_done=true").json()}
    assert {parent["id"], child["id"], grand["id"]} <= ids


def test_move_registers_attachments_in_workspace_files(client):
    u = U(client, "mv")
    ws = _workspace(u)
    t = _mk(u)
    up = u.post(f"/api/tasks/{t['id']}/attachments",
                files={"file": ("a.txt", io.BytesIO(b"hi"), "text/plain")})
    assert up.status_code == 200, up.text
    assert _move(u, t["id"], ws).status_code == 200
    f = _row("SELECT * FROM workspace_files WHERE list_id = ? AND task_id = ?", ws, t["id"])
    assert f is not None and f["original_name"] == "a.txt" and f["source"] == "task"


def test_move_rejects_non_member_other_owner_subtask_and_workspace_task(client):
    u, other = U(client, "mv"), U(client, "mx")
    ws, other_ws = _workspace(u), _workspace(other)
    t = _mk(u)
    assert _move(u, t["id"], other_ws).status_code == 403
    assert _move(other, t["id"], other_ws).status_code == 404
    child = _mk(u, parent_id=t["id"])
    assert _move(u, child["id"], ws).status_code == 400
    in_ws = _mk(u, list_id=ws)
    assert _move(u, in_ws["id"], ws).status_code == 400
    assert _row("SELECT list_id FROM tasks WHERE id = ?", t["id"])["list_id"] is None
