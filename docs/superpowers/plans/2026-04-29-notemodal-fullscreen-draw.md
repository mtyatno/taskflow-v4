# NoteModal Fullscreen Textarea & Draw Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambah textarea fullscreen overlay dan draw canvas (tldraw iframe) ke NoteModal di `static/index.html`.

**Architecture:** Semua perubahan di `NoteModal` component (`static/index.html`, chars 521871–554461). Textarea fullscreen: Fragment wrapper di return + overlay JSX. Draw canvas: identik dengan NotePanel canvas, noteId pakai `crypto.randomUUID()` untuk note baru. Tidak ada perubahan backend.

**Tech Stack:** React (Babel in-browser), tldraw iframe via postMessage (sudah tersedia di `/static/vendor/tldraw/`), vanilla CSS-in-JS.

---

## Files

| File | Action |
|------|--------|
| `static/index.html` | Modify — semua perubahan di dalam `function NoteModal(...)` |

---

### Task 1: Tambah state declarations untuk kedua fitur

**Files:**
- Modify: `static/index.html` — state block di awal `NoteModal`

- [ ] **Step 1: Cari akhir state declarations di NoteModal**

```bash
python3 << 'EOF'
with open('static/index.html', encoding='utf-8') as f:
    html = f.read()
idx = html.find('function NoteModal(')
modal = html[idx:idx+3000]
# Find last useState in the block
last = modal.rfind("useState([]);")
print(f'Last useState at offset {last}:')
print(repr(modal[last:last+80]))
EOF
```

Expected: menunjukkan baris `const [existingTags, setExistingTags] = useState([]);`

- [ ] **Step 2: Insert state declarations setelah existingTags**

```bash
python3 << 'EOF'
with open('static/index.html', encoding='utf-8') as f:
    html = f.read()

old = '      const [existingTags, setExistingTags] = useState([]);'
new = """      const [existingTags, setExistingTags] = useState([]);

      // Textarea fullscreen
      const [textareaFullscreen, setTextareaFullscreen] = React.useState(false);

      // Draw canvas
      const [canvasNoteId] = React.useState(() =>
        note?.id ? String(note.id) : crypto.randomUUID()
      );
      const drawIframeRef = React.useRef(null);
      const [drawFullscreen, setDrawFullscreen] = React.useState(false);
      const [drawSyncStatus, setDrawSyncStatus] = React.useState('saved');
      const [drawIframeReady, setDrawIframeReady] = React.useState(false);
      const [drawPendingData, setDrawPendingData] = React.useState(null);"""

assert old in html, 'Pattern not found'
html = html.replace(old, new, 1)

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
print('OK')
EOF
```

- [ ] **Step 3: Verify**

```bash
python3 -c "
with open('static/index.html', encoding='utf-8') as f:
    h = f.read()
print('textareaFullscreen:', 'textareaFullscreen' in h)
print('canvasNoteId:', 'canvasNoteId' in h)
print('drawIframeRef:', 'drawIframeRef' in h)
print('crypto.randomUUID', 'crypto.randomUUID' in h)
"
```

Expected: semua `True`.

- [ ] **Step 4: Commit**

```bash
git add static/index.html
git commit -m "feat: add state declarations for NoteModal textarea fullscreen and draw canvas"
```

---

### Task 2: Tambah draw canvas useEffects ke NoteModal

**Files:**
- Modify: `static/index.html` — setelah `shareRef` useEffect di NoteModal

- [ ] **Step 1: Cari akhir shareRef useEffect di NoteModal**

```bash
python3 << 'EOF'
with open('static/index.html', encoding='utf-8') as f:
    html = f.read()

nm_start = html.find('function NoteModal(')
nm_end = html.find('\n    function ', nm_start + 1)
modal = html[nm_start:nm_end]

# Find the shareRef useEffect closing
share_close = modal.find("      }, [shareOpen]);")
print(f'shareRef useEffect closes at modal offset: {share_close}')
print(repr(modal[share_close:share_close+30]))
EOF
```

- [ ] **Step 2: Insert draw canvas useEffects setelah shareRef useEffect**

