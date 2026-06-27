# Tenant Isolation Hardening (Design)

**Date:** 2026-06-27
**Status:** Approved (brainstorm), ready for implementation plan
**Part of:** Monetization → public multi-tenant SaaS. This is sub-project **2a** (the security blocker). See `2026-06-27-monetization-packaging-design.md`. Self-service signup + email lifecycle is the separate sub-project **2b**.

## Problem

To open TaskFlow to public sign-ups, no tenant may ever read or mutate another tenant's data. Today, per-user isolation **is implemented but enforced by convention, not structurally**:

- Ownership scoping is consistent for tasks (via `user_id` + the `_can_access_task(conn, task_id, uid, write)` helper + a shared-list access clause).
- But several resources use a **fragile pattern**: an ownership check (`SELECT ... WHERE id=? AND user_id=?`) followed by an **unscoped** fetch or mutation (`SELECT * FROM mindmaps WHERE id=?`, `DELETE FROM mindmaps WHERE id=?`, `SELECT * FROM habits WHERE id=?`). Safe only because the earlier check exists; one refactor that drops the check leaks data.
- There is **no test** proving isolation holds, so regressions are invisible.

"Probably airtight" is insufficient for a SaaS. We need isolation enforced at the data-access point and **proven** by an automated cross-tenant test suite.

## Goals

1. Every endpoint touching user data fetches and mutates through a **scoped access guard** — no unscoped `WHERE id=?` reads/writes on user-owned rows.
2. Legitimate sharing (shared lists, and mindmaps/notes within them) keeps working.
3. **Admin is not a cross-tenant content backdoor** — admin endpoints touch only account/billing/aggregate/global-template data, never tenant content.
4. A **cross-tenant integration test suite** proves user B (and an admin C) cannot read/update/delete/list user A's resources, and runs in CI to prevent regression.

## Non-Goals

- Signup/email/verification/password-reset (that is sub-project 2b).
- Entitlement/quota enforcement (sub-project 3).
- A full ORM/repository rewrite. We standardize the existing helper pattern, not replace the data layer.
- Encryption-at-rest, per-tenant DBs, or sharding (out of scope for this pass).

## Decisions (locked during brainstorm)

| Question | Decision |
|---|---|
| Enforcement strategy | **Audit + fix + automated cross-tenant test guardrail** (not fix-only; not a unified-access-layer rewrite) |
| Admin access to tenant content | **None** — admin manages accounts/billing/aggregate/global templates only; not a content backdoor |
| Unauthorized response | **404** for not-owned/not-shared resources (do not leak existence); `403` only where an explicit forbidden semantic already exists |
| Mutations | **Double-scoped** — UPDATE/DELETE on user-owned rows carry `AND user_id=?` even when a guard already ran (defense in depth) |

## Resource Inventory (audit surface)

User-data tables whose endpoints must be audited and guarded (from `repository.py` + `webapp.py` + `review_history.py`):

| Resource | Table(s) | Ownership | Shareable? |
|---|---|---|---|
| Tasks (+subtasks, task_notes, task_attachments) | `tasks`, `subtasks`, `task_notes`, `task_attachments` | `tasks.user_id` | Yes (shared lists) |
| Notes / scratchpad | `scratchpad_notes`, `note_pins`, `note_attachments`, `drawings` | `user_id` | Yes (shared notes) |
| Mindmaps | `mindmaps` | `mindmaps.user_id` | Yes (shared lists) |
| Habits | `habits`, `habit_logs`, `recurring_exceptions` | `user_id` | No |
| Chat / notifications | `messages`, `notifications` | per-user / list membership | Within shared lists |
| Tags | `tags`, `entity_tags` | `user_id` | No |
| Review history | `review_snapshots` | `user_id` | No |
| Auth tokens | `ext_tokens`, `telegram_link_tokens`, `magic_tokens` | `user_id` | No |
| Global templates | `habit_templates` | none (global, admin-managed) | n/a |

`users` is account data (managed by 2b). `shared_lists`, `list_members`, `list_invites` define the legitimate cross-user access and must be honored by the guards, not bypassed.

