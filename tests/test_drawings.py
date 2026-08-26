import pytest
from conftest import register_user


def test_drawings_crud_flow(client):
    # 1. Register & login
    user = register_user(client, "drawuser1", "draw1@test.id")
    token = user.get("token") or user.get("access_token")
    headers = {"Authorization": f"Bearer {token}"} if token else {}

    # 2. Create drawing
    create_res = client.post("/api/drawings", json={
        "title": "Arsitektur Sistem",
        "data_json": '{"shapes":{"box1":{"type":"geo"}}}',
        "svg_preview": "<svg>preview</svg>",
        "tags": ["arsitektur", "backend"]
    }, headers=headers)
    assert create_res.status_code == 200, create_res.text
    drawing = create_res.json()
    assert drawing["title"] == "Arsitektur Sistem"
    assert "arsitektur" in drawing["tags"]
    drawing_id = drawing["id"]

    # 3. List drawings
    list_res = client.get("/api/drawings", headers=headers)
    assert list_res.status_code == 200
    drawings = list_res.json()
    assert any(d["id"] == drawing_id for d in drawings)

    # 4. Get single drawing
    get_res = client.get(f"/api/drawings/{drawing_id}", headers=headers)
    assert get_res.status_code == 200
    detail = get_res.json()
    assert detail["title"] == "Arsitektur Sistem"
    assert detail["data_json"] == '{"shapes":{"box1":{"type":"geo"}}}'
    assert detail["svg_preview"] == "<svg>preview</svg>"

    # 5. Update drawing
    update_res = client.put(f"/api/drawings/{drawing_id}", json={
        "title": "Arsitektur V2",
        "data_json": '{"shapes":{"box1":{"type":"geo"},"box2":{"type":"arrow"}}}',
        "tags": ["arsitektur", "v2"]
    }, headers=headers)
    assert update_res.status_code == 200
    updated = update_res.json()
    assert updated["title"] == "Arsitektur V2"
    assert "v2" in updated["tags"]

    # 6. Toggle pin
    pin_res = client.patch(f"/api/drawings/{drawing_id}/pin", headers=headers)
    assert pin_res.status_code == 200
    assert pin_res.json()["is_pinned"] == 1

    # Toggle unpin
    unpin_res = client.patch(f"/api/drawings/{drawing_id}/pin", headers=headers)
    assert unpin_res.status_code == 200
    assert unpin_res.json()["is_pinned"] == 0

    # 7. Search drawings
    search_res = client.get("/api/search?q=Arsitektur", headers=headers)
    assert search_res.status_code == 200
    search_data = search_res.json()
    assert "drawings" in search_data
    assert any(d["id"] == drawing_id for d in search_data["drawings"])

    # 8. Delete drawing
    del_res = client.delete(f"/api/drawings/{drawing_id}", headers=headers)
    assert del_res.status_code == 200
    assert del_res.json()["ok"] is True

    # 9. Verify 404 after delete
    get_after_del = client.get(f"/api/drawings/{drawing_id}", headers=headers)
    assert get_after_del.status_code == 404


