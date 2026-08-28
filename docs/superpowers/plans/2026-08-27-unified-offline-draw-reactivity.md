# Unified Offline Drawing Reactivity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menyatukan siklus hidup dan reaktivitas drawing antara Catatan Inline (`::draw[...]` / `QuickDrawModal`) dan Halaman Draw (`DrawPage` / `DrawingTabInstance`) sehingga 100% offline-first dan seketika saling terhubung di sesi lokal yang sama tanpa membutuhkan proses server sync.

**Architecture:** 
1. Membuka event filtering `drawingSaved` di `DrawingTabInstance` dan `QuickDrawModal` (menghapus restriksi `e.detail?.source === 'sync'`) dengan mempertahankan deduplikasi anti-echo `lastLoadedJsonRef` sehingga pembaruan lokal seketika merambat ke semua kanvas terbuka.
2. Mengganti bypass jaringan `__syncRawFetch` di `selectDrawing` (`DrawPage`) dengan `api.get` agar selalu membaca dari IndexedDB lokal `drawings` + `BlobStore`.
3. Menyelaraskan inisialisasi `draw-app` iframe agar sepenuhnya mengandalkan authoritative snapshot dari parent window (`api.get`) melalui handshake `{ type: 'ready' }` / `{ type: 'load' }`.
4. Menambahkan test suite regresi offline untuk memvalidasi reaktivitas lokal instan antar-komponen drawing.

**Tech Stack:** React, IndexedDB, Tldraw (draw-app Vite bundle), Service Worker (`static/sw.js`), Node.js test runner (`node --test`).

## Global Constraints
- 100% offline capability: Seluruh operasi gambar (create, open, edit, render preview, gallery insert) WAJIB bekerja sempurna tanpa koneksi internet.
- Anti-echo loop: Perubahan snapshot yang di-load tidak boleh memicu event save balik ke parent window.
- Preserve Service Worker caching & CRLF line endings on static assets.
- Bump Service Worker cache version pada `static/sw.js`.

---

### Task 1: Unify Local Event Reactivity in `DrawingTabInstance`, `QuickDrawModal`, and `DrawPage`

**Files:**
- Modify: `static/index.html:9210-9235` (DrawingTabInstance), `static/index.html:9375-9390` (selectDrawing), `static/index.html:17340-17365` (QuickDrawModal)
- Test: `tests/offline/draw_local_reactive.test.js`

**Interfaces:**
- Consumes: `api.get('/api/drawings/:id')` from `static/offline/drawingroutes.js`
- Produces: Seamless real-time event distribution via `window.dispatchEvent(new CustomEvent('drawingSaved', { detail: { id } }))`

- [ ] **Step 1: Write failing unit tests for drawing local reactivity and offline load**

Create `tests/offline/draw_local_reactive.test.js` containing assertions:
1. `DrawingTabInstance` listens to all `drawingSaved` events (not just sync/remote), compares `data_json` against `lastLoadedJsonRef`, and sends `postMessage({ type: 'load' })` to iframe.
2. `QuickDrawModal` listens to all `drawingSaved` events with `lastLoadedJsonRef` deduplication.
3. `selectDrawing` in `DrawPage` uses `api.get` (offline router) and does not contain `__syncRawFetch`.

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

