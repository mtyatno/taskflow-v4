# Weekly Review (AI) — Design Spec

**Date:** 2026-06-24
**Status:** Draft for review
**Scope:** A GTD-style **Weekly Review** feature with a thin AI layer. Tasks-only
(never touches notes). Built so it can be **fully disabled or cleanly reverted**
back to the current app with no residue.

---

## 1. Goal

Give the user a focused weekly "sit-down" that surfaces the state of their tasks
(GTD: Get Clear → Get Current → Get Creative), lets them **act on it inline**
(process inbox, reschedule, add next-actions, set focus), and adds a thin AI layer
for synthesis + recommendations. Most of the value is computed **locally**; AI is
an enhancement, never on the critical path.

---

## 2. Guiding constraints (non-negotiable)

1. **Reversibility / kill-switch (top priority).** The user may decide they don't
   want this. Two independent ways back to today's app:
   - **Runtime kill-switch:** one flag off → no nudge, no sidebar entry, no
     endpoint, no AI calls. App behaves exactly as now.
   - **Clean `git revert`:** the feature is purely additive — new isolated files
     plus a handful of clearly-marked, guarded insertions. Reverting the feature
     commits restores the current app byte-for-byte. See §13.
2. **Privacy — tasks-only.** The AI layer only ever receives whitelisted **task**
   fields. The notes table is never read in this codepath. Enforced
   architecturally (§7), not by convention.
3. **Offline-first.** All factual sections compute locally from IndexedDB and work
   fully offline. The AI layer is online best-effort; failure degrades silently and
   never disrupts the offline-first core or the auth no-lockout invariant
   (`[[project_auth_no_lockout]]`).
4. **Non-blocking.** The review is never a forced gate. Dismissible anytime.
5. **Cost-bounded.** AI is called on explicit user action (open review / press
   "Generate"), at most ~once per weekly session — not on a timer or per render.

---

## 3. Feature flag & rollback design

**Single source of truth — a build/runtime flag exposed to the client.**

- Backend: `AI_FEATURES_ENABLED` in `.env` (default `false`). Surfaced to the
  client via the existing `/config.js` mechanism as `window.__AI_ENABLED`
  (same channel that already injects `__API_BASE`). No hardcoding.
- Per-user opt-in: a Settings toggle "Asisten AI (Weekly Review)" stored in
  `localStorage` (`tf_ai_review_optin`, default off). The feature shows only when
  **both** the server flag is on **and** the user has opted in.
- Frontend gate helper: `const AI_REVIEW_ON = !!window.__AI_ENABLED && localStorage.getItem('tf_ai_review_optin') === '1';`
  Every new UI entry point is wrapped in `AI_REVIEW_ON &&` so flipping it off
  removes the feature entirely.

**Effect of disabling (flag off or opt-out):** Dashboard nudge hidden, sidebar
entry hidden, Review page route inert, no `/api/ai/*` calls. The local review
computation is never even constructed. Identical to today.

---

## 4. Architecture overview

```
Frontend (static/index.html)                Backend (FastAPI)
┌──────────────────────────────┐            ┌───────────────────────────┐
│ WeeklyReview (new component)  │            │ ai_review.py (new router) │
│  ├ buildReview(tasks) [local] │            │  POST /api/ai/review      │
│  │   → digest sections        │            │   - reads tasks only      │
│  ├ inline actions (reuse      │  fetch     │   - Anthropic SDK call    │
│  │   existing task handlers)  │ ─────────▶ │   - returns JSON synthesis│
│  └ AI panel (online, opt)     │  (token)   │   + next-action proposals │
│ ReviewNudge (Dashboard)       │            └───────────────────────────┘
│ Sidebar entry (GTD section)   │
└──────────────────────────────┘
```

- **Local-first computation** (`buildReview`) lives in a self-contained module/
  function; it reads the same task list the app already has in memory / IndexedDB.
- **AI** is a separate, optional fetch to a new backend route. The route is the
  *only* place the server key is used.

---

## 5. The review digest (computed locally, offline-capable)

Sections mirror GTD. All counts/lists are pure functions of the task array — no AI,
no network.

**Get Clear**

- Inbox: tasks with `gtd_status === "inbox"` (count + list). Action: process.

**Get Current**

- Overdue: `is_overdue` / `deadline < today` and not done/archived.
- Completed this week: done within last 7 days (a "win" — positive reinforcement).
- Stale Next Actions: `gtd_status === "next"` not updated in > 7 days.
- Waiting For: `gtd_status === "waiting"`, oldest first.
- **Projects without a next-action:** group active tasks by `project`; flag any
  project that has tasks but none with `gtd_status === "next"` and not done.
