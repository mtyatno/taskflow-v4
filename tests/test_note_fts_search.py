"""
Tests for SQLite FTS5 search & tag operators.
"""
import sqlite3
import pytest
from webapp import migrate_db
from config import DB_PATH


def test_fts5_virtual_table_and_triggers_exist():
    migrate_db()
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        # Check FTS5 table
        tbl = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='scratchpad_notes_fts'"
        ).fetchone()
        assert tbl is not None, "scratchpad_notes_fts table must exist"

        # Check triggers
        triggers = {
            r["name"] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='scratchpad_notes'"
            ).fetchall()
        }
        assert "trg_scratchpad_notes_ai" in triggers
        assert "trg_scratchpad_notes_ad" in triggers
        assert "trg_scratchpad_notes_au" in triggers


@pytest.fixture
def auth_headers(client):
    import uuid
    from conftest import register_user
    client.cookies.clear()
    uid = uuid.uuid4().hex[:8]
    user = register_user(client, f"fts_{uid}", f"fts_{uid}@test.id")
    client.cookies.clear()
    token = user.get("token") or user.get("access_token")
    return {"Authorization": f"Bearer {token}"}


def test_note_fts_search_and_operators(client, auth_headers):
    # Setup notes
    # Note 1: work, finansial
    r1 = client.post("/api/scratchpad", json={"title": "Laporan Mingguan Finansial", "content": "Rincian anggaran operasional unclosed", "tags": ["kerja", "finansial"]}, headers=auth_headers)
    assert r1.status_code == 200
    # Note 2: personal, archive
    r2 = client.post("/api/scratchpad", json={"title": "Rencana Liburan", "content": "Tiket pesawat dan hotel", "tags": ["pribadi", "arsip"]}, headers=auth_headers)
    assert r2.status_code == 200
    # Note 3: work, archive
    r3 = client.post("/api/scratchpad", json={"title": "Arsip Proyek Lama", "content": "Dokumentasi anggaran 2025", "tags": ["kerja", "arsip"]}, headers=auth_headers)
    assert r3.status_code == 200

    # 1. Plain text FTS search
    r = client.get("/api/scratchpad?q=anggaran", headers=auth_headers)
    assert r.status_code == 200
    titles = [n["title"] for n in r.json()]
    assert "Laporan Mingguan Finansial" in titles
    assert "Arsip Proyek Lama" in titles
    assert "Rencana Liburan" not in titles

    # 2. Prefix search (lapor -> Laporan)
    r = client.get("/api/scratchpad?q=lapor", headers=auth_headers)
    titles = [n["title"] for n in r.json()]
    assert any("Laporan" in t for t in titles)

    # 3. Positive tag operator: tag:kerja
    r = client.get("/api/scratchpad?q=tag:kerja", headers=auth_headers)
    titles = [n["title"] for n in r.json()]
    assert "Laporan Mingguan Finansial" in titles
    assert "Arsip Proyek Lama" in titles
    assert "Rencana Liburan" not in titles

    # 4. Negative tag operator: -tag:arsip
    r = client.get("/api/scratchpad?q=-tag:arsip", headers=auth_headers)
    titles = [n["title"] for n in r.json()]
    assert "Laporan Mingguan Finansial" in titles
    assert "Rencana Liburan" not in titles
    assert "Arsip Proyek Lama" not in titles

    # 5. Combined: tag:kerja -tag:arsip anggaran
    r = client.get("/api/scratchpad?q=tag:kerja -tag:arsip anggaran", headers=auth_headers)
    titles = [n["title"] for n in r.json()]
    assert "Laporan Mingguan Finansial" in titles
    assert "Arsip Proyek Lama" not in titles
    assert "Rencana Liburan" not in titles

    # 6. Resilience against weird characters
    r = client.get('/api/scratchpad?q=anggaran "unclosed : * ( )', headers=auth_headers)
    assert r.status_code == 200
    titles = [n["title"] for n in r.json()]
    assert "Laporan Mingguan Finansial" in titles

    # Also test unclosed quote and weird symbols alone
    r_weird = client.get('/api/scratchpad?q=anggaran " : * ( )', headers=auth_headers)
    assert r_weird.status_code == 200
    titles_weird = [n["title"] for n in r_weird.json()]
    assert "Laporan Mingguan Finansial" in titles_weird


def test_fts_update_and_delete_sync(client, auth_headers):
    import uuid
    from conftest import register_user

    r = client.post("/api/scratchpad", json={"title": "Catatan Unik 12345", "content": "Konteks rahasia"}, headers=auth_headers)
    nid = r.json()["id"]

    # Search matches
    res = client.get("/api/scratchpad?q=12345", headers=auth_headers)
    assert any(n["id"] == nid for n in res.json())

    # Update note
    client.put(f"/api/scratchpad/{nid}", json={"title": "Catatan Berubah 67890", "content": "Konteks baru"}, headers=auth_headers)

    # Old title should no longer match
    res_old = client.get("/api/scratchpad?q=12345", headers=auth_headers)
    assert not any(n["id"] == nid for n in res_old.json())

    # New title matches
    res_new = client.get("/api/scratchpad?q=67890", headers=auth_headers)
    assert any(n["id"] == nid for n in res_new.json())

    # Delete note
    client.delete(f"/api/scratchpad/{nid}", headers=auth_headers)
    res_del = client.get("/api/scratchpad?q=67890", headers=auth_headers)
    assert not any(n["id"] == nid for n in res_del.json())

    # Multi-user isolation
    client.cookies.clear()
    user2 = register_user(client, f"fts_iso_{uuid.uuid4().hex[:6]}", f"iso_{uuid.uuid4().hex[:6]}@test.id")
    client.cookies.clear()
    h2 = {"Authorization": f"Bearer {user2['token']}"}
    client.post("/api/scratchpad", json={"title": "Catatan Private User 1", "content": "Rahasia"}, headers=auth_headers)
    res_iso = client.get("/api/scratchpad?q=Rahasia", headers=h2)
    assert res_iso.status_code == 200
    assert len(res_iso.json()) == 0

