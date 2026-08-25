import pytest
from conftest import register_user


def test_scratchpad_crud(client):
    user = register_user(client, "scratchuser1", "scratch1@test.id")
    token = user.get("token") or user.get("access_token")
    headers = {"Authorization": f"Bearer {token}"} if token else {}

    # 1. Create note
    create_res = client.post("/api/scratchpad", json={
        "title": "Catatan Pertama",
        "content": "Konten catatan pertama",
        "tags": ["work", "draft"],
    }, headers=headers)
    assert create_res.status_code == 200, create_res.text
    note = create_res.json()
    assert note["title"] == "Catatan Pertama"
    assert note["content"] == "Konten catatan pertama"
    assert "work" in note["tags"]
    assert "draft" in note["tags"]
    note_id = note["id"]

    # 2. List notes
    list_res = client.get("/api/scratchpad", headers=headers)
    assert list_res.status_code == 200
    notes = list_res.json()
    assert any(n["id"] == note_id for n in notes)

    # 3. Get single note detail
    detail_res = client.get(f"/api/scratchpad/{note_id}", headers=headers)
    assert detail_res.status_code == 200
    detail = detail_res.json()
    assert detail["id"] == note_id
    assert detail["title"] == "Catatan Pertama"
    assert detail["content"] == "Konten catatan pertama"

    # 4. Update note
    update_res = client.put(f"/api/scratchpad/{note_id}", json={
        "title": "Catatan Pertama Terupdate",
        "content": "Konten baru setelah update",
        "tags": ["work", "final"],
    }, headers=headers)
    assert update_res.status_code == 200
    updated = update_res.json()
    assert updated["title"] == "Catatan Pertama Terupdate"
    assert updated["content"] == "Konten baru setelah update"
    assert "final" in updated["tags"]

    # 5. Delete note
    del_res = client.delete(f"/api/scratchpad/{note_id}", headers=headers)
    assert del_res.status_code == 200

    # 6. Verify 404 after deletion
    get_after_del = client.get(f"/api/scratchpad/{note_id}", headers=headers)
    assert get_after_del.status_code == 404


def test_scratchpad_idempotency_same_client_id(client):
    """POST berulang dengan client_id sama tidak menduplikasi baris, melainkan melakukan upsert."""
    user = register_user(client, "scratchidempuser", "scratchidemp@test.id")
    token = user.get("token") or user.get("access_token")
    headers = {"Authorization": f"Bearer {token}"} if token else {}

    payload = {
        "title": "Catatan v1",
        "content": "Konten awal v1",
        "tags": ["tag1"],
        "client_id": "cid-note-001"
    }
    first = client.post("/api/scratchpad", json=payload, headers=headers)
    assert first.status_code == 200, first.text
    first_id = first.json()["id"]
    assert first.json()["title"] == "Catatan v1"
    assert first.json()["content"] == "Konten awal v1"

    # Retry POST dengan payload terupdate namun client_id sama
    second_payload = {
        "title": "Catatan v2",
        "content": "Konten terupdate v2",
        "tags": ["tag2"],
        "client_id": "cid-note-001"
    }
    second = client.post("/api/scratchpad", json=second_payload, headers=headers)
    assert second.status_code == 200, second.text
    second_id = second.json()["id"]
    assert second_id == first_id, "retry dengan client_id sama harus mengembalikan note_id yang sama"
    assert second.json()["title"] == "Catatan v2", "upsert memperbarui judul"
    assert second.json()["content"] == "Konten terupdate v2", "upsert memperbarui konten"
    assert "tag2" in second.json()["tags"]

    # Pastikan di list note hanya ada 1 baris untuk note tersebut
    lst = client.get("/api/scratchpad", headers=headers).json()
    matches = [n for n in lst if n["id"] == first_id]
    assert len(matches) == 1, "hanya boleh ada SATU baris untuk satu client_id"


def test_scratchpad_different_client_id(client):
    """POST dengan client_id berbeda menghasilkan baris catatan yang berbeda."""
    user = register_user(client, "scratchdiffuser", "scratchdiff@test.id")
    token = user.get("token") or user.get("access_token")
    headers = {"Authorization": f"Bearer {token}"} if token else {}

    first = client.post("/api/scratchpad", json={
        "title": "Note Alpha",
        "content": "Content Alpha",
        "client_id": "cid-note-aaa"
    }, headers=headers)
    assert first.status_code == 200, first.text
    first_id = first.json()["id"]

    second = client.post("/api/scratchpad", json={
        "title": "Note Beta",
        "content": "Content Beta",
        "client_id": "cid-note-bbb"
    }, headers=headers)
    assert second.status_code == 200, second.text
    second_id = second.json()["id"]

    assert first_id != second_id, "client_id berbeda harus menghasilkan note_id berbeda"

    lst = client.get("/api/scratchpad", headers=headers).json()
    ids = [n["id"] for n in lst]
    assert first_id in ids
    assert second_id in ids


def test_scratchpad_responses_include_server_id(client):
    """List, detail, create, dan update note wajib membawa field server_id == id."""
    user = register_user(client, "scratchserveriduser", "scratchserverid@test.id")
    token = user.get("token") or user.get("access_token")
    headers = {"Authorization": f"Bearer {token}"} if token else {}

    create_res = client.post("/api/scratchpad", json={
        "title": "Note Server ID Test",
        "content": "Konten untuk cek server_id",
    }, headers=headers)
    assert create_res.status_code == 200, create_res.text
    note = create_res.json()
    assert note["server_id"] == note["id"], "response create harus membawa server_id == id"

    lst = client.get("/api/scratchpad", headers=headers).json()
    assert len(lst) >= 1
    for row in lst:
        assert "server_id" in row, "setiap baris list scratchpad wajib punya server_id"
        assert row["server_id"] == row["id"], "server_id harus sama dengan id"

    detail = client.get(f"/api/scratchpad/{note['id']}", headers=headers).json()
    assert detail["server_id"] == detail["id"], "detail note harus membawa server_id == id"

    upd = client.put(f"/api/scratchpad/{note['id']}", json={"title": "Note Server ID v2"}, headers=headers).json()
    assert upd["server_id"] == upd["id"], "response update harus membawa server_id == id"
