"""Temuan mindmap #7 (pencarian) dan #6 (ekspor)."""
import io
import json
import zipfile

import webapp
import os

from conftest import db, register_user
from repository import TaskRepository

DATA = json.dumps({"nodeData": {"id": "root", "topic": "Akar", "root": True, "children": [
    {"id": "n1", "topic": "Strategi **pemasaran** organik", "children": [
        {"id": "n2", "topic": "Anak", "children": []}]}]}})


class U:
    def __init__(self, client, name):
        info = register_user(client, name, f"{name}@test.id")
        self.client = client
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

    def mk_map(self, title, **kw):
        r = self.post("/api/mindmaps", json={"title": title, **kw})
        assert r.status_code == 200, r.text
        return r.json()

    def trash_ids(self):
        r = self.get("/api/mindmaps/trash")
        assert r.status_code == 200, r.text
        return [i["id"] for i in r.json()]


def _shared(owner, member, name):
    repo = TaskRepository(os.environ["DB_PATH"])
    lst = repo.create_shared_list(name, owner.id)
    repo.add_list_member(lst["id"], member.id)
    return lst["id"]


def test_search_matches_node_text_not_json_keys(client):
    a = U(client, "mmsr1")
    m = a.mk_map("Peta Cari", data_json=DATA, client_id="mm-sr-1")
    for kw in ("children", "topic", "nodeData"):
        assert m["id"] not in [x["id"] for x in a.get(f"/api/search?q={kw}").json()["mindmaps"]]
    hit = next(x for x in a.get("/api/search?q=pemasaran").json()["mindmaps"] if x["id"] == m["id"])
    assert hit["snippet"] == "Strategi pemasaran organik"
    assert hit["client_id"] == "mm-sr-1"
    assert "search_text" not in hit and "data_json" not in hit


def test_search_text_follows_put_and_title_only_match_has_empty_snippet(client):
    a = U(client, "mmsr2")
    m = a.mk_map("Judul Zamrud", data_json=DATA)
    new = json.dumps({"nodeData": {"id": "root", "topic": "Akar", "root": True,
                                    "children": [{"id": "k", "topic": "Kupu-kupu biru", "children": []}]}})
    assert a.put(f"/api/mindmaps/{m['id']}", json={"data_json": new}).status_code == 200
    assert m["id"] in [x["id"] for x in a.get("/api/search?q=kupu").json()["mindmaps"]]
    assert m["id"] not in [x["id"] for x in a.get("/api/search?q=pemasaran").json()["mindmaps"]]
    hit = next(x for x in a.get("/api/search?q=zamrud").json()["mindmaps"] if x["id"] == m["id"])
    assert hit["snippet"] == ""


def test_search_does_not_leak_other_users_maps(client):
    a, c = U(client, "mmsr3a"), U(client, "mmsr3c")
    m = a.mk_map("Privat", data_json=DATA)
    assert m["id"] not in [x["id"] for x in c.get("/api/search?q=pemasaran").json()["mindmaps"]]


def test_search_rows_include_client_id_for_tasks_and_notes(client):
    a = U(client, "mmsr4")
    a.post("/api/tasks", json={"title": "Zebra tugas unik", "client_id": "t-sr-4"})
    a.post("/api/scratchpad", json={"title": "Zebra catatan", "content": "x", "client_id": "n-sr-4"})
    r = a.get("/api/search?q=zebra").json()
    assert "t-sr-4" in [t.get("client_id") for t in r["tasks"]]
    assert "n-sr-4" in [n.get("client_id") for n in r["notes"]]


def test_backfill_fills_null_search_text():
    conn = db()
    conn.execute("UPDATE mindmaps SET search_text = NULL")
    conn.commit(); conn.close()
    webapp.migrate_db()
    conn = db()
    assert conn.execute("SELECT COUNT(*) FROM mindmaps WHERE search_text IS NULL").fetchone()[0] == 0
    conn.close()


def test_snippet_window_centers_long_lines():
    line = "awal " + "x" * 100 + " kunci " + "y" * 100
    s = webapp._mindmap_match_snippet("satu\n" + line, "KUNCI", 80)
    assert "kunci" in s and s.startswith("…") and s.endswith("…") and len(s) <= 82


def test_export_includes_owned_mindmaps(client):
    a, b = U(client, "mmex1a"), U(client, "mmex1b")
    lid = _shared(b, a, "WS Ekspor")
    a.mk_map("Peta Ekspor", data_json=DATA)
    a.mk_map("Peta Ekspor", data_json=DATA)
    b.mk_map("Milik B", list_id=lid)
    t = a.mk_map("Dibuang"); a.delete(f"/api/mindmaps/{t['id']}")
    note = a.post("/api/scratchpad", json={"title": "Sumber", "content": "# H\n"}).json()
    a.mk_map("x", source_note_id=note["id"])
    r = a.get("/api/export/download")
    assert r.status_code == 200
    z = zipfile.ZipFile(io.BytesIO(r.content))
    names = set(z.namelist())
    assert {"mindmaps/Peta Ekspor.json", "mindmaps/Peta Ekspor.md",
            "mindmaps/Peta Ekspor (1).json", "mindmaps/Peta Ekspor (1).md"} <= names
    j = json.loads(z.read("mindmaps/Peta Ekspor.json"))
    assert j["title"] == "Peta Ekspor" and j["data"]["nodeData"]["topic"] == "Akar" and j["workspace_id"] is None
    assert z.read("mindmaps/Peta Ekspor.md").decode() == "# Akar\n\n- Strategi pemasaran organik\n  - Anak\n"
    assert not any("Milik B" in n or "Dibuang" in n for n in names)
    lj = json.loads(z.read("mindmaps/Sumber.json"))
    assert lj["linked"] is True and lj["source_note_id"] == note["id"] and lj["source_note_title"] == "Sumber"
    assert "mindmaps/Sumber.md" not in names


def test_export_names_stay_unique_for_mindmaps_and_notes(client):
    a = U(client, "mmex2")
    for t in ("A (1)", "A", "A"):
        a.mk_map(t, data_json=DATA)
        assert a.post("/api/scratchpad", json={"title": t, "content": "x"}).status_code == 200
    z = zipfile.ZipFile(io.BytesIO(a.get("/api/export/download").content))
    names = z.namelist()
    assert len(names) == len(set(names)), names
    lower = [n.lower() for n in names]
    assert len(lower) == len(set(lower))
    for prefix, ext in (("mindmaps/", ".json"), ("notes/", ".md")):
        got = sorted(n for n in names if n.startswith(prefix) and n.endswith(ext))
        assert len(got) == 3, got


def test_mindmap_responses_do_not_carry_search_text(client):
    a = U(client, "mmst1")
    m = a.mk_map("Tanpa ST", data_json=DATA)
    assert "search_text" not in m
    assert "search_text" not in a.get(f"/api/mindmaps/{m['id']}").json()
    r = a.put(f"/api/mindmaps/{m['id']}", json={"data_json": DATA})
    assert r.status_code == 200 and "search_text" not in r.json()
    assert all("search_text" not in x for x in a.get("/api/mindmaps?linked=1").json())
    conn = db()
    st = conn.execute("SELECT search_text FROM mindmaps WHERE id = ?", (m["id"],)).fetchone()[0]
    conn.close()
    assert "pemasaran" in st
