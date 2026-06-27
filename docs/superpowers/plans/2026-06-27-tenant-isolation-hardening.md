# Tenant Isolation Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove and enforce that no tenant can read or mutate another tenant's data across every feature, via per-entity access guards, double-scoped mutations, and an automated cross-tenant test guardrail that runs in CI.

**Architecture:** TDD-for-security. First build an integration test harness (FastAPI `TestClient` over the real app with an env-isolated temp DB) plus a CI job to run it. Then, resource by resource, add failing cross-tenant tests (user B and admin C attempting to reach user A's data), then close the gap by routing reads through scoped access guards and adding `AND user_id=?` to mutations, until the suite is green. Legitimate sharing (shared lists/notes/mindmaps) is preserved and tested on the allow path.

**Tech Stack:** Python 3.10+ (FastAPI, pydantic, sqlite3, pytest, `starlette.testclient.TestClient` + httpx), GitHub Actions.

## Global Constraints

- **Tasks-only of identity:** the acting user always comes from the JWT (`user["sub"]`); never trust a client-supplied `user_id`.
- **Unauthorized response = `404`** for not-owned/not-shared resources (do not leak existence). Use `403` only where a forbidden semantic already exists (e.g. shared-but-read-only member attempting a write, or "only owner can delete/share").
- **Mutations double-scoped:** every UPDATE/DELETE on a user-owned row carries `AND user_id=?` (or the shared-access clause) even when a guard already ran.
- **Admin is not a content backdoor:** no `get_admin_user`-gated route may read tenant content (`tasks`, `scratchpad_notes`, `mindmaps`, `habits`, `messages`, `drawings`, `review_snapshots`, tags). Admin touches only account/aggregate/global-template data.
- **Preserve legitimate sharing:** guards for shareable entities (tasks, mindmaps, scratchpad notes) must honor `shared_lists` / `list_members` and the existing `_note_access_clause(uid)`.
- **Follow the existing model:** new guards mirror `_can_access_task(conn, task_id, uid, write=False) -> Row` (returns the row or raises `HTTPException(404)`).
- **DB/secret isolation for tests:** webapp reads `DB_PATH`, `UPLOAD_DIR` (from `config.py`, both `os.getenv`-backed) and `WEB_SECRET_KEY` (webapp.py:56). Tests set these env vars to temp values **before importing `webapp`**.
- **Test execution:** fastapi is not installed in the local Z: environment; the cross-tenant suite runs in **CI** (the new `.github/workflows/test.yml`). RED/GREEN evidence for integration tests comes from CI runs (or a local venv with deps installed). Pure-logic suites still run locally.
- No new runtime dependencies for the app itself; test-only deps (`pytest`, `httpx`) are dev/CI only.

---

### Task 1: Integration test harness + CI workflow + tasks isolation baseline

**Files:**
- Create: `tests/conftest.py`
- Create: `tests/test_tenant_isolation.py`
- Create: `.github/workflows/test.yml`

**Interfaces:**
- Produces (consumed by all later tasks):
  - `client_factory()` fixture → returns a function making a fresh `TestClient` with its own cookie jar.
  - `user_client(client_factory, username)` helper → registers + logs in a user, returns an authed `TestClient`.
  - `make_owned_resources(client) -> dict` → creates one of each owned resource as the given user and returns a dict of created ids (extended in later tasks; in Task 1 it creates a task and returns `{"task_id": ...}`).
  - Convention: cross-tenant deny helper `assert_denied(resp)` → asserts `resp.status_code in (403, 404)`.

- [ ] **Step 1: Write the harness fixtures**

Create `tests/conftest.py`:

```python
import os
import tempfile
import pytest

# Isolate DB + uploads + secret BEFORE importing the app.
_TMP = tempfile.mkdtemp(prefix="tf-iso-")
os.environ["DB_PATH"] = os.path.join(_TMP, "test.db")
os.environ["UPLOAD_DIR"] = os.path.join(_TMP, "uploads")
os.environ["WEB_SECRET_KEY"] = "test-secret-key"
os.environ["AI_FEATURES_ENABLED"] = "false"
os.makedirs(os.environ["UPLOAD_DIR"], exist_ok=True)

from starlette.testclient import TestClient  # noqa: E402
import webapp  # noqa: E402


@pytest.fixture
def client_factory():
    def make():
        return TestClient(webapp.app)
    return make


def user_client(client_factory, username):
    """Register (idempotent) + log in; returns an authed TestClient (cookie jar holds the JWT)."""
    c = client_factory()
    c.post("/api/auth/register",
           json={"username": username, "password": "pw-" + username,
                 "display_name": username})
    r = c.post("/api/auth/login",
               json={"username": username, "password": "pw-" + username})
    assert r.status_code == 200, r.text
    return c


def assert_denied(resp):
    assert resp.status_code in (403, 404), \
        f"expected 403/404, got {resp.status_code}: {resp.text[:200]}"
```

- [ ] **Step 2: Write the tasks isolation test (baseline — should pass, proving the harness)**

Create `tests/test_tenant_isolation.py`:

```python
from conftest import user_client, assert_denied


def _make_task(client, title="A-secret-task"):
    r = client.post("/api/tasks", json={"title": title})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def test_task_isolation_read_update_delete(client_factory):
    a = user_client(client_factory, "alice")
    b = user_client(client_factory, "bob")
    tid = _make_task(a)

    # B cannot read A's task detail
    assert_denied(b.get(f"/api/tasks/{tid}"))
    # B cannot update A's task
    assert_denied(b.put(f"/api/tasks/{tid}", json={"title": "hacked"}))
    # B cannot delete A's task
    assert_denied(b.delete(f"/api/tasks/{tid}"))
    # B's list never contains A's task
    rb = b.get("/api/tasks")
    assert rb.status_code == 200
    assert all(t["id"] != tid for t in rb.json()), "A's task leaked into B's list"
```

NOTE: if the exact task-create body or list shape differs, read `class TaskCreate` and the `/api/tasks` GET handler in `webapp.py` and adjust the helper — keep the deny/allow assertions identical.

- [ ] **Step 3: Add the CI test workflow**

Create `.github/workflows/test.yml`:

```yaml
name: Tests
on:
  push:
    branches: ["**"]
  pull_request:
jobs:
  pytest:
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.10"
      - name: Install deps
        run: |
          python -m pip install --upgrade pip
          pip install -r requirements-web.txt
          pip install pytest httpx
      - name: Run tests
        run: python -m pytest tests/ -q
```

NOTE: confirm the web requirements filename (`requirements-web.txt` per project memory). If it differs, use the actual file.

- [ ] **Step 4: Verify**

Locally: `python -m py_compile tests/conftest.py tests/test_tenant_isolation.py` → no syntax errors. Pure-logic suites still green: `python -m pytest tests/test_ai_review.py tests/test_review_history.py -q`.
In CI (push the branch): the `Tests` workflow runs `pytest tests/` — `test_task_isolation_*` must PASS (tasks are already scoped; a failure here means the harness is wrong, not the app).

- [ ] **Step 5: Commit**

```bash
git add tests/conftest.py tests/test_tenant_isolation.py .github/workflows/test.yml
git commit -m "test(isolation): integration harness + CI workflow + tasks baseline"
```

---

### Task 2: Mindmap isolation — guard + double-scoped mutations

**Files:**
- Modify: `webapp.py` (add `_can_access_mindmap`; fix the mindmap endpoints around lines 3587-3690)
- Test: `tests/test_tenant_isolation.py` (add mindmap cases)

**Interfaces:**
- Consumes: harness from Task 1.
- Produces: `_can_access_mindmap(conn, mid, uid, write=False) -> sqlite3.Row` — returns the mindmap row if owned or accessible via its shared list; raises `HTTPException(404)` otherwise.

- [ ] **Step 1: Write the failing mindmap isolation test**

Add to `tests/test_tenant_isolation.py`:

```python
def _make_mindmap(client, title="A-secret-map"):
    r = client.post("/api/mindmaps", json={"title": title})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def test_mindmap_isolation(client_factory):
    a = user_client(client_factory, "alice2")
    b = user_client(client_factory, "bob2")
    mid = _make_mindmap(a)

    assert_denied(b.get(f"/api/mindmaps/{mid}"))
    assert_denied(b.put(f"/api/mindmaps/{mid}", json={"title": "x", "data_json": "{}"}))
    assert_denied(b.patch(f"/api/mindmaps/{mid}/pin", json={"is_pinned": True}))
    assert_denied(b.delete(f"/api/mindmaps/{mid}"))
    rb = b.get("/api/mindmaps")
    assert rb.status_code == 200
    assert all(m["id"] != mid for m in rb.json()), "A's mindmap leaked into B's list"
```

NOTE: adjust `_make_mindmap` body and the PUT body to match the real `POST /api/mindmaps` / `PUT /api/mindmaps/{mid}` payloads (read those handlers). Keep assertions identical.

- [ ] **Step 2: Run to verify it fails**

CI (push) or local venv: `python -m pytest tests/test_tenant_isolation.py::test_mindmap_isolation -q`
Expected: FAIL — current pin/update/delete use `SELECT ... WHERE id=? AND user_id=?` checks but the `GET /api/mindmaps/{mid}` uses a shared `access_clause`; verify which assertion leaks. (At minimum the fragile unscoped fetch/mutate pattern is the target.)

- [ ] **Step 3: Add the guard and route all single-mindmap access through it**

In `webapp.py`, near `_can_access_task`, add:

```python
def _can_access_mindmap(conn, mid, uid, write=False):
    """Return the mindmap row if uid owns it or can reach it via its shared list;
    else raise 404. Writes by a non-owner require list membership."""
    row = conn.execute(
        "SELECT * FROM mindmaps WHERE id = ? AND ("
        "  user_id = ?"
        "  OR list_id IN (SELECT id FROM shared_lists WHERE owner_id = ?"
        "                 UNION SELECT list_id FROM list_members WHERE user_id = ?)"
        ")",
        (mid, uid, uid, uid)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Mindmap tidak ditemukan")
    if write and row["user_id"] != uid and not row["list_id"]:
        raise HTTPException(status_code=403, detail="Tidak boleh mengubah mindmap ini")
    return row
```

Then in the mindmap endpoints (`GET /api/mindmaps/{mid}`, `PUT /api/mindmaps/{mid}`, `PATCH /api/mindmaps/{mid}/pin`, `PATCH /api/mindmaps/{mid}/share`, `DELETE /api/mindmaps/{mid}`):
- Replace each `SELECT ... WHERE id=? AND user_id=?` check **and** any later unscoped `SELECT * FROM mindmaps WHERE id=?` with a single `row = _can_access_mindmap(conn, mid, uid, write=<True for mutations>)`.
- For pin/share (owner-only), keep the owner check: after the guard, `if row["user_id"] != uid: raise HTTPException(403, ...)`.
- Add `AND user_id = ?` to the mutation statements:
  - `UPDATE mindmaps SET ... WHERE id = ?` → `WHERE id = ? AND (user_id = ? OR list_id IS NOT NULL)` is wrong for double-scope; instead use `WHERE id = ?` only after the guard returned the row, **and** add `AND user_id = ?` for owner-only mutations (pin, delete, share). For the shared `PUT` (members may edit), scope by the guard's returned row id (the guard already authorized).
  - `DELETE FROM mindmaps WHERE id = ?` → `DELETE FROM mindmaps WHERE id = ? AND user_id = ?` (delete is owner-only).

Locate the exact lines: `grep -n "FROM mindmaps WHERE id = ?" webapp.py`.

- [ ] **Step 4: Run to verify it passes**

`python -m pytest tests/test_tenant_isolation.py -q` (CI or local venv)
Expected: PASS — both `test_task_isolation_*` and `test_mindmap_isolation`.

- [ ] **Step 5: Commit**

```bash
git add webapp.py tests/test_tenant_isolation.py
git commit -m "fix(isolation): mindmap access guard + double-scoped mutations"
```

---

### Task 3: Scratchpad notes + drawings + note attachments + pins isolation

**Files:**
- Modify: `webapp.py` (scratchpad endpoints ~2613-3250, drawings ~2966-3009, note attachments ~2759-2860)
- Test: `tests/test_tenant_isolation.py` (add notes cases)

**Interfaces:**
- Consumes: existing `_note_access_clause(uid)` (returns `(clause, params)`), `_NOTE_SELECT`.
- Produces: `_can_access_note(conn, note_id, uid, write=False) -> sqlite3.Row` wrapping `_note_access_clause`; returns row or raises 404.

- [ ] **Step 1: Write the failing notes isolation test**

Add to `tests/test_tenant_isolation.py`:

```python
def _make_note(client, title="A-secret-note"):
    r = client.post("/api/scratchpad", json={"title": title, "content": "secret", "tags": []})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def test_scratchpad_isolation(client_factory):
    a = user_client(client_factory, "alice3")
    b = user_client(client_factory, "bob3")
    nid = _make_note(a)

    assert_denied(b.get(f"/api/scratchpad/{nid}"))
    assert_denied(b.put(f"/api/scratchpad/{nid}", json={"title": "x", "content": "y", "tags": []}))
    assert_denied(b.delete(f"/api/scratchpad/{nid}"))
    assert_denied(b.get(f"/api/drawings/{nid}"))
    assert_denied(b.put(f"/api/drawings/{nid}", json={"data": "{}"}))
    rb = b.get("/api/scratchpad")
    assert rb.status_code == 200
    assert all(n["id"] != nid for n in rb.json()), "A's note leaked into B's list"
```

NOTE: align `_make_note` and the PUT/drawings bodies with the real `ScratchpadCreate`, `ScratchpadUpdate`, and `PUT /api/drawings/{note_id}` payloads (read those models/handlers). Keep assertions identical.

- [ ] **Step 2: Run to verify it fails**

`python -m pytest tests/test_tenant_isolation.py::test_scratchpad_isolation -q`
Expected: FAIL on the mutation paths — `UPDATE scratchpad_notes ... WHERE id=?` and `DELETE FROM scratchpad_notes WHERE id=?` run unscoped after a scoped check; drawings likewise. (Reads via `_note_access_clause` should already deny, confirming the harness.)

- [ ] **Step 3: Add the guard and double-scope the note mutations**

In `webapp.py`, near the other guards, add:

```python
def _can_access_note(conn, note_id, uid, write=False):
    """Return the scratchpad_notes row if uid owns it or it is shared with uid;
    else raise 404."""
    clause, params = _note_access_clause(uid)
    row = conn.execute(
        f"SELECT * FROM scratchpad_notes WHERE id = ? AND {clause}",
        [note_id] + params).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Note tidak ditemukan")
    return row
```

Then:
- In `PUT /api/scratchpad/{note_id}`: keep the existing scoped `existing` fetch (it already uses the clause), and change the `UPDATE scratchpad_notes SET ... WHERE id=?` to `WHERE id=? AND (user_id=? OR list_id IS NOT NULL)` — i.e. only the owner or a shared-list member may write. Simpler and safe: since `existing` was already authorized via the clause, scope the UPDATE with `WHERE id = ?` AND re-assert membership by appending the note-access clause params: `WHERE id = ? AND {clause}` (reuse `_note_access_clause(uid)`).
- In `DELETE /api/scratchpad/{note_id}`: the check is owner-only (`WHERE id=? AND user_id=?`); change the delete from `DELETE FROM scratchpad_notes WHERE id = ?` to `DELETE FROM scratchpad_notes WHERE id = ? AND user_id = ?`.
- In `GET/PUT /api/drawings/{note_id}`: drawings hang off a note; gate via `_can_access_note(conn, note_id, uid)` before reading/writing the drawing, and scope the drawing UPDATE with the note's ownership (`WHERE note_id = ?` plus a confirmed-access check). Locate: `grep -n "FROM drawings WHERE\|FROM scratchpad_notes WHERE id = ?" webapp.py`.

- [ ] **Step 4: Run to verify it passes**

`python -m pytest tests/test_tenant_isolation.py -q`
Expected: PASS (tasks + mindmaps + scratchpad/drawings).

- [ ] **Step 5: Commit**

```bash
git add webapp.py tests/test_tenant_isolation.py
git commit -m "fix(isolation): note/drawing access guard + double-scoped mutations"
```

---

### Task 4: Habits + habit_logs + recurring_exceptions isolation

**Files:**
- Modify: `webapp.py` (habits endpoints ~2223-2470)
- Test: `tests/test_tenant_isolation.py` (add habit cases)

**Interfaces:**
- Produces: `_can_access_habit(conn, habit_id, uid, write=False) -> sqlite3.Row` — habits are NOT shareable, so ownership is strict `user_id == uid`; raises 404 otherwise.

- [ ] **Step 1: Write the failing habit isolation test**

Add to `tests/test_tenant_isolation.py`:

```python
def _make_habit(client, title="A-secret-habit"):
    r = client.post("/api/habits", json={"title": title})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def test_habit_isolation(client_factory):
    a = user_client(client_factory, "alice4")
    b = user_client(client_factory, "bob4")
    hid = _make_habit(a)

    assert_denied(b.post(f"/api/habits/{hid}/update", json={"title": "hacked"}))
    assert_denied(b.post(f"/api/habits/{hid}/checkin", json={}))
    assert_denied(b.get(f"/api/habits/{hid}/tags"))
    rb = b.get("/api/habits")
    assert rb.status_code == 200
    assert all(h["id"] != hid for h in rb.json()), "A's habit leaked into B's list"
```

NOTE: align `_make_habit`/update/checkin bodies with the real `HabitCreate` and the habit endpoints (read `webapp.py` ~2244-2470). Keep assertions identical.

- [ ] **Step 2: Run to verify it fails**

`python -m pytest tests/test_tenant_isolation.py::test_habit_isolation -q`
Expected: FAIL — `SELECT * FROM habits WHERE id = ?` (webapp.py ~2265) is unscoped; `DELETE FROM habits WHERE id = ?` (~2339) is unscoped after a check.

- [ ] **Step 3: Add the guard and double-scope habit mutations**

In `webapp.py`, add:

```python
def _can_access_habit(conn, habit_id, uid, write=False):
    """Habits are private (not shareable). Return the row if uid owns it; else 404."""
    row = conn.execute(
        "SELECT * FROM habits WHERE id = ? AND user_id = ?", (habit_id, uid)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Habit tidak ditemukan")
    return row
```

Then in every habit endpoint that takes `{habit_id}` (`/update`, `/checkin`, `/tags`, monthly/logs scoped reads, delete): replace the unscoped `SELECT * FROM habits WHERE id = ?` and the `SELECT id FROM habits WHERE id=? AND user_id=?` checks with `row = _can_access_habit(conn, habit_id, uid)`, and change `DELETE FROM habits WHERE id = ?` to `DELETE FROM habits WHERE id = ? AND user_id = ?`. Also scope `habit_logs` / `recurring_exceptions` writes by joining/confirming the parent habit's ownership. Locate: `grep -n "FROM habits WHERE\|FROM habit_logs WHERE\|FROM recurring_exceptions WHERE" webapp.py`.

- [ ] **Step 4: Run to verify it passes**

`python -m pytest tests/test_tenant_isolation.py -q`
Expected: PASS (all resources so far).

- [ ] **Step 5: Commit**

```bash
git add webapp.py tests/test_tenant_isolation.py
git commit -m "fix(isolation): habit access guard + double-scoped mutations"
```

---

### Task 5: Tags/entity_tags + review_snapshots + messages/notifications isolation

**Files:**
- Modify: `webapp.py` (tag endpoints; messages/notifications endpoints), `review_history.py` if needed (already `user_id`-scoped)
- Test: `tests/test_tenant_isolation.py` (add cases)

**Interfaces:**
- Consumes: guards/patterns from earlier tasks. `review_snapshots` reads/writes are already `WHERE user_id=?` in `review_history.py` (`get_history`, `upsert_snapshot`) — assert, don't refactor.

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_tenant_isolation.py`:

```python
def test_tag_isolation(client_factory):
    a = user_client(client_factory, "alice5")
    b = user_client(client_factory, "bob5")
    # A creates a task with a tag; B's tag list must not contain A's tag
    a.post("/api/tasks", json={"title": "tagged", "tags": ["alice-private-tag"]})
    rb = b.get("/api/tags")
    assert rb.status_code == 200
    names = [t.get("name") for t in rb.json()]
    assert "alice-private-tag" not in names, "A's tag leaked into B's tag list"


def test_review_history_isolation(client_factory):
    a = user_client(client_factory, "alice6")
    b = user_client(client_factory, "bob6")
    a.post("/api/review/snapshot", json={"score": 99, "done_this_week": 7})
    rb = b.get("/api/review/history")
    assert rb.status_code == 200
    # B has no snapshots; prev must be None / streak 0 — never A's data
    assert rb.json().get("prev") in (None, {}) or rb.json().get("prev", {}).get("score") != 99
```

NOTE: adjust the tag-create path and `/api/tags` shape to the real handlers (read `webapp.py` tag endpoints ~1138-1234). If messages/notifications expose per-id GET endpoints, add an analogous deny test (B cannot fetch A's message/notification by id); locate with `grep -n "@app.*api/\(messages\|notifications\)" webapp.py`.

- [ ] **Step 2: Run to verify it fails (or passes where already scoped)**

`python -m pytest tests/test_tenant_isolation.py::test_tag_isolation tests/test_tenant_isolation.py::test_review_history_isolation -q`
Expected: tag/review tests should already PASS if those reads are `user_id`-scoped; if any FAILs, that is a real leak to fix in Step 3. Messages/notifications: FAIL if any per-id read is unscoped.

- [ ] **Step 3: Fix any gaps found**

For each failing endpoint, apply the same transform: scope the read by `user_id` (+ shared clause where the entity is shareable, e.g. messages within a shared list use the list-membership clause), and add `AND user_id=?` to mutations. For messages/notifications, gate per-id access by list membership (`messages` belong to a `list_id`; reuse the shared-list membership check). If no gaps are found, this task only adds the proving tests.

- [ ] **Step 4: Run to verify it passes**

`python -m pytest tests/test_tenant_isolation.py -q`
Expected: PASS (all resources).

- [ ] **Step 5: Commit**

```bash
git add webapp.py tests/test_tenant_isolation.py
git commit -m "fix(isolation): tags/review/messages cross-tenant scoping + proofs"
```

---

### Task 6: Admin boundary proof + convention doc + full sweep

**Files:**
- Modify: `webapp.py` (only if the audit finds an admin route reading tenant content)
- Test: `tests/test_tenant_isolation.py` (admin-not-a-backdoor cases)
- Create: `docs/tenant-isolation-convention.md`

**Interfaces:**
- Consumes: the harness; `user_client` for an admin user. Admin status is set via the `users.is_admin` column (no API to self-promote) — the test promotes a user directly in the test DB.

- [ ] **Step 1: Write the admin-boundary test**

Add to `tests/test_tenant_isolation.py`:

```python
import sqlite3
import os


def _promote_admin(username):
    conn = sqlite3.connect(os.environ["DB_PATH"])
    conn.execute("UPDATE users SET is_admin = 1 WHERE username = ?", (username,))
    conn.commit()
    conn.close()


def test_admin_is_not_a_content_backdoor(client_factory):
    a = user_client(client_factory, "alice7")
    tid = a.post("/api/tasks", json={"title": "A-secret"}).json()["id"]
    nid = a.post("/api/scratchpad", json={"title": "A-note", "content": "x", "tags": []}).json()["id"]

    _promote_admin("carol-admin")
    c = user_client(client_factory, "carol-admin")  # re-login picks up is_admin

    # Admin must NOT reach another tenant's content via content endpoints
    assert_denied(c.get(f"/api/tasks/{tid}"))
    assert_denied(c.get(f"/api/scratchpad/{nid}"))
    rc = c.get("/api/tasks")
    assert rc.status_code == 200
    assert all(t["id"] != tid for t in rc.json()), "admin saw another tenant's task"
```

- [ ] **Step 2: Run to verify**

`python -m pytest tests/test_tenant_isolation.py::test_admin_is_not_a_content_backdoor -q`
Expected: PASS if content endpoints scope by `user["sub"]` regardless of `is_admin` (they should — `is_admin` only gates `get_admin_user` routes). If it FAILs, a content route is consulting `is_admin` to widen access — remove that widening in Step 3.

- [ ] **Step 3: Fix any admin leakage + audit admin routes**

`grep -n "Depends(get_admin_user)" webapp.py` → for each admin route, confirm it touches only `users`, billing/aggregate, or `habit_templates` — never tenant content tables. Re-scope or remove any that read tenant content. If Step 2 passed and no admin route reads content, no code change is needed.

- [ ] **Step 4: Write the convention doc**

Create `docs/tenant-isolation-convention.md`:

```markdown
# Tenant Isolation Convention

Every endpoint that reads or mutates user-owned data MUST:

1. Resolve identity from the JWT only (`uid = user["sub"]`); never trust a
   client-supplied user_id.
2. Fetch the row through a scoped access guard
   (`_can_access_task` / `_can_access_mindmap` / `_can_access_note` /
   `_can_access_habit`, or an equivalent `WHERE ... AND user_id = ?` +
   shared-access clause). Unauthorized → 404.
3. Carry `AND user_id = ?` (or the shared-access clause) on every
   UPDATE/DELETE, even after a guard ran (defense in depth).
4. Ship a cross-tenant test in `tests/test_tenant_isolation.py`: user B (and
   admin C) get 403/404 on the resource, and it never appears in their lists.

Admin (`get_admin_user`) routes manage accounts/aggregate/global templates
only — they must never read tenant content.
```

- [ ] **Step 5: Full sweep + commit**

Run (CI or local venv): `python -m pytest tests/ -q` → all green.
Run locally: `python -m pytest tests/test_ai_review.py tests/test_review_history.py -q` and `node --test tests/buildReview.test.js` → green.

```bash
git add webapp.py tests/test_tenant_isolation.py docs/tenant-isolation-convention.md
git commit -m "test(isolation): admin-not-a-backdoor proof + convention doc"
```

---

## Self-Review Notes

- **Spec coverage:** access guards → Tasks 2-4 (`_can_access_mindmap/_can_access_note/_can_access_habit`, mirroring `_can_access_task`); gap fixes + double-scoped mutations → Tasks 2-5; admin boundary → Task 6; cross-tenant guardrail → Tasks 1-6 (`tests/test_tenant_isolation.py`, run in CI via `test.yml`); convention note → Task 6; 404-uniform + identity-from-JWT → Global Constraints + per-task assertions; preserve-sharing → guard clauses honor `_note_access_clause`/shared_lists (mindmap/note guards). The audit/inventory from the spec is performed in-line per resource task (the failing test enumerates the leak) rather than as a separate doc-only task.
- **Test-environment reality:** integration tests need fastapi+httpx, absent locally; Task 1 adds the CI job that runs them, and every task notes CI (or a local venv) for RED/GREEN. Line numbers in webapp.py are approximate (large file) — each fix task gives a `grep` to locate the exact sites.
- **Type consistency:** guard signature `(conn, id, uid, write=False) -> Row` is uniform across Tasks 2-4 and matches the existing `_can_access_task`. `user_client`, `assert_denied`, `client_factory` defined in Task 1 are used verbatim in Tasks 2-6.
- **Deploy note:** backend change (`webapp.py`) → restart `taskflow-web` after deploy; the new `test.yml` runs on push (no deploy impact).
```
