# Shared Notes — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the scratchpad notes system so notes can be shared with members of an existing shared task list, with per-user pinning, full access control, and a polling endpoint.

**Architecture:** Three schema additions to `scratchpad_notes` (`list_id`, `last_edited_by`) plus a new `note_pins` table. All existing endpoints are updated to use a shared access clause `(user_id = uid OR list_id IN <lists user belongs to>)`. New endpoints: `GET /api/scratchpad/{note_id}` (for polling), `PATCH /api/scratchpad/{note_id}/share` (owner toggles sharing). Pin endpoint migrated to `note_pins` table for per-user semantics.

**Tech Stack:** FastAPI (Python), SQLite, `repository.py` (_init_db migrations), `webapp.py` (endpoints)

---

## File Map

| File | Aksi | Tanggung Jawab |
|------|------|----------------|
| `repository.py` | Modify | Schema migrations: `list_id`, `last_edited_by`, `note_pins` table |
| `webapp.py` | Modify | Access helper, `_scratchpad_row` update, all scratchpad endpoints |

---

## Task 1: Schema Migrations

**Files:**
- Modify: `repository.py` (dalam `_init_db`, setelah baris ~291)

Tambahkan tepat setelah blok `if "linked_task_ids" not in sp_cols:` (yang berakhir di baris ~291), sebelum `# Universal tag system`:

- [ ] **Step 1: Tambah migrasi di `repository.py`**

Cari baris (sekitar 291–292):
```python
                    WHERE linked_task_id IS NOT NULL AND linked_task_id != ''
                """)

            # Universal tag system
```

Sisipkan di antara keduanya:
```python
                    WHERE linked_task_id IS NOT NULL AND linked_task_id != ''
                """)

            if "list_id" not in sp_cols:
                conn.execute("ALTER TABLE scratchpad_notes ADD COLUMN list_id INTEGER DEFAULT NULL REFERENCES shared_lists(id) ON DELETE SET NULL")
            if "last_edited_by" not in sp_cols:
                conn.execute("ALTER TABLE scratchpad_notes ADD COLUMN last_edited_by INTEGER DEFAULT NULL REFERENCES users(id) ON DELETE SET NULL")
                conn.execute("UPDATE scratchpad_notes SET last_edited_by = user_id WHERE last_edited_by IS NULL")

            conn.execute("""
                CREATE TABLE IF NOT EXISTS note_pins (
                    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    note_id INTEGER NOT NULL REFERENCES scratchpad_notes(id) ON DELETE CASCADE,
                    PRIMARY KEY (user_id, note_id)
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_note_pins_user ON note_pins(user_id)")
            conn.execute("""
                INSERT OR IGNORE INTO note_pins (user_id, note_id)
                SELECT user_id, id FROM scratchpad_notes WHERE pinned = 1
            """)

            # Universal tag system
```

- [ ] **Step 2: Verifikasi migrasi**

Jalankan Python shell untuk cek:
```bash
cd "Z:/Todolist Manager V5.0"
python -c "
from repository import TaskRepository
from config import DB_PATH
import sqlite3
TaskRepository(DB_PATH)
conn = sqlite3.connect(DB_PATH)
conn.row_factory = sqlite3.Row
cols = [r['name'] for r in conn.execute('PRAGMA table_info(scratchpad_notes)').fetchall()]
print('scratchpad cols:', cols)
tables = [r['name'] for r in conn.execute(\"SELECT name FROM sqlite_master WHERE type='table'\").fetchall()]
print('note_pins exists:', 'note_pins' in tables)
conn.close()
"
```
Expected output berisi `list_id`, `last_edited_by` di cols, dan `note_pins exists: True`.

- [ ] **Step 3: Commit**

```bash
git add repository.py
git commit -m "feat: add list_id, last_edited_by columns and note_pins table to scratchpad"
```

---

## Task 2: Access Helper dan `_scratchpad_row` Update

**Files:**
- Modify: `webapp.py` (fungsi `_scratchpad_row` ~baris 1760, tambah helper setelah `_resolve_linked_to` ~baris 1812)

- [ ] **Step 1: Tambah helper `_note_access_clause` setelah `_resolve_linked_to`**

Cari baris (sekitar 1812):
```python
    return [title_map[t.strip().lower()] for t in titles if t.strip().lower() in title_map]

@app.get("/api/scratchpad")
```