- Due next week: deadline within the coming 7 days.

**Get Creative**

- Someday/Maybe: `gtd_status === "someday"` (count + sample).

The digest object is a plain JS structure; rendering is deterministic. Offline this
is the complete experience minus the AI panel.

---

## 6. GUI placement & layout

**Pattern: nudge → full-screen Review mode → sidebar entry** (decided in
brainstorming).

- **Dashboard nudge** (reuses the existing backup-reminder banner pattern):
  shows when due — Sunday/Monday or ≥ 7 days since `tf_last_review` — dismissible.
  Lives behind `AI_REVIEW_ON` (the *factual* review could exist without AI, but to
  keep rollback trivial the whole feature is behind one flag).
  
  > `📋 Saatnya Review Mingguan — 4 inbox, 5 overdue` `[Mulai Review]` `✕`

- **Review mode:** a full-screen overlay (same pattern/z-index as the existing
  note focus editor) — not a cramped modal. Desktop: multi-column sections;
  mobile: single scroll column with a sticky header (Close ✕) and sticky primary
  action, both respecting `env(safe-area-inset-*)` (lesson from prior nav-bar bugs).

- **Sidebar entry** under the GTD section: "Review Mingguan" for on-demand access +
  future review history.

Close anytime (✕ / Escape). Non-blocking.

---

## 7. AI layer — endpoint, model, privacy

**New backend route `POST /api/ai/review`** (in a new `ai_review.py`):

- **Auth:** same bearer/session auth as other endpoints.
- **Reads tasks only.** The handler imports only the task accessor/query layer.
  It must not import the scratchpad/notes layer. (Mirrors the existing
  `taskrepo`/`noterepo` separation; a notes import in this module is a review-time
  reject.)
- **Whitelist sent to the model** (per task): `id, title, gtd_status, quadrant,
  priority, deadline, project, age_days, is_overdue`. No description by default
  (can be added later if needed); **no note content, ever**. The bulk is sent as
  aggregates; only candidate task titles go in full.
- **Model:** `claude-opus-4-8` (weekly, low-volume, needs real reasoning), adaptive
  thinking, `output_config.format` json_schema for a reliable structured result,
  `max_tokens: 4096` (non-streaming is safe at this size). Keep the static
  system/rubric block first and per-request task data after it; optionally mark the
  system block with `cache_control` (only caches if it clears Opus 4.8's ~4096-token
  minimum — minor for a weekly, low-volume call, so not load-bearing).

**Anthropic SDK call (Python, server-side):**

```python
import anthropic
client = anthropic.Anthropic()  # ANTHROPIC_API_KEY from .env, never hardcoded

resp = client.messages.create(
    model="claude-opus-4-8",
    max_tokens=4096,
    thinking={"type": "adaptive"},
    system=[{"type": "text", "text": REVIEW_SYSTEM_PROMPT,
             "cache_control": {"type": "ephemeral"}}],
    output_config={"format": {"type": "json_schema", "schema": REVIEW_SCHEMA}},
    messages=[{"role": "user", "content": task_summary_json}],
)
```

**Output schema (REVIEW_SCHEMA, `additionalProperties:false`):**

```json
{
  "summary": "string (1–3 sentence insight, Bahasa Indonesia)",
  "focus_suggestions": [{"task_id": "string", "reason": "string"}],
  "stalled_projects": [{
    "project": "string",
    "next_actions": [{"title": "string", "rationale": "string"}]
  }],
  "reflective_questions": ["string"]
}
```

- `focus_suggestions` → "Fokus minggu depan" (one-tap → set `is_focused`).
- `stalled_projects[].next_actions` → the **next-action suggester**: each title is a
  concrete, physical next-action (GTD style) the user creates with one tap
  ("Buat"), or edits, or ignores. AI only proposes; nothing is auto-created.
- `reflective_questions` → 1–2 targeted prompts whose quick-input becomes a task.

The system prompt enforces: actionable next-actions (verb-first), Bahasa Indonesia,
no hallucinated task IDs (must come from the provided set), concise.

---

## 8. Inline actions (workspace, not report)

The live review is interactive; every surfaced item has an inline resolution that
**reuses existing task handlers** (no new backend mutations):

- Inbox item → set GTD status / priority / quadrant / deadline / done / delete.
- Overdue / stale → reschedule, done, demote.
- Waiting For → mark followed-up / done.
- Project without next-action → quick-add or accept an AI suggestion → creates a
  `next` task in that project.
- Due next week / focus suggestions → "Tambah ke Fokus" (`is_focused`).
- Someday → activate / archive.

