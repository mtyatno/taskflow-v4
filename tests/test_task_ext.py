"""tasks.ext — field plugin di task, patch per kunci (spec Fase 1 K4–K7, §5.2, §6.1; rencana PR 1a-1 T1–T2)."""
import json
import logging
from pathlib import Path

import pytest

import dbconn
import plugin_loader
import task_ext

FIXTURES = Path(__file__).resolve().parent / "fixtures"
PLUGIN_FIXTURES = FIXTURES / "plugins"
VECTORS = json.loads((FIXTURES / "taskext_vectors.json").read_text(encoding="utf-8"))


@pytest.fixture
def demo_index():
    plugin_loader.load_known(PLUGIN_FIXTURES / "index.json")
    task_ext._reset_for_tests()
    yield
    plugin_loader.load_known()
    task_ext._reset_for_tests()


def _code(fn, *a, **k):
    try:
        fn(*a, **k)
    except task_ext.ExtError as e:
        return e.code, e.key
    return "ok", None


# ── Unit (T1) ─────────────────────────────────────────────────────────────────

def test_vectors_keys_refs_sizes(demo_index):
    for k in VECTORS["keys"]["valid"]:
        assert task_ext.KEY_RE.fullmatch(k), k
    for k in VECTORS["keys"]["invalid"]:
        assert not task_ext.KEY_RE.fullmatch(k), k
        assert _code(task_ext.clean_patch, {k: 1}, allow_null=True) == ("EXT_INVALID", k)
    for v in VECTORS["refs"]:
        code, key = _code(task_ext.clean_patch, {"demo-ext.a": v["value"]}, allow_null=True)
        assert code == v["server"], v
        if code != "ok":
            assert key == "demo-ext.a"
    for v in VECTORS["sizes"]:
        code, key = _code(task_ext.apply_patch, "{}", v["ext"])
        assert code == (v["error"] or "ok"), v["name"]
        assert key == v["key"], v["name"]


def test_ensure_schema_idempotent(tmp_path):
    path = str(tmp_path / "t.db")
    conn = dbconn.connect(path)
    try:
        conn.execute("CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT)")
        conn.execute("INSERT INTO tasks (title) VALUES ('lama')")
        conn.commit()
        assert task_ext.ensure_schema(conn) is True
        conn.commit()
        assert task_ext.ensure_schema(conn) is False
        cols = {r["name"]: r for r in conn.execute("PRAGMA table_info(tasks)").fetchall()}
        assert cols["ext"]["notnull"] == 1
        assert cols["ext"]["dflt_value"] == "'{}'"
        assert conn.execute("SELECT ext FROM tasks").fetchone()[0] == "{}"
    finally:
        conn.close()
    empty = dbconn.connect(str(tmp_path / "kosong.db"))
    try:
        assert task_ext.ensure_schema(empty) is False
    finally:
        empty.close()


def test_apply_patch_per_key():
    out = json.loads(task_ext.apply_patch('{"demo-ext.a":1,"x-plug.k":2}', {"demo-ext.b": 3, "demo-ext.a": None}))
    assert out == {"x-plug.k": 2, "demo-ext.b": 3}
    for raw in (None, "", "rusak", "[1]", '"s"', "null"):
        assert json.loads(task_ext.apply_patch(raw, {"demo-ext.a": 1})) == {"demo-ext.a": 1}
    # hasil ringkas, non-ASCII apa adanya
    assert task_ext.apply_patch("{}", {"demo-ext.a": "é"}) == '{"demo-ext.a":"é"}'


def _sized(ns, target, ch="x"):
    base = len(task_ext.dumps({f"{ns}.v": ""}).encode("utf-8"))
    n = (target - base) // len(ch.encode("utf-8"))
    return {f"{ns}.v": ch * n}


