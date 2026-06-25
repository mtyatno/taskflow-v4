# Weekly Review Package A (Actionable + Sharper AI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 1-tap row actions (snooze overdue +7d, inbox→next, follow-up waiting) with undo to the Weekly Review, and make the AI summary quadrant/deadline-aware with explicit P1/Q1 overdue-pileup signals — no DB migration.

**Architecture:** Backend changes are confined to `ai_review.py` (a pure `signals` aggregate in `build_payload` + a prompt update). Frontend reuses existing task APIs (`PUT /api/tasks/{id}`, `POST /api/tasks`, `DELETE /api/tasks/{id}`) wired through new App-scope handlers passed to the `WeeklyReview` component; a small pure date helper lands in `digest.js` (node-testable); `Toast`/`showToast` gain optional undo-action support (backward compatible).

**Tech Stack:** Python (pytest), FastAPI (existing endpoints, untouched), React via in-browser Babel (pre-compiled `React.createElement` style in `static/index.html`), plain-script `static/review/digest.js` (node:test), service-worker cache versioning.

## Global Constraints

- Tasks-only privacy boundary: `ai_review.py` must never import or read notes/scratchpad; new `signals` are aggregate counts derived only from already-whitelisted fields. Verbatim whitelist: `id, title, description, gtd_status, quadrant, priority, deadline, project, age_days, is_overdue`.
- No new backend endpoints — reuse `PUT /api/tasks/{id}` (partial update), `POST /api/tasks`, `DELETE /api/tasks/{id}` (`webapp.py:1302`).
- `showToast` change MUST be backward compatible — existing 2-arg `showToast(message, type)` calls keep working.
- Static asset change requires SW cache bump. Current value is `const CACHE = "taskflow-v175-review-enriched";` (`static/sw.js:1`) → bump to `taskflow-v176-review-actions`.
- Frontend UI uses pre-compiled `React.createElement(...)` style (no JSX in `static/index.html`); match surrounding code exactly.
- Button copy (Indonesian, verbatim): overdue = `Tunda 1mg`, inbox = `Jadikan Next`, waiting = `Tindak lanjut`. Follow-up task title prefix = `Tindak lanjut: `.

---

### Task 1: Backend — `signals` aggregate in `build_payload`

**Files:**
- Modify: `ai_review.py` (`build_payload`, around `:29-44`)
- Test: `tests/test_ai_review.py`

**Interfaces:**
- Consumes: existing `build_payload(tasks: list) -> dict` returning `{"counts", "tasks"}` and `_age_days(t)`.
- Produces: `build_payload` now returns `{"counts", "tasks", "signals"}` where `signals = {"p1_overdue": int, "oldest_overdue_days": int, "projects_without_next": int}`.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_ai_review.py`:

```python
def test_build_payload_has_signals():
    tasks = [
        {"id": "a", "gtd_status": "next", "priority": "P1", "is_overdue": True,
         "project": "Alpha", "updated_at": "2026-06-01T00:00:00"},
        {"id": "b", "gtd_status": "next", "priority": "P2", "is_overdue": True,
         "project": "Beta", "updated_at": "2026-06-20T00:00:00"},
        {"id": "c", "gtd_status": "inbox", "priority": "P3", "project": "Beta"},
    ]
    sig = ai_review.build_payload(tasks)["signals"]
    assert sig["p1_overdue"] == 1
    # Alpha has only an overdue 'next' (counts as having a next); Beta has no 'next'
    assert sig["projects_without_next"] == 1
    assert sig["oldest_overdue_days"] >= sig.get("_never", 0)  # is an int, >=0
    assert isinstance(sig["oldest_overdue_days"], int)


