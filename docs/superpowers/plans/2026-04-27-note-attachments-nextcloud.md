# Note Attachments via Nextcloud — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambah fitur attach file (gambar PNG/JPG/WebP + PDF) ke notes, disimpan di Nextcloud via WebDAV HTTPS, TaskFlow sebagai proxy dengan auth.

**Architecture:** File di-upload ke Nextcloud lewat WebDAV menggunakan App Password. Metadata disimpan di tabel `note_attachments` di SQLite. Semua akses file diproxy oleh TaskFlow — browser tidak pernah langsung ke Nextcloud. Gambar render inline di markdown via marked.js image renderer override. Panel Attachments tampil di NoteModal dan NotePanel.

**Tech Stack:** FastAPI, SQLite, `requests` (WebDAV), marked.js custom renderer, React hooks.

**Spec:** `docs/superpowers/specs/2026-04-27-note-attachments-nextcloud-design.md`

---

## File Structure

| File | Perubahan |
|---|---|
| `requirements-web.txt` | Tambah `requests==2.*` |
| `config.py` | Tambah 4 NEXTCLOUD_* vars |
| `repository.py` | Tambah tabel `note_attachments` di `__init__` |
| `webapp.py` | Import requests, Nextcloud helpers, startup, 4 endpoint baru |
| `static/index.html` | CSS img, marked renderer, NoteToolbar 📎, NoteModal upload flow, AttachmentsPanel, NotePanel |

---

### Task 1: Requirements + Config

**Files:**
- Modify: `requirements-web.txt`
- Modify: `config.py`

- [ ] **Step 1: Tambah requests ke requirements-web.txt**

Isi akhir `requirements-web.txt` menjadi:
```
fastapi==0.115.*
uvicorn[standard]==0.34.*
PyJWT==2.*
python-multipart==0.0.*
sse-starlette==2.*
requests==2.*
```

- [ ] **Step 2: Tambah NEXTCLOUD vars ke config.py**

Tambahkan setelah baris `MAX_FILE_SIZE = ...` (baris 38):
```python
# Nextcloud WebDAV
NEXTCLOUD_URL        = os.getenv("NEXTCLOUD_URL", "")
NEXTCLOUD_USER       = os.getenv("NEXTCLOUD_USER", "")
NEXTCLOUD_APP_PASSWORD = os.getenv("NEXTCLOUD_APP_PASSWORD", "")
NEXTCLOUD_FOLDER     = os.getenv("NEXTCLOUD_FOLDER", "TaskFlow/attachments")
```

- [ ] **Step 3: Tambah ke .env (di VPS)**

Di file `.env` pada VPS, tambahkan:
```
NEXTCLOUD_URL=https://cloud.example.com
NEXTCLOUD_USER=taskflow-bot
NEXTCLOUD_APP_PASSWORD=xxxxx-xxxxx-xxxxx-xxxxx
NEXTCLOUD_FOLDER=TaskFlow/attachments
```

> Note: Saat development/testing, boleh biarkan kosong — endpoint akan return 503 saat dipanggil.

- [ ] **Step 4: Commit**

```bash
git add requirements-web.txt config.py
git commit -m "feat: add Nextcloud config vars for note attachments"
```

---

### Task 2: DB — Tabel note_attachments

**Files:**
- Modify: `repository.py` (setelah baris `entity_tags` table, sekitar baris 338)

- [ ] **Step 1: Tambah CREATE TABLE ke repository.py**

Tambahkan setelah blok `entity_tags` dan sebelum trigger pertama (setelah baris 338, sebelum baris 339 `conn.execute("CREATE INDEX IF NOT EXISTS idx_entity_tags_lookup..."`):

```python
            conn.execute("""
                CREATE TABLE IF NOT EXISTS note_attachments (
                    id             INTEGER PRIMARY KEY AUTOINCREMENT,
                    note_id        INTEGER NOT NULL REFERENCES scratchpad_notes(id) ON DELETE CASCADE,
                    user_id        INTEGER NOT NULL REFERENCES users(id),
                    nextcloud_path TEXT NOT NULL,
                    original_name  TEXT NOT NULL,
                    file_size      INTEGER NOT NULL,
                    mime_type      TEXT NOT NULL,
                    created_at     TEXT DEFAULT (datetime('now'))
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_note_attachments_note ON note_attachments(note_id)")
```

