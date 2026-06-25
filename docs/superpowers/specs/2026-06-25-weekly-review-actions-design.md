# Weekly Review — Package A: Actionable + Sharper AI (Design)

**Date:** 2026-06-25
**Status:** Approved (design), pending implementation plan
**Builds on:** [[project-weekly-review-ai]] — Weekly Review (AI), LIVE 2026-06-25 (SW v174). This is the first enhancement slice ("Package A"). Package B (history snapshots for week-over-week / streaks) is a separate later spec.

## Goal

Make the Weekly Review **actionable** (1-tap row actions instead of read-only lists) and make the AI summary **sharper** (quadrant- and deadline-aware, flags P1/Q1 overdue pileups) — **without any DB migration**. Reuse existing task APIs. Stays tasks-only (privacy boundary unchanged).

## Non-goals (explicitly deferred)

- Week-over-week progress, review streaks, history snapshots → Package B (separate spec).
- "Archive stale someday" 1-tap action → dropped from this slice (user decision).
- New backend endpoints — all mutations reuse existing `PUT /api/tasks/{id}` (partial update) and `POST /api/tasks`.

## Current state (what already exists)

- `WeeklyReview` component (`static/index.html:20902`): full-screen overlay, stat strip, AI panel (summary + `focus_suggestions` with ⭐Fokus + `stalled_projects` next-actions with "Buat" + `reflective_questions` with ❓ — **already rendered**), and read-only sections (Inbox, Overdue, Selesai minggu ini, Next Actions mandek, Waiting For, Jatuh tempo minggu depan, Someday/Maybe, Project tanpa next-action).
- `taskRow` (`static/index.html:20942`): shared row renderer; already carries an optional ⭐Fokus button via `onAddFocus`.
- Mutation patterns: `api.put('/api/tasks/{id}', { field: value })` (partial update, see `:9672`), `api.post('/api/tasks', {...})` (see `handleReviewCreate :21938`), refresh via `window.__refreshTasks()`.
- `showToast(message, type)` (`:21320`) + `Toast` component (`:1727`): auto-closes 3s, **no action button**.
- AI layer `ai_review.py`: `build_payload` (whitelist + counts), `REVIEW_SYSTEM_PROMPT`, `parse_review_content` (defensive, shipped `c87aa27`).

## Part 1 — 1-tap row actions (frontend)

Parametrize `taskRow` to accept an optional per-section action button (alongside the existing ⭐Fokus). Three section-specific actions:

| Section | Button | Operation |
|---|---|---|
| Overdue | "Tunda 1mg" | `PUT /api/tasks/{id}` `{ deadline: <today + 7 days, YYYY-MM-DD> }` |
| Inbox | "Jadikan Next" | `PUT /api/tasks/{id}` `{ gtd_status: "next" }` |
| Waiting For | "Tindak lanjut" | `POST /api/tasks` `{ title: "Tindak lanjut: " + t.title, gtd_status: "next", project: t.project \|\| "", priority: "P3" }` |

- Handlers live at App scope (same place as `handleReviewCreate`), passed to `WeeklyReview` as props: `onReschedule(task)`, `onClarifyNext(task)`, `onFollowUp(task)`.
- Each handler: capture the value needed to undo → call API → on success `window.__refreshTasks()` (the row re-derives out of its section) → show an **Undo toast** (Part 2). On error: `showToast(..., "error")`, no refresh.
- Date math: a small pure helper `plusDaysISO(n)` → today's local date + n days as `YYYY-MM-DD`. Unit-testable.
- Buttons use `e.stopPropagation()` (rows are click-to-open-task, like the existing ⭐ button).

## Part 2 — Undo-capable toast (small core change)

- Extend `Toast` (`:1727`) to accept optional `action: { label, onClick }`; render a button after the message when present. When an action is present, bump auto-close from 3s to ~6s.
- Extend `showToast(message, type = "success", action = null)` (`:21320`) and `window.__showToast` — **backward compatible** (existing 2-arg calls unaffected).
- Undo semantics per action:
  - Tunda → `PUT { deadline: <original deadline> }` (captured before change; original may be a date or null).
  - Inbox→Next → `PUT { gtd_status: "inbox" }`.
  - Tindak-lanjut → delete the created task using the id from the `POST` response via `DELETE /api/tasks/{id}` (exists, `webapp.py:1302`).
- Undo also calls `window.__refreshTasks()` and shows a brief confirmation toast.

## Part 3 — Sharper AI prompt (backend, `ai_review.py` only)

- `build_payload`: add a compact `signals` block (counts only, still whitelist-safe):
  - `p1_overdue` — count of tasks with `priority == "P1"` and `is_overdue`.
  - `oldest_overdue_days` — max `age_days` among overdue tasks (0 if none).
  - `projects_without_next` — count of active projects whose tasks include none with `gtd_status == "next"`.
- `REVIEW_SYSTEM_PROMPT`: instruct the model to (a) prioritize by Eisenhower quadrant + deadline proximity, (b) explicitly call out P1/Q1 overdue pileups in `summary` when `signals` indicate them, (c) order `focus_suggestions` by urgency. Schema unchanged.
- No change to the privacy boundary — `signals` are aggregate counts derived from already-whitelisted fields.

## Testing

- **Backend (`tests/test_ai_review.py`):** assert `build_payload` output contains `signals` with the three keys and correct counts on a small fixture; re-assert no non-whitelisted field leaks (extend existing leak test). `parse_review_content` unaffected.
- **Frontend:** unit-test `plusDaysISO(n)` (pure). Manual verification of the three actions + Undo in the running app (project norm for JSX UI).
- **Release:** bump SW version v174 → v175 (`sw.js` + cache name) because `static/index.html` changes — mandatory per cache rule. Verify live via `curl /config.js` / SW version after deploy.

## Files touched

- `ai_review.py` — `signals` in `build_payload`, prompt update.
- `tests/test_ai_review.py` — new assertions.
- `static/index.html` — `taskRow` action param, 3 App handlers + props, `Toast` action support, `showToast` signature, `plusDaysISO` helper.
- `sw.js` — version bump v175.

## Reversibility

All additive. Soft rollback: AI feature flag off hides the whole review. Hard: revert the slice's commits; no schema change to undo.
