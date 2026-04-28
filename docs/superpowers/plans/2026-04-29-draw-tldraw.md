# Draw (tldraw) Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambah fitur drawing canvas di setiap note menggunakan tldraw, fully offline (PWA), dengan sync ke backend saat online.

**Architecture:** Mini React app (`draw-app/`) di-build dengan Vite menghasilkan static files yang di-serve FastAPI di `/static/vendor/tldraw/`. Note view embed iframe ke app ini; postMessage menghubungkan iframe ke parent untuk sync. Service worker cache semua file tldraw untuk offline.

**Tech Stack:** tldraw v2 (npm), Vite, React 18, FastAPI (SQLite), postMessage API, Service Worker cache-first.

---

## File Structure

| File | Action | Keterangan |
|------|--------|-----------|
| `draw-app/package.json` | Create | npm config tldraw + vite |
| `draw-app/index.html` | Create | HTML entry point |
| `draw-app/src/main.jsx` | Create | React root mount |
| `draw-app/src/App.jsx` | Create | tldraw component + postMessage |
| `draw-app/vite.config.js` | Create | build ke `static/vendor/tldraw/` |
| `static/vendor/tldraw/` | Create (auto) | output build, di-gitignore |
| `repository.py` | Modify | tambah tabel `drawings` di `__init__` |
| `webapp.py` | Modify | tambah `DrawingUpsert` model + 2 endpoint |
| `static/sw.js` | Modify | update CACHE name + handler tldraw files |
| `static/index.html` | Modify | sidebar label, canvas section, fullscreen |

---

### Task 1: Setup draw-app project dan build tldraw

**Files:**
- Create: `draw-app/package.json`
- Create: `draw-app/index.html`
- Create: `draw-app/src/main.jsx`
- Create: `draw-app/src/App.jsx`
- Create: `draw-app/vite.config.js`

**Prasyarat:** Node.js dan npm harus tersedia di Windows. Cek dengan `node -v && npm -v`.

- [ ] **Step 1: Buat direktori draw-app**

```bash
mkdir draw-app
mkdir draw-app/src
```

- [ ] **Step 2: Buat draw-app/package.json**

```json
{
  "name": "draw-app",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "tldraw": "^2.4.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.0",
    "vite": "^5.2.0"
  }
}
```

- [ ] **Step 3: Buat draw-app/vite.config.js**

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/static/vendor/tldraw/',
  build: {
    outDir: '../static/vendor/tldraw',
    emptyOutDir: true,
  }
})
```

- [ ] **Step 4: Buat draw-app/index.html**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Draw</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.jsx"></script>
</body>
</html>
```

- [ ] **Step 5: Buat draw-app/src/main.jsx**

```jsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
```

- [ ] **Step 6: Buat draw-app/src/App.jsx**

```jsx
import { useEffect, useRef } from 'react'
import { Tldraw } from 'tldraw'
import 'tldraw/tldraw.css'

export default function App() {
  const noteId = new URLSearchParams(window.location.search).get('noteId') || 'default'
  const editorRef = useRef(null)

  useEffect(() => {
    // Beritahu parent bahwa iframe siap
    window.parent.postMessage({ type: 'ready' }, '*')

    const handler = (e) => {
      if (e.data?.type === 'load' && editorRef.current && e.data.data) {
        try {
          const snapshot = JSON.parse(e.data.data)
          editorRef.current.store.loadSnapshot(snapshot)
        } catch (_) {}
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  const handleMount = (editor) => {
    editorRef.current = editor

    let debounceTimer
    editor.store.listen(() => {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        const snapshot = JSON.stringify(editor.store.getSnapshot())
        window.parent.postMessage({ type: 'change', data: snapshot }, '*')
      }, 1000)
    })
  }

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw
        persistenceKey={`tldraw-note-${noteId}`}
        onMount={handleMount}
      />
    </div>
  )
}
```

- [ ] **Step 7: Install dependencies dan build**

```bash
cd draw-app
npm install
npm run build
cd ..
```

Expected: folder `static/vendor/tldraw/` terbuat berisi `index.html`, `assets/`, dll.

Verify:
```bash
ls static/vendor/tldraw/
# Expected: index.html  assets/
```

- [ ] **Step 8: Tambah draw-app ke .gitignore, exclude build output**

Buka `.gitignore`, tambahkan:
```
draw-app/node_modules/
static/vendor/tldraw/
```