## Architecture

### Unit 1: Per-entity access guards (`webapp.py`)

Generalize the existing `_can_access_task(conn, task_id, uid, write=False)` into a small family with one consistent contract:

```
_can_access_<entity>(conn, <id>, uid, write=False) -> sqlite3.Row
```

- Performs the **scoped** SELECT (owner `user_id == uid`, OR — for shareable entities — the row belongs to a shared list/note the user owns or is a member of; for `write=True`, membership must grant write).
- Returns the row when access is allowed; raises `HTTPException(404)` otherwise.
- Callers use the returned row directly — eliminating the separate unscoped `SELECT * WHERE id=?` fetch.

New guards to add (mirroring `_can_access_task`): `_can_access_mindmap`, `_can_access_note` (scratchpad), `_can_access_drawing`, `_can_access_habit`, `_can_access_review_snapshot`, and any other owned entity surfaced by the audit. Each guard has one clear responsibility (decide+fetch access for one entity) and is independently unit-testable.

### Unit 2: Gap fixes at call sites (`webapp.py`, `repository.py`)

For every audited endpoint:
- Replace "check then unscoped fetch/mutate" with a single guard call that returns the row.
- Add `AND user_id=?` (or the shared-access clause) to every UPDATE/DELETE on user-owned rows as defense in depth.
- List endpoints filter by `user_id` (+ shared clause) — never return unfiltered rows.

### Unit 3: Admin boundary (`webapp.py`)

Confirm `get_admin_user`-gated routes touch only account/billing/aggregate/global-template tables. No admin route reads tenant content (`tasks`, `scratchpad_notes`, `mindmaps`, `habits`, `messages`, …). The audit explicitly records each admin route's tables; any admin route reading tenant content is a finding to remove or re-scope.

### Unit 4: Cross-tenant test guardrail (`tests/`)

A new integration suite (e.g. `tests/test_tenant_isolation.py`):

- **Fixtures:** create user A, user B, admin C. As A, create one of every owned resource (task, subtask, task note, task attachment, scratchpad note, note pin, drawing, note attachment, habit, habit log, mindmap, message, tag, review snapshot).
- **Deny assertions:** for each resource, as B and as C, attempt GET/list/PUT/PATCH/POST-action/DELETE on A's id → assert `404`/`403`; assert B's and C's **list** endpoints never include A's rows.
- **Allow assertions (sharing preserved):** A shares a list (and a note) with B → B can read/write the shared task/mindmap/note; assert the allow path still works so hardening did not break collaboration.
- Runs in CI alongside the existing suites.

### Unit 5: Convention note (`docs/`)

A one-paragraph contributor note: every new user-data endpoint must (a) fetch/mutate via an access guard and (b) ship a cross-tenant test. Lightweight guard against future drift.

## Data Flow (per request, after hardening)

```
request → get_current_user → uid
  → _can_access_<entity>(conn, id, uid, write?) → row | 404
  → use row (read) OR mutate with AND user_id=? (write)
  → response
list → SELECT ... WHERE user_id=uid [OR shared clause]
```

## Error Handling

- Not owned / not shared → `404` (uniform; no existence leak).
- Shared-but-read-only resource on a write attempt → `403`.
- Guards never trust client-supplied `user_id`; identity always comes from the JWT (`user["sub"]`).

## Testing

- **Unit:** each new guard — owner allowed, non-owner 404, shared-member allowed (shareable types), read-only member write → 403.
- **Integration:** the cross-tenant guardrail suite (Unit 4) — the primary proof and regression guard.
- Existing suites must stay green (hardening must not break legitimate flows, especially sharing).

## Open Items (resolve in the plan, not here)

- Exact list of admin routes and their tables (produced by the audit step).
- Whether any currently-unscoped list endpoint exists that the inventory has not yet caught — the audit task enumerates all routes definitively.

## Reversibility

Guards and tests are additive; gap fixes are localized per endpoint. Each endpoint's fix is independently revertable. The test suite can run before/after each fix to confirm no behavioral regression for legitimate access.
