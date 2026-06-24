# Weekly Review (AI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GTD Weekly Review feature — a locally-computed digest the user acts on inline, plus a thin online Claude layer for synthesis + next-action suggestions — fully behind a kill-switch and cleanly revertible.

**Architecture:** The digest is computed client-side from the in-memory `tasks` array (offline-capable). A new gated FastAPI route `POST /api/ai/review` reads tasks from the DB (tasks-only), calls Claude Opus 4.8 via the Anthropic SDK, and returns structured JSON. All UI entry points are guarded by a single `AI_REVIEW_ON` flag (server env + per-user opt-in). Everything is additive so it reverts cleanly.

**Tech Stack:** FastAPI (`webapp.py`, raw sqlite via `get_db()`), Anthropic Python SDK, vanilla React via hand-written `React.createElement` in `static/index.html`, service worker `static/sw.js`.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-24-weekly-review-ai-design.md` (authoritative).
- **Kill-switch:** every new UI entry point wrapped in `AI_REVIEW_ON &&`; backend route returns 404/403 when `AI_FEATURES_ENABLED` is false. Default `AI_FEATURES_ENABLED=false`, per-user opt-in default off.
- **Privacy — tasks-only:** `ai_review.py` must NOT import any notes/scratchpad code. Payload whitelist (per task): `id, title, description, gtd_status, quadrant, priority, deadline, project, age_days, is_overdue`. **No note content, ever.**
- **Model:** `claude-opus-4-8`, `thinking={"type":"adaptive"}`, `output_config={"format":{"type":"json_schema","schema":REVIEW_SCHEMA}}`, `max_tokens=4096`, non-streaming. API key from env (`ANTHROPIC_API_KEY`), never hardcoded.
- **Offline-first:** digest is local; AI is best-effort. `/api/ai/*` must be network-only in the SW and must NOT be queued in the offline mutation outbox. A failed AI call never deletes the auth token (honor the no-lockout invariant).
- **SW cache:** bump `CACHE` in `static/sw.js` on every change to a static asset (current value `taskflow-v173-print-area-hidden` — increment).
- **JSX:** `static/index.html` is pre-compiled; write `React.createElement(...)` by hand, matching surrounding code. After any edit, verify parse (see Task 6 step) before committing.
- **Settings copy (verbatim):** "AI hanya membaca tugasmu (judul, deskripsi, deadline, prioritas). Catatan tidak pernah dikirim."
- **Commit style:** end messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## File Structure

- **Create** `ai_review.py` — payload builder, system prompt, JSON schema, `generate_review()` Claude call. The only place the Anthropic SDK is used. No notes imports.
- **Modify** `config.py` — add `AI_FEATURES_ENABLED` (env-driven bool).
- **Modify** `webapp.py` — (a) `serve_config` injects `window.__AI_ENABLED`; (b) new `POST /api/ai/review` route (gated, tasks-only query, calls `ai_review`).
- **Modify** `requirements-web.txt` — add `anthropic`.
- **Modify** `static/sw.js` — network-only bypass for `/api/ai/`; bump `CACHE`.
- **Modify** `static/index.html` — gate helper, `buildReview()` digest fn, `WeeklyReview` + `ReviewNudge` components, sidebar entry, Settings opt-in toggle, App mount.
- **Create** `tests/test_ai_review.py` — backend payload/privacy/schema tests.
- **Create** `tests/buildReview.test.js` — frontend digest unit tests (node --test).

---

### Task 1: Backend feature flag

**Files:**
- Modify: `config.py`
- Modify: `webapp.py:2197-2200` (`serve_config`)

**Interfaces:**
- Produces: `config.AI_FEATURES_ENABLED: bool`; `GET /config.js` appends `window.__AI_ENABLED = true|false;`.

- [ ] **Step 1: Add the env flag to `config.py`**

Append near the other env reads in `config.py`:

```python
import os
AI_FEATURES_ENABLED = os.getenv("AI_FEATURES_ENABLED", "false").strip().lower() in ("1", "true", "yes")
```

- [ ] **Step 2: Inject the flag into `/config.js`**

Replace `serve_config` (`webapp.py:2197-2200`) with a generated response that keeps the static body and appends the flag:

```python
from fastapi import Response  # ensure imported at top of webapp.py
import config as appconfig     # ensure imported at top of webapp.py

@app.get("/config.js")
async def serve_config():
    base = (STATIC_DIR / "config.js").read_text(encoding="utf-8")
    flag = "true" if appconfig.AI_FEATURES_ENABLED else "false"
    body = base + f"\ntry {{ window.__AI_ENABLED = {flag}; }} catch (e) {{}}\n"
    return Response(content=body, media_type="application/javascript")
```

(If `webapp.py` already imports `config` under a name, reuse it; otherwise add `import config as appconfig`. If `Response` is already imported from fastapi, don't duplicate.)

- [ ] **Step 3: Verify manually**

Run the web service locally (or on a dev box) and:
```bash
curl -s localhost:8000/config.js | tail -3
```
Expected: last lines include `window.__AI_ENABLED = false;` (default).
Then set `AI_FEATURES_ENABLED=true` in env, restart, curl again → `= true;`.

- [ ] **Step 4: Commit**

```bash
git add config.py webapp.py
git commit -m "feat(ai): AI_FEATURES_ENABLED flag injected into /config.js

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `ai_review.py` — payload, schema, prompt, Claude call

**Files:**
- Create: `ai_review.py`
- Test: `tests/test_ai_review.py`

**Interfaces:**
- Produces:
  - `WHITELIST: list[str]`
  - `build_payload(tasks: list[dict]) -> dict` — returns `{"counts": {...}, "tasks": [ {whitelisted...}, ... ]}`; each task dict contains exactly the whitelist keys (plus computed `age_days`).
  - `REVIEW_SCHEMA: dict`, `REVIEW_SYSTEM_PROMPT: str`
  - `generate_review(payload: dict) -> dict` — calls Claude, returns parsed JSON matching `REVIEW_SCHEMA`; on any failure raises `AIReviewError`.
  - `class AIReviewError(Exception)`

- [ ] **Step 1: Write failing tests** — `tests/test_ai_review.py`

```python
import json
import ai_review

SAMPLE = [
    {"id": "t1", "title": "Submit FIN report", "description": "weekly",
     "gtd_status": "next", "quadrant": "Q1", "priority": "P1",
     "deadline": "2026-06-26", "project": "Monetisasi", "is_overdue": False,
     "updated_at": "2026-06-10T00:00:00", "secret_note": "DO NOT SEND"},
]

def test_build_payload_only_whitelisted_keys():
    out = ai_review.build_payload(SAMPLE)
    assert set(out.keys()) == {"counts", "tasks"}
    t = out["tasks"][0]
    assert set(t.keys()) <= set(ai_review.WHITELIST)
    assert "secret_note" not in t           # non-whitelisted dropped
    assert t["title"] == "Submit FIN report"
    assert isinstance(t.get("age_days"), int)

def test_build_payload_never_leaks_notes_field():
    tasks = [dict(SAMPLE[0], note_content="PRIVATE", linked_note="x")]
    out = ai_review.build_payload(tasks)
    blob = json.dumps(out)
    assert "PRIVATE" not in blob and "note_content" not in blob

def test_no_notes_module_imported():
    import re
    src = open("ai_review.py", encoding="utf-8").read()
    import_lines = [l for l in src.splitlines() if re.match(r"\s*(import|from)\s", l)]
    joined = "\n".join(import_lines).lower()
    for banned in ("scratchpad", "noterepo", "notequery", "note"):
        assert banned not in joined, f"ai_review must not import {banned}"

def test_schema_is_strict_object():
    s = ai_review.REVIEW_SCHEMA
    assert s["type"] == "object"
    assert s["additionalProperties"] is False
    assert set(["summary", "focus_suggestions", "stalled_projects",
                "reflective_questions"]).issubset(s["properties"].keys())
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_ai_review.py -v` (or `python -m unittest`)
Expected: FAIL — `ModuleNotFoundError: No module named 'ai_review'`.

- [ ] **Step 3: Create `ai_review.py`**

```python
"""Weekly Review AI layer. TASKS-ONLY: this module must never import or read
notes/scratchpad data. Only the WHITELIST fields below leave the server.
NOTE: `anthropic` is imported lazily inside generate_review() so this module
imports (and build_payload/schema unit-test) without the SDK installed."""
import os
from datetime import date, datetime

WHITELIST = ["id", "title", "description", "gtd_status", "quadrant",
             "priority", "deadline", "project", "age_days", "is_overdue"]


class AIReviewError(Exception):
    pass


def _age_days(t: dict) -> int:
    raw = t.get("updated_at") or t.get("created_at")
    if not raw:
        return 0
    try:
        d = datetime.fromisoformat(str(raw).replace("Z", "")).date()
        return max(0, (date.today() - d).days)
    except Exception:
        return 0


def build_payload(tasks: list) -> dict:
    """Reduce full task dicts to whitelisted fields + aggregate counts."""
    out_tasks = []
    counts = {"inbox": 0, "next": 0, "waiting": 0, "someday": 0,
              "overdue": 0, "total": 0}
    for t in tasks:
        gs = t.get("gtd_status")
        counts["total"] += 1
        if gs in counts:
            counts[gs] += 1
        if t.get("is_overdue"):
            counts["overdue"] += 1
        item = {k: t.get(k) for k in WHITELIST if k != "age_days"}
        item["age_days"] = _age_days(t)
        out_tasks.append(item)
    return {"counts": counts, "tasks": out_tasks}


REVIEW_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "summary": {"type": "string"},
        "focus_suggestions": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False,
                "properties": {"task_id": {"type": "string"},
                               "reason": {"type": "string"}},
                "required": ["task_id", "reason"],
            },
        },
        "stalled_projects": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False,
                "properties": {
                    "project": {"type": "string"},
                    "next_actions": {
                        "type": "array",
                        "items": {
                            "type": "object", "additionalProperties": False,
                            "properties": {"title": {"type": "string"},
                                           "rationale": {"type": "string"}},
                            "required": ["title", "rationale"],
                        },
                    },
                },
                "required": ["project", "next_actions"],
            },
        },
        "reflective_questions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["summary", "focus_suggestions", "stalled_projects",
                 "reflective_questions"],
}

REVIEW_SYSTEM_PROMPT = (
    "Kamu asisten GTD untuk aplikasi task. Berdasarkan ringkasan TUGAS user "
    "(judul, status GTD, quadrant Eisenhower, prioritas, deadline, project, umur), "
    "buat review mingguan singkat dalam Bahasa Indonesia.\n"
    "- summary: 1-3 kalimat insight, soroti titik macet (mis. P1 overdue menumpuk).\n"
    "- focus_suggestions: 3-5 task PALING layak difokuskan minggu depan. task_id WAJIB "
    "  berasal dari daftar yang diberikan; jangan mengarang id.\n"
    "- stalled_projects: untuk project yang punya task tapi tidak punya next-action, "
    "  usulkan 1-2 next-action KONKRET (kata kerja di depan: 'Email...', 'Finalisasi...'), "
    "  bukan tujuan kabur.\n"
    "- reflective_questions: 1-2 pertanyaan reflektif terarah.\n"
    "Jangan menyertakan data selain yang diberikan. Ringkas dan actionable."
)


def generate_review(payload: dict) -> dict:
    import json
    import anthropic  # lazy: keeps the module importable without the SDK
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise AIReviewError("ANTHROPIC_API_KEY not configured")
    client = anthropic.Anthropic(api_key=api_key)
    try:
        resp = client.messages.create(
            model="claude-opus-4-8",
            max_tokens=4096,
            thinking={"type": "adaptive"},
            system=[{"type": "text", "text": REVIEW_SYSTEM_PROMPT,
                     "cache_control": {"type": "ephemeral"}}],
            output_config={"format": {"type": "json_schema",
                                      "schema": REVIEW_SCHEMA}},
            messages=[{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
        )
    except anthropic.APIError as e:
        raise AIReviewError(f"Claude API error: {e}") from e
    if resp.stop_reason == "refusal":
        raise AIReviewError("model refused")
    text = next((b.text for b in resp.content if b.type == "text"), None)
    if not text:
        raise AIReviewError("empty response")
    return json.loads(text)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_ai_review.py -v`
Expected: 4 passed. (No network — `generate_review` is not exercised here.)

- [ ] **Step 5: Commit**

```bash
git add ai_review.py tests/test_ai_review.py
git commit -m "feat(ai): tasks-only payload builder + Claude review module

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Backend route `POST /api/ai/review`

**Files:**
- Modify: `webapp.py` (add route near the bookmark route ~`3044`; add `import ai_review` near `import bookmark` ~`50`)

**Interfaces:**
- Consumes: `config.AI_FEATURES_ENABLED`, `get_current_user`, `get_db`, `task_row_to_dict`, `ai_review.build_payload`, `ai_review.generate_review`, `ai_review.AIReviewError`.
- Produces: `POST /api/ai/review` → `200 {summary, focus_suggestions, stalled_projects, reflective_questions}` | `404` when disabled | `503 {detail}` on AI failure.

- [ ] **Step 1: Add `import ai_review`** next to `import bookmark` (~`webapp.py:50`).

- [ ] **Step 2: Add the route** (place after the bookmark route, ~`webapp.py:3095`):

```python
@app.post("/api/ai/review")
async def ai_weekly_review(user=Depends(get_current_user)):
    if not appconfig.AI_FEATURES_ENABLED:
        raise HTTPException(status_code=404, detail="AI features disabled")
    uid = user["sub"]
    access_clause = (
        "user_id = ? OR list_id IN ("
        "  SELECT id FROM shared_lists WHERE owner_id = ?"
        "  UNION SELECT list_id FROM list_members WHERE user_id = ?)"
    )
    sql = (f"SELECT * FROM tasks WHERE ({access_clause}) "
           "AND gtd_status NOT IN ('archived')")
    with get_db() as conn:
        rows = conn.execute(sql, [uid, uid, uid]).fetchall()
        tasks = [task_row_to_dict(r, conn) for r in rows]
    payload = ai_review.build_payload(tasks)
    try:
        return ai_review.generate_review(payload)
    except ai_review.AIReviewError as e:
        raise HTTPException(status_code=503, detail=str(e))
```

(Reuse the existing `HTTPException` import; if `appconfig` alias differs, match Task 1.)

- [ ] **Step 3: Manual verify (disabled path)**

With `AI_FEATURES_ENABLED=false`:
```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:8000/api/ai/review -H "Authorization: Bearer <token>"
```
Expected: `404`.

- [ ] **Step 4: Manual verify (enabled path)**

With `AI_FEATURES_ENABLED=true` and a valid `ANTHROPIC_API_KEY`, repeat → `200` with the four JSON keys. (If the key is absent → `503 {"detail":"ANTHROPIC_API_KEY not configured"}`, which is correct.)

- [ ] **Step 5: Commit**

```bash
git add webapp.py
git commit -m "feat(ai): gated POST /api/ai/review (tasks-only)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Add `anthropic` dependency

**Files:**
- Modify: `requirements-web.txt`

- [ ] **Step 1: Append the dep**

Add a line to `requirements-web.txt`:
```
anthropic>=0.49
```

- [ ] **Step 2: Verify import resolves** (on the deploy box / venv): `python -c "import anthropic; print(anthropic.__version__)"` → prints a version.

- [ ] **Step 3: Commit**

```bash
git add requirements-web.txt
git commit -m "build(ai): add anthropic SDK to web requirements

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Service worker — network-only for `/api/ai/*`

**Files:**
- Modify: `static/sw.js`

**Interfaces:**
- Produces: requests to `/api/ai/` always hit the network (never cached/served stale).

- [ ] **Step 1: Find the fetch handler** — open `static/sw.js`, locate the `self.addEventListener("fetch", ...)` handler.

- [ ] **Step 2: Add an early bypass** as the first check inside the fetch handler (before any cache logic):

```javascript
  // AI endpoints are dynamic — never cache, always network.
  if (url.pathname.startsWith("/api/ai/")) {
    return; // let the browser do a normal network fetch
  }
```
(If the handler derives `url` later, compute it first: `const url = new URL(event.request.url);` at the top of the handler.)

- [ ] **Step 3: Bump the cache version**

Edit line 1: increment `CACHE` (e.g. `taskflow-v174-weekly-review`).

- [ ] **Step 4: Verify** — `grep -n "api/ai" static/sw.js` shows the bypass; `head -1 static/sw.js` shows the new version.

- [ ] **Step 5: Commit**

```bash
git add static/sw.js
git commit -m "feat(ai): SW network-only bypass for /api/ai/*; bump cache

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Frontend gate + local digest `buildReview()` (extracted module)

**Files:**
- Create: `static/review/digest.js` (single source of `buildReview`, dual export: `window.buildReview` + CommonJS — mirrors the `static/config.js` dual-export pattern)
- Modify: `static/index.html` (load the module via a `<script>` tag before the app script; add `aiReviewOn()` gate helper)
- Modify: `static/sw.js` (add `/static/review/digest.js` to the `STATIC` precache list so it works offline)
- Test: `tests/buildReview.test.js` (imports the one real module — no duplication)

**Interfaces:**
- Produces:
  - Global `buildReview(tasks)` (via `window.buildReview`, loaded before the app) → `{ inbox, overdue, doneThisWeek, staleNext, waiting, projectsNoNext, dueNextWeek, someday }`; each is an array of task objects. `projectsNoNext` is an array of `{ project, tasks }`.
  - `aiReviewOn()` (module scope in `index.html`) → `!!window.__AI_ENABLED && localStorage.getItem('tf_ai_review_optin') === '1'`.

- [ ] **Step 1: Write failing test** — `tests/buildReview.test.js`

```javascript
const test = require("node:test");
const assert = require("node:assert");
const { buildReview } = require("../static/review/digest.js"); // the one real module

const ago = (d) => new Date(Date.now() - d * 864e5).toISOString();

const tasks = [
  { id: 1, gtd_status: "inbox", title: "a" },
  { id: 2, gtd_status: "next", title: "b", is_overdue: true, deadline: "2000-01-01" },
  { id: 3, gtd_status: "next", title: "c", updated_at: ago(10) },         // stale
  { id: 4, gtd_status: "waiting", title: "d" },
  { id: 5, gtd_status: "someday", title: "e" },
  { id: 6, gtd_status: "done", title: "f", updated_at: ago(2) },          // win
  { id: 7, gtd_status: "inbox", title: "g", project: "P" },              // P has no next
];

test("buildReview buckets", () => {
  const r = buildReview(tasks);
  assert.equal(r.inbox.length, 2);
  assert.equal(r.overdue.length, 1);
  assert.equal(r.staleNext.length, 1);
  assert.equal(r.waiting.length, 1);
  assert.equal(r.someday.length, 1);
  assert.equal(r.doneThisWeek.length, 1);
  assert.ok(r.projectsNoNext.some((p) => p.project === "P"));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/buildReview.test.js`
Expected: FAIL — cannot find `../static/review/digest.js`.

- [ ] **Step 3: Create `static/review/digest.js`** (one source of truth; dual export)

```javascript
// Weekly Review digest — pure function over the in-memory tasks array.
// Loaded as a plain script before the app (exposes window.buildReview) and
// importable in Node tests (module.exports). No app/React dependencies.
function buildReview(tasks) {
  const today = new Date();
  const days = (iso) => iso ? Math.floor((today - new Date(String(iso).replace("Z",""))) / 864e5) : null;
  const active = (t) => t.gtd_status !== "done" && t.gtd_status !== "archived";
  const inbox = tasks.filter(t => t.gtd_status === "inbox");
  const overdue = tasks.filter(t => t.is_overdue && active(t));
  const doneThisWeek = tasks.filter(t => t.gtd_status === "done" && days(t.updated_at) !== null && days(t.updated_at) <= 7);
  const staleNext = tasks.filter(t => t.gtd_status === "next" && days(t.updated_at) !== null && days(t.updated_at) > 7);
  const waiting = tasks.filter(t => t.gtd_status === "waiting");
  const someday = tasks.filter(t => t.gtd_status === "someday");
  const dueNextWeek = tasks.filter(t => active(t) && t.deadline && days(t.deadline) !== null && days(t.deadline) <= 0 && days(t.deadline) >= -7);
  const byProj = {};
  tasks.filter(t => active(t) && t.project).forEach(t => { (byProj[t.project] = byProj[t.project] || []).push(t); });
  const projectsNoNext = Object.entries(byProj)
    .filter(([, ts]) => !ts.some(t => t.gtd_status === "next"))
    .map(([project, ts]) => ({ project, tasks: ts }));
  return { inbox, overdue, doneThisWeek, staleNext, waiting, projectsNoNext, dueNextWeek, someday };
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildReview };
} else {
  try { window.buildReview = buildReview; } catch (e) {}
}
```

- [ ] **Step 4: Load it in `index.html` + add the gate helper**

In `static/index.html`, add a `<script src="/static/review/digest.js"></script>` tag in `<head>` **before** the main app `<script>` (place it next to the other `/static/...` script includes such as the offline modules / config). Then, in the app `<script>` module scope (near other helpers), add:
```javascript
function aiReviewOn() {
  try { return !!window.__AI_ENABLED && localStorage.getItem("tf_ai_review_optin") === "1"; }
  catch (e) { return false; }
}
```
(The app references the global `buildReview` provided by the loaded module.)

- [ ] **Step 5: Precache the module in the SW**

In `static/sw.js`, add `"/static/review/digest.js",` to the `STATIC` array (so the digest works offline on first load). Bump `CACHE` if not already bumped this task chain.

- [ ] **Step 6: Run tests + parse-check**

```bash
node --test tests/buildReview.test.js
node -e 'const fs=require("fs"),b=require("@babel/core");let h=fs.readFileSync("static/index.html","utf8");const i=h.indexOf("ReactDOM.render(");const o=h.lastIndexOf("<script>",i),c=h.indexOf("</script>",i);b.parseSync(h.slice(o+8,c),{presets:[]});console.log("PARSE OK")'
```
Expected: test passes; `PARSE OK`.

- [ ] **Step 7: Commit**

```bash
git add static/review/digest.js static/index.html static/sw.js tests/buildReview.test.js
git commit -m "feat(ai): extracted buildReview() digest module + AI gate helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: `ReviewNudge` on the Dashboard

**Files:**
- Modify: `static/index.html` (define `ReviewNudge`; render it in `Dashboard` next to `BackupReminder`; the Dashboard already receives `onNav`)

**Interfaces:**
- Consumes: `aiReviewOn()`, `buildReview`, `tasks` (Dashboard prop), `localStorage` keys `tf_last_review`, `tf_review_snooze`.
- Produces: `<ReviewNudge tasks={tasks} onStart={fn} />` — renders only when `aiReviewOn()` and (≥7 days since `tf_last_review` and not snoozed today). `onStart` opens the review (Task 8).

- [ ] **Step 1: Define `ReviewNudge`** (model it on the existing `BackupReminder` component, same banner style/safe-area):

```javascript
function ReviewNudge({ tasks, onStart }) {
  const [show, setShow] = React.useState(false);
  React.useEffect(() => {
    if (!aiReviewOn()) return;
    try {
      const today = new Date().toISOString().slice(0,10);
      if (localStorage.getItem("tf_review_snooze") === today) return;
      const last = localStorage.getItem("tf_last_review");
      const due = !last || (Date.now() - new Date(last).getTime()) / 864e5 >= 7;
      if (due) setShow(true);
    } catch (e) {}
  }, []);
  if (!show) return null;
  const r = buildReview(tasks || []);
  const onDismiss = () => { try { localStorage.setItem("tf_review_snooze", new Date().toISOString().slice(0,10)); } catch(e){} setShow(false); };
  return React.createElement("div", {
    style: { display:"flex", alignItems:"center", gap:12, flexWrap:"wrap",
      background:"var(--bg-primary)", border:"1px solid var(--border)",
      borderLeft:"4px solid var(--accent)", borderRadius:10, padding:"12px 14px", marginBottom:16 }
  },
    React.createElement("span", { style:{ color:"var(--accent)", display:"flex" } }, React.createElement(Icon, { name:"list", size:20 })),
    React.createElement("span", { style:{ flex:1, minWidth:180, fontSize:13 } },
      `Saatnya Review Mingguan — ${r.inbox.length} inbox, ${r.overdue.length} overdue`),
    React.createElement("button", { className:"btn btn-primary btn-sm", onClick:onStart }, "Mulai Review"),
    React.createElement("button", { onClick:onDismiss, title:"Ingatkan lagi besok",
      style:{ background:"none", border:"none", cursor:"pointer", color:"var(--text-secondary)", padding:"0 4px" } },
      React.createElement(Icon, { name:"x", size:16 }))
  );
}
```

- [ ] **Step 2: Render it in `Dashboard`** — immediately after the existing `React.createElement(BackupReminder, { showToast })` child, add:
```javascript
, /*#__PURE__*/React.createElement(ReviewNudge, { tasks: tasks, onStart: () => window.dispatchEvent(new CustomEvent("tf-open-review")) })
```
(`Dashboard` already destructures `tasks`. The `tf-open-review` event is handled by `WeeklyReview` in Task 8.)

- [ ] **Step 3: Parse-check** (command from Task 6 Step 5) → `PARSE OK`.

- [ ] **Step 4: Commit**

```bash
git add static/index.html
git commit -m "feat(ai): Dashboard Review nudge (gated)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: `WeeklyReview` full-screen shell + mount + sidebar entry

