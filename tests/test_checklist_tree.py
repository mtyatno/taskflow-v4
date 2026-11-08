"""Modul murni `checklist_tree` — persen, urutan pre-order, turunan (spec checklist bertingkat §3.3, §5;
rencana PR A R1). Vektor persen dipakai bersama dengan `node --test` di PR B."""
import json
from pathlib import Path

import pytest

import checklist_tree as ct

FIXTURES = Path(__file__).resolve().parent / "fixtures"
VECTORS = json.loads((FIXTURES / "checklist_percent_vectors.json").read_text(encoding="utf-8"))


def _r(id, parent_id=None, sort_order=0, task_id=1, **kw):
    return {"id": id, "task_id": task_id, "parent_id": parent_id, "sort_order": sort_order, **kw}


def _ids(rows):
    return [r["id"] for r in rows]


def _depths(rows):
    return {r["id"]: r["depth"] for r in rows}


# ── persen ──────────────────────────────────────────────────────────────────

def test_vektor_memuat_contoh_spec_dan_batas():
    wajib = {(0, 3, 0), (1, 3, 33), (2, 3, 67), (1, 8, 13), (3, 8, 38), (1, 200, 1),
             (5, 5, 100), (199, 200, 100), (0, 1, 0)}
    assert wajib <= {tuple(v) for v in VECTORS}


@pytest.mark.parametrize("done,total,expected", VECTORS)
def test_persen_sesuai_vektor_bersama(done, total, expected):
    assert ct.percent(done, total) == expected


def test_persen_total_0_none():
    assert ct.percent(0, 0) is None


def test_persen_setengah_dibulatkan_ke_atas_bukan_ke_genap():
    # round() Python: 2.5 → 2; rumus bersama: 1/40 = 2,5% → 3 (D10).
    assert round(100 * 1 / 40) == 2
    assert ct.percent(1, 40) == 3


# ── preorder ────────────────────────────────────────────────────────────────

def test_preorder_anak_tepat_di_bawah_induk_saudara_urut_sort_order_lalu_id():
    rows = [
        _r(5, None, 1),
        _r(2, None, 0),
        _r(9, 2, 0),
        _r(3, None, 1),   # sort_order kembar dengan 5 → id lebih kecil dulu
        _r(7, 2, 0),      # saudara kembar dengan 9 → 7 dulu
        _r(8, 3, 0),
    ]
    out = ct.preorder(rows)
    assert _ids(out) == [2, 7, 9, 3, 8, 5]


def test_preorder_depth_0_1_2_benar_untuk_tiga_tingkat():
    rows = [_r(1), _r(2, 1), _r(3, 2), _r(4, 1, 1), _r(5, None, 1)]
    out = ct.preorder(rows)
    assert _ids(out) == [1, 2, 3, 4, 5]
    assert _depths(out) == {1: 0, 2: 1, 3: 2, 4: 1, 5: 0}


def test_preorder_menyalin_baris_tanpa_mengubah_masukan():
    rows = [_r(1, title="a", is_done=1), _r(2, 1, title="b")]
    out = ct.preorder(rows)
    assert out[1]["title"] == "b" and out[0]["is_done"] == 1 and out[1]["parent_id"] == 1
    assert "depth" not in rows[0] and "depth" not in rows[1]
    out[0]["title"] = "ubah"
    assert rows[0]["title"] == "a"


def test_preorder_menerima_sqlite_row():
    import sqlite3
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    conn.execute("CREATE TABLE s (id INTEGER, task_id INTEGER, parent_id INTEGER, sort_order INTEGER)")
    conn.executemany("INSERT INTO s VALUES (?,?,?,?)", [(1, 1, None, 0), (2, 1, 1, 0)])
    out = ct.preorder(conn.execute("SELECT * FROM s").fetchall())
    conn.close()
    assert [(r["id"], r["depth"]) for r in out] == [(1, 0), (2, 1)]


