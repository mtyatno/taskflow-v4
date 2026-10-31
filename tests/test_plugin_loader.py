"""plugin_loader + plugin_host — discover, ensure_schema berpagar plg_, health, router plugin
(spec Fase 0b K6–K10, §4.4; rencana PR B T2–T4)."""
import asyncio
import inspect
import json
import logging
import shutil
import sys
from pathlib import Path

import pytest

import dbconn
import plugin_host
import plugin_loader

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "plugins"
DEMO_SRC = (FIXTURES / "demo-server.py").read_text(encoding="utf-8")


def _restore_host():
    """Kembalikan keadaan global seperti setelah `import webapp` (bila webapp sudah dimuat)."""
    plugin_loader._reset_for_tests()
    plugin_host._reset_for_tests()
    wa = sys.modules.get("webapp")
    if wa is not None:
        plugin_host.bind(current_user=wa.get_current_user, db_path=lambda: wa.DB_PATH)
        plugin_loader.load_known()


@pytest.fixture(autouse=True)
def reset():
    plugin_loader._reset_for_tests()
    yield
    _restore_host()


def _write_index(dirpath, ids, default=False):
    p = Path(dirpath) / "index.json"
    p.write_text(json.dumps({"v": 1, "plugins": [{"id": i, "defaultEnabled": default} for i in ids]}),
                 encoding="utf-8")
    return p


def _new_db(tmp_path, name="m.db"):
    path = str(tmp_path / name)
    c = dbconn.connect(path)
    c.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)")
    c.execute("INSERT INTO users (id) VALUES (1)")
    c.commit()
    c.close()
    return path