def test_published_note_inline_draw_rendering(client):
    # 1. Register & login
    user = register_user(client, "pubdrawuser", "pubdraw@test.id")
    token = user.get("token") or user.get("access_token")
    headers = {"Authorization": f"Bearer {token}"} if token else {}

    # 2. Create drawing
    create_draw = client.post("/api/drawings", json={
        "title": "Diagram Alur",
        "data_json": '{"shapes":{}}',
        "svg_preview": '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="blue" /></svg>'
    }, headers=headers)
    assert create_draw.status_code == 200
    drawing_id = create_draw.json()["id"]

    # 3. Create note with inline draw syntax, markdown table, escaped table, and image attachments
    note_content = f"""# Catatan Dokumentasi

Berikut adalah tabel fitur:

| Fitur | Status | Keterangan |
| :--- | :---: | ---: |
| Drawing | Aktif | Vektor SVG |
| Publish | Aktif | Publik HTML |

Berikut adalah tabel escaped dari serializer:

\\| Modul \\| Versi \\|
\\| \\:--- \\| ---: \\|
\\| Table \\| v2.0 \\|
\\| Image \\| v2.0 \\|

Berikut adalah diagram alur proses:

::draw[{drawing_id}]{{title="Diagram Alur Proses" size="S"}}

Dan gambar arsitektur:

![Arsitektur](/api/scratchpad/attachments/99/view)

Dan gambar escaped:

!\\[DiagramEscaped\\](/api/scratchpad/attachments/100/view)

Selesai.
"""
    create_note = client.post("/api/scratchpad", json={
        "title": "Doc Note",
        "content": note_content
    }, headers=headers)
    assert create_note.status_code == 200
    note_id = create_note.json()["id"]

    # 4. Publish note
    pub_res = client.post(f"/api/scratchpad/{note_id}/publish", json={}, headers=headers)
    assert pub_res.status_code == 200
    slug = pub_res.json()["slug"]

    # 5. Access public published note page
    view_res = client.get(f"/pub/pubdrawuser/{slug}")
    assert view_res.status_code == 200
    html_body = view_res.text

    # 6. Verify that ::draw syntax is NOT raw text, but rendered as note-draw-card with SVG
    assert f"::draw[{drawing_id}]" not in html_body
    assert "note-draw-card" in html_body
    assert "data-size=\"S\"" in html_body
    assert "Diagram Alur Proses" in html_body
    assert '<circle cx="50" cy="50" r="40" fill="blue"' in html_body

    # 7. Verify that markdown tables are rendered to <table>, not raw | markdown
    assert "<table>" in html_body
    assert "<th>Fitur</th>" in html_body or "<th style=\"text-align:left\">Fitur</th>" in html_body
    assert "<td>Drawing</td>" in html_body or "<td style=\"text-align:left\">Drawing</td>" in html_body
    assert "<th>Modul</th>" in html_body or "<th style=\"text-align:left\">Modul</th>" in html_body
    assert "<td>Table</td>" in html_body or "<td style=\"text-align:left\">Table</td>" in html_body
    assert "\\| Modul \\|" not in html_body

    # 8. Verify that attachment images are rewritten to public /pub/attachments/
    assert '<img src="/pub/attachments/99" alt="Arsitektur"' in html_body
    assert '<img src="/pub/attachments/100" alt="DiagramEscaped"' in html_body




def test_create_drawing_idempotent_by_client_id(client):
    """POST ulang dengan client_id sama TIDAK boleh menduplikasi baris (retry sync aman)."""
    user = register_user(client, "drawuser2", "draw2@test.id")
    token = user.get("token") or user.get("access_token")
    headers = {"Authorization": f"Bearer {token}"} if token else {}

    payload = {
        "title": "Gambar Retry",
        "data_json": '{"shapes":{"a":{"type":"geo"}}}',
        "svg_preview": "<svg>retry</svg>",
        "client_id": "cid-retry-abc-123"
    }
    first = client.post("/api/drawings", json=payload, headers=headers)
    assert first.status_code == 200, first.text
    first_id = first.json()["id"]

    # retry dengan client_id sama (payload judul berbeda utk membuktikan upsert)
    payload2 = dict(payload, title="Gambar Retry v2")
    second = client.post("/api/drawings", json=payload2, headers=headers)
    assert second.status_code == 200, second.text
    second_id = second.json()["id"]
    assert second_id == first_id, "retry dengan client_id sama harus mengembalikan baris yang sama"
    assert second.json()["title"] == "Gambar Retry v2", "upsert memperbarui judul"

    lst = client.get("/api/drawings", headers=headers).json()
    matches = [d for d in lst if d["id"] == first_id]
    assert len(matches) == 1, "hanya boleh ada SATU baris untuk satu client_id"

    # client_id berbeda → baris baru
    third = client.post("/api/drawings", json=dict(payload, client_id="cid-lain-456"), headers=headers)
    assert third.status_code == 200
    assert third.json()["id"] != first_id