def test_preorder_induk_yatim_atau_task_lain_level_atas():
    rows = [
        _r(1, None, 0),
        _r(2, 999, 1),            # induk tidak ada
        _r(3, 10, 2),             # induk di task lain
        _r(10, None, 0, task_id=2),
        _r(4, 2, 0),              # anak dari butir yatim tetap anak
    ]
    out = ct.preorder(rows)
    d = _depths(out)
    assert d[2] == 0 and d[3] == 0 and d[4] == 1
    assert sorted(_ids(out)) == [1, 2, 3, 4, 10]
    # urutan level atas tetap (sort_order, id) — yatim tidak dipindah ke akhir
    top = [r["id"] for r in out if r["depth"] == 0 and r["task_id"] == 1]
    assert top == [1, 2, 3]


def test_preorder_siklus_a_b_a_tidak_macet_dan_semua_butir_muncul_sekali():
    rows = [_r(1, 2, 0), _r(2, 1, 1), _r(3, None, 2), _r(4, 2, 0)]
    out = ct.preorder(rows)
    assert sorted(_ids(out)) == [1, 2, 3, 4]
    assert len(out) == 4
    # siklus diputus pada anggota dengan (sort_order, id) terkecil: 1 jadi level atas
    assert _ids(out) == [1, 2, 4, 3]
    assert _depths(out) == {1: 0, 2: 1, 4: 2, 3: 0}


def test_preorder_siklus_diri_sendiri_jadi_level_atas():
    out = ct.preorder([_r(1, 1, 0), _r(2, 1, 0)])
    assert _ids(out) == [1, 2]
    assert _depths(out) == {1: 0, 2: 1}


def test_preorder_siklus_diputus_sama_dengan_hasil_bila_parent_id_dikosongkan():
    # Anggota siklus terkecil diperlakukan persis seperti butir level atas biasa (posisi menurut sort_order).
    rows = [_r(1, None, 0), _r(5, 6, 1), _r(6, 5, 3), _r(7, None, 2)]
    out = ct.preorder(rows)
    healed = ct.preorder([_r(1, None, 0), _r(5, None, 1), _r(6, 5, 3), _r(7, None, 2)])
    assert [(r["id"], r["depth"]) for r in out] == [(r["id"], r["depth"]) for r in healed]


def test_preorder_2000_tingkat_tanpa_recursionerror():
    n = 2000
    rows = [_r(1)] + [_r(i, i - 1) for i in range(2, n + 1)]
    out = ct.preorder(list(reversed(rows)))
    assert _ids(out) == list(range(1, n + 1))
    assert out[-1]["depth"] == n - 1


def test_preorder_kosong():
    assert ct.preorder([]) == []


# ── descendant_ids ──────────────────────────────────────────────────────────

def test_descendant_ids_preorder_tanpa_akar_cabang_lain_tidak_ikut():
    rows = [_r(1), _r(2, 1, 1), _r(3, 1, 0), _r(4, 3, 0), _r(5, None, 1), _r(6, 5, 0)]
    assert ct.descendant_ids(rows, 1) == [3, 4, 2]
    assert ct.descendant_ids(rows, 3) == [4]
    assert ct.descendant_ids(rows, 4) == []
    assert ct.descendant_ids(rows, 5) == [6]


def test_descendant_ids_id_tidak_ada():
    assert ct.descendant_ids([_r(1)], 99) == []


def test_descendant_ids_tahan_siklus():
    rows = [_r(1, 2, 0), _r(2, 1, 1), _r(3, 2, 0)]
    # siklus diputus di 1 (sama seperti preorder): 1 → 2 → 3
    assert ct.descendant_ids(rows, 1) == [2, 3]
    assert ct.descendant_ids(rows, 2) == [3]
    assert ct.descendant_ids(rows, 3) == []


def test_descendant_ids_2000_tingkat():
    n = 2000
    rows = [_r(1)] + [_r(i, i - 1) for i in range(2, n + 1)]
    assert ct.descendant_ids(rows, 1) == list(range(2, n + 1))