Catatan: `static/vendor/tldraw/` di-exclude dari git karena di-generate saat build. Di VPS, CI/CD perlu menjalankan build step (lihat Task 8).

- [ ] **Step 9: Commit draw-app source**

```bash
git add draw-app/
git commit -m "feat: add draw-app tldraw mini app source"
```

---

### Task 2: Tambah tabel drawings di repository.py

**Files:**
- Modify: `repository.py`

Tabel `drawings` disimpan per note (`note_id UNIQUE`), cascade delete saat note dihapus.

- [ ] **Step 1: Cari lokasi init tabel terakhir di repository.py**

```bash
grep -n "CREATE TABLE IF NOT EXISTS\|conn.commit" repository.py | tail -20
```

Perhatikan baris setelah CREATE TABLE terakhir (sebelum `conn.commit()`).

- [ ] **Step 2: Tambah CREATE TABLE drawings setelah tabel note_pins**

Cari blok ini di `repository.py` (sekitar baris 300-350):
```python
            conn.execute("""
                CREATE TABLE IF NOT EXISTS note_pins (
```

Setelah blok `note_pins` + index-nya, tambahkan:
```python
            conn.execute("""
                CREATE TABLE IF NOT EXISTS drawings (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    note_id INTEGER NOT NULL UNIQUE,
                    user_id INTEGER NOT NULL,
                    data_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    FOREIGN KEY (note_id) REFERENCES scratchpad_notes(id) ON DELETE CASCADE
                )
            """)
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_drawings_note ON drawings(note_id)"
            )
```

- [ ] **Step 3: Verify tabel terbuat saat startup**

```bash
cd "Z:\Todolist Manager V5.0"
python3 -c "
from repository import TaskRepository
from config import DB_PATH
TaskRepository(DB_PATH)
import sqlite3
conn = sqlite3.connect(DB_PATH)
tables = conn.execute(\"SELECT name FROM sqlite_master WHERE type='table' AND name='drawings'\").fetchone()
print('drawings table:', tables)
"
```

Expected output: `drawings table: ('drawings',)`

- [ ] **Step 4: Commit**

```bash
git add repository.py
git commit -m "feat: add drawings table to repository"
```

---

### Task 3: Tambah API endpoints drawings di webapp.py

**Files:**
- Modify: `webapp.py`

Dua endpoint: GET (fetch drawing by note_id) dan PUT (upsert drawing). Auth menggunakan `get_current_user` yang sudah ada. Validasi ownership: user hanya bisa akses drawing milik note miliknya.

- [ ] **Step 1: Tambah DrawingUpsert Pydantic model**

Cari baris `class ScratchpadCreate(BaseModel):` di `webapp.py` (~baris 283). Sebelum class itu, tambahkan:

```python
class DrawingUpsert(BaseModel):
    data_json: str
```

- [ ] **Step 2: Tambah GET endpoint**

Cari baris `@app.get("/api/scratchpad/{note_id}")` di webapp.py. Sebelum dekorator itu, tambahkan:

```python
@app.get("/api/drawings/{note_id}")
async def get_drawing(note_id: int, user=Depends(get_current_user)):
    uid = user["sub"]
    with get_db() as conn:
        # Validasi note ownership
        note = conn.execute(
            "SELECT id FROM scratchpad_notes WHERE id = ? AND user_id = ?",
            (note_id, uid)
        ).fetchone()
        if not note:
            raise HTTPException(status_code=404, detail="Note tidak ditemukan")
        row = conn.execute(
            "SELECT data_json, updated_at FROM drawings WHERE note_id = ?",
            (note_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Drawing belum ada")
        return {"data_json": row["data_json"], "updated_at": row["updated_at"]}


@app.put("/api/drawings/{note_id}")
async def upsert_drawing(note_id: int, req: DrawingUpsert, user=Depends(get_current_user)):
    uid = user["sub"]
    now = datetime.now(_TZ_JKT).isoformat()
    with get_db() as conn:
        # Validasi note ownership
        note = conn.execute(
            "SELECT id FROM scratchpad_notes WHERE id = ? AND user_id = ?",
            (note_id, uid)
        ).fetchone()
        if not note:
            raise HTTPException(status_code=404, detail="Note tidak ditemukan")
        conn.execute(
            """INSERT INTO drawings (note_id, user_id, data_json, updated_at)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(note_id) DO UPDATE SET
                 data_json = excluded.data_json,
                 updated_at = excluded.updated_at""",
            (note_id, uid, req.data_json, now)
        )
        conn.commit()
        return {"updated_at": now}
```