def test_drawing_responses_include_server_id(client):
    """List & detail drawing wajib membawa field server_id == id (penanda baris server utk client)."""
    user = register_user(client, "serveriduser", "serverid@test.id")
    token = user.get("token") or user.get("access_token")
    headers = {"Authorization": f"Bearer {token}"} if token else {}

    create_res = client.post("/api/drawings", json={
        "title": "Gambar Server ID",
        "data_json": '{"shapes":{}}',
        "svg_preview": "<svg>sid</svg>"
    }, headers=headers)
    assert create_res.status_code == 200, create_res.text
    drawing = create_res.json()
    assert drawing["server_id"] == drawing["id"], "response create harus membawa server_id == id"

    lst = client.get("/api/drawings", headers=headers).json()
    assert len(lst) >= 1
    for row in lst:
        assert "server_id" in row, "setiap baris list drawing wajib punya server_id"
        assert row["server_id"] == row["id"], "server_id harus sama dengan id"

    detail = client.get(f"/api/drawings/{drawing['id']}", headers=headers).json()
    assert detail["server_id"] == detail["id"], "detail drawing harus membawa server_id == id"

    upd = client.put(f"/api/drawings/{drawing['id']}", json={"title": "Gambar Server ID v2"}, headers=headers).json()
    assert upd["server_id"] == upd["id"], "response update harus membawa server_id == id"


def test_drawing_endpoints_by_client_id(client):
    """GET, PUT, PATCH, DELETE /api/drawings/{did} and /pub/drawings/{drawing_id} must support client_id string."""
    user = register_user(client, "ciduser", "ciduser@test.id")
    token = user.get("token") or user.get("access_token")
    headers = {"Authorization": f"Bearer {token}"} if token else {}

    cid = "drw_test_cid_123"

    # 1. Create drawing with client_id
    create_res = client.post("/api/drawings", json={
        "title": "Drawing CID Test",
        "data_json": '{"shapes":{"s1":{"type":"circle"}}}',
        "svg_preview": "<svg>circle</svg>",
        "tags": ["inline", "test"],
        "client_id": cid
    }, headers=headers)
    assert create_res.status_code == 200, create_res.text
    drawing = create_res.json()
    assert drawing["title"] == "Drawing CID Test"
    numeric_id = drawing["id"]
    assert drawing["server_id"] == numeric_id

    # 2. GET by client_id
    get_res = client.get(f"/api/drawings/{cid}", headers=headers)
    assert get_res.status_code == 200, get_res.text
    detail = get_res.json()
    assert detail["id"] == numeric_id
    assert detail["server_id"] == numeric_id
    assert detail["title"] == "Drawing CID Test"
    assert "inline" in detail["tags"]

    # 3. GET public by client_id
    pub_res = client.get(f"/pub/drawings/{cid}")
    assert pub_res.status_code == 200, pub_res.text
    pub_data = pub_res.json()
    assert pub_data["id"] == numeric_id
    assert pub_data["title"] == "Drawing CID Test"
    assert pub_data["svg_preview"] == "<svg>circle</svg>"

    # 4. PUT by client_id
    update_res = client.put(f"/api/drawings/{cid}", json={
        "title": "Drawing CID Updated",
        "data_json": '{"shapes":{"s1":{"type":"circle"},"s2":{"type":"rect"}}}',
        "svg_preview": "<svg>circle+rect</svg>",
        "tags": ["inline", "updated"]
    }, headers=headers)
    assert update_res.status_code == 200, update_res.text
    updated = update_res.json()
    assert updated["id"] == numeric_id
    assert updated["title"] == "Drawing CID Updated"
    assert "updated" in updated["tags"]

    # 5. PATCH pin by client_id
    pin_res = client.patch(f"/api/drawings/{cid}/pin", headers=headers)
    assert pin_res.status_code == 200, pin_res.text
    assert pin_res.json()["is_pinned"] == 1

    unpin_res = client.patch(f"/api/drawings/{cid}/pin", headers=headers)
    assert unpin_res.status_code == 200, unpin_res.text
    assert unpin_res.json()["is_pinned"] == 0

    # 6. DELETE by client_id
    del_res = client.delete(f"/api/drawings/{cid}", headers=headers)
    assert del_res.status_code == 200, del_res.text
    assert del_res.json()["ok"] is True

    # 7. Verify 404 after delete
    get_after = client.get(f"/api/drawings/{cid}", headers=headers)
    assert get_after.status_code == 404

    pub_after = client.get(f"/pub/drawings/{cid}")
    assert pub_after.status_code == 404

