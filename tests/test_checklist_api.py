"""API checklist bertingkat (spec §4; rencana PR A T5): sub butir, pindah, ubah teks, galat 422 berteks
persis, bentuk respons lama tetap, hitungan Fokus level atas, ekspor berurutan dengan `depth`."""
import io
import json
import zipfile
from pathlib import Path

import pytest

import plugin_loader
import task_ext
from conftest import db
from test_contexts_tasks import U, _add_member, _mk, _workspace

T_INDUK = "Induk checklist tidak ditemukan"
T_SIKLUS = "Butir tidak bisa dipindah ke dalam dirinya sendiri"
T_KOSONG = "Teks butir tidak boleh kosong"
KEYS = {"id", "task_id", "parent_id", "depth", "title", "is_done", "sort_order"}


def _add(u, tid, title="b", **body):
    r = u.post(f"/api/tasks/{tid}/subtasks", json={"title": title, **body})
    assert r.status_code == 200, r.text
    return r.json()


def _list(u, tid):
    r = u.get(f"/api/tasks/{tid}/subtasks")
    assert r.status_code == 200, r.text
    return r.json()


def _updated_at(tid):
    conn = db()
    try:
        return conn.execute("SELECT updated_at FROM tasks WHERE id = ?", (tid,)).fetchone()[0]
    finally:
        conn.close()


def _notif_count(user_id, needle):
    conn = db()
    try:
        return conn.execute("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND message LIKE ?",
                            (user_id, f"%{needle}%")).fetchone()[0]
    finally:
        conn.close()


def _pohon(u, tid):
    a = _add(u, tid, "a")["id"]
    b = _add(u, tid, "b")["id"]
    a1 = _add(u, tid, "a1", parent_id=a)["id"]
    a11 = _add(u, tid, "a11", parent_id=a1)["id"]
    return a, b, a1, a11


# ── Tambah ──────────────────────────────────────────────────────────────────

def test_tambah_sub_butir_get_preorder_dengan_depth(client):
    u = U(client, "ca")
    tid = _mk(u)["id"]
    a = _add(u, tid, "a")
    assert set(a) == KEYS | {"task_progress"}
    assert a["task_progress"] == {"done": 0, "total": 1, "progress": 0, "rev": 1, "rev_bumped": True}
    b = _add(u, tid, "b")
    s = _add(u, tid, "sub", parent_id=a["id"])
    assert s["depth"] == 1 and s["parent_id"] == a["id"]
    t = _add(u, tid, "atas", index=0)
    items = _list(u, tid)
    assert all(set(i) == KEYS for i in items)
    assert [(i["id"], i["depth"]) for i in items] == [(t["id"], 0), (a["id"], 0), (s["id"], 1), (b["id"], 0)]


def test_tambah_judul_spasi_saja_422_teks_persis(client):
    u = U(client, "cb")
    tid = _mk(u)["id"]
    r = u.post(f"/api/tasks/{tid}/subtasks", json={"title": "   "})
    assert r.status_code == 422 and r.json()["detail"] == T_KOSONG
    assert _list(u, tid) == []


def test_tambah_induk_task_lain_atau_tidak_ada_422_teks_persis(client):
    u = U(client, "cc")
    tid, lain = _mk(u)["id"], _mk(u, title="lain")["id"]
    p = _add(u, lain, "p")["id"]
    for induk in (p, 987654321):
        r = u.post(f"/api/tasks/{tid}/subtasks", json={"title": "x", "parent_id": induk})
        assert r.status_code == 422 and r.json()["detail"] == T_INDUK
    assert _list(u, tid) == []


def test_tambah_index_negatif_422(client):
    u = U(client, "cd")
    tid = _mk(u)["id"]
    r = u.post(f"/api/tasks/{tid}/subtasks", json={"title": "x", "index": -1})
    assert r.status_code == 422
    assert _list(u, tid) == []