- [ ] **Step 3: Verify endpoints terdaftar**

```bash
cd "Z:\Todolist Manager V5.0"
python3 -c "
import webapp
routes = [r.path for r in webapp.app.routes]
print([r for r in routes if 'drawing' in r])
"
```

Expected: `['/api/drawings/{note_id}', '/api/drawings/{note_id}']`

- [ ] **Step 4: Commit**

```bash
git add webapp.py
git commit -m "feat: add GET/PUT /api/drawings endpoints"
```

---

### Task 4: Update service worker untuk cache tldraw files

**Files:**
- Modify: `static/sw.js`

tldraw build menghasilkan banyak file di `/static/vendor/tldraw/assets/`. Tidak bisa enumerate satu per satu — gunakan cache-first handler di fetch event.

- [ ] **Step 1: Update CACHE name di sw.js**

Cari baris pertama di `static/sw.js`:
```js
const CACHE = "taskflow-v5-goal-system";
```

Ganti dengan:
```js
const CACHE = "taskflow-v6-draw";
```

- [ ] **Step 2: Tambah tldraw fetch handler**

Cari di `static/sw.js` bagian `self.addEventListener("fetch", ...)`. Di dalam handler tersebut, cari handling pertama (biasanya check `url.pathname === "/"`) dan tambahkan handler baru SEBELUMNYA:

```js
  // tldraw static files — cache-first
  if (url.pathname.startsWith('/static/vendor/tldraw/')) {
    e.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached
        return fetch(request).then(res => {
          if (res.ok) {
            caches.open(CACHE).then(c => c.put(request, res.clone()))
          }
          return res
        }).catch(() => cached || new Response('Offline', { status: 503 }))
      })
    )
    return
  }
```

- [ ] **Step 3: Verify sw.js syntax**

```bash
node --check static/sw.js
```

Expected: tidak ada output (syntax OK). Jika ada error, perbaiki syntax.

- [ ] **Step 4: Commit**

```bash
git add static/sw.js
git commit -m "feat: update SW cache version and add tldraw cache-first handler"
```

---

### Task 5: Update sidebar label "Notes" → "Notes & Draw"

**Files:**
- Modify: `static/index.html`

- [ ] **Step 1: Cari dan ganti label Notes di Sidebar**

```bash
cd "Z:\Todolist Manager V5.0"
python3 << 'EOF'
with open('static/index.html', encoding='utf-8') as f:
    html = f.read()

# Find the notes sidebar link
import re
idx = html.find('{ id: "notes"')
print(f'Found at: {idx}')
print(repr(html[idx:idx+80]))
EOF
```

- [ ] **Step 2: Ganti label**

```bash
python3 << 'EOF'
with open('static/index.html', encoding='utf-8') as f:
    html = f.read()

old = '{ id: "notes", icon: "📝", label: "Notes" }'
new = '{ id: "notes", icon: "📝", label: "Notes & Draw" }'

if old in html:
    html = html.replace(old, new, 1)
    print('Label updated: OK')
else:
    # Try to find what's actually there
    idx = html.find('id: "notes"')
    print(f'NOT FOUND as expected. Actual content: {repr(html[idx:idx+80])}')

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
EOF
```

Jika `NOT FOUND`, sesuaikan `old` dengan string yang ditemukan dari output `Actual content`.

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "feat: rename sidebar Notes to Notes & Draw"
```

---

### Task 6: Tambah canvas section di Note detail view

**Files:**
- Modify: `static/index.html`

Canvas section ditambahkan di bawah editor konten note. Satu iframe, fullscreen toggle via CSS.

- [ ] **Step 1: Temukan komponen Note detail / editor**

```bash
python3 << 'EOF'
with open('static/index.html', encoding='utf-8') as f:
    html = f.read()

# Find the note editor/detail component
candidates = [
  'NoteDetail',
  'NoteEditor',
  'NoteView',
  'selectedNote',
  'scratchpad/{note_id}',
]
for c in candidates:
    idx = html.find(c)
    if idx != -1:
        print(f'Found "{c}" at {idx}:')
        print(repr(html[idx:idx+100]))
        print()
EOF
```

- [ ] **Step 2: Identifikasi lokasi penambahan canvas**

Cari area di Note detail view dimana konten note di-render (biasanya ada `note.content` atau textarea/div editor). Temukan baris penutup editor, yaitu tempat canvas akan disisipkan setelahnya.

```bash
python3 << 'EOF'
with open('static/index.html', encoding='utf-8') as f:
    html = f.read()

