"""Hitungan checklist/catatan/lampiran banyak task sekaligus: GET /api/tasks/child-counts.

Halaman Fokus dulu memanggil 3 GET per task (subtasks, notes, attachments) serentak; antrean
koneksi browser membuat POST tambah checklist/catatan tertahan sampai timeout 15 dtk.
"""
import io

from test_contexts_tasks import U, _workspace, _add_member, _mk


def _counts(u, ids):
    r = u.get(f"/api/tasks/child-counts?ids={ids}")
    assert r.status_code == 200, r.text
    return r.json()["counts"]


def _sub(u, task_id, title="c"):
    r = u.post(f"/api/tasks/{task_id}/subtasks", json={"title": title})
    assert r.status_code == 200, r.text
    return r.json()


def _note(u, task_id, content="n"):
    r = u.post(f"/api/tasks/{task_id}/notes", json={"content": content})
    assert r.status_code == 200, r.text


def _att(u, task_id, name="a.txt"):
    r = u.post(f"/api/tasks/{task_id}/attachments",
               files={"file": (name, io.BytesIO(b"hi"), "text/plain")})
    assert r.status_code == 200, r.text


def test_counts_match_per_task_endpoints_including_done(client):
    u = U(client, "cc")
    t, empty = _mk(u, title="penuh"), _mk(u, title="kosong")
    s1 = _sub(u, t["id"], "a")
    _sub(u, t["id"], "b")
    s3 = _sub(u, t["id"], "c")
    for sid in (s1["id"], s3["id"]):
        assert u.post(f"/api/subtasks/{sid}/toggle").status_code == 200
    _note(u, t["id"], "satu")
    _note(u, t["id"], "dua")
    _att(u, t["id"])

    counts = _counts(u, f"{t['id']},{empty['id']}")
    assert counts == {
        str(t["id"]): {"sub_total": 3, "sub_done": 2, "notes": 2, "atts": 1},
        str(empty["id"]): {"sub_total": 0, "sub_done": 0, "notes": 0, "atts": 0},
    }
    # Sama dengan panjang daftar dari endpoint per task.
    subs = u.get(f"/api/tasks/{t['id']}/subtasks").json()
    assert len(subs) == 3 and sum(1 for s in subs if s["is_done"]) == 2
    assert len(u.get(f"/api/tasks/{t['id']}/notes").json()) == 2
    assert len(u.get(f"/api/tasks/{t['id']}/attachments").json()) == 1


def test_other_users_private_task_and_missing_ids_omitted(client):
    u, other = U(client, "cc"), U(client, "cx")
    mine, theirs = _mk(u), _mk(other)
    _sub(other, theirs["id"])
    counts = _counts(u, f"{mine['id']},{theirs['id']},999999999")
    assert set(counts) == {str(mine["id"])}


def test_workspace_task_visible_to_owner_and_member_not_outsider(client):
    owner, member, outsider = U(client, "co"), U(client, "cm"), U(client, "cz")
    ws = _workspace(owner)
    _add_member(ws, member.id)
    by_member = _mk(member, title="anggota", list_id=ws)
    by_owner = _mk(owner, title="pemilik", list_id=ws)
    _sub(member, by_member["id"])
    _note(owner, by_owner["id"])
    ids = f"{by_member['id']},{by_owner['id']}"
    expected = {
        str(by_member["id"]): {"sub_total": 1, "sub_done": 0, "notes": 0, "atts": 0},
        str(by_owner["id"]): {"sub_total": 0, "sub_done": 0, "notes": 1, "atts": 0},
    }
    assert _counts(owner, ids) == expected
    assert _counts(member, ids) == expected
    assert _counts(outsider, ids) == {}


def test_non_numeric_tokens_ignored_and_ids_deduped(client):
    u = U(client, "cc")
    t = _mk(u)
    _sub(u, t["id"])
    tid = t["id"]
    ids = f"abc,{tid}x,,-3,1.5,0, {tid} ,{tid},{tid},c_123,99999999999999999999999999"
    assert _counts(u, ids) == {str(tid): {"sub_total": 1, "sub_done": 0, "notes": 0, "atts": 0}}


def test_more_than_500_ids_rejected_500_allowed(client):
    u = U(client, "cc")
    t = _mk(u)
    five_hundred = [str(t["id"])] + [str(10_000_000 + i) for i in range(499)]
    assert set(_counts(u, ",".join(five_hundred))) == {str(t["id"])}
    # Duplikat dihitung sekali: 600 token dengan id sama tetap 1 id.
    assert set(_counts(u, ",".join([str(t["id"])] * 600))) == {str(t["id"])}
    r = u.get("/api/tasks/child-counts?ids=" + ",".join(five_hundred + ["20000000"]))
    assert r.status_code == 400
    assert "500" in r.json()["detail"]


def test_empty_or_missing_ids_returns_empty_counts(client):
    u = U(client, "cc")
    assert _counts(u, "") == {}
    assert _counts(u, ",,,") == {}
    r = u.get("/api/tasks/child-counts")
    assert r.status_code == 200, r.text
    assert r.json() == {"counts": {}}


def test_route_not_swallowed_by_task_detail_route(client):
    u = U(client, "cc")
    t = _mk(u, title="detail")
    # Tanpa urutan route yang benar, "child-counts" ditangkap /api/tasks/{task_id} → 422.
    r = u.get("/api/tasks/child-counts?ids=1")
    assert r.status_code == 200, r.text
    assert "counts" in r.json()
    d = u.get(f"/api/tasks/{t['id']}")
    assert d.status_code == 200 and d.json()["title"] == "detail"


def test_unauthenticated_is_401(client):
    client.cookies.clear()
    assert client.get("/api/tasks/child-counts?ids=1").status_code == 401
