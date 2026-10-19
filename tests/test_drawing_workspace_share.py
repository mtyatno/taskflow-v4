"""Drawing milik workspace: share/unshare, salin, daftar per workspace, dampak keluar (PR 2 Task 3)."""
from conftest import db
from drawing_ws_helpers import auth, uid_of, make_drawing, make_note, workspace, add_member, drawing_row


def _remove_member(list_id, uid):
    conn = db()
    try:
        conn.execute("DELETE FROM list_members WHERE list_id = ? AND user_id = ?", (list_id, uid))
        conn.commit()
    finally:
        conn.close()


def test_owner_shares_and_unshares_unused_drawing(client):
    ha = auth(client, "shr_a1")
    w = workspace(client, ha, "shr_w1")
    d = make_drawing(client, ha, "shr_d1")
    before = drawing_row(d["id"])["updated_at"]
    r = client.patch(f"/api/drawings/{d['id']}/share", json={"list_id": w}, headers=ha)
    assert r.status_code == 200, r.text
    assert r.json()["list_id"] == w
    row = drawing_row(d["id"])
    assert row["list_id"] == w and row["updated_at"] != before
    r = client.patch(f"/api/drawings/{d['id']}/share", json={"list_id": None}, headers=ha)
    assert r.status_code == 200 and r.json()["list_id"] is None
    assert drawing_row(d["id"])["list_id"] is None


def test_share_same_list_is_noop(client):
    ha = auth(client, "shr_a2")
    w = workspace(client, ha, "shr_w2")
    d = make_drawing(client, ha, "shr_d2", list_id=w)
    before = drawing_row(d["id"])["updated_at"]
    r = client.patch(f"/api/drawings/{d['id']}/share", json={"list_id": w}, headers=ha)
    assert r.status_code == 200 and r.json()["list_id"] == w
    assert drawing_row(d["id"])["updated_at"] == before


def test_member_cannot_share(client):
    ha, hb = auth(client, "shr_a3"), auth(client, "shr_b3")
    w = workspace(client, ha, "shr_w3")
    add_member(w, uid_of("shr_b3"))
    d = make_drawing(client, ha, "shr_d3", list_id=w)
    r = client.patch(f"/api/drawings/{d['id']}/share", json={"list_id": None}, headers=hb)
    assert r.status_code == 403
    assert drawing_row(d["id"])["list_id"] == w


def test_share_to_foreign_list_403(client):
    ha, hc = auth(client, "shr_a4"), auth(client, "shr_c4")
    w = workspace(client, hc, "shr_w4")
    d = make_drawing(client, ha, "shr_d4")
    r = client.patch(f"/api/drawings/{d['id']}/share", json={"list_id": w}, headers=ha)
    assert r.status_code == 403
    assert drawing_row(d["id"])["list_id"] is None


def test_unshare_in_use_409_lists_notes(client):
    ha = auth(client, "shr_a5")
    w, w2 = workspace(client, ha, "shr_w5"), workspace(client, ha, "shr_w5b")
    d = make_drawing(client, ha, "shr_d5", cid="shr-cid-5", list_id=w)
    n = make_note(client, ha, "Rapat", f"x ::draw[{d['id']}] y", list_id=w)
    # token angka yang mirip tapi bukan drawing ini tidak ikut
    make_note(client, ha, "Lain", f"::draw[{d['id']}9]", list_id=w)
    for target in (None, w2):
        r = client.patch(f"/api/drawings/{d['id']}/share", json={"list_id": target}, headers=ha)
        assert r.status_code == 409, r.text
        detail = r.json()["detail"]
        assert detail["code"] == "DRAWING_IN_USE"
        assert detail["notes"] == [{"id": n["id"], "title": "Rapat"}]
        assert detail["hidden_count"] == 0
    assert drawing_row(d["id"])["list_id"] == w


def test_unshare_in_use_matches_by_client_id(client):
    ha = auth(client, "shr_a5c")
    w = workspace(client, ha, "shr_w5c")
    d = make_drawing(client, ha, "shr_d5c", cid="shr-cid-5c", list_id=w)
    make_note(client, ha, "ByCid", "::draw[shr-cid-5c]", list_id=w)
    r = client.patch(f"/api/drawings/{d['id']}/share", json={"list_id": None}, headers=ha)
    assert r.status_code == 409


