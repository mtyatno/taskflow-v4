# Weekly Review AI Briefing Annotations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn each Weekly Review action-queue row's thin AI note into a two-line manager-style briefing (bold directive + one grounded reason) that answers "why do this now?", covering every visible queue row 1:1.

**Architecture:** The frontend computes the action queue and posts its ordered `task_id`s to `/api/ai/review`. `ai_review.py` enriches the per-task payload with two honest signals (`blocks_count` from `parent_id`, `waiting_for`), echoes the queue, and asks the model (via the briefing prompt) for a `{task_id, directive, why}` per queued task. The frontend renders directive+why as the v2 "style C" two-line block.

**Tech Stack:** Python 3.10 (pytest, FastAPI/pydantic, `requests` → OpenRouter), React via in-browser Babel (`React.createElement`, no JSX), service-worker cache versioning.

## Global Constraints

- **Tasks-only privacy:** `ai_review.py` must never import/read notes/scratchpad. Only `WHITELIST` fields leave the server. `blocks_count` and `waiting_for` are the user's own task data.
- **No new dependencies.** `requests` stays lazy-imported inside `generate_review`.
- **AI-gated route:** `/api/ai/review` returns 404 when `AI_FEATURES_ENABLED` is false (unchanged). Works only with `OPENROUTER_API_KEY` + a real chat `AI_MODEL` set on the VPS.
- **Auth/uid pattern:** route uses `user=Depends(get_current_user)`, `uid = user["sub"]`.
- **React:** `React.createElement` only (no JSX), matching surrounding code.
- **Annotation schema (exact):** `{ "task_id": str, "directive": str, "why": str }`. `directive` ≤ ~4 words imperative; `why` one sentence ≤ ~18 words using only real numbers.
- **Bahasa Indonesia** for all model-facing prompt copy and UI strings.
- **Queue cap = 15**, order preserved.
- Current SW cache is `const CACHE = "taskflow-v180-review-history";` (`static/sw.js:1`) → bump to `taskflow-v181-review-briefing`.
- AI failure path unchanged: `AIReviewError` → HTTP 503; never clear the auth token.

---

### Task 1: Enrich `build_payload` — `blocks_count`, `waiting_for`, queue echo

**Files:**
- Modify: `ai_review.py` (`WHITELIST` line ~10, `build_payload` lines ~29-63)
- Test: `tests/test_ai_review.py` (extend)

**Interfaces:**
- Consumes: list of task dicts (each has `id`, `gtd_status`, `parent_id`, `waiting_for`, plus existing whitelist fields).
- Produces: `build_payload(tasks: list, queue: list | None = None) -> dict`. Each `payload["tasks"][i]` now includes `blocks_count: int` and `waiting_for: str`. When `queue` is non-empty, `payload["queue"]` is the order-preserving list of stringified ids that exist in `tasks`, capped at 15; omitted otherwise.

- [ ] **Step 1: Write the failing tests**

Add to `tests/test_ai_review.py`:

```python
def test_build_payload_blocks_count():
    tasks = [
        {"id": 1, "title": "Parent", "gtd_status": "next"},
        {"id": 2, "title": "Child A", "gtd_status": "next", "parent_id": 1},
        {"id": 3, "title": "Child B", "gtd_status": "inbox", "parent_id": 1},
        {"id": 4, "title": "Child done", "gtd_status": "done", "parent_id": 1},
    ]
    p = ai_review.build_payload(tasks)
    by_id = {t["id"]: t for t in p["tasks"]}
    assert by_id[1]["blocks_count"] == 2   # two active children; done one excluded
    assert by_id[2]["blocks_count"] == 0


def test_build_payload_includes_waiting_for_and_closed_whitelist():
    tasks = [{"id": 9, "title": "T", "gtd_status": "waiting",
              "waiting_for": "Pak Budi", "secret": "leak-me"}]
    p = ai_review.build_payload(tasks)
    item = p["tasks"][0]
    assert item["waiting_for"] == "Pak Budi"
    assert "secret" not in item                      # whitelist stays closed
    assert set(item.keys()) == set(ai_review.WHITELIST)


def test_build_payload_queue_echo_clamped_and_ordered():
    tasks = [{"id": i, "title": str(i), "gtd_status": "next"} for i in range(1, 20)]
    p = ai_review.build_payload(tasks, queue=["3", "1", "999", "2"])
    assert p["queue"] == ["3", "1", "2"]             # unknown 999 dropped, order kept
    big = ai_review.build_payload(tasks, queue=[str(i) for i in range(1, 19)])
    assert len(big["queue"]) == 15                   # capped at 15


def test_build_payload_no_queue_omits_key():
    p = ai_review.build_payload([{"id": 1, "title": "T", "gtd_status": "next"}])
    assert "queue" not in p
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_ai_review.py -k "blocks_count or waiting_for or queue" -v`
Expected: FAIL — `blocks_count`/`waiting_for` not present, `queue` key handling missing (KeyError / assertion failures).

