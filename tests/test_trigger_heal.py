"""Insiden 2026-10-15: trigger trg_delete_*_tags merujuk entity_tags_old (ditulis ulang SQLite saat
migrasi rebuild entity_tags 2026-10-11) → setiap DELETE note/task/habit di server gagal 500
"no such table: main.entity_tags_old". migrate_db() harus menyembuhkan trigger itu (idempoten)."""
import sqlite3

import webapp


def db():
    conn = sqlite3.connect(webapp.DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def register_user(client, username, email, password="pass1234"):
    r = client.post("/api/auth/register", json={"username": username, "password": password, "email": email})
    assert r.status_code == 200, r.text


def _break_triggers_like_production():
    """Reproduksi persis: rebuild entity_tags TANPA legacy_alter_table (perilaku migrasi lama)."""
    webapp.TaskRepository(webapp.DB_PATH)  # pastikan entity_tags + trigger tag sudah dibuat
    conn = db()
    try:
        conn.execute("PRAGMA legacy_alter_table=OFF")
        conn.execute("ALTER TABLE entity_tags RENAME TO entity_tags_old")
        sql = conn.execute("SELECT sql FROM sqlite_master WHERE type='table' AND name='entity_tags_old'").fetchone()[0]
        conn.execute(sql.replace("entity_tags_old", "entity_tags", 1))
        conn.execute("INSERT OR IGNORE INTO entity_tags SELECT * FROM entity_tags_old")
        conn.execute("DROP TABLE entity_tags_old")
        conn.commit()
        broken = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='trigger' AND sql LIKE '%entity_tags_old%'").fetchall()]
    finally:
        conn.close()
    return broken


def _login(client, username):
    register_user(client, username, f"{username}@example.com")
    r = client.post("/api/auth/login", json={"username": username, "password": "pass1234"})
    assert r.status_code == 200, r.text
    return {"Authorization": "Bearer " + r.json()["token"]}


def test_broken_tag_triggers_are_healed_and_deletes_work(client):
    broken = _break_triggers_like_production()
    assert "trg_delete_note_tags" in broken, broken  # skenario produksi tereproduksi

    h = _login(client, "heal_user")
    note = client.post("/api/scratchpad", json={"title": "N", "content": "isi #tagx"}, headers=h).json()
    # sebelum heal: DELETE gagal persis seperti di produksi
    try:
        r = client.delete(f"/api/scratchpad/{note['id']}", headers=h)
        failed_before = r.status_code >= 500
    except sqlite3.OperationalError as e:
        failed_before = "entity_tags_old" in str(e)
    assert failed_before

    webapp.migrate_db()  # deploy menjalankan ini

    conn = db()
    try:
        left = conn.execute("SELECT name FROM sqlite_master WHERE type='trigger' AND sql LIKE '%entity_tags_old%'").fetchall()
        names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='trigger'").fetchall()}
    finally:
        conn.close()
    assert left == []
    assert {"trg_delete_note_tags", "trg_delete_task_tags", "trg_delete_habit_tags"} <= names

    r = client.delete(f"/api/scratchpad/{note['id']}", headers=h)
    assert r.status_code == 200, r.text
    task = client.post("/api/tasks", json={"title": "T #tagy"}, headers=h).json()
    assert client.delete(f"/api/tasks/{task['id']}", headers=h).status_code == 200
    habit = client.post("/api/habits", json={"title": "H"}, headers=h).json()
    assert client.delete(f"/api/habits/{habit['id']}", headers=h).status_code == 200

    # idempoten: migrate_db berikutnya tidak mengubah apa-apa
    conn = db()
    try:
        assert webapp._heal_broken_triggers(conn) == []
    finally:
        conn.close()
