# Weekly Review v2 (Actionable Redesign) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Weekly Review as a desktop-only view: a thin condition strip (local Health Score + 1-line AI verdict) over a single locally-ordered action queue with context-aware row actions; reshape the AI output to `{verdict, annotations}` and remove the old read-only sections.

**Architecture:** Pure ordering/scoring logic lives in `static/review/digest.js` (node-tested). The AI layer in `ai_review.py` is reshaped (schema + prompt) but `build_payload`/`signals` are reused unchanged. The `WeeklyReview` React component in `static/index.html` is rebuilt to consume the pure helpers + reshaped AI, reusing the Package A action handlers and adding two new ones. The review stays fully functional with AI off (score + queue are local).

**Tech Stack:** Python (pytest), React via in-browser Babel (`React.createElement`, no JSX), plain-script `static/review/digest.js` (node:test), service-worker cache versioning.

## Global Constraints

- Desktop-only feature (Tauri .exe + PWA). Do not add mobile-specific layout.
- Tasks-only privacy: `ai_review.py` never imports/reads notes/scratchpad; only whitelisted task fields + aggregate `signals` leave the server. Whitelist (verbatim): `id, title, description, gtd_status, quadrant, priority, deadline, project, age_days, is_overdue`.
- Ordering is local & deterministic; AI annotates only (never orders).
- Review must remain functional with AI disabled/failed: Health Score + action queue are computed locally; only `verdict` and per-row annotations are absent.
- Reuse existing endpoints only: `PUT /api/tasks/{id}` (partial update), `POST /api/tasks`, `POST /api/tasks/{id}/focus`. No new backend routes.
- No new frontend dependencies. React via `React.createElement` matching surrounding code. No charting library — the Health Score ring is a CSS `conic-gradient`.
- Button copy (Indonesian, verbatim): overdue=`Tunda 1mg`, due/priority=`Fokus`, inbox=`Jadikan Next`, stalled project=`Buat next-action`, P1-no-deadline=`Set deadline`, complete=`✓`, open=`Buka`, finish=`Selesai Review`.
- Health Score bands: `>=80` green `#16a34a` "Tenang"; `50–79` amber `#f59e0b` "Waspada"; `<50` red `#dc2626` "Genting".
- Current SW cache is `const CACHE = "taskflow-v176-review-actions";` (`static/sw.js:1`) → bump to `taskflow-v177-review-v2`.

---

### Task 1: Health Score (pure, node-tested)

**Files:**
- Modify: `static/review/digest.js` (add functions + exports)
- Test: `tests/buildReview.test.js`

**Interfaces:**
- Produces: `computeHealthScore(m) -> number` where `m = { overdue, active, p1_overdue, projects_without_next, stale_next }` (all numbers); returns an integer clamped to `[0,100]`. And `healthBand(score) -> { label, color }`. Both exposed on `module.exports` and `window.*`.

- [ ] **Step 1: Write the failing tests**

In `tests/buildReview.test.js`, change the require on line 3 to include the new names, and add tests:

```javascript
const { buildReview, plusDaysISO, computeHealthScore, healthBand } = require("../static/review/digest.js");

test("computeHealthScore clean board is 100 / Tenang", () => {
  const s = computeHealthScore({ overdue: 0, active: 10, p1_overdue: 0, projects_without_next: 0, stale_next: 0 });
  assert.equal(s, 100);
  assert.equal(healthBand(s).label, "Tenang");
});

test("computeHealthScore penalizes overdue/P1/stalled and clamps", () => {
  const s = computeHealthScore({ overdue: 20, active: 25, p1_overdue: 5, projects_without_next: 3, stale_next: 5 });
  // 100 - min(40,round(40*20/25=32))=32 - min(24,40)=24 - min(18,18)=18 - min(10,10)=10 => 16
  assert.equal(s, 16);
  assert.equal(healthBand(s).label, "Genting");
  const floor = computeHealthScore({ overdue: 100, active: 1, p1_overdue: 99, projects_without_next: 99, stale_next: 99 });
  assert.equal(floor, 0);
});

test("healthBand boundaries", () => {
  assert.equal(healthBand(80).label, "Tenang");
  assert.equal(healthBand(79).label, "Waspada");
  assert.equal(healthBand(50).label, "Waspada");
  assert.equal(healthBand(49).label, "Genting");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/buildReview.test.js`
