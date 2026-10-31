"""plugin_records (bagian murni) + plugin_host.list_access — skema, vektor, seq, LWW, kursor, purge
(spec Fase 1 §5.2, §5.3; rencana PR 1a-2 T1, R1–R8, R25)."""
import json
import re
import sqlite3
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

import dbconn
import plugin_host
import plugin_loader
import plugin_records as pr
import plugin_states
import task_ext

FIXTURES = Path(__file__).resolve().parent / "fixtures"
VECTORS = json.loads((FIXTURES / "plugin_records_vectors.json").read_text(encoding="utf-8"))
NOW = datetime(2026, 11, 2, 3, 0, 0, tzinfo=timezone.utc)
NOTE = {"conflict": "lww", "maxBytes": 4096}


@pytest.fixture
def demo_index():
    plugin_loader.load_known(FIXTURES / "plugins" / "index.json")
    yield
    plugin_loader.load_known()


@pytest.fixture
def db(tmp_path):
    path = str(tmp_path / "r.db")
    c = dbconn.connect(path)
    c.execute("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)")
    c.execute("CREATE TABLE shared_lists (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, "
              "owner_id INTEGER NOT NULL, created_at TEXT NOT NULL, "
              "FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE)")
    c.execute("CREATE TABLE list_members (list_id INTEGER NOT NULL, user_id INTEGER NOT NULL, "
              "joined_at TEXT NOT NULL, PRIMARY KEY (list_id, user_id), "
              "FOREIGN KEY (list_id) REFERENCES shared_lists(id) ON DELETE CASCADE, "
              "FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE)")
    for uid in (1, 2, 3, 7):
        c.execute("INSERT INTO users (id, name) VALUES (?, ?)", (uid, f"u{uid}"))
    # list 12: pemilik 1, anggota 2. list 99: pemilik 3 (1 dan 2 bukan anggota).
    c.execute("INSERT INTO shared_lists (id, name, owner_id, created_at) VALUES (12, 'w', 1, 'x')")
    c.execute("INSERT INTO shared_lists (id, name, owner_id, created_at) VALUES (99, 'z', 3, 'x')")
    c.execute("INSERT INTO list_members (list_id, user_id, joined_at) VALUES (12, 2, 'x')")
    c.commit()
    with dbconn.write_tx(c):
        pr.ensure_schema(c)
    yield c, path
    c.close()


def item(**kw):
    base = {"entity": "note", "id": "n1", "scope": "user", "data": {"t": "a"}, "deleted": False,
            "updated_at": pr_iso(NOW), "base_version": 0}
    base.update(kw)
    return base


def pr_iso(dt):
    return plugin_states.iso(dt)


def apply(conn, uid, it, *, now=NOW, access=frozenset(), decl=NOTE, pid="demo-records"):
    with dbconn.write_tx(conn):
        return pr.apply_item(conn, uid, pid, it, decl, now, set(access))


def rows(conn):
    return [dict(r) for r in conn.execute("SELECT * FROM plugin_records ORDER BY seq")]


# ── Skema ────────────────────────────────────────────────────────────────────

def test_ensure_schema_idempotent(db):
    c, _ = db
    with dbconn.write_tx(c):
        pr.ensure_schema(c)
        pr.ensure_schema(c)
    cols = [(r["name"], r["type"], r["notnull"], r["dflt_value"], r["pk"])
            for r in c.execute("PRAGMA table_info(plugin_records)")]
    assert cols == [
        ("seq", "INTEGER", 1, None, 0),
        ("plugin_id", "TEXT", 1, None, 1),
        ("entity", "TEXT", 1, None, 2),
        ("id", "TEXT", 1, None, 4),
        ("owner_key", "TEXT", 1, None, 3),
        ("user_id", "INTEGER", 0, None, 0),
        ("list_id", "INTEGER", 0, None, 0),
        ("scope", "TEXT", 1, None, 0),
        ("data", "TEXT", 1, "'{}'", 0),
        ("updated_at", "TEXT", 1, None, 0),
        ("version", "INTEGER", 1, None, 0),
        ("deleted", "INTEGER", 1, "0", 0),
        ("updated_by", "INTEGER", 0, None, 0),
        ("server_at", "TEXT", 1, None, 0),
    ]
    idx = {r["name"]: r for r in c.execute("PRAGMA index_list(plugin_records)")}
    assert idx["ux_plugin_records_seq"]["unique"] == 1
    assert idx["ux_plugin_records_seq"]["partial"] == 0
    assert idx["ix_plugin_records_user"]["partial"] == 1
    assert idx["ix_plugin_records_list"]["partial"] == 1
    assert [r["name"] for r in c.execute("PRAGMA index_info(ix_plugin_records_user)")] == ["plugin_id", "user_id", "seq"]
    assert [r["name"] for r in c.execute("PRAGMA index_info(ix_plugin_records_list)")] == ["plugin_id", "list_id", "seq"]
    sql = {r["name"]: r["sql"] for r in c.execute("SELECT name, sql FROM sqlite_master")}
    assert "WHERE list_id IS NULL" in sql["ix_plugin_records_user"]
    assert "WHERE list_id IS NOT NULL" in sql["ix_plugin_records_list"]
    assert "CHECK ((user_id IS NULL) <> (list_id IS NULL))" in sql["plugin_records"]
    assert "ON DELETE CASCADE" in sql["plugin_records"]
    meta = [(r["name"], r["pk"]) for r in c.execute("PRAGMA table_info(plugin_records_meta)")]
    assert meta == [("key", 1), ("value", 0)]


def test_ensure_schema_does_not_commit(tmp_path):
    c = dbconn.connect(str(tmp_path / "x.db"))
    c.execute("CREATE TABLE users (id INTEGER PRIMARY KEY)")
    c.commit()
    c.execute("BEGIN IMMEDIATE")
    pr.ensure_schema(c)
    assert c.in_transaction
    c.rollback()
    assert not c.execute("SELECT name FROM sqlite_master WHERE name = 'plugin_records'").fetchall()
    c.close()


# ── Vektor bersama ───────────────────────────────────────────────────────────

