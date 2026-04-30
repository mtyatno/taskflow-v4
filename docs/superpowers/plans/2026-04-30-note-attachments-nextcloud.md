# Note Attachments via Nextcloud Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** User dapat attach file (gambar PNG/JPG/WebP + PDF) ke notes, disimpan di Nextcloud via WebDAV, ditampilkan inline di rendered note, dan dapat dihapus dari panel di NoteModal.

**Architecture:** TaskFlow menerima upload dari browser, PUT ke Nextcloud WebDAV menggunakan App Password, simpan metadata di tabel `note_attachments`. Download/view diproxy oleh TaskFlow sehingga Nextcloud tidak perlu akses publik. Tombol 📎 di NoteToolbar, auto-save note baru sebelum upload.

**Tech Stack:** FastAPI `StreamingResponse`, Python `requests` (WebDAV), SQLite, React (Babel in-browser), marked.js image renderer override.

**Nextcloud:**
- URL: `https://files.yatno.web.id`
- User: `taskflow`
- App Password: `nKWMx-5NXjj-ezkZE-PkGPk-omZ7w` ← simpan di `.env` VPS, jangan di kode
- Folder: `/TaskFlow/attachments`

---

## Files

| File | Action |
|------|--------|
| `config.py` | Modify — add `NEXTCLOUD_URL/USER/APP_PASSWORD/FOLDER` |
| `requirements.txt` | Modify — add `requests` |
| `repository.py` | Modify — add `note_attachments` table migration |
| `webapp.py` | Modify — add WebDAV helpers + 4 endpoints |
| `static/index.html` | Modify — CSS img, marked renderer, NoteToolbar 📎, NoteModal panel |
| `static/sw.js` | Modify — bump cache version |

---

### Task 1: config.py + requirements.txt

**Files:**
- Modify: `config.py`
- Modify: `requirements.txt`

- [ ] **Step 1: Add Nextcloud vars to config.py**

Buka `config.py`, cari baris terakhir (`WEBAPP_URL = ...`). Tambah setelah baris itu:

```python
# Nextcloud (WebDAV)
NEXTCLOUD_URL = os.getenv("NEXTCLOUD_URL", "")
NEXTCLOUD_USER = os.getenv("NEXTCLOUD_USER", "")
NEXTCLOUD_APP_PASSWORD = os.getenv("NEXTCLOUD_APP_PASSWORD", "")
NEXTCLOUD_FOLDER = os.getenv("NEXTCLOUD_FOLDER", "/TaskFlow/attachments")
```

- [ ] **Step 2: Add requests to requirements.txt**

Tambah baris berikut di `requirements.txt`:

```
requests==2.*
```

- [ ] **Step 3: Verify**

```bash
grep -n "NEXTCLOUD" config.py
grep "requests" requirements.txt
```

Expected:
```
43:NEXTCLOUD_URL = os.getenv(...)
44:NEXTCLOUD_USER = ...
45:NEXTCLOUD_APP_PASSWORD = ...
46:NEXTCLOUD_FOLDER = ...
requests==2.*
```

- [ ] **Step 4: Commit**

```bash
git add config.py requirements.txt
git commit -m "feat: add Nextcloud config vars and requests dependency"
```

---

### Task 2: repository.py — note_attachments table

**Files:**
- Modify: `repository.py`

- [ ] **Step 1: Add note_attachments table migration**

Di `repository.py`, cari blok `CREATE TABLE IF NOT EXISTS drawings`. Tambah SETELAH blok itu (setelah closing `""")` dari drawings):

```python
            conn.execute("""
                CREATE TABLE IF NOT EXISTS note_attachments (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    note_id         INTEGER NOT NULL REFERENCES scratchpad_notes(id) ON DELETE CASCADE,
                    user_id         INTEGER NOT NULL REFERENCES users(id),
                    nextcloud_path  TEXT NOT NULL,
                    original_name   TEXT NOT NULL,
                    file_size       INTEGER NOT NULL,
                    mime_type       TEXT NOT NULL,
                    created_at      TEXT DEFAULT (datetime('now'))
                )
            """)
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_note_attachments_note_id ON note_attachments(note_id)"
            )
```

