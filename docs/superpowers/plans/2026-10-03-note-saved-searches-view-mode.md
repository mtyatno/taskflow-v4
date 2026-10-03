# Note Saved Searches & View Mode Toggle (Card vs. Compact) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambahkan fitur Saved Searches (Pencarian Tersimpan yang tersinkronisasi antar-perangkat dan offline) serta Toggle View Mode (Card vs. Compact) pada modul Catatan (Notes).

**Architecture:** Tabel database `note_saved_searches` di SQLite dikelola via `migrate_db()` dan diakses melalui endpoint REST API `/api/scratchpad/saved-searches`. Di sisi klien, `viewMode` disimpan di `localStorage` per-perangkat dan menerapkan styling `.note-card--compact` pada `static/app.css`. Saved searches di-cache di IndexedDB (`OfflineDB`), dirender sebagai deretan chip horizontal di bawah bar pencarian dengan tombol hapus, dan tombol bintang ⭐ di bar pencarian untuk menyimpan kueri aktif.

**Tech Stack:** Python 3.10+, FastAPI, SQLite, Vanilla JS / Preact, CSS3, Service Worker, Node.js test runner, Pytest.

## Global Constraints
- **Multi-user isolation:** Setiap kueri saved search wajib terikat dengan `user_id = user["sub"]`.
- **Offline-first:** PWA harus dapat menampilkan daftar catatan dan filter view mode secara offline.
- **Service Worker version:** Bump ke `taskflow-v350-note-saved-searches-view-mode`.
- **No cowboy coding:** Dikerjakan via subagent dan diverifikasi test suite lengkap (`pytest` dan `node --test`).

---

### Task 1: Backend Database Migration & API Endpoints for Saved Searches

**Files:**
- Modify: `webapp.py` (in `migrate_db()` and endpoints around line 3350)
- Test: `tests/test_note_saved_searches.py`

**Interfaces:**
- Produces: `note_saved_searches` table, endpoints `GET`, `POST`, and `DELETE /api/scratchpad/saved-searches`.

- [ ] **Step 1: Write failing tests for saved searches backend**

Create `tests/test_note_saved_searches.py`:
```python
import pytest
from fastapi.testclient import TestClient
from webapp import app, migrate_db

@pytest.fixture(autouse=True)
def run_migration():
    migrate_db()

@pytest.fixture
def client():
    return TestClient(app)

def _auth_user(client, username="user_search_a"):
    client.post("/api/register", json={"username": username, "password": "password123"})
    res = client.post("/api/login", json={"username": username, "password": "password123"})
    token = res.json()["token"]
    return {"Authorization": f"Bearer {token}"}

def test_saved_searches_crud_and_isolation(client):
    headers_a = _auth_user(client, "user_search_a")
    headers_b = _auth_user(client, "user_search_b")

    # 1. Initially empty
    res = client.get("/api/scratchpad/saved-searches", headers=headers_a)
    assert res.status_code == 200
    assert res.json() == []

    # 2. Validation: empty name or query returns 400
    res = client.post("/api/scratchpad/saved-searches", json={"name": "", "query": "tag:kerja"}, headers=headers_a)
    assert res.status_code == 400
    res = client.post("/api/scratchpad/saved-searches", json={"name": "Kerja", "query": ""}, headers=headers_a)
    assert res.status_code == 400

    # 3. Create saved search
    res = client.post("/api/scratchpad/saved-searches", json={"name": "Laporan Aktif", "query": "tag:kerja -tag:arsip laporan"}, headers=headers_a)
    assert res.status_code == 200
    item_a = res.json()
    assert item_a["name"] == "Laporan Aktif"
    assert item_a["query"] == "tag:kerja -tag:arsip laporan"
    assert "id" in item_a

    # 4. List saved searches
    res = client.get("/api/scratchpad/saved-searches", headers=headers_a)
    items = res.json()
    assert len(items) == 1
    assert items[0]["name"] == "Laporan Aktif"

    # 5. User isolation: user B cannot see user A's saved search
    res_b = client.get("/api/scratchpad/saved-searches", headers=headers_b)
    assert res_b.json() == []

    # User B cannot delete user A's saved search
    del_b = client.delete(f"/api/scratchpad/saved-searches/{item_a['id']}", headers=headers_b)
    assert del_b.status_code == 404

    # 6. User A deletes saved search
    del_a = client.delete(f"/api/scratchpad/saved-searches/{item_a['id']}", headers=headers_a)
    assert del_a.status_code == 200

    # List is now empty
    res = client.get("/api/scratchpad/saved-searches", headers=headers_a)
    assert res.json() == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_note_saved_searches.py -v`
Expected: FAIL (table / endpoints do not exist).

- [ ] **Step 3: Implement database migration and API endpoints**

