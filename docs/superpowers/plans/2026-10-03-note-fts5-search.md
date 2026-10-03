# SQLite FTS5 Search & Tag Operators (`tag:`, `-tag:`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menggantikan pencarian catatan `LIKE '%q%'` dengan SQLite FTS5 full-text search, mendukung operator `tag:<nama>` dan `-tag:<nama>` pada backend (`GET /api/scratchpad?q=...`) serta filter offline in-memory pada frontend (`static/index.html`).

**Architecture:** Menggunakan SQLite FTS5 External Content Virtual Table `scratchpad_notes_fts` dengan database triggers otomatis (INSERT/UPDATE/DELETE). Backend `webapp.py` membedah kueri menjadi tag positif, tag negatif, dan query teks FTS5 yang disanitasi dengan fallback ke `LIKE`. Frontend `static/index.html` memperbarui `parseQuery` dan `applyFilters` untuk mendukung `-tag:` secara instan offline, dengan cache version bump ke `v349`.

**Tech Stack:** Python 3.10+, FastAPI, SQLite FTS5 (`unicode61`), Vanilla JS / Preact, Service Worker, Node.js test runner, Pytest.

## Global Constraints
- **Multi-user isolation:** Setiap kueri wajib menyertakan `_note_access_clause(uid, prefix="s")`.
- **Zero data loss & safe syntax:** Kueri pencarian dengan simbol khusus (kutip ganjil, kurung, bintang) tidak boleh menghasilkan SQLite OperationalError 500.
- **Offline-first:** UI tidak boleh bergantung pada koneksi internet untuk pencarian catatan yang sudah dimuat ke cache klien.
- **Service Worker version:** Bump ke `taskflow-v349-fts5-tag-search`.
- **No cowboy coding:** Wajib dijalankan via subagent dan diverifikasi test suite lengkap (`pytest` dan `node --test`).

---

### Task 1: Database Migration for FTS5 & Triggers

**Files:**
- Modify: `webapp.py:254-350` (`migrate_db`)
- Test: `tests/test_note_fts_search.py`

**Interfaces:**
- Produces: `scratchpad_notes_fts` virtual table, triggers `trg_scratchpad_notes_ai`, `trg_scratchpad_notes_ad`, `trg_scratchpad_notes_au`.

- [ ] **Step 1: Write the failing test for FTS5 table & triggers**

Create `tests/test_note_fts_search.py`:
```python
import sqlite3
import pytest
from webapp import migrate_db
from config import DB_PATH

def test_fts5_virtual_table_and_triggers_exist():
    migrate_db()
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        # Check FTS5 table
        tbl = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='scratchpad_notes_fts'"
        ).fetchone()
        assert tbl is not None, "scratchpad_notes_fts table must exist"

        # Check triggers
        triggers = {
            r["name"] for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='scratchpad_notes'"
            ).fetchall()
        }
        assert "trg_scratchpad_notes_ai" in triggers
        assert "trg_scratchpad_notes_ad" in triggers
        assert "trg_scratchpad_notes_au" in triggers
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_note_fts_search.py::test_fts5_virtual_table_and_triggers_exist -v`
Expected: FAIL with assertion error.

- [ ] **Step 3: Implement minimal code in `migrate_db()`**