**Files:**
- Modify: `static/index.html` (define `WeeklyReview`; mount in App root beside `AttachmentViewer`; add sidebar nav entry under GTD)

**Interfaces:**
- Consumes: `aiReviewOn`, `buildReview`, `Icon`, `tasks` (passed via prop or window), the `tf-open-review` event.
- Produces: `<WeeklyReview tasks={tasks} onTaskClick onDone onReschedule showToast />` — full-screen overlay listening for `tf-open-review`, rendering the digest sections; `✕`/Escape closes; "Selesai Review" sets `tf_last_review`.

- [ ] **Step 1: Define `WeeklyReview`** — overlay shell + section renderer. Use the existing fullscreen overlay pattern (the note focus editor at `z-index:10050`-ish) with safe-area padding on the header.

```javascript
function WeeklyReview({ tasks, onTaskClick, showToast }) {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const h = () => setOpen(true);
    window.addEventListener("tf-open-review", h);
    return () => window.removeEventListener("tf-open-review", h);
  }, []);
  React.useEffect(() => {
    if (!open) return;
    const k = (e) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);
  if (!open) return null;
  const r = buildReview(tasks || []);
  const finish = () => { try { localStorage.setItem("tf_last_review", new Date().toISOString()); } catch(e){} setOpen(false); showToast && showToast("Review selesai ✅"); };
  const Section = (title, items, render) => items.length === 0 ? null :
    React.createElement("div", { style:{ marginBottom:18 } },
      React.createElement("div", { className:"notes-section-label" }, `${title} (${items.length})`),
      items.slice(0, 20).map(render));
  const taskRow = (t) => React.createElement("div", {
    key: t.id, className:"task-row", style:{ cursor:"pointer", padding:"7px 0" },
    onClick: () => onTaskClick && onTaskClick(t)
  }, t.title || "(tanpa judul)");
  return React.createElement("div", {
    style:{ position:"fixed", inset:0, zIndex:10060, background:"var(--bg-page)", display:"flex", flexDirection:"column" }
  },
    React.createElement("div", {
      style:{ display:"flex", alignItems:"center", gap:12, flexShrink:0, borderBottom:"1px solid var(--border)",
        padding:"calc(12px + env(safe-area-inset-top,0px)) calc(16px + env(safe-area-inset-right,0px)) 12px calc(16px + env(safe-area-inset-left,0px))" }
    },
      React.createElement("span", { style:{ flex:1, fontSize:18, fontWeight:700, display:"flex", alignItems:"center", gap:9 } },
        React.createElement(Icon, { name:"list", size:20 }), "Review Mingguan"),
      React.createElement("button", { className:"btn btn-primary btn-sm", onClick:finish }, "Selesai Review"),
      React.createElement("button", { onClick:() => setOpen(false), style:{ background:"none", border:"none", cursor:"pointer", display:"flex" } },
        React.createElement(Icon, { name:"x", size:20 }))
    ),
    React.createElement("div", {
      style:{ flex:1, overflow:"auto", padding:"18px calc(20px + env(safe-area-inset-right,0px)) calc(24px + env(safe-area-inset-bottom,0px)) calc(20px + env(safe-area-inset-left,0px))", maxWidth:880, margin:"0 auto", width:"100%" }
    },
      Section("Get Clear · Inbox", r.inbox, taskRow),
      Section("Overdue", r.overdue, taskRow),
      Section("Selesai minggu ini", r.doneThisWeek, taskRow),
      Section("Next Actions mandek", r.staleNext, taskRow),
      Section("Waiting For", r.waiting, taskRow),
      Section("Jatuh tempo minggu depan", r.dueNextWeek, taskRow),
      Section("Someday / Maybe", r.someday, taskRow),
      r.projectsNoNext.length > 0 && React.createElement("div", { style:{ marginBottom:18 } },
        React.createElement("div", { className:"notes-section-label" }, `Project tanpa next-action (${r.projectsNoNext.length})`),
        r.projectsNoNext.map(p => React.createElement("div", { key:p.project, className:"task-row", style:{ padding:"7px 0" } },
          `⚠ ${p.project}`)))
      // AI panel is added in Task 9.
    )
  );
}
```

