# Weekly Review — "AI Briefing" Annotations (Design)

**Date:** 2026-06-27
**Status:** Approved (brainstorm), ready for implementation plan
**Builds on:** Weekly Review v2 actionable (`2026-06-26-weekly-review-v2-actionable-design.md`) and Package B history (`2026-06-26-weekly-review-history-design.md`).

## Problem

In the v2 review, each action-queue row can carry one AI annotation rendered as a thin italic line (`✦ Segera revisi ITP Installation Electrical Work`). Two issues:

1. **Weak content.** The note just restates the task title with a verb prefix. It does not answer the question that makes a review valuable: *"why should I do this **now**?"*
2. **Weak presentation.** A small italic line does not stand out, so the guidance is easy to skip.

**Goal:** Make each annotated row read like a 5-minute manager briefing — a short directive plus a concrete, **truthful** reason grounded in real task signals (deadline proximity, P1/Q1 urgency, how many other tasks it blocks, a stalled project, what it's waiting on). The reviewer should finish the session knowing what to do first and why.

## Non-Goals

- No new task-to-task dependency feature (no explicit `blocked_by`). "Blocks N tasks" is grounded **only** in the existing parent/child (`parent_id`) relationship.
- No subtask-progress signal (would require extra per-task DB queries; out of scope).
- Verdict, local action queue, action buttons, and history strip are unchanged.
- No change to the privacy boundary: tasks-only. Every new field is the user's own task data.

## Decisions (locked during brainstorm)

| Question | Decision |
|---|---|
| How rich / grounded? | **Tone + enrich data** — add real signals so claims like "menahan 4 task lain" are truthful, never invented. |
| Visual treatment | **Style C** — two lines: bold directive + dim reason (no box). |
| Source of the two lines | **Full AI** — both lines come from the AI annotation. Without AI the row shows no briefing line (same as today). |
| Coverage | **All visible queue rows, 1:1** — frontend sends the ordered queue `task_id`s; AI must annotate each one. |

## Architecture

Four small, independently-testable changes across the existing seam (frontend builds the queue → posts to `/api/ai/review` → `ai_review.py` builds payload + calls the model → frontend renders annotations by `task_id`).

### 1. Payload enrichment — `ai_review.py: build_payload(tasks, queue=None)`

Add two grounded signals per task, computed from the task list already passed in (no extra DB work):

- **`blocks_count`** — number of *active* child tasks: `count(t2 for t2 in tasks if t2.parent_id == t.id and t2.gtd_status not in ('done','archived'))`. This is the only honest basis for "membuka / menahan N task lain". Computed in one pass by first building a `parent_id -> active_child_count` map.
- **`waiting_for`** — add the existing `waiting_for` column to `WHITELIST`. Only meaningful for `gtd_status == 'waiting'`; empty string otherwise.

`build_payload` gains an optional `queue` parameter: an ordered list of `task_id`s (strings) that the frontend wants annotated. It is echoed into the returned payload as `payload["queue"]` (validated/clamped to ids that exist in `tasks`, max 15, order preserved). When `queue` is `None` or empty, `payload["queue"]` is omitted and the model falls back to choosing the most worthy tasks itself (legacy behaviour).

`WHITELIST` becomes: `id, title, description, gtd_status, quadrant, priority, deadline, project, age_days, is_overdue, blocks_count, waiting_for`. (`blocks_count` is computed, like `age_days`.)

Privacy note: both additions are the user's own task fields; no notes/scratchpad data is touched. The whitelist remains the single egress gate.

### 2. Annotation schema + prompt — `ai_review.py`

`REVIEW_SCHEMA` annotation item changes from `{task_id, note}` to:

```json
{ "task_id": "string", "directive": "string", "why": "string" }
```

- **`directive`** — a short imperative (≤ ~4 words) saying *when / what action*: e.g. `Kerjakan hari ini`, `Jadwalkan minggu ini`, `Tindak lanjut`, `Tunggu kabar`, `Pecah jadi langkah`.
- **`why`** — exactly one short sentence (≤ ~18 words) giving the reason, **using only real numbers** from the payload: days overdue/until deadline, `blocks_count` (only mention "menahan N task" when `blocks_count > 0`), Q1/P1 status, a stalled project (`projects_without_next`), `waiting_for`.

`REVIEW_SYSTEM_PROMPT` is rewritten in the same Bahasa Indonesia voice but as a **manager giving a 5-minute briefing**:
- Each `why` must answer "kenapa ini sekarang?" and cite a concrete signal; **never invent** numbers or relationships. If no strong signal exists, give the honest mild reason (e.g. "biar inbox bersih") rather than a fake urgency.
- If `payload.queue` is present, the model **must** return one annotation for **every** `task_id` in it, in that order, and must not annotate ids outside it. If `queue` is absent, annotate up to 5 most worthy tasks (legacy).
- `task_id` must come from the provided data; never fabricate ids.
- `verdict` unchanged: exactly one sentence on the week's condition, highlighting the main pile-up (P1/Q1 overdue) when present.

`generate_review` user message: update the inline schema reminder to `{"verdict": str, "annotations": [{"task_id": str, "directive": str, "why": str}]}` and raise `max_tokens` from 4096 to 6000 (15 annotations × 2 fields + verdict comfortably fits). `parse_review_content` is unchanged (it parses whatever JSON object the model returns; field-shape is enforced loosely by the frontend, which is defensive).

### 3. Queue-aligned request — `webapp.py` + frontend

- **Frontend** (`runAI` in `WeeklyReview`): before POSTing, compute the same `buildActionQueue(tasks, cap)` used for rendering, take the visible rows' `task_id`s in order (the task-type rows; `stalled_project` rows have no `task_id` and are skipped), and POST `{ queue: [ids] }` to `/api/ai/review`.
- **Backend** (`ai_weekly_review`): accept an optional JSON body `ReviewRequest { queue: list[str] = [] }`, pass `queue` into `build_payload(tasks, queue=...)`. The endpoint stays AI-gated (404 when `AI_FEATURES_ENABLED` is false) and tasks-only.

Backward compatibility: an empty/missing body still works (queue omitted → legacy top-N behaviour), so the route never 422s on the old `{}` body.

### 4. Render — `static/index.html: WeeklyReview`

- `annotFor(id)` returns the full annotation object `{directive, why}` (or `null`), not just a string.
- `taskItem` replaces the single italic line with the **two-line style C**:
  - line 1 — `➤ {directive}`: `fontSize 12.5, fontWeight 700, color var(--text-primary)`.
  - line 2 — `{why}`: `fontSize 12, color var(--text-light), lineHeight 1.45`.
  - Render the block only when an annotation exists for that row (full-AI: no AI run → no block, unchanged behaviour).
- **Back-compat:** if the annotation object has a legacy `note` field but no `directive`/`why`, render `note` as the `why` line with no directive — so a stale model response degrades gracefully instead of showing blanks.

## Data Flow

```
WeeklyReview render
  → buildActionQueue(tasks) → visible rows
  → runAI(): POST /api/ai/review { queue: [task_id…] }
      → webapp: SELECT tasks (access-scoped, non-archived)
      → ai_review.build_payload(tasks, queue)   # + blocks_count, waiting_for, queue echo
      → ai_review.generate_review(payload)       # OpenRouter, briefing prompt
      → { verdict, annotations:[{task_id,directive,why}…] }
  → setAi(result)
  → taskItem row: annotFor(id) → ➤ directive / why  (style C)
```

## Error Handling

- AI failure path unchanged: route raises `AIReviewError` → HTTP 503 → UI shows "Gagal membuat ringkasan AI". No token clearing (honors auth-no-lockout).
- Model returns fewer/extra annotations than the queue: frontend renders whatever matches by `task_id`; unmatched rows simply show no briefing line (no crash). This is acceptable — we instruct full coverage but never depend on it.
- Model returns legacy `note` shape: graceful degrade (see Render back-compat).
- `blocks_count` map handles missing/None `parent_id` safely (skips).

## Testing

- **`tests/test_ai_review.py`** (extend):
  - `build_payload` sets `blocks_count` correctly: a parent with 2 active + 1 done child → `blocks_count == 2` on the parent, `0` on leaves.
  - `build_payload` adds `waiting_for` to task items and keeps the whitelist closed (no extra keys leak).
  - `build_payload(tasks, queue=[…])` echoes a clamped, order-preserving `payload["queue"]` (drops unknown ids, caps at 15); `queue=None` omits the key.
- **Node parse check:** `static/index.html` WeeklyReview block still `PARSE OK` (existing `new Function` smoke check from the v2/history plans).
- **Existing suites** (`test_ai_review`, `buildReview.test.js`, `test_review_history`) stay green.

## Deployment

- Backend change (`ai_review.py`, `webapp.py`) → **restart `taskflow-web`** after deploy (static sync ≠ backend restart — per the v2/history lesson).
- Bump SW cache `static/sw.js`: `taskflow-v180-review-history` → `taskflow-v181-review-briefing`.
- Requires AI activated on the VPS (`AI_FEATURES_ENABLED`, `OPENROUTER_API_KEY`, a real chat `AI_MODEL`) — already live as of 2026-06-27.

## Reversibility

- Soft: AI off → briefing lines vanish, queue/verdict unaffected.
- Hard: revert the additive commits; schema/prompt/render changes are self-contained.