# Search for note content rendering patterns
patterns = ['note.content', 'noteContent', 'selectedNote.content', 'editContent']
for p in patterns:
    idx = html.find(p)
    if idx != -1:
        print(f'Pattern "{p}" at {idx}:')
        print(repr(html[max(0,idx-50):idx+200]))
        print('---')
EOF
```

- [ ] **Step 3: Tambah state drawFullscreen dan iframeRef ke Note detail component**

Temukan function/component yang menampilkan detail note. Tambahkan state dan ref di awal component tersebut:

```jsx
const iframeRef = React.useRef(null);
const [drawFullscreen, setDrawFullscreen] = React.useState(false);
const [syncStatus, setSyncStatus] = React.useState('saved'); // 'saved' | 'saving' | 'offline'
const [iframeReady, setIframeReady] = React.useState(false);
const [pendingDrawData, setPendingDrawData] = React.useState(null);
```

- [ ] **Step 4: Tambah postMessage listener di useEffect**

Di dalam component yang sama, tambahkan useEffect (setelah state declarations):

```jsx
React.useEffect(() => {
  if (!selectedNote) return;

  // Fetch drawing from backend on note change
  setIframeReady(false);
  setPendingDrawData(null);
  setSyncStatus('saved');

  api.get(`/api/drawings/${selectedNote.id}`)
    .then(data => setPendingDrawData(data.data_json))
    .catch(() => {}); // 404 = no drawing yet, OK

  // postMessage handler
  const handler = (e) => {
    if (e.data?.type === 'ready') {
      setIframeReady(true);
    }
    if (e.data?.type === 'change' && e.data.data) {
      if (!navigator.onLine) {
        setSyncStatus('offline');
        return;
      }
      setSyncStatus('saving');
      api.put(`/api/drawings/${selectedNote.id}`, { data_json: e.data.data })
        .then(() => setSyncStatus('saved'))
        .catch(() => setSyncStatus('offline'));
    }
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}, [selectedNote?.id]);
```

- [ ] **Step 5: Tambah useEffect untuk kirim data ke iframe setelah ready**

```jsx
React.useEffect(() => {
  if (iframeReady && pendingDrawData && iframeRef.current) {
    iframeRef.current.contentWindow.postMessage(
      { type: 'load', data: pendingDrawData },
      '*'
    );
  }
}, [iframeReady, pendingDrawData]);
```

- [ ] **Step 6: Tambah canvas section di JSX return**

Di dalam JSX return dari Note detail component, setelah editor konten note, tambahkan:

```jsx
{selectedNote && (
  <div style={drawFullscreen ? {
    position: 'fixed', inset: 0, zIndex: 9999,
    background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column'
  } : { marginTop: 24 }}>
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: drawFullscreen ? '10px 16px' : '0 0 8px 0',
      borderBottom: drawFullscreen ? '1px solid var(--border)' : 'none',
    }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Canvas</span>
      <button
        type="button"
        onClick={() => setDrawFullscreen(f => !f)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}
      >
        {drawFullscreen ? '✕ Tutup' : '⤢ Expand'}
      </button>
    </div>
    <div style={{
      flex: drawFullscreen ? 1 : undefined,
      height: drawFullscreen ? undefined : 360,
      border: '1px solid var(--border)',
      borderRadius: drawFullscreen ? 0 : 8,
      overflow: 'hidden',
    }}>
      <iframe
        ref={iframeRef}
        src={`/static/vendor/tldraw/index.html?noteId=${selectedNote.id}`}
        style={{ width: '100%', height: '100%', border: 'none' }}
        title="Drawing canvas"
      />
    </div>
    {!drawFullscreen && (
      <div style={{
        fontSize: 11, marginTop: 4,
        color: syncStatus === 'saved' ? '#27ae60' : syncStatus === 'offline' ? '#f39c12' : 'var(--text-light)'
      }}>
        {syncStatus === 'saved' ? 'Tersimpan' : syncStatus === 'saving' ? 'Menyimpan...' : 'Offline — tersimpan lokal'}
      </div>
    )}
  </div>
)}
```

- [ ] **Step 7: Verify di browser**

1. Buka app → Notes & Draw
2. Pilih note yang sudah ada
3. Di bawah editor teks harus muncul section "Canvas" dengan iframe tldraw (height 360px)
4. Coba gambar sesuatu → setelah 1-2 detik status harus "Menyimpan..." → "Tersimpan"
5. Klik "⤢ Expand" → canvas full screen
6. Klik "✕ Tutup" → kembali normal

- [ ] **Step 8: Commit**

```bash
git add static/index.html
git commit -m "feat: add drawing canvas section to note detail view with fullscreen and sync"
```

---

### Task 7: Reset drawFullscreen saat pindah note

**Files:**
- Modify: `static/index.html`

Saat user klik note lain saat fullscreen aktif, overlay harus tertutup otomatis.

- [ ] **Step 1: Tambah reset ke useEffect yang watch selectedNote**

Di useEffect dari Task 6 Step 4 (yang watch `selectedNote?.id`), tambahkan di baris pertama:

```jsx
setDrawFullscreen(false);
```

Sehingga menjadi:
```jsx
React.useEffect(() => {
  if (!selectedNote) return;
  setDrawFullscreen(false);   // ← tambah ini
  setIframeReady(false);
  // ... rest of effect
}, [selectedNote?.id]);
```

- [ ] **Step 2: Verify**

Buka note → expand fullscreen → klik note lain di list → fullscreen harus menutup otomatis.

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "fix: reset draw fullscreen when switching notes"
```