- [ ] **Step 2: Mount in App root** — beside the existing `React.createElement(AttachmentViewer, null)` mount, add (only when gated):
```javascript
, aiReviewOn() && /*#__PURE__*/React.createElement(WeeklyReview, { tasks: tasks, onTaskClick: setSelectedTask, showToast: showToast })
```
(`App` already has `tasks`, `setSelectedTask`, `showToast` in scope.)

- [ ] **Step 3: Add the sidebar entry** — in the `links` array in `Sidebar`, inside the GTD section block, add (gated):
```javascript
... (in the GTD group, after the "someday" entry)
```
Insert a conditional push after the static GTD links are built:
```javascript
if (aiReviewOn()) links.splice(links.findIndex(l => l.id === "someday") + 1, 0, { id: "__review", icon: "list", label: "Review Mingguan" });
```
And in the click handler (`onClick: () => { setPage(l.id); ... }`), special-case it:
```javascript
onClick: () => { if (l.id === "__review") { window.dispatchEvent(new CustomEvent("tf-open-review")); onClose?.(); return; } setPage(l.id); onClose?.(); }
```

- [ ] **Step 4: Parse-check** (Task 6 Step 5 command) → `PARSE OK`.

- [ ] **Step 5: Commit**

```bash
git add static/index.html
git commit -m "feat(ai): WeeklyReview overlay + sidebar entry + mount (gated)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Inline actions + AI panel (suggestions & next-action suggester)

**Files:**
- Modify: `static/index.html` (extend `WeeklyReview`: add AI fetch + render `summary`, `focus_suggestions`, `stalled_projects` with one-tap actions)

**Interfaces:**
- Consumes: `api` (the app's fetch wrapper with token), `apiUrl`, `__token`, existing task mutation handlers passed as props: add `onAddFocus(taskId)`, `onCreateTask({title, project})` to the `WeeklyReview` prop list and wire them from App (reuse the App's existing task create / focus toggle).
- Produces: AI panel inside the review; "Tambah ke Fokus" sets `is_focused`; "Buat" creates a `next` task in the named project.

- [ ] **Step 1: Add App-side handlers passed to WeeklyReview**

In `App`, define (reuse existing endpoints used by the task form / focus toggle):
```javascript
const handleReviewCreate = ({ title, project }) =>
  api.post("/api/tasks", { title, gtd_status: "next", project: project || "", priority: "P3" })
     .then(() => { window.__refreshTasks && window.__refreshTasks(); showToast("Task dibuat ✅"); })
     .catch(() => showToast("Gagal membuat task", "error"));
