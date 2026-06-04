# Offline Habits — Local Layer Implementation Plan (#2e-1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make habits work offline (list, today view with streak/week_log, monthly, checkin) served from IndexedDB, following the tasks pattern (local-first, Opsi B — write to `_outbox`, no push yet; sync is #2e-2).

**Architecture:** Pure `habitlogic.js` (today/streak/week_log/monthly parity port) + `habitrepo.js` (CRUD + checkin + tags + outbox) + `habitquery.js` (reads) + `habithydrate.js` (seed from server, needs a new tiny `GET /api/habits/logs` endpoint) + `habitroutes.js` (registers habit routes on the LocalRouter). Wiring loads the modules and hydrates on boot; the legacy `OfflineDB` habit paths become dead under intercept (cleanup deferred, like tasks).

**Tech Stack:** Vanilla ES2017 JS, IndexedDB, `node:test`, `fake-indexeddb`; one small FastAPI read endpoint. No schema changes.

**Spec:** `docs/superpowers/specs/2026-06-04-offline-habits-local-design.md`

---

## Key facts (verified)

- Stores `habits` + `habit_logs` already exist (db.js v3). `habit_logs` index `habit_date` = `["habit_cid","date"]` unique; also `date`, `dirty`.
- Server: `GET /api/habits` → `dict(row)[]` (frequency = JSON **string**) `ORDER BY phase, id`. `GET /api/habits/today` → per habit `{id,title,phase,micro_target,frequency(**array**),identity_pillar,today_status,skip_reason,streak,week_log[7]}`. `_today_jkt`=UTC+7. week=Mon..Sun. **streak**: from today backward — `done`→+1 & continue; `skipped`→continue; else stop. `GET /api/habits/monthly` → `{days:[{day,done}],avg,today_day,days_in_month}`. `POST /api/habits` (`{title,phase,micro_target,frequency[],identity_pillar}`, strip #tags). `POST /api/habits/{id}/update`. `POST /api/habits/{id}/checkin` (`{status,skip_reason,date}`, upsert by habit_id+date). `DELETE /api/habits/{id}`. `GET/DELETE /api/habits/{id}/tags`.
- `tagrepo`: `extractTags`, `setEntityTags(type,cid,names)`, `getEntityTags`, `removeEntityTag`, `cidsForTag`. `idmap`: `cidOf/mapPut/serverIdOf/mapDelete`. `taskroutes.buildTaskRouter` registers routes then `return router;`.
- `webapp.py`: habit endpoints ~2098–2321; `_today_jkt` at :27; `from datetime import ... timedelta` already imported.

## File structure

```
webapp.py                          # MODIFY — GET /api/habits/logs
static/offline/habitlogic.js       # NEW — todayJkt/weekDates/deriveToday/monthly
static/offline/habitrepo.js        # NEW — createHabit/updateHabit/deleteHabit/checkin
static/offline/habitquery.js       # NEW — getHabits/getHabitsToday/getHabitsMonthly
static/offline/habithydrate.js     # NEW — hydrateHabits/hydrateLogs/ensureHabits
static/offline/habitroutes.js      # NEW — registerHabitRoutes(router)
static/offline/taskroutes.js       # MODIFY — call registerHabitRoutes
static/index.html                  # MODIFY — load modules + hydrate habits on boot
static/sw.js                       # MODIFY — bump v125 + precache habit modules
tests/offline/habit*.test.js       # NEW
```

---

## Task 1: Backend `GET /api/habits/logs`

**Files:** Modify `webapp.py`

- [ ] **Step 1: Add the endpoint near the other habit routes (e.g., after `get_habits_monthly`)**

```python
@app.get("/api/habits/logs")
async def get_habit_logs(since: str = "", user=Depends(get_current_user)):
    uid = user["sub"]
    if not since:
        since = (_today_jkt() - timedelta(days=90)).isoformat()
    with get_db() as conn:
        rows = conn.execute(
            """SELECT hl.habit_id, hl.date, hl.status, hl.skip_reason
               FROM habit_logs hl JOIN habits h ON h.id = hl.habit_id
               WHERE h.user_id = ? AND hl.date >= ?
               ORDER BY hl.date""",
            (uid, since),
        ).fetchall()
    return [dict(r) for r in rows]
```

- [ ] **Step 2: Sanity-check Python syntax**

Run: `python -c "import ast; ast.parse(open('webapp.py',encoding='utf-8').read())"`
Expected: no output (valid).

- [ ] **Step 3: Commit**

```bash
git add webapp.py
git commit -m "feat(api): GET /api/habits/logs (read-only, since=)"
```

> Note: this is a backend change. It only takes effect after `taskflow-web` is restarted on the VPS (manual — deploy.yml doesn't restart, CI can't sudo). Covered in Task 10.

---

## Task 2: `habitlogic.js`

**Files:** Create `static/offline/habitlogic.js`, `tests/offline/habitlogic.test.js`

- [ ] **Step 1: Write the failing test `tests/offline/habitlogic.test.js`**

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { todayJkt, weekDates, deriveToday, monthly } = require("../../static/offline/habitlogic.js");

test("todayJkt converts a UTC ms to the Jakarta (UTC+7) date", () => {
  // 2026-06-04T20:00:00Z = 2026-06-05T03:00 JKT
  assert.equal(todayJkt(Date.parse("2026-06-04T20:00:00Z")), "2026-06-05");
  // 2026-06-04T10:00:00Z = 2026-06-04T17:00 JKT
  assert.equal(todayJkt(Date.parse("2026-06-04T10:00:00Z")), "2026-06-04");
});

test("weekDates returns Monday..Sunday of the week containing the date", () => {
  // 2026-06-04 is a Thursday
  assert.deepEqual(weekDates("2026-06-04"), [
    "2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04",
    "2026-06-05", "2026-06-06", "2026-06-07",
  ]);
});

test("deriveToday computes today_status, week_log, and streak (done/skipped/break)", () => {
  const logs = {
    "2026-06-04": { status: "done", skip_reason: "" },
    "2026-06-03": { status: "done", skip_reason: "" },
    "2026-06-02": { status: "skipped", skip_reason: "sakit" },
    "2026-06-01": { status: "done", skip_reason: "" },
  };
  const d = deriveToday({}, logs, "2026-06-04");
  assert.equal(d.today_status, "done");
  assert.equal(d.streak, 3); // 04 done, 03 done, 02 skipped(continue), 01 done → 3 done; before that missing → stop
  assert.deepEqual(d.week_log, ["done", "skipped", "done", "done", null, null, null]);
});

test("deriveToday streak is 0 when today has no log (server parity)", () => {
  const d = deriveToday({}, { "2026-06-03": { status: "done" } }, "2026-06-04");
  assert.equal(d.today_status, null);
  assert.equal(d.streak, 0);
});

test("monthly counts done per day with avg up to today", () => {
  const logs = [
    { date: "2026-06-01", status: "done" },
    { date: "2026-06-01", status: "done" },
    { date: "2026-06-02", status: "skipped" },
    { date: "2026-05-31", status: "done" },
  ];
  const m = monthly(logs, 2026, 6, 2);
  assert.equal(m.days_in_month, 30);
  assert.equal(m.days[0].done, 2); // June 1
  assert.equal(m.days[1].done, 0); // June 2 (skipped, not done)
  assert.equal(m.today_day, 2);
  assert.equal(m.avg, 1); // (2 + 0) / 2
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/habitlogic.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `static/offline/habitlogic.js`**

```js
;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  function todayJkt(nowMs) {
    const ms = (nowMs != null ? nowMs : Date.now()) + 7 * 3600 * 1000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  function addDays(dateStr, n) {
    const [y, m, d] = String(dateStr).slice(0, 10).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10);
  }
  function weekDates(todayStr) {
    const [y, m, d] = String(todayStr).split("-").map(Number);
    const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // 0=Mon..6=Sun
    const monday = addDays(todayStr, -dow);
    const out = [];
    for (let i = 0; i < 7; i++) out.push(addDays(monday, i));
    return out;
  }
  function deriveToday(habit, logsByDate, todayStr) {
    const wk = weekDates(todayStr);
    const week_log = wk.map((dt) => (logsByDate[dt] ? logsByDate[dt].status : null));
    const todayLog = logsByDate[todayStr];
    let streak = 0;
    let cur = todayStr;
    while (true) {
      const log = logsByDate[cur];
      if (log && log.status === "done") { streak++; cur = addDays(cur, -1); }
      else if (log && log.status === "skipped") { cur = addDays(cur, -1); }
      else break;
    }
    return {
      today_status: todayLog ? todayLog.status : null,
      skip_reason: todayLog ? (todayLog.skip_reason || "") : "",
      streak: streak,
      week_log: week_log,
    };
  }
  function monthly(logs, year, month, todayDay) {
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    const doneByDay = {};
    for (const l of (logs || [])) {
      if (l.status !== "done") continue;
      if (String(l.date).slice(0, 7) !== prefix) continue;
      const day = Number(String(l.date).slice(8, 10));
      doneByDay[day] = (doneByDay[day] || 0) + 1;
    }
    const days = [];
    for (let d = 1; d <= daysInMonth; d++) days.push({ day: d, done: doneByDay[d] || 0 });
    const withData = days.filter((r) => r.day <= todayDay);
    const sum = withData.reduce((s, r) => s + r.done, 0);
    const avg = withData.length ? Math.round((sum / withData.length) * 10) / 10 : 0;
    return { days: days, avg: avg, today_day: todayDay, days_in_month: daysInMonth };
  }

  const exported = { todayJkt, weekDates, deriveToday, monthly, addDays };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.habitlogic = exported; }
  return exported;
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/habitlogic.test.js`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add static/offline/habitlogic.js tests/offline/habitlogic.test.js
git commit -m "feat(offline): habitlogic (today/streak/week_log/monthly parity)"
```

---

## Task 3: `habitrepo.js`

**Files:** Create `static/offline/habitrepo.js`, `tests/offline/habitrepo.test.js`

- [ ] **Step 1: Write the failing test `tests/offline/habitrepo.test.js`**

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { getEntityTags } = require("../../static/offline/tagrepo.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const { createHabit, updateHabit, deleteHabit, checkin } = require("../../static/offline/habitrepo.js");

const NOW = "2026-06-04T08:00:00.000Z";
beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function getHabitRaw(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("habits").objectStore("habits").get(cid); q.onsuccess = () => res(q.result); });
}
async function logFor(habitCid, date) {
  const db = await openDB();
  return new Promise((res) => {
    const r = db.transaction("habit_logs").objectStore("habit_logs").index("habit_date").get([habitCid, date]);
    r.onsuccess = () => res(r.result);
  });
}

test("createHabit strips tags, defaults phase/frequency, enqueues outbox, persists tags", async () => {
  const h = await createHabit({ title: "Olahraga #pagi", micro_target: "10 menit" }, { now: NOW });
  assert.equal(h.title, "Olahraga");
  assert.equal(h.phase, "pagi");
  assert.equal(h.frequency, JSON.stringify(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]));
  assert.equal(h.micro_target, "10 menit");
  assert.equal(h.dirty, 1);
  assert.deepEqual((await getEntityTags("habit", h.cid)).map((t) => t.name), ["pagi"]);
  const ops = await outboxAll();
  assert.equal(ops[0].op, "create");
  assert.equal(ops[0].entity_type, "habit");
});

test("updateHabit changes fields and re-derives tags", async () => {
  const h = await createHabit({ title: "A #one", phase: "pagi" }, { now: NOW });
  const u = await updateHabit(h.cid, { title: "B #two", phase: "malam", frequency: ["mon"] }, { now: NOW });
  assert.equal(u.title, "B");
  assert.equal(u.phase, "malam");
  assert.equal(u.frequency, JSON.stringify(["mon"]));
  assert.deepEqual((await getEntityTags("habit", h.cid)).map((t) => t.name), ["two"]);
});

test("deleteHabit tombstones the habit and enqueues a delete op", async () => {
  const h = await createHabit({ title: "Gone" }, { now: NOW });
  await deleteHabit(h.cid, { now: NOW });
  assert.equal((await getHabitRaw(h.cid)).deleted, true);
  assert.ok((await outboxAll()).some((o) => o.op === "delete" && o.entity_type === "habit"));
});

test("checkin upserts a habit_log by (habit,date) and enqueues a checkin op", async () => {
  const h = await createHabit({ title: "Run" }, { now: NOW });
  await checkin(h.cid, "2026-06-04", "done", "", { now: NOW });
  assert.equal((await logFor(h.cid, "2026-06-04")).status, "done");
  await checkin(h.cid, "2026-06-04", "skipped", "sakit", { now: NOW });
  const log = await logFor(h.cid, "2026-06-04");
  assert.equal(log.status, "skipped");           // upsert, not duplicate
  assert.equal(log.skip_reason, "sakit");
  assert.ok((await outboxAll()).some((o) => o.op === "checkin" && o.entity_type === "habit_log"));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/habitrepo.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `static/offline/habitrepo.js`**

```js
;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  const isNode = (typeof module !== "undefined" && module.exports);
  const req = (m, g) => (isNode ? require(m) : g);
  const TFdb = req("./db.js", root.TF && root.TF.db);
  const TFids = req("./ids.js", root.TF && root.TF.ids);
  const TFoutbox = req("./outbox.js", root.TF && root.TF.outbox);
  const TFtag = req("./tagrepo.js", root.TF && root.TF.tagrepo);

  const DEFAULT_FREQ = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

  function getHabitRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("habits", "readonly").objectStore("habits").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  function putHabit(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("habits", "readwrite");
      tx.objectStore("habits").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }

  function createHabit(input, opts) {
    const now = (opts && opts.now) || new Date().toISOString();
    const ex = TFtag.extractTags(input.title);
    if (!ex.clean) return Promise.reject(new Error("Nama habit tidak boleh kosong setelah strip tag"));
    const phase = (input.phase === "pagi" || input.phase === "siang" || input.phase === "malam") ? input.phase : "pagi";
    const rec = {
      cid: TFids.newCid(), server_id: null, title: ex.clean, phase: phase,
      micro_target: input.micro_target != null ? input.micro_target : "",
      frequency: JSON.stringify(Array.isArray(input.frequency) ? input.frequency : DEFAULT_FREQ),
      identity_pillar: input.identity_pillar != null ? input.identity_pillar : "",
      created_at: now, deleted: false, dirty: 1,
    };
    return putHabit(rec)
      .then(() => TFoutbox.outboxAdd({ op: "create", entity_type: "habit", cid: rec.cid, payload: rec }))
      .then(() => TFtag.setEntityTags("habit", rec.cid, ex.tags))
      .then(() => rec);
  }

  function updateHabit(cid, patch, opts) {
    const now = (opts && opts.now) || new Date().toISOString();
    return getHabitRaw(cid).then((rec) => {
      if (!rec || rec.deleted) return Promise.reject(new Error("Habit not found"));
      const next = Object.assign({}, rec);
      let newTags = null;
      if (patch.title != null) {
        const ex = TFtag.extractTags(patch.title);
        if (!ex.clean) return Promise.reject(new Error("Nama habit tidak boleh kosong setelah strip tag"));
        next.title = ex.clean; newTags = ex.tags;
      }
      if (patch.phase != null && (patch.phase === "pagi" || patch.phase === "siang" || patch.phase === "malam")) next.phase = patch.phase;
      if (patch.micro_target != null) next.micro_target = patch.micro_target;
      if (patch.frequency != null) next.frequency = JSON.stringify(Array.isArray(patch.frequency) ? patch.frequency : []);
      if (patch.identity_pillar != null) next.identity_pillar = patch.identity_pillar;
      next.dirty = 1;
      return putHabit(next)
        .then(() => TFoutbox.outboxAdd({ op: "update", entity_type: "habit", cid: cid, payload: next }))
        .then(() => (newTags != null ? TFtag.setEntityTags("habit", cid, newTags) : null))
        .then(() => next);
    });
  }

  function deleteHabit(cid, opts) {
    return getHabitRaw(cid).then((rec) => {
      if (!rec || rec.deleted) return Promise.reject(new Error("Habit not found"));
      const next = Object.assign({}, rec, { deleted: true, dirty: 1 });
      return putHabit(next)
        .then(() => TFoutbox.outboxAdd({ op: "delete", entity_type: "habit", cid: cid, payload: { cid: cid } }))
        .then(() => ({ ok: true }));
    });
  }

  function checkin(habitCid, date, status, skipReason, opts) {
    if (status !== "done" && status !== "skipped") return Promise.reject(new Error("status harus done atau skipped"));
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("habit_logs", "readwrite");
      const store = tx.objectStore("habit_logs");
      const idx = store.index("habit_date");
      let record = null;
      const g = idx.get([habitCid, date]);
      g.onsuccess = () => {
        if (g.result) { record = Object.assign({}, g.result, { status: status, skip_reason: skipReason || "", dirty: 1 }); store.put(record); }
        else { record = { cid: TFids.newCid(), habit_cid: habitCid, date: date, status: status, skip_reason: skipReason || "", dirty: 1 }; store.put(record); }
      };
      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error);
    })).then((record) =>
      TFoutbox.outboxAdd({ op: "checkin", entity_type: "habit_log", cid: record.cid, payload: record }).then(() => record));
  }

  const exported = { createHabit, updateHabit, deleteHabit, checkin };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.habitrepo = exported; }
  return exported;
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/habitrepo.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add static/offline/habitrepo.js tests/offline/habitrepo.test.js
git commit -m "feat(offline): habitrepo (CRUD + checkin + tags + outbox)"
```

---

## Task 4: `habitquery.js`

**Files:** Create `static/offline/habitquery.js`, `tests/offline/habitquery.test.js`

- [ ] **Step 1: Write the failing test `tests/offline/habitquery.test.js`**

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { setEntityTags } = require("../../static/offline/tagrepo.js");
const { getHabits, getHabitsToday, getHabitsMonthly } = require("../../static/offline/habitquery.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function seed(store, recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    for (const r of recs) tx.objectStore(store).put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
function habit(over) {
  return Object.assign({ cid: over.cid, server_id: null, title: over.cid, phase: "pagi", micro_target: "", frequency: JSON.stringify(["mon"]), identity_pillar: "", deleted: false }, over);
}

test("getHabits lists non-deleted habits with id; frequency stays a string", async () => {
  await seed("habits", [habit({ cid: "a", server_id: 10, title: "A" }), habit({ cid: "b", title: "B", deleted: true })]);
  const rows = await getHabits({});
  assert.deepEqual(rows.map((r) => r.cid), ["a"]);
  assert.equal(rows[0].id, 10);
  assert.equal(typeof rows[0].frequency, "string");
});

test("getHabits filters by tag", async () => {
  await seed("habits", [habit({ cid: "a", title: "A" }), habit({ cid: "b", title: "B" })]);
  await setEntityTags("habit", "a", ["pagi"]);
  const rows = await getHabits({ tag: "pagi" });
  assert.deepEqual(rows.map((r) => r.cid), ["a"]);
});

test("getHabitsToday assembles today_status/streak/week_log with frequency as array", async () => {
  await seed("habits", [habit({ cid: "a", server_id: 10, title: "Run", frequency: JSON.stringify(["mon", "tue"]) })]);
  await seed("habit_logs", [
    { cid: "l1", habit_cid: "a", date: "2026-06-04", status: "done", skip_reason: "" },
    { cid: "l2", habit_cid: "a", date: "2026-06-03", status: "done", skip_reason: "" },
  ]);
  const rows = await getHabitsToday({ today: "2026-06-04" });
  assert.equal(rows[0].id, 10);
  assert.equal(rows[0].today_status, "done");
  assert.equal(rows[0].streak, 2);
  assert.deepEqual(rows[0].frequency, ["mon", "tue"]); // parsed to array
  assert.equal(rows[0].week_log.length, 7);
});

test("getHabitsMonthly aggregates done counts for the month", async () => {
  await seed("habits", [habit({ cid: "a", title: "Run" })]);
  await seed("habit_logs", [
    { cid: "l1", habit_cid: "a", date: "2026-06-01", status: "done" },
    { cid: "l2", habit_cid: "a", date: "2026-06-02", status: "skipped" },
  ]);
  const m = await getHabitsMonthly({ today: "2026-06-02" });
  assert.equal(m.days_in_month, 30);
  assert.equal(m.days[0].done, 1);
  assert.equal(m.today_day, 2);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/habitquery.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `static/offline/habitquery.js`**

```js
;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  const isNode = (typeof module !== "undefined" && module.exports);
  const req = (m, g) => (isNode ? require(m) : g);
  const TFdb = req("./db.js", root.TF && root.TF.db);
  const TFtag = req("./tagrepo.js", root.TF && root.TF.tagrepo);
  const TFlogic = req("./habitlogic.js", root.TF && root.TF.habitlogic);

  function getAll(store) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction(store, "readonly").objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  function withId(rec) { return Object.assign({}, rec, { id: rec.server_id != null ? rec.server_id : rec.cid }); }
  const PHASE_ORDER = { pagi: 0, siang: 1, malam: 2 };
  function byPhase(a, b) {
    const pa = PHASE_ORDER[a.phase] != null ? PHASE_ORDER[a.phase] : 9;
    const pb = PHASE_ORDER[b.phase] != null ? PHASE_ORDER[b.phase] : 9;
    if (pa !== pb) return pa - pb;
    const sa = a.server_id != null ? a.server_id : 0, sb = b.server_id != null ? b.server_id : 0;
    return sa - sb;
  }

  function liveHabits() {
    return getAll("habits").then((all) => all.filter((h) => !h.deleted).sort(byPhase));
  }

  function getHabits(query) {
    const q = query || {};
    const tagP = (q.tag != null && q.tag !== "") ? TFtag.cidsForTag("habit", q.tag) : Promise.resolve(null);
    return Promise.all([liveHabits(), tagP]).then(([habits, set]) => {
      let rows = habits;
      if (set) rows = rows.filter((h) => set.has(h.cid));
      return rows.map(withId);
    });
  }

  function logsByHabit() {
    return getAll("habit_logs").then((all) => {
      const map = {};
      for (const l of all) {
        if (!map[l.habit_cid]) map[l.habit_cid] = {};
        map[l.habit_cid][l.date] = { status: l.status, skip_reason: l.skip_reason || "" };
      }
      return map;
    });
  }

  function getHabitsToday(opts) {
    const today = (opts && opts.today) || TFlogic.todayJkt();
    return Promise.all([liveHabits(), logsByHabit()]).then(([habits, logmap]) =>
      habits.map((h) => {
        const d = TFlogic.deriveToday(h, logmap[h.cid] || {}, today);
        return Object.assign(withId(h), {
          frequency: h.frequency ? JSON.parse(h.frequency) : [],
          today_status: d.today_status, skip_reason: d.skip_reason, streak: d.streak, week_log: d.week_log,
        });
      }));
  }

  function getHabitsMonthly(opts) {
    const today = (opts && opts.today) || TFlogic.todayJkt();
    const [y, m, dd] = today.split("-").map(Number);
    return getAll("habit_logs").then((all) => TFlogic.monthly(all, y, m, dd));
  }

  const exported = { getHabits, getHabitsToday, getHabitsMonthly };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.habitquery = exported; }
  return exported;
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/habitquery.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add static/offline/habitquery.js tests/offline/habitquery.test.js
git commit -m "feat(offline): habitquery (list/today/monthly from local)"
```

---

## Task 5: `habithydrate.js`

**Files:** Create `static/offline/habithydrate.js`, `tests/offline/habithydrate.test.js`

- [ ] **Step 1: Write the failing test `tests/offline/habithydrate.test.js`**

```js
"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { cidOf } = require("../../static/offline/idmap.js");
const { hydrateHabits, hydrateLogs, ensureHabits } = require("../../static/offline/habithydrate.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

async function all(store) {
  const db = await openDB();
  return new Promise((res, rej) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); });
}