def test_signals_never_leak_non_whitelisted():
    import json
    tasks = [dict(SAMPLE[0], note_content="PRIVATE")]
    blob = json.dumps(ai_review.build_payload(tasks))
    assert "PRIVATE" not in blob and "note_content" not in blob
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_ai_review.py::test_build_payload_has_signals -v`
Expected: FAIL with `KeyError: 'signals'`.

- [ ] **Step 3: Write minimal implementation**

In `ai_review.py`, replace the body of `build_payload` so it computes signals while iterating. Full replacement:

```python
def build_payload(tasks: list) -> dict:
    """Reduce full task dicts to whitelisted fields + aggregate counts/signals."""
    out_tasks = []
    counts = {"inbox": 0, "next": 0, "waiting": 0, "someday": 0,
              "overdue": 0, "total": 0}
    p1_overdue = 0
    oldest_overdue_days = 0
    proj_has_next = {}      # project -> bool (any task with gtd_status == 'next')
    proj_seen = set()
    for t in tasks:
        gs = t.get("gtd_status")
        counts["total"] += 1
        if gs in counts:
            counts[gs] += 1
        age = _age_days(t)
        if t.get("is_overdue"):
            counts["overdue"] += 1
            if t.get("priority") == "P1":
                p1_overdue += 1
            if age > oldest_overdue_days:
                oldest_overdue_days = age
        proj = t.get("project")
        if proj:
            proj_seen.add(proj)
            if gs == "next":
                proj_has_next[proj] = True
        item = {k: t.get(k) for k in WHITELIST if k != "age_days"}
        item["age_days"] = age
        out_tasks.append(item)
    projects_without_next = sum(
        1 for p in proj_seen if not proj_has_next.get(p))
    signals = {"p1_overdue": p1_overdue,
               "oldest_overdue_days": oldest_overdue_days,
               "projects_without_next": projects_without_next}
    return {"counts": counts, "tasks": out_tasks, "signals": signals}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_ai_review.py -v`
Expected: PASS (all existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add ai_review.py tests/test_ai_review.py
git commit -m "feat(ai): add signals aggregate (p1_overdue, oldest_overdue, projects_without_next) to review payload"
```

---

### Task 2: Backend — sharpen the review system prompt

**Files:**
- Modify: `ai_review.py` (`REVIEW_SYSTEM_PROMPT`, around `:86-98`)
- Test: `tests/test_ai_review.py`

**Interfaces:**
- Consumes: `REVIEW_SYSTEM_PROMPT` (module-level string).
- Produces: same name, expanded content. No signature change. `signals` from Task 1 is already serialized into the user message by `generate_review` (it `json.dumps(payload)` whole) — no code change needed there.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_ai_review.py`:

```python
def test_prompt_mentions_quadrant_and_overdue_priority():
    p = ai_review.REVIEW_SYSTEM_PROMPT.lower()
    assert "quadrant" in p
    assert "p1" in p and "overdue" in p
    assert "signals" in p  # tells the model the aggregate block exists
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_ai_review.py::test_prompt_mentions_quadrant_and_overdue_priority -v`
Expected: FAIL (current prompt has no "signals" / "p1").

- [ ] **Step 3: Write minimal implementation**

Replace `REVIEW_SYSTEM_PROMPT` in `ai_review.py` with:

```python
REVIEW_SYSTEM_PROMPT = (
    "Kamu asisten GTD untuk aplikasi task. Berdasarkan ringkasan TUGAS user "
    "(judul, status GTD, quadrant Eisenhower, prioritas, deadline, project, umur) "
    "dan blok 'signals' (agregat: p1_overdue, oldest_overdue_days, "
    "projects_without_next), buat review mingguan singkat dalam Bahasa Indonesia.\n"
    "- summary: 1-3 kalimat insight. Jika signals.p1_overdue > 0 atau ada banyak "
    "  task Q1 overdue, SOROTI tumpukan itu secara eksplisit sebagai titik macet utama.\n"
    "- focus_suggestions: 3-5 task PALING layak difokuskan minggu depan, URUTKAN by "
    "  urgensi (deadline terdekat / overdue dulu, quadrant Q1 lebih dulu dari Q2). "
    "  task_id WAJIB berasal dari daftar yang diberikan; jangan mengarang id.\n"
    "- stalled_projects: untuk project yang punya task tapi tidak punya next-action, "
    "  usulkan 1-2 next-action KONKRET (kata kerja di depan: 'Email...', 'Finalisasi...'), "
    "  bukan tujuan kabur.\n"
    "- reflective_questions: 1-2 pertanyaan reflektif terarah.\n"
    "Jangan menyertakan data selain yang diberikan. Ringkas dan actionable."
)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_ai_review.py -v`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add ai_review.py tests/test_ai_review.py
git commit -m "feat(ai): quadrant/deadline-aware prompt that flags P1/Q1 overdue pileups"
```

---

### Task 3: Frontend — `plusDaysISO` date helper (pure, node-tested)

**Files:**
- Modify: `static/review/digest.js` (add helper + export, `:23` region)
- Test: `tests/buildReview.test.js`

**Interfaces:**
- Produces: `plusDaysISO(n: number, base?: Date) -> string` — returns local date `base` (default now) plus `n` days as `YYYY-MM-DD`. Exposed both on `window.plusDaysISO` and `module.exports`.

- [ ] **Step 1: Write the failing test**

Add to `tests/buildReview.test.js` (extend the require on line 3 and add a test):

