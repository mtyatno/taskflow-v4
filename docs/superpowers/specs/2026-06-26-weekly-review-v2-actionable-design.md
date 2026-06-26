# Weekly Review v2 — "Actionable" Redesign (Design)

**Date:** 2026-06-26
**Status:** Approved (design), pending implementation plan
**Builds on / supersedes parts of:** [[project-weekly-review-ai]]. Package A (LIVE 2026-06-25, SW v176) shipped `signals` + 1-tap row actions + sharper prompt. This redesign **keeps** `signals` and the 1-tap action handlers, but **reshapes the AI output** and **rebuilds the review UI** around a single prioritized action queue. Package B (history snapshots: trend/wins/streak) remains a separate later spec.

## Goal

Turn the Weekly Review from a stack of read-only sections into an **actionable, holistic-at-a-glance** view: a thin condition signal on top + a single prioritized action queue as the hero, where each row carries a context-aware action and the AI only *details* (a one-line verdict + per-item annotations). Explicitly **not** a busy dashboard.

## Constraints & decisions (from brainstorming)

- **Desktop-only** — the review is available on Tauri desktop (.exe) and PWA (desktop) only. No mobile layout; do not design mobile reflow. (The nudge/entry may still be gated as today, but the overlay targets desktop widths.)
- **Hierarchy:** primary = action queue ("what should I do now?"); secondary = a light condition signal ("am I okay or drowning?").
- **Ordering is local & deterministic** (predictable, free-tier-safe). AI annotates; AI does **not** order.
- **Pure triage:** no closing "commitment / ONE THING" step. Finish = "Selesai Review".
- **Read-only sections removed** from the review (Selesai minggu ini, Someday, Jatuh tempo minggu depan, Project tanpa next-action). Those data live on their own pages in the app.
- **Tasks-only privacy** unchanged: `ai_review.py` never reads notes/scratchpad; only whitelisted task fields + aggregate `signals` leave the server.
- **Review must remain functional without AI:** if AI is disabled or fails, the condition strip (Health Score + local counts) and the full action queue still work — only the AI verdict and per-item annotations are absent.

## A. Layout (single focused column, anti-dashboard)

Full-screen overlay, one centered column (max ~880px). Top to bottom:

1. **Condition strip (thin):** Health Score ring (0–100) + label (Tenang / Waspada / Genting) on the left; the AI one-line verdict on the right; 2–3 small key counts (Overdue, P1 overdue, Mandek).
2. **Action Queue (hero):** one prioritized list. Each row: priority dot + title + meta line (deadline label / project / age) + context-aware primary action button + Open + Complete. Top ~5 rows show an AI annotation line beneath the title when available.
3. **Footer:** "Selesai Review" button (sets `tf_last_review`, closes). No commitment step.

## B. Action Queue — local ordering, AI annotation

### Local construction (pure, in `static/review/digest.js`)

New pure function `buildActionQueue(tasks)` returns an ordered, de-duplicated array of queue items. Each item: `{ task, type, primaryAction }` where `type` ∈ `overdue | due_soon | priority | inbox | stalled_project`.

Ordering (each task appears once, first matching bucket wins for `type`, but ordering is by bucket then within-bucket):
1. `overdue` — `is_overdue && active`, sorted by **oldest deadline first**.
2. `due_soon` — active, deadline within next 7 days (not overdue), sorted by nearest deadline.
3. `priority` — active `P1` or `quadrant === "Q1"`, not already included.
4. `inbox` — `gtd_status === "inbox"`.
5. `stalled_project` — one item per active project that has tasks but none with `gtd_status === "next"` (carries the project name, not a task).

Cap the rendered list at 15; show "+N lainnya" expander for the rest (reuse the existing Section expand pattern).

`active(t)` = `gtd_status` not in `{done, archived}` (matches existing `digest.js`).

### Context-aware primary action per type

| type | primary action | operation (reuse existing APIs) |
|---|---|---|
| overdue | **Tunda 1mg** | `PUT {deadline: plusDaysISO(7)}` (Package A `handleReviewReschedule`) |
| due_soon | **Fokus** | `POST /api/tasks/{id}/focus` (Package A `handleReviewFocus`) |
| priority | **Fokus** | same |
| inbox | **Jadikan Next** | `PUT {gtd_status:"next"}` (Package A `handleReviewClarifyNext`) |
| stalled_project | **Buat next-action** | `POST /api/tasks {title, gtd_status:"next", project, priority:"P3"}` via the existing `handleReviewCreate({title, project})` (project-based, not the task-based `handleReviewFollowUp`); title from the AI annotation if present, else a default `"Next action: <project>"` |
| P1 with no deadline (subset of `priority`) | **Set deadline** | `PUT {deadline: plusDaysISO(7)}` (NEW handler `handleReviewSetDeadline`; undo restores null→ but PUT ignores null; see note) |

Every row also has **Buka** (open task modal, existing `onTaskClick`) and **Selesai** (mark done: `PUT {gtd_status:"done"}`, NEW handler `handleReviewComplete`, undo restores prior `gtd_status`).