- [ ] **Step 2: Verifikasi tabel terbuat**

Jalankan Python shell di VPS:
```bash
python3 -c "from repository import TaskRepository; from config import DB_PATH; TaskRepository(DB_PATH); import sqlite3; c=sqlite3.connect(DB_PATH); print(c.execute('SELECT name FROM sqlite_master WHERE name=\"note_attachments\"').fetchone())"
```
Expected: `('note_attachments',)`

- [ ] **Step 3: Commit**

```bash
git add repository.py
git commit -m "feat: add note_attachments table to repository"
```

---

### Task 3: Nextcloud WebDAV Helpers di webapp.py

**Files:**
- Modify: `webapp.py`

- [ ] **Step 1: Tambah import requests**

Tambahkan di bagian imports webapp.py, setelah `import re` (sekitar baris 16):
```python
import requests as _nc_http
```

- [ ] **Step 2: Tambah import NEXTCLOUD vars dari config**

Ubah baris import config (sekitar baris 39) dari:
```python
from config import DB_PATH, EISENHOWER_INTERVAL_MINUTES, UPLOAD_DIR, MAX_FILE_SIZE
```
menjadi:
```python
from config import DB_PATH, EISENHOWER_INTERVAL_MINUTES, UPLOAD_DIR, MAX_FILE_SIZE, \
    NEXTCLOUD_URL, NEXTCLOUD_USER, NEXTCLOUD_APP_PASSWORD, NEXTCLOUD_FOLDER
```

- [ ] **Step 3: Tambah helper functions**

Tambahkan setelah fungsi `migrate_db()` (sekitar baris 160), sebelum komentar `# APP`:

```python
# ── Nextcloud WebDAV helpers ──────────────────────────────────────────────────

def _nc_configured() -> bool:
    return bool(NEXTCLOUD_URL and NEXTCLOUD_USER and NEXTCLOUD_APP_PASSWORD)

def _nc_file_url(filename: str) -> str:
    folder = NEXTCLOUD_FOLDER.strip("/")
    return f"{NEXTCLOUD_URL}/remote.php/dav/files/{NEXTCLOUD_USER}/{folder}/{filename}"

def _nc_upload(filename: str, content: bytes, mime_type: str) -> None:
    r = _nc_http.put(
        _nc_file_url(filename),
        data=content,
        auth=(NEXTCLOUD_USER, NEXTCLOUD_APP_PASSWORD),
        headers={"Content-Type": mime_type},
        timeout=60,
    )
    r.raise_for_status()

def _nc_download(filename: str) -> bytes:
    r = _nc_http.get(
        _nc_file_url(filename),
        auth=(NEXTCLOUD_USER, NEXTCLOUD_APP_PASSWORD),
        timeout=60,
    )
    r.raise_for_status()
    return r.content

def _nc_delete_file(filename: str) -> None:
    r = _nc_http.delete(
        _nc_file_url(filename),
        auth=(NEXTCLOUD_USER, NEXTCLOUD_APP_PASSWORD),
        timeout=30,
    )
    if r.status_code not in (200, 204, 404):
        r.raise_for_status()

def _nc_ensure_folder() -> None:
    """Buat folder di Nextcloud jika belum ada (MKCOL per level)."""
    if not _nc_configured():
        return
    folder = NEXTCLOUD_FOLDER.strip("/")
    parts = folder.split("/")
    for i in range(1, len(parts) + 1):
        path = "/".join(parts[:i])
        url = f"{NEXTCLOUD_URL}/remote.php/dav/files/{NEXTCLOUD_USER}/{path}"
        try:
            r = _nc_http.request(
                "MKCOL", url,
                auth=(NEXTCLOUD_USER, NEXTCLOUD_APP_PASSWORD),
                timeout=10,
            )
            # 201 = created, 405 = already exists — keduanya ok
            if r.status_code not in (201, 405):
                r.raise_for_status()
        except Exception:
            pass  # jangan crash startup jika Nextcloud belum dikonfigurasi
```

- [ ] **Step 4: Panggil _nc_ensure_folder() di startup**