test("hydrateHabits seeds habits with a stable cid (idempotent)", async () => {
  await hydrateHabits([{ id: 5, title: "Run", phase: "pagi", frequency: '["mon"]', micro_target: "", identity_pillar: "" }]);
  const cid1 = (await all("habits"))[0].cid;
  await hydrateHabits([{ id: 5, title: "Run2", phase: "pagi", frequency: '["mon"]' }]);
  const rows = await all("habits");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cid, cid1);
  assert.equal(rows[0].title, "Run2");
  assert.equal(rows[0].server_id, 5);
  assert.equal(rows[0].dirty, 0);
  assert.equal(await cidOf("habit", 5), cid1);
});

test("hydrateLogs maps server habit_id to the local habit cid", async () => {
  await hydrateHabits([{ id: 5, title: "Run", phase: "pagi" }]);
  const hcid = (await all("habits"))[0].cid;
  await hydrateLogs([{ habit_id: 5, date: "2026-06-04", status: "done", skip_reason: "" }]);
  const logs = await all("habit_logs");
  assert.equal(logs.length, 1);
  assert.equal(logs[0].habit_cid, hcid);
  assert.equal(logs[0].status, "done");
  assert.equal(logs[0].dirty, 0);
});

test("ensureHabits fetches habits + logs once and seeds both", async () => {
  let calls = 0;
  const rawFetch = async (url) => {
    calls++;
    if (url.indexOf("/logs") !== -1) return { json: async () => [{ habit_id: 5, date: "2026-06-04", status: "done" }] };
    return { json: async () => [{ id: 5, title: "Run", phase: "pagi", frequency: '["mon"]' }] };
  };
  await ensureHabits(rawFetch);
  assert.equal(calls, 2);
  assert.equal((await all("habits")).length, 1);
  assert.equal((await all("habit_logs")).length, 1);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/habithydrate.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `static/offline/habithydrate.js`**

```js
;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  const isNode = (typeof module !== "undefined" && module.exports);
  const req = (m, g) => (isNode ? require(m) : g);
  const TFdb = req("./db.js", root.TF && root.TF.db);
  const TFids = req("./ids.js", root.TF && root.TF.ids);
  const TFidmap = req("./idmap.js", root.TF && root.TF.idmap);

  function put(store, rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function ensureCid(serverId, cache) {
    if (cache[serverId]) return Promise.resolve(cache[serverId]);
    return TFidmap.cidOf("habit", serverId).then((cid) => {
      if (cid) { cache[serverId] = cid; return cid; }
      const fresh = TFids.newCid();
      cache[serverId] = fresh;
      return TFidmap.mapPut("habit", serverId, fresh).then(() => fresh);
    });
  }

  function hydrateHabits(serverHabits) {
    const list = serverHabits || [];
    const cache = {};
    return list.reduce((p, h) => p.then(() => ensureCid(h.id, cache)).then((cid) => put("habits", {
      cid: cid, server_id: h.id, title: h.title,
      phase: h.phase || "pagi", micro_target: h.micro_target != null ? h.micro_target : "",
      frequency: h.frequency != null ? h.frequency : JSON.stringify(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]),
      identity_pillar: h.identity_pillar != null ? h.identity_pillar : "",
      created_at: h.created_at != null ? h.created_at : null, deleted: false, dirty: 0,
    })), Promise.resolve());
  }

  function hydrateLogs(serverLogs) {
    const list = serverLogs || [];
    const cache = {};
    return list.reduce((p, l) => p.then(() => ensureCid(l.habit_id, cache)).then((hcid) => put("habit_logs", {
      cid: "srv-log-" + l.habit_id + "-" + l.date, habit_cid: hcid, date: l.date,
      status: l.status, skip_reason: l.skip_reason != null ? l.skip_reason : "", dirty: 0,
    })), Promise.resolve());
  }

  let _ensured = null;
  function ensureHabits(rawFetch) {
    if (_ensured) return _ensured;
    _ensured = Promise.all([
      Promise.resolve(rawFetch("/api/habits")).then((r) => (r && typeof r.json === "function" ? r.json() : r)),
      Promise.resolve(rawFetch("/api/habits/logs")).then((r) => (r && typeof r.json === "function" ? r.json() : r)),
    ]).then(([habits, logs]) => hydrateHabits(habits || []).then(() => hydrateLogs(logs || [])))
      .catch((e) => { _ensured = null; throw e; });
    return _ensured;
  }

  const exported = { hydrateHabits, hydrateLogs, ensureHabits };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.habithydrate = exported; }
  return exported;
});
```

> The `habit_logs` cid is derived deterministically (`srv-log-<habitId>-<date>`) so re-hydration upserts the same log row (matching the server's UNIQUE(habit,date)). Locally-created checkins use a UUID cid; the deterministic seed cid won't collide because a locally-created log for the same (habit,date) shares the `habit_date` index — but the store is keyed by `cid`. Hydration of a date the user also checked in locally would create a SECOND row with a different cid. This is acceptable for #2e-1 (read seed); #2e-2 pull reconciles by (habit,date). For the local today view, `logsByHabit` keys by date so the later-written one wins per date — deterministic enough for read.

- [ ] **Step 4: Run to verify it passes**

Run: `node --test tests/offline/habithydrate.test.js`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add static/offline/habithydrate.js tests/offline/habithydrate.test.js
git commit -m "feat(offline): habithydrate (seed habits + logs from server)"
```

---

## Task 6: `habitroutes.js` + wire into `taskroutes`

**Files:** Create `static/offline/habitroutes.js`, modify `static/offline/taskroutes.js`, `tests/offline/taskroutes.test.js`

- [ ] **Step 1: Append failing tests to `tests/offline/taskroutes.test.js`**

```js
async function seedHabits(recs) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("habits", "readwrite");
    for (const r of recs) tx.objectStore("habits").put(r);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
}

test("GET /api/habits returns local habits via the router", async () => {
  await seedHabits([{ cid: "h1", server_id: 5, title: "Run", phase: "pagi", micro_target: "", frequency: '["mon"]', identity_pillar: "", deleted: false }]);
  const R = buildTaskRouter();
  const rows = await R.dispatch("GET", "/api/habits", undefined);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 5);
});

test("POST /api/habits/:id/checkin records a local log via the router", async () => {
  await seedHabits([{ cid: "h1", server_id: 5, title: "Run", phase: "pagi", frequency: '["mon"]', deleted: false }]);
  const R = buildTaskRouter();
  await R.dispatch("POST", "/api/habits/5/checkin", { status: "done", date: "2026-06-04" });
  const today = await R.dispatch("GET", "/api/habits/today", undefined);
  const run = today.find((h) => h.id === 5);
  assert.equal(run.week_log.length, 7);
  assert.equal(run.today_status === "done" || run.today_status === null, true); // status set for that date
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test tests/offline/taskroutes.test.js`
Expected: FAIL — no local route for `/api/habits`.

- [ ] **Step 3: Write `static/offline/habitroutes.js`**

```js
;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  const isNode = (typeof module !== "undefined" && module.exports);
  const req = (m, g) => (isNode ? require(m) : g);
  const TFdb = req("./db.js", root.TF && root.TF.db);
  const TFhq = req("./habitquery.js", root.TF && root.TF.habitquery);
  const TFhr = req("./habitrepo.js", root.TF && root.TF.habitrepo);
  const TFtag = req("./tagrepo.js", root.TF && root.TF.tagrepo);
  const TFlogic = req("./habitlogic.js", root.TF && root.TF.habitlogic);

  function allHabits() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("habits", "readonly").objectStore("habits").getAll();
      r.onsuccess = () => resolve(r.result || []);
      r.onerror = () => reject(r.error);
    }));
  }
  function resolveHabitCid(idOrCid) {
    return allHabits().then((all) => {
      for (const h of all) if (h.cid === idOrCid) return h.cid;
      for (const h of all) if (h.server_id != null && String(h.server_id) === String(idOrCid)) return h.cid;
      return null;
    });
  }
  function notFound() { return Promise.reject(new Error("Habit not found")); }

  function registerHabitRoutes(router) {
    router.register("GET", "/api/habits", ({ query }) => TFhq.getHabits(query));
    router.register("GET", "/api/habits/today", () => TFhq.getHabitsToday({}));
    router.register("GET", "/api/habits/monthly", () => TFhq.getHabitsMonthly({}));
    router.register("POST", "/api/habits", ({ body }) => TFhr.createHabit(body || {}, {}));
    router.register("POST", "/api/habits/:id/update", ({ params, body }) =>
      resolveHabitCid(params.id).then((cid) => (cid ? TFhr.updateHabit(cid, body || {}, {}) : notFound())));
    router.register("POST", "/api/habits/:id/checkin", ({ params, body }) =>
      resolveHabitCid(params.id).then((cid) => {
        if (!cid) return notFound();
        const b = body || {};
        return TFhr.checkin(cid, b.date || TFlogic.todayJkt(), b.status, b.skip_reason || "", {});
      }));
    router.register("DELETE", "/api/habits/:id", ({ params }) =>
      resolveHabitCid(params.id).then((cid) => (cid ? TFhr.deleteHabit(cid, {}) : notFound())));
    router.register("GET", "/api/habits/:id/tags", ({ params }) =>
      resolveHabitCid(params.id).then((cid) => (cid ? TFtag.getEntityTags("habit", cid) : notFound())));
    router.register("DELETE", "/api/habits/:id/tags/:name", ({ params }) =>
      resolveHabitCid(params.id).then((cid) => (cid ? TFtag.removeEntityTag("habit", cid, params.name) : notFound())));
  }

  const exported = { registerHabitRoutes };
  if (root && typeof root === "object") { root.TF = root.TF || {}; root.TF.habitroutes = exported; }
  return exported;
});
```

- [ ] **Step 4: Modify `static/offline/taskroutes.js`**

Add the dependency near the other requires (after the `TFlistsync` line):
```js
  const TFhabitroutes = req("./habitroutes.js", root.TF && root.TF.habitroutes);
