# Fix Inline Drawing Standalone Open ("Gambar tidak ditemukan") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the issue where clicking "↗️ Buka di Halaman Draw" from an inline note drawing modal (`QuickDrawModal` / `::draw[...]`) opens `DrawPage` but fails with the notification "Gambar tidak ditemukan", by supporting robust multi-identifier matching (id, cid, client_id, server_id), fixing `configureFetcher` fallback routing, and resolving the initial mount race condition.

**Architecture:**
1. In `DrawPage` (`static/index.html`), implement a robust multi-identifier matcher `matchesDrawingId(d, targetId)` that checks `String(d.id) === String(targetId) || String(d.cid) === String(targetId) || String(d.client_id) === String(targetId) || (d.server_id != null && String(d.server_id) === String(targetId))`.
2. In `configureFetcher` (`static/index.html`), ensure `window.TF.drawingrepo.configureFetcher` queries `serverIdOf(idOrCid)` and falls back to fetching `__syncRawFetch('/api/drawings/' + (sid || idOrCid))` directly from the FastAPI backend (which natively supports integer `id` and string `client_id`).
3. In `DrawPage` (`static/index.html`), prevent the mount race condition by gating `useEffect([initialDrawingId, loading])` with `if (!initialDrawingId || loading) return;` so it does not prematurely query or consume `initialDrawingId` against an empty `drawings = []` state before `fetchDrawingsList()` resolves.
4. Update `selectDrawing` in `DrawPage` to safely handle `d.id != null ? d.id : d.cid` and update tab items by matching `matchesDrawingId`.
5. Bump Service Worker cache version in `static/sw.js` to `taskflow-v325-draw-open-cid-standalone-fix`.

**Tech Stack:** React, Vanilla JS, IndexedDB / Offline Router (`drawingrepo.js`, `drawingroutes.js`), FastAPI backend (`webapp.py`), Node.js test runner (`node:test`).

## Global Constraints
- Do not break offline drawing functionality or existing tests (`tests/offline/*.test.js`, `tests/test_drawings.py`).
- Maintain strict backward compatibility for both numeric server IDs and `drw_...` CIDs.
- Use `node scratch/check_inline.js static/index.html` to guarantee 5/5 scripts parse cleanly.
- Keep CRLF line endings consistent on Windows.

---

### Task 1: Add Regression Tests for Multi-Identifier Drawing Resolution & Standalone Open
**Files:**
- Modify: `tests/offline/drawpage_open.test.js`

**Interfaces:**
- Consumes: `static/index.html` compiled code
- Produces: Test assertions for `matchesDrawingId`, CID matching, `configureFetcher` CID fallback, and non-premature consumption

- [ ] **Step 1: Write the failing tests in `tests/offline/drawpage_open.test.js`**
Add assertions for:
1. `matchesDrawingId` or equivalent multi-identifier matching in `DrawPage` (verifying `d.id`, `d.cid`, `d.client_id`, and `d.server_id`).
2. `DrawPage` lookup uses multi-identifier matching for `list.find`, `drawings.find`, and `openDrawing` handler.
3. `configureFetcher` fallback to `idOrCid` directly if `sid` is null or if `idOrCid` is numeric / CID.
4. `useEffect([initialDrawingId, loading])` guards against running when `loading` is true.

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test tests/offline/drawpage_open.test.js`
Expected: FAIL (assertions fail on missing `matchesDrawingId` / `configureFetcher` fallback)

- [ ] **Step 3: Commit test file**
```bash
git add tests/offline/drawpage_open.test.js
git commit -m "test(draw): add failing tests for multi-identifier standalone drawing open"
```

---

### Task 2: Implement Multi-Identifier Resolution, Fetcher Fallback, and Race Prevention in `static/index.html` & `static/sw.js`
**Files:**
- Modify: `static/index.html`
- Modify: `static/sw.js`

**Interfaces:**
- Consumes: `matchesDrawingId`, `window.TF.drawingrepo.configureFetcher`, `DrawPage`
- Produces: Seamless standalone drawing opening without "Gambar tidak ditemukan" toast

- [ ] **Step 1: Update `configureFetcher` in `static/index.html`**
Update `configureFetcher` around line 549 to:
```javascript
if (window.TF && window.TF.drawingrepo && window.TF.idmap) {
  window.TF.drawingrepo.configureFetcher((idOrCid) => {
    if (/^\d+$/.test(String(idOrCid))) {
      return __syncRawFetch("/api/drawings/" + idOrCid).then((r) => (r.ok ? r.json() : null));
    }
    return window.TF.idmap.serverIdOf(idOrCid).then((sid) => {
      const target = sid != null ? sid : idOrCid;
      return __syncRawFetch("/api/drawings/" + target).then((r) => (r.ok ? r.json() : null));
    });
  });
}
```

- [ ] **Step 2: Update `DrawPage` in `static/index.html`**
1. Add `matchesDrawingId`:
```javascript
  const matchesDrawingId = (d, targetId) => {
    if (!d || !targetId) return false;
    const t = String(targetId);
    return (
      String(d.id) === t ||
      String(d.cid) === t ||
      String(d.client_id) === t ||
      (d.server_id != null && String(d.server_id) === t)
    );
  };
