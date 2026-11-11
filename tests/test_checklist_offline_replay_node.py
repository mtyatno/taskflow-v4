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
import re
import shutil
import sqlite3
import subprocess

import pytest

import checklist_tree
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

    def __call__(self, server=None, **cmd):
        """Satu perintah → satu jawaban. Selama perintah berjalan, baris {"req": …} (request transport push) dijawab
        `server(method, path, body)` → (status, data)."""
        self._send(cmd)
        while True:
            line = self.p.stdout.readline()
            assert line, "penggerak node berhenti"
            out = json.loads(line)
            if "req" in out:
                assert server is not None, out
                status, data = server(out["req"]["method"], out["req"]["path"], out["req"]["body"])
                self._send({"status": status, "data": data})
                continue
            assert "crash" not in out, out.get("crash")
            return out

    def _send(self, obj):
        self.p.stdin.write(json.dumps(obj) + "\n")
        self.p.stdin.flush()

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
    prog, total = _counts(rows)
    recs = [{"cid": "k%d" % r["id"], "server_id": r["id"], "task_cid": "t1",
             "parent_cid": None if r["parent_id"] is None else "k%d" % r["parent_id"],
             "title": r["title"], "is_done": r["is_done"], "sort_order": r["sort_order"], "created_at": None} for r in rows]
    node(cmd="init", tasks=[{"cid": "t1", "server_id": TASK, "title": "T", "progress": prog, "checklist_total": total,
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


# ── push aplikasi sungguhan (syncpush.pushOutbox) ke TaskRepository (rencana PR B2 R4) ─────────────────────────────
# Penggerak menjalankan pushOutbox; setiap request dijawab `_http` di atas TaskRepository (pemetaan galat sama dengan
# webapp: ChecklistError → 422, butir/task tidak ada → 404). Invarian ADR-051: sesudah push antrean kosong (tidak ada
# yang tersangkut), dan bila rev tersimpan masih angka maka rev itu = rev server DAN pohon lokal = pohon server
# (pre-order lengkap). Rev dikosongkan (None) = perangkat mengambil ulang (Task 5: pullChecklists).

def _http(repo, db_path):
    def task_exists(tid):
        conn = sqlite3.connect(str(db_path))
        try:
            return conn.execute("SELECT 1 FROM tasks WHERE id = ?", (tid,)).fetchone() is not None
        finally:
            conn.close()

    def handle(method, path, body):
        body = body or {}
        try:
            m = re.fullmatch(r"/api/tasks/(\d+)/subtasks", path)
            if m and method == "POST":
                tid = int(m.group(1))
                if not task_exists(tid):
                    return 404, {"detail": "Task not found"}
                return 200, repo.add_subtask(tid, body["title"], client_id=body.get("client_id"),
                                             parent_id=body.get("parent_id"), index=body.get("index"))
            m = re.fullmatch(r"/api/subtasks/(\d+)(/move)?", path)
            assert m, (method, path)
            sid = int(m.group(1))
            if method == "PATCH":
                r = repo.update_subtask(sid, title=body.get("title"), is_done=body.get("is_done"))
            elif method == "POST" and m.group(2):
                r = repo.move_subtask(sid, body["parent_id"], body.get("index"))
            elif method == "DELETE":
                r = repo.delete_subtask(sid)
                r = r and {"ok": True, **r}
            else:
                raise AssertionError((method, path))
            if r is None:
                return 404, {"detail": "Subtask not found"}
            return 200, r
        except ChecklistError as e:
            return 422, {"detail": e.code}
    return handle


def _server_rev(db_path):
    conn = sqlite3.connect(str(db_path))
    try:
        row = conn.execute("SELECT COALESCE(checklist_rev, 0), progress, checklist_total FROM tasks WHERE id = ?",
                           (TASK,)).fetchone()
        return row
    finally:
        conn.close()


def _counts(rows):
    """(progress, checklist_total) seperti _recompute_progress: butir level atas; tanpa butir → progress 0."""
    top = [r for r in rows if r["parent_id"] is None]
    done = sum(1 for r in top if r["is_done"])
    return (checklist_tree.percent(done, len(top)) if top else 0), len(top)


def _repo_rev(path, rows, rev):
    repo = _repo(path, rows)
    conn = sqlite3.connect(str(path))
    prog, total = _counts(rows)
    conn.execute("UPDATE tasks SET checklist_rev = ?, progress = ?, checklist_total = ? WHERE id = ?",
                 (rev, prog, total, TASK))
    conn.commit()
    conn.close()
    return repo


def _local_tree(node):
    """Pohon lokal dengan id server (semua butir sudah terkirim)."""
    return [[i["id"], i["parent_id"], i["depth"], bool(i["is_done"]), i["title"]] for i in node(cmd="items")["items"]]


def _server_tree(repo):
    return [[i["id"], i["parent_id"], i["depth"], bool(i["is_done"]), i["title"]] for i in repo.get_subtasks(TASK)]


def _interfere(repo, rnd):
    """Perangkat lain mengubah checklist di server (sebelum push perangkat ini)."""
    items = repo.get_subtasks(TASK)
    kind = rnd.choice(["add", "delete", "rename", "toggle", "move"] if items else ["add"])
    if kind == "add":
        repo.add_subtask(TASK, "lain", parent_id=rnd.choice([None] + [i["id"] for i in items]), index=0)
    elif kind == "delete":
        repo.delete_subtask(rnd.choice(items)["id"])
    elif kind == "rename":
        repo.update_subtask(rnd.choice(items)["id"], title="lain")
    elif kind == "toggle":
        repo.toggle_subtask(rnd.choice(items)["id"])
    else:
        it = rnd.choice(items)
        try:
            repo.move_subtask(it["id"], None, 0)
        except ChecklistError:
            pass


def _push_seed(node, tmp_path, seed, interfere):
    rnd = random.Random(seed)
    rows = _rows(rnd)
    rev = rnd.randint(1, 3)
    _init(node, rows, rev=rev)
    for _ in range(rnd.randint(3, 14)):
        _step(node, rnd)
    db_path = tmp_path / ("push%d_%s.db" % (seed, interfere))
    repo = _repo_rev(db_path, rows, rev)
    if interfere:
        for _ in range(rnd.randint(1, 2)):
            _interfere(repo, rnd)
    res = node(cmd="push", server=_http(repo, db_path))["result"]
    return rows, repo, db_path, res


def test_push_aplikasi_ke_server_sama_dengan_lokal(node, tmp_path):
    """Tanpa perangkat lain: semua aksi diterima, antrean kosong, isi server = lokal, dan rev tersimpan (bila masih
    angka) = rev server dengan pohon lengkap sama; progress task lokal = server."""
    gagal = []
    maju = 0
    for seed in SEEDS:
        rows, repo, db_path, res = _push_seed(node, tmp_path, seed, False)
        queue = node(cmd="queue")["queue"]
        if queue or res.get("checklistRejected") or res.get("failed"):
            gagal.append((seed, "antrean/ditolak", res, [(o["op"], o.get("payload")) for o in queue]))
            continue
        records = node(cmd="records")["records"]
        if any(r["server_id"] is None for r in records):
            gagal.append((seed, "butir tanpa id server", records))
            continue
        local, server = _local_tree(node), _server_tree(repo)
        isi = lambda t: sorted(([x[0], x[1], x[3], x[4]] for x in t), key=str)  # noqa: E731
        stored = node(cmd="revs")["revs"].get("t1")
        srev, sprog, stotal = _server_rev(db_path)
        t = node(cmd="task")["task"]
        if isi(local) != isi(server):
            gagal.append((seed, "isi berbeda (data hilang)", local, server))
        elif stored is not None and (stored != srev or local != server):
            gagal.append((seed, "rev tersimpan angka padahal berbeda", stored, srev, local, server))
        elif stored is None and node(cmd="queue")["queue"]:
            gagal.append((seed, "rev kosong dengan antrean tersisa"))
        elif t["checklist_total"] != stotal or (stotal and t["progress"] != sprog):
            gagal.append((seed, "progress berbeda", [t["progress"], t["checklist_total"]], [sprog, stotal]))
        if stored is not None:
            maju += 1
    assert gagal == [], json.dumps(gagal[:3], default=str)[:3000]
    assert maju > len(SEEDS) // 2, "rev tersimpan seharusnya maju di sebagian besar skenario (%d)" % maju


def test_push_aplikasi_bentrok_perangkat_lain_tidak_tersangkut(node, tmp_path):
    """Perangkat lain mengubah checklist sebelum push: antrean tetap habis (diterima atau ditolak, tidak tersangkut),
    dan rev tersimpan tidak pernah menyembunyikan perbedaan dengan server: tersimpan ≤ rev server, dan tersimpan =
    rev server ⇒ pohon sama (tersimpan < rev server → pullChecklists mengambil ulang)."""
    gagal = []
    ditolak = 0
    for seed in SEEDS:
        rows, repo, db_path, res = _push_seed(node, tmp_path, seed, True)
        ditolak += res.get("checklistRejected") or 0
        queue = node(cmd="queue")["queue"]
        if queue:
            gagal.append((seed, "antrean tersangkut", [(o["op"], o.get("payload")) for o in queue]))
            continue
        stored = node(cmd="revs")["revs"].get("t1")
        srev = _server_rev(db_path)[0]
        if stored is not None:
            local, server = _local_tree(node), _server_tree(repo)
            if stored > srev or (stored == srev and local != server):
                gagal.append((seed, "rev tersimpan menyembunyikan perbedaan", stored, srev, local, server))
    assert gagal == [], json.dumps(gagal[:3], default=str)[:3000]
    assert ditolak > 0, "skenario bentrok seharusnya menghasilkan penolakan"
