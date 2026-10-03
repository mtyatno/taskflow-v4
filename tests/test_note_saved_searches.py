import os
import sqlite3
import uuid
import pytest
from starlette.testclient import TestClient
from webapp import app, migrate_db
from config import DB_PATH
from conftest import register_user


@pytest.fixture(autouse=True)
def run_migration():
    migrate_db()


@pytest.fixture
def client():
    return TestClient(app)


def _auth_user(client, username="user_search_a"):
    uid = uuid.uuid4().hex[:6]
    name = f"{username}_{uid}"
    client.cookies.clear()
    info = register_user(client, name, f"{name}@test.id", "password123")
    client.cookies.clear()
    return {"Authorization": f"Bearer {info['token']}"}


def test_saved_searches_table_and_index_exist():
    migrate_db()
    db_file = os.environ.get("DB_PATH", DB_PATH)
    with sqlite3.connect(db_file) as conn:
        conn.row_factory = sqlite3.Row
        tbl = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='note_saved_searches'"
        ).fetchone()
        assert tbl is not None, "note_saved_searches table must exist"
        idx = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_note_saved_searches_user'"
        ).fetchone()
        assert idx is not None, "idx_note_saved_searches_user index must exist"


def test_saved_searches_crud_and_isolation(client):
    headers_a = _auth_user(client, "user_search_a")
    headers_b = _auth_user(client, "user_search_b")

    # 1. Initially empty
    res = client.get("/api/scratchpad/saved-searches", headers=headers_a)
    assert res.status_code == 200
    assert res.json() == []

    # 2. Validation: empty name or query returns 400
    res = client.post("/api/scratchpad/saved-searches", json={"name": "", "query": "tag:kerja"}, headers=headers_a)
    assert res.status_code == 400
    res = client.post("/api/scratchpad/saved-searches", json={"name": "Kerja", "query": ""}, headers=headers_a)
    assert res.status_code == 400

    # 3. Create saved search
    res = client.post("/api/scratchpad/saved-searches", json={"name": "Laporan Aktif", "query": "tag:kerja -tag:arsip laporan"}, headers=headers_a)
    assert res.status_code == 200
    item_a = res.json()
    assert item_a["name"] == "Laporan Aktif"
    assert item_a["query"] == "tag:kerja -tag:arsip laporan"
    assert "id" in item_a

    # 4. List saved searches
    res = client.get("/api/scratchpad/saved-searches", headers=headers_a)
    assert res.status_code == 200
    items = res.json()
    assert len(items) == 1
    assert items[0]["name"] == "Laporan Aktif"

    # 5. User isolation: user B cannot see user A's saved search
    res_b = client.get("/api/scratchpad/saved-searches", headers=headers_b)
    assert res_b.status_code == 200
    assert res_b.json() == []

    # User B cannot delete user A's saved search
    del_b = client.delete(f"/api/scratchpad/saved-searches/{item_a['id']}", headers=headers_b)
    assert del_b.status_code == 404

    # 6. User A deletes saved search
    del_a = client.delete(f"/api/scratchpad/saved-searches/{item_a['id']}", headers=headers_a)
    assert del_a.status_code == 200

    # List is now empty
    res = client.get("/api/scratchpad/saved-searches", headers=headers_a)
    assert res.status_code == 200
    assert res.json() == []