```javascript
const { buildReview, plusDaysISO } = require("../static/review/digest.js");

test("plusDaysISO adds days and formats YYYY-MM-DD", () => {
  const base = new Date("2026-06-25T10:00:00");
  assert.equal(plusDaysISO(7, base), "2026-07-02");
  assert.equal(plusDaysISO(0, base), "2026-06-25");
  assert.match(plusDaysISO(7), /^\d{4}-\d{2}-\d{2}$/);
});
```

(Replace the existing `const { buildReview } = require(...)` line on `tests/buildReview.test.js:3` with the destructuring above.)

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/buildReview.test.js`
Expected: FAIL — `plusDaysISO is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `static/review/digest.js`, before the `module.exports` block, add:

```javascript
function plusDaysISO(n, base) {
  const d = base ? new Date(base) : new Date();
  d.setDate(d.getDate() + n);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
```

Then update the exports. Change the existing tail:

```javascript
if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildReview, plusDaysISO };
} else {
  try { window.buildReview = buildReview; window.plusDaysISO = plusDaysISO; } catch (e) {}
}
```

(Match the existing export structure in the file — only add `plusDaysISO` alongside `buildReview` in both branches.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/buildReview.test.js`
Expected: PASS (buckets + plusDaysISO).

- [ ] **Step 5: Commit**

```bash
git add static/review/digest.js tests/buildReview.test.js
git commit -m "feat(review): add plusDaysISO date helper for snooze action"
```

---

### Task 4: Frontend — undo-capable Toast + showToast signature

**Files:**
- Modify: `static/index.html` — `Toast` component (`:1727-1739`), `showToast` (`:21320-21323`)

**Interfaces:**
- Produces: `showToast(message, type = "success", action = null)` where `action` is `{ label: string, onClick: () => void }` or null. `Toast` renders an undo button when `toast.action` is set and stays ~6s (vs 3s) in that case. Backward compatible.
- Consumes: existing `setToast(...)` state and the `Toast` render site (`:22559-22562`).

- [ ] **Step 1: Update the Toast component**

Replace `Toast` (`static/index.html:1727-1739`) with:

```javascript
function Toast({
  message,
  type,
  action,
  onClose
}) {
  useEffect(() => {
    const t = setTimeout(onClose, action ? 6000 : 3000);
    return () => clearTimeout(t);
  }, []);
  return /*#__PURE__*/React.createElement("div", {
    className: `toast toast-${type}`
  }, message, action && /*#__PURE__*/React.createElement("button", {
    onClick: () => { action.onClick(); onClose(); },
    style: { marginLeft: 12, background: "none", border: "1px solid rgba(255,255,255,0.5)", color: "inherit", borderRadius: 6, padding: "2px 10px", cursor: "pointer", fontSize: 13, fontWeight: 600 }
  }, action.label));
}
```

- [ ] **Step 2: Update showToast and its render site**

Change `showToast` (`static/index.html:21320-21323`) to:

```javascript
  const showToast = (message, type = "success", action = null) => setToast({
    message,
    type,
    action
  });
```

Then update the `Toast` render site (`static/index.html:22559-22562`) to pass the action:

```javascript
  }), toast && /*#__PURE__*/React.createElement(Toast, {
    message: toast.message,
    type: toast.type,
    action: toast.action,
    onClose: () => setToast(null)
  }),