```bash
python3 << 'EOF'
with open('static/index.html', encoding='utf-8') as f:
    html = f.read()

old = '      }, [shareOpen]);\n      const [noteListId'
new = """      }, [shareOpen]);

      // Draw canvas — fetch + postMessage sync
      React.useEffect(() => {
        setDrawIframeReady(false);
        setDrawPendingData(null);
        setDrawSyncStatus('saved');

        if (note?.id) {
          api.get(`/api/drawings/${note.id}`)
            .then(data => setDrawPendingData(data.data_json))
            .catch(() => {});
        }

        const handler = (e) => {
          if (e.origin !== window.location.origin) return;
          if (e.data?.type === 'ready') setDrawIframeReady(true);
          if (e.data?.type === 'change' && e.data.data && note?.id) {
            if (!navigator.onLine) { setDrawSyncStatus('offline'); return; }
            setDrawSyncStatus('saving');
            api.put(`/api/drawings/${note.id}`, { data_json: e.data.data })
              .then(() => setDrawSyncStatus('saved'))
              .catch(() => setDrawSyncStatus('offline'));
          }
        };
        window.addEventListener('message', handler);

        const onlineHandler = () => {
          if (drawIframeRef.current && note?.id)
            drawIframeRef.current.contentWindow.postMessage({ type: 'requestSnapshot' }, '*');
        };
        window.addEventListener('online', onlineHandler);

        return () => {
          window.removeEventListener('message', handler);
          window.removeEventListener('online', onlineHandler);
        };
      }, [note?.id]);

      // Draw canvas — load snapshot to iframe
      React.useEffect(() => {
        if (drawIframeReady && drawPendingData && drawIframeRef.current) {
          drawIframeRef.current.contentWindow.postMessage(
            { type: 'load', data: drawPendingData }, '*'
          );
        }
      }, [drawIframeReady, drawPendingData]);

      const [noteListId"""

assert old in html, f'Pattern not found. Searching: {html.count("[shareOpen]);")} occurrences of [shareOpen]);'
html = html.replace(old, new, 1)

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
print('OK')
EOF
```

- [ ] **Step 3: Verify**

```bash
python3 -c "
with open('static/index.html', encoding='utf-8') as f:
    h = f.read()
nm = h[h.find('function NoteModal('):h.find('\n    function ', h.find('function NoteModal(')+1)]
print('draw useEffect note?.id:', 'note?.id]);' in nm)
print('draw useEffect iframeReady:', 'drawIframeReady, drawPendingData' in nm)
print('origin guard:', \"e.origin !== window.location.origin\" in nm)
"
```

Expected: semua `True`.

- [ ] **Step 4: Commit**

```bash
git add static/index.html
git commit -m "feat: add draw canvas useEffects to NoteModal"
```

---

### Task 3: Tambah tombol expand di textarea dan canvas JSX ke inner

**Files:**
- Modify: `static/index.html` — `const inner` JSX di NoteModal

- [ ] **Step 1: Cari textarea dan lokasi setelah wikilink/tag dropdowns**

```bash
python3 << 'EOF'
with open('static/index.html', encoding='utf-8') as f:
    html = f.read()

nm_start = html.find('function NoteModal(')
nm_end = html.find('\n    function ', nm_start + 1)
modal = html[nm_start:nm_end]

# Find textarea close
ta_end = modal.find('/>\n            )}\n            {/* Wikilink')
print(f'Textarea end at modal offset: {ta_end}')
print(repr(modal[ta_end:ta_end+60]))

# Find action buttons section
actions = modal.find('{/* Actions — hidden in focus mode */')
print(f'Actions section at: {actions}')
print(repr(modal[actions:actions+50]))
EOF
```

- [ ] **Step 2: Tambah expand button tepat sebelum textarea**

Find the textarea opening. The current pattern before textarea is:
```
) : (
  <textarea
    ref={textareaRef}
```

Add a wrapper div with expand button + textarea:

```bash
python3 << 'EOF'
with open('static/index.html', encoding='utf-8') as f:
    html = f.read()

old = '            ) : (\n              <textarea\n                ref={textareaRef}'
new = """            ) : (
              <div style={{ position: 'relative' }}>
                <button
                  type="button"
                  title="Fullscreen"
                  onClick={() => setTextareaFullscreen(true)}
                  style={{
                    position: 'absolute', top: 6, right: 6, zIndex: 10,
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: 13, color: 'var(--text-light)', lineHeight: 1,
                    padding: '2px 4px', borderRadius: 4,
                  }}
                >⤢</button>
                <textarea
                  ref={textareaRef}"""

assert old in html, 'Textarea pattern not found'
html = html.replace(old, new, 1)

# Also close the wrapper div after textarea closing />
# Current: />
#           )}
#           {/* Wikilink
# Need:    />
#               </div>
#           )}
old2 = '/>\n            )}\n            {/* Wikilink autocomplete dropdown */'
new2 = '/>\n              </div>\n            )}\n            {/* Wikilink autocomplete dropdown */'

assert old2 in html, 'Textarea close pattern not found'
html = html.replace(old2, new2, 1)

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
print('OK')
EOF
```

