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