- [ ] **Step 2: Verify pattern found**

```bash
grep -n "note_attachments\|idx_note_attachments" repository.py
```

Expected:
```
NNN:                    CREATE TABLE IF NOT EXISTS note_attachments (
NNN:            conn.execute(
NNN:                "CREATE INDEX IF NOT EXISTS idx_note_attachments_note_id ...
```

- [ ] **Step 3: Commit**

```bash
git add repository.py
git commit -m "feat: add note_attachments table migration"
```

---

### Task 3: webapp.py — WebDAV helpers + 4 endpoints

**Files:**
- Modify: `webapp.py`

- [ ] **Step 1: Add Nextcloud imports and config to webapp.py**

Cari baris import dari config:
```python
from config import DB_PATH, EISENHOWER_INTERVAL_MINUTES, UPLOAD_DIR, MAX_FILE_SIZE, TELEGRAM_BOT_USERNAME
```

Ganti dengan:
```python
from config import DB_PATH, EISENHOWER_INTERVAL_MINUTES, UPLOAD_DIR, MAX_FILE_SIZE, TELEGRAM_BOT_USERNAME, NEXTCLOUD_URL, NEXTCLOUD_USER, NEXTCLOUD_APP_PASSWORD, NEXTCLOUD_FOLDER
```

- [ ] **Step 2: Add WebDAV helper functions**

Cari baris `# ── Config ──` di webapp.py. Tambah helper functions SETELAH blok config (setelah `STATIC_DIR = ...`):

```python
# ── Nextcloud WebDAV helpers ────────────────────────────────────────────────
def _nc_dav_url(path: str) -> str:
    return f"{NEXTCLOUD_URL.rstrip('/')}/remote.php/dav/files/{NEXTCLOUD_USER}{path}"

def _nc_auth() -> tuple:
    return (NEXTCLOUD_USER, NEXTCLOUD_APP_PASSWORD)

def _nc_ensure_folder() -> None:
    import requests as _req
    url = _nc_dav_url(NEXTCLOUD_FOLDER)
    r = _req.request("MKCOL", url, auth=_nc_auth(), timeout=10)
    if r.status_code not in (201, 405):  # 201=created, 405=already exists
        raise HTTPException(status_code=500, detail=f"Nextcloud folder error: {r.status_code}")
```

- [ ] **Step 3: Add 4 note attachment endpoints**

Cari endpoint `@app.get("/api/export/download")`. Tambah 4 endpoint SEBELUM-nya:

