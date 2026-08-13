# Universal Tag System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrasi tag dari JSON array di `scratchpad_notes.tags` ke sistem tag universal berbasis tabel relasional yang dapat digunakan bersama oleh semua entitas (note, task, habit, dll).

**Architecture:** Dua tabel baru — `tags` (master) dan `entity_tags` (polymorphic junction dengan `entity_type` + `entity_id`) — dilengkapi trigger SQLite untuk auto-cleanup dan index untuk performa. Frontend Notes mendapat tag normalization (lowercase) dan dropdown suggest saat ketik `#`.

**Tech Stack:** SQLite (triggers, index), FastAPI (Python), React (frontend SPA di `static/index.html`)

---

## File Map

| File | Aksi | Tanggung Jawab |
|------|------|----------------|
| `webapp.py` | Modify | Schema migration, tag API endpoints, refactor scratchpad endpoints |
| `static/index.html` | Modify | Tag normalization, dropdown suggest, fetch dari API tag |
| `schema-db.md` | Modify | Update dokumentasi schema |

---

## FASE 1 — Schema Migration & Data Migration

### Task 1: Buat tabel `tags` dan `entity_tags` di `_init_db()`

**Files:**
- Modify: `webapp.py` (fungsi `_init_db()`, sekitar baris 45–300)

- [ ] **Step 1: Tambah CREATE TABLE di `_init_db()`**

Buka `webapp.py`, cari bagian terakhir dari `_init_db()` (sekitar baris 280–295, tepat sebelum baris `conn.execute("ALTER TABLE scratchpad_notes ADD COLUMN linked_to..."`). Tambahkan setelah blok `scratchpad_notes`:

```python
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS tags (
                        id         INTEGER PRIMARY KEY AUTOINCREMENT,
                        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                        name       TEXT NOT NULL,
                        color      TEXT DEFAULT NULL,
                        created_at TEXT DEFAULT (datetime('now')),
                        UNIQUE(user_id, name)
                    )
                """)
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS entity_tags (
                        tag_id      INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                        user_id     INTEGER NOT NULL,
                        entity_type TEXT NOT NULL CHECK(entity_type IN ('note','task','habit','goal','message')),
                        entity_id   INTEGER NOT NULL,
                        created_at  TEXT DEFAULT (datetime('now')),
                        PRIMARY KEY (tag_id, entity_type, entity_id)
                    )
                """)
                conn.execute("CREATE INDEX IF NOT EXISTS idx_entity_tags_lookup   ON entity_tags(entity_type, entity_id)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_entity_tags_tag      ON entity_tags(tag_id)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_entity_tags_user     ON entity_tags(user_id)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_entity_tags_tag_user ON entity_tags(tag_id, user_id)")
```

- [ ] **Step 2: Tambah SQLite triggers di `_init_db()`**

Tambahkan tepat setelah index di atas:

```python
                conn.execute("""
                    CREATE TRIGGER IF NOT EXISTS trg_delete_task_tags
                    AFTER DELETE ON tasks FOR EACH ROW BEGIN
                        DELETE FROM entity_tags WHERE entity_type='task' AND entity_id=OLD.id AND user_id=OLD.user_id;
                    END
                """)
                conn.execute("""
                    CREATE TRIGGER IF NOT EXISTS trg_delete_note_tags
                    AFTER DELETE ON scratchpad_notes FOR EACH ROW BEGIN
                        DELETE FROM entity_tags WHERE entity_type='note' AND entity_id=OLD.id AND user_id=OLD.user_id;
                    END
                """)
                conn.execute("""
                    CREATE TRIGGER IF NOT EXISTS trg_delete_habit_tags
                    AFTER DELETE ON habits FOR EACH ROW BEGIN
                        DELETE FROM entity_tags WHERE entity_type='habit' AND entity_id=OLD.id AND user_id=OLD.user_id;
                    END
                """)
```

- [ ] **Step 3: Verifikasi schema terbuat**

Di VPS setelah deploy:
```bash
sqlite3 taskflow.db ".tables"
# Expected: ... entity_tags ... tags ...

sqlite3 taskflow.db ".schema tags"
sqlite3 taskflow.db ".schema entity_tags"
```

- [ ] **Step 4: Commit**

```bash
git add webapp.py
git commit -m "feat: add tags and entity_tags tables with triggers and indexes"
```

---

### Task 2: Migrasi data existing — `scratchpad_notes.tags` → `tags` + `entity_tags`