Sisipkan di antara keduanya:
```python
    return [title_map[t.strip().lower()] for t in titles if t.strip().lower() in title_map]

def _note_access_clause(uid: int) -> tuple[str, list]:
    """SQL WHERE fragment + params: notes owned by uid OR shared via list membership."""
    clause = (
        "(user_id = ? OR list_id IN ("
        "  SELECT id FROM shared_lists WHERE owner_id = ?"
        "  UNION SELECT list_id FROM list_members WHERE user_id = ?"
        "))"
    )
    return clause, [uid, uid, uid]

@app.get("/api/scratchpad")
```

- [ ] **Step 2: Update `_scratchpad_row` untuk per-user pinning dan owner/editor info**

Cari fungsi `_scratchpad_row` (baris ~1760). Ganti seluruhnya:
```python
def _scratchpad_row(row, conn=None, uid=None) -> dict:
    d = dict(row)
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

    # Per-user pinning from note_pins table
    if conn and uid and d.get("id"):
        pin_row = conn.execute(
            "SELECT 1 FROM note_pins WHERE user_id = ? AND note_id = ?", (uid, d["id"])
        ).fetchone()
        d["pinned"] = bool(pin_row)
    else:
        d["pinned"] = bool(d.get("pinned", 0))

    # Owner info
    if conn and d.get("user_id"):
        owner = conn.execute(
            "SELECT username, display_name FROM users WHERE id = ?", (d["user_id"],)
        ).fetchone()
        if owner:
            d["owner_username"] = owner["username"]
            d["owner_display_name"] = owner["display_name"]

    # Last editor info
    if conn and d.get("last_edited_by") and d["last_edited_by"] != d.get("user_id"):
        editor = conn.execute(
            "SELECT username, display_name FROM users WHERE id = ?", (d["last_edited_by"],)
        ).fetchone()
        if editor:
            d["last_editor_username"] = editor["username"]
            d["last_editor_display_name"] = editor["display_name"]

    if not d["linked_task_ids"] and d.get("linked_task_id"):
        d["linked_task_ids"] = [d["linked_task_id"]]
    if conn and d["linked_task_ids"]:
        ids = d["linked_task_ids"]
        ph = ",".join("?" * len(ids))
        tasks = conn.execute(
            f"SELECT id, title, priority, gtd_status FROM tasks WHERE id IN ({ph})", ids
        ).fetchall()
        d["linked_tasks"] = [dict(t) for t in tasks]
    else:
        d["linked_tasks"] = []
    if not d.get("linked_task_title") and d["linked_tasks"]:
        d["linked_task_title"] = d["linked_tasks"][0]["title"]
    return d
```

- [ ] **Step 3: Update `_resolve_linked_to` untuk include shared notes**

Cari fungsi `_resolve_linked_to` (baris ~1802):
```python
def _resolve_linked_to(titles: list[str], user_id: int, conn) -> list[int]:
    """Resolve note titles to IDs for the given user."""
    if not titles:
        return []
    placeholders = ",".join("?" * len(titles))
    rows = conn.execute(
        f"SELECT id, title FROM scratchpad_notes WHERE user_id = ? AND title IN ({placeholders})",
        [user_id] + titles,
    ).fetchall()
    title_map = {r["title"].strip().lower(): r["id"] for r in rows}
    return [title_map[t.strip().lower()] for t in titles if t.strip().lower() in title_map]
```

Ganti dengan:
```python
def _resolve_linked_to(titles: list[str], user_id: int, conn) -> list[int]:
    """Resolve note titles to IDs — searches personal and shared notes accessible by user."""
    if not titles:
        return []
    placeholders = ",".join("?" * len(titles))
    access_clause, access_params = _note_access_clause(user_id)
    rows = conn.execute(
        f"SELECT id, title FROM scratchpad_notes WHERE {access_clause} AND title IN ({placeholders})",
        access_params + titles,
    ).fetchall()
    title_map = {r["title"].strip().lower(): r["id"] for r in rows}
    return [title_map[t.strip().lower()] for t in titles if t.strip().lower() in title_map]
```

Catatan: `_note_access_clause` dipanggil di sini, jadi pastikan helper ini didefinisikan SETELAH `_resolve_linked_to` dalam file — urutan definisi fungsi tidak masalah di Python karena keduanya dipanggil saat runtime, bukan parse time.

- [ ] **Step 4: Update models `ScratchpadCreate` dan `ScratchpadUpdate`**