1. In `webapp.py` (`migrate_db()`):
```python
        conn.execute("""
            CREATE TABLE IF NOT EXISTS note_saved_searches (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name       TEXT NOT NULL,
                query      TEXT NOT NULL,
                created_at TEXT NOT NULL
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_note_saved_searches_user ON note_saved_searches(user_id, created_at)")
```

2. In `webapp.py`, add endpoints:
```python
@app.get("/api/scratchpad/saved-searches")
async def list_saved_searches(user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        rows = conn.execute(
            "SELECT id, name, query, created_at FROM note_saved_searches WHERE user_id = ? ORDER BY created_at DESC",
            (uid,)
        ).fetchall()
        return [dict(r) for r in rows]

@app.post("/api/scratchpad/saved-searches")
async def create_saved_search(payload: dict, user=Depends(get_current_user)):
    uid = user["sub"]
    name = (payload.get("name") or "").strip()
    query = (payload.get("query") or "").strip()
    if not name or not query:
        raise HTTPException(status_code=400, detail="Nama dan kueri pencarian wajib diisi")
    now_iso = datetime.now(_TZ_JKT).isoformat()
    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO note_saved_searches (user_id, name, query, created_at) VALUES (?, ?, ?, ?)",
            (uid, name, query, now_iso)
        )
        return {"id": cur.lastrowid, "name": name, "query": query, "created_at": now_iso}

@app.delete("/api/scratchpad/saved-searches/{sid}")
async def delete_saved_search(sid: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        row = conn.execute(
            "SELECT id FROM note_saved_searches WHERE id = ? AND user_id = ?",
            (sid, uid)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Pencarian tersimpan tidak ditemukan")
        conn.execute("DELETE FROM note_saved_searches WHERE id = ?", (sid,))
        return {"ok": True}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_note_saved_searches.py -v`
Expected: ALL PASS.

- [ ] **Step 5: Commit**

```bash
git add webapp.py tests/test_note_saved_searches.py
git commit -m "feat(api): add database migration and CRUD endpoints for note saved searches"
```

---

### Task 2: Frontend View Mode Toggle (Card vs. Compact)

**Files:**
- Modify: `static/app.css`
- Modify: `static/index.html` (in `NotesPage` header and `.note-card` rendering)
- Test: `tests/offline/note_saved_searches_view_mode.test.js`

**Interfaces:**
- Produces: `viewMode` state persisted in `localStorage`, CSS rules for `.note-card--compact`.

- [ ] **Step 1: Write failing JS tests for view mode**

Create `tests/offline/note_saved_searches_view_mode.test.js`:
```javascript
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

test("View Mode Toggle and CSS in NotesPage", async (t) => {
  const indexHtml = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");
  const appCss = fs.readFileSync(path.join(__dirname, "../../static/app.css"), "utf8");

  await t.test("app.css defines compact view rules", () => {
    assert.match(appCss, /\.note-card--compact/);
    assert.match(appCss, /\.note-card--compact\s+\.note-card-preview\s*\{[^}]*display:\s*none/);
  });

  await t.test("index.html defines viewMode state and toggle button", () => {
    assert.match(indexHtml, /tf_notes_view_mode/);
    assert.match(indexHtml, /note-card--compact/);
  });
});
```

- [ ] **Step 2: Add CSS rules in `static/app.css`**