def test_vectors():
    for v in VECTORS["ids"]["valid"]:
        assert pr.ID_RE.fullmatch(v), v
    for v in VECTORS["ids"]["invalid"]:
        assert not pr.ID_RE.fullmatch(v), repr(v)
    for v in VECTORS["entities"]["valid"]:
        assert pr.ENTITY_RE.fullmatch(v), v
    for v in VECTORS["entities"]["invalid"]:
        assert not pr.ENTITY_RE.fullmatch(v), repr(v)
    for v in VECTORS["scopes"]["valid"]:
        assert pr.SCOPE_RE.fullmatch(v), v
    for v in VECTORS["scopes"]["invalid"]:
        assert not pr.SCOPE_RE.fullmatch(v), repr(v)
    for case in VECTORS["refs"]:
        want = None if case["server"] == "ok" else case["server"]
        assert task_ext.check_value(case["value"]) == want, case
        det = {None: None, "EXT_TASK_REF": ("INVALID", "task_ref"), "EXT_INVALID": ("INVALID", "data")}[want]
        got = pr.validate_item(item(data={"r": case["value"]}), {"conflict": "lww", "maxBytes": 65536})
        assert got == det, case
    for case in VECTORS["sizes"]:
        decl = {"conflict": "lww", "maxBytes": case["maxBytes"]}
        want = None if case["error"] is None else ("INVALID", case["error"])
        assert pr.validate_item(item(data=case["data"]), decl) == want, case["name"]


def test_vectors_manifests_shape():
    assert VECTORS["manifests"]
    for m in VECTORS["manifests"]:
        assert set(m) == {"name", "records", "permissions", "error"}, m
        assert m["error"] is None or isinstance(m["error"], str)
    errors = {m["error"] for m in VECTORS["manifests"]}
    assert any(e and e.startswith("strategi konflik") for e in errors)
    assert None in errors


def test_constants():
    assert pr.MAX_DATA_BYTES == 65536
    assert pr.TOMBSTONE_DAYS == 30
    assert pr.PURGE_INTERVAL_S == 3600
    assert pr.ID_RE.pattern == r"^[A-Za-z0-9:@._-]{1,80}$"
    assert pr.SCOPE_RE.pattern == r"^(user|list:[1-9][0-9]{0,17})$"


def test_validate_item_details(demo_index):
    d = {"conflict": "lww", "maxBytes": 4096}
    assert pr.validate_item(item(), d) is None
    assert pr.validate_item(item(), None) == ("INVALID", "entity")
    assert pr.validate_item(item(entity="Bad"), d) == ("INVALID", "entity")
    assert pr.validate_item(item(id="a b"), d) == ("INVALID", "id")
    assert pr.validate_item(item(scope="project:3"), d) == ("INVALID", "scope")
    assert pr.validate_item(item(updated_at="kemarin"), d) == ("INVALID", "updated_at")
    assert pr.validate_item(item(updated_at=12), d) == ("INVALID", "updated_at")
    assert pr.validate_item(item(updated_at=None), d) is None
    assert pr.validate_item(item(base_version=-1), d) == ("INVALID", "base_version")
    assert pr.validate_item(item(base_version=True), d) == ("INVALID", "base_version")
    assert pr.validate_item(item(base_version=None), d) is None
    assert pr.validate_item(item(deleted="ya"), d) == ("INVALID", "deleted")
    assert pr.validate_item(item(data={"x": float("nan")}), d) == ("INVALID", "data")
    # tombstone tidak divalidasi isinya (batas ukuran bisa menyusut setelah record dibuat)
    assert pr.validate_item(item(deleted=True, data={"v": "x" * 5000}), d) is None


# ── Kunci pemilik + CHECK ────────────────────────────────────────────────────

def test_owner_key_and_check(db):
    c, _ = db
    assert pr.owner_key_for(7, "user") == ("u:7", 7, None)
    assert pr.owner_key_for(7, "list:12") == ("l:12", None, 12)
    with pytest.raises(ValueError):
        pr.owner_key_for(7, "project:3")
    with pytest.raises(sqlite3.IntegrityError):
        with dbconn.write_tx(c):
            c.execute(
                "INSERT INTO plugin_records (seq, plugin_id, entity, id, owner_key, user_id, list_id, scope, "
                "updated_at, version, server_at) VALUES (1, 'p', 'note', 'a', 'u:1', 1, 12, 'user', 'x', 1, 'x')")
    with pytest.raises(sqlite3.IntegrityError):  # keduanya NULL
        with dbconn.write_tx(c):
            c.execute(
                "INSERT INTO plugin_records (seq, plugin_id, entity, id, owner_key, scope, "
                "updated_at, version, server_at) VALUES (1, 'p', 'note', 'a', 'u:1', 'user', 'x', 1, 'x')")


# ── seq ──────────────────────────────────────────────────────────────────────

def test_seq_monotonic_two_threads(db, demo_index):
    _, path = db
    errors = []

    def worker(uid):
        conn = dbconn.connect(path)
        try:
            for i in range(50):
                with dbconn.write_tx(conn):
                    res = pr.apply_item(conn, uid, "demo-records", item(id=f"n{i}"), NOTE, NOW, set())
                assert res["applied"] is True, res
        except BaseException as e:  # noqa: BLE001
            errors.append(e)
        finally:
            conn.close()

    ts = [threading.Thread(target=worker, args=(u,)) for u in (1, 2)]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    assert not errors, errors
    c = dbconn.connect(path)
    try:
        seqs = [r[0] for r in c.execute("SELECT seq FROM plugin_records ORDER BY seq")]
    finally:
        c.close()
    assert seqs == list(range(1, 101))


def test_next_seq_never_reuses_purged_seq(db):
    c, _ = db
    assert pr.next_seq(c) == 1
    apply(c, 1, item(id="a"))
    apply(c, 1, item(id="a", deleted=True, base_version=1))
    assert pr.next_seq(c) == 3
    # tombstone seq tertinggi dipurge → seq berikutnya tidak boleh turun ke nilai yang sudah dilihat klien
    later = NOW + timedelta(days=40)
    assert pr.purge(c, later) == 1
    assert pr.next_seq(c) == 3
    res = apply(c, 1, item(id="b"), now=later)
    assert res["applied"] is True
    assert rows(c)[-1]["seq"] == 3


