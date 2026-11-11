"""API checklist offline (spec checklist offline Fase 2 §3.2–§3.3, E3–E4; rencana PR A2 T3, R5–R6):
`PATCH /api/subtasks/{id}` dengan `title` dan/atau `is_done` (centang SET, aman diulang), unduhan banyak
checklist sekaligus `GET /api/checklists?task_ids=…`, dan `rev` di semua respons tulis checklist."""
import uuid

import pytest
from fastapi import HTTPException

import webapp
from conftest import db
from test_contexts_tasks import U, _add_member, _mk, _workspace

KEYS = {"id", "task_id", "parent_id", "depth", "title", "is_done", "sort_order"}
T_KOSONG = "Teks butir tidak boleh kosong"
T_TANPA_PERUBAHAN = "Tidak ada perubahan"
T_MAKS = "Maksimal 200 id task per request"
T_TIDAK_VALID = "task_ids tidak valid"


def _add(u, tid, title="b", **body):
    r = u.post(f"/api/tasks/{tid}/subtasks", json={"title": title, **body})
    assert r.status_code == 200, r.text
    return r.json()


def _list(u, tid):
    r = u.get(f"/api/tasks/{tid}/subtasks")
    assert r.status_code == 200, r.text
    return r.json()


def _batch(u, ids):
    r = u.get("/api/checklists", params={"task_ids": ids if isinstance(ids, str) else ",".join(map(str, ids))})
    assert r.status_code == 200, r.text
    return r.json()


def _kolom(tid, *cols):
    conn = db()
    try:
        return tuple(conn.execute(f"SELECT {', '.join(cols)} FROM tasks WHERE id = ?", (tid,)).fetchone())
    finally:
        conn.close()


def _pohon(u, tid):
    a = _add(u, tid, "a")["id"]
    b = _add(u, tid, "b")["id"]
    a1 = _add(u, tid, "a1", parent_id=a)["id"]
    a11 = _add(u, tid, "a11", parent_id=a1)["id"]
    return a, b, a1, a11


# ── PATCH {is_done} / {title} ───────────────────────────────────────────────

def test_patch_is_done_true_berantai_dengan_rev_lalu_diulang_tanpa_perubahan(client):
    u = U(client, "oa")
    tid = _mk(u)["id"]
    a, b, a1, a11 = _pohon(u, tid)
    sebelum = _kolom(tid, "updated_at")[0]
    r = u.patch(f"/api/subtasks/{a}", json={"is_done": True})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == KEYS | {"changed_ids", "task_progress"}
    assert body["id"] == a and body["is_done"] is True and body["changed_ids"] == [a, a1, a11]
    assert body["task_progress"] == {"done": 1, "total": 2, "progress": 50, "rev": 5}
    r = u.patch(f"/api/subtasks/{a}", json={"is_done": True})
    assert r.status_code == 200, r.text
    assert r.json()["changed_ids"] == [] and r.json()["task_progress"]["rev"] == 5
    assert all(i["is_done"] for i in _list(u, tid) if i["id"] != b)
    assert _kolom(tid, "updated_at", "checklist_rev") == (sebelum, 5)


def test_patch_is_done_false_hanya_butir_itu(client):
    u = U(client, "ob")
    tid = _mk(u)["id"]
    a, b, a1, a11 = _pohon(u, tid)
    u.patch(f"/api/subtasks/{a}", json={"is_done": True})
    r = u.patch(f"/api/subtasks/{a}", json={"is_done": False})
    assert r.status_code == 200 and r.json()["changed_ids"] == [a] and r.json()["is_done"] is False
    assert {i["id"]: i["is_done"] for i in _list(u, tid)} == {a: False, a1: True, a11: True, b: False}


