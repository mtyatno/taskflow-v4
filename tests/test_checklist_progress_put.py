"""PUT /api/tasks/{id} mengabaikan `progress` selama task punya checklist (spec D3, K2; rencana PR A R7).

`syncpush.js` selalu mengirim `progress`; salinan lama di perangkat lain tidak boleh menimpa angka dari
checklist. PUT yang setelah itu tidak mengubah apa pun → 200 dengan baris sekarang, tanpa UPDATE,
tanpa naik `updated_at`, dan tanpa notifikasi workspace."""
from conftest import db
from test_contexts_tasks import U, _add_member, _mk, _workspace

FROZEN = "2020-01-01T00:00:00"


def _set_task(tid, **cols):
    conn = db()
    try:
        sets = ", ".join(f"{k} = ?" for k in cols)
        conn.execute(f"UPDATE tasks SET {sets} WHERE id = ?", (*cols.values(), tid))
        conn.commit()
    finally:
        conn.close()


def _task(tid):
    conn = db()
    try:
        return dict(conn.execute("SELECT * FROM tasks WHERE id = ?", (tid,)).fetchone())
    finally:
        conn.close()


def _notif_count(user_id, needle):
    conn = db()
    try:
        return conn.execute("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND message LIKE ?",
                            (user_id, f"%{needle}%")).fetchone()[0]
    finally:
        conn.close()


def _checklist_1_dari_2(u, tid):
    a = u.post(f"/api/tasks/{tid}/subtasks", json={"title": "a"}).json()["id"]
    b = u.post(f"/api/tasks/{tid}/subtasks", json={"title": "b"}).json()["id"]
    assert u.post(f"/api/subtasks/{a}/toggle").json()["task_progress"]["progress"] == 50
    _set_task(tid, updated_at=FROZEN)
    return a, b


def test_task_tanpa_checklist_progress_tetap_diterima(client):
    u = U(client, "pp")
    tid = _mk(u)["id"]
    r = u.put(f"/api/tasks/{tid}", json={"progress": 40})
    assert r.status_code == 200, r.text
    assert r.json()["progress"] == 40 and _task(tid)["progress"] == 40


def test_task_bercheklist_put_hanya_progress_200_tanpa_update_dan_tanpa_notifikasi(client):
    a, b = U(client, "pw1"), U(client, "pw2")
    ws = _workspace(a)
    _add_member(ws, b.id)
    tid = _mk(a, title="tim", list_id=ws)["id"]
    _checklist_1_dari_2(a, tid)
    sebelum = _notif_count(b.id, "memperbarui task")
    r = a.put(f"/api/tasks/{tid}", json={"progress": 90})
    assert r.status_code == 200, r.text
    assert r.json()["progress"] == 50 and r.json()["checklist_total"] == 2
    assert r.json()["updated_at"] == FROZEN
    t = _task(tid)
    assert (t["progress"], t["updated_at"]) == (50, FROZEN)
    assert _notif_count(b.id, "memperbarui task") == sebelum


def test_task_bercheklist_progress_dan_judul_judul_berubah_progress_tetap(client):
    u = U(client, "pt")
    tid = _mk(u)["id"]
    _checklist_1_dari_2(u, tid)
    r = u.put(f"/api/tasks/{tid}", json={"progress": 90, "title": "baru"})
    assert r.status_code == 200, r.text
    t = _task(tid)
    assert t["title"] == "baru" and t["progress"] == 50
    assert t["updated_at"] != FROZEN and r.json()["updated_at"] == t["updated_at"]


def test_payload_penuh_gaya_syncpush_tidak_menimpa_progress(client):
    u = U(client, "ps")
    tid = _mk(u, title="sinkron")["id"]
    _checklist_1_dari_2(u, tid)
    t = _task(tid)
    payload = {
        "title": t["title"], "description": t["description"] or "", "priority": t["priority"],
        "project": t["project"] or "", "context": t["context"] or "", "deadline": t["deadline"] or "",
        "gtd_status": t["gtd_status"], "waiting_for": t["waiting_for"] or "",
        "assigned_to": t["assigned_to"], "progress": 0, "is_focused": bool(t["is_focused"]),
        "recurrence_type": None, "recurrence_days": None,
    }
    r = u.put(f"/api/tasks/{tid}", json=payload)
    assert r.status_code == 200, r.text
    assert r.json()["progress"] == 50 and _task(tid)["progress"] == 50


def test_put_kosong_tetap_400(client):
    u = U(client, "pk")
    tid = _mk(u)["id"]
    _checklist_1_dari_2(u, tid)
    r = u.put(f"/api/tasks/{tid}", json={})
    assert r.status_code == 400 and r.json()["detail"] == "No fields to update"


def test_base_rev_basi_tetap_409_sebelum_aturan_progress(client):
    u = U(client, "pr")
    tid = _mk(u)["id"]
    _checklist_1_dari_2(u, tid)
    r = u.put(f"/api/tasks/{tid}", json={"progress": 90, "base_rev": "2019-01-01T00:00:00"})
    assert r.status_code == 409 and r.json()["detail"]["code"] == "REV_MISMATCH"
    r = u.put(f"/api/tasks/{tid}", json={"progress": 90, "base_rev": FROZEN})
    assert r.status_code == 200 and r.json()["progress"] == 50


def test_semua_level_atas_dihapus_progress_manual_lagi(client):
    u = U(client, "pd")
    tid = _mk(u)["id"]
    a, b = _checklist_1_dari_2(u, tid)
    s = u.post(f"/api/tasks/{tid}/subtasks", json={"title": "s", "parent_id": b}).json()["id"]
    assert u.put(f"/api/tasks/{tid}", json={"progress": 10}).json()["progress"] == 50
    assert u.delete(f"/api/subtasks/{a}").status_code == 200
    assert u.delete(f"/api/subtasks/{b}").json()["deleted_ids"] == [b, s]
    t = _task(tid)
    assert (t["progress"], t["checklist_total"]) == (0, 0)   # K11: nilai terakhir (b belum selesai → 0)
    r = u.put(f"/api/tasks/{tid}", json={"progress": 10})
    assert r.status_code == 200 and r.json()["progress"] == 10 and _task(tid)["progress"] == 10