# ── LWW ──────────────────────────────────────────────────────────────────────

def test_lww_rules(db):
    c, _ = db
    r = apply(c, 1, item(data={"t": "v1"}))
    assert r["applied"] is True and r["record"]["version"] == 1
    assert r["record"] == {"entity": "note", "id": "n1", "scope": "user", "data": {"t": "v1"},
                           "updated_at": pr_iso(NOW), "version": 1, "deleted": False}
    t1 = NOW + timedelta(seconds=10)
    r = apply(c, 1, item(data={"t": "v2"}, base_version=1, updated_at=pr_iso(t1)), now=t1)
    assert r["applied"] is True and r["record"]["version"] == 2
    seq_before = rows(c)[0]["seq"]

    # base tertinggal + updated_at klien lebih lama → kalah, baris server dikembalikan, seq tetap
    r = apply(c, 1, item(data={"t": "lama"}, base_version=0, updated_at=pr_iso(NOW - timedelta(hours=1))), now=t1)
    assert r["applied"] is False
    assert r["record"]["data"] == {"t": "v2"} and r["record"]["version"] == 2
    assert rows(c)[0]["seq"] == seq_before

    # base tertinggal + lebih baru → diterapkan
    t2 = t1 + timedelta(seconds=5)
    r = apply(c, 1, item(data={"t": "baru"}, base_version=0, updated_at=pr_iso(t2)), now=t2)
    assert r["applied"] is True and r["record"]["version"] == 3
    assert r["record"]["data"] == {"t": "baru"}
    assert rows(c)[0]["seq"] > seq_before

    # updated_at klien di masa depan dipotong ke now
    t3 = t2 + timedelta(seconds=1)
    r = apply(c, 1, item(data={"t": "depan"}, base_version=3, updated_at=pr_iso(t3 + timedelta(days=365))), now=t3)
    assert r["applied"] is True
    assert r["record"]["updated_at"] == pr_iso(t3)
    assert rows(c)[0]["server_at"] == pr_iso(t3)
    assert rows(c)[0]["updated_by"] == 1

    # updated_at rusak di DB → kiriman menang
    c.execute("UPDATE plugin_records SET updated_at = 'rusak'")
    c.commit()
    t4 = t3 + timedelta(seconds=1)
    r = apply(c, 1, item(data={"t": "pulih"}, base_version=0, updated_at=pr_iso(t4)), now=t4)
    assert r["applied"] is True and r["record"]["data"] == {"t": "pulih"}


def test_lww_missing_updated_at_uses_now(db):
    c, _ = db
    r = apply(c, 1, item(updated_at=None))
    assert r["record"]["updated_at"] == pr_iso(NOW)


def test_idempotent_resend(db):
    c, _ = db
    a = item(data={"t": "a"})
    r1 = apply(c, 1, a)
    seq = rows(c)[0]["seq"]
    r2 = apply(c, 1, a)
    assert r2["applied"] is True and r2["record"] == r1["record"]
    assert r2["record"]["version"] == 1
    assert len(rows(c)) == 1 and rows(c)[0]["seq"] == seq
    # urutan kunci data berbeda tetap dianggap identik
    c.execute("UPDATE plugin_records SET data = ?", ('{"x":1,"y":2}',))
    c.commit()
    r3 = apply(c, 1, item(data={"y": 2, "x": 1}))
    assert r3["applied"] is True and r3["record"]["version"] == 1 and rows(c)[0]["seq"] == seq
    # isi beda → LWW biasa (waktu klien sama dengan server: base 0 ≠ version 1, tidak lebih lama → terapkan)
    r4 = apply(c, 1, item(data={"t": "b"}))
    assert r4["applied"] is True and r4["record"]["version"] == 2 and r4["record"]["data"] == {"t": "b"}
    assert rows(c)[0]["seq"] > seq
    # penulis lain dengan isi sama bukan kiriman ulang
    c.execute("UPDATE plugin_records SET updated_by = 2")
    c.commit()
    seq2 = rows(c)[0]["seq"]
    r5 = apply(c, 1, item(data={"t": "b"}, base_version=1))
    assert r5["applied"] is True and r5["record"]["version"] == 3
    assert rows(c)[0]["seq"] > seq2


def test_delete_semantics(db):
    c, _ = db
    apply(c, 1, item(data={"t": "a"}))
    t1 = NOW + timedelta(seconds=1)
    r = apply(c, 1, item(deleted=True, data={"t": "diabaikan"}, base_version=1, updated_at=pr_iso(t1)), now=t1)
    assert r["applied"] is True
    assert r["record"]["deleted"] is True and r["record"]["version"] == 2 and r["record"]["data"] == {}
    row = rows(c)[0]
    assert row["deleted"] == 1 and row["data"] == "{}" and row["version"] == 2
    # kirim ulang tombstone idempoten
    seq = row["seq"]
    r = apply(c, 1, item(deleted=True, base_version=1, updated_at=pr_iso(t1)), now=t1)
    assert r["applied"] is True and r["record"]["version"] == 2 and rows(c)[0]["seq"] == seq
    # delete untuk id yang tidak ada → applied True, record None, tanpa baris
    r = apply(c, 1, item(id="hantu", deleted=True))
    assert r == {"entity": "note", "id": "hantu", "applied": True, "record": None}
    assert len(rows(c)) == 1