Expected: FAIL — `computeHealthScore is not a function`.

- [ ] **Step 3: Implement**

In `static/review/digest.js`, after `plusDaysISO` (line 29) and before the export block, add:

```javascript
function computeHealthScore(m) {
  const active = Math.max(1, m.active || 0);
  let score = 100;
  score -= Math.min(40, Math.round(40 * (m.overdue || 0) / active));
  score -= Math.min(24, 8 * (m.p1_overdue || 0));
  score -= Math.min(18, 6 * (m.projects_without_next || 0));
  score -= Math.min(10, 2 * (m.stale_next || 0));
  return Math.max(0, Math.min(100, score));
}

function healthBand(score) {
  if (score >= 80) return { label: "Tenang", color: "#16a34a" };
  if (score >= 50) return { label: "Waspada", color: "#f59e0b" };
  return { label: "Genting", color: "#dc2626" };
}
```

Update the export block (currently `module.exports = { buildReview, plusDaysISO };` and the `window.*` branch) to also export the two new functions:

```javascript
if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildReview, plusDaysISO, computeHealthScore, healthBand };
} else {
  try {
    window.buildReview = buildReview; window.plusDaysISO = plusDaysISO;
    window.computeHealthScore = computeHealthScore; window.healthBand = healthBand;
  } catch (e) {}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/buildReview.test.js`
Expected: PASS (existing buildReview/plusDaysISO + new health tests).

- [ ] **Step 5: Commit**

```bash
git add static/review/digest.js tests/buildReview.test.js
git commit -m "feat(review): local Health Score + band helpers"
```

---

### Task 2: Action Queue builder (pure, node-tested)

**Files:**
- Modify: `static/review/digest.js` (add function + exports)
- Test: `tests/buildReview.test.js`

**Interfaces:**
- Produces: `buildActionQueue(tasks, cap) -> { items, overflow }`. `items` is an ordered, de-duplicated array; each element is either a task item `{ task, type }` with `type ∈ {overdue, due_soon, priority, inbox}` or a project item `{ project, type: "stalled_project" }`. `overflow` is the count beyond `cap` (default 15). Exposed on `module.exports` and `window.*`.

- [ ] **Step 1: Write the failing tests**

Add to `tests/buildReview.test.js` (and include `buildActionQueue` in the require destructuring from Task 1):

```javascript
const { buildActionQueue } = require("../static/review/digest.js"); // add to existing destructure

const aq_ago = (d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);
const aq_in = (d) => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);

test("buildActionQueue orders, dedups, and tags types", () => {
  const tasks = [
    { id: 1, gtd_status: "next", is_overdue: true, priority: "P1", deadline: aq_ago(10) }, // overdue+P1 -> once, overdue
    { id: 2, gtd_status: "next", is_overdue: false, deadline: aq_in(3) },                   // due_soon
    { id: 3, gtd_status: "next", priority: "P1" },                                          // priority (no deadline)
    { id: 4, gtd_status: "inbox" },                                                         // inbox
    { id: 5, gtd_status: "next", project: "Stuck" },                                        // stalled project (no 'next'? it IS next) -> NOT stalled
    { id: 6, gtd_status: "waiting", project: "Stalled" },                                   // project Stalled has no 'next' -> stalled_project
  ];
  const { items } = buildActionQueue(tasks, 15);
  // task 1 appears once, as overdue, and first
  const ids = items.filter(i => i.task).map(i => i.task.id);
  assert.equal(ids.filter(x => x === 1).length, 1);
  assert.equal(items[0].type, "overdue");
  assert.equal(items[0].task.id, 1);
  // ordering: overdue(1) -> due_soon(2) -> priority(3) -> inbox(4)
  assert.deepEqual(ids, [1, 2, 3, 4]);
  // one stalled project item for "Stalled", none for "Stuck"
  const projs = items.filter(i => i.type === "stalled_project").map(i => i.project);
  assert.deepEqual(projs, ["Stalled"]);
});

test("buildActionQueue caps and reports overflow", () => {
  const tasks = [];
  for (let i = 0; i < 20; i++) tasks.push({ id: i, gtd_status: "inbox" });
  const { items, overflow } = buildActionQueue(tasks, 15);
  assert.equal(items.length, 15);
  assert.equal(overflow, 5);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/buildReview.test.js`