Cari (baris ~268):
```python
class ScratchpadCreate(BaseModel):
    title: str = ""
    content: str = ""
    tags: list[str] = []
    linked_task_id: Optional[int] = None
    linked_task_ids: list[int] = []

class ScratchpadUpdate(BaseModel):
    title: str = ""
    content: str = ""
    tags: list[str] = []
    linked_task_id: Optional[int] = None
    linked_task_ids: list[int] = []
```

Ganti dengan:
```python
class ScratchpadCreate(BaseModel):
    title: str = ""
    content: str = ""
    tags: list[str] = []
    linked_task_id: Optional[int] = None
    linked_task_ids: list[int] = []
    list_id: Optional[int] = None

class ScratchpadUpdate(BaseModel):
    title: str = ""
    content: str = ""
    tags: list[str] = []
    linked_task_id: Optional[int] = None
    linked_task_ids: list[int] = []
    list_id: Optional[int] = None
```

- [ ] **Step 5: Commit**

```bash
git add webapp.py
git commit -m "feat: add _note_access_clause helper, update _scratchpad_row with per-user pin and owner info"
```

---

## Task 3: Update GET Endpoints (list, recent, titles)

**Files:**
- Modify: `webapp.py` (`list_scratchpad` ~baris 1814, `recent_scratchpad` ~baris 1840, `get_note_titles` ~baris 1852)

- [ ] **Step 1: Update `GET /api/scratchpad`**

Cari fungsi `list_scratchpad` (baris ~1814). Ganti seluruhnya:
```python
@app.get("/api/scratchpad")
async def list_scratchpad(q: str = "", tag: str = "", user=Depends(get_current_user)):
    uid = user["sub"]
    access_clause, access_params = _note_access_clause(uid)
    with get_db() as conn:
        if tag:
            tag_norm = tag.strip().lower()
            rows = conn.execute(f"""
                SELECT s.* FROM scratchpad_notes s
                JOIN entity_tags et ON et.entity_id = s.id AND et.entity_type = 'note'
                JOIN tags t ON t.id = et.tag_id
                WHERE ({access_clause.replace('user_id', 's.user_id').replace('list_id', 's.list_id')})
                  AND t.name = ?
                ORDER BY s.updated_at DESC
            """, access_params + [tag_norm]).fetchall()
        elif q:
            rows = conn.execute(f"""
                SELECT s.* FROM scratchpad_notes s
                WHERE ({access_clause.replace('user_id', 's.user_id').replace('list_id', 's.list_id')})
                  AND (s.title LIKE ? OR s.content LIKE ?)
                ORDER BY s.updated_at DESC
            """, access_params + [f"%{q}%", f"%{q}%"]).fetchall()
        else:
            rows = conn.execute(f"""
                SELECT s.* FROM scratchpad_notes s
                WHERE {access_clause.replace('user_id', 's.user_id').replace('list_id', 's.list_id')}
                ORDER BY s.updated_at DESC
            """, access_params).fetchall()
        return [_scratchpad_row(r, conn, uid) for r in rows]
```

- [ ] **Step 2: Update `GET /api/scratchpad/recent`**

Cari fungsi `recent_scratchpad` (baris ~1840). Ganti seluruhnya:
```python
@app.get("/api/scratchpad/recent")
async def recent_scratchpad(user=Depends(get_current_user)):
    uid = user["sub"]
    access_clause, access_params = _note_access_clause(uid)
    with get_db() as conn:
        rows = conn.execute(f"""
            SELECT * FROM scratchpad_notes
            WHERE {access_clause}
            ORDER BY updated_at DESC LIMIT 5
        """, access_params).fetchall()
        return [_scratchpad_row(r, conn, uid) for r in rows]
```

- [ ] **Step 3: Update `GET /api/scratchpad/titles`**

Cari fungsi `get_note_titles` (baris ~1852). Ganti seluruhnya:
```python
@app.get("/api/scratchpad/titles")
async def get_note_titles(user=Depends(get_current_user)):
    """Return all accessible note id+title pairs for wikilink autocomplete."""
    uid = user["sub"]
    access_clause, access_params = _note_access_clause(uid)
    with get_db() as conn:
        rows = conn.execute(f"""
            SELECT s.id, s.title, s.user_id, s.list_id,
                   u.username AS owner_username, u.display_name AS owner_display_name
            FROM scratchpad_notes s
            LEFT JOIN users u ON u.id = s.user_id
            WHERE {access_clause.replace('user_id', 's.user_id').replace('list_id', 's.list_id')}
              AND s.title != ''
            ORDER BY s.updated_at DESC
        """, access_params).fetchall()
    return [dict(r) for r in rows]
```