- [ ] **Step 3: Tambah draw canvas JSX sebelum action buttons section**

```bash
python3 << 'EOF'
with open('static/index.html', encoding='utf-8') as f:
    html = f.read()

old = """          {/* Actions — hidden in focus mode */}
          {!focus && ("""

new = """          {/* Draw canvas */}
          <div style={drawFullscreen ? {
            position: 'fixed', inset: 0, zIndex: 10000,
            background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column'
          } : { marginTop: 16 }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: drawFullscreen ? '10px 16px' : '0 0 8px 0',
              borderBottom: drawFullscreen ? '1px solid var(--border)' : 'none',
            }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>Canvas</span>
              <button type="button"
                onClick={() => setDrawFullscreen(f => !f)}
                style={{ background: 'none', border: 'none', cursor: 'pointer',
                         fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>
                {drawFullscreen ? '\\u2715 Tutup' : '\\u2922 Expand'}
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
                ref={drawIframeRef}
                src={`/static/vendor/tldraw/index.html?noteId=${canvasNoteId}`}
                style={{ width: '100%', height: '100%', border: 'none' }}
                title="Drawing canvas"
              />
            </div>
            {!drawFullscreen && (
              <div style={{
                fontSize: 11, marginTop: 4,
                color: drawSyncStatus === 'saved' ? '#27ae60'
                     : drawSyncStatus === 'offline' ? '#f39c12'
                     : 'var(--text-light)'
              }}>
                {note?.id
                  ? (drawSyncStatus === 'saved' ? 'Tersimpan'
                     : drawSyncStatus === 'saving' ? 'Menyimpan...'
                     : 'Offline \\u2014 tersimpan lokal')
                  : 'Simpan note untuk sync drawing ke server'}
              </div>
            )}
          </div>

          {/* Actions — hidden in focus mode */}
          {!focus && ("""

assert old in html, 'Actions pattern not found'
html = html.replace(old, new, 1)

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
print('OK')
EOF
```

- [ ] **Step 4: Verify canvas JSX inserted**

```bash
python3 -c "
with open('static/index.html', encoding='utf-8') as f:
    h = f.read()
nm = h[h.find('function NoteModal('):h.find('\n    function ', h.find('function NoteModal(')+1)]
print('draw canvas div:', 'Drawing canvas' in nm)
print('canvasNoteId in src:', 'canvasNoteId' in nm)
print('drawFullscreen style:', \"position: 'fixed'\" in nm)
print('expand button:', 'Expand' in nm)
print('sync status:', 'Simpan note untuk sync' in nm)
print('textarea expand button:', 'setTextareaFullscreen(true)' in nm)
"
```

Expected: semua `True`.

- [ ] **Step 5: Commit**

```bash
git add static/index.html
git commit -m "feat: add textarea expand button and draw canvas JSX to NoteModal"
```

---

### Task 4: Wrap NoteModal return dalam Fragment + textarea fullscreen overlay

**Files:**
- Modify: `static/index.html` — final `return (...)` di NoteModal

- [ ] **Step 1: Cari dan tampilkan return statement NoteModal**

```bash
python3 << 'EOF'
with open('static/index.html', encoding='utf-8') as f:
    html = f.read()

nm_start = html.find('function NoteModal(')
nm_end = html.find('\n    function ', nm_start + 1)
modal = html[nm_start:nm_end]

final_ret = modal.rfind('return (')
print(f'Final return at modal offset: {final_ret}')
print(repr(modal[final_ret:final_ret+150]))
print('...')
print(repr(modal[-60:]))
EOF
```

- [ ] **Step 2: Ganti return statement dengan Fragment + overlay**

