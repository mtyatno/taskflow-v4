# Design Spec: Tauri SSE Cross-Origin Auth (#3b-2)

**Date:** 2026-06-13
**Status:** Approved
**Slice:** #3b-2 of #3 (Tauri), after #3b (scaffold + CI build). Fixes realtime chat (SSE) in the cross-origin desktop app — the one gap #3b explicitly deferred.

---

## Overview

Realtime chat uses `EventSource('/api/lists/:id/messages/stream')`. The server's `get_current_user` resolves the JWT from the `token` cookie, then the `Authorization: Bearer` header. In the **web** app (same-origin) the cookie is sent, so SSE authenticates fine. In the **Tauri** desktop app the webview is cross-origin to the VPS: the cookie is not sent (cross-origin + `allow_credentials=False`), and the `EventSource` API cannot set an `Authorization` header — so the stream gets `401` and realtime chat is dead (history still loads via the cached/read-through path).

Fix: let the SSE endpoint **also** accept the token as a `?token=` query parameter (the only auth channel `EventSource` can use cross-origin), and have the frontend append it **only** when running cross-origin (`API_BASE !== ""`, i.e. Tauri). Web behavior is unchanged.

### Scoping decision
The query-token is accepted **only on the SSE endpoint** (a dedicated `get_current_user_sse` dependency), not globally. Query strings leak into server access logs / browser history, so this widened auth surface is confined to the one endpoint that genuinely needs it (every other endpoint uses fetch + the `Authorization` header and is unchanged).

### In scope
- Backend: `get_current_user_sse` dependency (cookie → Bearer header → `?token=` query); applied to `GET /api/lists/{id}/messages/stream`.
- Frontend: append `?token=<jwt>` to the `EventSource` URL when `API_BASE !== ""`.

### Out of scope
- Changing any other endpoint's auth (all stay header/cookie-only).
- WebSocket migration / a polling fallback (token-via-query is sufficient).
- Code signing / auto-update (#3c).

---

## 1. Backend — `get_current_user_sse` (`webapp.py`)

Refactor the token-resolution body of `get_current_user` into a shared helper that optionally also reads the `token` query param, so the two dependencies don't duplicate the decode + `ext_tokens` validation:

- `async def _resolve_user(request, allow_query: bool) -> dict` — token from `request.cookies.get("token")`, then `Authorization: Bearer`, then (only if `allow_query`) `request.query_params.get("token")`; raise 401 if none; `decode_token`, set `data["sub"]=int(...)`, and the existing `scope=="ext"` `ext_tokens` check.
- `get_current_user(request)` → `_resolve_user(request, allow_query=False)` (unchanged behavior — header/cookie only).
- `get_current_user_sse(request)` → `_resolve_user(request, allow_query=True)`.
- The SSE endpoint `chat_stream` (`GET /api/lists/{list_id}/messages/stream`) changes `user=Depends(get_current_user)` → `user=Depends(get_current_user_sse)`. Everything else in that endpoint (the `is_list_member_or_owner` check, the `EventSourceResponse`) is unchanged.

`get_admin_user` and all other endpoints continue to depend on `get_current_user` — no widened surface elsewhere.

Backend change → requires a manual `taskflow-web` restart after deploy.

---

## 2. Frontend — append token to the EventSource URL (`static/index.html`)

In `ChatRoom`'s SSE effect (currently `const es = new EventSource(apiUrl(\`/api/lists/${list.id}/messages/stream\`));`), build the URL with a token query only when cross-origin:

```js
    const __sseUrl = apiUrl(`/api/lists/${list.id}/messages/stream`)
      + (API_BASE && __token ? `?token=${encodeURIComponent(__token)}` : "");
    const es = new EventSource(__sseUrl);
```

- `API_BASE` (from #3a) is `""` on web → no token appended → the existing same-origin cookie auth path → **byte-identical web behavior**.
- In Tauri, `API_BASE` is the VPS URL → append `?token=<jwt>`; the backend's `get_current_user_sse` reads it. `__token` is the module-level JWT already used by `api.fetch`'s `Authorization` header, in scope in `ChatRoom`.

SW (`static/sw.js`): bump cache version → **v138**.

---

## 3. Testing & Verification

- Backend: `python -m py_compile webapp.py`. No pytest harness exists (offline tests are Node), so the SSE auth is verified manually (below). Confirm `get_current_user` behavior is unchanged (the refactor preserves the cookie→header order and the `ext_tokens` check).
- Frontend: Node offline suite unaffected → `pass 352`, `fail 0`; inline-script parse = 0; grep confirms the `?token=` is gated on `API_BASE`.
- **Acceptance (user):** after deploy + restart, in the Tauri desktop app open a shared list's chat with another member sending messages — realtime messages now appear live (previously only history loaded). On the web, chat realtime continues to work unchanged (cookie path). A quick check: `curl -i "https://todo.yatno.web.id/api/lists/<id>/messages/stream?token=<jwt>"` returns an SSE stream (200, `content-type: text/event-stream`) rather than 401.