def test_size_limits():
    assert task_ext.PLUGIN_MAX_BYTES == 4096 and task_ext.TOTAL_MAX_BYTES == 16384
    ok = _sized("demo-ext", 4096)
    assert len(task_ext.dumps(ok).encode("utf-8")) == 4096
    task_ext.apply_patch("{}", ok)
    big = _sized("demo-ext", 4097)
    assert _code(task_ext.apply_patch, "{}", big) == ("EXT_TOO_LARGE", "demo-ext")
    many = {}
    for ns in ("aaa-one", "bbb-two", "ccc-three", "ddd-four", "eee-five"):
        many.update(_sized(ns, 3500))
    assert _code(task_ext.apply_patch, "{}", many) == ("EXT_TOO_LARGE", None)
    # non-ASCII: jumlah karakter < 4096 tetapi byte UTF-8 > 4096
    base = len(task_ext.dumps({"demo-ext.v": ""}).encode("utf-8"))
    accent = {"demo-ext.v": "é" * ((4097 - base + 1) // 2)}
    assert len(task_ext.dumps(accent)) < 4096
    assert _code(task_ext.apply_patch, "{}", accent) == ("EXT_TOO_LARGE", "demo-ext")
    # gabungan dengan isi lama ikut dihitung
    half = _sized("demo-ext", 2100)
    old = task_ext.dumps({"demo-ext.w": half["demo-ext.v"]})
    assert _code(task_ext.apply_patch, old, half)[0] == "EXT_TOO_LARGE"
    # menghapus kunci membuat muat lagi
    assert json.loads(task_ext.apply_patch(old, {"demo-ext.w": None, **half})) == half


def test_clean_patch_unknown_namespace_dropped_once_warned(demo_index, monkeypatch, caplog):
    calls = []
    real = plugin_loader.refresh_known

    def counting():
        calls.append(1)
        return real()

    monkeypatch.setattr(plugin_loader, "refresh_known", counting)
    with caplog.at_level(logging.WARNING):
        for _ in range(2):
            out = task_ext.clean_patch({"demo-ext.a": 1, "lain-plugin.b": 2}, allow_null=True)
            assert out == {"demo-ext.a": 1}
    warns = [r for r in caplog.records if r.levelno == logging.WARNING and "lain-plugin" in r.getMessage()]
    assert len(warns) == 1
    assert len(calls) == 2  # sekali per permintaan yang memuat namespace asing
    calls.clear()
    task_ext.clean_patch({"demo-ext.a": 1}, allow_null=True)
    assert calls == []  # tanpa namespace asing → tidak membaca ulang indeks


def test_clean_patch_fail_open_when_index_broken(demo_index, monkeypatch, caplog):
    monkeypatch.setattr(plugin_loader, "_index_ok", False)
    monkeypatch.setattr(plugin_loader, "_known", {})
    with caplog.at_level(logging.WARNING):
        out = task_ext.clean_patch({"demo-ext.a": 1, "lain-plugin.b": 2}, allow_null=True)
        task_ext.clean_patch({"lain-plugin.c": 3}, allow_null=True)
    assert out == {"demo-ext.a": 1, "lain-plugin.b": 2}
    assert len([r for r in caplog.records if r.levelno == logging.WARNING]) == 1
    # bentuk tetap divalidasi walau gagal-terbuka
    assert _code(task_ext.clean_patch, {"Bad.key": 1}, allow_null=True) == ("EXT_INVALID", "Bad.key")


def test_refs(demo_index):
    assert task_ext.clean_patch({"demo-ext.a": {"$task": 12}}, allow_null=True) == {"demo-ext.a": {"$task": 12}}
    bad = [{"$task": "uuid"}, {"$task": True}, {"$task": 1, "x": 2}, {"$task": 1.5}]
    for b in bad:
        for wrapped in (b, [b], {"deep": [{"x": b}]}):
            assert _code(task_ext.clean_patch, {"demo-ext.a": wrapped}, allow_null=True) == \
                ("EXT_TASK_REF", "demo-ext.a"), wrapped


def test_allow_null(demo_index):
    assert task_ext.clean_patch({"demo-ext.a": None}, allow_null=False) == {}
    assert task_ext.clean_patch({"demo-ext.a": None}, allow_null=True) == {"demo-ext.a": None}


def test_clean_patch_shape(demo_index):
    for bad in ([], "x", 1, None):
        assert _code(task_ext.clean_patch, bad, allow_null=True) == ("EXT_INVALID", None)
    # nilai yang tidak bisa jadi JSON baku
    assert _code(task_ext.clean_patch, {"demo-ext.a": float("nan")}, allow_null=True) == \
        ("EXT_INVALID", "demo-ext.a")
    assert _code(task_ext.clean_patch, {"demo-ext.a": "\ud800"}, allow_null=True) == \
        ("EXT_INVALID", "demo-ext.a")
    e = task_ext.ExtError("EXT_INVALID", "k")
    assert e.detail == {"code": "EXT_INVALID", "key": "k"}


def test_parse():
    assert task_ext.parse('{"a.b": 1}') == {"a.b": 1}
    for raw in (None, "", "rusak", "[]", "1", "null", b"{}"):
        assert task_ext.parse(raw) == {}


def test_plugin_loader_permissions(tmp_path):
    plugin_loader.load_known(PLUGIN_FIXTURES / "index.json")
    try:
        assert plugin_loader.ext_namespaces() == frozenset({"demo-ext"})
        assert plugin_loader.permissions("demo-ext") == frozenset({"task.ext"})
        assert plugin_loader.permissions("demo-server") == frozenset()
        assert plugin_loader.permissions("tidak-ada") == frozenset()
        assert plugin_loader.known()["demo-server"] == {"defaultEnabled": False}
        assert plugin_loader.known()["demo-ext"] == {"defaultEnabled": False}
        bad = tmp_path / "bad.json"
        bad.write_text("{rusak", encoding="utf-8")
        plugin_loader.load_known(bad)
        assert plugin_loader.ext_namespaces() == frozenset()
        assert plugin_loader.permissions("demo-ext") == frozenset()
    finally:
        plugin_loader.load_known()


# ── HTTP (T2) ─────────────────────────────────────────────────────────────────

import ast  # noqa: E402
import inspect  # noqa: E402
from datetime import datetime, timedelta  # noqa: E402

import webapp  # noqa: E402
from conftest import db, client  # noqa: E402,F401
from test_direct_messages import U, _mk_list, _rows  # noqa: E402

UPDATED = "memperbarui task"


def _post(u, **body):
    r = u.post("/api/tasks", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _put(u, tid, **body):
    r = u._call("put", f"/api/tasks/{tid}", json=body)
    assert r.status_code == 200, r.text
    return r.json()


def _get(u, tid):
    r = u.get(f"/api/tasks/{tid}")
    assert r.status_code == 200, r.text
    return r.json()


def _full_payload(task, **over):
    """Payload PUT gaya push klien (`taskToUpdatePayload`): record penuh, tanpa ext_patch."""
    body = {"title": task["title"], "description": task["description"], "priority": task["priority"],
            "project": task["project"] or "", "context": task["context"] or "", "deadline": "",
            "gtd_status": task["gtd_status"], "waiting_for": task["waiting_for"] or "", "assigned_to": None,
            "progress": task.get("progress") or 0, "is_focused": bool(task.get("is_focused")),
            "recurrence_type": None, "recurrence_days": None}
    body.update(over)
    return body


def _updates(user_id, task_id):
    return [r["message"] for r in _rows(
        "SELECT message FROM notifications WHERE user_id = ? AND task_id = ? ORDER BY id", user_id, task_id)
        if UPDATED in r["message"]]


def _backdate(task_id, minutes):
    conn = db()
    try:
        ts = (datetime.now() - timedelta(minutes=minutes)).isoformat()
        conn.execute("UPDATE notifications SET created_at = ? WHERE task_id = ?", (ts, task_id))
        conn.commit()
    finally:
        conn.close()


def _db_ext(tid):
    return _rows("SELECT ext FROM tasks WHERE id = ?", tid)[0]["ext"]


def test_post_with_ext_and_get_returns_object(client, demo_index):
    u = U(client, "ex")
    t = _post(u, title="a", ext={"demo-ext.note": "hai", "demo-ext.gone": None, "asing-plug.k": 1})
    assert t["ext"] == {"demo-ext.note": "hai"}
    assert _get(u, t["id"])["ext"] == {"demo-ext.note": "hai"}
    plain = _post(u, title="b")
    assert plain["ext"] == {}
    lst = {x["id"]: x for x in u.get("/api/tasks?include_done=true").json()}
    assert lst[t["id"]]["ext"] == {"demo-ext.note": "hai"}
    assert lst[plain["id"]]["ext"] == {}
    assert _db_ext(plain["id"]) == "{}"


def test_put_patch_per_key_two_devices(client, demo_index):
    u = U(client, "ex")
    t = _post(u, title="a")
    _put(u, t["id"], title="a", ext_patch={"demo-ext.a": 1})
    out = _put(u, t["id"], title="a", ext_patch={"demo-ext.b": 2})
    assert out["ext"] == {"demo-ext.a": 1, "demo-ext.b": 2}
    out = _put(u, t["id"], ext_patch={"demo-ext.a": None})
    assert out["ext"] == {"demo-ext.b": 2}


def test_put_without_ext_patch_keeps_ext(client, demo_index):
    u = U(client, "ex")
    t = _post(u, title="a", ext={"demo-ext.a": {"x": [1, 2]}})
    out = _put(u, t["id"], **_full_payload(t, title="judul baru", priority="P1"))
    assert out["title"] == "judul baru"
    assert out["ext"] == {"demo-ext.a": {"x": [1, 2]}}


def test_put_ext_only_counts_as_update(client, demo_index):
    u = U(client, "ex")
    t = _post(u, title="a")
    before = _get(u, t["id"])["updated_at"]
    out = _put(u, t["id"], ext_patch={"demo-ext.a": 1})
    assert out["ext"] == {"demo-ext.a": 1}
    assert out["updated_at"] > before
    out = _put(u, t["id"], ext_patch={"asing-plug.a": 1})
    assert out["ext"] == {"demo-ext.a": 1}
    # tanpa field apa pun tetap 400 seperti dulu
    r = u._call("put", f"/api/tasks/{t['id']}", json={})
    assert r.status_code == 400


def test_ext_422_codes(client, demo_index):
    u = U(client, "ex")
    r = u.post("/api/tasks", json={"title": "a", "ext": {"Bad.key": 1}})
    assert r.status_code == 422 and r.json()["detail"] == {"code": "EXT_INVALID", "key": "Bad.key"}
    t = _post(u, title="lama")
    url = f"/api/tasks/{t['id']}"
    r = u._call("put", url, json={"ext_patch": {"Bad.key": 1}})
    assert r.status_code == 422 and r.json()["detail"] == {"code": "EXT_INVALID", "key": "Bad.key"}
    r = u._call("put", url, json={"ext_patch": {"demo-ext.dep": {"$task": "c-1"}}})
    assert r.status_code == 422 and r.json()["detail"] == {"code": "EXT_TASK_REF", "key": "demo-ext.dep"}
    r = u.post("/api/tasks", json={"title": "a", "ext": {"demo-ext.dep": [{"$task": True}]}})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "EXT_TASK_REF"
    big = _sized("demo-ext", 4097)
    r = u.post("/api/tasks", json={"title": "a", "ext": big})
    assert r.status_code == 422 and r.json()["detail"] == {"code": "EXT_TOO_LARGE", "key": "demo-ext"}
    # PUT: sebagian sudah ada di DB → gabungan terlalu besar → seluruh PUT di-rollback
    _put(u, t["id"], ext_patch=_sized("demo-ext", 2100))
    half = {"demo-ext.w": _sized("demo-ext", 2100)["demo-ext.v"]}
    r = u._call("put", url, json={"title": "judul baru", "ext_patch": half})
    assert r.status_code == 422 and r.json()["detail"] == {"code": "EXT_TOO_LARGE", "key": "demo-ext"}
    cur = _get(u, t["id"])
    assert cur["title"] == "lama"
    assert set(cur["ext"]) == {"demo-ext.v"}
    r = u._call("put", url, json={"ext_patch": []})
    assert r.status_code == 422


def test_post_idempotent_retry_returns_ext(client, demo_index):
    u = U(client, "ex")
    body = {"title": "a", "client_id": "c-" + datetime.now().strftime("%f"), "ext": {"demo-ext.a": 1}}
    one = _post(u, **body)
    two = _post(u, **body)
    assert one["id"] == two["id"]
    assert one["ext"] == two["ext"] == {"demo-ext.a": 1}


def test_corrupt_ext_in_db_reads_empty_and_patch_recovers(client, demo_index):
    u = U(client, "ex")
    t = _post(u, title="a", ext={"demo-ext.z": 1})
    conn = db()
    try:
        conn.execute("UPDATE tasks SET ext = 'rusak' WHERE id = ?", (t["id"],))
        conn.commit()
    finally:
        conn.close()
    assert _get(u, t["id"])["ext"] == {}
    assert _put(u, t["id"], ext_patch={"demo-ext.a": 1})["ext"] == {"demo-ext.a": 1}


def test_ext_only_put_no_workspace_notification(client, demo_index):
    a, b = U(client, "xa"), U(client, "xb")
    list_id = _mk_list(a, b, name="ws")
    t = _post(a, title="rapat", list_id=list_id)
    tid = t["id"]
    _put(a, tid, **_full_payload(t, ext_patch={"demo-ext.a": 1}))
    _put(a, tid, ext_patch={"demo-ext.b": 2})
    assert _updates(b.id, tid) == []
    # task selesai: payload menulis ulang completed_at tiap kali, tetap dianggap "ext saja"
    done = _put(a, tid, **_full_payload(t, gtd_status="done"))
    _backdate(tid, webapp.TASK_UPDATE_NOTIFY_WINDOW_MIN + 1)
    n = len(_updates(b.id, tid))
    _put(a, tid, **_full_payload(done, gtd_status="done", ext_patch={"demo-ext.c": 3}))
    assert len(_updates(b.id, tid)) == n
    # perubahan inti + ext_patch → tetap diberi tahu
    _backdate(tid, webapp.TASK_UPDATE_NOTIFY_WINDOW_MIN + 1)
    _put(a, tid, **_full_payload(done, gtd_status="done", priority="P1", ext_patch={"demo-ext.c": 4}))
    assert len(_updates(b.id, tid)) == n + 1
    # PUT tanpa ext_patch dan tanpa perubahan → perilaku lama (tetap satu notifikasi)
    _backdate(tid, webapp.TASK_UPDATE_NOTIFY_WINDOW_MIN + 1)
    _put(a, tid, **_full_payload(done, gtd_status="done", priority="P1"))
    assert len(_updates(b.id, tid)) == n + 2
    assert _get(a, tid)["ext"] == {"demo-ext.a": 1, "demo-ext.b": 2, "demo-ext.c": 4}


def test_old_client_payload_ignored_fields(client, demo_index):
    u = U(client, "ex")
    t = _post(u, title="a", ext={"demo-ext.a": 1})
    out = _put(u, t["id"], title="b", ext={"demo-ext.a": 9, "demo-ext.b": 2})
    assert out["ext"] == {"demo-ext.a": 1}


def _calls_in(fn_node):
    out = []
    for node in ast.walk(fn_node):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) \
                and isinstance(node.func.value, ast.Name):
            out.append((node.lineno, f"{node.func.value.id}.{node.func.attr}",
                        [ast.unparse(a) for a in node.args]))
    return sorted(out)


def test_migrate_db_adds_ext_idempotent(monkeypatch, tmp_path):
    legacy = str(tmp_path / "legacy.db")
    monkeypatch.setattr(webapp, "DB_PATH", legacy)
    webapp.migrate_db()
    conn = dbconn.connect(legacy, foreign_keys=False)
    try:
        conn.execute("ALTER TABLE tasks DROP COLUMN ext")
        conn.execute("INSERT INTO tasks (title, created_at, updated_at) VALUES ('lama', 't', 't')")
        conn.commit()
        assert "ext" not in {r[1] for r in conn.execute("PRAGMA table_info(tasks)")}
    finally:
        conn.close()
    webapp.migrate_db()
    webapp.migrate_db()
    conn = dbconn.connect(legacy)
    try:
        cols = {r[1]: r for r in conn.execute("PRAGMA table_info(tasks)")}
        assert cols["ext"][3] == 1 and cols["ext"][4] == "'{}'"
        assert conn.execute("SELECT ext FROM tasks WHERE title = 'lama'").fetchone()[0] == "{}"
    finally:
        conn.close()
    tree = ast.parse(inspect.getsource(webapp.migrate_db))
    calls = _calls_in(tree)
    ext_calls = [c for c in calls if c[1] == "task_ext.ensure_schema"]
    assert len(ext_calls) == 1 and ext_calls[0][2] == ["conn"]
    email = [c[0] for c in calls if c[1] == "email_outbox.ensure_schema"]
    plug = [c[0] for c in calls if c[1] == "plugin_loader.migrate"]
    assert email and plug and email[0] < ext_calls[0][0] < plug[0]