```python
_ALLOWED_ATTACH_MIME = {"image/png", "image/jpeg", "image/webp", "application/pdf"}

@app.post("/api/scratchpad/{note_id}/attachments")
async def upload_note_attachment(note_id: int, file: UploadFile = FastAPIFile(...), user=Depends(get_current_user)):
    import requests as _req
    uid = user["sub"]
    with get_db() as conn:
        note = conn.execute(
            "SELECT id FROM scratchpad_notes WHERE id=? AND user_id=?", (note_id, uid)
        ).fetchone()
        if not note:
            raise HTTPException(status_code=404, detail="Note tidak ditemukan")

    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail=f"File terlalu besar. Maks {MAX_FILE_SIZE // (1024*1024)}MB")

    original_name = file.filename or "file"
    mime_type = file.content_type or mimetypes.guess_type(original_name)[0] or "application/octet-stream"
    if mime_type not in _ALLOWED_ATTACH_MIME:
        raise HTTPException(status_code=415, detail="Tipe file tidak diizinkan. Gunakan PNG, JPG, WebP, atau PDF")

    ext = Path(original_name).suffix or ""
    nc_path = f"{NEXTCLOUD_FOLDER}/{uuid.uuid4()}{ext}"

    _nc_ensure_folder()
    r = _req.put(_nc_dav_url(nc_path), data=content, auth=_nc_auth(), timeout=60,
                 headers={"Content-Type": mime_type})
    if r.status_code not in (200, 201, 204):
        raise HTTPException(status_code=500, detail=f"Upload ke Nextcloud gagal: {r.status_code}")

    with get_db() as conn:
        cur = conn.execute(
            "INSERT INTO note_attachments (note_id, user_id, nextcloud_path, original_name, file_size, mime_type) VALUES (?,?,?,?,?,?)",
            (note_id, uid, nc_path, original_name, len(content), mime_type)
        )
        conn.commit()
        row = conn.execute("SELECT * FROM note_attachments WHERE id=?", (cur.lastrowid,)).fetchone()
        return dict(row)

@app.get("/api/scratchpad/{note_id}/attachments")
async def list_note_attachments(note_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        note = conn.execute(
            "SELECT id FROM scratchpad_notes WHERE id=? AND user_id=?", (note_id, uid)
        ).fetchone()
        if not note:
            raise HTTPException(status_code=404, detail="Note tidak ditemukan")
        rows = conn.execute(
            "SELECT * FROM note_attachments WHERE note_id=? ORDER BY id", (note_id,)
        ).fetchall()
        return [dict(r) for r in rows]

@app.delete("/api/scratchpad/attachments/{att_id}")
async def delete_note_attachment(att_id: int, user=Depends(get_current_user)):
    import requests as _req
    uid = user["sub"]
    with get_db() as conn:
        att = conn.execute("SELECT * FROM note_attachments WHERE id=?", (att_id,)).fetchone()
        if not att:
            raise HTTPException(status_code=404, detail="Attachment tidak ditemukan")
        if att["user_id"] != uid:
            raise HTTPException(status_code=403, detail="Bukan attachment milikmu")
        _req.delete(_nc_dav_url(att["nextcloud_path"]), auth=_nc_auth(), timeout=10)
        conn.execute("DELETE FROM note_attachments WHERE id=?", (att_id,))
        conn.commit()
    return {"ok": True}

@app.get("/api/scratchpad/attachments/{att_id}/view")
async def view_note_attachment(att_id: int, user=Depends(get_current_user)):
    import requests as _req
    uid = user["sub"]
    with get_db() as conn:
        att = conn.execute("SELECT * FROM note_attachments WHERE id=?", (att_id,)).fetchone()
        if not att:
            raise HTTPException(status_code=404, detail="Attachment tidak ditemukan")
        if att["user_id"] != uid:
            raise HTTPException(status_code=403, detail="Bukan attachment milikmu")
    r = _req.get(_nc_dav_url(att["nextcloud_path"]), auth=_nc_auth(), timeout=30, stream=True)
    if r.status_code != 200:
        raise HTTPException(status_code=404, detail="File tidak ditemukan di Nextcloud")
    return StreamingResponse(
        r.iter_content(chunk_size=8192),
        media_type=att["mime_type"],
        headers={"Content-Disposition": f'inline; filename="{att["original_name"]}"'}
    )
```

- [ ] **Step 4: Verify endpoints registered**

```bash
grep -n "scratchpad.*attachments\|note_attachment" webapp.py | head -10
```

Expected: 4 endpoint decorators + helper functions.

- [ ] **Step 5: Commit**

```bash
git add webapp.py
git commit -m "feat: add note attachment endpoints with Nextcloud WebDAV"
```

---

### Task 4: index.html — CSS + marked image renderer + NoteToolbar 📎 + NoteModal panel

**Files:**
- Modify: `static/index.html` (gunakan Python scripts)

- [ ] **Step 1: Add img CSS for note-rendered**

