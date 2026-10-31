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