Expected: FAIL — `buildActionQueue is not a function`.

- [ ] **Step 3: Implement**

In `static/review/digest.js`, after `healthBand` and before the export block, add:

```javascript
function buildActionQueue(tasks, cap) {
  const limit = cap || 15;
  const today = new Date();
  const days = (iso) => iso ? Math.floor((today - new Date(String(iso).replace("Z", ""))) / 864e5) : null;
  const active = (t) => t.gtd_status !== "done" && t.gtd_status !== "archived";
  const byDeadline = (a, b) => String(a.deadline || "").localeCompare(String(b.deadline || ""));
  const seen = new Set();
  const items = [];
  const push = (t, type) => { if (!seen.has(t.id)) { seen.add(t.id); items.push({ task: t, type }); } };
  tasks.filter(t => t.is_overdue && active(t)).sort(byDeadline).forEach(t => push(t, "overdue"));
  tasks.filter(t => active(t) && !t.is_overdue && t.deadline && days(t.deadline) !== null && days(t.deadline) <= 0 && days(t.deadline) >= -7)
    .sort(byDeadline).forEach(t => push(t, "due_soon"));
  tasks.filter(t => active(t) && (t.priority === "P1" || t.quadrant === "Q1")).forEach(t => push(t, "priority"));
  tasks.filter(t => t.gtd_status === "inbox").forEach(t => push(t, "inbox"));
  const byProj = {};
  tasks.filter(t => active(t) && t.project).forEach(t => { (byProj[t.project] = byProj[t.project] || []).push(t); });
  const stalled = Object.entries(byProj)
    .filter(([, ts]) => !ts.some(t => t.gtd_status === "next"))
    .map(([project]) => ({ project, type: "stalled_project" }));
  const all = items.concat(stalled);
  return { items: all.slice(0, limit), overflow: Math.max(0, all.length - limit) };
}
```

Add `buildActionQueue` to BOTH export branches (alongside the Task 1 additions):

```javascript
if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildReview, plusDaysISO, computeHealthScore, healthBand, buildActionQueue };
} else {
  try {
    window.buildReview = buildReview; window.plusDaysISO = plusDaysISO;
    window.computeHealthScore = computeHealthScore; window.healthBand = healthBand;
    window.buildActionQueue = buildActionQueue;
  } catch (e) {}
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/buildReview.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add static/review/digest.js tests/buildReview.test.js
git commit -m "feat(review): local action-queue builder (ordered, deduped, capped)"
```

---

### Task 3: Reshape AI to {verdict, annotations}

**Files:**
- Modify: `ai_review.py` (`REVIEW_SCHEMA` lines 66-103, `REVIEW_SYSTEM_PROMPT` lines 105-120)
- Test: `tests/test_ai_review.py`

**Interfaces:**
- Produces: `REVIEW_SCHEMA` with exactly top-level `verdict` (string) + `annotations` (array of `{task_id, note}`), both required. `REVIEW_SYSTEM_PROMPT` instructing the model to output only those two. `build_payload`/`signals` and `parse_review_content` are UNCHANGED.

- [ ] **Step 1: Update the schema test (failing) + add a prompt test**

In `tests/test_ai_review.py`, REPLACE `test_schema_is_strict_object` with:

```python
def test_schema_is_verdict_annotations():
    s = ai_review.REVIEW_SCHEMA
    assert s["type"] == "object"
    assert s["additionalProperties"] is False
    assert set(s["properties"].keys()) == {"verdict", "annotations"}
    assert set(s["required"]) == {"verdict", "annotations"}
    ann = s["properties"]["annotations"]["items"]
    assert set(ann["properties"].keys()) == {"task_id", "note"}
```

And REPLACE the existing `test_prompt_mentions_quadrant_and_overdue_priority` body with:

```python
def test_prompt_mentions_quadrant_and_overdue_priority():
    p = ai_review.REVIEW_SYSTEM_PROMPT.lower()
    assert "quadrant" in p
    assert "p1" in p and "overdue" in p
    assert "signals" in p
    assert "verdict" in p and "annotations" in p
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_ai_review.py::test_schema_is_verdict_annotations tests/test_ai_review.py::test_prompt_mentions_quadrant_and_overdue_priority -v`
Expected: FAIL (old schema has summary/focus_suggestions/...; prompt lacks "annotations").

- [ ] **Step 3: Implement the new schema + prompt**

In `ai_review.py`, replace `REVIEW_SCHEMA` (lines 66-103) with:

```python
REVIEW_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "verdict": {"type": "string"},
        "annotations": {
            "type": "array",
            "items": {
                "type": "object", "additionalProperties": False,
                "properties": {"task_id": {"type": "string"},
                               "note": {"type": "string"}},
                "required": ["task_id", "note"],
            },
        },
    },
    "required": ["verdict", "annotations"],
}
```

And replace `REVIEW_SYSTEM_PROMPT` (lines 105-120) with:

```python
REVIEW_SYSTEM_PROMPT = (
    "Kamu asisten GTD untuk aplikasi task. Berdasarkan ringkasan TUGAS user "
    "(judul, status GTD, quadrant Eisenhower, prioritas, deadline, project, umur) "
    "dan blok 'signals' (agregat: p1_overdue, oldest_overdue_days, "
    "projects_without_next), bantu user me-review minggunya dalam Bahasa Indonesia. "
    "Keluaranmu HANYA detailing; aplikasi sudah menyusun antrian aksinya sendiri.\n"
    "- verdict: TEPAT 1 kalimat kondisi minggu ini. Jika signals.p1_overdue > 0 "
    "  atau banyak task Q1 overdue, sebut tumpukan itu sebagai titik macet utama.\n"
    "- annotations: maksimal 5 item untuk task PALING layak ditindak. Tiap item "
    "  {task_id, note}; note = 1 baris singkat 'kenapa penting / lakukan apa' "
    "  (kata kerja di depan). task_id WAJIB dari daftar yang diberikan; jangan "
    "  mengarang id.\n"
    "Jangan menyertakan data selain yang diberikan. Ringkas dan actionable."
)
```

Also update the user-message JSON shape hint inside `generate_review` so it matches the new schema. In `ai_review.py`, find the `user_msg` block (the line that begins `+ "\n\nBalas HANYA dengan satu objek JSON valid sesuai skema: "`) and replace its schema literal with:

```python
    user_msg = (
        json.dumps(payload, ensure_ascii=False)
        + "\n\nBalas HANYA dengan satu objek JSON valid sesuai skema: "
        '{"verdict": str, "annotations": [{"task_id": str, "note": str}]}. '
        "Tanpa teks atau markdown apa pun di luar JSON."
    )
```

- [ ] **Step 4: Run the full backend suite to verify pass**

Run: `python -m pytest tests/test_ai_review.py -v`
Expected: PASS (schema/prompt updated; `build_payload`/`signals`/privacy/parse tests still green).

- [ ] **Step 5: Commit**

```bash
git add ai_review.py tests/test_ai_review.py
git commit -m "feat(ai): reshape review output to {verdict, annotations} (detailing only)"
```

---

### Task 4: Rebuild the WeeklyReview component (condition strip + action queue)

**Files:**
- Modify: `static/index.html` — add two App handlers after `handleReviewFollowUp`; replace the entire `WeeklyReview` component; update the `WeeklyReview` mount props.

**Interfaces:**
- Consumes: `window.buildReview`, `window.computeHealthScore`, `window.healthBand`, `window.buildActionQueue` (Tasks 1-2); reshaped `POST /api/ai/review` → `{verdict, annotations:[{task_id,note}]}` (Task 3); Package A handlers `handleReviewReschedule`, `handleReviewClarifyNext`, `handleReviewFocus`, `handleReviewCreate`; `showToast(message,type,action)`; `window.__refreshTasks`; `api.put/post`.
- Produces: two new App handlers `handleReviewComplete(task)`, `handleReviewSetDeadline(task)`; a rebuilt `WeeklyReview` consuming props `{ tasks, onTaskClick, showToast, onAddFocus, onReschedule, onClarifyNext, onCreate, onSetDeadline, onComplete }`.

