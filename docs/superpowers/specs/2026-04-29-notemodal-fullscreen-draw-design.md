# NoteModal — Textarea Fullscreen & Draw Canvas Design

**Date:** 2026-04-29
**Status:** Approved

## Overview

Dua penambahan di `NoteModal` (`static/index.html`):
1. Tombol expand textarea ke fullscreen overlay (hanya title + textarea, tanpa accessories)
2. Draw canvas (tldraw iframe) di bawah textarea, identik dengan NotePanel canvas

Semua perubahan hanya di `static/index.html`, tidak ada perubahan backend.

## Bagian 1 — Textarea Fullscreen Overlay

### State baru
```js
const [textareaFullscreen, setTextareaFullscreen] = React.useState(false)
```

### Tombol expand
Ditambahkan di pojok kanan atas area textarea, icon `⤢`. Saat diklik → `setTextareaFullscreen(true)`.

### Overlay JSX
Saat `textareaFullscreen === true`, render overlay sebagai **sibling di luar** `note-modal-overlay` menggunakan Fragment wrapper di return NoteModal:

```jsx
return (
  <>
    {textareaFullscreen && ( /* overlay di sini */ )}
    <div className="note-modal-overlay" onClick={onClose}>
      ...
    </div>
  </>
);
```

Ini memastikan overlay tidak ter-trigger `onClick={onClose}` dari `note-modal-overlay`. JSX overlay:

```jsx
{textareaFullscreen && (
  <div style={{
    position: 'fixed', inset: 0, zIndex: 10000,
    background: 'var(--bg-primary)',
    display: 'flex', flexDirection: 'column', padding: 16
  }}>
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
      <button onClick={() => setTextareaFullscreen(false)}
        style={{ background: 'none', border: 'none', cursor: 'pointer',
                 fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>
        ✕ Tutup
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
```

State `title` dan `content` shared dengan modal di bawah — edit di overlay langsung sinkron. Autosave tetap berjalan di background. Accessories (tags, linked tasks, dll) **tidak tampil** di overlay.

## Bagian 2 — Draw Canvas di NoteModal

### noteId strategy
```js
const [canvasNoteId] = React.useState(() =>
  note?.id ? String(note.id) : crypto.randomUUID()
)
```

Diinisialisasi sekali saat modal dibuka:
- Note sudah ada ID → gunakan ID asli
- Note baru → generate UUID unik per session

### Canvas section
Ditambahkan di dalam `{inner}` (scroll area NoteModal), **setelah** textarea/wikilink block, **sebelum** tags/linked tasks section.

State yang dibutuhkan (tambahkan di NoteModal):
```js
const drawIframeRef = React.useRef(null)
const [drawFullscreen, setDrawFullscreen] = React.useState(false)
const [drawSyncStatus, setDrawSyncStatus] = React.useState('saved')
const [drawIframeReady, setDrawIframeReady] = React.useState(false)
const [drawPendingData, setDrawPendingData] = React.useState(null)
```

### useEffect — fetch + postMessage (watches `note?.id`)
```js
React.useEffect(() => {
  setDrawIframeReady(false)
  setDrawPendingData(null)
  setDrawSyncStatus('saved')

  if (note?.id) {
    api.get(`/api/drawings/${note.id}`)
      .then(data => setDrawPendingData(data.data_json))
      .catch(() => {})
  }

  const handler = (e) => {
    if (e.origin !== window.location.origin) return
    if (e.data?.type === 'ready') setDrawIframeReady(true)
    if (e.data?.type === 'change' && e.data.data && note?.id) {
      if (!navigator.onLine) { setDrawSyncStatus('offline'); return }
      setDrawSyncStatus('saving')
      api.put(`/api/drawings/${note.id}`, { data_json: e.data.data })
        .then(() => setDrawSyncStatus('saved'))
        .catch(() => setDrawSyncStatus('offline'))
    }
  }
  window.addEventListener('message', handler)

  const onlineHandler = () => {
    if (drawIframeRef.current && note?.id)
      drawIframeRef.current.contentWindow.postMessage({ type: 'requestSnapshot' }, '*')
  }
  window.addEventListener('online', onlineHandler)
  return () => {
    window.removeEventListener('message', handler)
    window.removeEventListener('online', onlineHandler)
  }
}, [note?.id])
```

**Perbedaan dari NotePanel:**
- Backend sync (`api.get/put`) hanya aktif jika `note?.id` ada
- Untuk note baru: handler `'change'` tidak PUT ke backend (guard `&& note?.id`)
- Saat note baru di-save dan component di-re-render dengan `note.id` baru, useEffect re-run dan fetch drawing dimulai

### useEffect — load snapshot ke iframe
```js
React.useEffect(() => {
  if (drawIframeReady && drawPendingData && drawIframeRef.current) {
    drawIframeRef.current.contentWindow.postMessage(
      { type: 'load', data: drawPendingData }, '*'
    )
  }
}, [drawIframeReady, drawPendingData])
```

### Canvas JSX
```jsx
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
           : 'Offline — tersimpan lokal')
        : 'Simpan note untuk sync drawing ke server'}
    </div>
  )}
</div>
```

**Sync status khusus note baru:** tampilkan teks "Simpan note untuk sync drawing ke server" agar user tahu drawing belum di-sync.

## z-index Hierarchy

| Layer | z-index |
|---|---|
| NoteModal overlay | 1000 (existing) |
| Textarea fullscreen | 10000 |
| Draw canvas fullscreen | 10000 |

Textarea fullscreen dan draw canvas fullscreen tidak bisa aktif bersamaan (tidak perlu guard — user tidak mungkin klik keduanya sekaligus).

## Scope

- Hanya `static/index.html` — komponen `NoteModal`
- Tidak ada perubahan backend, API, SW, atau file lain