def test_tambah_sub_butir_di_workspace_notifikasi_sekali(client):
    a, b = U(client, "cn1"), U(client, "cn2")
    ws = _workspace(a)
    _add_member(ws, b.id)
    tid = _mk(a, title="Tugas tim", list_id=ws)["id"]
    induk = _add(a, tid, "induk")["id"]
    sebelum = _notif_count(b.id, "menambah item checklist")
    _add(a, tid, "sub", parent_id=induk)
    assert _notif_count(b.id, "menambah item checklist") == sebelum + 1
    # gagal (422) → tanpa notifikasi
    assert a.post(f"/api/tasks/{tid}/subtasks", json={"title": "  "}).status_code == 422
    assert _notif_count(b.id, "menambah item checklist") == sebelum + 1


# ── Ubah teks ───────────────────────────────────────────────────────────────

def test_ubah_teks_sukses_kosong_422_dan_404(client):
    u = U(client, "ce")
    tid = _mk(u)["id"]
    a = _add(u, tid, "a")["id"]
    r = u.patch(f"/api/subtasks/{a}", json={"title": "  baru  "})
    assert r.status_code == 200, r.text
    # Fase 2 (rencana PR A2 R2): field lama tetap, ditambah `changed_ids` (kosong untuk ubah teks saja).
    assert set(r.json()) == KEYS | {"task_progress", "changed_ids"} and r.json()["title"] == "baru"
    assert r.json()["changed_ids"] == []
    assert _list(u, tid)[0]["title"] == "baru"
    for kosong in ("", "   "):
        r = u.patch(f"/api/subtasks/{a}", json={"title": kosong})
        assert r.status_code == 422 and r.json()["detail"] == T_KOSONG
    r = u.patch("/api/subtasks/987654321", json={"title": "x"})
    assert r.status_code == 404 and r.json()["detail"] == "Subtask not found"


# ── Pindah ──────────────────────────────────────────────────────────────────

def test_pindah_sukses_items_preorder(client):
    u = U(client, "cf")
    tid = _mk(u)["id"]
    a, b, a1, a11 = _pohon(u, tid)
    r = u.post(f"/api/subtasks/{a1}/move", json={"parent_id": b, "index": 0})
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"items", "task_progress"}
    assert [(i["id"], i["depth"]) for i in body["items"]] == [(a, 0), (b, 0), (a1, 1), (a11, 2)]
    assert body["items"] == _list(u, tid)
    r = u.post(f"/api/subtasks/{a1}/move", json={"parent_id": None})
    assert r.status_code == 200
    assert r.json()["task_progress"] == {"done": 0, "total": 3, "progress": 0, "rev": 6, "rev_bumped": True}


def test_pindah_tanpa_parent_id_di_body_422(client):
    u = U(client, "cg")
    tid = _mk(u)["id"]
    a = _add(u, tid, "a")["id"]
    r = u.post(f"/api/subtasks/{a}/move", json={"index": 0})
    assert r.status_code == 422
    assert u.post(f"/api/subtasks/{a}/move", json={"parent_id": None, "index": -1}).status_code == 422


def test_pindah_ke_turunan_atau_diri_422_teks_persis(client):
    u = U(client, "ch")
    tid = _mk(u)["id"]
    a, b, a1, a11 = _pohon(u, tid)
    for tujuan in (a, a1, a11):
        r = u.post(f"/api/subtasks/{a}/move", json={"parent_id": tujuan})
        assert r.status_code == 422 and r.json()["detail"] == T_SIKLUS


def test_pindah_ke_butir_task_lain_422_dan_id_tidak_ada_404(client):
    u = U(client, "ci")
    tid, lain = _mk(u)["id"], _mk(u, title="lain")["id"]
    a = _add(u, tid, "a")["id"]
    x = _add(u, lain, "x")["id"]
    r = u.post(f"/api/subtasks/{a}/move", json={"parent_id": x})
    assert r.status_code == 422 and r.json()["detail"] == T_INDUK
    r = u.post("/api/subtasks/987654321/move", json={"parent_id": None})
    assert r.status_code == 404 and r.json()["detail"] == "Subtask not found"