All mutations go through the existing offline-first path (work offline, queue sync).
A progress affordance updates as items are resolved (e.g. Inbox 4→0). "Selesai
Review" sets `tf_last_review` and (optionally, later) saves a read-only snapshot to
history.

The **AI narrative summary** and any **saved past reviews** are read-only; the live
review is the only interactive surface.

---

## 9. Offline-first behavior

- Digest (all sections, counts, lists, "project without next-action") = **local**,
  works fully offline.
- AI panel = online best-effort. Offline / failure / timeout → digest renders
  without the narrative; show a "✦ Buat ringkasan AI" button enabled when online.
- AI fetch must **not** route through the local `taskroutes` interceptor (no offline
  equivalent) — it hits the network and fails cleanly via the existing
  `isOfflineErr` handling. Never queued in the mutation outbox.
- **Service Worker:** `/api/ai/*` is network-only (add a bypass in `sw.js`) so no
  stale AI responses are served from cache.
- A failed AI call never deletes the token or disrupts offline mode (honors
  `[[project_auth_no_lockout]]`).
- Suggestion results cached client-side keyed by a hash of the task summary so
  re-opening the review doesn't re-call.

---

## 10. Cadence / nudge

- `tf_last_review` in localStorage. Nudge when ≥ 7 days since last review (and not
  snoozed today), same mechanism as the backup reminder.
- Manual entry always available via the sidebar.
- Not forced; dismiss = snooze 1 day.

---

## 11. Non-goals (this spec)

- Smart Triage on capture (separate, later spec — shares the `/api/ai/*` +
  SW-bypass + task-selector foundation).
- Sending notes to AI (explicitly excluded).
- On-device / zero-cloud model.
- Review history persistence beyond an optional local snapshot (can follow later).
- Semantic search / embeddings.

---

## 12. Edge cases

- No tasks / brand-new user → digest shows empty states; no AI call needed.
- Offline at first-ever open → digest only; AI button waits for connectivity.
- AI returns a task_id not in the set → client ignores that suggestion (defensive).
- Large task counts → send aggregates + cap candidate lists (e.g. top N) to bound
  tokens/cost.
- `stop_reason == "refusal"` or API error → treat as "AI unavailable", show digest
  only; never surface a crash.

---

## 13. Rollback / removal plan (explicit)

**Touch-points (kept minimal and marked with a `// [ai-review]` comment):**

- New files: `ai_review.py` (backend router), and a self-contained
  `WeeklyReview` + `ReviewNudge` block in `static/index.html`.
- Guarded insertions (all wrapped in `AI_REVIEW_ON &&` or behind the server flag):
  1. Sidebar: one nav entry under GTD.
  2. Dashboard: render `<ReviewNudge>`.
  3. App root: mount `<WeeklyReview>` (like the existing AttachmentViewer mount).
  4. Settings: one opt-in toggle.
  5. `sw.js`: one network-only bypass line for `/api/ai/*`.
  6. Backend app: mount the `ai_review` router; read `AI_FEATURES_ENABLED`.

**Two rollback paths:**

- **Soft:** set `AI_FEATURES_ENABLED=false` (and/or user opt-out). Feature vanishes;
  zero behavioral change elsewhere. No deploy of code needed beyond env.
- **Hard:** `git revert` the feature commits. Because every insertion is additive
  and flag-guarded, revert restores the current app exactly. The SW bump on revert
  re-caches the prior bundle.

**Dependency:** adds `anthropic` to backend `requirements`. Revert removes it; or
leave it installed (harmless) if only soft-disabling.

---

## 14. Testing

- **Local digest:** unit-test `buildReview()` against fixture task sets (inbox
  counts, overdue, stale > 7d, project-without-next-action detection, someday).
  Mirrors the existing Node `--test` approach; deterministic, no network.
- **Privacy guard:** a test/assert that the `ai_review` module does not import the
  notes layer, and that the payload builder emits only whitelisted keys.
- **Offline:** simulate `isOfflineErr` → digest renders, AI button disabled.
- **Flag off:** with `AI_REVIEW_ON` false, none of the entry points render and no
  `/api/ai/*` request is made.
- **Schema:** validate a sample model response against `REVIEW_SCHEMA`; ensure
  unknown `task_id`s are dropped.

---

## 15. Open questions for the user

1. Server flag default — ship **off** (opt-in only) until you've tried it? (Recommended.)
2. Save a **local snapshot** of each completed review for history now, or defer?
3. Include task **description** in the AI payload, or strictly title-only for max privacy? (Default: title-only.)