- [ ] **Step 3: Implement the enrichment**

In `ai_review.py`, change the `WHITELIST` (lines ~10-11) to:

```python
WHITELIST = ["id", "title", "description", "gtd_status", "quadrant",
             "priority", "deadline", "project", "age_days", "is_overdue",
             "blocks_count", "waiting_for"]
```

Replace `build_payload` (lines ~29-63) with:

```python
def build_payload(tasks: list, queue=None) -> dict:
    """Reduce full task dicts to whitelisted fields + aggregate counts/signals.

    blocks_count = number of active (non-done/archived) child tasks (parent_id
    pointing at this task) — the only honest basis for "menahan N task lain".
    Optional `queue` (ordered task_ids the frontend wants annotated) is echoed
    back, clamped to ids that exist and capped at 15."""
    # pre-pass: active child count per parent id
    child_count = {}
    for t in tasks:
        pid = t.get("parent_id")
        if pid and t.get("gtd_status") not in ("done", "archived"):
            child_count[pid] = child_count.get(pid, 0) + 1

    out_tasks = []
    counts = {"inbox": 0, "next": 0, "waiting": 0, "someday": 0,
              "overdue": 0, "total": 0}
    p1_overdue = 0
    oldest_overdue_days = 0
    proj_has_next = {}      # project -> bool (any task with gtd_status == 'next')
    proj_seen = set()
    computed = {"age_days", "blocks_count"}
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
        item = {k: t.get(k) for k in WHITELIST if k not in computed}
        item["age_days"] = age
        item["blocks_count"] = child_count.get(t.get("id"), 0)
        out_tasks.append(item)
    projects_without_next = sum(
        1 for p in proj_seen if not proj_has_next.get(p))
    signals = {"p1_overdue": p1_overdue,
               "oldest_overdue_days": oldest_overdue_days,
               "projects_without_next": projects_without_next}
    result = {"counts": counts, "tasks": out_tasks, "signals": signals}
    if queue:
        valid = {str(t.get("id")) for t in tasks}
        q = [str(i) for i in queue if str(i) in valid][:15]
        if q:
            result["queue"] = q
    return result
```

Note: `waiting_for` is pulled via the whitelist comprehension (real column); missing → `None`, which is acceptable to the model.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_ai_review.py -v`
Expected: PASS (new tests + all existing).

- [ ] **Step 5: Commit**

```bash
git add ai_review.py tests/test_ai_review.py
git commit -m "feat(review): enrich AI payload with blocks_count + waiting_for + queue echo"
```

---

### Task 2: New annotation schema + manager-briefing prompt

**Files:**
- Modify: `ai_review.py` (`REVIEW_SCHEMA` lines ~66-82, `REVIEW_SYSTEM_PROMPT` lines ~84-97, `generate_review` user message + `max_tokens` lines ~150-171)
- Test: `tests/test_ai_review.py` (schema-shape assertion)

**Interfaces:**
- Consumes: `payload` from Task 1 (now with `blocks_count`, `waiting_for`, optional `queue`).
- Produces: model output objects `{verdict: str, annotations: [{task_id, directive, why}]}`. `REVIEW_SCHEMA` reflects the new annotation shape.

- [ ] **Step 1: Write the failing test**

Add to `tests/test_ai_review.py`:

```python
def test_review_schema_annotation_shape():
    props = ai_review.REVIEW_SCHEMA["properties"]["annotations"]["items"]["properties"]
    assert set(props.keys()) == {"task_id", "directive", "why"}
    required = ai_review.REVIEW_SCHEMA["properties"]["annotations"]["items"]["required"]
    assert set(required) == {"task_id", "directive", "why"}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_ai_review.py::test_review_schema_annotation_shape -v`
Expected: FAIL — schema still has `note`, not `directive`/`why`.

- [ ] **Step 3: Update schema and prompt**

In `ai_review.py`, replace `REVIEW_SCHEMA` (lines ~66-82) with:

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
                               "directive": {"type": "string"},
                               "why": {"type": "string"}},
                "required": ["task_id", "directive", "why"],
            },
        },
    },
    "required": ["verdict", "annotations"],
}
```