def test_anggota_workspace_boleh_pindah_dan_ubah_teks_orang_luar_403(client):
    a, b, luar = U(client, "cw1"), U(client, "cw2"), U(client, "cw3")
    ws = _workspace(a)
    _add_member(ws, b.id)
    tid = _mk(a, title="tim", list_id=ws)["id"]
    s1 = _add(a, tid, "s1")["id"]
    s2 = _add(a, tid, "s2")["id"]
    assert b.post(f"/api/subtasks/{s2}/move", json={"parent_id": None, "index": 0}).status_code == 200
    assert b.patch(f"/api/subtasks/{s1}", json={"title": "oleh b"}).status_code == 200
    assert [i["title"] for i in _list(a, tid)] == ["s2", "oleh b"]
    for r in (luar.post(f"/api/subtasks/{s1}/move", json={"parent_id": None}),
              luar.patch(f"/api/subtasks/{s1}", json={"title": "jahat"}),
              luar.post(f"/api/tasks/{tid}/subtasks", json={"title": "jahat"}),
              luar.post(f"/api/subtasks/{s1}/toggle"),
              luar.delete(f"/api/subtasks/{s1}"),
              luar.get(f"/api/tasks/{tid}/subtasks")):
        assert r.status_code == 403, r.text
    assert [i["title"] for i in _list(a, tid)] == ["s2", "oleh b"]


# ── Centang dan hapus ───────────────────────────────────────────────────────

def test_centang_bentuk_lama_tetap_ditambah_changed_ids_dan_task_progress(client):
    u = U(client, "cj")
    tid = _mk(u)["id"]
    a, b, a1, a11 = _pohon(u, tid)
    r = u.post(f"/api/subtasks/{a}/toggle")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["id"] == a and body["title"] == "a" and body["is_done"] is True  # bentuk lama
    assert body["changed_ids"] == [a, a1, a11]
    assert body["task_progress"] == {"done": 1, "total": 2, "progress": 50, "rev": 5, "rev_bumped": True}
    r = u.post("/api/subtasks/987654321/toggle")
    assert r.status_code == 404 and r.json()["detail"] == "Subtask not found"


def test_hapus_ok_true_dengan_deleted_ids_dan_task_progress(client):
    u = U(client, "ck")
    tid = _mk(u)["id"]
    a, b, a1, a11 = _pohon(u, tid)
    r = u.delete(f"/api/subtasks/{a}")
    assert r.status_code == 200, r.text
    assert r.json() == {"ok": True, "deleted_ids": [a, a1, a11],
                        "task_progress": {"done": 0, "total": 1, "progress": 0, "rev": 5, "rev_bumped": True}}
    assert [i["id"] for i in _list(u, tid)] == [b]
    r = u.delete(f"/api/subtasks/{a}")
    assert r.status_code == 404 and r.json()["detail"] == "Subtask not found"


def test_get_task_memuat_progress_dan_checklist_total_tanpa_updated_at_berubah(client):
    u = U(client, "cl")
    tid = _mk(u)["id"]
    a, b, a1, a11 = _pohon(u, tid)
    before = _updated_at(tid)
    assert u.post(f"/api/subtasks/{b}/toggle").status_code == 200
    t = u.get(f"/api/tasks/{tid}").json()
    assert t["progress"] == 50 and t["checklist_total"] == 2
    assert t["updated_at"] == before == _updated_at(tid)


# ── Hitungan Fokus dan ekspor ───────────────────────────────────────────────

def test_child_counts_hanya_level_atas(client):
    u = U(client, "cm")
    tid = _mk(u)["id"]
    a = _add(u, tid, "a")["id"]
    _add(u, tid, "b")
    s1 = _add(u, tid, "s1", parent_id=a)["id"]
    _add(u, tid, "s2", parent_id=a)
    _add(u, tid, "s3", parent_id=s1)
    assert u.post(f"/api/subtasks/{s1}/toggle").status_code == 200   # sub butir: tidak dihitung
    r = u.get(f"/api/tasks/child-counts?ids={tid}")
    assert r.status_code == 200, r.text
    c = r.json()["counts"][str(tid)]
    assert (c["sub_total"], c["sub_done"]) == (2, 0)
    assert u.post(f"/api/subtasks/{a}/toggle").status_code == 200
    c = u.get(f"/api/tasks/child-counts?ids={tid}").json()["counts"][str(tid)]
    assert (c["sub_total"], c["sub_done"]) == (2, 1)


