# Tauri Remote-API Ready (#3a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the frontend call the VPS API through a single configurable `API_BASE` (default `""`, so the web is unchanged) and add backend CORS, so a future bundled Tauri app loaded from a non-VPS origin can talk to the API.

**Architecture:** Introduce `API_BASE`/`apiUrl()` in `static/index.html` and wrap every `/api` network call site with `apiUrl()`. Add FastAPI `CORSMiddleware` (Bearer-token auth → CORS is safe). No new logic units; verification is the green Node suite + grep + inline-script parse + `py_compile`.

**Tech Stack:** Vanilla JS in `static/index.html`; FastAPI (`webapp.py`).

**Reference spec:** `docs/superpowers/specs/2026-06-13-tauri-remote-api-ready-design.md`

**Baseline before starting:** `node --test tests/offline/*.test.js` → `pass 350`.

**Pinned facts (verified):** `webapp.py` — `import os` at line 9, `app = FastAPI(...)` at line 651. `static/index.html` — `api.fetch` network call at line ~1456, `__syncTransport` at ~1507, `__syncRawFetch` at ~1520, raw attachment fetches at ~5247 + ~7459 (identical text) + ~13984, export fetch at ~13270, chat `EventSource` at ~12203. `const api = {` is at ~1430.

---

### Task 1: Frontend — `API_BASE` + `apiUrl()` at every `/api` call site

**Files:**
- Modify: `static/index.html`
- Modify: `static/sw.js`

- [ ] **Step 1: Add the `API_BASE` + `apiUrl` declarations**

In `static/index.html`, immediately BEFORE the `const api = {` line (~1430), insert:

```js
const API_BASE = (typeof window !== "undefined" && window.__API_BASE) ? window.__API_BASE : "";
// Prepend API_BASE to absolute API paths ("/api/..."); full URLs and non-slash inputs pass through.
const apiUrl = (p) => (typeof p === "string" && p.charAt(0) === "/") ? API_BASE + p : p;
```

- [ ] **Step 2: Wrap the three core API-layer fetches**

(a) In `api.fetch` (~line 1456), change:
```js
      const res = await fetch(url, {
```
to:
```js
      const res = await fetch(apiUrl(url), {
```

(b) In `__syncTransport.request` (~line 1507), change:
```js
  request: (method, path, body) => window.fetch(path, {
```
to:
```js
  request: (method, path, body) => window.fetch(apiUrl(path), {
```

(c) In `__syncRawFetch` (~line 1520), change:
```js
const __syncRawFetch = (u) => window.fetch(u, { headers: __token ? { Authorization: "Bearer " + __token } : {} });
```
to:
```js
const __syncRawFetch = (u) => window.fetch(apiUrl(u), { headers: __token ? { Authorization: "Bearer " + __token } : {} });
```

- [ ] **Step 3: Wrap the raw attachment + export fetches**

(a) The task-attachment upload appears at TWO identical sites (~5247 and ~7459):
```js
      const res = await fetch(`/api/tasks/${taskId}/attachments`, {
```
Change BOTH to (use replace-all for this exact line, since both sites are identical):
```js
      const res = await fetch(apiUrl(`/api/tasks/${taskId}/attachments`), {
```

(b) The note-attachment upload (~13984):
```js
      const res = await fetch(`/api/scratchpad/${noteId}/attachments`, {
```
to:
```js
      const res = await fetch(apiUrl(`/api/scratchpad/${noteId}/attachments`), {
```

(c) The export download (~13270):
```js
      const res = await fetch('/api/export/download', {
```
to:
```js
      const res = await fetch(apiUrl('/api/export/download'), {
```

- [ ] **Step 4: Wrap the chat EventSource URL**

At ~line 12203, change:
```js
    const es = new EventSource(`/api/lists/${list.id}/messages/stream`);
```
to:
```js
    const es = new EventSource(apiUrl(`/api/lists/${list.id}/messages/stream`));
```