```bash
python3 << 'EOF'
with open('static/index.html', encoding='utf-8') as f:
    html = f.read()

old = '.note-card { background: var(--bg-card);'
new = """.note-rendered img { max-width: 100%; border-radius: 6px; margin: 6px 0; display: block; }
    .img-offline-placeholder { font-size: 12px; color: var(--text-light); font-style: italic; }
    .note-attachments-panel { margin-top: 12px; border-top: 1px solid var(--border); padding-top: 10px; }
    .note-attach-row { display: flex; align-items: center; gap: 8px; padding: 4px 0; font-size: 13px; }
    .note-card { background: var(--bg-card);"""

if old in html:
    html = html.replace(old, new, 1)
    print('CSS added: OK')
else:
    print('Pattern not found')

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
EOF
```

- [ ] **Step 2: Add image renderer override to marked.use**

```bash
python3 << 'EOF'
with open('static/index.html', encoding='utf-8') as f:
    html = f.read()

old = """        listitem(item) {
          if (item.task) {"""

new = """        image({ href, text }) {
          const esc = (text || '').replace(/"/g, '&quot;');
          return `<img src="${href}" alt="${esc}" onerror="this.style.display='none';this.nextSibling&&(this.nextSibling.style.display='inline')" /><span class="img-offline-placeholder" style="display:none">📎 ${esc} — tidak tersedia offline</span>`;
        },
        listitem(item) {
          if (item.task) {"""

if old in html:
    html = html.replace(old, new, 1)
    print('marked image renderer: OK')
else:
    print('Pattern not found')

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
EOF
```

- [ ] **Step 3: Add 📎 button and upload logic to NoteToolbar**

NoteToolbar perlu props tambahan: `noteId` dan `onAttachUploaded`. Cari:
```
function NoteToolbar({ textareaRef, value, onChange }) {
```
Ganti dengan:
```
function NoteToolbar({ textareaRef, value, onChange, noteId, onAttachUploaded }) {
```

Dan tambah state + handler setelah `const hRef = React.useRef(null);`:
```
      const fileInputRef = React.useRef(null);
      const [uploading, setUploading] = React.useState(false);

      const handleAttachFile = async (e) => {
        const file = e.target.files?.[0];
        if (!file || !nodeId) return;
        setUploading(true);
        try {
          const formData = new FormData();
          formData.append('file', file);
          const headers = {};
          if (typeof __token !== 'undefined' && __token) headers['Authorization'] = 'Bearer ' + __token;
          const res = await fetch(`/api/scratchpad/${noteId}/attachments`, { method: 'POST', headers, body: formData });
          if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Upload gagal'); }
          const att = await res.json();
          const isImage = att.mime_type.startsWith('image/');
          const url = `/api/scratchpad/attachments/${att.id}/view`;
          const syntax = isImage ? `![${att.original_name}](${url})` : `[📄 ${att.original_name}](${url})`;
          insert(syntax, '', '');
          onAttachUploaded?.(att);
        } catch (err) { alert(err.message); }
        finally { setUploading(false); e.target.value = ''; }
      };
```

Dan di JSX return NoteToolbar, tambah sebelum closing `</div>`:
```jsx
          <div className="sep"/>
          <input ref={fileInputRef} type="file" accept=".png,.jpg,.jpeg,.webp,.pdf" style={{ display: 'none' }} onChange={handleAttachFile} />
          <button onClick={() => noteId && fileInputRef.current?.click()} title={noteId ? 'Lampirkan file' : 'Simpan note dulu'} disabled={uploading || !noteId} style={{ opacity: noteId ? 1 : 0.4 }}>
            {uploading ? '⏳' : '📎'}
          </button>
```

