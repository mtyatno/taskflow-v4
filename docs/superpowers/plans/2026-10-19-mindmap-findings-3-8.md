# Temuan Mindmap #3–#8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menutup sisa temuan review mindmap: Sampah mindmap (#5), ekspor (#6), pencarian teks node + snippet + `client_id` (#7), pin pribadi/penanda bersama/filter workspace (#8), kartu link hidup (#3), lalu kolaborasi langsung dengan merge per node (#4).

**Architecture:** Server tetap otoritatif (FastAPI + SQLite): Sampah memakai tabel snapshot `trashed_mindmaps` (pola ADR-004), pin per user di `mindmap_pins`, teks pencarian di kolom turunan `mindmaps.search_text`, sinyal perubahan lewat SSE dalam proses (`mindmap_subscribers`, pola DM). Klien offline-first (ADR-006): cermin Sampah di `_meta`, op outbox `restore`, kartu link dari router lokal (`mindmaplinks.js`), dan merge tiga arah per node di klien (`mindmapmerge.js`) saat 409/pull dengan basis `base_data_json` yang disimpan per record.

**Tech Stack:** FastAPI + SQLite (`webapp.py`), pytest; modul UMD `static/offline/*.js` (browser + `node --test` dengan `fake-indexeddb`); React tanpa build di `static/index.html` (sudah dalam bentuk `React.createElement`, diedit langsung); mind-elixir 5.15.1 di iframe `static/vendor/mind-elixir/index.html`; Service Worker `static/sw.js`.

**Spec:** `docs/superpowers/specs/2026-10-19-mindmap-findings-3-8-design.md`

## Global Constraints

- Ikuti keputusan Bapak di spec (kartu hidup dari data lokal; merge per node dengan salinan konflik hanya untuk field yang sama di node yang sama; Sampah sama dengan catatan; pin pribadi; filter workspace kecil). Peta tertaut (Petakan, `source_note_id`) tidak pernah di-merge dan tidak berlangganan SSE.
- Teks UI persis seperti di spec (bahasa Indonesia). Konstanta Sampah di `TF.mindmaptrash` (Task A4).
- Aturan repo: **jangan pakai `border-left` aksen**; versi SW dinaikkan **sekali per PR** di semua tempat (main sekarang `taskflow-v420-toc-headings`; **cek `main` lagi saat rilis**, nomor bisa sudah naik): `static/sw.js` (`const CACHE`), `static/index.html` (`window.__SW_VERSION = "…"` dan fallback `window.__SW_VERSION || "…"` di modal About), `webapp.py` (`sw_cache = "…"`), `tests/test_version.py`, dan semua tes yang menyebut versi lama (`grep -rl "<versi lama>" tests`); naikkan `?v=` iframe (`/static/vendor/mind-elixir/index.html?v=143` di `static/index.html` ~10637) bila iframe berubah; naikkan `app.css?v=` (sekarang 334) bila `static/app.css` berubah; modul offline baru masuk precache `static/sw.js` (~baris 41–48) dan tag `<script>` di `static/index.html` (~282); perbarui `.agents/CURRENT_STATE.md` + `.agents/SESSION_LOG.md` tiap PR; ADR baru di `.agents/DECISIONS.md` (nomor bebas berikutnya, sekarang ADR-012); PR **draft**, merge hanya setelah Bapak bilang "merge dan deploy"; perubahan backend butuh `sudo systemctl restart taskflow-web` setelah deploy (cantumkan di PR & CURRENT_STATE).
- Perintah cek: `npm install --no-save fake-indexeddb@6` (sekali), `npm test` (gagal pra-ada yang diketahui: `tests/offline/draw_local_reactive.test.js`, butuh bundle tldraw), `python -m pytest tests/ -q`, `node temporary_files/check_inline_scripts.js static/index.html`, `node temporary_files/check_inline_scripts.js static/vendor/mind-elixir/index.html`, `git diff main -U0 | grep -iE "border-?left"` → kosong.
- Setiap commit diakhiri dua baris trailer; gunakan bentuk persis:
  ```
  git commit -m "<pesan>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013t2wBZvFmWiPG5XEYKL44H"
  ```
- Dua branch/PR: **PR A** `claude/mindmap-findings-a` dari `main` (Task A1–A9). **PR B** `claude/mindmap-findings-b` dari `main` **setelah PR A di-merge** (Task B1–B6).
- Pola tes Python: `tests/conftest.py` (`register_user`, `db`); kelas helper `U` seperti `tests/test_note_trash.py` (bersihkan cookie tiap request). Pola tes JS: `tests/offline/setup.js` (`deleteDB`), `db.js` (`_reset`, `openDB`), lihat `tests/offline/mindmap_cas_conflict.test.js`.

## Review Focus

1. **Pulihkan peta dengan id dan `client_id` yang sama** → link node `type:'mindmap'` (id = cid pembuat = `client_id`) hidup lagi di semua perangkat; tidak ada duplikat setelah pull. Tes: A2 `test_delete_moves_to_trash_and_restore_keeps_id_client_id_pin`, A5 `push restore op: ok → record recreated with cid = client_id`.
2. **Merge tidak pernah menghapus isi yang diedit sisi lain** (edit vs hapus node, tambah anak di bawah node yang dihapus, pindah vs edit). Tes: B1 `delete vs edit keeps the edited node`, `child added under a node deleted on the other side resurrects the parent`.
3. **Basis merge salah** (basis tidak maju setelah PUT sukses → node yang sudah dihapus muncul lagi / edit terbalik pada merge berikutnya). Tes: B4 `push 409 with base → merged + requeued … base advanced`, B3 `updateMindmap captures base on first edit of a clean record`.
4. **Otorisasi**: anggota tidak bisa menghapus/memulihkan peta orang lain; pin anggota tidak mengubah pemilik; stream SSE menolak non-anggota dan mengeluarkan pelanggan yang aksesnya dicabut; pencarian/ekspor tidak membocorkan peta orang lain. Tes: A1 `test_member_pins_shared_map_without_affecting_owner`, A2 `test_member_cannot_delete_and_repeat_delete_is_idempotent`, A3 `test_search_does_not_leak_other_users_maps`, `test_export_includes_owned_mindmaps`, B2 `test_broadcast_filters_subscribers_without_access`, `test_stream_rejects_non_member`.
5. **Hapus kedua (perangkat lain) setelah peta di Sampah** dulu 403 → klien membatalkan hapus (peta "hidup lagi"). Sekarang 200 idempoten. Tes: A2 `test_member_cannot_delete_and_repeat_delete_is_idempotent`.
6. **Pembaruan langsung saat user sedang mengetik di node** tidak boleh membuang ketikan. Tes: B5 iframe `remoteUpdate` menolak saat `#input-box` aktif.
7. **Peta tertaut di Sampah setelah catatan dihapus permanen** harus ikut hilang; restore tanpa catatan ditolak. Tes: A2 `test_linked_map_restore_rules`.

---

## Bagian A — PR A (branch `claude/mindmap-findings-a` dari `main`)

### Task A1: pin mindmap per user (backend, #8a)

**Files:**
- Modify: `webapp.py` — migrasi di `migrate_db()` (setelah blok `mindmaps.source_note_id`, ~baris 651–665); `_mindmap_enrich` (~4752); `list_mindmaps` (~7406); `share_mindmap` (~7578); `create_mindmap` (~7624, kedua jalur); `get_mindmap` (~7697); `update_mindmap` (~7709); `toggle_pin_mindmap` (~7741); `_delete_linked_mindmaps` (~4780); `schema-db.md` (bagian `mindmaps`, ~156)
- Test: `tests/test_mindmap_pins.py` (baru)

**Interfaces:**
- Produces: tabel `mindmap_pins(user_id, mindmap_id, created_at)`, `PRIMARY KEY(user_id, mindmap_id)`, index `idx_mindmap_pins_mm`.
- Produces: `_mindmap_enrich(d: dict, conn, uid: Optional[int] = None) -> dict` — bila `uid` diberikan, `d["is_pinned"] = 1|0` dari `mindmap_pins`.
- Produces: `class MindmapPinReq(BaseModel): pinned: Optional[bool] = None`; `PATCH /api/mindmaps/{mid}/pin` body opsional.
- Consumes (A2): A2 membaca/menulis `mindmap_pins` untuk snapshot Sampah.

- [ ] **Step 1: Write the failing tests** (`tests/test_mindmap_pins.py`)

```python
"""Temuan mindmap #8a: pin mindmap pribadi per user (spec 2026-10-19 §8a)."""
import os

import webapp
from conftest import db, register_user
from repository import TaskRepository


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
    def patch(self, url, **kw): return self._call("patch", url, **kw)

    def mk_map(self, title, **kw):
        r = self.post("/api/mindmaps", json={"title": title, **kw})
        assert r.status_code == 200, r.text
        return r.json()


def _shared(owner, member, name):
    repo = TaskRepository(os.environ["DB_PATH"])
    lst = repo.create_shared_list(name, owner.id)
    repo.add_list_member(lst["id"], member.id)
    return lst["id"]


def _item(user, mid):
    return next(x for x in user.get("/api/mindmaps").json() if x["id"] == mid)


def test_member_pins_shared_map_without_affecting_owner(client):
    a, b = U(client, "pinown1"), U(client, "pinmem1")
    lid = _shared(a, b, "WS Pin 1")
    m = a.mk_map("Peta Tim", list_id=lid)
    r = b.patch(f"/api/mindmaps/{m['id']}/pin", json={"pinned": True})
    assert r.status_code == 200, r.text
    assert r.json()["is_pinned"] == 1
    assert _item(b, m["id"])["is_pinned"] == 1
    assert _item(a, m["id"])["is_pinned"] == 0
    assert a.get(f"/api/mindmaps/{m['id']}").json()["is_pinned"] == 0


def test_explicit_pin_is_idempotent_and_legacy_toggle_still_works(client):
    a = U(client, "pinown2")
    m = a.mk_map("Satu")
    before = a.get(f"/api/mindmaps/{m['id']}").json()["updated_at"]
    for _ in range(2):
        assert a.patch(f"/api/mindmaps/{m['id']}/pin", json={"pinned": True}).json()["is_pinned"] == 1
    assert a.patch(f"/api/mindmaps/{m['id']}/pin").json()["is_pinned"] == 0  # tanpa body = toggle
    assert a.patch(f"/api/mindmaps/{m['id']}/pin").json()["is_pinned"] == 1
    assert a.get(f"/api/mindmaps/{m['id']}").json()["updated_at"] == before


def test_list_orders_by_own_pins(client):
    a = U(client, "pinown3")
    m1, m2 = a.mk_map("Lama"), a.mk_map("Baru")
    a.patch(f"/api/mindmaps/{m1['id']}/pin", json={"pinned": True})
    ids = [x["id"] for x in a.get("/api/mindmaps").json()]
    assert ids.index(m1["id"]) < ids.index(m2["id"])


def test_non_member_gets_404(client):
    a, c = U(client, "pinown4"), U(client, "pinout4")
    m = a.mk_map("Rahasia")
    assert c.patch(f"/api/mindmaps/{m['id']}/pin", json={"pinned": True}).status_code == 404


def test_migration_copies_owner_is_pinned_once(client):
    a = U(client, "pinmig5")
    m = a.mk_map("Warisan")
    conn = db()
    conn.execute("DROP TABLE IF EXISTS mindmap_pins")
    conn.execute("UPDATE mindmaps SET is_pinned = 1 WHERE id = ?", (m["id"],))
    conn.commit(); conn.close()
    webapp.migrate_db()
    assert a.get(f"/api/mindmaps/{m['id']}").json()["is_pinned"] == 1
    a.patch(f"/api/mindmaps/{m['id']}/pin", json={"pinned": False})
    webapp.migrate_db()  # tabel sudah ada → kolom lama tidak disalin ulang
    assert a.get(f"/api/mindmaps/{m['id']}").json()["is_pinned"] == 0
```

- [ ] **Step 2: Run** `python -m pytest tests/test_mindmap_pins.py -q` — Expected: FAIL (anggota 404 / `is_pinned` global).
- [ ] **Step 3: Implement.**
  - Migrasi: `existed = conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mindmap_pins'").fetchone()`; `CREATE TABLE IF NOT EXISTS mindmap_pins (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, mindmap_id INTEGER NOT NULL, created_at TEXT, PRIMARY KEY (user_id, mindmap_id))`; `CREATE INDEX IF NOT EXISTS idx_mindmap_pins_mm ON mindmap_pins(mindmap_id)`; bila `not existed`: `INSERT OR IGNORE INTO mindmap_pins (user_id, mindmap_id, created_at) SELECT user_id, id, updated_at FROM mindmaps WHERE is_pinned = 1`. Kolom `is_pinned` tidak diubah (rollback aman) dan tidak dipakai lagi.
  - `_mindmap_enrich(d, conn, uid=None)`: bila `uid is not None` → `d["is_pinned"] = 1 if conn.execute("SELECT 1 FROM mindmap_pins WHERE user_id = ? AND mindmap_id = ?", (uid, d["id"])).fetchone() else 0`. Semua endpoint mindmap di atas memanggil `_mindmap_enrich(dict(row), conn, uid)` (termasuk jalur POST non-tertaut yang dulu `dict(row)` dan cabang duplikat `client_id`).
  - `list_mindmaps`: kolom eksplisit tanpa `is_pinned` kolom, tambah `EXISTS(SELECT 1 FROM mindmap_pins p WHERE p.mindmap_id = mindmaps.id AND p.user_id = ?) AS is_pinned`, `ORDER BY is_pinned DESC, updated_at DESC`; parameter `uid` ditambahkan di depan `access_params`. Hasil tetap lewat `_mindmap_enrich(..., conn)` (tanpa uid, karena sudah dihitung).
  - `toggle_pin_mindmap(mid: int, req: Optional[MindmapPinReq] = None, user=…)`: baris dicari dengan `_mindmap_access_clause(uid)` → tidak ada → 404 "Mindmap tidak ditemukan". `want = req.pinned if req and req.pinned is not None else not currently_pinned`; `INSERT OR IGNORE` / `DELETE` di `mindmap_pins`; **tidak** menyentuh `updated_at`; kembalikan `_mindmap_enrich(dict(SELECT *), conn, uid)`.
  - `_delete_linked_mindmaps`: sebelum `DELETE FROM mindmaps …`, `DELETE FROM mindmap_pins WHERE mindmap_id IN (SELECT id FROM mindmaps WHERE source_note_id IN (…))`.
  - `schema-db.md`: dokumentasikan `mindmap_pins` dan bahwa `mindmaps.is_pinned` usang.
- [ ] **Step 4: Run** `python -m pytest tests/test_mindmap_pins.py tests/test_mindmaps.py tests/test_petakan.py -q` — Expected: PASS.
- [ ] **Step 5: Commit**
  ```
  git add webapp.py schema-db.md tests/test_mindmap_pins.py
  git commit -m "feat(mindmap): pin pribadi per user (mindmap_pins)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013t2wBZvFmWiPG5XEYKL44H"
  ```

### Task A2: Sampah mindmap (backend, #5)

**Files:**
- Modify: `webapp.py` — DDL di `migrate_db()` (setelah blok `trashed_notes`, ~514–529); helper baru setelah `_trash_days_left` (~5006–5015); rute baru tepat setelah `list_mindmaps` (~7419, **di atas** semua rute `/api/mindmaps/{mid}`); `delete_mindmap` (~7757); `_delete_linked_mindmaps` (~4780); `_trash_days_left` (parameter retensi); `schema-db.md`
- Test: `tests/test_mindmap_trash.py` (baru)

**Interfaces:**
- Produces: `MINDMAP_TRASH_RETENTION_DAYS = 30`; tabel `trashed_mindmaps` (DDL persis di spec §5).
- Produces: `_mindmap_plain(topic: str) -> str` (teks polos topic, aturan spec §7) dan `_mindmap_topics(data_json: str) -> list[str]` (topic polos pre-order, root dulu, kosong dilewati; JSON rusak/tanpa `nodeData` → `[]`). Dipakai A3.
- Produces: `_ensure_trashed_mindmaps_table(conn)`, `_snapshot_mindmap_to_trash(conn, row, uid)`, `_purge_expired_trashed_mindmaps(conn)`, `_trash_days_left(deleted_at, days=NOTE_TRASH_RETENTION_DAYS)`.
- Produces: `GET /api/mindmaps/trash`, `POST /api/mindmaps/trash/{mid}/restore`, `DELETE /api/mindmaps/trash/{mid}`, `DELETE /api/mindmaps/trash`, perilaku baru `DELETE /api/mindmaps/{mid}` (tabel API di spec §5). Bentuk item: `{id, title, preview, list_id, source_note_id, linked, client_id, deleted_at, days_left}`.
- Consumes: `mindmap_pins` (A1), `_sync_linked_mindmap`, `_note_access_clause`, `_table_columns`.