---

### Task 8: Update CI/CD untuk build draw-app di VPS

**Files:**
- Modify: `.github/workflows/deploy.yml`

Build `draw-app` harus dijalankan di VPS saat deploy agar `static/vendor/tldraw/` tersedia.

- [ ] **Step 1: Cek struktur deploy.yml**

```bash
cat .github/workflows/deploy.yml
```

Perhatikan step yang menjalankan `git pull` di VPS dan restart service.

- [ ] **Step 2: Tambah build step di deploy workflow**

Cari step di deploy.yml yang berisi `git pull` (di VPS). Setelah `git pull`, tambahkan:

```yaml
      - name: Build draw-app
        run: |
          ssh ${{ secrets.VPS_USER }}@${{ secrets.VPS_HOST }} "
            cd /path/to/taskflow && \
            cd draw-app && \
            npm install && \
            npm run build && \
            cd ..
          "
```

Ganti `/path/to/taskflow` dengan path aktual di VPS (cek dari `reference_vps.md` di memory atau README).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: add draw-app build step to deploy workflow"
```

---

### Task 9: Online-sync handler dan final smoke test

**Files:**
- Modify: `static/index.html`

Saat browser kembali online, drawing yang belum tersync harus dikirim ke backend.

- [ ] **Step 1: Tambah online event handler**

Di useEffect dari Task 6 Step 4, tambahkan listener online:

```jsx
const onlineHandler = () => {
  // Jika ada perubahan pending (syncStatus === 'offline'), kirim snapshot terbaru
  if (iframeRef.current) {
    iframeRef.current.contentWindow.postMessage({ type: 'requestSnapshot' }, '*')
  }
};
window.addEventListener('online', onlineHandler);
```

Dan di return cleanup:
```jsx
return () => {
  window.removeEventListener('message', handler);
  window.removeEventListener('online', onlineHandler);
};
```

Di App.jsx draw-app, tambahkan handler untuk `requestSnapshot`:
```jsx
// Di dalam useEffect handler di App.jsx
if (e.data?.type === 'requestSnapshot' && editorRef.current) {
  const snapshot = JSON.stringify(editorRef.current.store.getSnapshot())
  window.parent.postMessage({ type: 'change', data: snapshot }, '*')
}
```

Setelah update App.jsx, rebuild:
```bash
cd draw-app && npm run build && cd ..
```

- [ ] **Step 2: Full smoke test**

Test scenario:
1. Online: buka note → gambar sesuatu → status "Tersimpan" ✓
2. Online: refresh → drawing masih ada (loaded dari backend) ✓
3. Offline (matikan jaringan di DevTools): gambar sesuatu → status "Offline — tersimpan lokal" ✓
4. Online kembali: status harus berubah "Menyimpan..." → "Tersimpan" ✓
5. Expand fullscreen → gambar → tutup → gambar masih ada ✓
6. Pindah note → kembali ke note sebelumnya → drawing masih ada ✓
7. Hapus note → verify tabel drawings tidak punya orphan row ✓

- [ ] **Step 3: Push**

```bash
git push
```

CI/CD akan deploy ke VPS dan menjalankan build draw-app.