def test_unshare_in_use_hides_titles_from_ex_member(client):
    ha, hc = auth(client, "shr_a6"), auth(client, "shr_c6")
    w = workspace(client, hc, "shr_w6")
    add_member(w, uid_of("shr_a6"))
    d = make_drawing(client, ha, "shr_d6", list_id=w)
    make_note(client, hc, "Rahasia", f"::draw[{d['id']}]", list_id=w)
    _remove_member(w, uid_of("shr_a6"))
    r = client.patch(f"/api/drawings/{d['id']}/share", json={"list_id": None}, headers=ha)
    assert r.status_code == 409, r.text
    detail = r.json()["detail"]
    assert detail["notes"] == [] and detail["hidden_count"] == 1


def test_copy_to_personal_and_workspace(client):
    ha, hb, hc = auth(client, "shr_a7"), auth(client, "shr_b7"), auth(client, "shr_c7")
    w, w2 = workspace(client, ha, "shr_w7"), workspace(client, hc, "shr_w7b")
    add_member(w, uid_of("shr_b7"))
    d = make_drawing(client, ha, "shr_d7", list_id=w, svg="<svg/>")
    r = client.post(f"/api/drawings/{d['id']}/copy", json={"list_id": None, "client_id": "shr-copy-7"}, headers=hb)
    assert r.status_code == 200, r.text
    c = r.json()
    assert c["id"] != d["id"] and c["user_id"] == uid_of("shr_b7") and c["list_id"] is None
    src, dst = drawing_row(d["id"]), drawing_row(c["id"])
    assert dst["data_json"] == src["data_json"] and dst["svg_preview"] == src["svg_preview"]
    assert dst["title"] == "shr_d7"
    r2 = client.post(f"/api/drawings/{d['id']}/copy", json={"list_id": None, "client_id": "shr-copy-7"}, headers=hb)
    assert r2.status_code == 200 and r2.json()["id"] == c["id"]
    r = client.post(f"/api/drawings/{d['id']}/copy", json={"list_id": w2}, headers=hb)
    assert r.status_code == 403
    r = client.post(f"/api/drawings/{d['id']}/copy", json={"list_id": None}, headers=hc)
    assert r.status_code == 404
    r = client.post(f"/api/drawings/{d['id']}/copy", json={"list_id": w, "title": "Salinan"}, headers=hb)
    assert r.status_code == 200 and r.json()["list_id"] == w and r.json()["title"] == "Salinan"


def test_list_workspace_drawings(client):
    ha, hc = auth(client, "shr_a8"), auth(client, "shr_c8")
    w = workspace(client, ha, "shr_w8")
    d1 = make_drawing(client, ha, "shr_d8a", list_id=w)
    make_drawing(client, ha, "shr_d8priv")
    d2 = make_drawing(client, ha, "shr_d8b", list_id=w)
    r = client.get(f"/api/lists/{w}/drawings", headers=ha)
    assert r.status_code == 200
    assert [x["id"] for x in r.json()] == [d2["id"], d1["id"]]
    assert {"id", "user_id", "client_id", "title", "svg_preview", "is_pinned", "list_id", "last_edited_by",
            "updated_at"} <= set(r.json()[0])
    assert client.get(f"/api/lists/{w}/drawings", headers=hc).status_code == 403


def test_leave_impact(client):
    ha, hb = auth(client, "shr_a9"), auth(client, "shr_b9")
    w = workspace(client, ha, "shr_w9")
    add_member(w, uid_of("shr_b9"))
    d = make_drawing(client, ha, "shr_d9", cid="shr-cid-9", list_id=w)
    own = make_drawing(client, hb, "shr_d9own", list_id=w)
    n = make_note(client, hb, "Pribadi B", f"::draw[{d['id']}]")
    make_note(client, hb, "Milik sendiri", f"::draw[{own['id']}]")
    make_note(client, hb, "Di W", f"::draw[{d['id']}]", list_id=w)
    r = client.get(f"/api/lists/{w}/leave-impact", headers=hb)
    assert r.status_code == 200, r.text
    assert r.json()["items"] == [{"note_id": n["id"], "note_title": "Pribadi B", "drawing_id": d["id"],
                                  "drawing_client_id": "shr-cid-9", "drawing_title": "shr_d9"}]
    assert client.get(f"/api/lists/{w}/leave-impact", headers=auth(client, "shr_x9")).status_code == 403