const handleReviewFocus = (taskId) =>
  api.put(`/api/tasks/${taskId}`, { is_focused: true })
     .then(() => { window.__refreshTasks && window.__refreshTasks(); showToast("Ditambahkan ke Fokus ⭐"); })
     .catch(() => showToast("Gagal", "error"));
```
Pass them: extend the WeeklyReview mount (Task 8 Step 2) with `onCreateTask: handleReviewCreate, onAddFocus: handleReviewFocus`.
(Verify the exact task-update endpoint/shape against `create_task`/the update route in `webapp.py`; adjust `is_focused` payload to match the existing focus-toggle call used by `handleToggleFocus` in App.)

- [ ] **Step 2: Add AI state + fetch to WeeklyReview**

Inside `WeeklyReview`, add:
```javascript
const [ai, setAi] = React.useState(null);     // result or null
const [aiBusy, setAiBusy] = React.useState(false);
const [aiErr, setAiErr] = React.useState("");
const runAI = async () => {
  setAiBusy(true); setAiErr("");
  try {
    const data = await api.post("/api/ai/review", {});
    setAi(data);
  } catch (e) {
    setAiErr(navigator.onLine ? "Gagal membuat ringkasan AI" : "Perlu online untuk ringkasan AI");
  } finally { setAiBusy(false); }
};
```
(`api.post` already attaches the bearer token and prepends `API_BASE`. A failure here must not affect anything else — it only sets `aiErr`.)

- [ ] **Step 3: Render the AI panel** at the top of the scroll body (before the Sections):

```javascript
React.createElement("div", { style:{ marginBottom:20, padding:14, border:"1px solid var(--border)", borderRadius:12, background:"var(--bg-card)" } },
  React.createElement("div", { style:{ display:"flex", alignItems:"center", gap:8, marginBottom:8 } },
    React.createElement("span", { style:{ color:"var(--accent)", display:"flex" } }, React.createElement(Icon, { name:"sparkles", size:16 })),
    React.createElement("span", { style:{ fontWeight:700, flex:1 } }, "Ringkasan AI"),
    !ai && React.createElement("button", { className:"btn btn-secondary btn-sm", onClick:runAI, disabled:aiBusy },
      aiBusy ? "Membuat…" : "Buat ringkasan AI")),
  aiErr && React.createElement("div", { style:{ fontSize:13, color:"var(--text-secondary)" } }, aiErr),
  ai && React.createElement("div", { style:{ fontSize:14, lineHeight:1.6, marginBottom:10 } }, ai.summary),
  ai && ai.focus_suggestions && ai.focus_suggestions.length > 0 && React.createElement("div", null,
    React.createElement("div", { className:"notes-section-label" }, "Fokus minggu depan"),
    ai.focus_suggestions
      .filter(s => (tasks || []).some(t => String(t.id) === String(s.task_id)))   // drop unknown ids
      .map(s => React.createElement("div", { key:s.task_id, style:{ display:"flex", alignItems:"center", gap:8, padding:"4px 0" } },
        React.createElement("span", { style:{ flex:1, fontSize:13 } }, ((tasks||[]).find(t => String(t.id)===String(s.task_id))||{}).title || s.task_id),
        React.createElement("button", { className:"btn btn-secondary btn-sm", onClick:() => onAddFocus(s.task_id) }, "⭐ Fokus")))),
  ai && ai.stalled_projects && ai.stalled_projects.map(p => React.createElement("div", { key:p.project, style:{ marginTop:10 } },
    React.createElement("div", { className:"notes-section-label" }, `Next-action: ${p.project}`),
    p.next_actions.map((na, i) => React.createElement("div", { key:i, style:{ display:"flex", alignItems:"center", gap:8, padding:"4px 0" } },
      React.createElement("span", { style:{ flex:1, fontSize:13 } }, na.title),
      React.createElement("button", { className:"btn btn-primary btn-sm", onClick:() => onCreateTask({ title: na.title, project: p.project }) }, "Buat"))))),
  ai && ai.reflective_questions && ai.reflective_questions.map((q, i) =>
    React.createElement("div", { key:i, style:{ marginTop:8, fontSize:13, fontStyle:"italic", color:"var(--text-secondary)" } }, "❓ " + q))
)
```

- [ ] **Step 4: Add `onCreateTask, onAddFocus` to the `WeeklyReview` destructure** (Task 8 Step 1 signature).

- [ ] **Step 5: Parse-check** (Task 6 Step 5 command) → `PARSE OK`.

- [ ] **Step 6: Commit**

```bash
git add static/index.html
git commit -m "feat(ai): review AI panel — focus + next-action suggestions with one-tap

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 10: Settings opt-in toggle + cadence wiring