Replace `REVIEW_SYSTEM_PROMPT` (lines ~84-97) with:

```python
REVIEW_SYSTEM_PROMPT = (
    "Kamu seorang manajer yang memberi user briefing 5 menit untuk minggu ini, "
    "berdasarkan ringkasan TUGAS-nya (judul, status GTD, quadrant Eisenhower, "
    "prioritas, deadline, project, umur, blocks_count = jumlah task lain yang "
    "tertahan oleh task ini, waiting_for) dan blok 'signals' (agregat: "
    "p1_overdue, oldest_overdue_days, projects_without_next). Bahasa Indonesia, "
    "tegas dan to the point seperti atasan yang paham prioritas.\n"
    "- verdict: TEPAT 1 kalimat kondisi minggu ini. Jika signals.p1_overdue > 0 "
    "  atau banyak task Q1 overdue, sebut tumpukan itu sebagai titik macet utama.\n"
    "- annotations: untuk SETIAP task, beri {task_id, directive, why}.\n"
    "  - directive: perintah singkat MAKS 4 kata soal KAPAN/aksi, kata kerja di "
    "    depan. Contoh: 'Kerjakan hari ini', 'Jadwalkan minggu ini', "
    "    'Tindak lanjut', 'Tunggu kabar', 'Pecah jadi langkah'.\n"
    "  - why: TEPAT 1 kalimat singkat (maks ~18 kata) yang menjawab 'kenapa ini "
    "    sekarang?'. WAJIB pakai angka/sinyal NYATA dari data: hari overdue / "
    "    menuju deadline, blocks_count (sebut 'menahan N task lain' HANYA jika "
    "    blocks_count > 0), status P1/Q1, project mandek, atau waiting_for. "
    "    DILARANG mengarang angka atau relasi. Jika tak ada sinyal kuat, beri "
    "    alasan jujur yang ringan (mis. 'biar inbox bersih').\n"
    "  - Jika diberikan daftar 'queue' berisi task_id, WAJIB beri tepat satu "
    "    anotasi untuk SETIAP id di queue, urut sesuai queue, dan JANGAN "
    "    menganotasi id di luar queue. Jika tidak ada 'queue', anotasi maksimal "
    "    5 task paling layak ditindak.\n"
    "  - task_id WAJIB dari data yang diberikan; jangan mengarang id.\n"
    "Jangan menyertakan data selain yang diberikan."
)
```

In `generate_review`, update the inline schema reminder and bump `max_tokens`. Replace the `user_msg` assignment (lines ~150-155) with:

```python
    user_msg = (
        json.dumps(payload, ensure_ascii=False)
        + "\n\nBalas HANYA dengan satu objek JSON valid sesuai skema: "
        '{"verdict": str, "annotations": [{"task_id": str, "directive": str, '
        '"why": str}]}. Tanpa teks atau markdown apa pun di luar JSON.'
    )
```

And change `"max_tokens": 4096,` (line ~170) to:

```python
                "max_tokens": 6000,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest tests/test_ai_review.py -v`
Expected: PASS (schema test + all existing parse/payload tests; `parse_review_content` is unchanged and still passes).

- [ ] **Step 5: Verify module imports cleanly**

Run: `python -c "import ai_review; print('ai_review OK')"`
Expected: prints `ai_review OK`.

- [ ] **Step 6: Commit**

