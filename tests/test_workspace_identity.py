"""Identitas workspace (spec kelola-workspace-fase1 §1.1-1.5)."""
import uuid
from datetime import datetime

import pytest

import webapp
import workspace_identity as wi
from conftest import db, register_user


class U:
    def __init__(self, client, prefix="wi"):
        name = f"{prefix}{uuid.uuid4().hex[:8]}"
        info = register_user(client, name, f"{name}@test.id")
        self.client = client
        self.name = name
        self.id = info["user_id"]
        self.h = {"Authorization": f"Bearer {info['token']}"}

    def _call(self, method, url, **kw):
        self.client.cookies.clear()
        return getattr(self.client, method)(url, headers=self.h, **kw)

    def get(self, url, **kw): return self._call("get", url, **kw)
    def post(self, url, **kw): return self._call("post", url, **kw)
    def put(self, url, **kw): return self._call("put", url, **kw)
    def patch(self, url, **kw): return self._call("patch", url, **kw)
    def delete(self, url, **kw): return self._call("delete", url, **kw)


def _workspace(u):
    r = u.post("/api/lists", json={"name": f"WS{uuid.uuid4().hex[:8]}"})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _add_member(list_id, user_id):
    conn = db()
    conn.execute("INSERT INTO list_members(list_id, user_id, joined_at) VALUES (?,?,?)",
                 (list_id, user_id, datetime.now().isoformat()))
    conn.commit()
    conn.close()


def _item(u, lid):
    return [x for x in u.get("/api/lists").json() if x["id"] == lid][0]


OK = [(None, None), ("", None), ("  ", None), ("ab", "AB"), ("x", "X"), ("7", "7"), ("é", "É"),
      ("🔥", "🔥"), ("👨‍👩‍👧", "👨‍👩‍👧"), ("🇮🇩", "🇮🇩"), ("👍🏽", "👍🏽"), ("❤️", "❤️"), ("1️⃣", "1️⃣"), ("ß", "SS"), ("ﬀ", "FF")]
BAD = ["abc", "a b", "🔥🔥", "A🔥", "a-", "<b>", "​", "🇮🇩🇮🇩",
       "ßß", "🇮️", "🇮‍", "🔥‍", "‍🔥", "🔥‍‍👍", "🔥⃣"]


@pytest.mark.parametrize("raw,expected", OK)
def test_avatar_ok(raw, expected):
    assert wi.normalize_avatar(raw) == expected


@pytest.mark.parametrize("raw", BAD)
def test_avatar_bad(raw):
    with pytest.raises(ValueError, match="Avatar harus 1–2 huruf/angka atau satu emoji"):
        wi.normalize_avatar(raw)


def test_description_and_color():
    assert wi.normalize_description("x" * 300) == "x" * 300
    with pytest.raises(ValueError, match="Deskripsi maksimal 300 karakter"):
        wi.normalize_description("x" * 301)
    assert wi.normalize_description("  x ") == "x"
    assert wi.normalize_description(None) == ""
    assert wi.normalize_color_idx(0) == 0
    assert wi.normalize_color_idx(7) == 7
    assert wi.normalize_color_idx(None) is None
    for bad in (8, -1, "1", True):
        with pytest.raises(ValueError, match="Warna tidak valid"):
            wi.normalize_color_idx(bad)


def test_patch_owner_updates_fields(client):
    u = U(client)
    lid = _workspace(u)
    r = u.patch(f"/api/lists/{lid}", json={"name": "Baru", "description": "Desk", "color_idx": 3, "avatar": "🔥"})
    assert r.status_code == 200, r.text
    b = r.json()
    assert (b["name"], b["description"], b["color_idx"], b["avatar"]) == ("Baru", "Desk", 3, "🔥")
    assert b["updated_at"] and b["role"] == "owner" and "member_count" in b and "pinned" in b
    it = _item(u, lid)
    assert (it["name"], it["description"], it["color_idx"], it["avatar"], it["updated_at"]) == \
        ("Baru", "Desk", 3, "🔥", b["updated_at"])