**Files:**
- Modify: `static/index.html` (Settings page: add the opt-in toggle, gated by `window.__AI_ENABLED`)

**Interfaces:**
- Produces: a Settings control that sets/clears `localStorage['tf_ai_review_optin']`. When `window.__AI_ENABLED` is false the control is hidden entirely.

- [ ] **Step 1: Add the toggle** — in the Settings page render (the component that renders "Backup & Export"), add a gated section:

```javascript
window.__AI_ENABLED && /*#__PURE__*/React.createElement("div", { style:{ marginTop:28, paddingTop:24, borderTop:"1px solid var(--border)" } },
  React.createElement("h3", { style:{ fontSize:14, fontWeight:700, marginBottom:8 } }, "Asisten AI (Weekly Review)"),
  React.createElement("p", { style:{ fontSize:13, color:"var(--text-secondary)", marginBottom:12 } },
    "AI hanya membaca tugasmu (judul, deskripsi, deadline, prioritas). Catatan tidak pernah dikirim."),
  React.createElement("label", { style:{ display:"flex", alignItems:"center", gap:10, cursor:"pointer" } },
    React.createElement("input", { type:"checkbox",
      defaultChecked: localStorage.getItem("tf_ai_review_optin") === "1",
      onChange: (e) => { localStorage.setItem("tf_ai_review_optin", e.target.checked ? "1" : "0"); showToast("Tersimpan — muat ulang untuk menerapkan"); } }),
    React.createElement("span", { style:{ fontSize:13 } }, "Aktifkan Weekly Review berbantuan AI")))
```
(Use the `showToast` already available in the Settings component; the copy is verbatim from Global Constraints.)