```

- [ ] **Step 3: Verify the app still loads (no behavior regression)**

Run: `python -c "import ai_review"` is not relevant here; instead syntax-check by loading the page. Manual: start the web app, confirm an existing toast (e.g. create a task) still appears and auto-dismisses. No undo button on 2-arg calls.

- [ ] **Step 4: Commit**

```bash
git add static/index.html
git commit -m "feat(ui): optional undo action on Toast / showToast (backward compatible)"
```

---

### Task 5: Frontend — 1-tap row actions wired with undo

**Files:**
- Modify: `static/index.html` — `taskRow` (`:20942-20957`), section render calls (`:20914-20020` region), App-scope handlers near `handleReviewCreate` (`:21938`), `WeeklyReview` props (mount `:22592` and signature `:20902`)

**Interfaces:**
- Consumes: `plusDaysISO` (Task 3, available as `window.plusDaysISO`), `showToast(message, type, action)` (Task 4), `window.__refreshTasks`, `api.put`, `api.post`, `api.del`.
- Produces: three App handlers passed as props to `WeeklyReview`:
  - `onReschedule(task)` — `PUT /api/tasks/{id} {deadline: plusDaysISO(7)}`, undo restores `task.deadline`.
  - `onClarifyNext(task)` — `PUT /api/tasks/{id} {gtd_status:"next"}`, undo restores `"inbox"`.
  - `onFollowUp(task)` — `POST /api/tasks {title:"Tindak lanjut: "+title, gtd_status:"next", project, priority:"P3"}`, undo `api.del('/api/tasks/{newId}')`.

- [ ] **Step 1: Add the three handlers at App scope**

After `handleReviewFocus` (`static/index.html:21942-21945`), add:

```javascript
  const handleReviewReschedule = (task) => {
    const prev = task.deadline || null;
    api.put(`/api/tasks/${task.id}`, { deadline: window.plusDaysISO(7) })
      .then(() => { if (window.__refreshTasks) window.__refreshTasks();
        showToast("Ditunda 1 minggu ⏰", "success", { label: "Undo", onClick: () =>
          api.put(`/api/tasks/${task.id}`, { deadline: prev })
            .then(() => { if (window.__refreshTasks) window.__refreshTasks(); }) }); })
      .catch(() => showToast("Gagal menunda", "error"));
  };
  const handleReviewClarifyNext = (task) => {
    api.put(`/api/tasks/${task.id}`, { gtd_status: "next" })
      .then(() => { if (window.__refreshTasks) window.__refreshTasks();
        showToast("Jadi Next ✅", "success", { label: "Undo", onClick: () =>
          api.put(`/api/tasks/${task.id}`, { gtd_status: "inbox" })
            .then(() => { if (window.__refreshTasks) window.__refreshTasks(); }) }); })
      .catch(() => showToast("Gagal mengubah status", "error"));
  };
  const handleReviewFollowUp = (task) => {
    api.post("/api/tasks", { title: "Tindak lanjut: " + (task.title || ""), gtd_status: "next", project: task.project || "", priority: "P3" })
      .then((created) => { if (window.__refreshTasks) window.__refreshTasks();
        const newId = created && created.id;
        showToast("Next-action dibuat ✅", "success", newId ? { label: "Undo", onClick: () =>
          api.del(`/api/tasks/${newId}`)
            .then(() => { if (window.__refreshTasks) window.__refreshTasks(); }) } : null); })
      .catch(() => showToast("Gagal membuat next-action", "error"));
  };