NOTE: Package A's `handleReviewFollowUp` is no longer wired (the v2 queue has no "waiting follow-up" row). Leave the handler defined; it is harmless and may be reused. Do not delete unrelated code.

CRITICAL: line numbers below are approximate (Package A shifted them). Locate each site by searching for the named anchors and match the current code before editing. Use the `React.createElement` (no-JSX) style throughout.

- [ ] **Step 1: Add the two new App handlers**

Find `handleReviewFollowUp` (search for `const handleReviewFollowUp =`). Immediately AFTER its closing `};`, add:

```javascript
  const handleReviewComplete = (task) => {
    const prev = task.gtd_status;
    api.put(`/api/tasks/${task.id}`, { gtd_status: "done" })
      .then(() => { if (window.__refreshTasks) window.__refreshTasks();
        showToast("Selesai ✅", "success", { label: "Undo", onClick: () =>
          api.put(`/api/tasks/${task.id}`, { gtd_status: prev })
            .then(() => { if (window.__refreshTasks) window.__refreshTasks(); }) }); })
      .catch(() => showToast("Gagal menyelesaikan", "error"));
  };
  // Set-deadline has no undo: PUT ignores a null deadline, so an originally
  // null deadline cannot be restored. Only offered on P1 rows without a deadline.
  const handleReviewSetDeadline = (task) => {
    api.put(`/api/tasks/${task.id}`, { deadline: window.plusDaysISO(7) })
      .then(() => { if (window.__refreshTasks) window.__refreshTasks();
        showToast("Deadline diset +7 hari ⏰", "success"); })
      .catch(() => showToast("Gagal set deadline", "error"));
  };
```

- [ ] **Step 2: Replace the entire WeeklyReview component**

Find `function WeeklyReview(` and replace the WHOLE function (from `function WeeklyReview(` through its final closing `}` before the next top-level `function`/comment — currently ends just before the `AttachmentViewer` comment block) with:

```javascript
function WeeklyReview({ tasks, onTaskClick, showToast, onAddFocus, onReschedule, onClarifyNext, onCreate, onSetDeadline, onComplete }) {
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
  const [ai, setAi] = React.useState(null);
  const [aiBusy, setAiBusy] = React.useState(false);
  const [aiErr, setAiErr] = React.useState("");
  const [showAll, setShowAll] = React.useState(false);
  const runAI = async () => {
    setAiBusy(true); setAiErr("");
    try { setAi(await api.post("/api/ai/review", {})); }
    catch (e) { setAiErr(navigator.onLine ? "Gagal membuat ringkasan AI" : "Perlu online untuk ringkasan AI"); }
    finally { setAiBusy(false); }
  };
  if (!open) return null;
  const r = buildReview(tasks || []);
  const activeCount = (tasks || []).filter(t => t.gtd_status !== "done" && t.gtd_status !== "archived").length;
  const p1Overdue = r.overdue.filter(t => t.priority === "P1").length;
  const score = computeHealthScore({ overdue: r.overdue.length, active: activeCount, p1_overdue: p1Overdue, projects_without_next: r.projectsNoNext.length, stale_next: r.staleNext.length });
  const band = healthBand(score);
  const q = buildActionQueue(tasks || [], showAll ? 999 : 15);
  const annotFor = (id) => { if (!ai || !ai.annotations) return null; const a = ai.annotations.find(x => String(x.task_id) === String(id)); return a ? a.note : null; };
  const finish = () => { try { localStorage.setItem("tf_last_review", new Date().toISOString()); } catch (e) {} setOpen(false); showToast && showToast("Review selesai ✅"); };
  const dlabel = (t) => { if (!t.deadline) return null; const d = Math.floor((new Date(String(t.deadline).slice(0, 10)) - new Date(new Date().toISOString().slice(0, 10))) / 864e5); if (d < 0) return `${-d} hari lalu`; if (d === 0) return "hari ini"; return `${d} hari lagi`; };
  const primary = (item) => {
    const t = item.task;
    switch (item.type) {
      case "overdue": return { label: "Tunda 1mg", run: () => onReschedule(t) };
      case "due_soon": return { label: "Fokus", run: () => onAddFocus(t.id) };
      case "priority": return (!t.deadline) ? { label: "Set deadline", run: () => onSetDeadline(t) } : { label: "Fokus", run: () => onAddFocus(t.id) };
      case "inbox": return { label: "Jadikan Next", run: () => onClarifyNext(t) };
      default: return null;
    }
  };
  const TYPE_BADGE = { overdue: ["Overdue", "#dc2626"], due_soon: ["Due", "#f59e0b"], priority: ["Prioritas", "#7c3aed"], inbox: ["Inbox", "#2563eb"], stalled_project: ["Mandek", "#0891b2"] };
  const open_task = (t) => { setOpen(false); if (onTaskClick) onTaskClick(t); };
  const taskItem = (item) => {
    const t = item.task;
    const badge = TYPE_BADGE[item.type] || ["", ""];
    const act = primary(item);
    const note = annotFor(t.id);
    return /*#__PURE__*/React.createElement("div", { key: "t" + t.id, className: "task-row", style: { display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--border)" } },
      /*#__PURE__*/React.createElement("span", { style: { fontSize: 10, fontWeight: 700, color: badge[1], border: `1px solid ${badge[1]}`, borderRadius: 5, padding: "1px 6px", flexShrink: 0, marginTop: 2 } }, badge[0]),
      /*#__PURE__*/React.createElement("div", { style: { flex: 1, minWidth: 0, cursor: "pointer" }, onClick: () => open_task(t) },
        /*#__PURE__*/React.createElement("div", { style: { fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, t.title || "(tanpa judul)"),
        (dlabel(t) || t.project) && /*#__PURE__*/React.createElement("div", { style: { fontSize: 11, color: "var(--text-light)", display: "flex", gap: 8, marginTop: 1, flexWrap: "wrap" } },
          dlabel(t) && /*#__PURE__*/React.createElement("span", { style: { color: t.is_overdue ? "#ef4444" : "var(--text-light)" } }, "⏰ " + dlabel(t)),
          t.project && /*#__PURE__*/React.createElement("span", null, "#" + t.project)),
        note && /*#__PURE__*/React.createElement("div", { style: { fontSize: 12, fontStyle: "italic", color: "var(--accent)", marginTop: 3 } }, "✦ " + note)),
      /*#__PURE__*/React.createElement("div", { style: { display: "flex", gap: 6, flexShrink: 0 } },
        act && /*#__PURE__*/React.createElement("button", { className: "btn btn-secondary btn-sm", onClick: (e) => { e.stopPropagation(); act.run(); } }, act.label),
        /*#__PURE__*/React.createElement("button", { className: "btn btn-secondary btn-sm", title: "Selesai", onClick: (e) => { e.stopPropagation(); onComplete(t); } }, "✓"),
        /*#__PURE__*/React.createElement("button", { className: "btn btn-sm", style: { border: "1px solid var(--border)", background: "none" }, title: "Buka", onClick: (e) => { e.stopPropagation(); open_task(t); } }, "Buka")));
  };
  const projItem = (item) => /*#__PURE__*/React.createElement("div", { key: "p" + item.project, className: "task-row", style: { display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--border)" } },
    /*#__PURE__*/React.createElement("span", { style: { fontSize: 10, fontWeight: 700, color: "#0891b2", border: "1px solid #0891b2", borderRadius: 5, padding: "1px 6px", flexShrink: 0 } }, "Mandek"),
    /*#__PURE__*/React.createElement("div", { style: { flex: 1, minWidth: 0, fontSize: 14 } }, "Proyek tanpa next-action: #" + item.project),
    /*#__PURE__*/React.createElement("button", { className: "btn btn-primary btn-sm", onClick: () => onCreate({ title: "Next action: " + item.project, project: item.project }) }, "Buat next-action"));
  return /*#__PURE__*/React.createElement("div", { style: { position: "fixed", inset: 0, zIndex: 10060, background: "var(--bg-page)", display: "flex", flexDirection: "column" } },
    /*#__PURE__*/React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, flexShrink: 0, borderBottom: "1px solid var(--border)", padding: "calc(12px + env(safe-area-inset-top,0px)) calc(16px + env(safe-area-inset-right,0px)) 12px calc(16px + env(safe-area-inset-left,0px))" } },
      /*#__PURE__*/React.createElement("span", { style: { flex: 1, fontSize: 18, fontWeight: 700, display: "flex", alignItems: "center", gap: 9 } }, /*#__PURE__*/React.createElement(Icon, { name: "list", size: 20 }), "Review Mingguan"),
      /*#__PURE__*/React.createElement("button", { className: "btn btn-primary btn-sm", onClick: finish }, "Selesai Review"),
      /*#__PURE__*/React.createElement("button", { onClick: () => setOpen(false), style: { background: "none", border: "none", cursor: "pointer", display: "flex" } }, /*#__PURE__*/React.createElement(Icon, { name: "x", size: 20 }))),
    /*#__PURE__*/React.createElement("div", { style: { flex: 1, overflow: "auto", maxWidth: 880, margin: "0 auto", width: "100%", padding: "18px calc(20px + env(safe-area-inset-right,0px)) calc(24px + env(safe-area-inset-bottom,0px)) calc(20px + env(safe-area-inset-left,0px))" } },
      /*#__PURE__*/React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 16, padding: 16, border: "1px solid var(--border)", borderRadius: 12, background: "var(--bg-card)", marginBottom: 18 } },
        /*#__PURE__*/React.createElement("div", { style: { position: "relative", width: 72, height: 72, flexShrink: 0, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: `conic-gradient(${band.color} ${score * 3.6}deg, var(--border) 0deg)` } },
          /*#__PURE__*/React.createElement("div", { style: { width: 56, height: 56, borderRadius: "50%", background: "var(--bg-card)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" } },
            /*#__PURE__*/React.createElement("span", { style: { fontSize: 20, fontWeight: 800, color: band.color, lineHeight: 1 } }, score),
            /*#__PURE__*/React.createElement("span", { style: { fontSize: 9, color: "var(--text-light)" } }, "skor"))),
        /*#__PURE__*/React.createElement("div", { style: { flex: 1, minWidth: 0 } },
          /*#__PURE__*/React.createElement("div", { style: { fontSize: 13, fontWeight: 700, color: band.color, marginBottom: 2 } }, band.label),
          /*#__PURE__*/React.createElement("div", { style: { fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5, minHeight: 19 } },
            ai && ai.verdict ? ai.verdict : (aiErr ? aiErr : (aiBusy ? "Menyusun ringkasan…" :
              /*#__PURE__*/React.createElement("button", { className: "btn btn-secondary btn-sm", onClick: runAI }, "Buat ringkasan AI")))),
          /*#__PURE__*/React.createElement("div", { style: { display: "flex", gap: 14, marginTop: 8, fontSize: 12, color: "var(--text-light)" } },
            /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", { style: { color: "#dc2626" } }, r.overdue.length), " overdue"),
            /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", { style: { color: "#dc2626" } }, p1Overdue), " P1 overdue"),
            /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", { style: { color: "#0891b2" } }, r.projectsNoNext.length), " mandek")))),
      /*#__PURE__*/React.createElement("div", { className: "notes-section-label" }, "Antrian aksi"),
      q.items.length === 0
        ? /*#__PURE__*/React.createElement("div", { style: { fontSize: 13, color: "var(--text-secondary)", padding: "12px 0" } }, "Tidak ada yang perlu ditindak. Bersih! 🎉")
        : q.items.map(item => item.type === "stalled_project" ? projItem(item) : taskItem(item)),
      !showAll && q.overflow > 0 && /*#__PURE__*/React.createElement("button", { onClick: () => setShowAll(true), style: { background: "none", border: "none", color: "var(--accent)", cursor: "pointer", fontSize: 12, padding: "10px 0", fontWeight: 600 } }, `+ ${q.overflow} lainnya`)));
}
```