def test_patch_kosong_atau_null_422_teks_persis_tanpa_perubahan(client):
    u = U(client, "oc")
    tid = _mk(u)["id"]
    a = _add(u, tid, "a")["id"]
    for body in ({}, {"title": None}, {"is_done": None}, {"title": None, "is_done": None}):
        r = u.patch(f"/api/subtasks/{a}", json=body)
        assert r.status_code == 422 and r.json()["detail"] == T_TANPA_PERUBAHAN, (body, r.text)
    assert _kolom(tid, "checklist_rev") == (1,)


def test_patch_title_bentuk_lama_tetap_ditambah_changed_ids_kosong(client):
    u = U(client, "od")
    tid = _mk(u)["id"]
    a = _add(u, tid, "a")["id"]
    r = u.patch(f"/api/subtasks/{a}", json={"title": "  baru  "})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == KEYS | {"changed_ids", "task_progress"}
    assert body["title"] == "baru" and body["changed_ids"] == []
    assert body["task_progress"] == {"done": 0, "total": 1, "progress": 0, "rev": 2}
    for kosong in ("", "   "):
        r = u.patch(f"/api/subtasks/{a}", json={"title": kosong, "is_done": True})
        assert r.status_code == 422 and r.json()["detail"] == T_KOSONG
    assert _list(u, tid)[0]["is_done"] is False
    r = u.patch("/api/subtasks/987654321", json={"is_done": True})
    assert r.status_code == 404 and r.json()["detail"] == "Subtask not found"


def test_patch_title_dan_is_done_satu_kenaikan_dan_is_done_bukan_boolean_422(client):
    u = U(client, "oe")
    tid = _mk(u)["id"]
    a = _add(u, tid, "a")["id"]
    r = u.patch(f"/api/subtasks/{a}", json={"title": "A", "is_done": True})
    assert r.status_code == 200 and r.json()["title"] == "A" and r.json()["changed_ids"] == [a]
    assert r.json()["task_progress"]["rev"] == 2
    assert u.patch(f"/api/subtasks/{a}", json={"is_done": "bukan"}).status_code == 422
    assert u.patch(f"/api/subtasks/{a}", json={"is_done": [True]}).status_code == 422
    assert _kolom(tid, "checklist_rev") == (2,)


def test_patch_anggota_workspace_boleh_orang_luar_403(client):
    a, b, luar = U(client, "of1"), U(client, "of2"), U(client, "of3")
    ws = _workspace(a)
    _add_member(ws, b.id)
    tid = _mk(a, title="tim", list_id=ws)["id"]
    s = _add(a, tid, "s")["id"]
    for body in ({"is_done": True}, {"title": "jahat"}, {}):
        r = luar.patch(f"/api/subtasks/{s}", json=body)
        assert r.status_code == 403, r.text
    assert _list(a, tid)[0]["is_done"] is False
    r = b.patch(f"/api/subtasks/{s}", json={"is_done": True})
    assert r.status_code == 200 and r.json()["changed_ids"] == [s]


# ── POST: idempotensi client_id per task (E4) ───────────────────────────────

def test_post_client_id_task_lain_tidak_mengembalikan_butir_orang_lain(client):
    a, b = U(client, "og1"), U(client, "og2")
    ta, tb = _mk(a, title="punya a")["id"], _mk(b, title="punya b")["id"]
    cid = f"cid-{uuid.uuid4().hex}"
    rahasia = _add(a, ta, "rahasia a", client_id=cid)
    r = _add(b, tb, "milik b", client_id=cid)
    assert r["id"] != rahasia["id"] and r["task_id"] == tb and r["title"] == "milik b"
    ulang = _add(a, ta, "kirim ulang", client_id=cid)
    assert ulang["id"] == rahasia["id"] and ulang["title"] == "rahasia a"
    assert ulang["task_progress"]["rev"] == 1
    assert [i["title"] for i in _list(a, ta)] == ["rahasia a"]


# ── GET /api/checklists ─────────────────────────────────────────────────────