- [ ] **Step 1: Write the failing tests** (`tests/test_mindmap_trash.py`; salin kelas `U` dan `_shared` dari A1 dan tambahkan `put`/`delete`)

```python
"""Temuan mindmap #5: Sampah mindmap (spec 2026-10-19 §5)."""
import json
import os
from datetime import datetime, timedelta

import pytz

from conftest import db, register_user
from repository import TaskRepository

JKT = pytz.timezone("Asia/Jakarta")
DATA = json.dumps({"nodeData": {"id": "root", "topic": "Rencana", "root": True, "children": [
    {"id": "a", "topic": "Satu", "children": []},
    {"id": "b", "topic": "**Dua**", "children": []}]}})


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


def _row(sql, *params):
    conn = db()
    try:
        return conn.execute(sql, params).fetchone()
    finally:
        conn.close()


def test_delete_moves_to_trash_and_restore_keeps_id_client_id_pin(client):
    a = U(client, "mmtr1")
    m = a.mk_map("Rencana", data_json=DATA, client_id="cid-tr-1")
    a.patch(f"/api/mindmaps/{m['id']}/pin", json={"pinned": True})
    r = a.delete(f"/api/mindmaps/{m['id']}")
    assert r.status_code == 200 and r.json() == {"ok": True, "trashed": True}
    assert m["id"] not in [x["id"] for x in a.get("/api/mindmaps?linked=1").json()]
    assert a.get(f"/api/mindmaps/{m['id']}").status_code == 404
    it = next(i for i in a.get("/api/mindmaps/trash").json() if i["id"] == m["id"])
    assert it["title"] == "Rencana" and it["client_id"] == "cid-tr-1" and it["linked"] is False
    assert it["preview"] == "Satu · Dua" and it["days_left"] == 30
    r = a.post(f"/api/mindmaps/trash/{m['id']}/restore")
    assert r.status_code == 200, r.text
    row = r.json()
    assert (row["id"], row["client_id"], row["is_pinned"], row["data_json"]) == (m["id"], "cid-tr-1", 1, DATA)
    assert m["id"] not in a.trash_ids()


def test_member_cannot_delete_and_repeat_delete_is_idempotent(client):
    a, b = U(client, "mmtr2a"), U(client, "mmtr2b")
    lid = _shared(a, b, "WS Trash 2")
    m = a.mk_map("Tim", list_id=lid)
    assert b.delete(f"/api/mindmaps/{m['id']}").status_code == 403
    assert a.delete(f"/api/mindmaps/{m['id']}").status_code == 200
    assert a.delete(f"/api/mindmaps/{m['id']}").json() == {"ok": True, "trashed": True}
    assert b.delete(f"/api/mindmaps/{m['id']}").status_code == 404
    assert b.post(f"/api/mindmaps/trash/{m['id']}/restore").status_code == 404
    assert a.delete("/api/mindmaps/987654321").status_code == 404


def test_expired_items_are_purged_lazily(client):
    a = U(client, "mmtr3")
    m = a.mk_map("Tua")
    a.delete(f"/api/mindmaps/{m['id']}")
    old = (datetime.now(JKT) - timedelta(days=31)).isoformat()
    conn = db()
    conn.execute("UPDATE trashed_mindmaps SET deleted_at = ? WHERE mindmap_id = ?", (old, m["id"]))
    conn.commit(); conn.close()
    assert m["id"] not in a.trash_ids()
    assert _row("SELECT 1 FROM trashed_mindmaps WHERE mindmap_id = ?", m["id"]) is None


def test_purge_one_and_empty(client):
    a = U(client, "mmtr4")
    maps = [a.mk_map(t) for t in ("P1", "P2", "P3")]
    for m in maps:
        a.delete(f"/api/mindmaps/{m['id']}")
    assert a.delete(f"/api/mindmaps/trash/{maps[0]['id']}").json() == {"ok": True}
    assert a.post(f"/api/mindmaps/trash/{maps[0]['id']}/restore").status_code == 404
    assert a.delete("/api/mindmaps/trash").json() == {"ok": True, "deleted": 2}
    assert a.trash_ids() == []


def test_linked_map_restore_rules(client):
    a = U(client, "mmtr5")
    note = a.post("/api/scratchpad", json={"title": "Catatan", "content": "# A\n"}).json()
    lm = a.mk_map("x", source_note_id=note["id"])
    a.delete(f"/api/mindmaps/{lm['id']}")
    it = next(i for i in a.get("/api/mindmaps/trash").json() if i["id"] == lm["id"])
    assert it["linked"] is True and it["source_note_id"] == note["id"]
    lm2 = a.mk_map("x", source_note_id=note["id"])  # catatan dipetakan ulang
    assert lm2["id"] != lm["id"]
    r = a.post(f"/api/mindmaps/trash/{lm['id']}/restore")
    assert r.status_code == 200 and r.json()["id"] == lm2["id"]
    assert lm["id"] not in a.trash_ids()
    a.delete(f"/api/mindmaps/{lm2['id']}")
    a.delete(f"/api/scratchpad/{note['id']}")  # catatan ke Sampah catatan
    r = a.post(f"/api/mindmaps/trash/{lm2['id']}/restore")
    assert r.status_code == 409 and r.json()["detail"]["code"] == "SOURCE_NOTE_MISSING"
    a.delete(f"/api/scratchpad/trash/{note['id']}")  # catatan dihapus permanen
    assert lm2["id"] not in a.trash_ids()


def test_restore_drops_list_id_when_workspace_gone(client):
    a, b = U(client, "mmtr6a"), U(client, "mmtr6b")
    lid = _shared(a, b, "WS Hilang")
    m = a.mk_map("Tim", list_id=lid)
    a.delete(f"/api/mindmaps/{m['id']}")
    conn = db()
    conn.execute("DELETE FROM list_members WHERE list_id = ?", (lid,))
    conn.execute("DELETE FROM shared_lists WHERE id = ?", (lid,))
    conn.commit(); conn.close()
    row = a.post(f"/api/mindmaps/trash/{m['id']}/restore").json()
    assert row["list_id"] is None
```

- [ ] **Step 2: Run** `python -m pytest tests/test_mindmap_trash.py -q` — Expected: FAIL (`/api/mindmaps/trash` 422, hapus permanen).
- [ ] **Step 3: Implement.**
  - DDL `trashed_mindmaps` + dua index (spec §5) di `migrate_db()` dengan pola blok `trashed_notes`; `_ensure_trashed_mindmaps_table(conn)` versi tanpa FK (pola `_ensure_trashed_notes_table`).
  - `_mindmap_plain(topic)`: `s = str(topic or "")[:2000]`; hapus `<[^>]+>`; `!\[([^\]]*)\]\([^)]*\)` → `\1`; `\[([^\]]*)\]\([^)]*\)` → `\1`; hapus `\*\*|__|~~|==|`; hapus `^#{1,6}\s*`; rapatkan `\s+` → spasi; strip. `_mindmap_topics(data_json)`: `json.loads` dalam try; `nodeData` harus dict; DFS iteratif pre-order (root dulu, `children` berurutan), kumpulkan `_mindmap_plain(node.get("topic"))` yang tidak kosong.
  - `_trash_days_left(deleted_at, days=NOTE_TRASH_RETENTION_DAYS)` (pemanggil lama tidak berubah).
  - `_snapshot_mindmap_to_trash(conn, row, uid)`: `snap = {"mindmap": dict(row), "pins": [user_id dari mindmap_pins]}`; `INSERT OR REPLACE INTO trashed_mindmaps (mindmap_id, user_id, title, list_id, source_note_id, client_id, snapshot_json, deleted_at, deleted_by) VALUES (…)` dengan `user_id = row["user_id"]`, `deleted_at = datetime.now(_TZ_JKT).isoformat()`, `deleted_by = uid`. Jangan commit di sini.
  - `_purge_expired_trashed_mindmaps(conn)`: cutoff `MINDMAP_TRASH_RETENTION_DAYS`; `DELETE … WHERE deleted_at < ?`.
  - `delete_mindmap`: `row = SELECT * FROM mindmaps WHERE id = ?`; tidak ada → bila `SELECT 1 FROM trashed_mindmaps WHERE mindmap_id = ? AND user_id = ?` ada → `{"ok": True, "trashed": True}`, selain itu 404 "Mindmap tidak ditemukan"; `row["user_id"] != uid` → 403 (pesan lama); selain itu snapshot → `DELETE FROM mindmap_pins WHERE mindmap_id = ?` → `DELETE FROM mindmaps WHERE id = ?` (satu transaksi `get_db`) → `{"ok": True, "trashed": True}`.
  - Rute (urutan: di atas `@app.get("/api/mindmaps/{mid}")`):
    - `GET /api/mindmaps/trash`: purge; baris `WHERE user_id = ? ORDER BY deleted_at DESC`; `preview = " · ".join(_mindmap_topics(snap["mindmap"]["data_json"])[1:4])` (kosong untuk tertaut); `linked = source_note_id is not None`.
    - `POST /api/mindmaps/trash/{mid}/restore`: alur spec §5. Tertaut: `note = SELECT id FROM scratchpad_notes WHERE id = ?` tidak ada → `HTTPException(409, detail={"code": "SOURCE_NOTE_MISSING"})`; `existing = SELECT * FROM mindmaps WHERE source_note_id = ?` ada → `DELETE FROM trashed_mindmaps WHERE mindmap_id = ?`, commit, kembalikan `_mindmap_enrich(dict(existing), conn, uid)`. Non-tertaut: `list_id` dicek seperti `restore_trashed_note` (owner/anggota, else `None`). `client_id` bentrok `(user_id, client_id)` → `None`; `last_edited_by` user hilang → `None`; insert dengan kolom yang ada di `_table_columns(conn, "mindmaps")`; bila kolom `search_text` ada → isi `"\n".join(_mindmap_topics(data_json))` untuk non-tertaut, `""` untuk tertaut (A3 menambah kolom; tulis kode yang aman bila kolom belum ada). Pin dipulihkan (`INSERT OR IGNORE`) untuk user yang masih ada. Hapus baris Sampah; tertaut → `_sync_linked_mindmap(conn, sn)`; commit; kembalikan `_mindmap_enrich(dict(SELECT *), conn, uid)`.
    - `DELETE /api/mindmaps/trash/{mid}` → `DELETE … WHERE mindmap_id = ? AND user_id = ?` → `{"ok": True}`.
    - `DELETE /api/mindmaps/trash` → `DELETE … WHERE user_id = ? RETURNING mindmap_id` → `{"ok": True, "deleted": n}`.
  - `_delete_linked_mindmaps`: juga `DELETE FROM trashed_mindmaps WHERE source_note_id IN (…)`.
  - `schema-db.md`: dokumentasikan `trashed_mindmaps`.
- [ ] **Step 4: Run** `python -m pytest tests/test_mindmap_trash.py tests/test_mindmap_pins.py tests/test_mindmaps.py tests/test_petakan.py tests/test_note_trash.py -q` — Expected: PASS.
- [ ] **Step 5: Commit**
  ```
  git add webapp.py schema-db.md tests/test_mindmap_trash.py
  git commit -m "feat(mindmap): Sampah mindmap — snapshot, pulihkan id sama, purge 30 hari" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013t2wBZvFmWiPG5XEYKL44H"
  ```

### Task A3: pencarian teks node + `client_id` + ekspor mindmap (backend, #7 & #6)

**Files:**
- Modify: `webapp.py` — migrasi kolom + backfill di `migrate_db()` (setelah blok A1); `create_mindmap` & `update_mindmap` (isi `search_text`); `global_search` (~7322); `export_user_data` (~5412, setelah bagian Habits); `schema-db.md`
- Test: `tests/test_mindmap_search_export.py` (baru)

**Interfaces:**
- Produces: kolom `mindmaps.search_text TEXT` (NULL = belum dihitung); `_mindmap_search_text(data_json) -> str` = `"\n".join(_mindmap_topics(data_json))[:1_000_000]`; `_mindmap_match_snippet(search_text: str, q: str, length: int = 80) -> str`; `_mindmap_outline_md(data: dict) -> str`.
- Produces: `/api/search` → `mindmaps: [{id, title, updated_at, client_id, snippet}]`; `tasks[*].client_id`, `notes[*].client_id`.
- Produces: ZIP export `mindmaps/<judul>.json` (+ `.md` untuk peta biasa), format spec §6.
- Consumes: `_mindmap_topics`, `_mindmap_plain` (A2).

- [ ] **Step 1: Write the failing tests** (`tests/test_mindmap_search_export.py`; salin `U` dan `_shared` dari A2)

```python
"""Temuan mindmap #7 (pencarian) dan #6 (ekspor)."""
import io
import json
import zipfile

import webapp
from conftest import db

DATA = json.dumps({"nodeData": {"id": "root", "topic": "Akar", "root": True, "children": [
    {"id": "n1", "topic": "Strategi **pemasaran** organik", "children": [
        {"id": "n2", "topic": "Anak", "children": []}]}]}})


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
```
(Kelas `U` dari A2 sudah punya `put`/`delete`; tambahkan `import os`, `from conftest import register_user` dan `from repository import TaskRepository` untuk `U`/`_shared`.)

- [ ] **Step 2: Run** `python -m pytest tests/test_mindmap_search_export.py -q` — Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Migrasi: `ALTER TABLE mindmaps ADD COLUMN search_text TEXT` bila belum ada; backfill loop: `SELECT id, data_json, source_note_id FROM mindmaps WHERE search_text IS NULL LIMIT 200` → `UPDATE … SET search_text = ?` (`""` untuk tertaut) sampai habis; commit per batch.
  - `create_mindmap`: jalur biasa menyertakan `search_text = _mindmap_search_text(req.data_json)` di INSERT; jalur tertaut `""`. `update_mindmap`: bila `req.data_json is not None` → `search_text` = `""` (tertaut) atau `_mindmap_search_text(new_data)` di UPDATE yang sama.
  - `_mindmap_match_snippet(text, q, length=80)`: `ql = q.casefold()`; baris pertama `line` dengan `ql in line.casefold()` → bila `len(line) <= length` kembalikan `line`; selain itu `i = line.casefold().index(ql)`; `start = max(0, min(i - (length - len(q)) // 2, len(line) - length))`; `out = line[start:start+length]`; tambah "…" di depan bila `start > 0`, di belakang bila `start + length < len(line)`. Tidak ada → `""`.
  - `global_search`: task `SELECT id, title, priority, gtd_status, deadline, quadrant, client_id`; note `SELECT id, title, content, updated_at, client_id`; mindmap `SELECT id, title, updated_at, client_id, search_text … WHERE {mm_ac} AND (title LIKE ? OR search_text LIKE ?)`; keluaran mindmap `{"id","title","updated_at","client_id","snippet": _mindmap_match_snippet(r["search_text"] or "", q)}`.
  - `_mindmap_outline_md(data)`: `root = data["nodeData"]`; `lines = ["# " + (_mindmap_plain(root.get("topic")) or "Tanpa judul"), ""]`; DFS anak root dengan kedalaman `d` (anak root = 1): `"  " * (d - 1) + "- " + _mindmap_plain(topic)`; kembalikan `"\n".join(lines) + "\n"`; root tanpa anak → `"# Akar\n"` (tanpa baris kosong ganda: bila tidak ada anak, `lines = ["# …"]`).
  - Ekspor: setelah Habits, `SELECT m.*, n.title AS source_note_title FROM mindmaps m LEFT JOIN scratchpad_notes n ON n.id = m.source_note_id WHERE m.user_id = ? ORDER BY m.id`; `used_mm: dict[str,int]` sendiri; `base` = `_sanitize(title, id)` + akhiran ` (k)` untuk duplikat; peta biasa → `.json` (`{"title","created_at","updated_at","workspace_id": list_id, "data": parsed}` atau `"data_json": raw` bila JSON rusak) + `.md` (`_mindmap_outline_md`, hanya bila parse sukses dan ada `nodeData`); tertaut → `.json` `{"title","created_at","updated_at","linked": True, "source_note_id", "source_note_title", "view_state": parsed}`. `json.dumps(..., ensure_ascii=False, indent=2)`.
  - `schema-db.md`: kolom `search_text`.
