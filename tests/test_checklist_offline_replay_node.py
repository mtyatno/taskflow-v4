"""Uji putar ulang antrean checklist offline (spec checklist offline Fase 2 §4.3–§4.4; perbaikan review W1 PR B2).

Aksi dijalankan lewat rute lokal aplikasi (node: taskroutes + checklistroutes + checklistrepo di fake-indexeddb,
penggerak tests/offline/checklist_replay_driver.js). Antrean `subtasks` yang dihasilkan lalu diputar ulang ke
TaskRepository server (SQLite sementara) seperti handler push §4.4: create → POST (client_id = cid, induk lewat id
server), rename/set_done → PATCH, move → POST …/move, delete → DELETE (404 = sukses). Ketat: entri yang induknya /
butirnya tidak pernah ada di server (yatim) atau ditolak server (422/404) = gagal.

Sesudah putar ulang, isi server SELALU sama dengan lokal (butir, induk, centang, teks — tanpa kehilangan data), dan
pohon pre-order lengkap (urutan + depth) harus sama kecuali rev tersimpan dikosongkan (None): entri yang dibuang
(create yang dibatalkan sebelum terkirim) bisa menggeser `index` entri sesudahnya, dan perangkat akan mengambil ulang
checklist itu sesudah antrean kosong. `sort_order` tidak dibandingkan — create yang dibatalkan tidak pernah menomori
ulang saudaranya di server, jadi angkanya bisa berbeda walau urutannya sama. Skenario acak memakai seed tetap.
"""
import json
import os
import random
import shutil
import sqlite3
import subprocess

import pytest

from repository import ChecklistError, TaskRepository

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DRIVER = os.path.join(ROOT, "tests", "offline", "checklist_replay_driver.js")
TASK = 7
SEEDS = range(1, 201)

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node tidak ada di PATH")


class Driver:
    def __init__(self):
        self.p = subprocess.Popen(["node", DRIVER], cwd=ROOT, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  text=True, bufsize=1)

    def __call__(self, **cmd):
        self.p.stdin.write(json.dumps(cmd) + "\n")
        self.p.stdin.flush()
        line = self.p.stdout.readline()
        assert line, "penggerak node berhenti"
        out = json.loads(line)
        assert "crash" not in out, out.get("crash")
        return out

    def close(self):
        try:
            self.p.stdin.close()
            self.p.wait(timeout=10)
        except Exception:
            self.p.kill()


@pytest.fixture(scope="module")
def node():
    d = Driver()
    yield d
    d.close()


def _repo(path, rows):
    """TaskRepository di SQLite baru berisi task TASK dan butir `rows` (id eksplisit = id server)."""
    repo = TaskRepository(str(path))
    conn = sqlite3.connect(str(path))
    now = "2020-01-01T00:00:00"
    conn.execute("INSERT INTO tasks (id, title, created_at, updated_at) VALUES (?,?,?,?)", (TASK, "T", now, now))
    for r in rows:
        conn.execute("INSERT INTO subtasks (id, task_id, title, is_done, sort_order, created_at, parent_id) VALUES (?,?,?,?,?,?,?)",
                     (r["id"], TASK, r["title"], 1 if r["is_done"] else 0, r["sort_order"], now, r["parent_id"]))
    conn.commit()
    conn.close()
    return repo


def _init(node, rows, rev=1):
    recs = [{"cid": "k%d" % r["id"], "server_id": r["id"], "task_cid": "t1",
             "parent_cid": None if r["parent_id"] is None else "k%d" % r["parent_id"],
             "title": r["title"], "is_done": r["is_done"], "sort_order": r["sort_order"], "created_at": None} for r in rows]
    node(cmd="init", tasks=[{"cid": "t1", "server_id": TASK, "title": "T", "progress": 0, "checklist_total": 0,
                             "dirty": 0, "deleted": False}],
         records=recs, idmap=[[r["id"], "k%d" % r["id"]] for r in rows], revs=[["t1", rev]])