```bash
python3 << 'PYEOF'
import io as _io, sys
sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('static/index.html', encoding='utf-8') as f:
    html = f.read()

# Fix typo: nodeId should be noteId in the handler
# First change signature
old_sig = 'function NoteToolbar({ textareaRef, value, onChange }) {'
new_sig = 'function NoteToolbar({ textareaRef, value, onChange, noteId, onAttachUploaded }) {'
if old_sig in html:
    html = html.replace(old_sig, new_sig, 1)
    print('NoteToolbar signature: OK')
else:
    print('ERROR: signature not found')

# Add state + handler after hRef
old_href = '      const hRef = React.useRef(null);\n\n      React.useEffect(() => {'
new_href = """      const hRef = React.useRef(null);
      const fileInputRef = React.useRef(null);
      const [uploading, setUploading] = React.useState(false);

      const handleAttachFile = async (e) => {
        const file = e.target.files?.[0];
        if (!file || !noteId) return;
        setUploading(true);
        try {
          const formData = new FormData();
          formData.append('file', file);
          const headers = {};
          if (typeof __token !== 'undefined' && __token) headers['Authorization'] = 'Bearer ' + __token;
          const res = await fetch(`/api/scratchpad/${noteId}/attachments`, { method: 'POST', headers, body: formData });
          if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Upload gagal'); }
          const att = await res.json();
          const isImage = att.mime_type.startsWith('image/');
          const url = `/api/scratchpad/attachments/${att.id}/view`;
          const syntax = isImage ? `![${att.original_name}](${url})` : `[📄 ${att.original_name}](${url})`;
          insert(syntax, '', '');
          onAttachUploaded?.(att);
        } catch (err) { alert(err.message); }
        finally { setUploading(false); e.target.value = ''; }
      };

      React.useEffect(() => {"""

if '      const hRef = React.useRef(null);\n\n      React.useEffect(() => {' in html:
    html = html.replace('      const hRef = React.useRef(null);\n\n      React.useEffect(() => {', new_href, 1)
    print('NoteToolbar handler: OK')
else:
    print('ERROR: hRef pattern not found')

# Add 📎 button before closing </div> of NoteToolbar return
old_close = '        </div>\n      );\n    }\n\n    function AdminTemplateModal'
new_close = """          <div className="sep"/>
          <input ref={fileInputRef} type="file" accept=".png,.jpg,.jpeg,.webp,.pdf" style={{ display: 'none' }} onChange={handleAttachFile} />
          <button onClick={() => noteId && fileInputRef.current?.click()} title={noteId ? 'Lampirkan file' : 'Simpan note dulu'} disabled={uploading || !noteId} style={{ opacity: noteId ? 1 : 0.4 }}>
            {uploading ? '⏳' : '📎'}
          </button>
        </div>
      );
    }

    function AdminTemplateModal"""

if '        </div>\n      );\n    }\n\n    function AdminTemplateModal' in html:
    html = html.replace('        </div>\n      );\n    }\n\n    function AdminTemplateModal', new_close, 1)
    print('📎 button: OK')
else:
    print('ERROR: NoteToolbar closing not found')

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
PYEOF
```

- [ ] **Step 4: Add savedNoteId state + onAttachUploaded + attachment panel to NoteModal**

```bash
python3 << 'PYEOF'
import io as _io, sys
sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('static/index.html', encoding='utf-8') as f:
    html = f.read()

# Add savedNoteId state after existing states in NoteModal
old_dirty = '      const isDirtyRef                = useRef(false);'
new_dirty = """      const isDirtyRef                = useRef(false);
      const [savedNoteId, setSavedNoteId] = React.useState(note?.id || null);
      const [attachments, setAttachments] = React.useState([]);"""

if old_dirty in html:
    html = html.replace(old_dirty, new_dirty, 1)
    print('savedNoteId state: OK')
else:
    print('ERROR: isDirtyRef not found')

# Add attachment fetch useEffect after existing useEffects (after autosave effect)
# Find a unique pattern near the end of NoteModal's useEffects
old_save_only = '      const saveOnly = async () => {'
new_save_only = """      React.useEffect(() => {
        if (!savedNoteId) return;
        api.get(`/api/scratchpad/${savedNoteId}/attachments`)
          .then(d => setAttachments(d))
          .catch(() => {});
      }, [savedNoteId]);

      const saveOnly = async () => {"""

if '      const saveOnly = async () => {' in html:
    html = html.replace('      const saveOnly = async () => {', new_save_only, 1)
    print('attachment fetch effect: OK')
else:
    print('ERROR: saveOnly not found')

# Modify saveOnly to capture savedNoteId
old_save_body = """      const saveOnly = async () => {
        setSaving(true);
        clearTimeout(autosaveTimerRef.current);
        await onSave({ title, content, tags, linked_task_ids: linkedTaskIds, linked_task_id: linkedTaskIds[0] || null });
        isDirtyRef.current = false;
        setSaving(false);
      };"""

new_save_body = """      const saveOnly = async () => {
        setSaving(true);
        clearTimeout(autosaveTimerRef.current);
        const saved = await onSave({ title, content, tags, linked_task_ids: linkedTaskIds, linked_task_id: linkedTaskIds[0] || null });
        if (saved?.id && !savedNoteId) setSavedNoteId(saved.id);
        isDirtyRef.current = false;
        setSaving(false);
      };"""

if old_save_body in html:
    html = html.replace(old_save_body, new_save_body, 1)
    print('saveOnly with ID capture: OK')
else:
    print('ERROR: saveOnly body not found')

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
PYEOF
```

