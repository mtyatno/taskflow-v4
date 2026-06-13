# Tauri SSE Cross-Origin Auth (#3b-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the SSE chat-stream endpoint accept the JWT via a `?token=` query param (the only auth channel `EventSource` can use cross-origin) and have the frontend append it when running in the cross-origin Tauri app — so realtime chat works on the desktop.

**Architecture:** Refactor `get_current_user`'s token resolution into `_resolve_user(request, allow_query)`; `get_current_user` (header/cookie only, unchanged) + a new `get_current_user_sse` (also reads `?token=`) used ONLY by the stream endpoint. Frontend appends `?token=<jwt>` to the `EventSource` URL only when `API_BASE !== ""` (web stays cookie-based, byte-identical).

**Tech Stack:** FastAPI (`webapp.py`), vanilla JS (`static/index.html`).

**Reference spec:** `docs/superpowers/specs/2026-06-13-tauri-sse-cross-origin-design.md`

**Baseline before starting:** `node --test tests/offline/*.test.js` → `pass 352`.

**Pinned facts (verified):** `webapp.py` — `get_current_user` at lines 360-377; the SSE endpoint `chat_stream` at line 2070 (`user=Depends(get_current_user)`). `static/index.html` — the chat `EventSource` at line 12207: `const es = new EventSource(apiUrl(\`/api/lists/${list.id}/messages/stream\`));`. `API_BASE` (#3a) and `__token` (the JWT used by `api.fetch`) are module-level in the app inline script, in scope in `ChatRoom`.

---

### Task 1: Backend — `get_current_user_sse` + apply to the stream endpoint

**Files:**
- Modify: `webapp.py`

No Node test (Python; no pytest harness). Verify with `python -m py_compile webapp.py` + grep. Edit ONLY the repo-root `webapp.py`, NOT `.claude/worktrees/*`.

- [ ] **Step 1: Refactor `get_current_user` into a shared resolver + two dependencies**

Replace the entire current `get_current_user` function (webapp.py lines 360-377):
```python
async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    data = decode_token(token)
    data["sub"] = int(data["sub"])
    if data.get("scope") == "ext":
        with get_db() as conn:
            row = conn.execute(
                "SELECT id FROM ext_tokens WHERE token = ?", (token,)
            ).fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="Token sudah direvoke")
    return data
```
with:
```python
async def _resolve_user(request: Request, allow_query: bool) -> dict:
    token = request.cookies.get("token")
    if not token:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            token = auth[7:]
    if not token and allow_query:
        # EventSource (SSE) cannot send the Authorization header cross-origin (Tauri desktop),
        # so the stream endpoint also accepts the token as a query param. Scoped to SSE only.
        token = request.query_params.get("token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    data = decode_token(token)
    data["sub"] = int(data["sub"])
    if data.get("scope") == "ext":
        with get_db() as conn:
            row = conn.execute(
                "SELECT id FROM ext_tokens WHERE token = ?", (token,)
            ).fetchone()
        if not row:
            raise HTTPException(status_code=401, detail="Token sudah direvoke")
    return data


async def get_current_user(request: Request) -> dict:
    return await _resolve_user(request, allow_query=False)


async def get_current_user_sse(request: Request) -> dict:
    return await _resolve_user(request, allow_query=True)
```

- [ ] **Step 2: Use `get_current_user_sse` on the stream endpoint**

At `webapp.py` line ~2070, change:
```python
async def chat_stream(list_id: int, request: Request, user=Depends(get_current_user)):
```
to:
```python
async def chat_stream(list_id: int, request: Request, user=Depends(get_current_user_sse)):
```

(Only the stream endpoint changes. Every other `Depends(get_current_user)` site is unchanged — confirm via grep in Step 3 that exactly one occurrence flipped to `get_current_user_sse`.)

- [ ] **Step 3: Verify**

```
python -m py_compile webapp.py
```
Expected: no output (success). Do NOT import webapp / start the server.

Confirm the wiring:
```
node -e "const s=require('fs').readFileSync('webapp.py','utf8'); console.log('resolver:', /async def _resolve_user\(request: Request, allow_query: bool\)/.test(s), 'sse-dep:', /async def get_current_user_sse\(request: Request\)/.test(s), 'sse-used:', /chat_stream\(list_id: int, request: Request, user=Depends\(get_current_user_sse\)\)/.test(s), 'sse-count:', (s.match(/get_current_user_sse/g)||[]).length);"
```
Expected: `resolver: true sse-dep: true sse-used: true sse-count: 2` (one in the def, one in the chat_stream Depends).

Confirm `get_current_user` is still used elsewhere (unchanged surface) — there should be many:
```
node -e "const s=require('fs').readFileSync('webapp.py','utf8'); console.log('gcu uses:', (s.match(/Depends\(get_current_user\)/g)||[]).length, '>= 1');"
```
Expected: a count well above 1 (all the other endpoints).

- [ ] **Step 4: Commit**

```bash
git add webapp.py
git commit -m "feat(tauri): SSE endpoint accepts ?token= for cross-origin EventSource auth (#3b-2)"
```

NOTE: requires a `taskflow-web` restart after deploy.

---

### Task 2: Frontend — append `?token=` to the EventSource URL when cross-origin

**Files:**
- Modify: `static/index.html`
- Modify: `static/sw.js`

- [ ] **Step 1: Append the token query only when cross-origin**

In `static/index.html` at line ~12207, change:
```js
    const es = new EventSource(apiUrl(`/api/lists/${list.id}/messages/stream`));
```
to:
```js
    const __sseUrl = apiUrl(`/api/lists/${list.id}/messages/stream`)
      + (API_BASE && __token ? `?token=${encodeURIComponent(__token)}` : "");
    const es = new EventSource(__sseUrl);
```

(On web `API_BASE === ""` → no token appended → same-origin cookie auth, byte-identical. In Tauri `API_BASE` is the VPS URL → `?token=<jwt>` is appended for `get_current_user_sse`.)

- [ ] **Step 2: Bump the service worker**

In `static/sw.js` line 1, change to:
```js
const CACHE = "taskflow-v138-sse-token";
```

- [ ] **Step 3: Verify**

Node offline suite unaffected:
```
node --test tests/offline/*.test.js
```
Expected: `pass 352`, `fail 0`.

Confirm the token-append is gated on `API_BASE` + SW bumped:
```
node -e "const s=require('fs').readFileSync('static/index.html','utf8'); console.log('gated:', /API_BASE && __token \? `\?token=\$\{encodeURIComponent\(__token\)\}`/.test(s), 'evtsrc:', /new EventSource\(__sseUrl\)/.test(s)); const sw=require('fs').readFileSync('static/sw.js','utf8'); console.log('v138:', /taskflow-v138-sse-token/.test(sw));"
```
Expected: `gated: true evtsrc: true` then `v138: true`

Inline-script parse:
```
node -e "const s=require('fs').readFileSync('static/index.html','utf8'); const m=s.match(/<script>[\s\S]*?<\/script>/g)||[]; let bad=0; for(const b of m){try{new Function(b.replace(/^<script>/,'').replace(/<\/script>$/,''));}catch(e){bad++;}} console.log('parse errors:', bad);"
```
Expected: `parse errors: 0`

- [ ] **Step 4: Commit**

```bash
git add static/index.html static/sw.js
git commit -m "feat(tauri): append ?token= to chat EventSource when cross-origin + SW v138 (#3b-2)"
```

---

## Acceptance (user, after deploy + restart)
- In the Tauri desktop app, open a shared list's chat while another member posts — realtime messages now appear live (previously only history loaded).
- On the web, chat realtime is unchanged (cookie path; `API_BASE === ""` → no `?token`).
- Quick backend check: `curl -i "https://todo.yatno.web.id/api/lists/<id>/messages/stream?token=<jwt>"` returns `200` + `content-type: text/event-stream` (was `401` without the token).

---

## Self-Review Notes (addressed)

- **Spec coverage:** §1 backend `_resolve_user`/`get_current_user_sse` + applied to `chat_stream` → Task 1; §2 frontend EventSource token + SW v138 → Task 2; §3 verification → each task's verify step.
- **Unchanged surface:** `get_current_user` still wraps `_resolve_user(allow_query=False)` (header/cookie order + `ext_tokens` check preserved); only `chat_stream` flips to `_sse`. Task 1 Step 3 asserts exactly one `get_current_user_sse` Depends usage and that other `get_current_user` usages remain.
- **Web byte-identical:** Task 2 gates the `?token` append on `API_BASE` (which is `""` on web).
- **No new tests:** no pytest harness (offline tests are Node); the auth refactor is verified by `py_compile` + grep + the manual acceptance check. Frontend is plumbing — Node suite stays 352, inline-parse clean.
