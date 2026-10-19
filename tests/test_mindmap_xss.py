"""XSS mindmap bersama: node dangerouslySetInnerHTML / hyperLink javascript: dibuang server sebelum disimpan.

Mesin mind-elixir memakai node.dangerouslySetInnerHTML sebagai innerHTML dan node.hyperLink sebagai href;
data_json peta bersama ditulis anggota mana pun (create/update)."""
import json
import os

import safehtml
from conftest import register_user
from repository import TaskRepository


def _hdr(u):
    return {"Authorization": f"Bearer {u.get('token') or u.get('access_token')}"}


def _uid(u):
    return u.get("user_id") or u.get("id")


EVIL = {
    "nodeData": {
        "id": "root", "topic": "Peta", "root": True,
        "dangerouslySetInnerHTML": "<img src=x onerror=window.__xss=1>",
        "hyperLink": "javascript:window.__xss=1",
        "children": [
            {"id": "a", "topic": "aman", "hyperLink": "https://contoh.id/x"},
            {"id": "b", "topic": "b", "hyperLink": " JaVa&#x73;cript:window.__xss=1",
             "DangerouslyFoo": "x",
             "children": [{"id": "c", "topic": "c", "dangerouslySetInnerHTML": "<svg onload=x>"}]},
        ],
    },
    "summaries": [{"id": "s1", "label": "S", "dangerouslySetInnerHTML": "<b>x</b>"}],
    "arrows": [{"id": "ar", "label": "A", "hyperLink": "vbscript:x"}],
    "direction": 2,
}


def _setup_shared(client):
    owner = register_user(client, "mmxowner", "mmxowner@test.id")
    member = register_user(client, "mmxmember", "mmxmember@test.id")
    repo = TaskRepository(os.environ["DB_PATH"])
    lid = repo.create_shared_list("Tim XSS", _uid(owner))["id"]
    repo.add_list_member(lid, _uid(member))
    client.cookies.clear()
    res = client.post("/api/mindmaps", json={
        "title": "Peta tim", "list_id": lid,
        "data_json": json.dumps({"nodeData": {"id": "root", "topic": "Peta", "root": True, "children": []}}),
    }, headers=_hdr(owner))
    assert res.status_code == 200, res.text
    return owner, member, res.json()["id"]


def _stored(mid):
    import sqlite3
    conn = sqlite3.connect(os.environ["DB_PATH"])
    try:
        return json.loads(conn.execute("SELECT data_json FROM mindmaps WHERE id = ?", (mid,)).fetchone()[0])
    finally:
        conn.close()


def _assert_clean(data):
    root = data["nodeData"]
    assert "dangerouslySetInnerHTML" not in root
    assert "hyperLink" not in root
    a, b = root["children"]
    assert a["hyperLink"] == "https://contoh.id/x"
    assert "hyperLink" not in b and "DangerouslyFoo" not in b
    assert "dangerouslySetInnerHTML" not in b["children"][0]
    assert b["children"][0]["topic"] == "c"
    assert data["summaries"] == [{"id": "s1", "label": "S"}]
    assert data["arrows"] == [{"id": "ar", "label": "A"}]
    assert data["direction"] == 2
    assert "dangerously" not in json.dumps(data).lower()
    assert "javascript" not in json.dumps(data).lower()


def test_member_put_strips_dangerous_fields(client):
    owner, member, mid = _setup_shared(client)
    client.cookies.clear()
    res = client.put(f"/api/mindmaps/{mid}", json={"data_json": json.dumps(EVIL)}, headers=_hdr(member))
    assert res.status_code == 200, res.text
    _assert_clean(_stored(mid))
    _assert_clean(json.loads(res.json()["data_json"]))
    # pemilik membaca versi bersih
    client.cookies.clear()
    got = client.get(f"/api/mindmaps/{mid}", headers=_hdr(owner))
    _assert_clean(json.loads(got.json()["data_json"]))


def test_create_strips_dangerous_fields(client):
    u = register_user(client, "mmxcreate", "mmxcreate@test.id")
    client.cookies.clear()
    res = client.post("/api/mindmaps", json={"title": "x", "data_json": json.dumps(EVIL)}, headers=_hdr(u))
    assert res.status_code == 200, res.text
    _assert_clean(_stored(res.json()["id"]))


def test_clean_data_json_kept_verbatim(client):
    u = register_user(client, "mmxclean", "mmxclean@test.id")
    raw = '{"nodeData":{"id":"root","topic":"T","root":true,"hyperLink":"https://a.b","children":[]}}'
    client.cookies.clear()
    res = client.post("/api/mindmaps", json={"title": "x", "data_json": raw}, headers=_hdr(u))
    assert res.status_code == 200, res.text
    assert res.json()["data_json"] == raw


def test_sanitize_mind_tree_unit():
    assert safehtml.sanitize_mind_tree("x") == "x"
    assert safehtml.sanitize_mind_tree(None) is None
    src = {"a": [{"dangerouslySetInnerHTML": 1, "hyperLink": "/rel", "k": [1, {"hyperLink": None}]}]}
    out = safehtml.sanitize_mind_tree(src)
    assert out == {"a": [{"hyperLink": "/rel", "k": [1, {}]}]}
    assert "dangerouslySetInnerHTML" in src["a"][0]  # salinan, bukan mutasi
    assert safehtml.sanitize_mind_json("{bukan json") == "{bukan json"
    assert safehtml.sanitize_mind_json("42") == "42"
    assert safehtml.sanitize_mind_json('"s"') == '"s"'
    deep = "[" * 20000 + "]" * 20000
    assert safehtml.sanitize_mind_json(deep) == deep