def _tables(path):
    c = dbconn.connect(path)
    try:
        return {r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    finally:
        c.close()


def _plugin_with_schema(tmp_path, pid, body):
    """Plugin `pid` di tmp_path dengan ensure_schema berisi `body` (baris-baris kode ber-indent 4)."""
    d = tmp_path / f"plg-{pid}"
    d.mkdir(exist_ok=True)
    src = ("MIN_HOST_API = 1\n\n"
           "def ensure_schema(conn):\n" + body + "\n")
    (d / f"{pid}.py").write_text(src, encoding="utf-8")
    return d


# ── load_known ───────────────────────────────────────────────────────────────

def test_load_known_ok_and_broken(tmp_path, caplog):
    known = plugin_loader.load_known(FIXTURES / "index.json")
    assert known["demo-server"] == {"defaultEnabled": False}
    assert plugin_loader.known()["demo-server"] == {"defaultEnabled": False}
    assert plugin_loader.index_ok() is True
    assert plugin_loader.default_enabled("demo-server") is False
    assert plugin_loader.default_enabled("nope") is False

    bad_json = tmp_path / "bad.json"
    bad_json.write_text("{rusak", encoding="utf-8")
    not_list = tmp_path / "notlist.json"
    not_list.write_text(json.dumps({"v": 1, "plugins": {"a": 1}}), encoding="utf-8")
    with caplog.at_level(logging.ERROR):
        for p in (tmp_path / "hilang.json", bad_json, not_list):
            assert plugin_loader.load_known(p) == {}
            assert plugin_loader.known() == {}
            assert plugin_loader.index_ok() is False
    assert any(r.levelno == logging.ERROR for r in caplog.records)


def test_load_known_real_index_has_heatmap():
    known = plugin_loader.load_known()
    assert "habit-heatmap" in known
    assert plugin_loader.index_ok() is True


# ── discover ─────────────────────────────────────────────────────────────────

def test_discover_fixture_ok_and_skips_underscore():
    plugin_loader.load_known(FIXTURES / "index.json")
    loaded, rejected = plugin_loader.discover(FIXTURES, plugin_loader.known())
    assert rejected == {}
    assert [p.id for p in loaded] == ["demo-server"]
    p = loaded[0]
    assert len(p.router.routes) == 2
    assert callable(p.ensure_schema)
    assert "alurik_plugins.demo_server" in sys.modules
    assert not any(k.startswith("alurik_plugins._skip") for k in sys.modules)


ASYNC_EP = DEMO_SRC.replace("def list_items(", "async def list_items(")
ALLOW_ASYNC_EP = DEMO_SRC.replace('@router.get("/items")\ndef list_items(',
                                  '@host.allow_async\n@router.get("/items")\nasync def list_items(')

REJECT_CASES = [
    # (nama file, sumber, potongan alasan; None = lolos)
    ("bad-async.py", ASYNC_EP, "async"),
    ("ok-async.py", ALLOW_ASYNC_EP, None),
    ("hook-written.py", DEMO_SRC + "\non_task_written = lambda *a: None\n",
     "on_task_written belum didukung (Fase 1)"),
    ("hook-jobs.py", DEMO_SRC + "\njobs = []\n", "jobs belum didukung (ditunda, Lampiran B)"),
    ("hook-bot.py", DEMO_SRC + "\ndef register_bot(app):\n    pass\n",
     "register_bot belum didukung (ditunda, Lampiran B)"),
    ("hook-intake.py", DEMO_SRC + "\nintake = {}\n", "intake belum didukung (ditunda, Lampiran B)"),
    ("with-prefix.py", DEMO_SRC.replace("router = APIRouter()", 'router = APIRouter(prefix="/x")'), "prefix"),
    ("not-router.py", DEMO_SRC + "\nrouter = object()\n", "router bukan APIRouter"),
    ("Bad_Id.py", DEMO_SRC, "id tidak valid"),
    ("state.py", DEMO_SRC, "dicadangkan"),
    ("not-indexed.py", DEMO_SRC, "tidak terdaftar"),
    ("import-boom.py", 'raise ValueError("boom")\n', "import gagal: ValueError: boom"),
    ("import-exit.py", "import sys\nsys.exit(3)\n", "import gagal: SystemExit"),
    ("host-api-2.py", DEMO_SRC.replace("MIN_HOST_API = 1", "MIN_HOST_API = 2"), "butuh host API 2, host 1"),
    ("bad-schema.py", DEMO_SRC + "\nensure_schema = 5\n", "ensure_schema harus fungsi (conn)"),
    ("bad-schema-args.py", DEMO_SRC + "\ndef ensure_schema(conn, extra):\n    pass\n",
     "ensure_schema harus fungsi (conn)"),
]


@pytest.mark.parametrize("fname,src,reason", REJECT_CASES, ids=[c[0] for c in REJECT_CASES])
def test_discover_rejections(tmp_path, fname, src, reason):
    d = tmp_path / "plg"
    d.mkdir()
    (d / fname).write_text(src, encoding="utf-8")
    (d / "zz-healthy.py").write_text(DEMO_SRC, encoding="utf-8")
    pid = fname[:-3]
    ids = ["zz-healthy"] + ([pid] if pid not in ("not-indexed",) else [])
    plugin_loader.load_known(_write_index(tmp_path, ids))
    loaded, rejected = plugin_loader.discover(d, plugin_loader.known())
    names = [p.id for p in loaded]
    assert "zz-healthy" in names
    mod_name = "alurik_plugins." + pid.replace("-", "_")
    if reason is None:
        assert pid in names and pid not in rejected
        assert mod_name in sys.modules
    else:
        assert pid not in names
        assert reason in rejected[pid], rejected[pid]
        assert mod_name not in sys.modules


# ── migrate / health ─────────────────────────────────────────────────────────

def test_migrate_creates_plugin_states_and_plugin_tables(tmp_path):
    db = _new_db(tmp_path)
    plugin_loader.load_known(FIXTURES / "index.json")
    loaded, _ = plugin_loader.discover(FIXTURES, plugin_loader.known())
    assert plugin_loader.health("demo-server") == "unknown"
    res = plugin_loader.migrate(db, loaded)
    assert res == {"demo-server": "ok"}
    assert {"plugin_states", "plg_demo_server_items"} <= _tables(db)
    assert plugin_loader.health("demo-server") == "ok"
    assert plugin_loader.migrate(db, loaded) == {"demo-server": "ok"}
    assert plugin_loader.health("demo-server") == "ok"


def _discover_one(tmp_path, pid, body):
    d = _plugin_with_schema(tmp_path, pid, body)
    plugin_loader.load_known(_write_index(tmp_path, [pid]))
    loaded, rejected = plugin_loader.discover(d, plugin_loader.known())
    assert rejected == {}, rejected
    return loaded


def test_migrate_rejects_unprefixed_object(tmp_path, caplog):
    db = _new_db(tmp_path)
    loaded = _discover_one(tmp_path, "demo-server", (
        "    conn.execute('CREATE TABLE IF NOT EXISTS plg_demo_server_items (id INTEGER PRIMARY KEY)')\n"
        "    conn.execute('CREATE TABLE IF NOT EXISTS items_bocor (id INTEGER PRIMARY KEY)')"))
    with caplog.at_level(logging.ERROR):
        res = plugin_loader.migrate(db, loaded)
    assert res == {"demo-server": "schema_failed"}
    assert plugin_loader.health("demo-server") == "schema_failed"
    t = _tables(db)
    assert "plg_demo_server_items" not in t and "items_bocor" not in t
    assert "plugin_states" in t
    errs = [r.getMessage() for r in caplog.records if r.levelno == logging.ERROR]
    assert any("demo-server" in m and "items_bocor" in m for m in errs), errs


def test_migrate_rejects_host_table_change(tmp_path):
    db = _new_db(tmp_path)
    loaded = _discover_one(tmp_path, "demo-server", "    conn.execute('ALTER TABLE users ADD COLUMN x TEXT')")
    assert plugin_loader.migrate(db, loaded) == {"demo-server": "schema_failed"}
    c = dbconn.connect(db)
    try:
        cols = [r["name"] for r in c.execute("PRAGMA table_info(users)")]
    finally:
        c.close()
    assert "x" not in cols


def test_migrate_rejects_prefixed_trigger_on_host_table(tmp_path):
    db = _new_db(tmp_path)
    loaded = _discover_one(tmp_path, "demo-server", (
        "    conn.execute('CREATE TRIGGER plg_demo_server_trg AFTER INSERT ON users BEGIN SELECT 1; END')"))
    assert plugin_loader.migrate(db, loaded) == {"demo-server": "schema_failed"}


def test_migrate_rejects_commit_inside_ensure_schema(tmp_path):
    db = _new_db(tmp_path)
    loaded = _discover_one(tmp_path, "demo-server", (
        "    conn.execute('CREATE TABLE IF NOT EXISTS plg_demo_server_items (id INTEGER PRIMARY KEY)')\n"
        "    conn.commit()"))
    assert plugin_loader.migrate(db, loaded) == {"demo-server": "schema_failed"}
    assert "plg_demo_server_items" not in _tables(db)


def test_migrate_fk_check_scoped(tmp_path):
    db = _new_db(tmp_path)
    c = dbconn.connect(db, foreign_keys=False)
    c.execute("CREATE TABLE host_child (id INTEGER PRIMARY KEY, user_id INTEGER REFERENCES users(id))")
    c.execute("INSERT INTO host_child (user_id) VALUES (999)")  # anak yatim pra-ada
    c.commit()
    c.close()
    loaded = _discover_one(tmp_path, "demo-server",
                           "    conn.execute('CREATE TABLE IF NOT EXISTS plg_demo_server_items (id INTEGER PRIMARY KEY)')")
    assert plugin_loader.migrate(db, loaded) == {"demo-server": "ok"}

    plugin_loader._reset_for_tests()
    loaded = _discover_one(tmp_path, "bad-fk", (
        "    conn.execute('CREATE TABLE IF NOT EXISTS plg_bad_fk_items (id INTEGER PRIMARY KEY,"
        " user_id INTEGER REFERENCES users(id))')\n"
        "    conn.execute('INSERT INTO plg_bad_fk_items (user_id) VALUES (12345)')"))
    assert plugin_loader.migrate(db, loaded) == {"bad-fk": "schema_failed"}
    assert "plg_bad_fk_items" not in _tables(db)


def test_migrate_never_raises(tmp_path):
    db = _new_db(tmp_path)
    d = tmp_path / "plg"
    d.mkdir()
    (d / "boom-schema.py").write_text("def ensure_schema(conn):\n    raise RuntimeError('rusak')\n", encoding="utf-8")
    (d / "demo-server.py").write_text(DEMO_SRC, encoding="utf-8")
    (d / "no-schema.py").write_text("MIN_HOST_API = 1\n", encoding="utf-8")
    plugin_loader.load_known(_write_index(tmp_path, ["boom-schema", "demo-server", "no-schema"]))
    loaded, rejected = plugin_loader.discover(d, plugin_loader.known())
    assert rejected == {}
    res = plugin_loader.migrate(db, loaded)
    assert res == {"boom-schema": "schema_failed", "demo-server": "ok", "no-schema": "ok"}
    # DB tak bisa dibuka pun tidak melempar.
    res = plugin_loader.migrate(str(tmp_path / "tidak" / "ada" / "x.db"), loaded)
    assert set(res.values()) <= {"schema_failed", "ok"}


def test_host_get_conn_uses_bound_path_and_current_user_unbound(tmp_path):
    plugin_host._reset_for_tests()
    p = tmp_path / "host.db"
    plugin_host.bind(db_path=lambda: str(p))
    with plugin_host.get_conn() as c:
        assert c.isolation_level == "IMMEDIATE"
        assert c.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        c.execute("CREATE TABLE t (x)")
    assert p.exists()
    with pytest.raises(RuntimeError, match="belum di-bind"):
        asyncio.run(plugin_host.current_user(None))
    assert plugin_host.HOST_API == 1
    assert plugin_host.write_tx is dbconn.write_tx
    assert plugin_host.now_utc().utcoffset().total_seconds() == 0

    def f():
        pass
    assert plugin_host.allow_async(f) is f and f.__plugin_allow_async__ is True


# ── Router plugin /api/plugins/<id> (Task 3) ─────────────────────────────────

import uuid  # noqa: E402
from datetime import datetime, timedelta, timezone  # noqa: E402

from fastapi import FastAPI  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

import plugin_states  # noqa: E402
import webapp  # noqa: E402
from conftest import db as _rawdb, register_user  # noqa: E402


def _bearer(tok):
    return {"Authorization": f"Bearer {tok}"}


def _user(client, prefix="plg"):
    name = f"{prefix}_{uuid.uuid4().hex[:8]}"
    r = register_user(client, name, f"{name}@x.com")
    return r["token"], r["user_id"], name


def _uid_of(username):
    c = _rawdb()
    try:
        return c.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()["id"]
    finally:
        c.close()


def _set_enabled(uid, pid, enabled):
    with dbconn.get_conn(webapp.DB_PATH) as c:
        plugin_states.put_state(c, uid, pid, fields={"enabled": enabled}, updated_at=None,
                                now=datetime.now(timezone.utc))


@pytest.fixture
def app_demo():
    plugin_host.bind(current_user=webapp.get_current_user, db_path=lambda: webapp.DB_PATH)
    app = FastAPI()
    loaded = plugin_loader.init_web(app, plugins_dir=FIXTURES, index_path=FIXTURES / "index.json")
    assert [p.id for p in loaded] == ["demo-server"]
    assert plugin_loader.health("demo-server") == "pending"
    plugin_loader.migrate(webapp.DB_PATH)
    assert plugin_loader.health("demo-server") == "ok"
    return TestClient(app)


def test_plugin_route_requires_login(app_demo):
    assert app_demo.get("/api/plugins/demo-server/items").status_code == 401


def test_plugin_route_disabled_by_default(client, app_demo):
    tok, _, _ = _user(client)
    r = app_demo.get("/api/plugins/demo-server/items", headers=_bearer(tok))
    assert r.status_code == 403
    assert r.json()["detail"] == {"code": "PLUGIN_DISABLED", "plugin_id": "demo-server"}


def test_plugin_route_enabled_after_state_on(client, app_demo):
    tok1, _, n1 = _user(client)
    tok2, _, n2 = _user(client)
    _set_enabled(_uid_of(n1), "demo-server", True)
    _set_enabled(_uid_of(n2), "demo-server", True)
    r = app_demo.post("/api/plugins/demo-server/items", json={"title": "a"}, headers=_bearer(tok1))
    assert r.status_code == 200, r.text
    new_id = r.json()["id"]
    r = app_demo.get("/api/plugins/demo-server/items", headers=_bearer(tok1))
    assert r.status_code == 200
    assert r.json() == {"items": [{"id": new_id, "title": "a"}]}
    r = app_demo.get("/api/plugins/demo-server/items", headers=_bearer(tok2))
    assert r.json() == {"items": []}
    # OFF lagi → 403
    _set_enabled(_uid_of(n1), "demo-server", False)
    assert app_demo.get("/api/plugins/demo-server/items", headers=_bearer(tok1)).status_code == 403


def _ext_token(username):
    uid = _uid_of(username)
    ext = webapp.create_ext_token(uid, username)
    now = datetime.now(timezone.utc)
    c = _rawdb()
    try:
        c.execute("INSERT INTO ext_tokens (user_id, token, state, created_at, expires_at) VALUES (?,?,?,?,?)",
                  (uid, ext, None, now.isoformat(), (now + timedelta(days=30)).isoformat()))
        c.commit()
    finally:
        c.close()
    return ext


def test_plugin_route_ext_token_forbidden(client, app_demo):
    _, _, name = _user(client)
    _set_enabled(_uid_of(name), "demo-server", True)
    r = app_demo.get("/api/plugins/demo-server/items", headers=_bearer(_ext_token(name)))
    assert r.status_code == 403
    assert r.json()["detail"] == {"code": "PLUGIN_FORBIDDEN_TOKEN"}


def test_plugin_route_unavailable_when_schema_failed(client, app_demo):
    tok, _, name = _user(client)
    _set_enabled(_uid_of(name), "demo-server", True)
    for h in ("schema_failed", "pending"):
        plugin_loader._health["demo-server"] = h
        r = app_demo.get("/api/plugins/demo-server/items", headers=_bearer(tok))
        assert r.status_code == 503
        assert r.json()["detail"] == {"code": "PLUGIN_UNAVAILABLE", "plugin_id": "demo-server"}


def test_current_user_resolved_once_per_request(client, app_demo):
    tok, _, name = _user(client)
    _set_enabled(_uid_of(name), "demo-server", True)
    calls = []

    async def counting(request):
        calls.append(1)
        return await webapp.get_current_user(request)

    plugin_host.bind(current_user=counting, db_path=lambda: webapp.DB_PATH)
    r = app_demo.get("/api/plugins/demo-server/items", headers=_bearer(tok))
    assert r.status_code == 200
    assert len(calls) == 1


def test_require_plugin_enabled_is_sync_dependency():
    dep = plugin_loader.require_plugin_enabled("demo-server")
    assert not inspect.iscoroutinefunction(dep)


def test_init_web_never_raises(tmp_path, caplog):
    d = tmp_path / "plg"
    d.mkdir()
    (d / "broken-one.py").write_text("raise RuntimeError('x')\n", encoding="utf-8")
    idx = tmp_path / "index.json"
    idx.write_text("{rusak", encoding="utf-8")
    app = FastAPI()
    n_before = len(app.routes)
    with caplog.at_level(logging.INFO, logger="alurik.plugins"):
        loaded = plugin_loader.init_web(app, plugins_dir=d, index_path=idx)
    assert loaded == []
    assert len(app.routes) == n_before
    msgs = [r.getMessage() for r in caplog.records]
    assert any("plugin server: 0 dimuat, 1 ditolak" in m for m in msgs), msgs
    assert any("plugin broken-one ditolak" in m for m in msgs), msgs


def test_load_for_bot_no_ddl_no_routes(tmp_path, caplog):
    db = _new_db(tmp_path)
    plugin_host.bind(db_path=lambda: db)
    with caplog.at_level(logging.INFO, logger="alurik.plugins"):
        res = plugin_loader.load_for_bot(None, plugins_dir=FIXTURES, index_path=FIXTURES / "index.json")
    assert res == (1, 0)
    assert "plg_demo_server_items" not in _tables(db)
    assert "plugin_states" not in _tables(db)
    assert any("plugin server: 1 dimuat, 0 ditolak" in r.getMessage() for r in caplog.records)