- [ ] **Step 3: Update the WeeklyReview mount props**

Find the mount (search for `React.createElement(WeeklyReview, {`). Replace its props object with:

```javascript
aiReviewOn() && /*#__PURE__*/React.createElement(WeeklyReview, { tasks: tasks, onTaskClick: setSelectedTask, showToast: showToast, onCreate: handleReviewCreate, onAddFocus: handleReviewFocus, onReschedule: handleReviewReschedule, onClarifyNext: handleReviewClarifyNext, onSetDeadline: handleReviewSetDeadline, onComplete: handleReviewComplete })
```

- [ ] **Step 4: Syntax sanity check**

Confirm the file still parses. From `Z:/Todolist Manager V5.0`:
Run: `node -e "const fs=require('fs');const s=fs.readFileSync('static/index.html','utf8');const m=s.match(/<script type=\"text\\/babel\"[\\s\\S]*?<\\/script>/g)||[];console.log('script blocks:',m.length)"`
Expected: prints a script-block count > 0 without throwing. (This is a smoke check, not a full Babel compile; primary verification is Step 5.)

- [ ] **Step 5: Manual verification (desktop)**

Open the app (PWA/desktop), trigger `tf-open-review` (sidebar "Review Mingguan" or the dashboard nudge). Verify:
1. Condition strip shows the Health Score ring with a number + band color/label, the three counts, and a "Buat ringkasan AI" button.
2. Click "Buat ringkasan AI" → the verdict sentence replaces the button; up to 5 queue rows gain a "✦ …" annotation line.
3. Action queue order matches: overdue first, then due-soon, priority, inbox, then stalled-project rows. Each row's primary action works with undo (Tunda/Fokus/Jadikan Next/Set deadline), `✓` completes with undo, `Buka` opens the task.
4. With AI off (no key) the strip still shows score+counts and the queue still works.
5. Old read-only sections (Someday, Selesai minggu ini, etc.) are gone.