```bash
git add ai_review.py tests/test_ai_review.py
git commit -m "feat(review): briefing-style annotation schema {task_id,directive,why} + manager prompt"
```

---

### Task 3: Accept the queue in the route — `webapp.py`

**Files:**
- Modify: `webapp.py` (fastapi import line 31; add `ReviewRequest` model near other pydantic models; `ai_weekly_review` route lines ~3107-3126)

**Interfaces:**
- Consumes: `ai_review.build_payload(tasks, queue=...)` (Task 1).
- Produces: `POST /api/ai/review` accepts optional JSON body `{queue: [str]}`; an empty/`{}` body still works (queue defaults to `[]`).

- [ ] **Step 1: Add `Body` to the fastapi import**

In `webapp.py:31`, add `Body` to the import list:

```python
from fastapi import FastAPI, HTTPException, Depends, Response, Request, status, UploadFile, File as FastAPIFile, BackgroundTasks, Query, Body
```

- [ ] **Step 2: Add the request model**

Immediately above the `@app.post("/api/ai/review")` decorator (line ~3107), add:

```python
class ReviewRequest(BaseModel):
    queue: list[str] = []
```

- [ ] **Step 3: Pass the queue into `build_payload`**

In `ai_weekly_review` (lines ~3107-3126): change the signature to accept the body, and pass `queue`. Replace:

```python
async def ai_weekly_review(user=Depends(get_current_user)):
```

with:

```python
async def ai_weekly_review(req: ReviewRequest = Body(default=ReviewRequest()),
                           user=Depends(get_current_user)):
```

and replace:

```python
    payload = ai_review.build_payload(tasks)
```

with:

```python
    payload = ai_review.build_payload(tasks, queue=req.queue)
```

- [ ] **Step 4: Verify the module imports cleanly (routes register)**

Run: `python -c "import webapp; print('webapp OK')"`
Expected: prints `webapp OK` (no ImportError / NameError for `Body` or `ReviewRequest`).

- [ ] **Step 5: Commit**

```bash
git add webapp.py
git commit -m "feat(review): /api/ai/review accepts ordered queue for 1:1 annotations"
```

---

### Task 4: Frontend — send queue + render style C two-line briefing

**Files:**
- Modify: `static/index.html` — `WeeklyReview` component (`runAI` ~20964-20969, `annotFor` ~20981, `taskItem` note render ~21006 & ~21014)

**Interfaces:**
- Consumes: `GET`/`POST` `/api/ai/review` returning `{verdict, annotations:[{task_id,directive,why}]}` (Tasks 2-3); existing `buildActionQueue(tasks, cap)` (returns `{items:[{task,type}|{project,type}], overflow}`); `api.post`.
- Produces: queue-aligned AI request; two-line briefing render per row.

CRITICAL: line numbers are approximate — locate by the quoted anchors and match current code.

- [ ] **Step 1: Send the visible queue ids with the AI request**

Replace `runAI` (around line 20964):

```javascript
  const runAI = async () => {
    setAiBusy(true); setAiErr("");
    try { setAi(await api.post("/api/ai/review", {})); }
    catch (e) { setAiErr(navigator.onLine ? "Gagal membuat ringkasan AI" : "Perlu online untuk ringkasan AI"); }
    finally { setAiBusy(false); }
  };
```

with:

```javascript
  const runAI = async () => {
    setAiBusy(true); setAiErr("");
    try {
      const qq = buildActionQueue(tasks || [], 15);
      const ids = qq.items.filter(i => i.task).map(i => String(i.task.id));
      setAi(await api.post("/api/ai/review", { queue: ids }));
    }
    catch (e) { setAiErr(navigator.onLine ? "Gagal membuat ringkasan AI" : "Perlu online untuk ringkasan AI"); }
    finally { setAiBusy(false); }
  };
```

- [ ] **Step 2: Return the full annotation object from `annotFor`**

Replace `annotFor` (around line 20981):

```javascript
  const annotFor = (id) => { if (!ai || !ai.annotations) return null; const a = ai.annotations.find(x => String(x.task_id) === String(id)); return a ? a.note : null; };
```

with:

```javascript
  const annotFor = (id) => { if (!ai || !ai.annotations) return null; return ai.annotations.find(x => String(x.task_id) === String(id)) || null; };
```

