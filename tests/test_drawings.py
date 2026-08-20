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

    # 3. Create note with inline draw syntax, markdown table, and image attachment
    note_content = f"""# Catatan Dokumentasi

Berikut adalah tabel fitur:

| Fitur | Status | Keterangan |
| :--- | :---: | ---: |
| Drawing | Aktif | Vektor SVG |
| Publish | Aktif | Publik HTML |

Berikut adalah diagram alur proses:

::draw[{drawing_id}]{{title="Diagram Alur Proses" size="S"}}

Dan gambar arsitektur:

![Arsitektur](/api/scratchpad/attachments/99/view)

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

    # 7. Verify that markdown table is rendered to <table>, not raw | markdown
    assert "<table>" in html_body
    assert "<th>Fitur</th>" in html_body or "<th style=\"text-align:left\">Fitur</th>" in html_body
    assert "<td>Drawing</td>" in html_body or "<td style=\"text-align:left\">Drawing</td>" in html_body

    # 8. Verify that attachment image is rewritten to public /pub/attachments/99
    assert '<img src="/pub/attachments/99" alt="Arsitektur"' in html_body