def test_batch_hanya_task_yang_bisa_dibaca_kunci_string_items_sama_dengan_get(client):
    u, lain = U(client, "oh1"), U(client, "oh2")
    t1, t2 = _mk(u, title="satu")["id"], _mk(u, title="dua")["id"]
    a, b, a1, a11 = _pohon(u, t1)
    u.patch(f"/api/subtasks/{a1}", json={"is_done": True})
    _add(u, t2, "x")
    asing = _mk(lain, title="asing")["id"]
    _add(lain, asing, "rahasia")
    body = _batch(u, [t1, asing, 987654321, t2])
    assert set(body) == {str(t1), str(t2)}
    assert body[str(t1)] == {"rev": 5, "items": _list(u, t1)}
    assert body[str(t2)] == {"rev": 1, "items": _list(u, t2)}
    assert [(i["id"], i["depth"]) for i in body[str(t1)]["items"]] == [(a, 0), (a1, 1), (a11, 2), (b, 0)]


def test_batch_task_tanpa_butir_ikut_dengan_items_kosong_dan_id_ganda_sekali(client):
    u = U(client, "oi")
    t = _mk(u)["id"]
    assert _batch(u, f"{t}, {t},{t}") == {str(t): {"rev": 0, "items": []}}
    s = _add(u, t, "s")["id"]
    u.delete(f"/api/subtasks/{s}")
    assert _batch(u, [t]) == {str(t): {"rev": 2, "items": []}}


def test_batch_kosong_dan_tanpa_parameter_objek_kosong(client):
    u = U(client, "oj")
    for params in ({}, {"task_ids": ""}, {"task_ids": " , ,"}):
        r = u.get("/api/checklists", params=params)
        assert r.status_code == 200 and r.json() == {}, (params, r.text)


def test_batch_200_id_boleh_201_ditolak_teks_persis(client):
    u = U(client, "ok")
    t = _mk(u)["id"]
    ids = [t] + list(range(10 ** 12, 10 ** 12 + 199))   # 200 id unik
    assert set(_batch(u, ids)) == {str(t)}
    r = u.get("/api/checklists", params={"task_ids": ",".join(map(str, ids + [10 ** 13]))})
    assert r.status_code == 400 and r.json()["detail"] == T_MAKS
    assert set(_batch(u, ",".join([str(t)] * 300))) == {str(t)}   # id kembar dihitung sekali
    r = u.get("/api/checklists", params={"task_ids": "1," * 4000})  # string mentah terlalu panjang
    assert r.status_code == 400 and r.json()["detail"] == T_MAKS


@pytest.mark.parametrize("ids", ["a,1", "1,x", "1.5", "-1", "+1", "1e3", "１", "1;2", "9" * 19, "0x10"])
def test_batch_id_bukan_angka_400_teks_persis(client, ids):
    u = U(client, "ol")
    r = u.get("/api/checklists", params={"task_ids": ids})
    assert r.status_code == 400 and r.json()["detail"] == T_TIDAK_VALID, r.text


def test_batch_anggota_dan_pemilik_workspace_bisa_membaca_orang_luar_tidak(client):
    pemilik, anggota, luar = U(client, "om1"), U(client, "om2"), U(client, "om3")
    ws = _workspace(pemilik)
    _add_member(ws, anggota.id)
    t_anggota = _mk(anggota, title="tim oleh anggota", list_id=ws)["id"]
    s = _add(anggota, t_anggota, "butir tim")["id"]
    for pembaca in (pemilik, anggota):
        body = _batch(pembaca, [t_anggota])
        assert [i["id"] for i in body[str(t_anggota)]["items"]] == [s]
    assert _batch(luar, [t_anggota]) == {}