- [ ] **Step 5: Pass noteId + onAttachUploaded to NoteToolbar and add attachment panel JSX**

```bash
python3 << 'PYEOF'
import io as _io, sys
sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('static/index.html', encoding='utf-8') as f:
    html = f.read()

# Pass noteId to NoteToolbar
old_toolbar = '<NoteToolbar textareaRef={textareaRef} value={content} onChange={handleContentChange} />'
new_toolbar = '<NoteToolbar textareaRef={textareaRef} value={content} onChange={handleContentChange} noteId={savedNoteId} onAttachUploaded={att => setAttachments(prev => [...prev, att])} />'

if old_toolbar in html:
    html = html.replace(old_toolbar, new_toolbar, 1)
    print('NoteToolbar props: OK')
else:
    print('ERROR: NoteToolbar usage not found')

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
PYEOF
```

Now tambah attachment panel JSX. Cari area di NoteModal return di mana canvas draw ditampilkan. Panel attachment ditambah SETELAH canvas section dan SEBELUM action buttons ("Link ke Task" / tombol simpan). Gunakan pola:

```bash
python3 << 'PYEOF'
import io as _io, sys
sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('static/index.html', encoding='utf-8') as f:
    html = f.read()

# Find action buttons area in NoteModal - look for "Link ke Task" label
# Insert attachment panel before it
old_link_task = '        {/* Link ke Task */'
new_link_task = """        {attachments.length > 0 && (
          <div className="note-attachments-panel">
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-secondary)', marginBottom: 6 }}>
              Lampiran ({attachments.length})
            </div>
            {attachments.map(att => (
              <div key={att.id} className="note-attach-row">
                <span style={{ fontSize: 16 }}>{att.mime_type.startsWith('image/') ? '🖼' : '📄'}</span>
                <a href={`/api/scratchpad/attachments/${att.id}/view`} target="_blank" rel="noreferrer"
                   style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--accent)', textDecoration: 'none' }}>
                  {att.original_name}
                </a>
                <span style={{ fontSize: 11, color: 'var(--text-light)', flexShrink: 0 }}>
                  {att.file_size > 1048576 ? (att.file_size/1048576).toFixed(1)+'MB' : Math.round(att.file_size/1024)+'KB'}
                </span>
                <button onClick={async () => {
                  if (!window.confirm('Hapus lampiran ini?')) return;
                  try {
                    await api.del(`/api/scratchpad/attachments/${att.id}`);
                    setAttachments(prev => prev.filter(a => a.id !== att.id));
                  } catch (e) { alert(e.message); }
                }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-light)', fontSize: 15, flexShrink: 0 }}>🗑</button>
              </div>
            ))}
          </div>
        )}
        {/* Link ke Task */"""

if "        {/* Link ke Task */" in html:
    html = html.replace("        {/* Link ke Task */", new_link_task, 1)
    print('Attachment panel: OK')
else:
    # Try alternate
    idx = html.find('Link ke Task')
    print(f'Link ke Task at {idx}:', repr(html[idx-30:idx+50]))

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
PYEOF
```