- [ ] **Step 2: Parse-check** (Task 6 Step 5 command) → `PARSE OK`.

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "feat(ai): Settings opt-in toggle for Weekly Review (gated)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 11: End-to-end verification + privacy/rollback check

**Files:** none (verification only)

- [ ] **Step 1: Flag-off behaves like today**

With `AI_FEATURES_ENABLED=false`: load the app; confirm no Review nudge, no sidebar "Review Mingguan", no Settings AI section; `POST /api/ai/review` → 404. Confirm the rest of the app is unchanged.

- [ ] **Step 2: Flag-on + opt-in happy path**

Set `AI_FEATURES_ENABLED=true` + valid `ANTHROPIC_API_KEY`; opt in via Settings; reload. Open review via nudge/sidebar; sections render offline-capable; press "Buat ringkasan AI" → summary + suggestions; "⭐ Fokus" and "Buat" mutate tasks; "Selesai Review" sets `tf_last_review` and the nudge stops for 7 days.

- [ ] **Step 3: Offline degradation**

Go offline; open review → digest renders; "Buat ringkasan AI" shows "Perlu online…"; no errors, token not cleared, app still works.

- [ ] **Step 4: Privacy spot-check**

In DevTools Network, trigger the review and inspect the `POST /api/ai/review` — request body is empty (server reads DB); confirm no note text anywhere. Re-run `python -m pytest tests/test_ai_review.py -v` (privacy/import tests pass).