In `webapp.py` within `migrate_db()`:
```python
        # Ensure FTS5 virtual table for scratchpad_notes exists
        fts_exists = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='scratchpad_notes_fts'"
        ).fetchone()
        if not fts_exists:
            conn.execute("""
                CREATE VIRTUAL TABLE IF NOT EXISTS scratchpad_notes_fts USING fts5(
                    title,
                    content,
                    content='scratchpad_notes',
                    content_rowid='id',
                    tokenize='unicode61'
                )
            """)
            conn.execute("INSERT INTO scratchpad_notes_fts(scratchpad_notes_fts) VALUES('rebuild')")

        # Ensure FTS triggers exist
        conn.execute("""
            CREATE TRIGGER IF NOT EXISTS trg_scratchpad_notes_ai AFTER INSERT ON scratchpad_notes BEGIN
                INSERT INTO scratchpad_notes_fts(rowid, title, content)
                VALUES (new.id, new.title, new.content);
            END;
        """)
        conn.execute("""
            CREATE TRIGGER IF NOT EXISTS trg_scratchpad_notes_ad AFTER DELETE ON scratchpad_notes BEGIN
                INSERT INTO scratchpad_notes_fts(scratchpad_notes_fts, rowid, title, content)
                VALUES ('delete', old.id, old.title, old.content);
            END;
        """)
        conn.execute("""
            CREATE TRIGGER IF NOT EXISTS trg_scratchpad_notes_au AFTER UPDATE ON scratchpad_notes BEGIN
                INSERT INTO scratchpad_notes_fts(scratchpad_notes_fts, rowid, title, content)
                VALUES ('delete', old.id, old.title, old.content);
                INSERT INTO scratchpad_notes_fts(rowid, title, content)
                VALUES (new.id, new.title, new.content);
            END;
        """)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_note_fts_search.py::test_fts5_virtual_table_and_triggers_exist -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add webapp.py tests/test_note_fts_search.py
git commit -m "feat(fts): add SQLite FTS5 virtual table and synchronization triggers for notes"
```

---

### Task 2: Backend Query Parser & Search API

**Files:**
- Modify: `webapp.py:3324-3353` (`_parse_note_search_query` and `list_scratchpad`)
- Test: `tests/test_note_fts_search.py`

**Interfaces:**
- Consumes: `scratchpad_notes_fts`, `_note_access_clause`, `entity_tags`, `tags`
- Produces: `_parse_note_search_query(q: str, tag: str) -> tuple[list[str], list[str], str, str]`, updated `GET /api/scratchpad` endpoint.

- [ ] **Step 1: Write comprehensive failing tests for search API**

In `tests/test_note_fts_search.py`, add:
```python
def test_note_fts_search_and_operators(client, auth_headers):
    # Setup notes
    # Note 1: work, project
    client.post("/api/scratchpad", json={"title": "Laporan Mingguan Finansial", "content": "Rincian anggaran operasional", "tags": ["kerja", "finansial"]}, headers=auth_headers)
    # Note 2: personal, archive
    client.post("/api/scratchpad", json={"title": "Rencana Liburan", "content": "Tiket pesawat dan hotel", "tags": ["pribadi", "arsip"]}, headers=auth_headers)
    # Note 3: work, archive
    client.post("/api/scratchpad", json={"title": "Arsip Proyek Lama", "content": "Dokumentasi anggaran 2025", "tags": ["kerja", "arsip"]}, headers=auth_headers)

    # 1. Plain text FTS search
    r = client.get("/api/scratchpad?q=anggaran", headers=auth_headers)
    assert r.status_code == 200
    titles = [n["title"] for n in r.json()]
    assert "Laporan Mingguan Finansial" in titles
    assert "Arsip Proyek Lama" in titles
    assert "Rencana Liburan" not in titles

    # 2. Prefix search (lapor -> Laporan)
    r = client.get("/api/scratchpad?q=lapor", headers=auth_headers)
    assert any("Laporan" in n["title"] for n in r.json())

    # 3. Positive tag operator: tag:kerja
    r = client.get("/api/scratchpad?q=tag:kerja", headers=auth_headers)
    titles = [n["title"] for n in r.json()]
    assert "Laporan Mingguan Finansial" in titles
    assert "Arsip Proyek Lama" in titles
    assert "Rencana Liburan" not in titles

    # 4. Negative tag operator: -tag:arsip
    r = client.get("/api/scratchpad?q=-tag:arsip", headers=auth_headers)
    titles = [n["title"] for n in r.json()]
    assert "Laporan Mingguan Finansial" in titles
    assert "Rencana Liburan" not in titles
    assert "Arsip Proyek Lama" not in titles

    # 5. Combined: tag:kerja -tag:arsip anggaran
    r = client.get("/api/scratchpad?q=tag:kerja -tag:arsip anggaran", headers=auth_headers)
    titles = [n["title"] for n in r.json()]
    assert titles == ["Laporan Mingguan Finansial"]

    # 6. Resilience against weird characters
    r = client.get('/api/scratchpad?q=anggaran "unclosed : * ( )', headers=auth_headers)
    assert r.status_code == 200
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_note_fts_search.py::test_note_fts_search_and_operators -v`
Expected: FAIL