- [ ] **Step 4: Run** `python -m pytest tests/ -q` — Expected: PASS (semua).
- [ ] **Step 5: Commit**
  ```
  git add webapp.py schema-db.md tests/test_mindmap_search_export.py
  git commit -m "feat(mindmap): cari teks node + snippet + client_id, ekspor mindmap" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013t2wBZvFmWiPG5XEYKL44H"
  ```

### Task A4: Sampah offline — cermin, rute lokal, pulihkan lokal

**Files:**
- Create: `static/offline/mindmaptrash.js`
- Modify: `static/offline/mindmaprepo.js` (`deleteMindmap`, `restoreLocal` baru, ekspor), `static/offline/mindmaproutes.js` (rute trash, `client_id` di `meta`), `static/offline/taskroutes.js` (`isMindmapTrashDelete` di `shouldRouteLocally`, ~75–100)
- Test: `tests/offline/mindmaptrash.test.js` (baru)

**Interfaces:**
- Produces `TF.mindmaptrash` (UMD, pola `notetrash.js`, require `./db.js`, `./meta.js`, `./outbox.js`, `./mindmaprepo.js`, `./mindmapoutline.js` malas):
  - Konstanta teks spec §5 (`CONFIRM_MOVE`, `TOAST_MOVED`, `TOAST_RESTORED`, `TOAST_RESTORE_QUEUED`, `CONFIRM_PURGE`, `CONFIRM_EMPTY`, `SOURCE_MISSING_MSG`, `PURGE_OFFLINE_MSG`, `PENDING_LABEL`), `META_KEY = "mindmapTrash:v1"`.
  - `previewOf(data_json: string) → string` (≤ 3 topic pertama setelah root, teks polos lewat regex sama dengan `_mindmap_plain`, " · ").
  - `readMirror() → Promise<{items: Item[], restoring: number[], errors: {[sid]: string}}>` (kosong bila belum ada).
  - `writeMirror(items: Item[]) → Promise<void>` — ganti `items`; `restoring`/`errors` hanya dipertahankan untuk sid yang masih ada di `items`.
  - `markRestoreResult(sid: number, outcome: "ok"|"gone"|"source_note_missing"|"failed") → Promise<void>` — `ok`/`gone`: buang item + sid dari `restoring`/`errors`; lainnya: buang dari `restoring`, `errors[sid] = outcome`.
  - `listTrash() → Promise<Array<{id, cid, title, preview, list_id, linked, deleted_at, days_left, pending, error}>>` (spec §5; `error` = `errors[sid]`; terbaru dulu — bandingkan `Date.parse(deleted_at)`, bukan string, karena formatnya campur `Z`/`+07:00`; record lokal menang atas item cermin dengan sid sama).
  - `restore(idOrCid: string|number) → Promise<{restored: "local", cid} | {restored: "queued", id}>`; tidak ditemukan → reject `Error("Mindmap tidak ada di Sampah")` dengan `.status = 404`.
- Produces `mindmaprepo.deleteMindmap(cid, opts?)` menyimpan `trashed_at = opts.now || ISO sekarang` dan `dirty_before_delete = cur.dirty || 0`; `mindmaprepo.restoreLocal(cid) → Promise<record>` (satu transaksi `mindmaps` + `_outbox`: `deleted:false`, hapus `trashed_at`, `dirty = dirty_before_delete`, hapus `dirty_before_delete`, `rev+1`; buang op `delete` untuk cid; bila `dirty` dan `server_id != null` → pastikan satu op `update`; bila `server_id == null` dan tidak ada op `create` → tambah op `create`).
- Produces rute lokal `GET /api/mindmaps/trash`, `POST /api/mindmaps/trash/:id/restore`; `taskroutes.isMindmapTrashDelete(method, path)`; `shouldRouteLocally` → `false` untuk `DELETE /api/mindmaps/trash` dan `/api/mindmaps/trash/*`.
- Produces: `meta(rec)` di mindmaproutes menyertakan `client_id` (A6/A8 memakainya).
- Consumes: `TFmeta.metaGet/metaSet`, `TFoutbox.outboxAdd/outboxByEntity/outboxRemove`.

- [ ] **Step 1: Write the failing tests** (`tests/offline/mindmaptrash.test.js`)

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const { buildTaskRouter, shouldRouteLocally } = require("../../static/offline/taskroutes.js");
const mm = require("../../static/offline/mindmaprepo.js");
const T = require("../../static/offline/mindmaptrash.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); mm.setCurrentUser(null); });

async function put(store, recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    for (const r of recs) tx.objectStore(store).put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function get(store, key) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction(store).objectStore(store).get(key); q.onsuccess = () => res(q.result); });
}
const item = (over) => Object.assign({ id: 5, title: "Srv", preview: "a", list_id: null, source_note_id: null, linked: false,
  client_id: "c5", deleted_at: "2026-10-18T10:00:00+07:00", days_left: 29 }, over);
const DATA = JSON.stringify({ nodeData: { id: "root", topic: "R", root: true, children: [
  { id: "a", topic: "**Satu**", children: [] }, { id: "b", topic: "Dua", children: [] }] } });

test("previewOf: three topics after root, plain text", () => {
  assert.equal(T.previewOf(DATA), "Satu · Dua");
  assert.equal(T.previewOf("bukan json"), "");
});

test("listTrash merges mirror + pending local deletes, newest first", async () => {
  await T.writeMirror([item()]);
  const r = await mm.createMindmap({ title: "Lokal", data_json: DATA }, { now: "2026-10-19T00:00:00Z" });
  await mm.deleteMindmap(r.cid, { now: "2026-10-19T01:00:00Z" });
  const list = await T.listTrash();
  assert.deepEqual(list.map((i) => [i.title, i.pending]), [["Lokal", true], ["Srv", false]]);
  assert.equal(list[0].cid, r.cid);
  assert.equal(list[0].preview, "Satu · Dua");
});

test("restore of a pending local delete un-deletes, restores dirty flag and drops the delete op", async () => {
  await put("mindmaps", [{ cid: "m1", server_id: 9, title: "M", data_json: DATA, deleted: false, dirty: 0, rev: 1, base_rev: "t" }]);
  await mm.deleteMindmap("m1", { now: "2026-10-19T01:00:00Z" });
  assert.equal((await get("mindmaps", "m1")).trashed_at, "2026-10-19T01:00:00Z");
  const res = await T.restore("m1");
  assert.deepEqual(res, { restored: "local", cid: "m1" });
  const rec = await get("mindmaps", "m1");
  assert.equal(rec.deleted, false); assert.equal(rec.dirty, 0); assert.equal(rec.trashed_at, undefined);
  assert.deepEqual((await outboxAll()).filter((o) => o.cid === "m1"), []);
});

test("restore of a mirror item queues one restore op and hides the item", async () => {
  await T.writeMirror([item()]);
  assert.deepEqual(await T.restore("5"), { restored: "queued", id: 5 });
  const ops = (await outboxAll()).filter((o) => o.op === "restore");
  assert.deepEqual(ops.map((o) => [o.entity_type, o.cid, o.payload.server_id]), [["mindmap", "trash:5", 5]]);
  assert.deepEqual(await T.listTrash(), []);
  assert.deepEqual((await T.readMirror()).restoring, [5]);
  await assert.rejects(T.restore("777"), (e) => e.status === 404);
});

test("writeMirror drops restoring/errors for sids no longer on the server; markRestoreResult", async () => {
  await T.writeMirror([item(), item({ id: 6, client_id: "c6" })]);
  await T.restore("5"); await T.restore("6");
  await T.markRestoreResult(6, "source_note_missing");
  await T.writeMirror([item({ id: 6, client_id: "c6" })]);
  const m = await T.readMirror();
  assert.deepEqual(m.restoring, []); assert.deepEqual(m.errors, { 6: "source_note_missing" });
  assert.equal((await T.listTrash())[0].error, "source_note_missing");
});

test("local routes serve trash; DELETE trash goes to the network", async () => {
  await T.writeMirror([item()]);
  const router = buildTaskRouter();
  assert.equal((await router.dispatch("GET", "/api/mindmaps/trash")).length, 1);
  assert.equal((await router.dispatch("POST", "/api/mindmaps/trash/5/restore", {})).restored, "queued");
  assert.equal(shouldRouteLocally(router, "GET", "/api/mindmaps/trash"), true);
  assert.equal(shouldRouteLocally(router, "DELETE", "/api/mindmaps/trash"), false);
  assert.equal(shouldRouteLocally(router, "DELETE", "/api/mindmaps/trash/5"), false);
  assert.equal(shouldRouteLocally(router, "DELETE", "/api/mindmaps/5"), true);
});
```

- [ ] **Step 2: Run** `node --test tests/offline/mindmaptrash.test.js` — Expected: FAIL (`Cannot find module`).
- [ ] **Step 3: Implement** sesuai Interfaces. Catatan:
  - Pending lokal = record `deleted && trashed_at` dan (`server_id == null` atau ada op `delete` di outbox untuk cid). `id` item pending = `server_id ?? cid`, `days_left: 30`, `deleted_at = trashed_at`.
  - `restore(idOrCid)`: cari record lokal pending dengan `cid === String(idOrCid)` atau `String(server_id) === String(idOrCid)` → `mm.restoreLocal(cid)`; selain itu item cermin dengan `String(id) === String(idOrCid)` (tidak sedang `restoring`) → tambah sid ke `restoring` (`metaSet`) lalu `outboxAdd({op:"restore", entity_type:"mindmap", cid:"trash:"+sid, payload:{server_id: Number(sid)}})`.
  - Rute di `registerMindmapRoutes` (spesifisitas router membuat segmen statis `trash` menang atas `:id`).
  - Ekspor juga `module.exports` untuk node; daftarkan `root.TF.mindmaptrash`.
- [ ] **Step 4: Run** `node --test tests/offline/mindmaptrash.test.js tests/offline/mindmaprepo.test.js tests/offline/mindmaproutes.test.js tests/offline/mindmap_cas_conflict.test.js` — Expected: PASS.
- [ ] **Step 5: Commit**
  ```
  git add static/offline/mindmaptrash.js static/offline/mindmaprepo.js static/offline/mindmaproutes.js static/offline/taskroutes.js tests/offline/mindmaptrash.test.js
  git commit -m "feat(mindmap): Sampah offline — cermin, rute lokal, pulihkan lokal" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013t2wBZvFmWiPG5XEYKL44H"
  ```

### Task A5: push/pull Sampah + push pin eksplisit

**Files:**
- Modify: `static/offline/syncpush.js` (`opMindmapRestore` baru dekat `opMindmapDelete` ~1322; dispatch ~1481–1484; `opMindmapPin` ~1344), `static/offline/syncpull.js` (`pullMindmapTrash` baru dekat `pullMindmapsAndReconcile` ~1078; dipanggil di dalamnya; ekspor)
- Test: `tests/offline/mindmaptrash_sync.test.js` (baru)

**Interfaces:**
- Produces: `syncpull.pullMindmapTrash(rawFetch) → Promise<{mirrored: boolean}>` — GET `/api/mindmaps/trash`; 2xx → `TF.mindmaptrash.writeMirror(rows)`; selain itu/throw → `{mirrored:false}` tanpa mengubah cermin. `pullMindmapsAndReconcile` memanggilnya setelah `pullMindmaps` (dibungkus `.catch(() => null)`, hasil pull tetap dikembalikan).
- Produces: op outbox `restore` diproses `opMindmapRestore(op, transport, result)`; `PATCH /pin` dari push membawa body `{pinned: !!rec.pinned}`.
- Consumes: A4 (`markRestoreResult`, cermin), `TFmm.recordFromServer`, `TFidmap.mapPut`, `notifyMindmapSynced`.

- [ ] **Step 1: Write the failing tests** (`tests/offline/mindmaptrash_sync.test.js`; salin `put`/`get`/`item` dari A4)

```js
const { mapPut, cidOf } = require("../../static/offline/idmap.js");
const { pushOutbox } = require("../../static/offline/syncpush.js");
const { pullMindmapTrash } = require("../../static/offline/syncpull.js");

function transport(handler) {
  const calls = [];
  return { calls, request(method, path, body) { calls.push({ method, path, body }); return Promise.resolve(handler(method, path, body)); } };
}
const srv = (over) => Object.assign({ id: 5, title: "Srv", data_json: "{\"nodeData\":{\"id\":\"root\",\"topic\":\"Srv\",\"root\":true,\"children\":[]}}",
  is_pinned: 0, list_id: null, user_id: 1, client_id: "c5", created_at: "t0", updated_at: "t1" }, over);

test("push restore op: ok → record recreated with cid = client_id, idmap, mirror cleared", async () => {
  await T.writeMirror([item()]);
  await T.restore("5");
  const tr = transport((m, p) => (m === "POST" && p === "/api/mindmaps/trash/5/restore") ? { status: 200, data: srv() } : { status: 404, data: {} });
  await pushOutbox(tr);
  const rec = await get("mindmaps", "c5");
  assert.equal(rec.server_id, 5); assert.equal(rec.dirty, 0); assert.equal(rec.deleted, false);
  assert.equal(await cidOf("mindmap", 5), "c5");
  const m = await T.readMirror();
  assert.deepEqual([m.items, m.restoring], [[], []]);
  assert.deepEqual(await outboxAll(), []);
});

test("push restore 409 SOURCE_NOTE_MISSING → error in mirror, op dropped; 404 → item removed", async () => {
  await T.writeMirror([item(), item({ id: 6, client_id: "c6" })]);
  await T.restore("5"); await T.restore("6");
  const tr = transport((m, p) => p.endsWith("/5/restore")
    ? { status: 409, data: { detail: { code: "SOURCE_NOTE_MISSING" } } } : { status: 404, data: { detail: "x" } });
  await pushOutbox(tr);
  const m = await T.readMirror();
  assert.deepEqual(m.items.map((i) => i.id), [5]);
  assert.deepEqual(m.errors, { 5: "source_note_missing" });
  assert.deepEqual(await outboxAll(), []);
});

test("push restore 503 keeps the op", async () => {
  await T.writeMirror([item()]);
  await T.restore("5");
  await pushOutbox(transport(() => ({ status: 503, data: {} })));
  assert.equal((await outboxAll()).length, 1);
});

test("pullMindmapTrash mirrors the server list; failure keeps the old mirror", async () => {
  await T.writeMirror([item({ id: 1 })]);
  const ok = (rows) => () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(rows) });
  assert.deepEqual(await pullMindmapTrash(() => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) })), { mirrored: false });
  assert.deepEqual((await T.readMirror()).items.map((i) => i.id), [1]);
  assert.deepEqual(await pullMindmapTrash(ok([item({ id: 2 })])), { mirrored: true });
  assert.deepEqual((await T.readMirror()).items.map((i) => i.id), [2]);
});