- [ ] **Step 5: Rollback rehearsal (soft)**

Set `AI_FEATURES_ENABLED=false`, reload → feature gone, app identical to baseline. Document this in the PR description.

- [ ] **Step 6: Final commit / PR**

```bash
git add -A
git commit -m "test(ai): weekly review E2E + privacy verification notes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** §2 constraints → Tasks 1/3/5/9 (flag, tasks-only query, SW bypass, no-lockout fetch). §3 flag/rollback → Tasks 1, 10, 11. §5 digest → Task 6. §6 GUI → Tasks 7, 8. §7 AI/privacy → Tasks 2, 3. §8 inline actions → Task 9. §9 offline → Tasks 5, 9. §10 cadence → Task 7. §13 rollback → Task 11. §14 testing → Tasks 2, 6, 11. §15 decisions (off-by-default, defer history, title+description) → Tasks 1, 2 (description in WHITELIST), history intentionally omitted.

**Placeholder scan:** the two spots that require local confirmation against existing code are explicitly flagged inline (the focus-toggle payload shape in Task 9 Step 1, and the Settings render insertion point in Task 10) — both name the exact existing reference to mirror (`handleToggleFocus`, the "Backup & Export" block), which is not a placeholder but a "match the existing pattern" instruction inherent to editing a large hand-written file.

**Type consistency:** `buildReview` keys (`inbox, overdue, doneThisWeek, staleNext, waiting, projectsNoNext, dueNextWeek, someday`) are identical in Tasks 6/8/9. `REVIEW_SCHEMA` keys (`summary, focus_suggestions[{task_id,reason}], stalled_projects[{project,next_actions[{title,rationale}]}], reflective_questions`) match the Task 9 render. `aiReviewOn()` used consistently in Tasks 6–10. The `tf-open-review` event name matches in Tasks 7/8.