- [ ] **Step 3: Implement `_parse_note_search_query` and updated `list_scratchpad`**

In `webapp.py`:
```python
import re

def _sanitize_fts5_token(token: str) -> str:
    cleaned = re.sub(r'[^\w\s-]', '', token).strip()
    if not cleaned:
        return ""
    return f'"{cleaned}"*'

def _parse_note_search_query(q: str = "", tag: str = "") -> tuple[list[str], list[str], str, str]:
    positive_tags = []
    if tag and tag.strip():
        positive_tags.append(tag.strip().lower())
    
    negative_tags = []
    if q:
        neg_matches = re.findall(r'(?:^|\s)-tag:(\S+)', q, flags=re.IGNORECASE)
        for t in neg_matches:
            nt = t.strip().lower()
            if nt and nt not in negative_tags:
                negative_tags.append(nt)
        
        pos_matches = re.findall(r'(?:^|\s)tag:(\S+)', q, flags=re.IGNORECASE)
        for t in pos_matches:
            pt = t.strip().lower()
            if pt and pt not in positive_tags:
                positive_tags.append(pt)
                
        # Clean text
        clean = re.sub(r'(?:^|\s)-tag:\S+', ' ', q, flags=re.IGNORECASE)
        clean = re.sub(r'(?:^|\s)tag:\S+', ' ', clean, flags=re.IGNORECASE).strip()
    else:
        clean = ""

    # Build FTS match expression
    fts_parts = []
    if clean:
        words = clean.split()
        for w in words:
            san = _sanitize_fts5_token(w)
            if san:
                fts_parts.append(san)
    fts_query = " ".join(fts_parts)

    return positive_tags, negative_tags, clean, fts_query
```

Update `list_scratchpad`:
```python
@app.get("/api/scratchpad")
async def list_scratchpad(q: str = "", tag: str = "", user=Depends(get_current_user)):
    uid = user["sub"]
    access_clause, access_params = _note_access_clause(uid, prefix="s")
    pos_tags, neg_tags, clean_text, fts_query = _parse_note_search_query(q, tag)

    with get_db() as conn:
        where_clauses = [f"({access_clause})"]
        params = list(access_params)

        for pt in pos_tags:
            where_clauses.append("""
                EXISTS (
                    SELECT 1 FROM entity_tags et
                    JOIN tags t ON t.id = et.tag_id
                    WHERE et.entity_id = s.id AND et.entity_type = 'note' AND t.name = ?
                )
            """)
            params.append(pt)

        for nt in neg_tags:
            where_clauses.append("""
                NOT EXISTS (
                    SELECT 1 FROM entity_tags et
                    JOIN tags t ON t.id = et.tag_id
                    WHERE et.entity_id = s.id AND et.entity_type = 'note' AND t.name = ?
                )
            """)
            params.append(nt)

        if fts_query:
            where_clauses.append("fts.scratchpad_notes_fts MATCH ?")
            params.append(fts_query)
            sql = f"""
                SELECT s.* FROM scratchpad_notes s
                JOIN scratchpad_notes_fts fts ON fts.rowid = s.id
                WHERE {' AND '.join(where_clauses)}
                ORDER BY fts.rank, s.updated_at DESC
            """
            try:
                rows = conn.execute(sql, params).fetchall()
                return [_scratchpad_row(r, conn, uid) for r in rows]
            except sqlite3.OperationalError:
                pass  # Fallback to LIKE query if FTS expression fails
        
        # Fallback / non-FTS query
        fallback_clauses = [f"({access_clause})"]
        fallback_params = list(access_params)
        for pt in pos_tags:
            fallback_clauses.append("""
                EXISTS (
                    SELECT 1 FROM entity_tags et
                    JOIN tags t ON t.id = et.tag_id
                    WHERE et.entity_id = s.id AND et.entity_type = 'note' AND t.name = ?
                )
            """)
            fallback_params.append(pt)
        for nt in neg_tags:
            fallback_clauses.append("""
                NOT EXISTS (
                    SELECT 1 FROM entity_tags et
                    JOIN tags t ON t.id = et.tag_id
                    WHERE et.entity_id = s.id AND et.entity_type = 'note' AND t.name = ?
                )
            """)
            fallback_params.append(nt)
        if clean_text:
            fallback_clauses.append("(s.title LIKE ? OR s.content LIKE ?)")
            fallback_params.extend([f"%{clean_text}%", f"%{clean_text}%"])
        
        sql = f"""
            SELECT s.* FROM scratchpad_notes s
            WHERE {' AND '.join(fallback_clauses)}
            ORDER BY s.updated_at DESC
        """
        rows = conn.execute(sql, fallback_params).fetchall()
        return [_scratchpad_row(r, conn, uid) for r in rows]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_note_fts_search.py -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add webapp.py tests/test_note_fts_search.py
git commit -m "feat(api): implement FTS5 search and tag / -tag operators for scratchpad notes"
```