```
2. Update `selectDrawing`:
```javascript
  const selectDrawing = async d => {
    try {
      const drawId = d.id != null ? d.id : d.cid;
      const full = (await api.get(`/api/drawings/${drawId}`).catch(() => null)) || d;
      setOpenTabs(prev => {
        const helper = (window.TF && window.TF.drawingtabs) || (typeof drawingtabs !== "undefined" ? drawingtabs : null);
        if (!helper) return prev;
        const targetId = full.id != null ? full.id : full.cid;
        const res = helper.openTab(prev, targetId, full.title);
        setActiveTabId(res.activeTabId);
        return res.tabs.map(t => (matchesDrawingId(t, targetId) ? { ...full, ...t } : t));
      });
    } catch (e) {
      showToast("Gagal memuat gambar", "error");
    }
  };
```
3. Update `useEffect` (mount) and `useEffect([initialDrawingId, loading])`:
```javascript
  useEffect(() => {
    fetchDrawingsList()
      .then(list => {
        if (initialDrawingId) {
          const found = list.find(d => matchesDrawingId(d, initialDrawingId));
          if (found) {
            selectDrawing(found);
          } else {
            api.get(`/api/drawings/${initialDrawingId}`).then(full => {
              setDrawings(prev => prev.some(d => matchesDrawingId(d, full.id != null ? full.id : full.cid)) ? prev : [full, ...prev]);
              selectDrawing(full);
            }).catch(() => {
              typeof showToast === 'function' && showToast('Gambar tidak ditemukan', 'error');
            });
          }
          onInitialDrawingConsumed && onInitialDrawingConsumed();
        }
      })
      .finally(() => setLoading(false));
  }, []);
```
And:
```javascript
  useEffect(() => {
    if (!initialDrawingId || loading) return;
    const found = drawings.find(d => matchesDrawingId(d, initialDrawingId));
    if (found) {
      selectDrawing(found);
      onInitialDrawingConsumed && onInitialDrawingConsumed();
    } else {
      api.get(`/api/drawings/${initialDrawingId}`).then(full => {
        setDrawings(prev => prev.some(d => matchesDrawingId(d, full.id != null ? full.id : full.cid)) ? prev : [full, ...prev]);
        selectDrawing(full);
      }).catch(() => {
        typeof showToast === 'function' && showToast('Gambar tidak ditemukan', 'error');
      }).finally(() => {
        onInitialDrawingConsumed && onInitialDrawingConsumed();
      });
    }
  }, [initialDrawingId, loading]);
```
4. Update `openDrawing` listener in `DrawPage`:
```javascript
  useEffect(() => {
    const handler = e => {
      const id = typeof e.detail === 'object' && e.detail !== null ? e.detail.id : e.detail;
      if (!id) return;
      const found = drawings.find(d => matchesDrawingId(d, id));
      if (found) selectDrawing(found);
      else {
        api.get(`/api/drawings/${id}`).then(full => {
          setDrawings(prev => prev.some(d => matchesDrawingId(d, full.id != null ? full.id : full.cid)) ? prev : [full, ...prev]);
          selectDrawing(full);
        }).catch(() => {
          typeof showToast === 'function' && showToast('Gambar tidak tersedia', 'error');
        });
      }
    };
    window.addEventListener("openDrawing", handler);
    return () => window.removeEventListener("openDrawing", handler);
  }, [drawings]);
```

- [ ] **Step 3: Bump Service Worker cache in `static/sw.js`**
Bump cache name to:
`const CACHE_NAME = 'taskflow-v325-draw-open-cid-standalone-fix';`

- [ ] **Step 4: Verify syntax & run tests**
Run:
1. `node scratch/check_inline.js static/index.html` (expect: 5/5 scripts OK)
2. `node --check static/sw.js` (expect: OK)
3. `node --test tests/offline/*.test.js` (expect: 592+/592+ pass, 0 fail)
4. `python -m pytest tests/` (expect: 57/57 pass, 0 fail)

- [ ] **Step 5: Commit changes**
```bash
git add static/index.html static/sw.js
git commit -m "fix(draw): resolve CID/numeric ID mismatch and race condition when opening standalone drawing"
```