test("push pin sends explicit body", async () => {
  await put("mindmaps", [{ cid: "p", server_id: 8, title: "P", data_json: "{}", pinned: true, deleted: false, dirty: 0, rev: 1 }]);
  await mapPut("mindmap", 8, "p");
  await put("_outbox", [{ qid: 1, op: "pin", entity_type: "mindmap", cid: "p", payload: { pinned: true } }]);
  const tr = transport((m) => (m === "GET" ? { status: 200, data: { id: 8, is_pinned: 0 } } : { status: 200, data: { id: 8, is_pinned: 1 } }));
  await pushOutbox(tr);
  const patch = tr.calls.find((c) => c.method === "PATCH");
  assert.equal(patch.path, "/api/mindmaps/8/pin");
  assert.deepEqual(patch.body, { pinned: true });
});
```

- [ ] **Step 2: Run** `node --test tests/offline/mindmaptrash_sync.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `opMindmapRestore`: `sid = op.payload && op.payload.server_id`; tanpa sid → `outboxRemove`. `send(transport, "POST", "/api/mindmaps/trash/" + sid + "/restore", {})` (`send` sudah melempar untuk 401/429/5xx/jaringan → op tetap). `ok(res)` → `row = res.data`; `cid = row.client_id || TFids.newCid()`; `TFdb.mutate("mindmaps", cid, () => Object.assign(TFmm.recordFromServer(row, cid), { rev: 1 }))` → `TFidmap.mapPut("mindmap", row.id, cid)` → `TF.mindmaptrash.markRestoreResult(sid, "ok")` → `outboxRemove` → `notifyMindmapSynced([cid], [row.id])` → `result.pushed++`. `res.status === 404` → `markRestoreResult(sid, "gone")`, `outboxRemove`, `result.failed++`. 409 dengan `detail.code === "SOURCE_NOTE_MISSING"` → `"source_note_missing"`; 4xx lain → `"failed"`; keduanya `outboxRemove`, `result.failed++`. Restore yang mengembalikan peta tertaut lain (`row.id !== sid`) diperlakukan sama (record dari baris server).
  - Dispatch: `if (op.entity_type === "mindmap" && op.op === "restore") return opMindmapRestore(op, transport, result);`. Pastikan op `restore` (cid `trash:<sid>`) tidak ikut logika `pendingCreateCids`/induk (cek ~1456).
  - `opMindmapPin`: `send(transport, "PATCH", "/api/mindmaps/" + sid + "/pin", { pinned: !!rec.pinned })` (cek GET dipertahankan).
  - `pullMindmapTrash(rawFetch)`: `Promise.resolve(rawFetch("/api/mindmaps/trash")).then(listJsonOrThrow).then((rows) => trash().writeMirror(Array.isArray(rows) ? rows : []).then(() => ({ mirrored: true }))).catch(() => ({ mirrored: false }))` dengan `trash = () => req("./mindmaptrash.js", root.TF && root.TF.mindmaptrash)` malas.
- [ ] **Step 4: Run** `npm test` — Expected: PASS kecuali `draw_local_reactive` (pra-ada). Perbarui tes lama yang memeriksa PATCH pin tanpa body bila ada.
- [ ] **Step 5: Commit**
  ```
  git add static/offline/syncpush.js static/offline/syncpull.js tests/offline/mindmaptrash_sync.test.js
  git commit -m "feat(mindmap): sinkron Sampah (op restore, cermin) + push pin eksplisit" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013t2wBZvFmWiPG5XEYKL44H"
  ```

### Task A6: `mindmaplinks.js` + helper picker/sidebar

**Files:**
- Create: `static/offline/mindmaplinks.js`
- Modify: `static/offline/mindmapoutline.js` (`localLinkSearch` meneruskan `client_id`; `filterExistingTargets` baru; ekspor), `static/offline/mindmaptabs.js` (`filterSidebar` baru; ekspor)
- Test: `tests/offline/mindmaplinks.test.js` (baru)

**Interfaces:**
- Produces `TF.mindmaplinks`: `linkKey(link)`, `collectLinkRefs(nodeData)`, `resolveLinkInfo(refs, get)`, `linkDisplay(link, info)`, `STATUS_LABEL`, `UNAVAILABLE_TITLE = "Data terbaru tidak tersedia di perangkat ini"` (perilaku spec §3).
- Produces `mindmapoutline.filterExistingTargets(results, existingLinks) → {notes, tasks, mindmaps}` (buang hasil yang `type-id` atau `type-client_id`-nya ada di link node).
- Produces `mindmaptabs.filterSidebar(list, {q, filter}) → list` (`q` judul tanpa beda huruf; `filter`: `null` semua, `"personal"` → `list_id == null`, angka/string → `String(m.list_id) === String(filter)`).
- Consumes: `api.get` induk (lokal-first) di A7.

- [ ] **Step 1: Write the failing tests**

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const L = require("../../static/offline/mindmaplinks.js");
const MO = require("../../static/offline/mindmapoutline.js");
const MT = require("../../static/offline/mindmaptabs.js");

const tree = { id: "root", topic: "R", children: [
  { id: "a", topic: "A", links: [{ type: "task", id: "u-1", title: "Lama", priority: "P3" }, { type: "note", id: 7, title: "N" }], children: [
    { id: "b", topic: "B", links: [{ type: "task", id: "u-1", title: "Lama" }, { type: "mindmap", id: "m9", title: "Peta" }] }] }] };

test("collectLinkRefs is unique per type:id", () => {
  assert.deepEqual(L.collectLinkRefs(tree).map(L.linkKey), ["task:u-1", "note:7", "mindmap:m9"]);
});

test("resolveLinkInfo reads local routes; failures → null", async () => {
  const get = (url) => {
    if (url === "/api/tasks/u-1") return Promise.resolve({ id: 3, title: "Baru", priority: "P1", deadline: "2026-10-20T00:00:00", gtd_status: "done" });
    if (url === "/api/scratchpad/7") return Promise.resolve({ id: 7, title: "Catatan", content: "  isi panjang " + "x".repeat(100) });
    return Promise.reject(new Error("Mindmap not found"));
  };
  const info = await L.resolveLinkInfo(L.collectLinkRefs(tree), get);
  assert.deepEqual(info["task:u-1"], { type: "task", title: "Baru", priority: "P1", deadline: "2026-10-20T00:00:00", status: "done", done: true });
  assert.equal(info["note:7"].title, "Catatan");
  assert.ok(info["note:7"].preview.endsWith("…") && info["note:7"].preview.length <= 81);
  assert.equal(info["mindmap:m9"], null);
});

test("linkDisplay: live info wins, snapshot fallback is marked not live", () => {
  const link = { type: "task", id: "u-1", title: "Lama", priority: "P3", deadline: "2026-10-01", status: "next" };
  assert.deepEqual(L.linkDisplay(link, { type: "task", title: "Baru", priority: "P1", deadline: "2026-10-20T00:00:00", status: "done", done: true }),
    { title: "Baru", meta: "P1 · Due 2026-10-20 · Selesai", live: true, done: true });
  assert.deepEqual(L.linkDisplay(link, null), { title: "Lama", meta: "P3 · Due 2026-10-01 · Next", live: false, done: false });
  assert.deepEqual(L.linkDisplay({ type: "mindmap", id: 1, title: "" }, null), { title: "(tanpa judul)", meta: "", live: false, done: false });
});

test("filterExistingTargets matches id or client_id", () => {
  const res = { notes: [{ id: 7, client_id: "n-7" }, { id: 8 }], tasks: [{ id: 3, client_id: "u-1" }], mindmaps: [{ id: 9, client_id: "m9" }] };
  const out = MO.filterExistingTargets(res, [{ type: "note", id: 7 }, { type: "task", id: "u-1" }, { type: "mindmap", id: "m9" }]);
  assert.deepEqual([out.notes.map((n) => n.id), out.tasks, out.mindmaps], [[8], [], []]);
});

test("localLinkSearch passes client_id through", () => {
  const out = MO.localLinkSearch("peta", { mindmaps: [{ id: 1, title: "Peta A", client_id: "c1" }] });
  assert.equal(out.mindmaps[0].client_id, "c1");
});

test("filterSidebar: title query + workspace filter", () => {
  const list = [{ id: 1, title: "Pribadi A", list_id: null }, { id: 2, title: "Tim A", list_id: 4 }, { id: 3, title: "Tim B", list_id: 5 }];
  assert.deepEqual(MT.filterSidebar(list, { q: "", filter: null }).map((m) => m.id), [1, 2, 3]);
  assert.deepEqual(MT.filterSidebar(list, { q: "", filter: "personal" }).map((m) => m.id), [1]);
  assert.deepEqual(MT.filterSidebar(list, { q: "a", filter: "4" }).map((m) => m.id), [2]);
  assert.deepEqual(MT.filterSidebar(list, { q: "TIM", filter: null }).map((m) => m.id), [2, 3]);
});
```

- [ ] **Step 2: Run** `node --test tests/offline/mindmaplinks.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement.** `mindmaplinks.js` UMD tanpa dependensi (iframe memuatnya). `resolveLinkInfo`: `Promise.all` per ref; URL `"/api/tasks/" + encodeURIComponent(id)`, `"/api/scratchpad/" + …`, `"/api/mindmaps/" + …`; respons tanpa objek → `null`. Objek Info memuat **tepat** key berikut (tanpa key bernilai `undefined`, tes memakai `deepStrictEqual`): task `{type, title, priority, deadline, status, done}`, catatan `{type, title, preview}`, mindmap `{type, title}`; nilai kosong → `null` (mis. `deadline: null`). Preview catatan = `snippet(content, 80)` (trim, potong + "…", sama dengan `mindmapoutline.snippet`). Task `done = status === "done" || status === "archived"`. `linkDisplay` untuk catatan: `meta = live ? info.preview || "" : link.preview || ""`; task meta kosong → `"—"`; deadline dipotong `slice(0, 10)`.
- [ ] **Step 4: Run** `node --test tests/offline/mindmaplinks.test.js tests/offline/mindmapoutline.test.js tests/offline/mindmaptabs.test.js` — Expected: PASS.
- [ ] **Step 5: Commit**
  ```
  git add static/offline/mindmaplinks.js static/offline/mindmapoutline.js static/offline/mindmaptabs.js tests/offline/mindmaplinks.test.js
  git commit -m "feat(mindmap): resolver kartu link hidup + helper picker & sidebar" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013t2wBZvFmWiPG5XEYKL44H"
  ```

### Task A7: kartu link hidup di kanvas & Outline (#3 UI)

**Files:**
- Modify: `static/vendor/mind-elixir/index.html` (tag script ~474–479; `renderPanel` ~609; `showNodeLinksPopover` ~717; `updateBadges` ~797; handler `message` ~1278; CSS `.lp-stale`), `static/index.html` (`MindmapTabInstance` ~9775: state `linkInfo`, efek resolve, `ready` handler ~10395, prop ke `MindmapOutline`; `MindmapOutline` ~9129 prop `linkInfo`, popover link ~9684 dan tooltip chip ~9478)
- Test: `tests/offline/mindmap_live_links_ui.test.js` (baru)

**Interfaces:**
- Produces pesan induk→iframe `{type:"linkInfo", info: {[key]: Info|null}}`.
- Consumes: `TF.mindmaplinks` (A6).