Ubah fungsi `startup()` (sekitar baris 392):
```python
@app.on_event("startup")
async def startup():
    global _tg_bot
    migrate_db()
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    _nc_ensure_folder()
    if TELEGRAM_BOT_TOKEN:
        try:
            from telegram import Bot as TelegramBot
            _tg_bot = TelegramBot(token=TELEGRAM_BOT_TOKEN)
        except Exception:
            pass
```

- [ ] **Step 5: Verifikasi server masih bisa start**

```bash
python3 -c "import webapp; print('OK')"
```
Expected: `OK` (tanpa error)

- [ ] **Step 6: Commit**

```bash
git add webapp.py
git commit -m "feat: add Nextcloud WebDAV helpers to webapp"
```

---

### Task 4: Upload + List Endpoints

**Files:**
- Modify: `webapp.py` (tambahkan setelah endpoint `/api/attachments/{attachment_id}/download`, sekitar baris 1049)

- [ ] **Step 1: Tambah endpoint POST upload**

```python
# ── Note Attachments ──────────────────────────────────────────────────────────

ALLOWED_NOTE_MIME = {"image/png", "image/jpeg", "image/webp", "application/pdf"}

@app.post("/api/scratchpad/{note_id}/attachments")
async def upload_note_attachment(note_id: int, file: UploadFile = FastAPIFile(...), user=Depends(get_current_user)):
    uid = user["sub"]
    if not _nc_configured():
        raise HTTPException(status_code=503, detail="Nextcloud belum dikonfigurasi")
    with get_db() as conn:
        access_clause, access_params = _note_access_clause(uid)
        row = conn.execute(
            f"SELECT id FROM scratchpad_notes WHERE id = ? AND {access_clause}",
            [note_id] + access_params
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Note tidak ditemukan")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail=f"File terlalu besar. Maks {MAX_FILE_SIZE // (1024*1024)}MB")

    original_name = file.filename or "file"
    mime_type = file.content_type or mimetypes.guess_type(original_name)[0] or "application/octet-stream"
    if mime_type not in ALLOWED_NOTE_MIME:
        raise HTTPException(status_code=415, detail="Hanya PNG, JPG, WebP, dan PDF yang diizinkan")

    ext = Path(original_name).suffix or ""
    nc_filename = f"{uuid.uuid4().hex}{ext}"

    try:
        _nc_upload(nc_filename, content, mime_type)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Upload ke Nextcloud gagal: {e}")

    with get_db() as conn:
        conn.execute(
            """INSERT INTO note_attachments (note_id, user_id, nextcloud_path, original_name, file_size, mime_type)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (note_id, uid, nc_filename, original_name, len(content), mime_type)
        )
        att_id = conn.execute("SELECT last_insert_rowid()").fetchone()[0]
        conn.commit()
        row = conn.execute("SELECT * FROM note_attachments WHERE id = ?", (att_id,)).fetchone()
        return dict(row)
```

- [ ] **Step 2: Tambah endpoint GET list**

```python
@app.get("/api/scratchpad/{note_id}/attachments")
async def list_note_attachments(note_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        access_clause, access_params = _note_access_clause(uid)
        row = conn.execute(
            f"SELECT id FROM scratchpad_notes WHERE id = ? AND {access_clause}",
            [note_id] + access_params
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Note tidak ditemukan")
        rows = conn.execute(
            "SELECT * FROM note_attachments WHERE note_id = ? ORDER BY created_at DESC",
            (note_id,)
        ).fetchall()
        return [dict(r) for r in rows]
```

- [ ] **Step 3: Test upload via curl (di VPS)**

```bash
# Upload gambar test
curl -X POST "http://localhost:8000/api/scratchpad/1/attachments" \
  -H "Authorization: Bearer <token>" \
  -F "file=@/tmp/test.png"
```
Expected: JSON `{"id": 1, "note_id": 1, "original_name": "test.png", ...}`

```bash
# List attachments
curl "http://localhost:8000/api/scratchpad/1/attachments" \
  -H "Authorization: Bearer <token>"
```
Expected: array dengan 1 item

- [ ] **Step 4: Commit**

```bash
git add webapp.py
git commit -m "feat: add note attachment upload and list endpoints"
```