- [ ] **Step 3: Render the two-line briefing block (style C)**

In `taskItem` (around line 21006), the line `const note = annotFor(t.id);` stays. Replace the single render line (around line 21014):

```javascript
        note && /*#__PURE__*/React.createElement("div", { style: { fontSize: 12, fontStyle: "italic", color: "var(--accent)", marginTop: 3 } }, "✦ " + note)),
```

with (back-compat: a legacy `{note}` shape renders as the `why` line only):

```javascript
        note && (function () {
          var directive = note.directive || "";
          var why = note.why || note.note || "";
          if (!directive && !why) return null;
          return /*#__PURE__*/React.createElement("div", { style: { marginTop: 4 } },
            directive && /*#__PURE__*/React.createElement("div", { style: { fontSize: 12.5, fontWeight: 700, color: "var(--text-primary)" } }, "➤ " + directive),
            why && /*#__PURE__*/React.createElement("div", { style: { fontSize: 12, color: "var(--text-light)", lineHeight: 1.45, marginTop: 1 } }, why));
        })()),
```

- [ ] **Step 4: Syntax sanity check**

Run from `Z:/Todolist Manager V5.0`:
`node -e 'const fs=require("fs");const L=fs.readFileSync("static/index.html","utf8").split("\n");const end=L.findIndex((x,i)=>i>1362&&x.trim()==="</script>");const b=L.slice(1362,end).join("\n");try{new Function(b);console.log("PARSE OK")}catch(e){console.log("SYNTAX ERROR:",e.message.split("\n")[0])}'`
Expected: prints `PARSE OK`.

- [ ] **Step 5: Commit**

```bash
git add static/index.html
git commit -m "feat(review): two-line briefing render (directive + why) + queue-aligned AI request"
```

---

### Task 5: SW cache bump + full sweep

**Files:**
- Modify: `static/sw.js:1`
- Verify: suites

- [ ] **Step 1: Bump the SW cache version**

In `static/sw.js:1`, change `const CACHE = "taskflow-v180-review-history";` to:

```javascript
const CACHE = "taskflow-v181-review-briefing";
```

- [ ] **Step 2: Run the suites**

Run: `python -m pytest tests/test_ai_review.py tests/test_review_history.py -q`
Expected: PASS.

Run: `node --test tests/buildReview.test.js`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add static/sw.js
git commit -m "chore(sw): bump cache v180 -> v181 for review briefing annotations"
```

---

## Manual Verification (after deploy + `sudo systemctl restart taskflow-web`)

1. Open Weekly Review on desktop → click "Buat ringkasan AI".
2. Each visible action-queue row shows a two-line block: bold `➤ <directive>` then a dim reason sentence.
3. Spot-check honesty: a row whose task has active children should say "menahan N task lain" with the correct N; a row without children must not. Overdue rows cite days; waiting rows cite who/what they wait on.
4. With AI off (or before pressing the button) the rows show no briefing line (unchanged).

## Self-Review Notes

- **Spec coverage:** payload enrichment (`blocks_count`, `waiting_for`) → Task 1; queue echo → Task 1; schema `{task_id,directive,why}` + briefing prompt + `max_tokens` → Task 2; route accepts `{queue}` → Task 3; frontend send-queue + style-C render + legacy back-compat → Task 4; SW bump + sweep → Task 5. Privacy (whitelist closed) asserted in Task 1 test. AI-gated/503/no-token-clear untouched (route body change only).
- **Type consistency:** `build_payload(tasks, queue=None)` (Task 1) called as `build_payload(tasks, queue=req.queue)` (Task 3). Annotation shape `{task_id, directive, why}` defined in Task 2 schema, consumed in Task 4 (`note.directive`, `note.why`, legacy `note.note`). `ReviewRequest.queue: list[str]` (Task 3) matches `{ queue: ids }` (strings) posted in Task 4. `buildActionQueue` item shape `{task,type}` used in Task 4 Step 1 matches `digest.js`.
- **Deploy note:** backend change (`ai_review.py`, `webapp.py`) → **restart `taskflow-web`** after deploy (static sync ≠ backend restart).