- [ ] **Step 4: Commit**

```bash
git add webapp.py
git commit -m "feat: update scratchpad GET endpoints to include shared notes"
```

---

## Task 4: Tambah `GET /api/scratchpad/{note_id}` dan Update POST/PUT

**Files:**
- Modify: `webapp.py` (setelah `get_note_titles` ~baris 1861, update `create_scratchpad` ~1863, update `update_scratchpad` ~1885)

- [ ] **Step 1: Tambah `GET /api/scratchpad/{note_id}` untuk polling**

Cari baris setelah `get_note_titles` (sekitar baris 1861):
```python
    return [dict(r) for r in rows]

@app.post("/api/scratchpad")
```

Sisipkan di antara keduanya:
```python
    return [dict(r) for r in rows]

@app.get("/api/scratchpad/{note_id}")
async def get_scratchpad_note(note_id: int, user=Depends(get_current_user)):
    """Fetch a single note — used by frontend for polling (checks updated_at)."""
    uid = user["sub"]
    access_clause, access_params = _note_access_clause(uid)
    with get_db() as conn:
        row = conn.execute(f"""
            SELECT * FROM scratchpad_notes
            WHERE id = ? AND {access_clause}
        """, [note_id] + access_params).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Note tidak ditemukan")
        return _scratchpad_row(row, conn, uid)

@app.post("/api/scratchpad")
```

- [ ] **Step 2: Update `POST /api/scratchpad`**

Cari fungsi `create_scratchpad` (baris ~1863). Ganti seluruhnya:
```python
@app.post("/api/scratchpad")
async def create_scratchpad(req: ScratchpadCreate, user=Depends(get_current_user)):
    uid = user["sub"]
    now = datetime.now(_TZ_JKT).isoformat()
    tag_names = [t.strip().lower() for t in req.tags if t.strip()]
    task_ids = list(dict.fromkeys(req.linked_task_ids + ([req.linked_task_id] if req.linked_task_id else [])))
    if req.list_id is not None:
        repo = TaskRepository(DB_PATH)
        if not repo.is_list_member_or_owner(req.list_id, uid):
            raise HTTPException(status_code=403, detail="Kamu bukan anggota list ini")
    with get_db() as conn:
        titles = _parse_wikilinks(req.content)
        linked_ids = _resolve_linked_to(titles, uid, conn)
        conn.execute(
            """INSERT INTO scratchpad_notes
               (user_id, title, content, tags, linked_task_id, linked_task_ids, linked_to,
                list_id, last_edited_by, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (uid, req.title, req.content, "[]",
             task_ids[0] if task_ids else None, json.dumps(task_ids),
             json.dumps(linked_ids), req.list_id, uid, now, now)
        )
        note_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        _upsert_tags_for_note(conn, note_id, uid, tag_names)
        conn.commit()
        row = conn.execute(_NOTE_SELECT, (note_id,)).fetchone()
        return _scratchpad_row(row, conn, uid)
```

- [ ] **Step 3: Update `PUT /api/scratchpad/{note_id}`**

Cari fungsi `update_scratchpad` (baris ~1885). Ganti seluruhnya:
```python
@app.put("/api/scratchpad/{note_id}")
async def update_scratchpad(note_id: int, req: ScratchpadUpdate, user=Depends(get_current_user)):
    uid = user["sub"]
    now = datetime.now(_TZ_JKT).isoformat()
    tag_names = [t.strip().lower() for t in req.tags if t.strip()]
    task_ids = list(dict.fromkeys(req.linked_task_ids + ([req.linked_task_id] if req.linked_task_id else [])))
    access_clause, access_params = _note_access_clause(uid)
    with get_db() as conn:
        existing = conn.execute(f"""
            SELECT id, user_id FROM scratchpad_notes
            WHERE id = ? AND {access_clause}
        """, [note_id] + access_params).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Note tidak ditemukan")
        titles = _parse_wikilinks(req.content)
        linked_ids = _resolve_linked_to(titles, uid, conn)
        # list_id: only owner can change it; members cannot move the note to another list
        new_list_id = req.list_id if existing["user_id"] == uid else conn.execute(
            "SELECT list_id FROM scratchpad_notes WHERE id = ?", (note_id,)
        ).fetchone()["list_id"]
        conn.execute(
            """UPDATE scratchpad_notes
               SET title=?, content=?, tags=?, linked_task_id=?, linked_task_ids=?,
                   linked_to=?, list_id=?, last_edited_by=?, updated_at=?
               WHERE id=?""",
            (req.title, req.content, "[]",
             task_ids[0] if task_ids else None, json.dumps(task_ids),
             json.dumps(linked_ids), new_list_id, uid, now, note_id)
        )
        conn.execute("DELETE FROM entity_tags WHERE entity_type='note' AND entity_id=? AND user_id=?", (note_id, uid))
        _upsert_tags_for_note(conn, note_id, uid, tag_names)
        conn.commit()
        updated = conn.execute(_NOTE_SELECT, (note_id,)).fetchone()
        return _scratchpad_row(updated, conn, uid)
```