def test_forbidden_and_immutable_scope(db):
    c, _ = db
    r = apply(c, 1, item(scope="list:99"), access={12})
    assert r == {"entity": "note", "id": "n1", "error": "FORBIDDEN_SCOPE"}
    assert rows(c) == []
    # akses ke list:12 → boleh
    r = apply(c, 2, item(id="w1", scope="list:12"), access={12})
    assert r["applied"] is True and r["record"]["scope"] == "list:12"
    row = rows(c)[0]
    assert (row["owner_key"], row["user_id"], row["list_id"]) == ("l:12", None, 12)
    # id sudah ada di u:1 lalu dikirim sebagai list:12 → SCOPE_IMMUTABLE
    apply(c, 1, item(id="same"))
    r = apply(c, 1, item(id="same", scope="list:12"), access={12})
    assert r == {"entity": "note", "id": "same", "error": "SCOPE_IMMUTABLE"}
    # kebalikannya: sudah ada di list:12 (bisa diakses), dikirim sebagai user
    r = apply(c, 1, item(id="w1", scope="user"), access={12})
    assert r["error"] == "SCOPE_IMMUTABLE"
    # id sama di u:<pengguna lain> bukan konflik
    r = apply(c, 7, item(id="same"))
    assert r["applied"] is True and r["record"]["version"] == 1
    # record list yang TIDAK bisa diakses pengguna tidak membuat konflik
    r = apply(c, 3, item(id="p99", scope="list:99"), access={99})
    assert r["applied"] is True
    r = apply(c, 1, item(id="p99"))
    assert r["applied"] is True
    assert {(x["owner_key"], x["id"]) for x in rows(c)} >= {("u:7", "same"), ("l:99", "p99"), ("u:1", "p99")}


def test_invalid_items_leave_no_trace(db):
    c, _ = db
    for bad in (item(entity="Bad"), item(id="a b"), item(scope="project:3"), item(data=[1]),
                item(updated_at="x"), item(data={"v": "x" * 5000})):
        r = apply(c, 1, bad)
        assert r["error"] == "INVALID" and r["detail"], r
    assert apply(c, 1, item(), decl=None)["detail"] == "entity"
    assert rows(c) == []


def test_apply_item_requires_transaction(db):
    c, _ = db
    with pytest.raises(RuntimeError):
        pr.apply_item(c, 1, "demo-records", item(), NOTE, NOW, set())


# ── Kursor ───────────────────────────────────────────────────────────────────

def test_cursor_fingerprint_reset():
    assert pr.parse_cursor("") == (0, None)
    assert pr.parse_cursor(None) == (0, None)
    assert pr.parse_cursor("rusak") is None
    assert pr.parse_cursor("2.1.abc") is None
    assert pr.parse_cursor("1.5.zzzzzzzz") is None
    assert pr.parse_cursor("1.-5.0123abcd") is None
    assert pr.parse_cursor("1.5.0123abcd") == (5, "0123abcd")
    assert pr.parse_cursor(pr.make_cursor(10422, "9f2c1a0b")) == (10422, "9f2c1a0b")
    assert pr.make_cursor(7, "abcd1234") == "1.7.abcd1234"
    assert pr.fingerprint([3, 1]) == pr.fingerprint([1, 3])
    assert pr.fingerprint([3, 1]) != pr.fingerprint([1])
    assert re.fullmatch(r"[0-9a-f]{8}", pr.fingerprint([3, 1]))
    assert re.fullmatch(r"[0-9a-f]{8}", pr.fingerprint([]))


def test_fetch_page_visibility_and_more(db):
    c, _ = db
    apply(c, 1, item(id="a1"))
    apply(c, 2, item(id="b1"))
    apply(c, 2, item(id="l1", scope="list:12"), access={12})
    apply(c, 1, item(id="a2", entity="note"))
    apply(c, 1, item(id="a3"), pid="lain-plugin")
    apply(c, 3, item(id="p99", scope="list:99"), access={99})
    with dbconn.write_tx(c):  # entitas lain: sisipkan langsung
        c.execute("INSERT INTO plugin_records (seq, plugin_id, entity, id, owner_key, user_id, scope, data, "
                  "updated_at, version, deleted, updated_by, server_at) VALUES "
                  "(?, 'demo-records', 'other', 'o1', 'u:1', 1, 'user', '{}', 'x', 1, 0, 1, 'x')",
                  (pr.next_seq(c),))
    ids = lambda rs: [r["id"] for r in rs]  # noqa: E731
    got, more = pr.fetch_page(c, 1, "demo-records", 0, 100, {12})
    assert ids(got) == ["a1", "l1", "a2", "o1"] and more is False
    assert [r["seq"] for r in got] == sorted(r["seq"] for r in got)
    got, more = pr.fetch_page(c, 2, "demo-records", 0, 100, {12})
    assert ids(got) == ["b1", "l1"] and more is False
    got, more = pr.fetch_page(c, 7, "demo-records", 0, 100, set())
    assert got == [] and more is False
    # tanpa akses list → baris l: tidak terlihat walau anggota di DB (akses ditentukan pemanggil)
    got, _ = pr.fetch_page(c, 1, "demo-records", 0, 100, set())
    assert ids(got) == ["a1", "a2", "o1"]
    # limit + more
    got, more = pr.fetch_page(c, 1, "demo-records", 0, 2, {12})
    assert ids(got) == ["a1", "l1"] and more is True
    got, more = pr.fetch_page(c, 1, "demo-records", got[-1]["seq"], 2, {12})
    assert ids(got) == ["a2", "o1"] and more is False
    got, more = pr.fetch_page(c, 1, "demo-records", 0, 4, {12})
    assert len(got) == 4 and more is False
    # filter entity
    got, _ = pr.fetch_page(c, 1, "demo-records", 0, 100, {12}, entity="other")
    assert ids(got) == ["o1"]
    # plugin lain
    got, _ = pr.fetch_page(c, 1, "lain-plugin", 0, 100, {12})
    assert ids(got) == ["a3"]


def test_row_to_record_corrupt_data(db):
    c, _ = db
    apply(c, 1, item())
    c.execute("UPDATE plugin_records SET data = '[1,2'")
    c.commit()
    rec = pr.row_to_record(c.execute("SELECT * FROM plugin_records").fetchone())
    assert rec["data"] == {} and rec["deleted"] is False
    c.execute("UPDATE plugin_records SET data = '[1]'")
    c.commit()
    assert pr.row_to_record(c.execute("SELECT * FROM plugin_records").fetchone())["data"] == {}


# ── Purge ────────────────────────────────────────────────────────────────────