- [ ] **Step 6: Commit**

```bash
git add static/index.html
git commit -m "feat(review): rebuild Weekly Review v2 (condition strip + action queue)"
```

---

### Task 5: SW cache bump + full sweep

**Files:**
- Modify: `static/sw.js:1`
- Verify: all suites

- [ ] **Step 1: Bump the SW cache version**

In `static/sw.js:1`, change `const CACHE = "taskflow-v176-review-actions";` to:

```javascript
const CACHE = "taskflow-v177-review-v2";
```

- [ ] **Step 2: Run all suites**

Run: `python -m pytest tests/test_ai_review.py tests/test_bookmark.py -q`
Expected: PASS.

Run: `node --test tests/buildReview.test.js`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add static/sw.js
git commit -m "chore(sw): bump cache v176 -> v177 for review v2"
```

---

## Self-Review Notes

- **Spec coverage:** Layout/condition strip → Task 4; action queue ordering → Task 2; row actions → Task 4 (+ Package A handlers reused, 2 new); Health Score → Task 1; AI reshape → Task 3; remove read-only sections → Task 4 (component fully replaced, no `Section(...)` calls); SW bump/testing → Task 5. All spec sections mapped.
- **Type consistency:** `computeHealthScore(m)` / `healthBand(score)` (Task 1) and `buildActionQueue(tasks, cap) -> {items, overflow}` (Task 2) are consumed verbatim in Task 4. Queue item shapes (`{task, type}` vs `{project, type:"stalled_project"}`) match Task 2's output and Task 4's `taskItem`/`projItem` branching. AI shape `{verdict, annotations:[{task_id, note}]}` (Task 3) matches Task 4's `ai.verdict` / `annotFor`. New handler names `handleReviewComplete`/`handleReviewSetDeadline` (Task 4 Step 1) match the mount props (Task 4 Step 3): `onComplete`/`onSetDeadline`.
- **Reuse:** Package A handlers `handleReviewReschedule/ClarifyNext/Focus/Create` are reused (not redefined); `handleReviewFollowUp` becomes unused but is intentionally left in place.
- **Privacy:** Task 3 leaves `build_payload`/whitelist untouched; the leak test still guards it.