- [ ] **Step 4: Commit**

```bash
git add webapp.py
git commit -m "feat: add GET /api/scratchpad/{id} for polling, update POST/PUT with list_id and last_edited_by"
```

---

## Task 5: Endpoint Share dan Update Delete

**Files:**
- Modify: `webapp.py` (setelah `update_scratchpad`, sebelum `delete_scratchpad`)

- [ ] **Step 1: Tambah model `NoteShareReq`**

Cari baris (sekitar 280):
```python
class JoinListReq(BaseModel):
    code: str
```

Tambahkan sebelumnya:
```python
class NoteShareReq(BaseModel):
    list_id: Optional[int] = None  # None = unshare

class JoinListReq(BaseModel):
    code: str
```

- [ ] **Step 2: Tambah `PATCH /api/scratchpad/{note_id}/share`**

Cari baris setelah `delete_scratchpad` (setelah baris ~1916):
```python
    return {"ok": True}

@app.patch("/api/scratchpad/{note_id}/pin")
```

Sisipkan di antara keduanya:
```python
    return {"ok": True}

@app.patch("/api/scratchpad/{note_id}/share")
async def share_scratchpad(note_id: int, req: NoteShareReq, user=Depends(get_current_user)):
    """Toggle sharing of a note to a list. Only the note owner can share/unshare."""
    uid = user["sub"]
    with get_db() as conn:
        row = conn.execute(
            "SELECT id FROM scratchpad_notes WHERE id = ? AND user_id = ?", (note_id, uid)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=403, detail="Hanya pemilik catatan yang bisa berbagi")
        if req.list_id is not None:
            repo = TaskRepository(DB_PATH)
            if not repo.is_list_member_or_owner(req.list_id, uid):
                raise HTTPException(status_code=403, detail="Kamu bukan anggota list ini")
        conn.execute(
            "UPDATE scratchpad_notes SET list_id = ? WHERE id = ?", (req.list_id, note_id)
        )
        conn.commit()
        updated = conn.execute(_NOTE_SELECT, (note_id,)).fetchone()
        return _scratchpad_row(updated, conn, uid)

@app.patch("/api/scratchpad/{note_id}/pin")
```

- [ ] **Step 3: Update `DELETE /api/scratchpad/{note_id}` — tetap owner-only, tambah cascade pin**

Cari fungsi `delete_scratchpad` (baris ~1909). Ganti seluruhnya:
```python
@app.delete("/api/scratchpad/{note_id}")
async def delete_scratchpad(note_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        if not conn.execute(
            "SELECT id FROM scratchpad_notes WHERE id = ? AND user_id = ?", (note_id, uid)
        ).fetchone():
            raise HTTPException(status_code=403, detail="Hanya pemilik yang bisa menghapus catatan ini")
        conn.execute("DELETE FROM scratchpad_notes WHERE id = ?", (note_id,))
        conn.commit()
    return {"ok": True}
```

- [ ] **Step 4: Commit**

```bash
git add webapp.py
git commit -m "feat: add PATCH /api/scratchpad/{id}/share, update delete with owner-only guard"
```

---

## Task 6: Migrate Pin Endpoint ke `note_pins`

**Files:**
- Modify: `webapp.py` (`toggle_pin_scratchpad` ~baris 1918)

- [ ] **Step 1: Update `PATCH /api/scratchpad/{note_id}/pin`**