---

### Task 5: View + Delete Endpoints

**Files:**
- Modify: `webapp.py` (tambahkan setelah endpoint list di Task 4)

- [ ] **Step 1: Tambah import Response content ke fastapi.responses**

Tambah `Response` ke import fastapi.responses (baris 33) jika belum ada. `Response` sudah ada di `from fastapi import ... Response ...` — tidak perlu tambah.

- [ ] **Step 2: Tambah endpoint GET view (proxy)**

```python
@app.get("/api/scratchpad/attachments/{attachment_id}/view")
async def view_note_attachment(attachment_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        att = conn.execute(
            "SELECT * FROM note_attachments WHERE id = ?", (attachment_id,)
        ).fetchone()
        if not att:
            raise HTTPException(status_code=404, detail="Attachment tidak ditemukan")
        access_clause, access_params = _note_access_clause(uid)
        note_row = conn.execute(
            f"SELECT id FROM scratchpad_notes WHERE id = ? AND {access_clause}",
            [att["note_id"]] + access_params
        ).fetchone()
        if not note_row:
            raise HTTPException(status_code=403, detail="Tidak diizinkan")

    if not _nc_configured():
        raise HTTPException(status_code=503, detail="Nextcloud belum dikonfigurasi")

    try:
        content = _nc_download(att["nextcloud_path"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Gagal mengambil file: {e}")

    return Response(
        content=content,
        media_type=att["mime_type"],
        headers={"Content-Disposition": f'inline; filename="{att["original_name"]}"'},
    )
```

- [ ] **Step 3: Tambah endpoint DELETE**

```python
@app.delete("/api/scratchpad/attachments/{attachment_id}")
async def delete_note_attachment(attachment_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        att = conn.execute(
            "SELECT * FROM note_attachments WHERE id = ?", (attachment_id,)
        ).fetchone()
        if not att:
            raise HTTPException(status_code=404, detail="Attachment tidak ditemukan")
        if att["user_id"] != uid:
            raise HTTPException(status_code=403, detail="Hanya pengunggah yang bisa menghapus")
        conn.execute("DELETE FROM note_attachments WHERE id = ?", (attachment_id,))
        conn.commit()

    try:
        _nc_delete_file(att["nextcloud_path"])
    except Exception:
        pass  # file sudah dihapus dari DB, best-effort hapus dari Nextcloud

    return {"ok": True}
```

- [ ] **Step 4: Test via curl**

```bash
# View (redirect ke browser untuk download)
curl -I "http://localhost:8000/api/scratchpad/attachments/1/view" \
  -H "Authorization: Bearer <token>"
```
Expected: `HTTP/1.1 200 OK` dengan `Content-Type: image/png`

```bash
# Delete
curl -X DELETE "http://localhost:8000/api/scratchpad/attachments/1" \
  -H "Authorization: Bearer <token>"
```
Expected: `{"ok": true}`

- [ ] **Step 5: Commit**

```bash
git add webapp.py
git commit -m "feat: add note attachment view and delete endpoints"
```

---

### Task 6: Frontend — CSS + marked Image Renderer

**Files:**
- Modify: `static/index.html`

- [ ] **Step 1: Tambah CSS untuk gambar inline**

Tambahkan setelah baris `.note-rendered li { margin-bottom: 3px; }` (sekitar baris 811):

```css
    .note-rendered img { max-width: 100%; border-radius: 6px; margin: 6px 0; display: block; }
    .img-offline-placeholder { display: inline-block; padding: 6px 10px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 6px; font-size: 12px; color: var(--text-light); }
```

- [ ] **Step 2: Override marked image renderer**

Di blok `marked.use({ ... })` yang sudah ada (sekitar baris 5477), tambahkan `image` renderer di dalam `renderer: { ... }`:

Ubah dari:
```javascript
    marked.use({
      gfm: true,
      renderer: {
        heading({ tokens, depth }) {
```
menjadi:
```javascript
    marked.use({
      gfm: true,
      renderer: {
        image({ href, text }) {
          const alt = text || "";
          return `<img src="${href}" alt="${alt}" onerror="this.style.display='none';this.nextElementSibling.style.display='inline-block'" /><span class="img-offline-placeholder" style="display:none">📎 ${alt} — tidak tersedia offline</span>`;
        },
        heading({ tokens, depth }) {
```