def _put_row(c, seq, rid, *, deleted, server_at):
    c.execute("INSERT INTO plugin_records (seq, plugin_id, entity, id, owner_key, user_id, scope, data, "
              "updated_at, version, deleted, updated_by, server_at) VALUES "
              "(?, 'demo-records', 'note', ?, 'u:1', 1, 'user', '{}', 'x', 1, ?, 1, ?)",
              (seq, rid, 1 if deleted else 0, server_at))


def test_purge(db):
    c, _ = db
    old = pr_iso(NOW - timedelta(days=31))
    mid = pr_iso(NOW - timedelta(days=29))
    with dbconn.write_tx(c):
        _put_row(c, 1, "old1", deleted=True, server_at=old)
        _put_row(c, 2, "live-old", deleted=False, server_at=old)
        _put_row(c, 3, "old2", deleted=True, server_at=old)
        _put_row(c, 4, "mid", deleted=True, server_at=mid)
        _put_row(c, 5, "live", deleted=False, server_at=pr_iso(NOW))
    assert pr.purge(c, NOW) == 2
    assert [r["id"] for r in rows(c)] == ["live-old", "mid", "live"]
    meta = dict(c.execute("SELECT key, value FROM plugin_records_meta").fetchall())
    assert meta == {"purged_seq": "3"}
    assert pr.purge(c, NOW) == 0
    assert dict(c.execute("SELECT key, value FROM plugin_records_meta").fetchall()) == {"purged_seq": "3"}
    # purged_seq tidak pernah turun
    with dbconn.write_tx(c):
        _put_row(c, 6, "older", deleted=True, server_at=old)
    c.execute("UPDATE plugin_records_meta SET value = '50'")
    c.commit()
    assert pr.purge(c, NOW) == 1
    assert dict(c.execute("SELECT key, value FROM plugin_records_meta").fetchall()) == {"purged_seq": "50"}
    assert pr.purged_seq(c) == 50
    # di dalam transaksi pemanggil: ikut transaksi itu
    with dbconn.write_tx(c):
        _put_row(c, 51, "older2", deleted=True, server_at=old)
        assert pr.purge(c, NOW) == 1
        assert c.in_transaction


def test_maybe_purge_throttled(db):
    c, _ = db
    pr._reset_for_tests()
    old = pr_iso(NOW - timedelta(days=31))
    with dbconn.write_tx(c):
        _put_row(c, 1, "t1", deleted=True, server_at=old)
    assert pr.maybe_purge(c, NOW, clock=lambda: 1000.0) == 1
    with dbconn.write_tx(c):
        _put_row(c, 2, "t2", deleted=True, server_at=old)
    assert pr.maybe_purge(c, NOW, clock=lambda: 1000.0 + pr.PURGE_INTERVAL_S - 1) is None
    assert pr.maybe_purge(c, NOW, clock=lambda: 1000.0 + pr.PURGE_INTERVAL_S) == 1
    pr._reset_for_tests()


# ── CASCADE ──────────────────────────────────────────────────────────────────

def test_cascade(db):
    c, _ = db
    apply(c, 1, item(id="u1"))
    apply(c, 7, item(id="u7"))
    apply(c, 1, item(id="l12", scope="list:12"), access={12})
    apply(c, 3, item(id="l99", scope="list:99"), access={99})
    assert c.execute("PRAGMA foreign_keys").fetchone()[0] == 1
    with dbconn.write_tx(c):
        c.execute("DELETE FROM shared_lists WHERE id = 12")
    assert sorted(r["id"] for r in rows(c)) == ["l99", "u1", "u7"]
    with dbconn.write_tx(c):
        c.execute("DELETE FROM users WHERE id = 7")
    assert sorted(r["id"] for r in rows(c)) == ["l99", "u1"]


# ── plugin_host.list_access ──────────────────────────────────────────────────

def test_list_access(db):
    c, _ = db
    assert plugin_host.list_access(c, 1, 12) is True    # pemilik
    assert plugin_host.list_access(c, 2, 12) is True    # anggota
    assert plugin_host.list_access(c, 3, 12) is False
    assert plugin_host.list_access(c, 7, 12) is False
    assert plugin_host.list_access(c, 1, 99) is False
    assert plugin_host.list_access(c, 3, 99) is True
    assert plugin_host.list_access(c, 1, 12345) is False
    # pemilik yang juga tercatat anggota → tetap satu entri
    c.execute("INSERT INTO list_members (list_id, user_id, joined_at) VALUES (12, 1, 'x')")
    c.execute("INSERT INTO shared_lists (id, name, owner_id, created_at) VALUES (5, 'a', 1, 'x')")
    c.execute("INSERT INTO list_members (list_id, user_id, joined_at) VALUES (99, 1, 'x')")
    c.commit()
    assert plugin_host.accessible_list_ids(c, 1) == [5, 12, 99]
    assert plugin_host.accessible_list_ids(c, 2) == [12]
    assert plugin_host.accessible_list_ids(c, 7) == []


# ── HTTP (PR 1a-2 Task 2): GET/POST /api/plugins/{id}/records + ekspor ───────

import io  # noqa: E402
import uuid  # noqa: E402
import zipfile  # noqa: E402

import webapp  # noqa: E402
from conftest import db as _rawdb, register_user  # noqa: E402

PID = "demo-records"
URL = f"/api/plugins/{PID}/records"


class User:
    """Pengguna tes lewat Bearer; cookie dibersihkan agar header yang dipakai."""

    def __init__(self, client, prefix="rec"):
        name = f"{prefix}{uuid.uuid4().hex[:8]}"
        info = register_user(client, name, f"{name}@test.id")
        self.client, self.id, self.name = client, info["user_id"], name
        self.h = {"Authorization": f"Bearer {info['token']}"}

    def call(self, method, url, **kw):
        self.client.cookies.clear()
        headers = {**self.h, **kw.pop("headers", {})}
        return getattr(self.client, method)(url, headers=headers, **kw)

    def get(self, url, **kw):
        return self.call("get", url, **kw)

    def post(self, url, **kw):
        return self.call("post", url, **kw)

    def put(self, url, **kw):
        return self.call("put", url, **kw)

    def records(self, cursor="", **params):
        r = self.get(URL, params={"cursor": cursor, **params})
        assert r.status_code == 200, r.text
        return r.json()

    def send(self, *items, pid=PID):
        r = self.post(f"/api/plugins/{pid}/records", json={"items": list(items)})
        assert r.status_code == 200, r.text
        return r.json()["results"]

    def send1(self, **kw):
        return self.send(it_http(**kw))[0]