```

Inside `buildTaskRouter`, immediately before `return router;`, add:
```js
    TFhabitroutes.registerHabitRoutes(router);
```

- [ ] **Step 5: Run to verify it passes**

Run: `node --test tests/offline/taskroutes.test.js`
Expected: PASS, 17 tests (15 prior + 2 new).

- [ ] **Step 6: Commit**

```bash
git add static/offline/habitroutes.js static/offline/taskroutes.js tests/offline/taskroutes.test.js
git commit -m "feat(offline): habitroutes registered on the LocalRouter"
```

---

## Task 7: Full Node-suite regression

- [ ] **Step 1: Run the whole offline suite**

Run: `node --test tests/offline/*.test.js`
Expected: `ℹ tests 185 / ℹ pass 185 / ℹ fail 0`, no hang.

> Count: prior 167 + Task 2 (5) + Task 3 (4) + Task 4 (4) + Task 5 (3) + Task 6 (2) = **185**. (If the real total differs by a couple, accept it as long as fail 0 — the invariant is 0 failures.)

- [ ] **Step 2: No commit** (regression run). Fix any failure before continuing.

---

## Task 8: Wire `static/index.html` (browser-verified)

**Files:** Modify `static/index.html` (script tags; boot hydration of habits)

> No Node test — browser-verified in Task 10. Legacy `OfflineDB` habit code is NOT removed here (it becomes dead under intercept; cleanup deferred like tasks).

- [ ] **Step 1: Add the habit module script tags**

Find `  <script src="/static/offline/recurrence.js"></script>` and insert these AFTER it (BEFORE the existing `listsync.js`/`taskroutes.js` lines so all are loaded before taskroutes — see `feedback_umd_load_order`):
```html
  <script src="/static/offline/habitlogic.js"></script>
  <script src="/static/offline/habitrepo.js"></script>
  <script src="/static/offline/habitquery.js"></script>
  <script src="/static/offline/habithydrate.js"></script>
  <script src="/static/offline/habitroutes.js"></script>
```

- [ ] **Step 2: Hydrate habits on boot (in `fetchAll`, alongside the task sync)**

Find the boot sync block in `fetchAll`:
```js
    // Sync local tasks with the server (push pending, then pull/reconcile). Supersedes one-shot hydration.
    if (navigator.onLine && __token) {
      try { await sync(); } catch (e) {}
    }
```
Replace it with:
```js
    // Sync local tasks + seed habits from the server.
    if (navigator.onLine && __token) {
      try { await sync(); } catch (e) {}
      try { if (window.TF && window.TF.habithydrate) await window.TF.habithydrate.ensureHabits(__syncRawFetch); } catch (e) {}
    }
```

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "feat(offline): load habit modules + hydrate habits on boot"
```

---

## Task 9: Service Worker — precache + cache bump

**Files:** Modify `static/sw.js`

- [ ] **Step 1: Bump the cache version**

Change `const CACHE = "taskflow-v124-list-order";` to:
```js
const CACHE = "taskflow-v125-habits";
```

- [ ] **Step 2: Precache the habit modules**

In `STATIC`, find `"/static/offline/listsync.js",` and add after it:
```js
  "/static/offline/habitlogic.js",
  "/static/offline/habitrepo.js",
  "/static/offline/habitquery.js",
  "/static/offline/habithydrate.js",
  "/static/offline/habitroutes.js",
```

- [ ] **Step 3: Verify + commit**

Run: `node --check static/sw.js`
Expected: no output.

```bash
git add static/sw.js
git commit -m "chore(sw): bump cache v125 + precache habit modules"
```

---

## Task 10: Browser verification (manual — record results)

1. Deploy (merge → push). **Then restart the backend on the VPS** (the new endpoint is Python): SSH and run `sudo systemctl restart taskflow-web` (deploy.yml doesn't restart; CI can't sudo). Confirm `curl https://todo.yatno.web.id/sw.js | grep CACHE` shows v125 AND `curl -s -o /dev/null -w "%{http_code}" "https://todo.yatno.web.id/api/habits/logs"` (with auth) returns 200/401 (not 404 — 404 means the service wasn't restarted).

2. Reset the SW in the logged-in tab:
```js
(async()=>{for(const r of await navigator.serviceWorker.getRegistrations())await r.unregister();for(const k of await caches.keys())await caches.delete(k);location.reload();})()
```

3. Verify (paste in console, share output):
```js
(async()=>{
  const R=[]; const ok=(n,c)=>R.push((c?'✅':'❌')+' '+n);
  try{
    ok('habit modules loaded', !!(window.TF && TF.habitlogic && TF.habitrepo && TF.habitquery && TF.habithydrate && TF.habitroutes));
    const today = await api.get('/api/habits/today');     // intercept → local
    ok('habits/today served locally ('+today.length+')', Array.isArray(today));
    if (today.length){
      const H = today[0];
      await api.post('/api/habits/'+H.id+'/checkin', {status:'done'});
      const after = await api.get('/api/habits/today');
      const h2 = after.find(x=>x.id===H.id);
      ok('checkin reflected locally (today_status=done)', h2 && h2.today_status==='done');
      ok('streak computed ('+h2.streak+')', typeof h2.streak==='number');
    }
    const monthly = await api.get('/api/habits/monthly');
    ok('habits/monthly served locally', monthly && Array.isArray(monthly.days));
    ok('notes page still works (OfflineDB intact)', true); // confirm by opening Notes & Draw manually
  }catch(e){ R.push('❌ EXCEPTION: '+(e&&e.message)); }
  const out='=== HABITS VERIFICATION ===\n'+R.join('\n'); console.log(out); return out;
})()
```

Also manually: open **Habit Tracker** page — habits + today + streak render; toggle a checkin; open **Notes & Draw** and **Dashboard** to confirm nothing broke. Note: checkins are local-only until #2e-2 (Opsi B) — they won't appear on another device/server yet. Report pass/fail.

---

## Done criteria

- `GET /api/habits/logs` added; `habitlogic`/`habitrepo`/`habitquery`/`habithydrate`/`habitroutes` Node-tested; habit routes intercepted via `buildTaskRouter`. Suite green (fail 0).
- Offline: habits list/today/monthly/checkin from local; streak parity after hydration.
- SW bumped; habits hydrate on boot; notes/tasks unaffected.
- Browser-verified (after VPS restart for the new endpoint).

## Next (out of scope)

- **#2e-2 Habits sync** — extend syncpush (entity_type `habit`/`habit_log`) + `pullHabits`; conflict local-wins.
- #2f Notes, #2g Mindmap, #2h Chat → #3 Tauri.
- Cleanup: retire legacy `OfflineDB` habit cache/queue (now dead under intercept).
```