- [ ] **Step 6: Fix handleSave in NotesPage to return saved note**

```bash
python3 << 'PYEOF'
import io as _io, sys
sys.stdout = _io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('static/index.html', encoding='utf-8') as f:
    html = f.read()

old_handle = """        const handleSave = async (data) => {
        const now = new Date().toISOString();
        try {
          if (selected?.id) {
            await api.put(`/api/scratchpad/${selected.id}`, data);
            showToast("✅ Catatan disimpan");
          } else {
            await api.post("/api/scratchpad", data);
            showToast("✅ Catatan dibuat");
          }"""

new_handle = """        const handleSave = async (data) => {
        const now = new Date().toISOString();
        try {
          if (selected?.id) {
            await api.put(`/api/scratchpad/${selected.id}`, data);
            showToast("✅ Catatan disimpan");
            return { id: selected.id };
          } else {
            const created = await api.post("/api/scratchpad", data);
            showToast("✅ Catatan dibuat");
            return created;
          }"""

if old_handle in html:
    html = html.replace(old_handle, new_handle, 1)
    print('handleSave return: OK')
else:
    print('ERROR: handleSave pattern not found')

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
PYEOF
```

- [ ] **Step 7: Verify all changes**

```bash
python3 -c "
with open('static/index.html', encoding='utf-8') as f:
    h = f.read()
print('img CSS:', '.note-rendered img' in h)
print('marked image renderer:', 'img-offline-placeholder' in h)
print('NoteToolbar noteId prop:', 'noteId, onAttachUploaded' in h)
print('📎 button:', 'Lampirkan file' in h)
print('savedNoteId:', 'savedNoteId' in h)
print('attachments state:', 'setAttachments' in h)
print('attachment panel:', 'note-attachments-panel' in h)
print('handleSave returns:', 'return created' in h)
"
```

Expected: semua `True`.

- [ ] **Step 8: Bump SW cache and commit**

```bash
python3 -c "
with open('static/sw.js', encoding='utf-8') as f:
    c = f.read()
c = c.replace('\"taskflow-v8-export\"', '\"taskflow-v9-attach\"', 1)
with open('static/sw.js', 'w', encoding='utf-8') as f:
    f.write(c)
print('Cache bumped:', '\"taskflow-v9-attach\"' in c)
"

git add static/index.html static/sw.js
git commit -m "feat: add note attachment UI — toolbar 📎 button and attachment panel"
```

---

### Task 5: Deploy + .env VPS + test

**Files:**
- `.env` di VPS (manual — tidak masuk git)

- [ ] **Step 1: Push ke GitHub**

```bash
git push
```

- [ ] **Step 2: Tambah Nextcloud vars ke .env di VPS**

SSH ke VPS, edit `.env`:
```bash
# Tambah baris ini ke .env
NEXTCLOUD_URL=https://files.yatno.web.id
NEXTCLOUD_USER=taskflow
NEXTCLOUD_APP_PASSWORD=nKWMx-5NXjj-ezkZE-PkGPk-omZ7w
NEXTCLOUD_FOLDER=/TaskFlow/attachments
```

- [ ] **Step 3: Tunggu CI/CD deploy selesai, lalu restart service**

Restart service seperti biasa. Saat startup, `note_attachments` table akan dibuat otomatis via migration.

- [ ] **Step 4: Test manual**

1. Buka app → Notes → buka atau buat note
2. Di toolbar klik 📎
3. Pilih gambar PNG/JPG → upload
4. Sintaks `![namafile.jpg](/api/scratchpad/attachments/1/view)` muncul di textarea
5. Switch ke Preview → gambar muncul inline
6. Panel "Lampiran (1)" muncul di bawah note
7. Klik 🗑 → konfirmasi → attachment hilang dari panel dan Nextcloud