---

### Task 3: Frontend Client Integration & Offline Filters

**Files:**
- Modify: `static/index.html:21890-22030`
- Modify: `static/sw.js:5` (bump to `taskflow-v349-fts5-tag-search`)
- Test: `tests/offline/note_search_filters.test.js`
- Test sync: `tests/offline/drawing_sync_ui.test.js`, `tests/offline/interactive_note_viewer.test.js`

**Interfaces:**
- Produces: `parseQuery` supporting `-tag:`, `applyFilters` and `applyFiltersStatic` supporting `negativeTags`.

- [ ] **Step 1: Write JS unit tests for client search parsing and offline filtering**

Create `tests/offline/note_search_filters.test.js`:
```javascript
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

test("parseQuery and applyFilters offline in static/index.html", async (t) => {
  const indexHtml = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");

  await t.test("parseQuery extracts syntaxTags, negativeTags, and cleanQuery", () => {
    assert.match(indexHtml, /negativeTags/);
    assert.match(indexHtml, /-tag:(\S+)/);
  });

  await t.test("applyFilters filters out negativeTags", () => {
    assert.match(indexHtml, /negativeTags\.includes|ntag/);
  });
});
```

- [ ] **Step 2: Update `static/index.html`**

Update `parseQuery`, `applyFiltersStatic`, and `applyFilters`:
Include `negativeTags` extraction and exclusion in `applyFiltersStatic` and `applyFilters`.

- [ ] **Step 3: Bump SW cache version in `static/sw.js`**

Change CACHE_NAME in `static/sw.js` to:
`taskflow-v349-fts5-tag-search`

Update test assertions expecting the SW cache name in:
`tests/offline/drawing_sync_ui.test.js`
`tests/offline/interactive_note_viewer.test.js`
`tests/offline/notetrash.test.js`

- [ ] **Step 4: Run JS unit tests and syntax checks**

Run:
```bash
node scratch/check_inline.js static/index.html
node --check static/sw.js
node --test tests/offline/note_search_filters.test.js
node --test tests/offline/*.test.js
```
Expected: PASS (all scripts and test suites pass).

- [ ] **Step 5: Commit**

```bash
git add static/index.html static/sw.js tests/offline/
git commit -m "feat(client): support -tag: operator in offline note search and bump SW to v349"
```

---

### Task 4: Full Regression Testing & Verification

- [ ] **Step 1: Run full Python pytest suite**
Run: `python -m pytest tests/`
Expected: 92+ tests pass, 0 fail.

- [ ] **Step 2: Run full JS offline test suite**
Run: `node --test tests/offline/*.test.js`
Expected: All suites pass, 0 fail.

- [ ] **Step 3: Verify git status and diff**
Run: `git status`

---

### Task 5: Handover, Push, & Deployment Guidance

- [ ] **Step 1: Push commits to remote origin**
Run: `git push origin main`

- [ ] **Step 2: Update documentation**
Update `.agents/CURRENT_STATE.md` and `.agents/SESSION_LOG.md`.

- [ ] **Step 3: Provide VPS deploy instructions to user**
Notes on VPS restart: `sudo systemctl restart taskflow-web` to apply FTS5 tables & triggers.