def test_batch_akses_sama_dengan_can_access_task(client):
    """Aturan baca batch = `_can_access_task` (pemilik task, pemilik/anggota workspace task itu)."""
    u, x, y = U(client, "on1"), U(client, "on2"), U(client, "on3")
    ws_x = _workspace(x)          # u anggota
    _add_member(ws_x, u.id)
    ws_u = _workspace(u)          # u pemilik
    _add_member(ws_u, y.id)
    ws_y = _workspace(y)          # u bukan siapa-siapa
    calon = [
        _mk(u, title="pribadi u")["id"],
        _mk(x, title="pribadi x")["id"],
        _mk(x, title="ws x", list_id=ws_x)["id"],
        _mk(y, title="ws u oleh y", list_id=ws_u)["id"],
        _mk(y, title="ws y", list_id=ws_y)["id"],
        987654321,
    ]
    boleh = set()
    conn = db()
    try:
        for t in calon:
            try:
                webapp._can_access_task(conn, t, u.id)
                boleh.add(str(t))
            except HTTPException:
                pass
    finally:
        conn.close()
    assert len(boleh) == 3
    assert set(_batch(u, calon)) == boleh


def test_batch_baca_saja_tanpa_memulihkan_yatim_tanpa_rev_tanpa_updated_at(client):
    u = U(client, "oo")
    t = _mk(u)["id"]
    a = _add(u, t, "a")["id"]
    conn = db()
    try:
        o = conn.execute("INSERT INTO subtasks (task_id, title, is_done, sort_order, created_at, parent_id) "
                         "VALUES (?, 'yatim', 0, 1, 'x', 987654321)", (t,)).lastrowid
        conn.commit()
    finally:
        conn.close()
    sebelum = _kolom(t, "checklist_rev", "updated_at")
    body = _batch(u, [t])
    assert [(i["id"], i["parent_id"], i["depth"]) for i in body[str(t)]["items"]] == [(a, None, 0), (o, None, 0)]
    assert body[str(t)]["rev"] == 1
    assert _kolom(t, "checklist_rev", "updated_at") == sebelum
    conn = db()
    try:
        assert conn.execute("SELECT parent_id FROM subtasks WHERE id = ?", (o,)).fetchone()[0] == 987654321
    finally:
        conn.close()


def test_batch_tanpa_login_401_dan_rute_tidak_bentrok(client):
    client.cookies.clear()
    assert client.get("/api/checklists", params={"task_ids": "1"}).status_code == 401
    u = U(client, "op")
    t = _mk(u)["id"]
    # rute lama tetap pada tempatnya
    assert u.get(f"/api/tasks/{t}/subtasks").status_code == 200
    assert u.get("/api/tasks/child-counts", params={"ids": str(t)}).status_code == 200


# ── rev di semua respons tulis + GET task ───────────────────────────────────

def test_semua_respons_tulis_memuat_rev_sama_dengan_kolom_dan_batch(client):
    u = U(client, "oq")
    tid = _mk(u)["id"]
    sebelum = _kolom(tid, "updated_at")[0]
    revs = []
    a = _add(u, tid, "a")
    revs.append(a["task_progress"]["rev"])
    b = _add(u, tid, "b")
    revs.append(b["task_progress"]["rev"])
    for resp in (u.patch(f"/api/subtasks/{a['id']}", json={"title": "A"}),
                 u.patch(f"/api/subtasks/{a['id']}", json={"is_done": True}),
                 u.post(f"/api/subtasks/{b['id']}/move", json={"parent_id": a["id"]}),
                 u.post(f"/api/subtasks/{b['id']}/toggle"),
                 u.delete(f"/api/subtasks/{b['id']}")):
        assert resp.status_code == 200, resp.text
        tp = resp.json()["task_progress"]
        assert set(tp) == {"done", "total", "progress", "rev"}
        revs.append(tp["rev"])
    assert revs == [1, 2, 3, 4, 5, 6, 7]
    task = u.get(f"/api/tasks/{tid}").json()
    assert task["checklist_rev"] == 7 and task["updated_at"] == sebelum
    assert _batch(u, [tid])[str(tid)]["rev"] == 7