def test_patch_partial_and_reset(client):
    u = U(client)
    lid = _workspace(u)
    r = u.patch(f"/api/lists/{lid}", json={"name": "N", "color_idx": 2, "avatar": "ab"})
    assert r.status_code == 200
    r = u.patch(f"/api/lists/{lid}", json={"description": "a"})
    b = r.json()
    assert (b["name"], b["color_idx"], b["avatar"], b["description"]) == ("N", 2, "AB", "a")
    r = u.patch(f"/api/lists/{lid}", json={"color_idx": None, "avatar": None})
    b = r.json()
    assert b["color_idx"] is None and b["avatar"] is None and b["name"] == "N"


def test_patch_member_forbidden_and_missing(client):
    o, m = U(client), U(client)
    lid = _workspace(o)
    _add_member(lid, m.id)
    assert m.patch(f"/api/lists/{lid}", json={"description": "x"}).status_code == 403
    assert o.patch("/api/lists/99999999", json={"description": "x"}).status_code == 404


def test_patch_validation_422(client):
    u = U(client)
    lid = _workspace(u)
    r = u.patch(f"/api/lists/{lid}", json={"description": "x" * 301})
    assert r.status_code == 422 and "Deskripsi maksimal 300 karakter" in str(r.json()["detail"])
    r = u.patch(f"/api/lists/{lid}", json={"avatar": "ABC"})
    assert r.status_code == 422 and "Avatar harus 1–2 huruf/angka atau satu emoji" in str(r.json()["detail"])
    r = u.patch(f"/api/lists/{lid}", json={"color_idx": 8})
    assert r.status_code == 422 and "Warna tidak valid" in str(r.json()["detail"])
    r = u.patch(f"/api/lists/{lid}", json={"name": ""})
    assert r.status_code == 422


def test_member_sees_identity(client):
    o, m = U(client), U(client)
    lid = _workspace(o)
    _add_member(lid, m.id)
    o.patch(f"/api/lists/{lid}", json={"description": "D", "color_idx": 5, "avatar": "Z"})
    it = _item(m, lid)
    assert (it["description"], it["color_idx"], it["avatar"]) == ("D", 5, "Z") and it["updated_at"]
    g = m.get(f"/api/lists/{lid}").json()
    assert (g["description"], g["color_idx"], g["avatar"]) == ("D", 5, "Z") and g["updated_at"]


def test_new_workspace_defaults(client):
    u = U(client)
    it = _item(u, _workspace(u))
    assert it["description"] == "" and it["color_idx"] is None and it["avatar"] is None
    assert it["updated_at"] is None


def test_preview_has_owner_and_count(client):
    o, m = U(client), U(client)
    lid = _workspace(o)
    _add_member(lid, m.id)
    code = o.post(f"/api/lists/{lid}/generate-link").json()["code"]
    p = m.get(f"/api/lists/preview/{code}").json()
    assert p["owner_name"] == o.name
    assert p["member_count"] == 2


def test_identity_migration_idempotent():
    webapp.migrate_db()
    webapp.migrate_db()
    conn = db()
    cols = [r[1] for r in conn.execute("PRAGMA table_info(shared_lists)").fetchall()]
    conn.close()
    for c in ("description", "color_idx", "avatar", "updated_at"):
        assert c in cols


def test_patch_workspace_vanishes_mid_request_404(client, monkeypatch):
    """Workspace terhapus setelah update tetapi sebelum dibaca ulang → 404, bukan 500 (StopIteration)."""
    u = U(client)
    lid = _workspace(u)
    monkeypatch.setattr(webapp.TaskRepository, "get_lists_for_user", lambda self, uid: [])
    r = u.patch(f"/api/lists/{lid}", json={"description": "x"})
    assert r.status_code == 404, r.text