- [ ] **Step 3: Verifikasi**

Buka NoteModal, ketik `![test](https://example.com/nonexistent.png)`, klik Preview. Harus tampil placeholder "📎 test — tidak tersedia offline" (karena URL tidak ada).

- [ ] **Step 4: Commit**

```bash
git add static/index.html
git commit -m "feat: add img CSS and marked image renderer with offline placeholder"
```

---

### Task 7: Frontend — NoteToolbar 📎 Button

**Files:**
- Modify: `static/index.html` (fungsi `NoteToolbar`, sekitar baris 5523)

- [ ] **Step 1: Tambah props onAttachFile + uploading ke NoteToolbar**

Ubah signature dari:
```javascript
    function NoteToolbar({ textareaRef, value, onChange }) {
```
menjadi:
```javascript
    function NoteToolbar({ textareaRef, value, onChange, onAttachFile, uploading = false }) {
```

- [ ] **Step 2: Tambah tombol 📎 di toolbar**

Tambahkan di akhir return NoteToolbar, setelah tombol `─` (horizontal rule), sebelum penutup `</div>` (sekitar baris 5599):
```jsx
          <div className="sep"/>
          <button
            onMouseDown={e => { e.preventDefault(); onAttachFile?.(); }}
            title="Attach file (gambar/PDF)"
            disabled={uploading}
            style={{ opacity: uploading ? 0.5 : 1, cursor: uploading ? "wait" : "pointer" }}
          >{uploading ? "⏳" : "📎"}</button>
```

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "feat: add attach file button to NoteToolbar"
```

---

### Task 8: Frontend — NoteModal Auto-save + Upload Flow

**Files:**
- Modify: `static/index.html`
  - `handleSave` di NotesPage (sekitar baris 6706)
  - `NoteModal` function (sekitar baris 5654)
  - `saveOnly` di NoteModal (sekitar baris 5943)

- [ ] **Step 1: Modifikasi handleSave di NotesPage agar return note**

Ubah `handleSave` (baris 6706) dari:
```javascript
      const handleSave = async (data) => {
        const now = new Date().toISOString();
        try {
          if (selected?.id) {
            await api.put(`/api/scratchpad/${selected.id}`, data);
            showToast("✅ Catatan disimpan");
          } else {
            await api.post("/api/scratchpad", data);
            showToast("✅ Catatan dibuat");
          }
          await fetchNotes(q, activeTags);
          window.dispatchEvent(new CustomEvent("noteSaved"));
        } catch (e) {
```
menjadi:
```javascript
      const handleSave = async (data) => {
        const now = new Date().toISOString();
        try {
          let saved;
          if (selected?.id) {
            saved = await api.put(`/api/scratchpad/${selected.id}`, data);
            showToast("✅ Catatan disimpan");
          } else {
            saved = await api.post("/api/scratchpad", data);
            showToast("✅ Catatan dibuat");
          }
          await fetchNotes(q, activeTags);
          window.dispatchEvent(new CustomEvent("noteSaved"));
          return saved;
        } catch (e) {
```

- [ ] **Step 2: Tambah state savedNoteId di NoteModal**

Tambahkan setelah baris `const [saving, setSaving] = useState(false);` (sekitar baris 5669):
```javascript
      const [savedNoteId, setSavedNoteId] = useState(note?.id ?? null);
      const [attUploading, setAttUploading] = useState(false);
      const fileInputRef = useRef(null);
```

- [ ] **Step 3: Modifikasi saveOnly di NoteModal agar return note**

Ubah `saveOnly` (baris 5943) dari:
```javascript
      const saveOnly = async () => {
        setSaving(true);
        clearTimeout(autosaveTimerRef.current);
        await onSave({ title, content, tags, linked_task_ids: linkedTaskIds, linked_task_id: linkedTaskIds[0] || null });
        isDirtyRef.current = false;
        setSaving(false);
      };
```
menjadi:
```javascript
      const saveOnly = async () => {
        setSaving(true);
        clearTimeout(autosaveTimerRef.current);
        const saved = await onSave({ title, content, tags, linked_task_ids: linkedTaskIds, linked_task_id: linkedTaskIds[0] || null });
        if (saved?.id) setSavedNoteId(saved.id);
        isDirtyRef.current = false;
        setSaving(false);
        return saved;
      };
```

- [ ] **Step 4: Tambah handleAttachFile + handleFileChange di NoteModal**

Tambahkan setelah `saveOnly` dan `handleSave` (setelah baris 5951):
```javascript
      const handleAttachFile = async () => {
        let nid = savedNoteId;
        if (!nid) {
          const saved = await saveOnly();
          nid = saved?.id;
          if (!nid) { showToast("Gagal menyimpan note sebelum upload", "error"); return; }
        }
        fileInputRef.current?.click();
      };

      const handleFileChange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = "";
        const nid = savedNoteId;
        if (!nid) return;
        setAttUploading(true);
        try {
          const formData = new FormData();
          formData.append("file", file);
          const res = await fetch(`/api/scratchpad/${nid}/attachments`, {
            method: "POST",
            headers: __token ? { "Authorization": "Bearer " + __token } : {},
            body: formData,
          });
          if (!res.ok) { const err = await res.json(); throw new Error(err.detail || "Upload gagal"); }
          const att = await res.json();
          const isImage = att.mime_type.startsWith("image/");
          const url = `/api/scratchpad/attachments/${att.id}/view`;
          const syntax = isImage
            ? `![${att.original_name}](${url})`
            : `[📄 ${att.original_name}](${url})`;
          const el = textareaRef.current;
          if (el) {
            const s = el.selectionStart ?? content.length;
            const newVal = content.slice(0, s) + syntax + content.slice(s);
            handleContentChange(newVal);
          } else {
            handleContentChange(content + "\n" + syntax);
          }
          setAttRefreshKey(k => k + 1);
          showToast("📎 File berhasil di-upload");
        } catch(err) {
          showToast(err.message || "Upload gagal", "error");
        } finally {
          setAttUploading(false);
        }
      };
```

- [ ] **Step 5: Tambah state attRefreshKey di NoteModal**

Tambahkan setelah `const fileInputRef = useRef(null);` (dari Step 2):
```javascript
      const [attRefreshKey, setAttRefreshKey] = useState(0);
```

- [ ] **Step 6: Tambah hidden file input + pass props ke NoteToolbar**

Tambahkan hidden input di JSX NoteModal, tepat sebelum `<NoteToolbar ...` (sekitar baris 6013):
```jsx
              <input type="file" ref={fileInputRef} style={{ display: "none" }}
                accept=".png,.jpg,.jpeg,.webp,.pdf"
                onChange={handleFileChange} />
```

Ubah `<NoteToolbar ...` dari:
```jsx
              <NoteToolbar textareaRef={textareaRef} value={content} onChange={handleContentChange} />
```
menjadi:
```jsx
              <NoteToolbar textareaRef={textareaRef} value={content} onChange={handleContentChange}
                onAttachFile={handleAttachFile} uploading={attUploading} />
```

- [ ] **Step 7: Test manual**

1. Buka NoteModal (note baru)
2. Klik 📎 → harus auto-save note dulu (toast "✅ Catatan dibuat"), lalu file picker terbuka
3. Pilih gambar PNG → toast "📎 File berhasil di-upload", syntax `![filename](url)` masuk ke editor
4. Klik Preview → gambar tampil inline

- [ ] **Step 8: Commit**

```bash
git add static/index.html
git commit -m "feat: NoteModal auto-save + file upload flow via toolbar"
```

---

### Task 9: AttachmentsPanel Component + Wire ke NoteModal + NotePanel

**Files:**
- Modify: `static/index.html`

- [ ] **Step 1: Tambah AttachmentsPanel component**

Tambahkan sebelum fungsi `NoteModal` (sekitar baris 5654):
```javascript
    function AttachmentsPanel({ noteId, refreshKey = 0 }) {
      const [attachments, setAttachments] = useState([]);

      useEffect(() => {
        if (!noteId) return;
        api.get(`/api/scratchpad/${noteId}/attachments`)
          .then(setAttachments)
          .catch(() => {});
      }, [noteId, refreshKey]);

      const handleDelete = async (id) => {
        if (!window.confirm("Hapus attachment ini?")) return;
        try {
          await api.del(`/api/scratchpad/attachments/${id}`);
          setAttachments(prev => prev.filter(a => a.id !== id));
        } catch(e) { /* silent */ }
      };

      const fmtSize = (bytes) => {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      };

      if (!noteId || attachments.length === 0) return null;

      return (
        <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <div className="notes-section-label" style={{ marginBottom: 8 }}>📎 Attachments ({attachments.length})</div>
          {attachments.map(a => (
            <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid var(--border)" }}>
              <span style={{ fontSize: 14 }}>{a.mime_type.startsWith("image/") ? "🖼" : "📄"}</span>
              <a href={`/api/scratchpad/attachments/${a.id}/view`} target="_blank" rel="noopener"
                style={{ flex: 1, fontSize: 13, color: "var(--accent)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {a.original_name}
              </a>
              <span style={{ fontSize: 11, color: "var(--text-light)", flexShrink: 0 }}>{fmtSize(a.file_size)}</span>
              <span onClick={() => handleDelete(a.id)}
                style={{ cursor: "pointer", fontSize: 14, color: "var(--text-light)", padding: "0 4px", flexShrink: 0 }}
                title="Hapus">✕</span>
            </div>
          ))}
        </div>
      );
    }
```

- [ ] **Step 2: Wire AttachmentsPanel ke NoteModal**

Di JSX NoteModal, cari area setelah konten editor dan sebelum penutup modal (sekitar baris 6180 area tombol simpan). Tambahkan `<AttachmentsPanel>` setelah `<NoteToolbar>` dan editor textarea. Tepatnya tambahkan setelah blok preview/editor (setelah closing tag textarea atau preview div), sebelum bagian linked tasks.

Cari pattern ini di NoteModal (sekitar area baris 6046):
```jsx
              <div className="note-rendered note-modal-content-input"
```
Tambahkan setelah closing `</div>` blok preview tersebut (atau setelah `</textarea>`):
```jsx
              <AttachmentsPanel noteId={savedNoteId} refreshKey={attRefreshKey} />
```

- [ ] **Step 3: Wire AttachmentsPanel ke NotePanel**

Di fungsi `NotePanel`, cari setelah blok rendered content (`{/* Rendered content */}`, sekitar baris 6469). Tambahkan setelah closing `</div>` dari `note-rendered`:
```jsx
          <AttachmentsPanel noteId={note.id} />
```

- [ ] **Step 4: Test manual**

1. Upload file di NoteModal → panel Attachments langsung muncul di bawah editor
2. Buka note di NotePanel → panel Attachments tampil dengan file yang sama
3. Klik ✕ di panel → konfirmasi → file hilang dari panel
4. Note tanpa attachment → panel tidak tampil (karena `AttachmentsPanel` return null saat kosong)

- [ ] **Step 5: Commit + push**

```bash
git add static/index.html
git commit -m "feat: add AttachmentsPanel component to NoteModal and NotePanel"
git push
```

---

## Catatan Penting untuk Implementer

1. **`__token`** — variabel dari closure `tokenStore` di scope global index.html. Bisa langsung dipakai di dalam komponen karena semua komponen ada dalam satu file (tidak ada module boundary).

2. **Nextcloud belum dikonfigurasi** — endpoint return 503. Upload button di toolbar akan tampil error toast. Ini expected behavior selama development.

3. **Urutan routing FastAPI** — `GET /api/scratchpad/attachments/{id}/view` HARUS didefinisikan sebelum route yang mungkin conflict. Letakkan endpoint ini setelah `GET /api/scratchpad/{note_id}/attachments` agar FastAPI tidak salah route.

4. **ON DELETE CASCADE** — tabel `note_attachments` punya FK ke `scratchpad_notes` dengan CASCADE. Saat note dihapus, semua attachment record ikut terhapus dari DB. File di Nextcloud TIDAK otomatis terhapus — ini known limitation (orphan files). Acceptable untuk sekarang.

5. **`handleContentChange`** — fungsi ini ada di scope NoteModal (didefinisikan baris 5833). Bisa langsung dipakai di `handleFileChange` yang juga ada di scope NoteModal.