**Files:**
- Modify: `webapp.py` (fungsi `migrate_db()`, sekitar baris 77)

- [ ] **Step 1: Tambah fungsi helper `_upsert_tags_for_note()`**

Tambahkan fungsi ini di `webapp.py` tepat sebelum `migrate_db()`:

```python
def _upsert_tags_for_note(conn, note_id: int, user_id: int, tag_names: list[str]):
    """Upsert tags dan relasi entity_tags untuk satu note. Tag dinormalisasi lowercase+trim."""
    now = datetime.utcnow().isoformat()
    for raw in tag_names:
        name = raw.strip().lower()
        if not name:
            continue
        conn.execute(
            "INSERT OR IGNORE INTO tags (user_id, name, created_at) VALUES (?, ?, ?)",
            (user_id, name, now)
        )
        tag_row = conn.execute(
            "SELECT id FROM tags WHERE user_id = ? AND name = ?", (user_id, name)
        ).fetchone()
        if tag_row:
            conn.execute(
                "INSERT OR IGNORE INTO entity_tags (tag_id, user_id, entity_type, entity_id, created_at) VALUES (?, ?, 'note', ?, ?)",
                (tag_row["id"], user_id, note_id, now)
            )
```

- [ ] **Step 2: Tambah migration step di `migrate_db()`**

Di dalam `migrate_db()`, tambahkan blok migrasi:

```python
    # Migrate scratchpad_notes.tags (JSON array) → tags + entity_tags
    migrated = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='tags'").fetchone()
    if migrated:
        notes = conn.execute("SELECT id, user_id, tags FROM scratchpad_notes WHERE tags IS NOT NULL AND tags != '[]'").fetchall()
        for note in notes:
            try:
                tag_names = json.loads(note["tags"] or "[]")
                if tag_names:
                    _upsert_tags_for_note(conn, note["id"], note["user_id"], tag_names)
            except Exception:
                pass
        conn.commit()
```

- [ ] **Step 3: Verifikasi migrasi data**

Di VPS setelah deploy + restart:
```bash
sqlite3 taskflow.db "SELECT COUNT(*) FROM tags;"
# Expected: jumlah unique tag yang ada

sqlite3 taskflow.db "SELECT COUNT(*) FROM entity_tags WHERE entity_type='note';"
# Expected: jumlah relasi note-tag

sqlite3 taskflow.db "SELECT t.name, COUNT(et.entity_id) as count FROM tags t JOIN entity_tags et ON t.id=et.tag_id GROUP BY t.name ORDER BY count DESC LIMIT 10;"
# Expected: daftar tag terpopuler
```

- [ ] **Step 4: Commit**

```bash
git add webapp.py
git commit -m "feat: migrate existing scratchpad tags to tags/entity_tags tables"
```

---

## FASE 2 — Backend API & Refactor Scratchpad Endpoints

### Task 3: API endpoints untuk tag management

**Files:**
- Modify: `webapp.py` (tambah setelah endpoint scratchpad terakhir, baris ~1702)

- [ ] **Step 1: Tambah endpoint GET `/api/tags`**

```python
@app.get("/api/tags")
async def list_tags(entity_type: str = "", user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        if entity_type:
            rows = conn.execute("""
                SELECT DISTINCT t.id, t.name, t.color, COUNT(et.entity_id) as count
                FROM tags t
                JOIN entity_tags et ON t.id = et.tag_id
                WHERE t.user_id = ? AND et.entity_type = ?
                GROUP BY t.id ORDER BY count DESC, t.name ASC
            """, (uid, entity_type)).fetchall()
        else:
            rows = conn.execute("""
                SELECT t.id, t.name, t.color, COUNT(et.entity_id) as count
                FROM tags t
                LEFT JOIN entity_tags et ON t.id = et.tag_id
                WHERE t.user_id = ?
                GROUP BY t.id ORDER BY count DESC, t.name ASC
            """, (uid,)).fetchall()
        return [dict(r) for r in rows]
```

- [ ] **Step 2: Tambah endpoint PATCH `/api/tags/{tag_id}`**

```python
class TagUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None

@app.patch("/api/tags/{tag_id}")
async def update_tag(tag_id: int, req: TagUpdate, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        tag = conn.execute("SELECT id FROM tags WHERE id = ? AND user_id = ?", (tag_id, uid)).fetchone()
        if not tag:
            raise HTTPException(status_code=404, detail="Tag tidak ditemukan")
        if req.name is not None:
            name = req.name.strip().lower()
            if not name:
                raise HTTPException(status_code=400, detail="Nama tag tidak boleh kosong")
            conn.execute("UPDATE tags SET name = ? WHERE id = ?", (name, tag_id))
        if req.color is not None:
            conn.execute("UPDATE tags SET color = ? WHERE id = ?", (req.color, tag_id))
        conn.commit()
        return dict(conn.execute("SELECT * FROM tags WHERE id = ?", (tag_id,)).fetchone())
```