def it_http(**kw):
    base = {"entity": "note", "id": "n1", "scope": "user", "data": {"t": "a"}, "deleted": False,
            "updated_at": pr_iso(datetime.now(timezone.utc)), "base_version": None}
    base.update(kw)
    return base


def _sql(sql, *params):
    c = _rawdb()
    try:
        c.execute(sql, params)
        c.commit()
    finally:
        c.close()


def _mk_workspace(owner, *members):
    r = owner.post("/api/lists", json={"name": "ws"})
    assert r.status_code == 200, r.text
    lid = r.json()["id"]
    for m in members:
        _sql("INSERT INTO list_members (list_id, user_id, joined_at) VALUES (?, ?, datetime('now'))", lid, m.id)
    return lid


def _ids(page):
    return sorted(i["id"] for i in page["items"])


@pytest.fixture
def http(client, demo_index):
    pr._reset_for_tests()
    yield client
    pr._reset_for_tests()


@pytest.fixture
def table_guard():
    """Setelah tes yang menjatuhkan tabel: bangun ulang skema (DB tes dipakai bersama)."""
    yield
    c = dbconn.connect(webapp.DB_PATH)
    try:
        with dbconn.write_tx(c):
            pr.ensure_schema(c)
    finally:
        c.close()


def test_auth_and_errors(http, monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    a = User(http)
    anon = TestClient(webapp.app)
    assert anon.get(URL).status_code == 401
    assert anon.post(URL, json={"items": [it_http()]}).status_code == 401

    ext = webapp.create_ext_token(a.id, a.name)
    now_t = datetime.now(timezone.utc)
    _sql("INSERT INTO ext_tokens (user_id, token, state, created_at, expires_at) VALUES (?,?,?,?,?)",
         a.id, ext, None, now_t.isoformat(), (now_t + timedelta(days=30)).isoformat())
    for r in (anon.get(URL, headers={"Authorization": f"Bearer {ext}"}),
              anon.post(URL, json={"items": [it_http()]}, headers={"Authorization": f"Bearer {ext}"})):
        assert r.status_code == 403 and r.json()["detail"]["code"] == "PLUGIN_FORBIDDEN_TOKEN"

    for pid in ("Bad", "state", "demo-ext", "tidak-ada"):
        for r in (a.get(f"/api/plugins/{pid}/records"),
                  a.post(f"/api/plugins/{pid}/records", json={"items": [it_http()]})):
            assert r.status_code == 404 and r.json()["detail"]["code"] == "PLUGIN_UNKNOWN", (pid, r.text)

    r = a.get(URL, params={"entity": "lain"})
    assert r.status_code == 422 and r.json()["detail"] == {"code": "INVALID", "detail": "entity"}
    for lim in (0, 1001):
        assert a.get(URL, params={"limit": lim}).status_code == 422
    assert a.get(URL, params={"limit": 1000}).status_code == 200

    items = [it_http(id=f"n{i}") for i in range(51)]
    assert a.post(URL, json={"items": items}).status_code == 422
    assert a.post(URL, json={"items": []}).status_code == 422
    assert len(a.send(*items[:50])) == 50

    big = json.dumps({"items": [it_http(id="big", data={"pad": "x" * (300 * 1024)})]})
    r = a.post(URL, content=big, headers={"Content-Type": "application/json"})
    assert r.status_code == 413 and r.json()["detail"]["code"] == "TOO_LARGE"
    # Content-Length yang dinyatakan > 256 KB ditolak walau isi kecil (pemeriksaan sebelum validasi badan)
    r = a.post(URL, content=json.dumps({"items": [it_http(id="x")]}),
               headers={"Content-Type": "application/json", "Content-Length": str(300 * 1024)})
    assert r.status_code == 413 and r.json()["detail"]["code"] == "TOO_LARGE"

    # 503 saat indeks tidak sehat — sebelum keanggotaan indeks
    monkeypatch.setattr(plugin_loader, "_index_ok", False)
    for r in (a.get(URL), a.post(URL, json={"items": [it_http()]})):
        assert r.status_code == 503 and r.json()["detail"]["code"] == "PLUGIN_UNAVAILABLE"


def test_refresh_known_once_before_404(http, monkeypatch, tmp_path):
    for name in ("_known", "_index_ok", "_index_path", "_permissions", "_records"):
        monkeypatch.setattr(plugin_loader, name, getattr(plugin_loader, name))
    idx = tmp_path / "index.json"
    entries = [{"id": "demo-server", "defaultEnabled": False}]
    idx.write_text(json.dumps({"v": 1, "plugins": entries}), encoding="utf-8")
    plugin_loader.load_known(idx)
    a = User(http)
    calls = []
    real = plugin_loader.refresh_known
    monkeypatch.setattr(plugin_loader, "refresh_known", lambda: (calls.append(1), real())[1])
    assert a.get(URL).status_code == 404
    assert len(calls) == 1
    entries.append({"id": PID, "defaultEnabled": False, "permissions": ["records"],
                    "records": {"note": {"conflict": "lww", "maxBytes": 4096}}})
    idx.write_text(json.dumps({"v": 1, "plugins": entries}), encoding="utf-8")
    calls.clear()
    r = a.get(URL)
    assert r.status_code == 200, r.text
    assert len(calls) == 1
    assert a.send1()["applied"] is True
    assert len(calls) == 1  # id kini dikenal + berizin → tanpa baca ulang


def test_plugin_off_still_accepts(http):
    a = User(http)
    r = a.put(f"/api/plugins/state/{PID}", json={"enabled": False})
    assert r.status_code == 200 and r.json()["state"]["enabled"] is False
    assert a.send1()["applied"] is True
    assert _ids(a.records()) == ["n1"]


def test_post_get_roundtrip_and_cursor(http):
    a = User(http)
    page = a.records()
    assert page["items"] == [] and page["more"] is False and re.fullmatch(r"1\.\d+\.[0-9a-f]{8}", page["cursor"])
    res = a.send1()
    assert res["applied"] is True and res["record"]["version"] == 1 and res["record"]["deleted"] is False
    assert set(res["record"]) == {"entity", "id", "scope", "data", "updated_at", "version", "deleted"}
    page = a.records()
    assert _ids(page) == ["n1"] and page["more"] is False
    m = re.fullmatch(r"1\.(\d+)\.([0-9a-f]{8})", page["cursor"])
    assert m
    again = a.records(page["cursor"])
    assert again["items"] == [] and again["cursor"] == page["cursor"] and again["more"] is False
    res = a.send1(id="n2")
    assert res["applied"] is True
    res = a.send1(data={"t": "b"}, base_version=1)
    assert res["applied"] is True and res["record"]["version"] == 2
    news = a.records(page["cursor"])
    assert _ids(news) == ["n1", "n2"]
    assert [i["data"] for i in news["items"] if i["id"] == "n1"] == [{"t": "b"}]
    # entity filter + limit/more
    assert a.records(entity="note")["items"]
    two = a.records(limit=1)
    assert len(two["items"]) == 1 and two["more"] is True
    rest = a.records(two["cursor"], limit=1)
    assert len(rest["items"]) == 1 and rest["more"] is False
    assert two["items"][0]["id"] != rest["items"][0]["id"]


def test_offline_edit_arrives_late_still_pulled(http):
    a, b = User(http), User(http)
    ws = _mk_workspace(a, b)
    scope = f"list:{ws}"
    a.send1(id="early", scope=scope)
    k = b.records()["cursor"]
    late = pr_iso(datetime.now(timezone.utc) - timedelta(days=1))
    res = a.send1(id="offline", scope=scope, updated_at=late)
    assert res["applied"] is True and res["record"]["updated_at"] == late
    got = b.records(k)
    assert _ids(got) == ["offline"]


def test_workspace_sharing(http):
    a, b, c = User(http), User(http), User(http)
    ws = _mk_workspace(a, b)
    scope = f"list:{ws}"
    k0 = a.records()["cursor"]
    assert a.send1(id="w1", scope=scope)["record"]["version"] == 1
    assert _ids(b.records()) == ["w1"]
    res = b.send1(id="w1", scope=scope, data={"t": "dari-b"}, base_version=1)
    assert res["applied"] is True and res["record"]["version"] == 2
    row = _rawdb().execute("SELECT updated_by FROM plugin_records WHERE id = 'w1' AND owner_key = ?",
                           (f"l:{ws}",)).fetchone()
    assert row["updated_by"] == b.id
    seen = a.records(k0)
    assert _ids(seen) == ["w1"] and seen["items"][0]["data"] == {"t": "dari-b"}
    assert _ids(c.records()) == []
    assert c.send1(id="w2", scope=scope) == {"entity": "note", "id": "w2", "error": "FORBIDDEN_SCOPE"}


def test_membership_change_resets_cursor(http):
    a, b, c = User(http), User(http), User(http)
    ws = _mk_workspace(a, b)
    scope = f"list:{ws}"
    a.send1(id="w1", scope=scope)
    a.send1(id="w2", scope=scope)
    b.send1(id="own")
    kb = b.records()["cursor"]
    kc = c.records()["cursor"]
    _sql("DELETE FROM list_members WHERE list_id = ? AND user_id = ?", ws, b.id)
    assert b.records(kb) == {"reset": True}
    assert _ids(b.records()) == ["own"]
    assert b.send1(id="w3", scope=scope) == {"entity": "note", "id": "w3", "error": "FORBIDDEN_SCOPE"}
    _sql("INSERT INTO list_members (list_id, user_id, joined_at) VALUES (?, ?, datetime('now'))", ws, c.id)
    assert c.records(kc) == {"reset": True}
    assert _ids(c.records()) == ["w1", "w2"]
    # format tak terbaca → reset; kursor kosong bukan reset
    assert c.records("sampah") == {"reset": True}
    assert "reset" not in c.records("")


def test_purge_resets_old_cursor(http, monkeypatch):
    a = User(http)
    a.send1(id="t1")
    k_before = a.records()["cursor"]
    a.send1(id="t1", deleted=True, base_version=1)
    old = pr_iso(datetime.now(timezone.utc) - timedelta(days=40))
    _sql("UPDATE plugin_records SET server_at = ? WHERE id = 't1' AND owner_key = ?", old, f"u:{a.id}")
    now_t = [1000.0]
    real = pr.maybe_purge
    monkeypatch.setattr(pr, "maybe_purge", lambda conn, now: real(conn, now, clock=lambda: now_t[0]))
    pr._reset_for_tests()
    page = a.records(k_before)  # halaman dihitung dulu, purge sesudahnya
    assert _ids(page) == ["t1"] and page["items"][0]["deleted"] is True
    assert a.records(k_before) == {"reset": True}
    # purge paling sering sekali per jam
    a.send1(id="t2")
    a.send1(id="t2", deleted=True, base_version=1)
    _sql("UPDATE plugin_records SET server_at = ? WHERE id = 't2' AND owner_key = ?", old, f"u:{a.id}")
    now_t[0] += pr.PURGE_INTERVAL_S - 1
    a.records()
    c = _rawdb()
    assert c.execute("SELECT COUNT(*) FROM plugin_records WHERE id = 't2'").fetchone()[0] == 1
    now_t[0] += 1
    a.records()
    assert c.execute("SELECT COUNT(*) FROM plugin_records WHERE id = 't2'").fetchone()[0] == 0
    c.close()


def test_purge_between_page_and_cursor_check_resets(http, monkeypatch):
    """Purge yang mendarat setelah pemeriksaan awal tetapi sebelum halaman selesai dibaca → reset, bukan halaman
    yang bisa melewatkan tombstone yang sudah dipurge."""
    a = User(http)
    a.send1(id="t1")
    k_before = a.records()["cursor"]
    a.send1(id="t1", deleted=True, base_version=1)
    old = pr_iso(datetime.now(timezone.utc) - timedelta(days=40))
    _sql("UPDATE plugin_records SET server_at = ? WHERE id = 't1' AND owner_key = ?", old, f"u:{a.id}")
    real_fetch = pr.fetch_page

    def fetch_then_purge(conn, *args, **kw):
        out = real_fetch(conn, *args, **kw)
        other = _rawdb()  # koneksi lain: purge berjalan di antara dua pembacaan
        try:
            with dbconn.write_tx(other):
                assert pr.purge(other, datetime.now(timezone.utc)) == 1
        finally:
            other.close()
        return out

    monkeypatch.setattr(pr, "fetch_page", fetch_then_purge)
    assert a.records(k_before) == {"reset": True}
    monkeypatch.setattr(pr, "fetch_page", real_fetch)
    assert "reset" not in a.records("")  # tarik penuh tidak terpengaruh


def test_maybe_purge_failure_does_not_suppress_next(db, monkeypatch):
    c, _ = db
    pr._reset_for_tests()
    real = pr.purge
    boom = {"on": True}

    def flaky(conn, now):
        if boom["on"]:
            raise sqlite3.OperationalError("database is locked")
        return real(conn, now)

    monkeypatch.setattr(pr, "purge", flaky)
    with pytest.raises(sqlite3.OperationalError):
        pr.maybe_purge(c, NOW, clock=lambda: 5000.0)
    boom["on"] = False
    assert pr.maybe_purge(c, NOW, clock=lambda: 5001.0) == 0  # tidak dilewati: kegagalan tidak mencatat waktu
    assert pr.maybe_purge(c, NOW, clock=lambda: 5002.0) is None  # sukses → throttle aktif
    pr._reset_for_tests()


def test_purge_failure_does_not_break_get(http, monkeypatch):
    a = User(http)
    a.send1()
    monkeypatch.setattr(pr, "maybe_purge", lambda conn, now: (_ for _ in ()).throw(
        sqlite3.OperationalError("database is locked")))
    assert _ids(a.records()) == ["n1"]


def test_isolation_between_users(http):
    a, b = User(http), User(http)
    a.send1(id="cal@user", data={"who": "a"})
    assert _ids(b.records()) == []
    assert b.send1(id="cal@user", data={"who": "b"})["record"]["version"] == 1
    pa, pb = a.records(), b.records()
    assert [i["data"] for i in pa["items"]] == [{"who": "a"}]
    assert [i["data"] for i in pb["items"]] == [{"who": "b"}]


def test_batch_one_tx_mixed_results(http):
    a = User(http)
    c = _rawdb()
    before = c.execute("SELECT COALESCE(MAX(seq), 0) FROM plugin_records").fetchone()[0]
    res = a.send(it_http(id="ok"),
                 it_http(id="huge", data={"x": "y" * 5000}),
                 it_http(id="forb", scope="list:999999"))
    assert [r["id"] for r in res] == ["ok", "huge", "forb"]
    assert res[0]["applied"] is True
    assert res[1] == {"entity": "note", "id": "huge", "error": "INVALID", "detail": "size"}
    assert res[2] == {"entity": "note", "id": "forb", "error": "FORBIDDEN_SCOPE"}
    after = c.execute("SELECT COALESCE(MAX(seq), 0) FROM plugin_records").fetchone()[0]
    assert after == before + 1
    assert _ids(a.records()) == ["ok"]
    c.close()


def test_table_missing_returns_503(http, table_guard):
    a = User(http)
    _sql("DROP TABLE plugin_records")
    for r in (a.get(URL), a.post(URL, json={"items": [it_http()]})):
        assert r.status_code == 503 and r.json()["detail"]["code"] == "PLUGIN_UNAVAILABLE", r.text


def _zip_json(resp, name):
    assert resp.status_code == 200, resp.text
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        return json.loads(zf.read(name).decode("utf-8"))


def test_export_contains_plugin_files(http, table_guard):
    a, b = User(http), User(http)
    ws = _mk_workspace(a, b)
    assert a.put(f"/api/plugins/state/{PID}", json={"enabled": True}).status_code == 200
    a.send1(id="u1", data={"t": "pribadi"})
    a.send1(id="u2")
    a.send1(id="u2", deleted=True, base_version=1)
    a.send1(id="w1", scope=f"list:{ws}")
    b.send1(id="ub")
    r = a.get("/api/export/download")
    states = _zip_json(r, "plugin_states.json")
    assert states[PID]["enabled"] is True
    recs = _zip_json(r, "plugin_records.json")
    assert [x["id"] for x in recs] == ["u1"]
    assert set(recs[0]) == {"plugin_id", "entity", "id", "scope", "data", "updated_at", "version"}
    assert recs[0]["plugin_id"] == PID and recs[0]["data"] == {"t": "pribadi"} and recs[0]["version"] == 1
    # tanpa tabel → berkas kosong, ekspor tidak gagal
    _sql("DROP TABLE plugin_records")
    r = a.get("/api/export/download")
    assert _zip_json(r, "plugin_records.json") == []
    assert _zip_json(r, "plugin_states.json")[PID]["enabled"] is True


def test_route_order():
    paths = [getattr(r, "path", None) for r in webapp.app.routes]
    assert "/api/plugins/{plugin_id}/records" in paths
    host = paths.index("/api/plugins/{plugin_id}/records")
    for i, r in enumerate(webapp.app.routes):
        ep = getattr(r, "endpoint", None)
        if ep is not None and getattr(ep, "__module__", "").startswith(plugin_loader.MODULE_PREFIX + "."):
            assert host < i, r.path
    src = (Path(__file__).resolve().parent.parent / "webapp.py").read_text(encoding="utf-8")
    assert src.index("app.include_router(plugin_records.router)") < src.index("plugin_loader.init_web(app)")
    assert src.index("app.include_router(plugin_states.router)") < src.index("app.include_router(plugin_records.router)")
