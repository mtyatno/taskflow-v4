# Design Spec: Tauri — Remote-API Ready (#3a)

**Date:** 2026-06-13
**Status:** Approved
**Slice:** #3a, the first sub-project of #3 (Tauri desktop shell). Prepares the existing PWA to run from a non-VPS origin (a bundled Tauri app) and talk to the VPS API. No Rust/Tauri toolchain involved — pure frontend + backend prep, fully testable on the web.

**Context decisions (locked):** Tauri will **bundle the local frontend assets** (IndexedDB as source of truth, sync to the VPS), and the `.exe`/AppImage will be **built in GitHub Actions** (tauri-action), not locally. #3a is the prerequisite plumbing for that; the actual Tauri scaffold + build is #3b.

---

## Overview

Today the frontend calls the API with **relative URLs** (`/api/...`) everywhere, which works only because the page is served same-origin from the VPS. A bundled Tauri app loads its frontend from a local origin (`tauri://localhost` / `http://tauri.localhost`), so relative `/api/...` would resolve to the local protocol, not the VPS. Two changes make the app origin-agnostic:

1. **Frontend:** introduce a single configurable `API_BASE` (default `""`) and an `apiUrl()` helper, applied at every `/api` network call site. With `API_BASE === ""`, behavior is byte-identical to today (web). The Tauri build (#3b) injects `window.__API_BASE = "https://todo.yatno.web.id"` before the app loads.
2. **Backend:** add `CORSMiddleware` so the cross-origin Tauri app can call the API. The app authenticates with Bearer tokens in the `Authorization` header (not cookies), so CORS does not weaken security.

**No behavior change on the web.** This slice is invisible to web users; it only unblocks the desktop build.

### In scope
- `API_BASE` + `apiUrl()` helper, applied to all `/api` fetch/EventSource call sites in `static/index.html`.
- FastAPI `CORSMiddleware` allowing the Tauri origins + the production domain.

### Out of scope (deferred)
- Tauri scaffold, config, CI workflow, the `.exe` build → #3b.
- Cross-origin **SSE chat auth**: `EventSource` cannot send an `Authorization` header, so realtime chat from a cross-origin Tauri app needs special handling (token-in-query or a polling fallback). #3a only prepends `API_BASE` to the EventSource URL (harmless on web, where `API_BASE === ""`); the auth fix is #3b. Document this clearly.
- BlobStore → filesystem (attachments are #2f-4, not yet implemented).
- Any runtime "server URL" setting UI (single-VPS app; `API_BASE` is build-injected, YAGNI a settings field).

---

## 1. Frontend — `API_BASE` + `apiUrl()`

In `static/index.html`, near the top of the app script (before the `api` object, alongside `tokenStore`/`__token`), add:

```js
const API_BASE = (typeof window !== "undefined" && window.__API_BASE) ? window.__API_BASE : "";
// Prepend API_BASE to absolute API paths ("/api/..."); leave full URLs and non-slash inputs untouched.
const apiUrl = (p) => (typeof p === "string" && p.charAt(0) === "/") ? API_BASE + p : p;
```

Then wrap the URL at every site that fetches an `/api` path. The sites (verify exact lines during implementation):

- `api.fetch`: `const res = await fetch(url, ...)` → `await fetch(apiUrl(url), ...)`.
- `__syncTransport.request`: `window.fetch(path, ...)` → `window.fetch(apiUrl(path), ...)`.
- `__syncRawFetch`: `window.fetch(u, ...)` → `window.fetch(apiUrl(u), ...)`.
- Raw attachment uploads: `fetch(\`/api/tasks/${taskId}/attachments\`, ...)` (two sites) and `fetch(\`/api/scratchpad/${noteId}/attachments\`, ...)` → wrap each URL with `apiUrl(...)`.
- Export download: `fetch('/api/export/download', ...)` → `apiUrl(...)`.
- Chat SSE: `new EventSource(\`/api/lists/${list.id}/messages/stream\`)` → `new EventSource(apiUrl(\`/api/lists/${list.id}/messages/stream\`))`. (URL prefix only; cross-origin auth deferred to #3b.)

**Do NOT** wrap static-asset URLs (scripts, images, the SW registration) — those stay relative/same-origin in both web and Tauri-bundled contexts. Only `/api/*` network calls get `apiUrl()`.

The offline LocalRouter intercept in `api.fetch` runs **before** the network `fetch` and matches on the raw relative `url` (e.g. `/api/tasks`) — leave that matching unchanged; only the fall-through network `fetch(url)` becomes `fetch(apiUrl(url))`. (The router's `hasRoute`/`dispatch` keys on the relative path, which is correct in all origins.)

---

## 2. Backend — CORS

In `webapp.py`, immediately after the FastAPI `app = FastAPI(...)` construction, add:

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

- Origins are configurable via the `CORS_ALLOW_ORIGINS` env var; the default covers the Tauri webview origins (`tauri://localhost` on macOS/Linux, `http://tauri.localhost` / `https://tauri.localhost` on Windows) plus the production web origin.
- `allow_credentials=False` because the app uses Bearer-token auth (Authorization header), not cookies — so there is no cookie-credential exposure, and `allow_headers=["*"]` (which permits `Authorization`) is safe.
- `CORSMiddleware` automatically answers `OPTIONS` preflight requests.

This is a Python change → requires a manual `taskflow-web` restart after deploy (static deploy alone does not reload Python).

---

## 3. Service worker

`static/index.html` changed → bump `static/sw.js` cache version to **v136**. No new precache entries.

---

## 4. Testing & Verification

- **Node suite unaffected:** `node --test tests/offline/*.test.js` → still `pass 350`, `fail 0` (the offline tests don't exercise index.html's fetch layer; the LocalRouter still matches relative paths).
- **No web regression:** with `API_BASE === ""`, `apiUrl("/api/x") === "/api/x"` — byte-identical requests. Grep-confirm `apiUrl(` wraps the call sites and that no `/api` literal fetch remains unwrapped at the listed sites. Inline-script parse check = 0 errors.
- **Backend:** `python -m py_compile webapp.py`. After deploy + restart, a cross-origin preflight (`curl -i -X OPTIONS https://todo.yatno.web.id/api/auth/me -H "Origin: http://tauri.localhost" -H "Access-Control-Request-Method: GET"`) returns `access-control-allow-origin` + `access-control-allow-methods`.
- **Manual web smoke (user):** the live web app still logs in, loads, and syncs normally (API_BASE="" path) — this slice must be invisible on the web.

---

## 5. Verification of "remote-ready" (the point of the slice)

To prove the app can run from a different origin against the VPS (without yet building Tauri): in a browser DevTools console on a *blank/local* page (or a `file://`/localhost page) one could set `window.__API_BASE = "https://todo.yatno.web.id"` and load the bundled assets — but full validation lands in #3b when Tauri actually injects `__API_BASE` and loads the bundle. #3a's own success criterion is narrower: **the web app is unchanged, and every `/api` call now flows through `apiUrl()`** so that a single injected `__API_BASE` will redirect them all.