def _replay(repo, rows, queue):
    """Putar ulang antrean ke server (§4.4). → (sid_of {cid: id server}, masalah [(jenis, entri)])."""
    sid_of = {"k%d" % r["id"]: r["id"] for r in rows}
    problems = []
    for o in sorted(queue, key=lambda o: o["qid"]):
        cid, op, pl = o["cid"], o["op"], o.get("payload") or {}
        try:
            if op == "create":
                pc = pl.get("parent_cid")
                if pc is not None and pc not in sid_of:
                    problems.append(("induk yatim", o))
                    continue
                r = repo.add_subtask(TASK, pl["title"], client_id=cid, parent_id=sid_of.get(pc), index=pl.get("index"))
                sid_of[cid] = r["id"]
                continue
            if cid not in sid_of:
                problems.append(("butir yatim", o))
                continue
            sid = sid_of[cid]
            if op == "rename":
                r = repo.update_subtask(sid, title=pl["title"])
            elif op == "set_done":
                r = repo.update_subtask(sid, is_done=pl["is_done"])
            elif op == "move":
                pc = pl.get("parent_cid")
                if pc is not None and pc not in sid_of:
                    problems.append(("induk yatim", o))
                    continue
                r = repo.move_subtask(sid, sid_of.get(pc), pl.get("index"))
            elif op == "delete":
                r = repo.delete_subtask(sid) or True  # 404 = sukses
            else:
                problems.append(("op tidak dikenal", o))
                continue
            if r is None:
                problems.append(("404", o))
        except ChecklistError as e:
            problems.append(("ditolak " + e.code, o))
    return sid_of, problems


def _trees(node, repo, sid_of):
    def m(x):
        return sid_of.get(x, x) if isinstance(x, str) else x
    local = [[m(i["id"]), m(i["parent_id"]), i["depth"], bool(i["is_done"]), i["title"]] for i in node(cmd="items")["items"]]
    server = [[i["id"], i["parent_id"], i["depth"], bool(i["is_done"]), i["title"]] for i in repo.get_subtasks(TASK)]
    return local, server


def _route(node, method, path, body=None):
    r = node(cmd="route", method=method, path=path, body=body)
    assert r["local"], (method, path)
    return r


# ── skenario review W1 (deterministik) ─────────────────────────────────────────

def _ok(node, method, path, body=None):
    r = _route(node, method, path, body)
    assert r["ok"], r
    return r["res"]


def _s1(node):
    u = _ok(node, "POST", "/api/tasks/7/subtasks", {"title": "U"})["id"]
    c = _ok(node, "POST", "/api/tasks/7/subtasks", {"title": "C", "parent_id": u})["id"]
    _ok(node, "POST", "/api/subtasks/%s/move" % c, {"parent_id": None, "index": 1})
    _ok(node, "DELETE", "/api/subtasks/%s" % u)


def _s2(node):
    u = _ok(node, "POST", "/api/tasks/7/subtasks", {"title": "U"})["id"]
    _ok(node, "POST", "/api/subtasks/1/move", {"parent_id": u, "index": None})
    _ok(node, "POST", "/api/subtasks/1/move", {"parent_id": None, "index": 0})
    _ok(node, "DELETE", "/api/subtasks/%s" % u)


def _kaskade(node):
    u = _ok(node, "POST", "/api/tasks/7/subtasks", {"title": "U"})["id"]
    c = _ok(node, "POST", "/api/tasks/7/subtasks", {"title": "C", "parent_id": u})["id"]
    z = _ok(node, "POST", "/api/tasks/7/subtasks", {"title": "Z", "parent_id": c})["id"]
    _ok(node, "POST", "/api/subtasks/1/move", {"parent_id": u, "index": 0})
    _ok(node, "POST", "/api/subtasks/%s/toggle" % u)
    _ok(node, "PATCH", "/api/subtasks/%s" % z, {"is_done": False})
    _ok(node, "POST", "/api/subtasks/%s/move" % c, {"parent_id": None, "index": None})
    _ok(node, "POST", "/api/subtasks/1/move", {"parent_id": None, "index": 0})
    _ok(node, "DELETE", "/api/subtasks/%s" % u)


def _s3(node):
    u = _ok(node, "POST", "/api/tasks/7/subtasks", {"title": "U"})["id"]
    d = _ok(node, "POST", "/api/tasks/7/subtasks", {"title": "D"})["id"]
    _ok(node, "POST", "/api/subtasks/%s/move" % d, {"parent_id": u, "index": None})
    _ok(node, "POST", "/api/subtasks/%s/move" % d, {"parent_id": None, "index": 2})
    _ok(node, "DELETE", "/api/subtasks/%s" % u)


@pytest.mark.parametrize("skenario", [_s1, _s2, _s3, _kaskade],
                         ids=["S1 anak dikeluarkan", "S2 tersinkron keluar", "S3 belum terkirim keluar", "centang berantai U"])