In `static/app.css`:
```css
/* Compact Note Card View */
.note-card.note-card--compact {
  padding: 8px 10px;
  gap: 4px;
}
.note-card.note-card--compact .note-card-preview {
  display: none !important;
}
.note-card.note-card--compact .note-card-title {
  font-size: 13px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

- [ ] **Step 3: Update `static/index.html` with `viewMode` toggle**

1. In `NotesPage`:
```javascript
const [viewMode, setViewMode] = useState(() => localStorage.getItem("tf_notes_view_mode") || "card");
const toggleViewMode = () => {
  const next = viewMode === "card" ? "compact" : "card";
  setViewMode(next);
  try { localStorage.setItem("tf_notes_view_mode", next); } catch (_) {}
};
```
2. In header toolbar (next to `sortBy` select, before trash button):
```javascript
React.createElement("button", {
  className: "btn btn-icon btn-sm",
  onClick: toggleViewMode,
  title: viewMode === "card" ? "Beralih ke Tampilan Ringkas (Compact)" : "Beralih ke Tampilan Kartu (Card)",
  "aria-label": "Toggle view mode",
  style: { height: 28, width: 28, fontSize: 13 }
}, viewMode === "card" ? "☰" : "▤")
```
3. In note item rendering:
```javascript
className: `note-card${viewMode === "compact" ? " note-card--compact" : ""}`
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/offline/note_saved_searches_view_mode.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add static/app.css static/index.html tests/offline/note_saved_searches_view_mode.test.js
git commit -m "feat(ui): add compact list view mode toggle for notes"
```

---

### Task 3: Frontend Saved Searches Integration & Service Worker v350

**Files:**
- Modify: `static/index.html` (saved searches state, star button, prompt dialog, chips bar)
- Modify: `static/sw.js` (bump cache version to `taskflow-v350-note-saved-searches-view-mode`)
- Modify: `tests/offline/note_saved_searches_view_mode.test.js`
- Test sync: `tests/offline/drawing_sync_ui.test.js`, `tests/offline/interactive_note_viewer.test.js`, `tests/offline/note_search_filters.test.js`

**Interfaces:**
- Produces: interactive Saved Searches UI in `NotesPage` and bumped Service Worker cache.

- [ ] **Step 1: Add JS unit tests for saved searches UI**

In `tests/offline/note_saved_searches_view_mode.test.js`, add:
```javascript
test("Saved Searches UI and SW v350", async (t) => {
  const indexHtml = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");
  const swJs = fs.readFileSync(path.join(__dirname, "../../static/sw.js"), "utf8");

  await t.test("index.html handles saved searches api and chips", () => {
    assert.match(indexHtml, /\/api\/scratchpad\/saved-searches/);
    assert.match(indexHtml, /savedSearches/);
  });

  await t.test("sw.js bumped to taskflow-v350-note-saved-searches-view-mode", () => {
    assert.match(swJs, /taskflow-v350-note-saved-searches-view-mode/);
  });
});
```

- [ ] **Step 2: Implement Saved Searches UI in `static/index.html`**

1. State & loading:
```javascript
const [savedSearches, setSavedSearches] = useState([]);
const fetchSavedSearches = async () => {
  const cached = await OfflineDB.cacheGet("note_saved_searches");
  if (cached) setSavedSearches(cached);
  try {
    const res = await api.get("/api/scratchpad/saved-searches");
    if (res && Array.isArray(res)) {
      setSavedSearches(res);
      await OfflineDB.cacheSet("note_saved_searches", res);
    }
  } catch (_) {}
};
useEffect(() => {
  fetchSavedSearches();
}, []);
```

2. Save action (Star button in search bar):
```javascript
const handleSaveSearch = async () => {
  if (!q.trim()) return;
  const name = window.prompt("Beri nama untuk pencarian tersimpan ini:", q.trim());
  if (!name || !name.trim()) return;
  try {
    const created = await api.post("/api/scratchpad/saved-searches", { name: name.trim(), query: q.trim() });
    const next = [created, ...savedSearches];
    setSavedSearches(next);
    await OfflineDB.cacheSet("note_saved_searches", next);
    showToast("⭐ Pencarian tersimpan!", "success");
  } catch (err) {
    showToast("Gagal menyimpan pencarian", "error");
  }
};
```
Render star button in `.scratchpad-bar` when `q.trim()` is not empty.

3. Delete saved search:
```javascript
const handleDeleteSavedSearch = async (e, s) => {
  e.stopPropagation();
  if (!window.confirm(`Hapus pencarian tersimpan "${s.name}"?`)) return;
  try {
    await api.del(`/api/scratchpad/saved-searches/${s.id}`);
    const next = savedSearches.filter(item => item.id !== s.id);
    setSavedSearches(next);
    await OfflineDB.cacheSet("note_saved_searches", next);
    showToast("Pencarian tersimpan dihapus", "info");
  } catch (err) {
    showToast("Gagal menghapus pencarian", "error");
  }
};
```

4. Render chips bar:
Directly below `.scratchpad-bar`, if `savedSearches.length > 0`, render horizontal scrollable chips:
- Click chip: `handleSearch(s.query)`.
- Active styling if `q === s.query`.
- Delete `×` button.

- [ ] **Step 3: Bump SW cache version and sync test files**

In `static/sw.js`:
Change cache name to `taskflow-v350-note-saved-searches-view-mode`.

Update cache name assertions in:
- `tests/offline/drawing_sync_ui.test.js`
- `tests/offline/interactive_note_viewer.test.js`
- `tests/offline/note_search_filters.test.js`

- [ ] **Step 4: Run JS verification commands**

Run:
```bash
node scratch/check_inline.js static/index.html
node --check static/sw.js
node --test tests/offline/note_saved_searches_view_mode.test.js
node --test tests/offline/*.test.js
```
Expected: All pass.

- [ ] **Step 5: Commit**

```bash
git add static/index.html static/sw.js tests/offline/
git commit -m "feat(client): integrate saved searches chips, star save button, and bump SW to v350"
```

---

### Task 4: Full Regression Testing & Verification

- [ ] **Step 1: Run full Python pytest suite**
Run: `python -m pytest tests/`
Expected: 95+ tests pass, 0 fail.

- [ ] **Step 2: Run full JS offline test suite**
Run: `node --test tests/offline/*.test.js`
Expected: All suites pass, 0 fail.

---

### Task 5: Handover, Push, & Deployment Guidance

- [ ] **Step 1: Push commits to remote origin**
Run: `git push origin main`

- [ ] **Step 2: Update documentation**
Update `.agents/CURRENT_STATE.md` and `.agents/SESSION_LOG.md`.
