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
