"""Helper bersama tes drawing milik workspace (PR 2). Pola dari tests/test_pub_access.py.

DB tes dipakai bersama satu sesi pytest: pemanggil wajib memakai username/judul/client_id unik.
"""
from conftest import db, register_user


def auth(client, username):
    """Daftarkan user dan kembalikan header Bearer-nya (cookie sesi dibuang supaya aman antar user)."""
    data = register_user(client, username, f"{username}@test.id")
    client.cookies.clear()
    return {"Authorization": f"Bearer {data.get('token') or data.get('access_token')}"}


def uid_of(username):
    conn = db()
    try:
        return conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()["id"]
    finally:
        conn.close()


def make_drawing(client, headers, title, cid=None, list_id=None, svg=""):
    """Buat drawing lewat API; list_id hanya dikirim bila tidak None (endpoint-nya baru ada di Task 2)."""
    payload = {"title": title, "data_json": '{"shapes":{}}', "svg_preview": svg}
    if cid:
        payload["client_id"] = cid
    if list_id is not None:
        payload["list_id"] = list_id
    r = client.post("/api/drawings", json=payload, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def make_note(client, headers, title, content, list_id=None):
    payload = {"title": title, "content": content}
    if list_id is not None:
        payload["list_id"] = list_id
    r = client.post("/api/scratchpad", json=payload, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def workspace(client, headers, name):
    r = client.post("/api/lists", json={"name": name}, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def add_member(list_id, user_id):
    """Jadikan user anggota workspace langsung lewat DB."""
    conn = db()
    try:
        conn.execute(
            "INSERT INTO list_members (list_id, user_id, joined_at) VALUES (?, ?, '2026-10-18T00:00:00')",
            (list_id, user_id),
        )
        conn.commit()
    finally:
        conn.close()


def drawing_row(did):
    """Baris drawing langsung dari DB."""
    conn = db()
    try:
        return conn.execute("SELECT * FROM drawings WHERE id = ?", (did,)).fetchone()
    finally:
        conn.close()
