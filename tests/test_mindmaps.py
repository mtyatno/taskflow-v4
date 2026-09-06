import pytest
from conftest import register_user
from repository import TaskRepository
import os


def test_share_mindmap_flow(client):
    # 1. Register two users
    owner = register_user(client, "mmowner", "mmowner@test.id")
    owner_token = owner.get("token") or owner.get("access_token")
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    owner_id = owner.get("user_id") or owner.get("id")

    other = register_user(client, "mmother", "mmother@test.id")
    other_token = other.get("token") or other.get("access_token")
    other_headers = {"Authorization": f"Bearer {other_token}"}
    other_id = other.get("user_id") or other.get("id")

    # 2. Owner creates a mindmap
    client.cookies.clear()
    res = client.post("/api/mindmaps", json={
        "title": "Mindmap Proyek",
        "data_json": '{"nodeData":{"id":"root","topic":"Mindmap Proyek","root":true,"children":[]}}'
    }, headers=owner_headers)
    assert res.status_code == 200, res.text
    mm = res.json()
    mid = mm["id"]

    # 3. Create a shared list owned by owner
    repo = TaskRepository(os.environ["DB_PATH"])
    list_info = repo.create_shared_list("Tim Alpha", owner_id)
    list_id = list_info["id"]
    repo.add_list_member(list_id, other_id)

    # 4. Share mindmap by owner -> 200 OK
    client.cookies.clear()
    share_res = client.patch(f"/api/mindmaps/{mid}/share", json={"list_id": list_id}, headers=owner_headers)
    assert share_res.status_code == 200, share_res.text
    shared = share_res.json()
    assert shared["list_id"] == list_id

    # 5. Share mindmap by non-owner -> 403 Forbidden
    client.cookies.clear()
    share_other = client.patch(f"/api/mindmaps/{mid}/share", json={"list_id": list_id}, headers=other_headers)
    assert share_other.status_code == 403, share_other.text
    assert "Hanya pemilik mindmap yang bisa berbagi" in share_other.json()["detail"]

    # 6. Share non-existent mindmap -> 404 Not Found
    client.cookies.clear()
    nf_res = client.patch("/api/mindmaps/999999/share", json={"list_id": list_id}, headers=owner_headers)
    assert nf_res.status_code == 404
    assert "Mindmap tidak ditemukan" in nf_res.json()["detail"]

    # 7. Share with list user is not member of -> 403
    unrelated = repo.create_shared_list("Tim Lain", other_id)
    unrelated_list_id = unrelated["id"]
    client.cookies.clear()
    not_member_res = client.patch(f"/api/mindmaps/{mid}/share", json={"list_id": unrelated_list_id}, headers=owner_headers)
    assert not_member_res.status_code == 403
    assert "Bukan anggota list ini" in not_member_res.json()["detail"]

    # 8. Unshare mindmap by owner -> 200 OK
    client.cookies.clear()
    unshare_res = client.patch(f"/api/mindmaps/{mid}/share", json={"list_id": None}, headers=owner_headers)
    assert unshare_res.status_code == 200
    assert unshare_res.json()["list_id"] is None