(URL prefix only — cross-origin SSE auth is deferred to #3b. With `API_BASE === ""` this is identical to today.)

- [ ] **Step 5: Bump the service worker**

In `static/sw.js` line 1, change the cache name to:
```js
const CACHE = "taskflow-v136-apibase";
```

- [ ] **Step 6: Verify**

Run the Node suite (must be unaffected — the offline LocalRouter still matches relative paths):
```
node --test tests/offline/*.test.js
```
Expected: `pass 350`, `fail 0`.

Confirm the declarations + all wraps landed:
```
node -e "const s=require('fs').readFileSync('static/index.html','utf8'); console.log('decl:', /const API_BASE =/.test(s) && /const apiUrl =/.test(s), 'wraps:', (s.match(/apiUrl\(/g)||[]).length);"
```
Expected: `decl: true wraps: N` where **N = 9** (1 in the `apiUrl` definition's own usage is NOT counted — it's a definition; the 8 call sites are: api.fetch, __syncTransport, __syncRawFetch, 2× task attachments, note attachment, export, EventSource — plus the helper body references `p`, not `apiUrl(`, so the count is the 8 call sites; if the tool counts 8 or 9 depending on the definition line, accept ≥ 8 and eyeball that each listed site is wrapped).

Confirm no listed `/api` site remains unwrapped — check the specific patterns are gone:
```
node -e "const s=require('fs').readFileSync('static/index.html','utf8'); console.log('bare-evtsrc:', /EventSource\(`\/api\/lists/.test(s), 'bare-export:', /fetch\('\/api\/export\/download'/.test(s), 'bare-synctransport:', /window\.fetch\(path,/.test(s), 'bare-rawfetch:', /window\.fetch\(u,/.test(s));"
```
Expected: `bare-evtsrc: false bare-export: false bare-synctransport: false bare-rawfetch: false`

Inline-script parse (no syntax break):
```
node -e "const s=require('fs').readFileSync('static/index.html','utf8'); const m=s.match(/<script>[\s\S]*?<\/script>/g)||[]; let bad=0; for(const b of m){try{new Function(b.replace(/^<script>/,'').replace(/<\/script>$/,''));}catch(e){bad++;}} console.log('parse errors:', bad);"
```
Expected: `parse errors: 0`

SW bumped:
```
node -e "console.log(/taskflow-v136-apibase/.test(require('fs').readFileSync('static/sw.js','utf8')));"
```
Expected: `true`

- [ ] **Step 7: Commit**

```bash
git add static/index.html static/sw.js
git commit -m "feat(tauri): API_BASE + apiUrl() at all /api call sites + SW v136 (#3a)"
```

---

### Task 2: Backend — CORS middleware

**Files:**
- Modify: `webapp.py`

- [ ] **Step 1: Add CORSMiddleware after the app construction**

In `webapp.py`, immediately AFTER the `app = FastAPI(title="TaskFlow V4", docs_url="/api/docs")` line (~651), insert:

```python
from fastapi.middleware.cors import CORSMiddleware

_CORS_ORIGINS = [
    o.strip() for o in os.environ.get(
        "CORS_ALLOW_ORIGINS",
        "tauri://localhost,http://tauri.localhost,https://tauri.localhost,https://todo.yatno.web.id",
    ).split(",") if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

(`os` is already imported at line 9. The app uses Bearer-token auth in the `Authorization` header — not cookies — so `allow_credentials=False` + `allow_headers=["*"]` is safe. `CORSMiddleware` answers OPTIONS preflight automatically. Origins are overridable via the `CORS_ALLOW_ORIGINS` env var.)

- [ ] **Step 2: Verify Python compiles**

```
python -m py_compile webapp.py
```
Expected: no output (success). (Do NOT `import webapp` — it runs DB migrations on import.)

Confirm the middleware is wired:
```
node -e "const s=require('fs').readFileSync('webapp.py','utf8'); console.log('import:', /from fastapi.middleware.cors import CORSMiddleware/.test(s), 'add:', /app.add_middleware\(\s*CORSMiddleware/.test(s), 'env:', /CORS_ALLOW_ORIGINS/.test(s));"
```
Expected: `import: true add: true env: true`

- [ ] **Step 3: Commit**

```bash
git add webapp.py
git commit -m "feat(api): CORS middleware for cross-origin (Tauri) clients (#3a)"
```

NOTE: after deploy, `taskflow-web` must be restarted on the VPS for CORS to take effect (static deploy does not reload Python).

---

## Self-Review Notes (addressed)

- **Spec coverage:** §1 frontend API_BASE/apiUrl at all sites → Task 1; §2 backend CORS → Task 2; §3 SW v136 → Task 1 Step 5; §4 verification → each task's verify step; §SSE-deferred → Task 1 Step 4 wraps the URL only (auth deferred to #3b, documented).
- **No new Node tests:** this is plumbing with no new logic units; `apiUrl` is inline in index.html (not a module), so verification is the unchanged 350-test suite + grep + inline-script parse + `py_compile`. This is honest for the change (with `API_BASE === ""`, every wrapped URL is byte-identical to today).
- **Identical-line edit:** the task-attachment fetch appears twice (5247, 7459) with identical text — Task 1 Step 3a calls this out and uses replace-all.
- **Router intercept untouched:** `api.fetch` wraps only the fall-through `fetch(url)`; the LocalRouter `hasRoute`/`dispatch` still key on the relative `url` (correct in every origin). No change to matching.
- **Expected suite count:** 350 (unchanged — no new tests).