def test_hapus_butir_belum_terkirim_tanpa_entri_yatim(node, tmp_path, skenario):
    rows = [{"id": 1, "title": "A", "is_done": False, "sort_order": 0, "parent_id": None}]
    _init(node, rows)
    skenario(node)
    repo = _repo(tmp_path / "s.db", rows)
    sid_of, problems = _replay(repo, rows, node(cmd="queue")["queue"])
    assert problems == []
    local, server = _trees(node, repo, sid_of)
    assert local == server


def test_entri_dibuang_menggeser_index_sesudahnya_rev_dikosongkan(node, tmp_path):
    """Create yang dibatalkan sebelum terkirim menggeser `index` entri sesudahnya: pohon boleh berbeda sesaat, tetapi
    rev tersimpan dikosongkan sehingga perangkat mengambil ulang checklist itu."""
    rows = [{"id": 1, "title": "A", "is_done": False, "sort_order": 0, "parent_id": None},
            {"id": 2, "title": "B", "is_done": False, "sort_order": 1, "parent_id": None},
            {"id": 3, "title": "X", "is_done": False, "sort_order": 0, "parent_id": 1}]
    _init(node, rows, rev=4)
    u = _ok(node, "POST", "/api/tasks/7/subtasks", {"title": "U", "index": 0})["id"]
    _ok(node, "POST", "/api/subtasks/3/move", {"parent_id": None, "index": 1})
    _ok(node, "DELETE", "/api/subtasks/%s" % u)
    repo = _repo(tmp_path / "p.db", rows)
    sid_of, problems = _replay(repo, rows, node(cmd="queue")["queue"])
    assert problems == []
    assert node(cmd="revs")["revs"]["t1"] is None


# ── putar ulang acak (seed tetap) ───────────────────────────────────────────────

def _rows(rnd):
    rows = []
    for i in range(1, rnd.randint(0, 5) + 1):
        rows.append({"id": i, "title": rnd.choice(["a", "b", "x%d" % i]), "is_done": rnd.random() < 0.3,
                     "sort_order": rnd.choice([0, 1, 2, 3, None]),
                     "parent_id": rnd.choice([None, None] + list(range(1, i)))})
    return rows


def _step(node, rnd):
    items = node(cmd="items")["items"]
    ids = [i["id"] for i in items]
    unsynced = [x for x in ids if isinstance(x, str)]
    kind = rnd.choice(["create", "create", "create", "move", "move", "move", "delete", "delete", "toggle", "rename"])
    pick = lambda pool: rnd.choice(pool) if pool else None  # noqa: E731
    if kind == "create" or not ids:
        par = rnd.choice([None] + ids) if ids else None
        _route(node, "POST", "/api/tasks/7/subtasks", {"title": rnd.choice(["n", "m", "q"]), "parent_id": par,
                                                        "index": rnd.choice([None, 0, 1, 3])})
        return
    target = pick(unsynced) if unsynced and rnd.random() < 0.5 else pick(ids)
    if kind == "move":
        _route(node, "POST", "/api/subtasks/%s/move" % target,
               {"parent_id": rnd.choice([None, None] + ids), "index": rnd.choice([None, 0, 1, 2, 9])})
    elif kind == "delete":
        _route(node, "DELETE", "/api/subtasks/%s" % target)
    elif kind == "toggle":
        _route(node, "POST", "/api/subtasks/%s/toggle" % target)
    else:
        _route(node, "PATCH", "/api/subtasks/%s" % target, {"title": rnd.choice(["r", "s", "a"])})


def test_putar_ulang_antrean_acak_sama_dengan_lokal(node, tmp_path):
    gagal = []
    for seed in SEEDS:
        rnd = random.Random(seed)
        rows = _rows(rnd)
        _init(node, rows)
        for _ in range(rnd.randint(3, 14)):
            _step(node, rnd)
        queue = node(cmd="queue")["queue"]
        repo = _repo(tmp_path / ("r%d.db" % seed), rows)
        sid_of, problems = _replay(repo, rows, queue)
        if problems:
            gagal.append((seed, "antrean", [(k, o["op"], o.get("payload")) for k, o in problems]))
            continue
        local, server = _trees(node, repo, sid_of)
        isi = lambda t: sorted(([x[0], x[1], x[3], x[4]] for x in t), key=str)  # noqa: E731
        if isi(local) != isi(server):
            gagal.append((seed, "isi berbeda (data hilang)", local, server))
        elif local != server and node(cmd="revs")["revs"].get("t1") is not None:
            gagal.append((seed, "urutan berbeda tanpa ambil ulang", local, server))
    assert gagal == [], json.dumps(gagal[:3], default=str)[:3000]