```

Note: the repo's HTTP helper exposes delete as `api.del(url)` (`static/index.html:1598`), not `api.delete`. Used above.

- [ ] **Step 2: Pass the handlers to WeeklyReview**

Update the mount (`static/index.html:22592`) to add the three props:

```javascript
aiReviewOn() && /*#__PURE__*/React.createElement(WeeklyReview, { tasks: tasks, onTaskClick: setSelectedTask, showToast: showToast, onCreateTask: handleReviewCreate, onAddFocus: handleReviewFocus, onReschedule: handleReviewReschedule, onClarifyNext: handleReviewClarifyNext, onFollowUp: handleReviewFollowUp })
```

And update the component signature (`static/index.html:20902`):

```javascript
function WeeklyReview({ tasks, onTaskClick, showToast, onCreateTask, onAddFocus, onReschedule, onClarifyNext, onFollowUp }) {
```

- [ ] **Step 3: Parametrize taskRow to accept an optional action button**

Change `taskRow` (`static/index.html:20942`) signature and append an optional action button after the existing ⭐ button. Replace the `taskRow` definition with a version taking a second arg:

```javascript
  const taskRow = (t, extraAction) => /*#__PURE__*/React.createElement("div", {
    key: t.id, className: "task-row",
    style: { cursor: "pointer", padding: "8px 0", display: "flex", alignItems: "center", gap: 10 },
    onClick: () => { setOpen(false); if (onTaskClick) onTaskClick(t); }
  },
    t.priority && /*#__PURE__*/React.createElement("span", { title: t.priority, style: { width: 8, height: 8, borderRadius: "50%", background: (PRI_DOT[t.priority] || "var(--text-light)"), flexShrink: 0 } }),
    /*#__PURE__*/React.createElement("div", { style: { flex: 1, minWidth: 0 } },
      /*#__PURE__*/React.createElement("div", { style: { fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, t.title || "(tanpa judul)"),
      (dlabel(t) || t.project) && /*#__PURE__*/React.createElement("div", { style: { fontSize: 11, color: "var(--text-light)", display: "flex", gap: 8, marginTop: 1, flexWrap: "wrap" } },
        dlabel(t) && /*#__PURE__*/React.createElement("span", { style: { color: t.is_overdue ? "#ef4444" : "var(--text-light)" } }, "⏰ " + dlabel(t)),
        t.project && /*#__PURE__*/React.createElement("span", null, "#" + t.project))),
    extraAction && /*#__PURE__*/React.createElement("button", {
      onClick: (e) => { e.stopPropagation(); extraAction.onClick(t); },
      style: { background: "none", border: "1px solid var(--border)", borderRadius: 7, cursor: "pointer", color: "var(--text-secondary)", padding: "3px 9px", flexShrink: 0, fontSize: 12, fontWeight: 600 }
    }, extraAction.label),
    onAddFocus && !t.is_focused && /*#__PURE__*/React.createElement("button", {
      title: "Tambah ke Fokus", onClick: (e) => { e.stopPropagation(); onAddFocus(t.id); },
      style: { background: "none", border: "1px solid var(--border)", borderRadius: 7, cursor: "pointer", color: "var(--text-light)", padding: "3px 7px", flexShrink: 0, display: "flex", alignItems: "center" }
    }, /*#__PURE__*/React.createElement(Icon, { name: "star", size: 13 }))
  );
```

- [ ] **Step 4: Attach section-specific actions**

Update the three relevant `Section(...)` calls (`static/index.html:21014-21020`). The `Section` helper passes its `render` fn each item, so bind the action via a wrapper:

```javascript
      Section("Get Clear \xB7 Inbox", r.inbox, (t) => taskRow(t, { label: "Jadikan Next", onClick: onClarifyNext })),
      Section("Overdue", r.overdue, (t) => taskRow(t, { label: "Tunda 1mg", onClick: onReschedule })),
      Section("Selesai minggu ini", r.doneThisWeek, taskRow),
      Section("Next Actions mandek", r.staleNext, taskRow),
      Section("Waiting For", r.waiting, (t) => taskRow(t, { label: "Tindak lanjut", onClick: onFollowUp })),
      Section("Jatuh tempo minggu depan", r.dueNextWeek, taskRow),
      Section("Someday / Maybe", r.someday, taskRow),
```

(Leave the other `Section` calls passing bare `taskRow` — `extraAction` is undefined and no button renders.)

- [ ] **Step 5: Manual verification in the running app**

Start the app, open Weekly Review with data that has overdue/inbox/waiting tasks:
1. Overdue row → "Tunda 1mg" → row leaves Overdue, toast "Ditunda 1 minggu" with Undo; Undo restores it.
2. Inbox row → "Jadikan Next" → leaves Inbox; Undo returns to Inbox.
3. Waiting row → "Tindak lanjut" → new "Tindak lanjut: …" next-action appears in task list; Undo deletes it.
Confirm clicking a row body still opens the task (button `stopPropagation` works).

- [ ] **Step 6: Commit**

```bash
git add static/index.html
git commit -m "feat(review): 1-tap snooze/clarify/follow-up row actions with undo"
```

---

### Task 6: Release — SW cache bump + full test sweep

**Files:**
- Modify: `static/sw.js:1`
- Verify: all test suites

- [ ] **Step 1: Bump the SW cache version**

In `static/sw.js:1`, change:

```javascript
const CACHE = "taskflow-v175-review-enriched";
```

to:

```javascript
const CACHE = "taskflow-v176-review-actions";
```

- [ ] **Step 2: Run the full backend + node suites**

Run: `python -m pytest tests/test_ai_review.py tests/test_bookmark.py -q`
Expected: PASS.

Run: `node --test tests/buildReview.test.js`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add static/sw.js
git commit -m "chore(sw): bump cache v175 -> v176 for review actions"
```

- [ ] **Step 4: Push**

```bash
git push origin main
```

- [ ] **Step 5: Post-deploy live verification**

After deploy pulls main: `curl -s https://todo.yatno.web.id/static/sw.js | head -1` shows `taskflow-v176-review-actions`. Open the app, hard-reload, run Weekly Review, confirm the three 1-tap actions + undo work live and the AI summary references overdue/P1 pileups when present.

---

## Self-Review Notes

- **Spec coverage:** Part 1 (1-tap actions) → Tasks 3+5; Part 2 (undo toast) → Task 4; Part 3 (sharper AI: signals + prompt) → Tasks 1+2; testing/release → Task 6. All spec sections mapped.
- **Type consistency:** `plusDaysISO` (Task 3) used in Task 5; `showToast(message, type, action)` (Task 4) used in Task 5; `signals` keys (`p1_overdue`, `oldest_overdue_days`, `projects_without_next`) defined in Task 1 and referenced verbatim in the Task 2 prompt. Handler names (`handleReviewReschedule/ClarifyNext/FollowUp`) and props (`onReschedule/onClarifyNext/onFollowUp`) consistent between Task 5 steps 1-2 and the component signature.
- **Resolved:** the `api` helper's delete method is `api.del(url)` (`static/index.html:1598`) — used in Task 5.
```
