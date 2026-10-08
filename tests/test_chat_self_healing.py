"""Test self-healing schema migration for chat and workspace files."""
import pytest
import sqlite3
import webapp
from conftest import db, register_user


class U:
    def __init__(self, client, prefix="chatuser"):
        import uuid
        name = f"{prefix}_{uuid.uuid4().hex[:8]}"
        info = register_user(client, name, f"{name}@test.id")
        self.client = client
        self.id = info["user_id"]
        self.username = info["username"]
        self.h = {"Authorization": f"Bearer {info['token']}"}

    def _call(self, method, url, **kw):
        self.client.cookies.clear()
        return getattr(self.client, method)(url, headers=self.h, **kw)

    def get(self, url, **kw): return self._call("get", url, **kw)
    def post(self, url, **kw): return self._call("post", url, **kw)
    def delete(self, url, **kw): return self._call("delete", url, **kw)


def _mk_list(owner, *members, name="Chat Self-Healing List"):
    r = owner.post("/api/lists", json={"name": name})
    assert r.status_code == 200, r.text
    list_id = r.json()["id"]
    conn = db()
    try:
        for m in members:
            conn.execute(
                "INSERT INTO list_members (list_id, user_id, joined_at) VALUES (?,?,datetime('now'))",
                (list_id, m.id),
            )
        conn.commit()
    finally:
        conn.close()
    return list_id


def _exec(sql, *params):
    conn = db()
    try:
        conn.execute(sql, params)
        conn.commit()
    finally:
        conn.close()


def test_chat_get_and_post_self_heals_when_workspace_files_table_dropped(client):
    owner = U(client, prefix="chatowner")
    member = U(client, prefix="chatmember")
    list_id = _mk_list(owner, member)

    # Drop workspace_files to simulate unmigrated DB (e.g. after deploy without restart)
    try:
        _exec("DROP TABLE workspace_files")
    except Exception:
        pass

    # GET /api/lists/{id}/messages must not return 500; it must self-heal
    r_get = member.get(f"/api/lists/{list_id}/messages")
    assert r_get.status_code == 200, f"Expected 200 but got {r_get.status_code}: {r_get.text}"
    assert isinstance(r_get.json(), list)

    # Drop workspace_files again
    try:
        _exec("DROP TABLE workspace_files")
    except Exception:
        pass

    # POST /api/lists/{id}/messages must not return 500; it must self-heal and send message
    r_post = member.post(
        f"/api/lists/{list_id}/messages",
        json={"content": "Pesan tes self-healing!", "client_id": "cid_test_heal_1"}
    )
    assert r_post.status_code == 200, f"Expected 200 but got {r_post.status_code}: {r_post.text}"
    msg = r_post.json()
    assert msg["content"] == "Pesan tes self-healing!"
    assert msg["client_id"] == "cid_test_heal_1"

    # Verify message is visible in GET
    r_get_after = member.get(f"/api/lists/{list_id}/messages")
    assert r_get_after.status_code == 200
    msgs = r_get_after.json()
    assert any(m["id"] == msg["id"] for m in msgs)


def test_dm_self_heals_when_dm_tables_dropped(client):
    user_a = U(client, prefix="dma")
    user_b = U(client, prefix="dmb")
    _mk_list(user_a, user_b, name="DM List")

    # Drop dm_conversations to simulate unmigrated DB
    try:
        _exec("DROP TABLE dm_reads")
        _exec("DROP TABLE dm_messages")
        _exec("DROP TABLE dm_conversations")
    except Exception:
        pass

    # Create conversation must self-heal
    r_conv = user_a.post("/api/dm/conversations", json={"user_id": user_b.id})
    assert r_conv.status_code == 200, f"Expected 200 but got {r_conv.status_code}: {r_conv.text}"
    conv_id = r_conv.json()["id"]

    # Post message must self-heal
    r_msg = user_a.post(
        f"/api/dm/conversations/{conv_id}/messages",
        json={"content": "Halo via DM self-healing!", "client_id": "cid_dm_heal_1"}
    )
    assert r_msg.status_code == 200, f"Expected 200 but got {r_msg.status_code}: {r_msg.text}"
    assert r_msg.json()["content"] == "Halo via DM self-healing!"