- [ ] **Step 3: Tambah endpoint DELETE `/api/tags/{tag_id}`**

```python
@app.delete("/api/tags/{tag_id}")
async def delete_tag(tag_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        tag = conn.execute("SELECT id FROM tags WHERE id = ? AND user_id = ?", (tag_id, uid)).fetchone()
        if not tag:
            raise HTTPException(status_code=404, detail="Tag tidak ditemukan")
        conn.execute("DELETE FROM entity_tags WHERE tag_id = ?", (tag_id,))
        conn.execute("DELETE FROM tags WHERE id = ?", (tag_id,))
        conn.commit()
    return {"ok": True}
```

- [ ] **Step 4: Commit**

```bash
git add webapp.py
git commit -m "feat: add tag management API endpoints (list, update, delete)"
```

---

### Task 4: Refactor scratchpad endpoints — simpan tag ke `tags` + `entity_tags`

**Files:**
- Modify: `webapp.py` (fungsi `create_scratchpad` baris ~1639, `update_scratchpad` baris ~1658, `_scratchpad_row` baris ~1554)

- [ ] **Step 1: Refactor `_scratchpad_row()` — baca tags dari `entity_tags`**

Ganti fungsi `_scratchpad_row`:

```python
def _scratchpad_row(row, conn=None) -> dict:
    d = dict(row)
    # Baca tags dari entity_tags (bukan dari kolom JSON lama)
    if conn and d.get("id"):
        tag_rows = conn.execute("""
            SELECT t.name FROM tags t
            JOIN entity_tags et ON t.id = et.tag_id
            WHERE et.entity_type = 'note' AND et.entity_id = ?
            ORDER BY t.name ASC
        """, (d["id"],)).fetchall()
        d["tags"] = [r["name"] for r in tag_rows]
    else:
        try: d["tags"] = json.loads(d.get("tags") or "[]")
        except Exception: d["tags"] = []
    try: d["linked_task_ids"] = json.loads(d.get("linked_task_ids") or "[]")
    except Exception: d["linked_task_ids"] = []
    try: d["linked_to"] = json.loads(d.get("linked_to") or "[]")
    except Exception: d["linked_to"] = []
    return d
```

- [ ] **Step 2: Refactor `create_scratchpad()` — simpan tag ke tabel baru**

Ganti isi `create_scratchpad` setelah INSERT scratchpad_notes:

```python
@app.post("/api/scratchpad")
async def create_scratchpad(req: ScratchpadCreate, user=Depends(get_current_user)):
    uid = user["sub"]
    now = datetime.utcnow().isoformat()
    # Normalisasi tag
    tag_names = [t.strip().lower() for t in req.tags if t.strip()]
    with get_db() as conn:
        conn.execute(
            """INSERT INTO scratchpad_notes (user_id, title, content, tags, linked_task_id, linked_task_ids, linked_to, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (uid, req.title, req.content, "[]",
             req.linked_task_id, json.dumps(req.linked_task_ids),
             json.dumps([]), now, now)
        )
        note_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        _upsert_tags_for_note(conn, note_id, uid, tag_names)
        conn.commit()
        row = conn.execute(_NOTE_SELECT, (note_id,)).fetchone()
        return _scratchpad_row(row, conn)
```

- [ ] **Step 3: Refactor `update_scratchpad()` — sync tag ke tabel baru**

Ganti isi `update_scratchpad`:

```python
@app.put("/api/scratchpad/{note_id}")
async def update_scratchpad(note_id: int, req: ScratchpadUpdate, user=Depends(get_current_user)):
    uid = user["sub"]
    now = datetime.utcnow().isoformat()
    tag_names = [t.strip().lower() for t in req.tags if t.strip()]
    with get_db() as conn:
        if not conn.execute("SELECT id FROM scratchpad_notes WHERE id = ? AND user_id = ?", (note_id, uid)).fetchone():
            raise HTTPException(status_code=404, detail="Note tidak ditemukan")
        conn.execute(
            "UPDATE scratchpad_notes SET title=?, content=?, tags=?, linked_task_id=?, linked_task_ids=?, linked_to=?, updated_at=? WHERE id=?",
            (req.title, req.content, "[]",
             req.linked_task_id, json.dumps(req.linked_task_ids),
             json.dumps(req.linked_to if hasattr(req, 'linked_to') else []), now, note_id)
        )
        # Hapus relasi tag lama, upsert baru
        conn.execute("DELETE FROM entity_tags WHERE entity_type='note' AND entity_id=? AND user_id=?", (note_id, uid))
        _upsert_tags_for_note(conn, note_id, uid, tag_names)
        conn.commit()
        updated = conn.execute(_NOTE_SELECT, (note_id,)).fetchone()
        return _scratchpad_row(updated, conn)
```

- [ ] **Step 4: Refactor `list_scratchpad()` — search by tag via entity_tags**

Ganti query search di `list_scratchpad`:

```python
@app.get("/api/scratchpad")
async def list_scratchpad(q: str = "", tag: str = "", user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        if tag:
            tag_norm = tag.strip().lower()
            rows = conn.execute("""
                SELECT s.* FROM scratchpad_notes s
                JOIN entity_tags et ON et.entity_id = s.id AND et.entity_type = 'note'
                JOIN tags t ON t.id = et.tag_id
                WHERE s.user_id = ? AND t.name = ?
                ORDER BY s.updated_at DESC
            """, (uid, tag_norm)).fetchall()
        elif q:
            rows = conn.execute("""
                SELECT s.* FROM scratchpad_notes s
                WHERE s.user_id = ? AND (s.title LIKE ? OR s.content LIKE ?)
                ORDER BY s.updated_at DESC
            """, (uid, f"%{q}%", f"%{q}%")).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM scratchpad_notes WHERE user_id = ? ORDER BY updated_at DESC",
                (uid,)
            ).fetchall()
        return [_scratchpad_row(r, conn) for r in rows]
```

- [ ] **Step 5: Commit**

```bash
git add webapp.py
git commit -m "refactor: scratchpad endpoints use tags/entity_tags tables"
```

---

## FASE 3 — Frontend: Tag Normalization & Dropdown Suggest

### Task 5: Normalisasi tag di frontend saat extract dari content

**Files:**
- Modify: `static/index.html` (fungsi `handleContentChange` di `NoteModal`, baris ~5298)

- [ ] **Step 1: Update regex extract tag — normalisasi lowercase**

Cari baris di `handleContentChange`:
```javascript
const extracted = [...new Set((val.match(/#(\w+)/g) || []).map(t => t.slice(1)))];
```

Ganti dengan:
```javascript
const extracted = [...new Set((val.match(/#([a-zA-Z0-9_À-ɏ]+)/g) || []).map(t => t.slice(1).toLowerCase().trim()))].filter(Boolean);
```

- [ ] **Step 2: Normalisasi juga di TaskFormModal (mode note)**

Cari baris di `handleSubmit` (baris ~1846):
```javascript
const autoTags = [...new Set((noteForm.content.match(/(?:^|\s)#([a-zA-ZÀ-ɏ0-9_]+)/g) || []).map(t => t.trim().replace(/^#/, "")))];
```

Ganti dengan:
```javascript
const autoTags = [...new Set((noteForm.content.match(/#([a-zA-Z0-9_À-ɏ]+)/g) || []).map(t => t.slice(1).toLowerCase().trim()))].filter(Boolean);
```

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "fix: normalize tags to lowercase on extract"
```

---

### Task 6: Dropdown suggest saat ketik `#` di NoteModal

**Files:**
- Modify: `static/index.html` (komponen `NoteModal`, sekitar baris 5170–5480)

- [ ] **Step 1: Tambah state dan fetch existing tags**

Di dalam `NoteModal`, setelah `const [wikiDropdown, setWikiDropdown] = useState(null)`:

```javascript
const [tagDropdown, setTagDropdown] = useState(null); // { top, left, query, items }
const [existingTags, setExistingTags] = useState([]);

useEffect(() => {
  api.get("/api/tags?entity_type=note").then(data => setExistingTags(data || [])).catch(() => {});
}, []);
```

- [ ] **Step 2: Deteksi `#query` di `handleContentChange`**

Di dalam `handleContentChange`, setelah extract tag, tambahkan:

```javascript
// Deteksi #tag dropdown suggest
const tagMatch = val.slice(0, el?.selectionStart ?? val.length).match(/#([a-zA-Z0-9_À-ɏ]*)$/);
if (tagMatch) {
  const query = tagMatch[1].toLowerCase();
  const items = existingTags.filter(t => t.name.startsWith(query) && !extracted.includes(t.name)).slice(0, 6);
  if (items.length > 0 && el) {
    const rect = el.getBoundingClientRect();
    setTagDropdown({ query, items, top: rect.top + 20, left: rect.left + 8 });
  } else {
    setTagDropdown(null);
  }
} else {
  setTagDropdown(null);
}
```

- [ ] **Step 3: Handle keyboard navigation di `handleContentKeyDown`**

Tambahkan di awal `handleContentKeyDown`, sebelum wikilink dropdown check:

```javascript
if (tagDropdown) {
  if (e.key === "Escape") { setTagDropdown(null); return; }
  if (e.key === "Enter" || e.key === "Tab") {
    e.preventDefault();
    if (tagDropdown.items[0]) insertTag(tagDropdown.items[0].name);
    return;
  }
}
```

- [ ] **Step 4: Tambah fungsi `insertTag`**

Setelah fungsi `insertWikilink`, tambahkan:

```javascript
const insertTag = (tagName) => {
  const el = textareaRef.current;
  if (!el) return;
  const pos = el.selectionStart;
  const before = content.slice(0, pos);
  const after = content.slice(pos);
  const newBefore = before.replace(/#([a-zA-Z0-9_À-ɏ]*)$/, `#${tagName} `);
  const newVal = newBefore + after;
  handleContentChange(newVal);
  setTagDropdown(null);
  setTimeout(() => { el.selectionStart = el.selectionEnd = newBefore.length; el.focus(); }, 0);
};
```

- [ ] **Step 5: Render tag dropdown di JSX**

Di dalam return `NoteModal`, setelah wikilink dropdown (`{wikiDropdown && ...}`), tambahkan:

```jsx
{tagDropdown && tagDropdown.items.length > 0 && (
  <div className="wiki-autocomplete" style={{ position: "fixed", top: tagDropdown.top, left: tagDropdown.left, zIndex: 1050 }}>
    {tagDropdown.items.map((t, i) => (
      <div key={t.id} className={`wiki-autocomplete-item${i === 0 ? " active" : ""}`}
        onMouseDown={e => { e.preventDefault(); insertTag(t.name); }}>
        <span style={{ color: "var(--accent)", fontWeight: 700 }}>#</span>{t.name}
        <span style={{ fontSize: 10, color: "var(--text-light)", marginLeft: 6 }}>{t.count}×</span>
      </div>
    ))}
  </div>
)}
```

- [ ] **Step 6: Commit**

```bash
git add static/index.html
git commit -m "feat: tag dropdown suggest saat ketik # di NoteModal"
```

---

### Task 7: Update tag filter di NotesPage — fetch dari `/api/tags`

**Files:**
- Modify: `static/index.html` (komponen `NotesPage`, baris ~5502)

- [ ] **Step 1: Fetch tag list dari API**

Di `NotesPage`, setelah `const [activeTag, setActiveTag] = useState(null)`:

```javascript
const [tagList, setTagList] = useState([]);

useEffect(() => {
  api.get("/api/tags?entity_type=note").then(data => setTagList(data || [])).catch(() => {});
}, []);

// Refresh tag list setelah note disimpan
useEffect(() => {
  const handler = () => api.get("/api/tags?entity_type=note").then(data => setTagList(data || [])).catch(() => {});
  window.addEventListener("noteSaved", handler);
  return () => window.removeEventListener("noteSaved", handler);
}, []);
```

- [ ] **Step 2: Ganti `allTags` pakai `tagList` dari API**

Cari baris:
```javascript
const allTags = [...new Set(allNotes.flatMap(n => n.tags || []))].sort();
```

Ganti dengan:
```javascript
const allTags = tagList.map(t => t.name);
```

- [ ] **Step 3: Update `schema-db.md`**

Tambahkan dua tabel baru (`tags`, `entity_tags`) beserta triggers ke file `schema-db.md`.

- [ ] **Step 4: Final commit**

```bash
git add static/index.html schema-db.md
git commit -m "feat: NotesPage fetch tag list from API, remove client-side tag extraction"
git push origin main
```

---

## Catatan Deploy

Setelah setiap fase di-push, lakukan di VPS:
```bash
git pull origin main
sudo systemctl restart taskflow-web
```

Fase 1 & 2 butuh restart karena ada perubahan `webapp.py`. Fase 3 cukup hard-refresh browser setelah deploy.