```bash
python3 << 'EOF'
with open('static/index.html', encoding='utf-8') as f:
    html = f.read()

old_return = """        return (
        <div className="note-modal-overlay" onClick={onClose}>
          <div className="note-modal-box" style={{ display: "flex", flexDirection: "column", maxHeight: "90vh" }} onClick={e => e.stopPropagation()}>
            {header}
            <div className="note-modal-scroll-area">
              {inner}
            </div>
          </div>
        </div>
      );
    }"""

new_return = """        return (
        <>
          {textareaFullscreen && (
            <div style={{
              position: 'fixed', inset: 0, zIndex: 10000,
              background: 'var(--bg-primary)',
              display: 'flex', flexDirection: 'column', padding: 16
            }}>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                <button
                  onClick={() => setTextareaFullscreen(false)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer',
                           fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>
                  \\u2715 Tutup
                </button>
              </div>
              <input
                className="note-modal-title-input"
                placeholder="Judul catatan..."
                value={title}
                onChange={e => setTitle(e.target.value)}
                style={{ marginBottom: 8 }}
              />
              <textarea
                className="note-modal-content-input"
                placeholder="Tulis isi catatan..."
                value={content}
                onChange={e => handleContentChange(e.target.value)}
                style={{ flex: 1, resize: 'none', fontSize: 16 }}
              />
            </div>
          )}
          <div className="note-modal-overlay" onClick={onClose}>
            <div className="note-modal-box" style={{ display: "flex", flexDirection: "column", maxHeight: "90vh" }} onClick={e => e.stopPropagation()}>
              {header}
              <div className="note-modal-scroll-area">
                {inner}
              </div>
            </div>
          </div>
        </>
      );
    }"""

# Find exact match - the return is at the very end of NoteModal
nm_start = html.find('function NoteModal(')
nm_end = html.find('\n    function ', nm_start + 1)

if old_return in html[nm_start:nm_end]:
    html = html.replace(old_return, new_return, 1)
    print('Return replaced: OK')
else:
    # Show actual return for debugging
    modal = html[nm_start:nm_end]
    final_ret = modal.rfind('return (')
    print('ACTUAL return:')
    print(repr(modal[final_ret:]))
    
with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(html)
EOF
```

- [ ] **Step 3: Verify overlay structure**

```bash
python3 -c "
with open('static/index.html', encoding='utf-8') as f:
    h = f.read()
nm = h[h.find('function NoteModal('):h.find('\n    function ', h.find('function NoteModal(')+1)]
ret = nm[nm.rfind('return ('):]
print('Fragment <>:', '<>' in ret)
print('textareaFullscreen overlay:', 'textareaFullscreen &&' in ret)
print('note-modal-overlay kept:', 'note-modal-overlay' in ret)
print('overlay zIndex 10000:', 'zIndex: 10000' in ret)
print('Fragment close:', '</>' in ret)
"
```

Expected: semua `True`.

- [ ] **Step 4: Verify di browser**

Buka app → Notes & Draw → klik "+ Tambah Baru":
1. Modal muncul normal ✓
2. Ada tombol `⤢` kecil di pojok kanan atas textarea ✓
3. Klik `⤢` → textarea fullscreen overlay muncul (full layar, hanya title + textarea) ✓
4. Klik `✕ Tutup` → kembali ke modal ✓
5. Canvas section muncul di bawah textarea dalam modal ✓
6. Canvas menampilkan tldraw iframe (noteId = UUID karena note baru) ✓
7. Sync status: "Simpan note untuk sync drawing ke server" ✓
8. Klik `⤢ Expand` di canvas → canvas fullscreen ✓

- [ ] **Step 5: Commit**

```bash
git add static/index.html
git commit -m "feat: add textarea fullscreen overlay to NoteModal with Fragment wrapper"
```

---

### Task 5: Push dan verifikasi

- [ ] **Step 1: Final check — tidak ada syntax error**

```bash
python3 << 'EOF'
with open('static/index.html', encoding='utf-8') as f:
    html = f.read()

nm_start = html.find('function NoteModal(')
nm_end = html.find('\n    function ', nm_start + 1)
modal = html[nm_start:nm_end]

checks = {
    'textareaFullscreen state': "const [textareaFullscreen" in modal,
    'canvasNoteId state': "const [canvasNoteId]" in modal,
    'drawIframeRef': "const drawIframeRef = React.useRef" in modal,
    'draw useEffect note?.id': "}, [note?.id]);" in modal,
    'draw useEffect iframeReady': "drawIframeReady, drawPendingData" in modal,
    'textarea expand button': "setTextareaFullscreen(true)" in modal,
    'draw canvas JSX': "Drawing canvas" in modal,
    'canvasNoteId in iframe src': "canvasNoteId" in modal,
    'Fragment in return': "<>" in modal[modal.rfind('return ('):],
    'textareaFullscreen overlay': "textareaFullscreen &&" in modal,
    'overlay zIndex 10000': "zIndex: 10000" in modal,
}
all_ok = True
for name, result in checks.items():
    status = 'OK' if result else 'FAIL'
    if not result:
        all_ok = False
    print(f'{status}: {name}')
print(f'\nAll checks: {"PASS" if all_ok else "FAIL"}')
EOF
```

Expected: All checks PASS.

- [ ] **Step 2: Push**

```bash
git push
```