def test_ekspor_subtasks_preorder_dengan_depth(client):
    u = U(client, "cx")
    tid = _mk(u, title="ekspor checklist")["id"]
    a = _add(u, tid, "a")["id"]
    _add(u, tid, "b")
    s = _add(u, tid, "a1", parent_id=a)["id"]
    _add(u, tid, "a11", parent_id=s)
    _add(u, tid, "nol", index=0)
    assert u.post(f"/api/subtasks/{s}/toggle").status_code == 200
    r = u.get("/api/export/download")
    assert r.status_code == 200
    tasks = json.loads(zipfile.ZipFile(io.BytesIO(r.content)).read("tasks.json"))
    t = next(x for x in tasks if x["id"] == tid)
    assert t["subtasks"] == [
        {"title": "nol", "done": False, "depth": 0},
        {"title": "a", "done": False, "depth": 0},
        {"title": "a1", "done": True, "depth": 1},
        {"title": "a11", "done": True, "depth": 2},
        {"title": "b", "done": False, "depth": 0},
    ]


# ── Perbaikan review: parent_id di luar rentang INTEGER SQLite ─────────────

@pytest.mark.parametrize("induk", [2 ** 63, -(2 ** 63) - 1, 10 ** 30])
def test_tambah_dan_pindah_parent_id_di_luar_rentang_integer_422(client, induk):
    u = U(client, "co")
    tid = _mk(u)["id"]
    a = _add(u, tid, "a")["id"]
    r = u.post(f"/api/tasks/{tid}/subtasks", json={"title": "x", "parent_id": induk})
    assert r.status_code == 422 and r.json()["detail"] == T_INDUK
    r = u.post(f"/api/subtasks/{a}/move", json={"parent_id": induk})
    assert r.status_code == 422 and r.json()["detail"] == T_INDUK
    assert [i["id"] for i in _list(u, tid)] == [a]


# ── Celah review: hanya tambah yang memberi notifikasi ─────────────────────

def _notif_semua(user_id):
    conn = db()
    try:
        return conn.execute("SELECT COUNT(*) FROM notifications WHERE user_id = ?", (user_id,)).fetchone()[0]
    finally:
        conn.close()


def test_ubah_teks_pindah_centang_hapus_tanpa_notifikasi_workspace(client):
    a, b = U(client, "cq1"), U(client, "cq2")
    ws = _workspace(a)
    _add_member(ws, b.id)
    tid = _mk(a, title="tim", list_id=ws)["id"]
    s1 = _add(a, tid, "s1")["id"]
    s2 = _add(a, tid, "s2")["id"]
    sebelum = _notif_semua(b.id)
    assert a.patch(f"/api/subtasks/{s1}", json={"title": "s1 baru"}).status_code == 200
    assert a.post(f"/api/subtasks/{s2}/move", json={"parent_id": s1}).status_code == 200
    assert a.post(f"/api/subtasks/{s1}/toggle").status_code == 200
    assert a.delete(f"/api/subtasks/{s1}").status_code == 200
    assert _notif_semua(b.id) == sebelum


@pytest.fixture
def demo_index():
    plugin_loader.load_known(Path(__file__).resolve().parent / "fixtures" / "plugins" / "index.json")
    task_ext._reset_for_tests()
    yield
    plugin_loader.load_known()
    task_ext._reset_for_tests()


def test_put_progress_dan_ext_patch_task_bercheklist_progress_tetap_tanpa_notifikasi(client, demo_index):
    a, b = U(client, "cr1"), U(client, "cr2")
    ws = _workspace(a)
    _add_member(ws, b.id)
    tid = _mk(a, title="tim", list_id=ws)["id"]
    s1 = _add(a, tid, "s1")["id"]
    _add(a, tid, "s2")
    assert a.post(f"/api/subtasks/{s1}/toggle").json()["task_progress"]["progress"] == 50
    sebelum = _notif_semua(b.id)
    r = a.put(f"/api/tasks/{tid}", json={"progress": 90, "ext_patch": {"demo-ext.a": 1}})
    assert r.status_code == 200, r.text
    assert r.json()["progress"] == 50 and r.json()["ext"] == {"demo-ext.a": 1}
    assert _notif_semua(b.id) == sebelum