- [ ] **Step 1: Write the failing tests**

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const iframe = fs.readFileSync(path.join(__dirname, "../../static/vendor/mind-elixir/index.html"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");
function slice(src, a, b) {
  const s = src.indexOf(a); assert.ok(s !== -1, a + " harus ada");
  const e = src.indexOf(b, s + a.length); assert.ok(e !== -1, b + " harus ada setelah " + a);
  return src.slice(s, e);
}

test("iframe loads mindmaplinks.js and renders cards through linkDisplay", () => {
  assert.match(iframe, /<script src="\/static\/offline\/mindmaplinks\.js\?v=\d+"><\/script>/);
  assert.match(slice(iframe, "function renderPanel(", "function removeLinkAtIndex"), /mindmaplinks\.linkDisplay\(/);
  assert.match(slice(iframe, "function showNodeLinksPopover(", "function updateBadges"), /mindmaplinks\.linkDisplay\(/);
  assert.match(iframe, /\.lp-stale\s*\{/);
  assert.match(slice(iframe, "e.data.type === 'linkInfo'", "\n      }"), /liveLinkInfo = /);
});

test("MindmapTabInstance resolves link info from local data and posts it", () => {
  const t = slice(html, "function MindmapTabInstance(", "\nconst MINDMAP_DIRECTIONS");
  assert.match(t, /mindmaplinks\.resolveLinkInfo\(/);
  assert.match(t, /type: "linkInfo"/);
  for (const ev of ["taskSaved", "taskUpdated", "noteSaved", "mindmapSaved", "mindmapSynced"]) {
    assert.match(t, new RegExp('addEventListener\\("' + ev + '", refreshLinkInfo'));
  }
  assert.match(t, /linkInfo: linkInfo/);
});

test("MindmapOutline renders link titles via linkDisplay", () => {
  const o = slice(html, "function MindmapOutline(", "\nfunction MindmapTabInstance(");
  assert.match(o, /linkInfo = \{\}/);
  assert.match(o, /mindmaplinks\.linkDisplay\(/);
});
```

- [ ] **Step 2: Run** `node --test tests/offline/mindmap_live_links_ui.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Iframe: tambah `<script src="/static/offline/mindmaplinks.js?v=1"></script>` setelah `mindmapoutline.js`. `let liveLinkInfo = {};` Di `renderPanel`, `showNodeLinksPopover`, dan tooltip `updateBadges`, hitung per link `const ML = window.TF && window.TF.mindmaplinks; const d = ML ? window.TF.mindmaplinks.linkDisplay(link, liveLinkInfo[ML.linkKey(link)]) : { title: link.title || '', meta: link.preview || '', live: false, done: false };` (tes mencari literal `mindmaplinks.linkDisplay(` di dalam `renderPanel` dan `showNodeLinksPopover`). Kartu: `title.textContent = d.title`, `preview.textContent = d.meta || (link.type === 'task' ? '—' : '')`, bila `!d.live` → `card.classList.add('lp-stale'); card.title = ML().UNAVAILABLE_TITLE`, bila `d.done` → `title.style.textDecoration = 'line-through'`. CSS `.lp-stale { opacity: .7; }` (tanpa border-left). Handler: `if (e.data && e.data.type === 'linkInfo') { liveLinkInfo = e.data.info || {}; if (currentNodeData && document.getElementById('link-panel').style.display === 'block') renderPanel(currentNodeData.topic, currentNodeData.links || []); if (activePopover && activeBadgeNodeId) { /* render ulang popover untuk node itu */ } updateBadges(); return; }`.
  - Induk (`MindmapTabInstance`, hanya `!isLinked`): `const [linkInfo, setLinkInfo] = useState({}); const linkInfoRef = useRef({}); const linkTimerRef = useRef(null);` `const refreshLinkInfo = () => { clearTimeout(linkTimerRef.current); linkTimerRef.current = setTimeout(() => { const ML = window.TF && window.TF.mindmaplinks; const tree = outlineTreeRef.current; if (!ML || !tree || !tree.nodeData) return; ML.resolveLinkInfo(ML.collectLinkRefs(tree.nodeData), api.get).then(info => { linkInfoRef.current = info; setLinkInfo(info); iframeRef.current?.contentWindow?.postMessage({ type: "linkInfo", info }, window.location.origin); }).catch(() => {}); }, 300); };` Efek: jalankan saat `[tab?.id, refsSignature]` berubah (`refsSignature = ML ? ML.collectLinkRefs(outlineTree?.nodeData || null).map(ML.linkKey).join("|") : ""`, `collectLinkRefs(null)` → `[]`), dan daftarkan lima listener sebagai **lima panggilan literal** `window.addEventListener("taskSaved", refreshLinkInfo)`, … `("taskUpdated", …)`, `("noteSaved", …)`, `("mindmapSaved", …)`, `("mindmapSynced", …)` (bukan loop — tes mencari teks literal; bersihkan di cleanup). Saat iframe mengirim `ready`, kirim ulang `linkInfoRef.current`. Teruskan `linkInfo: linkInfo` ke `MindmapOutline`.
  - `MindmapOutline({…, linkInfo = {}})`: popover link memakai `const d = window.TF.mindmaplinks.linkDisplay(l, linkInfo[window.TF.mindmaplinks.linkKey(l)])` (guard bila modul tidak ada → `l.title`) untuk judul, coret bila `d.done`, `opacity: 0.7` + `title` UNAVAILABLE_TITLE bila `!d.live`; tooltip chip memakai `d.title`.
- [ ] **Step 4: Run** `node --test tests/offline/mindmap_live_links_ui.test.js tests/offline/mindmap_canvas_linkpicker.test.js` dan `node temporary_files/check_inline_scripts.js static/vendor/mind-elixir/index.html` + `… static/index.html` — Expected: PASS/OK.
- [ ] **Step 5: Commit**
  ```
  git add static/vendor/mind-elixir/index.html static/index.html tests/offline/mindmap_live_links_ui.test.js
  git commit -m "feat(mindmap): kartu link node menampilkan data hidup dari lokal" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013t2wBZvFmWiPG5XEYKL44H"
  ```

### Task A8: UI Sampah, pin anggota, penanda bersama, filter, snippet, picker

**Files:**
- Modify: `static/index.html` — `NoteTrashModal` (~27472: prop `initialKind`, tab "Catatan"|"Mindmap") + komponen baru `MindmapTrashList` (letakkan tepat sebelum `function NoteTrashModal(`); `MindmapListItem` (~8726: prop `sharedName`); `MindmapPage` (~10724: filter, tombol "🗑 Sampah", `trashOpen`, `filterSidebar`, `handleDeleteMindmap` toast); `MindmapTabInstance` (~10474 `handleDelete`, ~10610 tombol Hapus: label "Pindahkan ke Sampah?", sembunyikan untuk non-pemilik peta biasa); `LinkPickerModal` (~8819 `existingSet` → `filterExistingTargets`); hasil mindmap pencarian global (~30466: baris `snippet`); `MindmapTabInstance` `onRestored` NoteTrashModal (~10701) tetap jalan untuk tab Catatan
- Test: `tests/offline/mindmap_trash_ui.test.js` (baru)

**Interfaces:**
- Produces: `function MindmapTrashList({ showToast, onRestored })`; `NoteTrashModal({ onClose, onRestored, showToast, initialKind = "note", onMindmapRestored })`.
- Consumes: `TF.mindmaptrash` (A4), `TF.syncpull.pullMindmapTrash` (A5), `window.__pushNow`, `window.__syncRawFetch`, `TF.mindmaptabs.filterSidebar`, `TF.mindmapoutline.filterExistingTargets` (A6), `snippet` dari `/api/search` (A3).

- [ ] **Step 1: Write the failing tests** (`tests/offline/mindmap_trash_ui.test.js`; salin `slice` dari A7)

```js
test("NoteTrashModal has Catatan/Mindmap tabs; MindmapTrashList uses TF.mindmaptrash", () => {
  const m = slice(html, "function NoteTrashModal(", "\nfunction ");
  assert.match(m, /initialKind = "note"/);
  assert.match(m, /"Catatan"/); assert.match(m, /"Mindmap"/);
  assert.match(m, /MindmapTrashList/);
  const l = slice(html, "function MindmapTrashList(", "\nfunction ");
  assert.match(l, /api\.get\("\/api\/mindmaps\/trash"\)/);
  assert.match(l, /pullMindmapTrash\(/);
  assert.match(l, /\/api\/mindmaps\/trash\/\$\{/);
  assert.match(l, /PURGE_OFFLINE_MSG/);
  assert.match(l, /SOURCE_MISSING_MSG/);
  assert.match(l, /PENDING_LABEL/);
});

test("MindmapPage: Sampah button, workspace filter via filterSidebar, shared badge", () => {
  const p = slice(html, "function MindmapPage(", "\nfunction ");
  assert.match(p, /"🗑 Sampah"/);
  assert.match(p, /initialKind: "mindmap"/);
  assert.match(p, /filterSidebar\(/);
  assert.match(p, /tf_mindmap_filter/);
  assert.match(p, /"Semua peta"/); assert.match(p, /"Pribadi"/);
  const li = slice(html, "function MindmapListItem(", "\nfunction ");
  assert.match(li, /sharedName/);
  assert.match(li, /Dibagikan ke/);
});

test("Tab delete moves to Sampah and is hidden for non-owners of normal maps", () => {
  const t = slice(html, "function MindmapTabInstance(", "\nconst MINDMAP_DIRECTIONS");
  assert.match(t, /"Pindahkan ke Sampah\?"/);
  assert.match(t, /mindmaptrash\??\.TOAST_MOVED/);
  assert.match(t, /\(isLinked \? !isNoteOwner : !isOwner\) \? null/);
});

test("LinkPickerModal uses filterExistingTargets; global search shows mindmap snippet", () => {
  assert.match(slice(html, "function LinkPickerModal(", "\nfunction "), /filterExistingTargets\(/);
  assert.match(html, /mm\.snippet && \/\*#__PURE__\*\/React\.createElement/);
});
```

- [ ] **Step 2: Run** `node --test tests/offline/mindmap_trash_ui.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `MindmapTrashList`: state `items/loading/error/busy`; `load = async () => { setLoading(true); if (navigator.onLine !== false) { if (window.__pushNow) await Promise.race([window.__pushNow().catch(() => {}), sleep(5000)]); if (window.TF?.syncpull?.pullMindmapTrash && window.__syncRawFetch) await Promise.race([window.TF.syncpull.pullMindmapTrash(window.__syncRawFetch).catch(() => {}), sleep(5000)]); } const data = await api.get("/api/mindmaps/trash"); setItems(data || []); setLoading(false); }` (dibungkus try/catch → `error`). Restore: `const res = await api.post(\`/api/mindmaps/trash/${it.cid || it.id}/restore\`, {})`; `res.restored === "queued"` dan online → `await window.__pushNow()` lalu `load()`; bila item yang sama masih ada dengan `error === "source_note_missing"` → toast `MT.SOURCE_MISSING_MSG` (error) ; online sukses → `MT.TOAST_RESTORED`; offline → `MT.TOAST_RESTORE_QUEUED`; selalu `window.dispatchEvent(new CustomEvent("mindmapSaved"))` dan `onRestored && onRestored()`. Hapus permanen/kosongkan: offline → toast `MT.PURGE_OFFLINE_MSG`; online → konfirmasi `MT.CONFIRM_PURGE`/`MT.CONFIRM_EMPTY` → `api.del(\`/api/mindmaps/trash/${it.id}\`)` / `api.del("/api/mindmaps/trash")` (item `pending` tanpa id numerik: push dulu lewat `load()`) → `load()`. Render memakai kelas CSS yang sama dengan item catatan (`note-trash-item`, `note-trash-item-meta`, …) + 📄 bila `linked`, label `MT.PENDING_LABEL` bila `pending`, `TF.notetrash.deletedAgoLabel/daysLeftLabel`. Kosong → "Sampah kosong".
  - `NoteTrashModal`: `const [kind, setKind] = useState(initialKind);` dua tombol segmen di header ("Catatan", "Mindmap", gaya `btn btn-sm` + aktif `btn-primary`); subjudul mengikuti kind (teks spec); body kind "note" = isi lama, kind "mindmap" = `React.createElement(MindmapTrashList, { showToast, onRestored: onMindmapRestored })`; tombol "Kosongkan Sampah" lama hanya untuk kind "note" (Mindmap punya tombolnya sendiri di `MindmapTrashList`). Jaga agar return dini `!NT` tetap sebelum hook.
  - `MindmapPage`: `const [trashOpen, setTrashOpen] = useState(false)`; filter: `const [filterListId, setFilterListId] = useState(() => { try { const v = localStorage.getItem("tf_mindmap_filter"); return v == null || v === "" ? null : (v === "personal" ? "personal" : Number(v)); } catch (_) { return null; } });` + efek simpan (try/catch) + reset ke `null` bila angka dan tidak ada di `sharedLists`. `<select>` (hanya bila `sharedLists.length > 0`) di bawah kotak cari: opsi "Semua peta" (`""`), "Pribadi" (`"personal"`), `👥 ${l.name}` (`l.id`). `filtered = (TF.mindmaptabs.filterSidebar || fallback)(mindmaps, { q: searchQ, filter: filterListId })`. Tombol "🗑 Sampah" di bawah daftar (gaya tombol sekunder kecil, tanpa border-left) → `NoteTrashModal` `{ initialKind: "mindmap", onClose, showToast, onRestored: () => {}, onMindmapRestored: () => api.get("/api/mindmaps").then(d => setMindmaps(d || [])) }`. `MindmapListItem` dipanggil dengan `sharedName: m.list_id != null ? ((sharedLists.find(l => String(l.id) === String(m.list_id)) || {}).name || "workspace") : null`. `handleDeleteMindmap` tidak berubah (tab sudah memanggilnya).
  - `MindmapListItem`: `sharedName && React.createElement("span", { title: "Dibagikan ke " + sharedName, style: { fontSize: 11, flexShrink: 0 } }, "👥")` sebelum penanda 📄.
  - `MindmapTabInstance.handleDelete`: setelah sukses `showToast((window.TF?.mindmaptrash?.TOAST_MOVED) || "🗑 Dipindahkan ke Sampah")`. Tombol: ganti kondisi `isLinked && !isNoteOwner ? null : …` menjadi `(isLinked ? !isNoteOwner : !isOwner) ? null : …`; label konfirmasi "Pindahkan ke Sampah?".
  - `LinkPickerModal`: `const MOx = window.TF && window.TF.mindmapoutline; const filteredRes = MOx && MOx.filterExistingTargets ? MOx.filterExistingTargets(results || {}, existingLinks) : null;` lalu `notes/tasks/mindmaps` dari `filteredRes` (fallback ke logika lama).
  - Pencarian global: ubah baris mindmap menjadi kolom: baris atas (judul + tanggal, seperti sekarang) dan `mm.snippet && /*#__PURE__*/React.createElement("div", { style: { fontSize: 12, color: "var(--text-light)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, mm.snippet)`.
- [ ] **Step 4: Run** `npm test` dan `node temporary_files/check_inline_scripts.js static/index.html` — Expected: PASS (kecuali pra-ada) / OK.
- [ ] **Step 5: Commit**
  ```
  git add static/index.html tests/offline/mindmap_trash_ui.test.js
  git commit -m "feat(mindmap): UI Sampah, pin anggota, penanda & filter workspace, snippet cari" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013t2wBZvFmWiPG5XEYKL44H"
  ```

### Task A9: rilis PR A

**Files:**
- Modify: `static/index.html` (tag `<script src="/static/offline/mindmaplinks.js"></script>` dan `<script src="/static/offline/mindmaptrash.js"></script>` setelah `mindmapoutline.js` ~282; iframe `?v=143` → `?v=144`; `window.__SW_VERSION` + fallback About), `static/sw.js` (`CACHE`; precache `/static/offline/mindmaplinks.js`, `/static/offline/mindmaptrash.js`; aturan network-only baru tepat setelah blok Sampah note ~261: `url.pathname === "/api/mindmaps/trash" || url.pathname.startsWith("/api/mindmaps/trash/")`), `webapp.py` (`sw_cache`), `tests/test_version.py`, tes yang menyebut versi lama, `.agents/CURRENT_STATE.md`, `.agents/SESSION_LOG.md`, `.agents/DECISIONS.md` (ADR baru: Sampah mindmap snapshot + cermin offline + pin per user + `search_text`), `static/app.css?v=` hanya bila `app.css` disentuh
- Create: `temporary_files/e2e_mindmap_findings_a.py` (Playwright, pola `temporary_files/e2e_project_scope.py`)

- [ ] **Step 1:** `git fetch origin main`; cek `head -1 static/sw.js` di `origin/main`; pilih `taskflow-vNNN-mindmap-trash` (NNN berikutnya, sekarang v421); ganti di semua tempat (Global Constraints). `grep -rl "taskflow-v420-toc-headings" tests static webapp.py` harus kosong setelahnya.
- [ ] **Step 2:** Tambah tes SW ke `tests/offline/mindmaptrash.test.js`: `sw.js` memuat kedua modul di precache dan aturan network-only `/api/mindmaps/trash`. Jalankan `npm test`, `python -m pytest tests/ -q`, kedua `check_inline_scripts.js`, cek border-left.
- [ ] **Step 3:** E2E (server lokal, dua user): hapus peta → ada di Sampah (tab Mindmap) → pulihkan → link node `type:'mindmap'` dari peta lain terbuka; hapus offline (DevTools offline) → item "menunggu sinkron" → pulihkan offline → online → tidak ada di Sampah; anggota menyematkan peta bersama, pemilik tidak terpengaruh; filter "Pribadi"/workspace; badge 👥; cari "children" tidak menampilkan peta, cari teks node menampilkan snippet; ubah judul/prioritas task tertaut → kartu di kanvas & Outline ikut berubah tanpa simpan peta; ekspor ZIP berisi `mindmaps/`. Simpan tangkapan layar di `temporary_files/e2e_mindmap_findings_a/`.
- [ ] **Step 4:** Perbarui `.agents/` (status PR A, butuh restart `taskflow-web`, versi SW, ADR), commit:
  ```
  git add -A
  git commit -m "chore(release): PR A temuan mindmap #3 #5–#8 — SW, precache, ADR" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013t2wBZvFmWiPG5XEYKL44H"
  ```
  lalu push dan buka **draft** PR "feat(mindmap): Sampah, ekspor, cari teks node, pin pribadi, kartu link hidup (temuan #3, #5–#8)" dengan hasil tes, E2E, catatan "deploy wajib `sudo systemctl restart taskflow-web`", dan akhir deskripsi:
  ```
  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  https://claude.ai/code/session_013t2wBZvFmWiPG5XEYKL44H
  ```
  Tunggu Bapak "merge dan deploy".

---

## Bagian B — PR B (branch `claude/mindmap-findings-b` dari `main` setelah PR A di-merge)

### Task B1: `mindmapmerge.js` — merge tiga arah per node

**Files:**
- Create: `static/offline/mindmapmerge.js`
- Test: `tests/offline/mindmapmerge.test.js`

**Interfaces:**
- Produces `TF.mindmapmerge` (UMD, tanpa dependensi):
  - `merge3(base: object, local: object, server: object) → {doc: object, conflicts: Array<{nodeId: string, field: string, topic: string}>, changed: boolean} | {fallback: true}` — algoritma spec §4 langkah 1–9.
  - `merge3Scalar(b, l, s) → {value, conflict: boolean}`.
  - `stableEq(a, b) → boolean` (JSON stabil, urutan key diabaikan).
- Consumes: — (B3 memanggilnya).

- [ ] **Step 1: Write the failing tests**

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const M = require("../../static/offline/mindmapmerge.js");

const n = (id, topic, children = [], extra = {}) => Object.assign({ id, topic, children }, extra);
const doc = (children, extra = {}) => Object.assign({ nodeData: n("root", "Akar", children, { root: true }), direction: 2 }, extra);
const find = (node, id) => { if (node.id === id) return node; for (const c of node.children || []) { const f = find(c, id); if (f) return f; } return null; };
const kids = (d, id = "root") => find(d.nodeData, id).children.map((c) => c.id);
const clone = (x) => JSON.parse(JSON.stringify(x));

const B = doc([n("a", "A"), n("b", "B", [n("b1", "B1")]), n("c", "C")]);

test("echo of own write: merge3(B, L, L) = L without conflicts", () => {
  const L = clone(B); find(L.nodeData, "a").topic = "A2";
  const r = M.merge3(B, L, clone(L));
  assert.ok(M.stableEq(r.doc, L)); assert.deepEqual(r.conflicts, []); assert.equal(r.changed, false);
  assert.ok(M.stableEq(M.merge3(B, clone(B), L).doc, L));
  assert.ok(M.stableEq(M.merge3(B, L, clone(B)).doc, L));
});

test("edits to different nodes merge without conflicts", () => {
  const L = clone(B); find(L.nodeData, "a").topic = "A lokal";
  const S = clone(B); find(S.nodeData, "c").topic = "C server";
  const r = M.merge3(B, L, S);
  assert.equal(find(r.doc.nodeData, "a").topic, "A lokal");
  assert.equal(find(r.doc.nodeData, "c").topic, "C server");
  assert.deepEqual(r.conflicts, []); assert.equal(r.changed, true);
});

test("same field of the same node: server wins and the conflict is reported", () => {
  const L = clone(B); find(L.nodeData, "a").topic = "**A lokal**";
  const S = clone(B); find(S.nodeData, "a").topic = "A server";
  const r = M.merge3(B, L, S);
  assert.equal(find(r.doc.nodeData, "a").topic, "A server");
  assert.deepEqual(r.conflicts, [{ nodeId: "a", field: "topic", topic: "A lokal" }]);
});

test("adds on both sides under the same parent keep both, local first after the shared anchor", () => {
  const L = clone(B); L.nodeData.children.splice(1, 0, n("x", "X"));
  const S = clone(B); S.nodeData.children.splice(1, 0, n("y", "Y"));
  assert.deepEqual(kids(M.merge3(B, L, S).doc), ["a", "x", "y", "b", "c"]);
});

test("delete vs edit keeps the edited node (both directions)", () => {
  const L = clone(B); find(L.nodeData, "b").topic = "B lokal"; L.nodeData.children = L.nodeData.children.filter((c) => c.id !== "c");
  const S = clone(B); S.nodeData.children = S.nodeData.children.filter((c) => c.id !== "b"); find(S.nodeData, "c").topic = "C server";
  const r = M.merge3(B, L, S);
  assert.equal(find(r.doc.nodeData, "b").topic, "B lokal");
  assert.deepEqual(kids(r.doc, "b"), ["b1"]);
  assert.equal(find(r.doc.nodeData, "c").topic, "C server");
  assert.deepEqual(r.conflicts, []);
});

test("untouched subtree deleted on one side is deleted", () => {
  const S = clone(B); S.nodeData.children = S.nodeData.children.filter((c) => c.id !== "b");
  const r = M.merge3(B, clone(B), S);
  assert.equal(find(r.doc.nodeData, "b"), null); assert.equal(find(r.doc.nodeData, "b1"), null);
});

test("child added under a node deleted on the other side resurrects the parent", () => {
  const L = clone(B); find(L.nodeData, "b").children.push(n("z", "Z"));
  const S = clone(B); S.nodeData.children = S.nodeData.children.filter((c) => c.id !== "b");
  const r = M.merge3(B, L, S);
  assert.deepEqual(kids(r.doc, "b"), ["b1", "z"]);
});

test("move vs edit; move vs move → server parent; cycle resolved to server structure", () => {
  const L = clone(B); const a = L.nodeData.children.shift(); find(L.nodeData, "b").children.push(a);
  const S = clone(B); find(S.nodeData, "a").topic = "A server";
  const r = M.merge3(B, L, S);
  assert.deepEqual(kids(r.doc, "b"), ["b1", "a"]); assert.equal(find(r.doc.nodeData, "a").topic, "A server");

  const S2 = clone(B); const a2 = S2.nodeData.children.shift(); find(S2.nodeData, "c").children.push(a2);
  const r2 = M.merge3(B, L, S2);
  assert.deepEqual(kids(r2.doc, "c"), ["a"]); assert.deepEqual(r2.conflicts, []);

  const Lc = clone(B); const bL = Lc.nodeData.children.splice(1, 1)[0]; find(Lc.nodeData, "a").children.push(bL);   // b → a
  const Sc = clone(B); const aS = Sc.nodeData.children.shift(); find(Sc.nodeData, "b").children.push(aS);          // a → b
  const rc = M.merge3(B, Lc, Sc);
  assert.ok(kids(rc.doc).includes("b")); assert.deepEqual(kids(rc.doc, "b"), ["b1", "a"]);
});

test("local-only reorder is kept while server edits a topic", () => {
  const L = clone(B); L.nodeData.children = [L.nodeData.children[2], L.nodeData.children[0], L.nodeData.children[1]];
  const S = clone(B); find(S.nodeData, "b").topic = "B server";
  const r = M.merge3(B, L, S);
  assert.deepEqual(kids(r.doc), ["c", "a", "b"]); assert.equal(find(r.doc.nodeData, "b").topic, "B server");
});

test("links merge as a set; expanded conflict → server without conflict", () => {
  const Bl = doc([n("a", "A", [], { links: [{ type: "task", id: 1, title: "T1" }], expanded: true })]);
  const L = clone(Bl); find(L.nodeData, "a").links.push({ type: "note", id: 2, title: "N2" }); find(L.nodeData, "a").expanded = false;
  const S = clone(Bl); find(S.nodeData, "a").links = []; find(S.nodeData, "a").expanded = true;
  const r = M.merge3(Bl, L, S);
  assert.deepEqual(find(r.doc.nodeData, "a").links.map((l) => l.type + ":" + l.id), ["note:2"]);
  assert.equal(find(r.doc.nodeData, "a").expanded, false);
  assert.deepEqual(r.conflicts, []);
});

test("arrows to deleted nodes dropped; summaries clamped; top-level keys merged", () => {
  const L = clone(B); L.arrows = [{ id: "ar1", from: "a", to: "c", label: "x" }]; L.summaries = [{ id: "s1", parent: "root", start: 0, end: 2, label: "S" }]; L.direction = 0;
  const S = clone(B); S.nodeData.children = S.nodeData.children.filter((c) => c.id !== "c"); S.justify = true;
  const r = M.merge3(B, L, S);
  assert.deepEqual(r.doc.arrows, []);
  assert.deepEqual(r.doc.summaries, [{ id: "s1", parent: "root", start: 0, end: 1, label: "S" }]);
  assert.equal(r.doc.direction, 0); assert.equal(r.doc.justify, true);
});

test("fallback on missing nodeData, duplicate ids or different roots", () => {
  assert.deepEqual(M.merge3(B, B, { v: 1 }), { fallback: true });
  assert.deepEqual(M.merge3(B, doc([n("a", "A"), n("a", "A")]), B), { fallback: true });
  assert.deepEqual(M.merge3(B, B, { nodeData: n("other", "X", [], { root: true }) }), { fallback: true });
});

test("merge3Scalar", () => {
  assert.deepEqual(M.merge3Scalar("t", "l", "t"), { value: "l", conflict: false });
  assert.deepEqual(M.merge3Scalar("t", "t", "s"), { value: "s", conflict: false });
  assert.deepEqual(M.merge3Scalar("t", "l", "s"), { value: "s", conflict: true });
});
```

- [ ] **Step 2: Run** `node --test tests/offline/mindmapmerge.test.js` — Expected: FAIL (`Cannot find module`).
- [ ] **Step 3: Implement** persis spec §4 "Algoritma". Detail yang mengikat:
  - `indexDoc(d)`: map `id → {fields (salinan dangkal node tanpa children), parent, childIds}`; DFS iteratif; id ganda → fallback. Root id tiga dokumen harus sama.
  - "Disentuh di X" (`touched(X, id)`) rekursif: field berubah terhadap B, induk berubah terhadap B, atau ada anak di pohon X yang baru (tidak di B) atau disentuh. Memo per sisi. Node yang dihapus sisi lain tetapi disentuh di X dipertahankan **beserta seluruh subtree-nya di X** (tes `delete vs edit` mengharapkan `b1` ikut kembali).
  - Urutan pemrosesan induk untuk deteksi siklus: pre-order pohon S lalu node sisa dalam pre-order L.
  - Penyisipan anak non-utama: setelah jangkar (saudara sebelumnya di sisi asal), lalu lompati node berikutnya yang **tidak ada** di daftar anak P pada sisi asal (agar `["a","x","y"]` pada tes tambah-dua-sisi).
  - Field topic konflik: `topic` di record konflik = teks polos topic lokal (buang `**`, `__`, `~~`, `==`, backtick, tag HTML; rapatkan spasi).
  - Bangun ulang `doc`: salin key tingkat atas hasil 3-way; `nodeData` dari root; setiap node `Object.assign({}, fields, { children: [...] })`.
- [ ] **Step 4: Run** `node --test tests/offline/mindmapmerge.test.js` — Expected: PASS.
- [ ] **Step 5: Commit**
  ```
  git add static/offline/mindmapmerge.js tests/offline/mindmapmerge.test.js
  git commit -m "feat(mindmap): merge tiga arah per node (mindmapmerge.js)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013t2wBZvFmWiPG5XEYKL44H"
  ```

### Task B2: SSE mindmap (backend)

**Files:**
- Modify: `webapp.py` — global `mindmap_subscribers` di samping `dm_subscribers` (~194–197); `_mindmap_broadcast` + `GET /api/mindmaps/{mid}/stream` (dekat `get_mindmap` ~7697); panggil broadcast di `update_mindmap` (~7709, hanya peta biasa), `share_mindmap` (~7578), `delete_mindmap` (A2)
- Test: `tests/test_mindmap_live.py` (baru)

**Interfaces:**
- Produces: `mindmap_subscribers: dict[int, set[tuple[int, asyncio.Queue]]]`; `async def _mindmap_broadcast(mid: int, event: dict) -> None`; endpoint stream; event `mindmap_changed {id, updated_at, editor_id, editor_name}`, `mindmap_deleted {id}`, `mindmap_access_lost {id}`, `ping`.
- Consumes (B5): klien EventSource.

- [ ] **Step 1: Write the failing tests** (`tests/test_mindmap_live.py`; salin `U`/`_shared` dari A2)

```python
"""Temuan mindmap #4: sinyal SSE perubahan peta bersama."""
import asyncio

import webapp


def _recorder(monkeypatch):
    calls = []

    async def rec(mid, event):
        calls.append((mid, event))
    monkeypatch.setattr(webapp, "_mindmap_broadcast", rec)
    return calls


def test_put_share_delete_broadcast(client, monkeypatch):
    calls = _recorder(monkeypatch)
    a, b = U(client, "mmlv1a"), U(client, "mmlv1b")
    lid = _shared(a, b, "WS Live 1")
    m = a.mk_map("Live", list_id=lid)
    r = b.put(f"/api/mindmaps/{m['id']}", json={"data_json": '{"nodeData":{"id":"root","topic":"x","root":true,"children":[]}}'})
    assert r.status_code == 200
    mid, ev = calls[-1]
    assert mid == m["id"] and ev["type"] == "mindmap_changed" and ev["updated_at"] == r.json()["updated_at"]
    assert ev["editor_id"] == b.id and ev["editor_name"]
    a.patch(f"/api/mindmaps/{m['id']}/share", json={"list_id": None})
    assert calls[-1][1]["type"] == "mindmap_changed"
    a.delete(f"/api/mindmaps/{m['id']}")
    assert calls[-1] == (m["id"], {"type": "mindmap_deleted", "id": m["id"]})


def test_linked_view_state_put_does_not_broadcast(client, monkeypatch):
    calls = _recorder(monkeypatch)
    a = U(client, "mmlv2")
    note = a.post("/api/scratchpad", json={"title": "C", "content": "# A\n"}).json()
    lm = a.mk_map("x", source_note_id=note["id"])
    a.put(f"/api/mindmaps/{lm['id']}", json={"data_json": '{"linked":1,"direction":1}'})
    assert calls == []


def test_broadcast_filters_subscribers_without_access(client):
    a, b, c = U(client, "mmlv3a"), U(client, "mmlv3b"), U(client, "mmlv3c")
    lid = _shared(a, b, "WS Live 3")
    m = a.mk_map("Live3", list_id=lid)

    async def run():
        qa, qb, qc = asyncio.Queue(), asyncio.Queue(), asyncio.Queue()
        webapp.mindmap_subscribers[m["id"]] |= {(a.id, qa), (b.id, qb), (c.id, qc)}
        try:
            await webapp._mindmap_broadcast(m["id"], {"type": "mindmap_changed", "id": m["id"]})
            return qa.get_nowait(), qb.get_nowait(), qc.get_nowait(), set(webapp.mindmap_subscribers.get(m["id"], set()))
        finally:
            webapp.mindmap_subscribers.pop(m["id"], None)
    ea, eb, ec, left = asyncio.run(run())
    assert ea["type"] == eb["type"] == "mindmap_changed"
    assert ec == {"type": "mindmap_access_lost", "id": m["id"]}
    assert all(uid != c.id for uid, _q in left)


def test_stream_rejects_non_member(client):
    a, c = U(client, "mmlv4a"), U(client, "mmlv4c")
    m = a.mk_map("Privat")
    assert c.get(f"/api/mindmaps/{m['id']}/stream").status_code == 404
```

- [ ] **Step 2: Run** `python -m pytest tests/test_mindmap_live.py -q` — Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `_mindmap_broadcast(mid, event)`: `subs = list(mindmap_subscribers.get(mid, set()))`; untuk `event["type"] != "mindmap_deleted"`: buka `get_db()` sekali, untuk tiap `(uid, q)` cek `SELECT 1 FROM mindmaps WHERE id = ? AND {access_clause(uid)}`; tanpa akses → `await q.put({"type": "mindmap_access_lost", "id": mid})` dan `mindmap_subscribers[mid].discard((uid, q))`; selain itu `await q.put(event)`. `mindmap_deleted` → kirim ke semua.
  - Stream: pola `dm_stream` (`get_current_user_sse`, cek akses → 404 "Mindmap tidak ditemukan", antrean, ping 20 s); setelah `yield` event bertipe `mindmap_access_lost` atau `mindmap_deleted` → `break`.
  - `update_mindmap`: setelah blok `with get_db()` selesai (commit), bila peta bukan tertaut: `editor_name` = `display_name or username` user `uid` (ambil di dalam blok); `await _mindmap_broadcast(mid, {"type": "mindmap_changed", "id": mid, "updated_at": updated["updated_at"], "editor_id": uid, "editor_name": editor_name})`. `share_mindmap`: sama setelah commit. `delete_mindmap`: `await _mindmap_broadcast(mid, {"type": "mindmap_deleted", "id": mid})` setelah commit (hanya bila benar-benar dihapus sekarang).
- [ ] **Step 4: Run** `python -m pytest tests/ -q` — Expected: PASS.
- [ ] **Step 5: Commit**
  ```
  git add webapp.py tests/test_mindmap_live.py
  git commit -m "feat(mindmap): sinyal SSE perubahan peta bersama" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013t2wBZvFmWiPG5XEYKL44H"
  ```

### Task B3: basis merge + `mergeServerIntoLocal` + merge di router lokal

**Files:**
- Modify: `static/offline/mindmaprepo.js` (`recordFromServer` ~53, `updateMindmap` ~225, `adoptServerWithConflictCopy` ~174 direfaktor ke helper dalam transaksi, `mergeServerIntoLocal` + `setBaseFromServer` baru, ekspor), `static/offline/mindmaproutes.js` (PUT ~79: respons `merged`), `static/offline/syncconflict.js` (`listNotices` ~195: teruskan `count`, `nodes`)
- Test: `tests/offline/mindmapmerge_repo.test.js` (baru)

**Interfaces:**
- Produces: record mindmap field `base_data_json`, `base_title` (spec §4 "Klien: basis merge").
- Produces: `mindmaprepo.mergeServerIntoLocal(cid, serverRow, opts?: {expectRev?, now?}) → Promise<{original, copy: record|null, merged: boolean, conflicts: number} | null>` (null = CAS batal/record hilang). `merged:false` = jalur adopsi/salinan lama.
- Produces: `mindmaprepo.setBaseFromServer(cid, row) → Promise<record|undefined>` — mutate: hanya bila `cur.base_rev === row.updated_at` dan `row.data_json != null` → `base_data_json = row.data_json`, `base_title = row.title`.
- Produces: `updateMindmap(cid, patch)` menerima `patch.base_data_json`; respons router PUT bisa membawa `merged: true`, `merge_conflicts: number`, `conflict_copy`.
- Produces: notice `{kind: "merge_conflict", title, copyTitle, editor, nodes: string[], count: number}`; `listNotices` meneruskan `count` dan `nodes`.
- Consumes: `TF.mindmapmerge` (B1, `req("./mindmapmerge.js", root.TF && root.TF.mindmapmerge)` malas).

- [ ] **Step 1: Write the failing tests** (`tests/offline/mindmapmerge_repo.test.js`; salin `put/get/all/rec/srvRow` dari `tests/offline/mindmap_cas_conflict.test.js`)

```js
const { buildTaskRouter } = require("../../static/offline/taskroutes.js");
const { listNotices } = require("../../static/offline/syncconflict.js");
const mm = require("../../static/offline/mindmaprepo.js");
const D = (topics) => JSON.stringify({ nodeData: { id: "root", topic: "Akar", root: true,
  children: topics.map((t, i) => ({ id: "n" + i, topic: t, children: [] })) } });
const B = D(["A", "B"]), L = D(["A lokal", "B"]), S = D(["A", "B server"]);

test("different nodes → merged record, dirty, one update op, base advanced, no copy", async () => {
  await put("mindmaps", [rec({ cid: "m", server_id: 10, title: "M", data_json: L, base_data_json: B, base_title: "M", base_rev: "t1", dirty: 1, rev: 3 })]);
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "mindmap", cid: "m", payload: {} }]);
  const out = await mm.mergeServerIntoLocal("m", srvRow({ id: 10, title: "M", data_json: S, updated_at: "t2" }), { expectRev: 3 });
  assert.equal(out.merged, true); assert.equal(out.copy, null); assert.equal(out.conflicts, 0);
  const r = await get("mindmaps", "m");
  assert.deepEqual(JSON.parse(r.data_json).nodeData.children.map((c) => c.topic), ["A lokal", "B server"]);
  assert.equal(r.dirty, 1); assert.equal(r.rev, 4);
  assert.deepEqual([r.base_rev, r.base_data_json, r.base_title], ["t2", S, "M"]);
  assert.deepEqual((await all("_outbox")).filter((o) => o.cid === "m").map((o) => o.op), ["update"]);
});

test("same node → server value in record + private conflict copy of the local version + merge_conflict notice", async () => {
  const L2 = D(["A lokal", "B"]), S2 = D(["A server", "B"]);
  await put("mindmaps", [rec({ cid: "m", server_id: 10, title: "M", data_json: L2, base_data_json: B, base_title: "M", base_rev: "t1", dirty: 1, rev: 1 })]);
  const out = await mm.mergeServerIntoLocal("m", srvRow({ id: 10, title: "M", data_json: S2, updated_at: "t2" }), { expectRev: 1 });
  assert.equal(out.conflicts, 1); assert.ok(out.copy);
  assert.equal(JSON.parse((await get("mindmaps", "m")).data_json).nodeData.children[0].topic, "A server");
  const copy = await get("mindmaps", out.copy.cid);
  assert.equal(copy.data_json, L2); assert.equal(copy.title, "(konflik) M"); assert.equal(copy.list_id, null);
  const notices = await listNotices();
  const nt = notices.find((x) => x.cid === "m");
  assert.equal(nt.kind, "merge_conflict"); assert.equal(nt.count, 1); assert.deepEqual(nt.nodes, ["A lokal"]);
});

test("no base / linked / expectRev mismatch keep the old behaviour", async () => {
  await put("mindmaps", [rec({ cid: "nb", server_id: 11, data_json: L, base_rev: "t1", dirty: 1, rev: 1 })]);
  const o1 = await mm.mergeServerIntoLocal("nb", srvRow({ id: 11, data_json: S, updated_at: "t2" }), { expectRev: 1 });
  assert.equal(o1.merged, false); assert.ok(o1.copy);
  await put("mindmaps", [rec({ cid: "x", server_id: 12, data_json: L, base_data_json: B, base_rev: "t1", dirty: 1, rev: 5 })]);
  assert.equal(await mm.mergeServerIntoLocal("x", srvRow({ id: 12, data_json: S, updated_at: "t2" }), { expectRev: 4 }), null);
});

test("recordFromServer stores the base; updateMindmap captures base on first edit of a clean record", async () => {
  const r0 = mm.recordFromServer(srvRow({ id: 5, title: "T", data_json: S, updated_at: "t9" }), "c");
  assert.deepEqual([r0.base_data_json, r0.base_title], [S, "T"]);
  await put("mindmaps", [rec({ cid: "c", server_id: 5, title: "T", data_json: B, dirty: 0, base_rev: "t9", rev: 1 })]);
  await mm.updateMindmap("c", { data_json: L });
  const r = await get("mindmaps", "c");
  assert.deepEqual([r.base_data_json, r.base_title, r.data_json], [B, "T", L]);
});

test("router PUT with stale if_updated_at + base_data_json merges instead of copying", async () => {
  await put("mindmaps", [rec({ cid: "m", server_id: 10, title: "M", data_json: S, updated_at: "t2", dirty: 0, base_rev: "t2", base_data_json: S, base_title: "M" })]);
  const R = buildTaskRouter();
  const res = await R.dispatch("PUT", "/api/mindmaps/10", { data_json: L, base_data_json: B, if_updated_at: "t1" });
  assert.equal(res.merged, true); assert.equal(res.merge_conflicts, 0); assert.equal(res.conflict_copy, undefined);
  assert.deepEqual(JSON.parse(res.data_json).nodeData.children.map((c) => c.topic), ["A lokal", "B server"]);
  assert.equal((await all("mindmaps")).length, 1);
});

test("setBaseFromServer only when base_rev matches the row", async () => {
  await put("mindmaps", [rec({ cid: "m", server_id: 10, data_json: L, base_rev: "t3", dirty: 1, rev: 2 })]);
  await mm.setBaseFromServer("m", srvRow({ id: 10, title: "M", data_json: S, updated_at: "t2" }));
  assert.equal((await get("mindmaps", "m")).base_data_json, undefined);
  await mm.setBaseFromServer("m", srvRow({ id: 10, title: "M", data_json: S, updated_at: "t3" }));
  assert.equal((await get("mindmaps", "m")).base_data_json, S);
});
```

- [ ] **Step 2: Run** `node --test tests/offline/mindmapmerge_repo.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `recordFromServer`: bila `s.data_json != null` → `rec.base_data_json = s.data_json; rec.base_title = rec.title`.
  - Refaktor isi transaksi `adoptServerWithConflictCopy` menjadi `adoptInTx(ms, ob, cur, serverRow, now)` (mengembalikan `{original, copy}` setelah menulis) agar `mergeServerIntoLocal` bisa memakainya di transaksi yang sama. Perilaku `adoptServerWithConflictCopy` tidak berubah (tes lama tetap lulus).
  - `mergeServerIntoLocal`: satu transaksi `["mindmaps", "_outbox"]`; `cur` hilang atau `expectRev` beda → `null`. `!cur.dirty || cur.deleted` → `adoptInTx` (`merged:false`). Tertaut, `cur.base_data_json == null`, parse JSON gagal, atau `merge3` → `fallback` → `adoptInTx` (`merged:false`). Selain itu: `res = merge3(B, L, S)`; `t = merge3Scalar(cur.base_title, cur.title, serverRow.title)`; `next = Object.assign(recordFromServer(serverRow, cid), {data_json: JSON.stringify(res.doc), title: t.value, rev: cur.rev+1, pinned: !!cur.pinned})` + pertahankan `client_id`, `source_note_cid`, `notice` lama; `dirty = (res.changed || t.value !== serverRow.title) ? 1 : 0`; `updated_at` = `now` bila dirty, selain itu milik server. Bila `res.conflicts.length` → `copy = conflictCopyOf(cur, cur.title, cur.data_json, now)` + `next.notice = {kind:"merge_conflict", title: cur.title, copyTitle: copy.title, editor: editorOf(serverRow), nodes: unik(res.conflicts.map(c => c.topic)).slice(0, 3), count: jumlah nodeId unik}`. Buang op `create/update` untuk cid; bila `dirty` tambah satu op `update`; bila ada salinan tambah op `create` untuk salinan. Resolve `{original: next, copy, merged: true, conflicts: count}`.
  - `updateMindmap`: (a) sebelum patch: bila `cur.base_data_json === undefined && !cur.dirty && cur.server_id != null` → salin `base_data_json = cur.data_json`, `base_title = cur.title` ke record yang ditulis. (b) jalur basi (`if_updated_at` beda, bukan tertaut): bila `patch.base_data_json != null` → di dalam `TFdb.mutate`: `res = merge3(parse(patch.base_data_json), parse(patch.data_json ?? cur.data_json), parse(cur.data_json))`; bukan fallback → tulis `data_json = JSON.stringify(res.doc)`, `title` = `patch.title ?? cur.title`, `dirty:1`, `rev+1`, `updated_at: now`, `last_edited_by` seperti biasa, dan simpan `mergeInfo = res`; fallback → jalur `stale` lama (salinan konflik). Setelah mutate: op `update` (dedupe) lalu bila `mergeInfo.conflicts.length` → buat salinan konflik versi tab (`conflictCopyOf(cur, patch.title ?? cur.title, patch.data_json, now)` + op create, satu transaksi; boleh memakai ulang `saveAsConflictCopy` dengan opsi agar record asli TIDAK diganti). Kembalikan record + `merged: true`, `merge_conflicts: mergeInfo.conflicts.length`, `conflict_copy?`.
  - Router PUT: `saved.merged` → `Object.assign(full(rec), {merged: true, merge_conflicts: saved.merge_conflicts}, saved.conflict_copy ? {conflict_copy: full(saved.conflict_copy)} : {})`.
  - `setBaseFromServer` sesuai Interfaces (`TFdb.mutate`, tidak mengubah `rev`/`dirty`).
  - `syncconflict.listNotices`: tambahkan `count: r.notice.count != null ? r.notice.count : null, nodes: Array.isArray(r.notice.nodes) ? r.notice.nodes : null`.
- [ ] **Step 4: Run** `node --test tests/offline/mindmapmerge_repo.test.js tests/offline/mindmap_cas_conflict.test.js tests/offline/mindmaprepo*.test.js tests/offline/mindmaproutes*.test.js tests/offline/syncconflict_mindmaps.test.js` — Expected: PASS.
- [ ] **Step 5: Commit**
  ```
  git add static/offline/mindmaprepo.js static/offline/mindmaproutes.js static/offline/syncconflict.js tests/offline/mindmapmerge_repo.test.js
  git commit -m "feat(mindmap): basis merge per record + mergeServerIntoLocal + merge di router lokal" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013t2wBZvFmWiPG5XEYKL44H"
  ```

### Task B4: merge di push/pull + `pullMindmapOne`

**Files:**
- Modify: `static/offline/syncpush.js` (`mindmapRevMismatch` ~1102; sukses `opMindmapUpdate` ~1273 dan `postMindmapCreate` ~1212 → `setBaseFromServer`; `result.requeued`), `static/offline/syncpull.js` (`pullMindmaps` ~956: opsi `partial`, jalur dirty+berubah ~983–998 → `mergeServerIntoLocal`; `pullMindmapOne` baru; ekspor), `static/index.html` (`schedulePush` ~789 dan `sync()` ~1023: `if (r && (r.busy || r.requeued)) schedulePush()`)
- Test: `tests/offline/mindmapmerge_sync.test.js` (baru)

**Interfaces:**
- Produces: `syncpull.pullMindmaps(serverList, fetchOne, confirmOne, opts?: {partial?: boolean})` — `partial` melewati pass "hilang dari daftar"/duplikat hantu untuk record yang tidak ada di `serverList`.
- Produces: `syncpull.pullMindmapOne(rawFetch, sid) → Promise<{changed: Array<{cid, server_id}>, merged: number, deleted: number, dirty: boolean}>`.
- Produces: hasil `pushOutbox` punya `requeued` (angka) bila merge 409 mengantre op update baru.
- Consumes: B3 (`mergeServerIntoLocal`, `setBaseFromServer`).

- [ ] **Step 1: Write the failing tests** (`tests/offline/mindmapmerge_sync.test.js`; helper dari B3 + `transport`/`rev409` dari `mindmap_cas_conflict.test.js`)

```js
const { mapPut } = require("../../static/offline/idmap.js");
const { pushOutbox } = require("../../static/offline/syncpush.js");
const { pullMindmaps, pullMindmapOne } = require("../../static/offline/syncpull.js");
const okRes = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });

test("push 409 with base → merged + requeued; next push sends merged doc with new base_rev; base advanced", async () => {
  await put("mindmaps", [rec({ cid: "m", server_id: 10, title: "M", data_json: L, base_data_json: B, base_title: "M", base_rev: "t1", dirty: 1, rev: 1 })]);
  await mapPut("mindmap", 10, "m");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "mindmap", cid: "m", payload: {} }]);
  const tr = transport((m, p, body, n) => (n === 1
    ? rev409(srvRow({ id: 10, title: "M", data_json: S, updated_at: "t2" }))
    : { status: 200, data: srvRow({ id: 10, title: "M", data_json: body.data_json, updated_at: "t3" }) }));
  const r1 = await pushOutbox(tr);
  assert.equal(r1.requeued, 1);
  assert.equal((await all("mindmaps")).length, 1);
  await pushOutbox(tr);
  const sent = tr.calls[1].body;
  assert.equal(sent.base_rev, "t2");
  assert.deepEqual(JSON.parse(sent.data_json).nodeData.children.map((c) => c.topic), ["A lokal", "B server"]);
  const r = await get("mindmaps", "m");
  assert.deepEqual([r.dirty, r.base_rev, r.base_data_json], [0, "t3", sent.data_json]);
});

test("pull: dirty record with pending op and changed server row is merged, not copied", async () => {
  await put("mindmaps", [rec({ cid: "m", server_id: 10, title: "M", data_json: L, base_data_json: B, base_title: "M", base_rev: "t1", dirty: 1, rev: 1 })]);
  await mapPut("mindmap", 10, "m");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "mindmap", cid: "m", payload: {} }]);
  const row = srvRow({ id: 10, title: "M", data_json: S, updated_at: "t2" });
  const res = await pullMindmaps([row], () => Promise.resolve(row), null);
  assert.equal(res.merged, 1); assert.equal(res.conflictCopies, 0);
  assert.equal((await all("mindmaps")).length, 1);
});

test("pullMindmapOne updates one map and never deletes others", async () => {
  await put("mindmaps", [rec({ cid: "a", server_id: 1, data_json: B, dirty: 0, base_rev: "t1" }), rec({ cid: "b", server_id: 2, dirty: 0, base_rev: "t1" })]);
  await mapPut("mindmap", 1, "a"); await mapPut("mindmap", 2, "b");
  const raw = (url) => (url === "/api/mindmaps/1" ? okRes(srvRow({ id: 1, data_json: S, updated_at: "t2" }))
    : Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) }));
  const res = await pullMindmapOne(raw, 1);
  assert.deepEqual(res.changed.map((c) => c.cid), ["a"]);
  assert.equal((await get("mindmaps", "a")).data_json, S);
  assert.ok(await get("mindmaps", "b"));
});

test("pullMindmapOne 404: clean record deleted, dirty record kept", async () => {
  await put("mindmaps", [rec({ cid: "a", server_id: 1, dirty: 0, base_rev: "t1" }), rec({ cid: "d", server_id: 3, dirty: 1, base_rev: "t1" })]);
  await mapPut("mindmap", 1, "a"); await mapPut("mindmap", 3, "d");
  const gone = () => Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ detail: "x" }) });
  assert.equal((await pullMindmapOne(gone, 1)).deleted, 1);
  assert.equal(await get("mindmaps", "a"), undefined);
  assert.equal((await pullMindmapOne(gone, 3)).deleted, 0);
  assert.ok(await get("mindmaps", "d"));
});

test("index.html schedules another push when a merge requeued an update", () => {
  const html = require("fs").readFileSync(require("path").join(__dirname, "../../static/index.html"), "utf8");
  assert.ok((html.match(/r\.busy \|\| r\.requeued/g) || []).length >= 2);
});
```

- [ ] **Step 2: Run** `node --test tests/offline/mindmapmerge_sync.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `mindmapRevMismatch`: `TFmm.mergeServerIntoLocal(op.cid, current, { expectRev: sentRev })` → `null` → biarkan op (seperti sekarang); `out.merged` → `result.merged = (result.merged||0)+1`; `out.copy` → `result.conflicts++`; `outboxRemove(op.qid)`; bila record hasil `dirty` → `result.requeued = (result.requeued||0)+1` (op update baru sudah diantre repo); `notifyMindmapSynced([op.cid].concat(out.copy ? [out.copy.cid] : []), [current.id])`. `result.requeued` dimulai `0` di objek hasil `pushOutbox`.
  - Sukses PUT (`opMindmapUpdate`) dan POST (`postMindmapCreate`, juga `adoptRecreated` bila memakai baris server) → setelah `markPushed` panggil `TFmm.setBaseFromServer(op.cid, res.data)` (hanya peta biasa; respons berisi `data_json`).
  - `pullMindmaps(…, opts)`: jalur `local.base_rev != null && s.updated_at !== local.base_rev` untuk peta biasa → `TFmm.mergeServerIntoLocal(cid, fullRow, { expectRev: local.rev || 0 })`; `out.merged` → `result.merged++` (field baru, mulai 0); `out.copy` → `result.conflictCopies++` + `changed(out.copy.cid, null)`; selalu `changed(cid, s.id)`. `opts.partial` → lewati loop `for (const r of localAll)` (duplikat hantu + hilang dari daftar).
  - `pullMindmapOne(rawFetch, sid)`: `Promise.resolve(rawFetch("/api/mindmaps/" + sid)).then(goneOrJson)`: `{status:404|403}` → record lokal `cid = await TFidmap.cidOf("mindmap", sid)`; record ada & `!dirty` → `deleteMindmapRec(cid)` + `TFidmap.mapDelete` → `{changed:[{cid, server_id: sid}], merged:0, deleted:1, dirty:false}`; dirty → `{changed:[], merged:0, deleted:0, dirty:true}`; `null` (gagal) → hasil kosong; body → `pullMindmaps([meta(body)], () => Promise.resolve(body), null, {partial: true})` lalu `dirty` = record lokal masih dirty. `meta(body)` = salinan `body` (sudah memuat `updated_at`, `is_pinned`, `source_note_id`, `client_id`).
  - `index.html`: ganti `if (r && r.busy) schedulePush()` di `schedulePush` dan `sync()` menjadi `if (r && (r.busy || r.requeued)) schedulePush()`.
- [ ] **Step 4: Run** `npm test` — Expected: PASS (kecuali pra-ada). Tes lama yang mengharapkan salinan konflik untuk record **tanpa** `base_data_json` tetap lulus.
- [ ] **Step 5: Commit**
  ```
  git add static/offline/syncpush.js static/offline/syncpull.js static/index.html tests/offline/mindmapmerge_sync.test.js
  git commit -m "feat(mindmap): merge per node saat 409/pull + pullMindmapOne" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013t2wBZvFmWiPG5XEYKL44H"
  ```

### Task B5: UI langsung — EventSource, `remoteUpdate`, basis tab

**Files:**
- Modify: `static/index.html` — dekat `window.__pushNow` (~793): `window.__mindmapLive`; `noticeText` (~1031): kind `merge_conflict`; `MindmapTabInstance` (~9775): `baseDocRef`, `remoteStaleRef`, `remoteSeqRef`, efek EventSource, `applyRecordToTab` → `remoteUpdate`, `doSave` kirim `base_data_json` dan tangani `merged`, penanda "🟢 Langsung"; `static/vendor/mind-elixir/index.html` (handler `remoteUpdate` di listener `message` ~1278); `static/sw.js` (aturan network-only stream)
- Test: `tests/offline/mindmap_live_ui.test.js` (baru)

**Interfaces:**
- Produces: `window.__mindmapLive(sid: number) → Promise<void>`; pesan induk→iframe `{type:"remoteUpdate", data, title, seq}`; iframe→induk `{type:"remoteApplied", seq}` / `{type:"remoteSkipped", seq}`.
- Consumes: B2 (stream), B3 (router `merged`), B4 (`pullMindmapOne`, `requeued`).

- [ ] **Step 1: Write the failing tests** (`tests/offline/mindmap_live_ui.test.js`; `slice` dari A7)

```js
const sw = fs.readFileSync(path.join(__dirname, "../../static/sw.js"), "utf8");

test("__mindmapLive pulls one map exclusively, notifies tabs and pushes when dirty", () => {
  const f = slice(html, "window.__mindmapLive = ", "\n};");
  assert.match(f, /runSyncExclusive\(/);
  assert.match(f, /pullMindmapOne\(__syncRawFetch, /);
  assert.match(f, /"mindmapSynced"/);
  assert.match(f, /source: "live"/);
  assert.match(f, /__pushNow\(\)/);
});

test("MindmapTabInstance subscribes to the stream only for shared, non-linked, synced maps", () => {
  const t = slice(html, "function MindmapTabInstance(", "\nconst MINDMAP_DIRECTIONS");
  assert.match(t, /new EventSource\(/);
  assert.match(t, /\/stream`\)/);
  assert.match(t, /isLinked \|\| tab\.list_id == null/);
  assert.match(t, /mindmap_access_lost/);
  assert.match(t, /"Akses ke peta ini dicabut"/);
  assert.match(t, /"Peta ini dihapus oleh pemiliknya"/);
  assert.match(t, /"🟢 Langsung"/);
  assert.match(t, /base_data_json: baseDocRef\.current/);
  assert.match(t, /type: "remoteUpdate"/);
  assert.match(t, /remoteSkipped/);
});

test("iframe skips remote updates while a node is being edited", () => {
  const h = slice(iframe, "e.data.type === 'remoteUpdate'", "\n      }\n");
  assert.match(h, /input-box/);
  assert.match(h, /remoteSkipped/);
  assert.match(h, /remoteApplied/);
  assert.match(h, /exitFocusMode/);
});

test("noticeText renders merge_conflict; SW never caches mindmap streams", () => {
  const nt = slice(html, "function noticeText(", "\nfunction renderConflicts");
  assert.match(nt, /merge_conflict/);
  assert.match(nt, /node diubah bersamaan oleh/);
  assert.match(sw, /\\\/api\\\/mindmaps\\\/\[\^\/\]\+\\\/stream\$/);
});
```

- [ ] **Step 2: Run** `node --test tests/offline/mindmap_live_ui.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `window.__mindmapLive = (sid) => { if (!(window.TF && window.TF.syncpull && window.TF.syncpull.pullMindmapOne)) return Promise.resolve(); return runSyncExclusive(() => window.TF.syncpull.pullMindmapOne(__syncRawFetch, sid)).then((res) => { if (!res) return; if (res.changed.length) window.dispatchEvent(new CustomEvent("mindmapSynced", { detail: { source: "live", cids: res.changed.map(c => c.cid), ids: res.changed.filter(c => c.server_id != null).map(c => c.server_id) } })); if (res.changed.length || res.deleted) window.dispatchEvent(new CustomEvent("mindmapSaved", { detail: { source: "live" } })); if (res.dirty || res.merged) return window.__pushNow(); }).then(() => renderConflicts()).catch(() => {}); };` (diakhiri `\n};` agar irisan tes cocok).
  - `noticeText`: `if (n.kind === "merge_conflict") return "✂ «" + title + "»: " + (n.count || 1) + " node diubah bersamaan oleh " + (n.editor || "pengguna lain") + (n.nodes && n.nodes.length ? " (" + n.nodes.join(", ") + ")" : "") + " — versimu disimpan sebagai '" + (n.copyTitle || "(konflik) " + title) + "'";`
  - Tab: `const baseDocRef = useRef(null); const remoteStaleRef = useRef(false); const remoteSeqRef = useRef(0); const pendingRemoteRef = useRef(new Map()); const [liveOn, setLiveOn] = useState(false);`. Pada efek muat tab (`[tab?.id]`, jalur peta biasa) → `baseDocRef.current = tab.data_json`. `applyRecordToTab(doc)`: alih-alih `postMessage({type:"load"…})` → `const seq = ++remoteSeqRef.current; pendingRemoteRef.current.set(seq, { data, dataStr: doc.data_json }); postMessage({ type: "remoteUpdate", data, title, seq })`; handler pesan iframe: `remoteApplied` → ambil entri seq → `setOutlineTree(data)`, arah/justify, `baseDocRef.current = dataStr`; `remoteSkipped` → `remoteStaleRef.current = true`. Bila tab dalam mode Outline (iframe tersembunyi) iframe tetap menerima pesan, jadi alurnya sama.
  - `doSave`: body `{ data_json: p.dataStr, if_updated_at: lastKnownAtRef.current, base_data_json: baseDocRef.current }`; setelah respons: `baseDocRef.current = p.dataStr`; bila `res.merged` → bila tidak ada `pendingSaveRef.current` → `applyRecordToTab(res)`; bila `res.merge_conflicts > 0 || res.conflict_copy` → toast spec §4 (`✂ Sebagian perubahanmu bentrok dengan …`) + `mindmapSaved` + `renderConflicts()`. Jalur `conflict_copy` lama (tanpa `merged`) tetap. Setelah simpan, bila `remoteStaleRef.current && !pendingSaveRef.current` → `remoteStaleRef.current = false; api.get(\`/api/mindmaps/${tab.id}\`).then(applyRecordToTab)`.
  - Handler `mindmapSynced` yang ada tetap (abaikan bila `pendingEditRef`), dan kini memakai `applyRecordToTab` (jadi `remoteUpdate`).
  - Efek EventSource `[tab?.id, tab?.list_id]`: `if (!tab || isLinked || tab.list_id == null || !/^\d+$/.test(String(tab.id))) return;` `const url = apiUrl(\`/api/mindmaps/${tab.id}/stream\`) + (API_BASE && __token ? \`?token=${encodeURIComponent(__token)}\` : "");` `const es = new EventSource(url); let opened = false; es.onopen = () => { setLiveOn(true); if (opened) window.__mindmapLive(Number(tab.id)); opened = true; }; es.onerror = () => setLiveOn(false);` `es.onmessage = e => { let ev; try { ev = JSON.parse(e.data); } catch (_) { return; } if (!ev || ev.type === "ping") return; if (ev.type === "mindmap_changed") { window.TF?.mindmaprepo && api.get(\`/api/mindmaps/${tab.id}\`).then(loc => { if (!loc || String(loc.updated_at) !== String(ev.updated_at)) window.__mindmapLive(Number(tab.id)); }).catch(() => window.__mindmapLive(Number(tab.id))); return; } if (ev.type === "mindmap_deleted" || ev.type === "mindmap_access_lost") { window.__mindmapLive(Number(tab.id)).then(() => api.get(\`/api/mindmaps/${tab.id}\`)).then(() => {}, () => { showToast(ev.type === "mindmap_deleted" ? "Peta ini dihapus oleh pemiliknya" : "Akses ke peta ini dicabut", "error"); onDeleteMindmap && onDeleteMindmap(tab.id); }); } }; return () => { es.close(); setLiveOn(false); };` (perbandingan `updated_at` memakai respons router lokal = `updated_at` record; bila record dirty, `__mindmapLive` tetap dipanggil karena berbeda → merge).
  - Header tab: `liveOn && React.createElement("span", { title: "Perubahan anggota lain tampil otomatis", style: { fontSize: 11, color: "var(--text-light)", flexShrink: 0 } }, "🟢 Langsung")`.
  - Iframe: di listener `message`: `if (e.data && e.data.type === 'remoteUpdate') { if (!mind) return; const box = document.getElementById('input-box'); if (box && box.isConnected && box.offsetParent !== null) { window.parent.postMessage({ type: 'remoteSkipped', seq: e.data.seq }, window.location.origin); return; } const selId = currentNodeId; hideNodeLinksPopover(); try { window.TF.mindmapops.exitFocusMode(mind); } catch (_) {} isJustifyActive = Boolean(e.data.data && e.data.data.justify); try { mind.refresh(e.data.data); } catch (_) {} const d = e.data.data && typeof e.data.data.direction === 'number' ? e.data.data.direction : mind.direction; if (d !== mind.direction) { try { if (d === 0) mind.initLeft(); else if (d === 1) mind.initRight(); else if (d === 3) mind.initDown(); else mind.initSide(); } catch (_) {} } if (selId) { try { mind.selectNode(mind.findEle(selId)); } catch (_) { currentNodeId = null; currentNodeData = null; hidePanel(); switchTab(null); } } if (isJustifyActive) setTimeout(applyJustifyLayout, 50); setTimeout(updateBadges, 300); window.parent.postMessage({ type: 'remoteApplied', seq: e.data.seq }, window.location.origin); return; }` — **jangan** memanggil `postChange()` (bukan edit pengguna).
  - `sw.js`: sebelum aturan `X-TF-Sync`, `if (/^\/api\/mindmaps\/[^/]+\/stream$/.test(url.pathname)) { e.respondWith(fetch(request).catch(() => new Response(JSON.stringify({ detail: "OFFLINE" }), { status: 503, headers: { "Content-Type": "application/json" } }))); return; }`.
- [ ] **Step 4: Run** `npm test`, kedua `check_inline_scripts.js` — Expected: PASS/OK.
- [ ] **Step 5: Commit**
  ```
  git add static/index.html static/vendor/mind-elixir/index.html static/sw.js tests/offline/mindmap_live_ui.test.js
  git commit -m "feat(mindmap): pembaruan langsung peta bersama di tab (SSE + remoteUpdate)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013t2wBZvFmWiPG5XEYKL44H"
  ```

### Task B6: rilis PR B

**Files:**
- Modify: `static/index.html` (tag `<script src="/static/offline/mindmapmerge.js"></script>` **sebelum** `mindmaprepo.js`; iframe `?v=144` → `?v=145` (cek nilai di main); `__SW_VERSION` + fallback), `static/sw.js` (`CACHE`; precache `/static/offline/mindmapmerge.js`), `webapp.py` (`sw_cache`), `tests/test_version.py` + tes versi lain, `.agents/*` (ADR baru: merge per node di klien + SSE sinyal), PR description
- Create: `temporary_files/e2e_mindmap_live.py`

- [ ] **Step 1:** `git fetch origin main`, pilih `taskflow-vNNN-mindmap-live` (NNN berikutnya setelah versi main), ganti di semua tempat.
- [ ] **Step 2:** Tambah tes ke `tests/offline/mindmap_live_ui.test.js`: `sw.js` precache memuat `mindmapmerge.js` dan `index.html` memuat tag script-nya sebelum `mindmaprepo.js`. Jalankan `npm test`, `python -m pytest tests/ -q`, kedua `check_inline_scripts.js`, cek border-left.
- [ ] **Step 3:** E2E Playwright dua user (dua browser context) pada peta bersama: (1) A mengubah node X, B mengubah node Y bersamaan → dalam ≤ 5 s keduanya melihat X dan Y, tidak ada "(konflik)"; (2) keduanya mengubah teks node yang sama → peta memakai versi yang tersimpan lebih dulu di server, pihak lain mendapat toast + salinan "(konflik)" + notice; (3) B sedang mengetik di node saat A menyimpan → ketikan B tidak hilang dan setelah B selesai keduanya tergabung; (4) A menghapus peta → tab B tertutup dengan toast; (5) B offline mengedit, A mengedit node lain, B online → tergabung. Tangkapan layar di `temporary_files/e2e_mindmap_live/`.
- [ ] **Step 4:** Perbarui `.agents/`, commit:
  ```
  git add -A
  git commit -m "chore(release): PR B temuan mindmap #4 — SW, precache, ADR" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_013t2wBZvFmWiPG5XEYKL44H"
  ```
  push, buka **draft** PR "feat(mindmap): kolaborasi langsung + merge per node (temuan #4)" dengan hasil tes/E2E, "deploy wajib `sudo systemctl restart taskflow-web`", dan penutup:
  ```
  🤖 Generated with [Claude Code](https://claude.com/claude-code)

  https://claude.ai/code/session_013t2wBZvFmWiPG5XEYKL44H
  ```
  Tunggu Bapak "merge dan deploy".

---

## Self-review (konsistensi antar task)

- A1 → A2: snapshot Sampah membaca `mindmap_pins`; restore memakai `_mindmap_enrich(…, uid)` dari A1. A2 → A3: `_mindmap_topics`/`_mindmap_plain` didefinisikan di A2, dipakai A3; restore A2 mengisi `search_text` hanya bila kolom ada (A3 menambahkannya) — tidak ada ketergantungan urutan yang rusak.
- A4 → A5: op `restore` (cid `trash:<sid>`, `payload.server_id`) dibuat A4, diproses A5; `markRestoreResult` didefinisikan A4. A5 `pullMindmapTrash` → A8 memanggilnya dari modal.
- A6 → A7/A8: `linkDisplay`, `linkKey`, `collectLinkRefs`, `resolveLinkInfo`, `UNAVAILABLE_TITLE`, `filterExistingTargets`, `filterSidebar` dipakai dengan nama yang sama. A3 menambah `client_id` di `/api/search`; A4 menambah `client_id` di meta router lokal → `filterExistingTargets` bekerja online & offline.
- B1 → B3: `merge3`, `merge3Scalar` (nama & bentuk hasil sama). B3 → B4: `mergeServerIntoLocal` (`{original, copy, merged, conflicts}`), `setBaseFromServer`. B4 → B5: `pullMindmapOne` (`{changed, merged, deleted, dirty}`), `result.requeued`. B2 → B5: event `mindmap_changed/deleted/access_lost/ping`, path `/api/mindmaps/{id}/stream`.
- Versi: PR A menaikkan SW sekali (A9) dan iframe ke 144 (A7 mengubah iframe); PR B menaikkan SW sekali (B6) dan iframe ke 145 (B5 mengubah iframe). `app.css` tidak disentuh (gaya inline) — naikkan hanya bila implementer menambah CSS di sana.
- Tes lama yang mungkin perlu disesuaikan: tes PATCH pin push (A5, body baru), tes yang mengharapkan `DELETE /api/mindmaps/{id}` non-ada → 403 (A2 kini 404), tes versi SW (A9/B6). Tes salinan konflik lama tetap lulus karena record tanpa `base_data_json` memakai jalur lama.