All mutating actions use the Package A undo-toast pattern (`showToast(msg, "success", {label:"Undo", onClick})`) and `window.__refreshTasks()`; error paths show an error toast and do not refresh.

**Note on Set-deadline undo:** since `PUT /api/tasks/{id}` ignores a null `deadline` (webapp.py), the undo for Set-deadline (original deadline was null) cannot clear it back to null. Acceptable: Set-deadline's undo is best-effort; document the limitation in the handler. (Snooze undo is unaffected — overdue rows always have a real deadline.)

### AI annotation

For the top ~5 queue items, AI returns a one-line note ("why this / what to do"). Rendered under the title in muted italic. Items beyond the annotated set, and all items when AI is off/failed, simply show no annotation line.

## C. AI reshape + Health Score

### Health Score (local, from `signals`, pure)

New pure function `computeHealthScore(signals, counts)` in `digest.js`:

```
score = 100
active = max(1, counts.total - counts done/archived)  // use counts available; see plan
score -= min(40, round(40 * counts.overdue / active))
score -= min(24, 8 * signals.p1_overdue)
score -= min(18, 6 * signals.projects_without_next)
score -= min(10, 2 * staleNext_count)   // staleNext from buildReview(tasks).staleNext.length
score = clamp(0, 100)
```

Band: `>=80` green/"Tenang", `50–79` amber/"Waspada", `<50` red/"Genting". (Exact penalty weights finalized in the plan; the function is unit-tested with representative inputs.)

### AI output reshape (`ai_review.py`)

Replace the current `REVIEW_SCHEMA` / prompt output with:

```json
{ "verdict": "string (1 sentence, Bahasa Indonesia)",
  "annotations": [ { "task_id": "string", "note": "string" } ] }
```

- `verdict`: one-sentence condition summary; must explicitly flag P1/Q1 overdue pileups when `signals` indicate them (carry over the Package A prompt intent).
- `annotations`: up to ~5 entries, each keyed to a `task_id` from the provided list (no invented ids), each a short "why focus / what to do".
- Remove `focus_suggestions`, `stalled_projects`, `reflective_questions` from the schema and prompt — the action queue + annotations replace them.
- `build_payload` is unchanged except it should also pass the candidate top-queue task ids (or the model can pick from the full list); keep it simple — send the existing whitelisted tasks + `signals`; the prompt asks the model to annotate the most action-worthy ids. (The frontend matches `annotations` to queue rows by `task_id`.)
- `parse_review_content` (defensive parser, Package A `c87aa27`) is reused; update only the expected shape it returns (it just `json.loads` — no shape change needed in the parser itself).
- Backward behavior of the route `POST /api/ai/review` is unchanged (still 503 on `AIReviewError`); the frontend handles the new shape and degrades gracefully when `ai` is null.

## D. Architecture / file structure

- `static/review/digest.js` (pure, node-tested): add `buildActionQueue(tasks)`, `computeHealthScore(signals, counts)`; keep `buildReview`, `plusDaysISO`. (`buildReview` may still be used to derive counts/signals client-side, or compute counts inline — decided in plan.)
- `ai_review.py`: new `REVIEW_SCHEMA` + `REVIEW_SYSTEM_PROMPT` (verdict + annotations); `build_payload`/`signals` reused.
- `static/index.html`: rebuild the `WeeklyReview` component (condition strip + action queue + row actions); add `handleReviewSetDeadline` and `handleReviewComplete` App handlers; reuse Package A handlers; remove the read-only `Section(...)` calls and the old AI-panel rendering.
- `static/sw.js`: cache version bump.
- Tests: `tests/buildReview.test.js` (node) for `buildActionQueue` ordering/dedup/cap and `computeHealthScore` bands; `tests/test_ai_review.py` (pytest) for the new schema shape + prompt assertions + privacy.

## Testing

- **Node:** `buildActionQueue` — correct bucket order, dedup (a task that is both overdue and P1 appears once as `overdue`), cap at 15, stalled_project items emitted per project; `computeHealthScore` — 100 on a clean set, lower with overdue/P1/stalled, clamped to [0,100], correct bands.
- **Pytest:** `build_payload`/`signals` unchanged tests still pass; new prompt mentions verdict/annotations + quadrant/P1-overdue; schema has exactly `verdict` + `annotations`; privacy leak test holds.
- **Manual (desktop):** open review with overdue/inbox/waiting/stalled data; verify queue order, each context-aware action + undo, Open, Complete; Health Score ring + band; AI verdict + annotations present when AI on, and the whole view still works with AI off/failed.
- **Release:** SW cache bump; verify live SW version post-deploy.

## Out of scope (Package B — later spec)

Health Score **trend** vs last week, wins/streak, "Recovery Week", week-over-week progress — all require history snapshots.

## Reversibility

Additive + a UI swap. Soft rollback: AI flag off hides verdict/annotations (queue + score remain). Hard: revert the redesign commits; Package A behavior (signals, 1-tap handlers) is independent and stays.