Cari fungsi `toggle_pin_scratchpad` (baris ~1918). Ganti seluruhnya:
```python
@app.patch("/api/scratchpad/{note_id}/pin")
async def toggle_pin_scratchpad(note_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    access_clause, access_params = _note_access_clause(uid)
    with get_db() as conn:
        row = conn.execute(f"""
            SELECT id FROM scratchpad_notes
            WHERE id = ? AND {access_clause}
        """, [note_id] + access_params).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Note tidak ditemukan")
        existing_pin = conn.execute(
            "SELECT 1 FROM note_pins WHERE user_id = ? AND note_id = ?", (uid, note_id)
        ).fetchone()
        if existing_pin:
            conn.execute("DELETE FROM note_pins WHERE user_id = ? AND note_id = ?", (uid, note_id))
        else:
            conn.execute("INSERT OR IGNORE INTO note_pins (user_id, note_id) VALUES (?, ?)", (uid, note_id))
        conn.commit()
        updated = conn.execute(_NOTE_SELECT, (note_id,)).fetchone()
        return _scratchpad_row(updated, conn, uid)
```

- [ ] **Step 2: Commit**

```bash
git add webapp.py
git commit -m "feat: migrate pin endpoint to per-user note_pins table"
```

---

## Task 7: Update Backlinks dan Search

**Files:**
- Modify: `webapp.py` (`get_backlinks` ~baris 1930, `global_search` ~baris di sekitar `/api/search`)

- [ ] **Step 1: Update `GET /api/scratchpad/{note_id}/backlinks`**

Cari fungsi `get_backlinks` (baris ~1930). Ganti seluruhnya:
```python
@app.get("/api/scratchpad/{note_id}/backlinks")
async def get_backlinks(note_id: int, user=Depends(get_current_user)):
    """Return all accessible notes that link to this note."""
    uid = user["sub"]
    access_clause, access_params = _note_access_clause(uid)
    with get_db() as conn:
        target = conn.execute(f"""
            SELECT id, title FROM scratchpad_notes
            WHERE id = ? AND {access_clause}
        """, [note_id] + access_params).fetchone()
        if not target:
            raise HTTPException(status_code=404, detail="Note tidak ditemukan")
        title = (target["title"] or "").strip()
        ac2, ap2 = _note_access_clause(uid)
        if title:
            rows = conn.execute(f"""
                SELECT DISTINCT id, title, updated_at FROM scratchpad_notes
                WHERE {ac2} AND id != ?
                  AND (
                      (json_type(linked_to) = 'array'
                       AND EXISTS (SELECT 1 FROM json_each(linked_to) WHERE value = ?))
                      OR content LIKE ?
                  )
                ORDER BY updated_at DESC
            """, ap2 + [note_id, note_id, f"%[[{title}]]%"]).fetchall()
        else:
            rows = conn.execute(f"""
                SELECT id, title, updated_at FROM scratchpad_notes
                WHERE {ac2} AND id != ?
                  AND json_type(linked_to) = 'array'
                  AND EXISTS (SELECT 1 FROM json_each(linked_to) WHERE value = ?)
                ORDER BY updated_at DESC
            """, ap2 + [note_id, note_id]).fetchall()
    return [dict(r) for r in rows]
```

- [ ] **Step 2: Update `GET /api/search` — include shared notes**

Cari endpoint `global_search` (cari `@app.get("/api/search")`). Temukan bagian query notes:
```python
        # Notes
        note_rows = conn.execute("""
            SELECT id, title, content, updated_at
            FROM scratchpad_notes
            WHERE user_id = ? AND (title LIKE ? OR content LIKE ?)
            ORDER BY updated_at DESC
            LIMIT 8
        """, (uid, like, like)).fetchall()
```

Ganti dengan:
```python
        # Notes (personal + shared)
        note_ac, note_ap = _note_access_clause(uid)
        note_rows = conn.execute(f"""
            SELECT id, title, content, updated_at
            FROM scratchpad_notes
            WHERE {note_ac} AND (title LIKE ? OR content LIKE ?)
            ORDER BY updated_at DESC
            LIMIT 8
        """, note_ap + [like, like]).fetchall()
```

- [ ] **Step 3: Manual test**

```bash
# Jalankan server lokal
cd "Z:/Todolist Manager V5.0"
uvicorn webapp:app --reload --port 8000

# Di browser: buka app, buat note biasa (personal), cek masih tampil
# Buat note baru dengan list_id via API (test dengan curl atau browser console):
# fetch('/api/scratchpad', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({title:'Test Shared', content:'isi', list_id: <id_list_kamu>})})
# Pastikan note muncul di kedua user yang ada di list tersebut
```

- [ ] **Step 4: Commit dan push**

```bash
git add webapp.py
git commit -m "feat: update backlinks and search to include shared notes"
git push origin main
```

---

## Catatan Deploy

Backend berubah — perlu restart service setelah pull:
```bash
git pull origin main
sudo systemctl restart taskflow-web
```