describe('Unified Offline Drawing Reactivity', () => {
  const indexHtml = fs.readFileSync(path.join(__dirname, '../../static/index.html'), 'utf8');

  it('DrawingTabInstance handles local drawingSaved events without requiring sync source guard', () => {
    assert.doesNotMatch(
      indexHtml,
      /function DrawingTabInstance[\s\S]*?if\s*\(\s*e\.detail\?\.source\s*===\s*['"]sync['"]\s*\|\|\s*e\.detail\?\.remote\s*\)/,
      'DrawingTabInstance should not ignore local drawingSaved events'
    );
  });

  it('QuickDrawModal handles local drawingSaved events without requiring sync source guard', () => {
    assert.doesNotMatch(
      indexHtml,
      /function QuickDrawModal[\s\S]*?if\s*\(\s*e\.detail\?\.source\s*===\s*['"]sync['"]\s*\|\|\s*e\.detail\?\.remote\s*\)/,
      'QuickDrawModal should not ignore local drawingSaved events'
    );
  });

  it('DrawPage selectDrawing uses api.get instead of __syncRawFetch bypass', () => {
    assert.doesNotMatch(
      indexHtml,
      /const selectDrawing = async d =>[\s\S]*?__syncRawFetch\(`\/api\/drawings\/\${d\.id}`\)/,
      'selectDrawing must use offline router api.get'
    );
    assert.match(
      indexHtml,
      /const selectDrawing = async d =>[\s\S]*?api\.get\(`\/api\/drawings\/\${d\.id}`\)/,
      'selectDrawing must call api.get'
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/draw_local_reactive.test.js`
Expected: FAIL on assertions (sync guards present, `__syncRawFetch` in `selectDrawing`).

- [ ] **Step 3: Implement minimal code changes in `static/index.html`**

1. In `DrawingTabInstance` (~line 9211):
```javascript
  useEffect(() => {
    const handler = async (e) => {
      const updatedId = e.detail?.id;
      if (!updatedId || String(updatedId) === String(tab?.id)) {
        try {
          const fresh = await api.get(`/api/drawings/${tab.id}`);
          if (fresh && fresh.data_json && iframeRef.current?.contentWindow) {
            if (fresh.data_json === lastLoadedJsonRef.current) return;
            lastLoadedJsonRef.current = fresh.data_json;
            iframeRef.current.contentWindow.postMessage({
              type: 'load',
              data: fresh.data_json
            }, window.location.origin);
          }
        } catch (_) {}
      }
    };
    window.addEventListener("drawingSaved", handler);
    return () => window.removeEventListener("drawingSaved", handler);
  }, [tab?.id]);
```

2. In `QuickDrawModal` (~line 17340):
```javascript
  useEffect(() => {
    const handler = async (e) => {
      const updatedId = e.detail?.id;
      if (!updatedId || String(updatedId) === String(drawingId)) {
        try {
          const fresh = await api.get(`/api/drawings/${drawingId}`);
          if (fresh && fresh.title) {
            setTitle(fresh.title);
            setTitleInput(fresh.title);
          }
          if (fresh && fresh.data_json && iframeRef.current?.contentWindow) {
            if (fresh.data_json === lastLoadedJsonRef.current) return;
            lastLoadedJsonRef.current = fresh.data_json;
            iframeRef.current.contentWindow.postMessage({
              type: 'load',
              data: fresh.data_json
            }, window.location.origin);
          }
        } catch (_) {}
      }
    };
    window.addEventListener("drawingSaved", handler);
    return () => window.removeEventListener("drawingSaved", handler);
  }, [drawingId]);
```

3. In `DrawPage.selectDrawing` (~line 9375):
```javascript
  const selectDrawing = async d => {
    try {
      const full = (await api.get(`/api/drawings/${d.id}`).catch(() => null)) || d;
      setOpenTabs(prev => {
        const helper = (window.TF && window.TF.drawingtabs) || (typeof drawingtabs !== "undefined" ? drawingtabs : null);
        if (!helper) return prev;
        const res = helper.openTab(prev, full.id, full.title);
        setActiveTabId(res.activeTabId);
        return res.tabs.map(t => (t.id === full.id ? { ...full, ...t } : t));
      });
    } catch (e) {
      showToast("Gagal memuat gambar", "error");
    }
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/draw_local_reactive.test.js`
Expected: PASS (all 3 unit tests pass).

---

### Task 2: Refine `draw-app` Mount & Handshake for 100% Offline-First Parent Handshake

**Files:**
- Modify: `draw-app/src/App.jsx:244-276`
- Output: `static/vendor/tldraw/assets/index.js`
- Test: `tests/offline/draw_local_reactive.test.js`

**Interfaces:**
- Consumes: Handshake `{ type: 'ready', noteId }` from iframe, parent replies `{ type: 'load', data: doc.data_json }`
- Produces: Clean canvas mount without unhandled offline network errors or stale server snapshot overwrites.

- [ ] **Step 1: Write test case for parent-authoritative handshake**

Add to `tests/offline/draw_local_reactive.test.js`:
- Verify `draw-app/src/App.jsx` handles mount cleanly and parent handles `{ type: 'ready' }` by posting `{ type: 'load' }` snapshot.

- [ ] **Step 2: Update `draw-app/src/App.jsx` and compile bundle**

In `draw-app/src/App.jsx`:
- Ensure `handleMount` sets `editorRef.current = editor` and immediately triggers `window.parent.postMessage({ type: 'ready', noteId }, '*')` without blocking on direct network `fetch`.
- Build bundle: `npm --prefix draw-app run build`.

- [ ] **Step 3: Verify build and run tests**

Run: `npm --prefix draw-app run build`
Run: `node --test tests/offline/*.test.js`
Expected: PASS.

---

### Task 3: Cache Bump, Full Regression Test, and Handover

**Files:**
- Modify: `static/sw.js:1`
- Update: `.agents/CURRENT_STATE.md`, `.agents/SESSION_LOG.md`

- [ ] **Step 1: Bump Service Worker cache version**
In `static/sw.js`:
Change `const CACHE = "taskflow-v322-inline-draw-preview-xml-fix";` to `const CACHE = "taskflow-v323-unified-draw-offline-reactive";`.

- [ ] **Step 2: Run all regression test suites**
1. Inline scripts syntax check: `node scratch/check_inline.js static/index.html`
2. JS offline test suites: `node --test tests/offline/*.test.js`
3. Pytest backend test suites: `python -m pytest tests/`

- [ ] **Step 3: Independent Subagent Code Review**
Dispatch a subagent to review the diff against Superpowers guidelines.

- [ ] **Step 4: Update Documentation**
Update `.agents/CURRENT_STATE.md` and append to `.agents/SESSION_LOG.md`.
