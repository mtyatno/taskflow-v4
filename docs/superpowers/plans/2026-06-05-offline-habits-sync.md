# Offline Habits Sync (#2e-2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sambungkan domain habits ke mesin sync — push op habit/habit_log dari `_outbox` ke server REST, dan pull perubahan habit/log server ke lokal — dengan extend `syncpush.js` + `syncpull.js`, tanpa modul baru & tanpa perubahan backend.

**Architecture:** Habit **tak punya `updated_at`** → definisi habit = local-wins (push update 404 → re-create via POST + remap server_id). habit_logs = upsert-by-(habit,date), tanpa deteksi server-delete. Pull pakai full-list reconcile client-only (skip record dirty = local-wins). `sync()` (kini pull→push) ditambah pull habits; `habithydrate.ensureHabits` boot digantikan pull.

**Tech Stack:** Vanilla JS UMD modules di `static/offline/`, IndexedDB (`fake-indexeddb` di Node test), `node:test`. Spec: `docs/superpowers/specs/2026-06-05-offline-habits-sync-design.md`.

---

## Konteks kunci (baca sebelum mulai)

- `serverIdOf(cid)` di `idmap.js` hanya 1 argumen (lookup via index `cid`, lintas-type). `mapPut(type, serverId, cid)` / `mapDelete(type, serverId)` / `cidOf(type, serverId)` pakai `(type, serverId)`. Habit memakai `type = "habit"`.
- Store `habits` di-key `cid` (index `server_id`, `dirty`). Store `habit_logs` di-key `cid`, index unik `habit_date` = `[habit_cid, date]`.
- `habits` lokal: `{cid, server_id, title(bersih), phase, micro_target, frequency(JSON string), identity_pillar, created_at, deleted, dirty}`. NO `updated_at`/`base_rev`.
- `habit_log` lokal: `{cid, habit_cid, date, status, skip_reason, dirty}`.
- Server `frequency` = JSON string (disimpan apa adanya lokal). `POST /api/habits` balas full habit dict (incl. `id`). `POST /api/habits/{id}/update` balas `{ok, id}` (404 bila habit hilang). `DELETE /api/habits/{id}` (404 bila hilang). `POST /api/habits/{id}/checkin` (404 bila habit hilang).
- `syncpush.js` sudah punya helper `titleWithTags`, `send`, `ok`, `getTaskRaw/putTaskRaw/deleteTaskRaw`, dispatch `processOp(op, transport, tagsFor, result)`, `pushOutbox(transport, opts)`.
- `syncpull.js` sudah punya `pullTasks`/`pullAndReconcile`, helper `tsEpoch`, `dropOutbox`.

## File yang disentuh

- **Modify** `static/offline/syncpush.js` — mapper habit + 4 handler op + dispatch + `habitTagsFor`.
- **Modify** `static/offline/syncpull.js` — `pullHabits`, `pullHabitLogs`, `pullHabitsAndLogs` + helper.
- **Modify** `tests/offline/syncpush.test.js` — test handler habit.
- **Modify** `tests/offline/syncpull.test.js` — test pull habit/log.
- **Modify** `static/index.html` — `sync()` tambah pull habits (≈baris 1510-1515); hapus `ensureHabits` boot (≈baris 20704).
- **Modify** `static/sw.js` — bump `CACHE` v125→v126 (baris 1).

---

## Task 1: Mapper push habit (pure)

**Files:**
- Modify: `static/offline/syncpush.js`
- Test: `tests/offline/syncpush.test.js`

- [ ] **Step 1: Write the failing test**

Tambahkan di akhir `tests/offline/syncpush.test.js`:

```javascript
const {
  habitToCreatePayload, habitToUpdatePayload, checkinPayload,
} = require("../../static/offline/syncpush.js");

function habit(over) {
  return Object.assign({
    cid: over.cid, server_id: null, title: over.cid, phase: "pagi", micro_target: "",
    frequency: JSON.stringify(["mon", "wed"]), identity_pillar: "", created_at: null,
    deleted: false, dirty: 1,
  }, over);
}

test("habitToCreatePayload reconstructs title+tags and parses frequency to array", () => {
  const p = habitToCreatePayload(habit({ cid: "h", title: "Lari", phase: "siang", micro_target: "5 menit", identity_pillar: "sehat" }), ["pagi_hari"]);
  assert.equal(p.title, "Lari #pagi_hari");
  assert.equal(p.phase, "siang");
  assert.equal(p.micro_target, "5 menit");
  assert.deepEqual(p.frequency, ["mon", "wed"]);
  assert.equal(p.identity_pillar, "sehat");
});

test("habitToUpdatePayload has the same shape as create", () => {
  const p = habitToUpdatePayload(habit({ cid: "h", title: "Baca" }), ["x"]);
  assert.equal(p.title, "Baca #x");
  assert.deepEqual(p.frequency, ["mon", "wed"]);
});

test("checkinPayload returns date/status/skip_reason", () => {
  assert.deepEqual(
    checkinPayload({ date: "2026-06-05", status: "done", skip_reason: "" }),
    { date: "2026-06-05", status: "done", skip_reason: "" }
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/syncpush.test.js`
Expected: FAIL — `habitToCreatePayload is not a function`.

- [ ] **Step 3: Write minimal implementation**

Di `static/offline/syncpush.js`, setelah fungsi `markPayload` (≈baris 60), tambahkan:

```javascript
  function habitToCreatePayload(record, tagNames) {
    return {
      title: titleWithTags(record, tagNames),
      phase: record.phase || "pagi",
      micro_target: record.micro_target != null ? record.micro_target : "",
      frequency: record.frequency ? JSON.parse(record.frequency) : [],
      identity_pillar: record.identity_pillar != null ? record.identity_pillar : "",
    };
  }
  function habitToUpdatePayload(record, tagNames) {
    return habitToCreatePayload(record, tagNames);
  }
  function checkinPayload(record) {
    return {
      date: record.date,
      status: record.status,
      skip_reason: record.skip_reason != null ? record.skip_reason : "",
    };
  }
```

Lalu tambahkan ke objek `exported` (≈baris 191):

```javascript
  const exported = { taskToCreatePayload, taskToUpdatePayload, markPayload, habitToCreatePayload, habitToUpdatePayload, checkinPayload, pushOutbox };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/syncpush.test.js`
Expected: PASS (semua test lama + 3 baru).

- [ ] **Step 5: Commit**

```bash
git add static/offline/syncpush.js tests/offline/syncpush.test.js
git commit -m "feat(offline): habit push payload mappers (#2e-2)"
```

---

## Task 2: Handler push habit/create

**Files:**
- Modify: `static/offline/syncpush.js`
- Test: `tests/offline/syncpush.test.js`

- [ ] **Step 1: Write the failing test**

Tambahkan di `tests/offline/syncpush.test.js`:

```javascript
const { cidOf: _cidOfH, mapPut: _mapPutH } = require("../../static/offline/idmap.js");
const { setEntityTags: _setTagsH } = require("../../static/offline/tagrepo.js");

async function getHabit(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("habits").objectStore("habits").get(cid); q.onsuccess = () => res(q.result); });
}

test("pushOutbox habit create posts, sets server_id + idmap, removes op", async () => {
  await put("habits", [habit({ cid: "h", title: "Lari" })]);
  await _setTagsH("habit", "h", ["pagi_hari"]);
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "habit", cid: "h", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 200, data: { id: 50, title: "Lari" } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(r.remaining, 0);
  assert.equal(tr.calls[0].method, "POST");
  assert.equal(tr.calls[0].path, "/api/habits");
  assert.equal(tr.calls[0].body.title, "Lari #pagi_hari");
  assert.equal(await serverIdOf("h"), 50);
  const rec = await getHabit("h");
  assert.equal(rec.server_id, 50);
  assert.equal(rec.dirty, 0);
});

test("pushOutbox skips a habit create whose record already has server_id", async () => {
  await put("habits", [habit({ cid: "h", server_id: 9, title: "Lari" })]);
  await put("_outbox", [{ qid: 1, op: "create", entity_type: "habit", cid: "h", payload: {} }]);
  const tr = fakeTransport(() => { throw new Error("should not POST"); });
  const r = await pushOutbox(tr);
  assert.equal(tr.calls.length, 0);
  assert.equal(r.remaining, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/syncpush.test.js`
Expected: FAIL — habit create op di-drop oleh `processOp` default (op terhapus, `pushed` 0, `serverIdOf` undefined).

- [ ] **Step 3: Write minimal implementation**

Di `static/offline/syncpush.js`, tambahkan helper store habit setelah `deleteTaskRaw` (≈baris 85):

```javascript
  function getHabitRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("habits", "readonly").objectStore("habits").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  function putHabitRaw(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("habits", "readwrite");
      tx.objectStore("habits").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function deleteHabitRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("habits", "readwrite");
      tx.objectStore("habits").delete(cid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
```

Tambahkan handler create setelah `opMark` (≈baris 162):

```javascript
  function opHabitCreate(op, transport, habitTagsFor, result) {
    return getHabitRaw(op.cid).then((rec) => {
      if (!rec) return TFoutbox.outboxRemove(op.qid);
      if (rec.server_id != null) return TFoutbox.outboxRemove(op.qid);
      return habitTagsFor(op.cid).then((tags) =>
        send(transport, "POST", "/api/habits", habitToCreatePayload(rec, tags)).then((res) => {
          if (ok(res)) {
            const sid = res.data.id;
            return TFidmap.mapPut("habit", sid, op.cid)
              .then(() => putHabitRaw(Object.assign({}, rec, { server_id: sid, dirty: 0 })))
              .then(() => TFoutbox.outboxRemove(op.qid))
              .then(() => { result.pushed++; });
          }
          result.failed++;
          return TFoutbox.outboxRemove(op.qid);
        })
      );
    });
  }
```

Ubah `processOp` agar menerima `habitTagsFor` dan men-dispatch habit create. Ganti seluruh fungsi `processOp` (≈baris 164-170):

```javascript
  function processOp(op, transport, tagsFor, habitTagsFor, result) {
    if (op.entity_type === "task" && op.op === "create") return opCreate(op, transport, tagsFor, result);
    if (op.entity_type === "task" && op.op === "update") return opUpdate(op, transport, tagsFor, result);
    if (op.entity_type === "task" && op.op === "delete") return opDelete(op, transport, result);
    if (op.entity_type === "recurring_exception" && op.op === "mark_occurrence") return opMark(op, transport, result);
    if (op.entity_type === "habit" && op.op === "create") return opHabitCreate(op, transport, habitTagsFor, result);
    return TFoutbox.outboxRemove(op.qid);
  }
```

Di `pushOutbox` (≈baris 173-189), tambahkan `habitTagsFor` dan teruskan ke `processOp`. Setelah baris `const tagsFor = ...` tambahkan:

```javascript
    const habitTagsFor = opts.habitTagsFor || ((cid) => TFtag.getEntityTags("habit", cid).then((ts) => ts.map((t) => t.name)));
```

Lalu ubah pemanggilan `processOp` di dalam `reduce`:

```javascript
        return processOp(op, transport, tagsFor, habitTagsFor, result).catch((err) => { stopped = true; if (!(err && err.__network)) result.failed++; });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/syncpush.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add static/offline/syncpush.js tests/offline/syncpush.test.js
git commit -m "feat(offline): push habit create (#2e-2)"
```

---

## Task 3: Handler push habit/update (incl. 404 → re-create)

**Files:**
- Modify: `static/offline/syncpush.js`
- Test: `tests/offline/syncpush.test.js`

- [ ] **Step 1: Write the failing test**

Tambahkan di `tests/offline/syncpush.test.js`:

```javascript
test("pushOutbox habit update posts to /update and clears dirty", async () => {
  await put("habits", [habit({ cid: "h", server_id: 7, title: "Lari" })]);
  await _mapPutH("habit", 7, "h");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "habit", cid: "h", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 200, data: { ok: true, id: 7 } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls[0].method, "POST");
  assert.equal(tr.calls[0].path, "/api/habits/7/update");
  assert.equal((await getHabit("h")).dirty, 0);
});

test("pushOutbox habit update 404 re-creates the habit and remaps server_id", async () => {
  await put("habits", [habit({ cid: "h", server_id: 7, title: "Lari" })]);
  await _mapPutH("habit", 7, "h");
  await put("_outbox", [{ qid: 1, op: "update", entity_type: "habit", cid: "h", payload: {} }]);
  let n = 0;
  const tr = fakeTransport((m, p) => {
    if (n++ === 0) return { status: 404, data: { detail: "gone" } };
    return { status: 200, data: { id: 88, title: "Lari" } };
  });
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls[1].method, "POST");
  assert.equal(tr.calls[1].path, "/api/habits");
  assert.equal(await serverIdOf("h"), 88);
  assert.equal(await _cidOfH("habit", 7), undefined);
  const rec = await getHabit("h");
  assert.equal(rec.server_id, 88);
  assert.equal(rec.dirty, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/syncpush.test.js`
Expected: FAIL — habit update op di-drop default (no PUT/POST call, `pushed` 0).

- [ ] **Step 3: Write minimal implementation**

Tambahkan handler setelah `opHabitCreate` di `static/offline/syncpush.js`:

```javascript
  function opHabitUpdate(op, transport, habitTagsFor, result) {
    return Promise.all([getHabitRaw(op.cid), TFidmap.serverIdOf(op.cid)]).then(([rec, sid]) => {
      if (!rec || sid == null) return TFoutbox.outboxRemove(op.qid);
      return habitTagsFor(op.cid).then((tags) =>
        send(transport, "POST", "/api/habits/" + sid + "/update", habitToUpdatePayload(rec, tags)).then((res) => {
          if (ok(res)) {
            return putHabitRaw(Object.assign({}, rec, { dirty: 0 }))
              .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.pushed++; });
          }
          if (res.status === 404) {
            // habit deleted on server → local-wins: re-create, then remap idmap
            return send(transport, "POST", "/api/habits", habitToCreatePayload(rec, tags)).then((res2) => {
              if (ok(res2)) {
                const nid = res2.data.id;
                return TFidmap.mapDelete("habit", sid)
                  .then(() => TFidmap.mapPut("habit", nid, op.cid))
                  .then(() => putHabitRaw(Object.assign({}, rec, { server_id: nid, dirty: 0 })))
                  .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.pushed++; });
              }
              result.failed++;
              return TFoutbox.outboxRemove(op.qid);
            });
          }
          result.failed++;
          return TFoutbox.outboxRemove(op.qid);
        })
      );
    });
  }
```

Tambahkan dispatch di `processOp` (setelah baris habit create):

```javascript
    if (op.entity_type === "habit" && op.op === "update") return opHabitUpdate(op, transport, habitTagsFor, result);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/syncpush.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add static/offline/syncpush.js tests/offline/syncpush.test.js
git commit -m "feat(offline): push habit update with 404 re-create (#2e-2)"
```

---

## Task 4: Handler push habit/delete

**Files:**
- Modify: `static/offline/syncpush.js`
- Test: `tests/offline/syncpush.test.js`

- [ ] **Step 1: Write the failing test**

Tambahkan di `tests/offline/syncpush.test.js`:

```javascript
test("pushOutbox habit delete DELETEs, hard-deletes local + idmap", async () => {
  await put("habits", [habit({ cid: "h", server_id: 7, deleted: true })]);
  await _mapPutH("habit", 7, "h");
  await put("_outbox", [{ qid: 1, op: "delete", entity_type: "habit", cid: "h", payload: { cid: "h" } }]);
  const tr = fakeTransport(() => ({ status: 200, data: { ok: true } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls[0].method, "DELETE");
  assert.equal(tr.calls[0].path, "/api/habits/7");
  assert.equal(await getHabit("h"), undefined);
  assert.equal(await _cidOfH("habit", 7), undefined);
});

test("pushOutbox habit delete with no server_id just drops op + local record", async () => {
  await put("habits", [habit({ cid: "h", deleted: true })]);
  await put("_outbox", [{ qid: 1, op: "delete", entity_type: "habit", cid: "h", payload: { cid: "h" } }]);
  const tr = fakeTransport(() => { throw new Error("should not call"); });
  const r = await pushOutbox(tr);
  assert.equal(tr.calls.length, 0);
  assert.equal(r.remaining, 0);
  assert.equal(await getHabit("h"), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/syncpush.test.js`
Expected: FAIL — habit delete op di-drop default (no DELETE call; record `h` masih ada).

- [ ] **Step 3: Write minimal implementation**

Tambahkan handler setelah `opHabitUpdate`:

```javascript
  function opHabitDelete(op, transport, result) {
    return TFidmap.serverIdOf(op.cid).then((sid) => {
      if (sid == null) {
        return deleteHabitRaw(op.cid).then(() => TFoutbox.outboxRemove(op.qid));
      }
      return send(transport, "DELETE", "/api/habits/" + sid, undefined).then((res) => {
        if (ok(res) || res.status === 404) {
          return TFidmap.mapDelete("habit", sid)
            .then(() => deleteHabitRaw(op.cid))
            .then(() => TFoutbox.outboxRemove(op.qid))
            .then(() => { result.pushed++; });
        }
        result.failed++;
        return TFoutbox.outboxRemove(op.qid);
      });
    });
  }
```

Tambahkan dispatch di `processOp`:

```javascript
    if (op.entity_type === "habit" && op.op === "delete") return opHabitDelete(op, transport, result);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/syncpush.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add static/offline/syncpush.js tests/offline/syncpush.test.js
git commit -m "feat(offline): push habit delete (#2e-2)"
```

---

## Task 5: Handler push habit_log/checkin

**Files:**
- Modify: `static/offline/syncpush.js`
- Test: `tests/offline/syncpush.test.js`

- [ ] **Step 1: Write the failing test**

Tambahkan di `tests/offline/syncpush.test.js`:

```javascript
async function putLogRow(rec) { await put("habit_logs", [rec]); }
async function getLog(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("habit_logs").objectStore("habit_logs").get(cid); q.onsuccess = () => res(q.result); });
}

test("pushOutbox checkin resolves habit server_id and posts to /checkin", async () => {
  await put("habits", [habit({ cid: "h", server_id: 7 })]);
  await _mapPutH("habit", 7, "h");
  await putLogRow({ cid: "log1", habit_cid: "h", date: "2026-06-05", status: "done", skip_reason: "", dirty: 1 });
  await put("_outbox", [{ qid: 1, op: "checkin", entity_type: "habit_log", cid: "log1", payload: {} }]);
  const tr = fakeTransport(() => ({ status: 200, data: { ok: true, habit_id: 7, date: "2026-06-05", status: "done" } }));
  const r = await pushOutbox(tr);
  assert.equal(r.pushed, 1);
  assert.equal(tr.calls[0].method, "POST");
  assert.equal(tr.calls[0].path, "/api/habits/7/checkin");
  assert.deepEqual(tr.calls[0].body, { date: "2026-06-05", status: "done", skip_reason: "" });
  assert.equal((await getLog("log1")).dirty, 0);
});

test("pushOutbox checkin drops op when the habit has no server_id (deleted)", async () => {
  await putLogRow({ cid: "log1", habit_cid: "gone", date: "2026-06-05", status: "done", skip_reason: "", dirty: 1 });
  await put("_outbox", [{ qid: 1, op: "checkin", entity_type: "habit_log", cid: "log1", payload: {} }]);
  const tr = fakeTransport(() => { throw new Error("should not call"); });
  const r = await pushOutbox(tr);
  assert.equal(tr.calls.length, 0);
  assert.equal(r.remaining, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/syncpush.test.js`
Expected: FAIL — checkin op di-drop default (no POST; log dirty masih 1).

- [ ] **Step 3: Write minimal implementation**

Tambahkan helper log + handler setelah `opHabitDelete`:

```javascript
  function getLogRaw(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("habit_logs", "readonly").objectStore("habit_logs").get(cid);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  function putLogRaw(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("habit_logs", "readwrite");
      tx.objectStore("habit_logs").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function opHabitCheckin(op, transport, result) {
    return getLogRaw(op.cid).then((log) => {
      if (!log) return TFoutbox.outboxRemove(op.qid);
      return TFidmap.serverIdOf(log.habit_cid).then((sid) => {
        if (sid == null) return TFoutbox.outboxRemove(op.qid);
        return send(transport, "POST", "/api/habits/" + sid + "/checkin", checkinPayload(log)).then((res) => {
          if (ok(res)) {
            return putLogRaw(Object.assign({}, log, { dirty: 0 }))
              .then(() => TFoutbox.outboxRemove(op.qid)).then(() => { result.pushed++; });
          }
          result.failed++;
          return TFoutbox.outboxRemove(op.qid);
        });
      });
    });
  }
```

Tambahkan dispatch di `processOp`:

```javascript
    if (op.entity_type === "habit_log" && op.op === "checkin") return opHabitCheckin(op, transport, result);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/syncpush.test.js`
Expected: PASS (semua test syncpush hijau).

- [ ] **Step 5: Commit**

```bash
git add static/offline/syncpush.js tests/offline/syncpush.test.js
git commit -m "feat(offline): push habit_log checkin (#2e-2)"
```

---

## Task 6: Pull habits (full-list reconcile)

**Files:**
- Modify: `static/offline/syncpull.js`
- Test: `tests/offline/syncpull.test.js`

- [ ] **Step 1: Write the failing test**

Tambahkan di akhir `tests/offline/syncpull.test.js`:

```javascript
const { pullHabits } = require("../../static/offline/syncpull.js");
const { cidOf: _cidOfHp } = require("../../static/offline/idmap.js");

async function putHabits(recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("habits", "readwrite");
    const os = tx.objectStore("habits");
    for (const r of recs) os.put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function getHabitRec(cid) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("habits").objectStore("habits").get(cid); q.onsuccess = () => res(q.result); });
}
async function allHabits() {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("habits").objectStore("habits").getAll(); q.onsuccess = () => res(q.result || []); });
}
function srvHabit(over) {
  return Object.assign({
    id: over.id, title: "H", phase: "pagi", micro_target: "",
    frequency: JSON.stringify(["mon"]), identity_pillar: "", created_at: "2026-06-01T00:00:00",
  }, over);
}

test("pullHabits creates an unknown server habit", async () => {
  const r = await pullHabits([srvHabit({ id: 3, title: "Lari" })]);
  assert.equal(r.created, 1);
  const rows = await allHabits();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].server_id, 3);
  assert.equal(rows[0].title, "Lari");
  assert.equal(rows[0].dirty, 0);
});

test("pullHabits updates a clean local habit when a field differs", async () => {
  await putHabits([{ cid: "h", server_id: 3, title: "Old", phase: "pagi", micro_target: "", frequency: JSON.stringify(["mon"]), identity_pillar: "", deleted: false, dirty: 0 }]);
  await mapPut("habit", 3, "h");
  const r = await pullHabits([srvHabit({ id: 3, title: "New" })]);
  assert.equal(r.updated, 1);
  assert.equal((await getHabitRec("h")).title, "New");
});

test("pullHabits skips a dirty local habit (local-wins)", async () => {
  await putHabits([{ cid: "h", server_id: 3, title: "Local edit", phase: "pagi", micro_target: "", frequency: JSON.stringify(["mon"]), identity_pillar: "", deleted: false, dirty: 1 }]);
  await mapPut("habit", 3, "h");
  const r = await pullHabits([srvHabit({ id: 3, title: "Server" })]);
  assert.equal(r.skipped, 1);
  assert.equal((await getHabitRec("h")).title, "Local edit");
});

test("pullHabits leaves an unchanged clean habit alone", async () => {
  await putHabits([{ cid: "h", server_id: 3, title: "H", phase: "pagi", micro_target: "", frequency: JSON.stringify(["mon"]), identity_pillar: "", deleted: false, dirty: 0 }]);
  await mapPut("habit", 3, "h");
  const r = await pullHabits([srvHabit({ id: 3, title: "H" })]);
  assert.equal(r.updated, 0);
  assert.equal(r.created, 0);
});

test("pullHabits hard-deletes a clean local habit whose server_id vanished + clears idmap", async () => {
  await putHabits([{ cid: "h", server_id: 3, title: "H", phase: "pagi", micro_target: "", frequency: JSON.stringify(["mon"]), identity_pillar: "", deleted: false, dirty: 0 }]);
  await mapPut("habit", 3, "h");
  const r = await pullHabits([]);
  assert.equal(r.deleted, 1);
  assert.equal(await getHabitRec("h"), undefined);
  assert.equal(await _cidOfHp("habit", 3), undefined);
});

test("pullHabits does NOT delete a dirty local habit missing from server", async () => {
  await putHabits([{ cid: "h", server_id: 3, title: "Local", phase: "pagi", micro_target: "", frequency: JSON.stringify(["mon"]), identity_pillar: "", deleted: false, dirty: 1 }]);
  await mapPut("habit", 3, "h");
  const r = await pullHabits([]);
  assert.equal(r.deleted, 0);
  assert.equal(r.skipped, 1);
  assert.notEqual(await getHabitRec("h"), undefined);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/syncpull.test.js`
Expected: FAIL — `pullHabits is not a function`.

- [ ] **Step 3: Write minimal implementation**

Di `static/offline/syncpull.js`, tambahkan sebelum baris `const exported = ...` (≈baris 118):

```javascript
  const DEFAULT_FREQ = JSON.stringify(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);

  function habitFromServer(h, cid) {
    return {
      cid: cid, server_id: h.id, title: h.title,
      phase: h.phase || "pagi",
      micro_target: h.micro_target != null ? h.micro_target : "",
      frequency: h.frequency != null ? h.frequency : DEFAULT_FREQ,
      identity_pillar: h.identity_pillar != null ? h.identity_pillar : "",
      created_at: h.created_at != null ? h.created_at : null,
      deleted: false, dirty: 0,
    };
  }
  function habitChanged(local, h) {
    return local.title !== h.title
      || (local.phase || "pagi") !== (h.phase || "pagi")
      || (local.micro_target || "") !== (h.micro_target || "")
      || local.frequency !== (h.frequency != null ? h.frequency : DEFAULT_FREQ)
      || (local.identity_pillar || "") !== (h.identity_pillar || "");
  }
  function getAllHabits() {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("habits", "readonly").objectStore("habits").getAll();
      r.onsuccess = () => resolve(r.result || []);
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
  function deleteHabitRec(cid) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("habits", "readwrite");
      tx.objectStore("habits").delete(cid);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function ensureHabitCid(serverId, cache) {
    if (cache[serverId]) return Promise.resolve(cache[serverId]);
    return TFidmap.cidOf("habit", serverId).then((cid) => {
      if (cid) { cache[serverId] = cid; return cid; }
      const fresh = TFids.newCid();
      cache[serverId] = fresh;
      return TFidmap.mapPut("habit", serverId, fresh).then(() => fresh);
    });
  }

  function pullHabits(serverHabits) {
    const list = serverHabits || [];
    const cache = {};
    return list.reduce((p, h) => p.then(() => ensureHabitCid(h.id, cache)), Promise.resolve())
      .then(() => getAllHabits())
      .then((localAll) => {
        const localByCid = {};
        for (const r of localAll) localByCid[r.cid] = r;
        const result = { created: 0, updated: 0, deleted: 0, skipped: 0 };
        let chain = Promise.resolve();
        for (const h of list) {
          const cid = cache[h.id];
          const localRec = localByCid[cid];
          chain = chain.then(() => {
            if (!localRec) { result.created++; return putHabit(habitFromServer(h, cid)); }
            if (localRec.dirty) { result.skipped++; return; }
            if (habitChanged(localRec, h)) { result.updated++; return putHabit(habitFromServer(h, cid)); }
            return;
          });
        }
        const serverIds = new Set(list.map((h) => String(h.id)));
        for (const r of localAll) {
          if (r.server_id == null) continue;
          if (serverIds.has(String(r.server_id))) continue;
          chain = chain.then(() => {
            if (r.dirty) { result.skipped++; return; }
            result.deleted++;
            return deleteHabitRec(r.cid).then(() => TFidmap.mapDelete("habit", r.server_id));
          });
        }
        return chain.then(() => result);
      });
  }
```

Ubah `exported` (≈baris 118) menambah `pullHabits`:

```javascript
  const exported = { pullTasks, pullAndReconcile, pullHabits };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/syncpull.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add static/offline/syncpull.js tests/offline/syncpull.test.js
git commit -m "feat(offline): pull habits reconcile (#2e-2)"
```

---

## Task 7: Pull habit_logs (upsert) + pullHabitsAndLogs

**Files:**
- Modify: `static/offline/syncpull.js`
- Test: `tests/offline/syncpull.test.js`

- [ ] **Step 1: Write the failing test**

Tambahkan di `tests/offline/syncpull.test.js`:

```javascript
const { pullHabitLogs, pullHabitsAndLogs } = require("../../static/offline/syncpull.js");

async function putLogs(recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("habit_logs", "readwrite");
    const os = tx.objectStore("habit_logs");
    for (const r of recs) os.put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function logByHabitDate(habitCid, date) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction("habit_logs").objectStore("habit_logs").index("habit_date").get([habitCid, date]); q.onsuccess = () => res(q.result); });
}

test("pullHabitLogs creates a new log mapped to the habit cid", async () => {
  await mapPut("habit", 3, "h");
  const r = await pullHabitLogs([{ habit_id: 3, date: "2026-06-05", status: "done", skip_reason: "" }]);
  assert.equal(r.created, 1);
  const log = await logByHabitDate("h", "2026-06-05");
  assert.equal(log.status, "done");
  assert.equal(log.dirty, 0);
});

test("pullHabitLogs upserts a clean local log when status differs", async () => {
  await mapPut("habit", 3, "h");
  await putLogs([{ cid: "L1", habit_cid: "h", date: "2026-06-05", status: "skipped", skip_reason: "", dirty: 0 }]);
  const r = await pullHabitLogs([{ habit_id: 3, date: "2026-06-05", status: "done", skip_reason: "" }]);
  assert.equal(r.updated, 1);
  assert.equal((await logByHabitDate("h", "2026-06-05")).status, "done");
});

test("pullHabitLogs skips a dirty local log (local-wins)", async () => {
  await mapPut("habit", 3, "h");
  await putLogs([{ cid: "L1", habit_cid: "h", date: "2026-06-05", status: "done", skip_reason: "", dirty: 1 }]);
  const r = await pullHabitLogs([{ habit_id: 3, date: "2026-06-05", status: "skipped", skip_reason: "" }]);
  assert.equal(r.skipped, 1);
  assert.equal((await logByHabitDate("h", "2026-06-05")).status, "done");
});

test("pullHabitsAndLogs pulls habits then logs from rawFetch", async () => {
  const rawFetch = (u) => {
    if (u === "/api/habits") return Promise.resolve({ json: () => Promise.resolve([srvHabit({ id: 3, title: "Lari" })]) });
    return Promise.resolve({ json: () => Promise.resolve([{ habit_id: 3, date: "2026-06-05", status: "done", skip_reason: "" }]) });
  };
  const r = await pullHabitsAndLogs(rawFetch);
  assert.equal(r.habits.created, 1);
  assert.equal(r.logs.created, 1);
  assert.equal((await logByHabitDate((await allHabits())[0].cid, "2026-06-05")).status, "done");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/offline/syncpull.test.js`
Expected: FAIL — `pullHabitLogs is not a function`.

- [ ] **Step 3: Write minimal implementation**

Di `static/offline/syncpull.js`, tambahkan setelah `pullHabits` (sebelum `pullAndReconcile` atau sebelum `exported`):

```javascript
  function getLogByHabitDate(habitCid, date) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const r = db.transaction("habit_logs", "readonly").objectStore("habit_logs").index("habit_date").get([habitCid, date]);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }));
  }
  function putLog(rec) {
    return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction("habit_logs", "readwrite");
      tx.objectStore("habit_logs").put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    }));
  }
  function pullHabitLogs(serverLogs) {
    const list = serverLogs || [];
    const cache = {};
    const result = { created: 0, updated: 0, skipped: 0 };
    return list.reduce((p, l) => p.then(() =>
      ensureHabitCid(l.habit_id, cache).then((hcid) =>
        getLogByHabitDate(hcid, l.date).then((local) => {
          const skip = l.skip_reason != null ? l.skip_reason : "";
          if (!local) {
            result.created++;
            return putLog({ cid: TFids.newCid(), habit_cid: hcid, date: l.date, status: l.status, skip_reason: skip, dirty: 0 });
          }
          if (local.dirty) { result.skipped++; return; }
          if (local.status !== l.status || (local.skip_reason || "") !== skip) {
            result.updated++;
            return putLog(Object.assign({}, local, { status: l.status, skip_reason: skip, dirty: 0 }));
          }
          return;
        })
      )
    ), Promise.resolve()).then(() => result);
  }
  function pullHabitsAndLogs(rawFetch) {
    return Promise.all([
      Promise.resolve(rawFetch("/api/habits")).then((r) => (r && typeof r.json === "function" ? r.json() : r)),
      Promise.resolve(rawFetch("/api/habits/logs")).then((r) => (r && typeof r.json === "function" ? r.json() : r)),
    ]).then(([habits, logs]) =>
      pullHabits(habits || []).then((hb) =>
        pullHabitLogs(logs || []).then((lg) => ({ habits: hb, logs: lg }))));
  }
```

Ubah `exported`:

```javascript
  const exported = { pullTasks, pullAndReconcile, pullHabits, pullHabitLogs, pullHabitsAndLogs };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/offline/syncpull.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add static/offline/syncpull.js tests/offline/syncpull.test.js
git commit -m "feat(offline): pull habit logs + pullHabitsAndLogs (#2e-2)"
```

---

## Task 8: Wire habits pull into sync() + drop ensureHabits boot

**Files:**
- Modify: `static/index.html` (≈baris 1510-1515 `sync()`; ≈baris 20702-20705 boot)

- [ ] **Step 1: Add habits pull to sync()**

Di `static/index.html`, fungsi `sync()` (≈baris 1510). Ubah dari:

```javascript
  return window.TF.syncpull.pullAndReconcile(__syncRawFetch)
    .then(() => (window.TF.listsync ? window.TF.listsync.pullAndReconcileLists(__syncRawFetch) : null))
    .then(() => window.TF.syncpush.pushOutbox(__syncTransport))
```

menjadi:

```javascript
  return window.TF.syncpull.pullAndReconcile(__syncRawFetch)
    .then(() => (window.TF.listsync ? window.TF.listsync.pullAndReconcileLists(__syncRawFetch) : null))
    .then(() => (window.TF.syncpull.pullHabitsAndLogs ? window.TF.syncpull.pullHabitsAndLogs(__syncRawFetch) : null))
    .then(() => window.TF.syncpush.pushOutbox(__syncTransport))
```

- [ ] **Step 2: Remove the ensureHabits boot call**

Di boot (≈baris 20702-20705), hapus baris `ensureHabits` (kini digantikan `pullHabitsAndLogs` di dalam `sync()`). Ubah dari:

```javascript
    if (navigator.onLine && __token) {
      try { await sync(); } catch (e) {}
      try { if (window.TF && window.TF.habithydrate) await window.TF.habithydrate.ensureHabits(__syncRawFetch); } catch (e) {}
    }
```

menjadi:

```javascript
    if (navigator.onLine && __token) {
      try { await sync(); } catch (e) {}
    }
```

- [ ] **Step 3: Syntax-check the inline scripts**

Run (PowerShell, dari root repo):

```powershell
node -e "const fs=require('fs');const h=fs.readFileSync('static/index.html','utf8');const m=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)];let i=0;for(const x of m){try{new Function(x[1]);}catch(e){console.log('SCRIPT',i,'ERR',e.message);}i++;}console.log('checked',m.length,'inline scripts');"
```

Expected: `checked N inline scripts` tanpa baris `ERR`.

- [ ] **Step 4: Commit**

```bash
git add static/index.html
git commit -m "feat(offline): wire habits pull into sync, drop ensureHabits boot (#2e-2)"
```

---

## Task 9: Bump service worker cache

**Files:**
- Modify: `static/sw.js:1`

- [ ] **Step 1: Bump CACHE version**

Di `static/sw.js` baris 1, ubah:

```javascript
const CACHE = "taskflow-v125-habits";
```

menjadi:

```javascript
const CACHE = "taskflow-v126-habit-sync";
```

(Tidak ada modul baru — `syncpush.js`/`syncpull.js` sudah di-precache. Hanya string versi.)

- [ ] **Step 2: Commit**

```bash
git add static/sw.js
git commit -m "chore(sw): bump cache v126 (habit sync)"
```

---

## Task 10: Full suite + deploy + browser verify

- [ ] **Step 1: Run the whole offline suite**

Run (dari root repo Z:): `node --test tests/offline/*.test.js`
Expected: `pass` ≥ 185 + test baru (target sekitar `pass 200+`), `fail 0`.

- [ ] **Step 2: Merge ff to main + push**

```bash
git checkout main
git merge --ff-only <branch>
git push origin main
```

(Skip bila sudah bekerja langsung di `main`.)

- [ ] **Step 3: Verify deploy (backend TIDAK berubah — tak perlu restart taskflow-web)**

Tunggu GitHub Action selesai, lalu:

Run: `curl -s https://todo.yatno.web.id/sw.js | findstr CACHE`
Expected: `const CACHE = "taskflow-v126-habit-sync";` (bukti commit ter-deploy; lihat [[feedback_deploy_silent_fail]]).

- [ ] **Step 4: Browser verify (reset SW dulu di tab login)**

Di DevTools console (https://todo.yatno.web.id), reset SW + cache + reload, lalu verifikasi offline→online:
1. Buat habit baru `Minum air #sehat` offline → `window.__syncNow()` saat online → cek `GET /api/habits` (raw fetch / web lain) memuat habit + tag.
2. Edit habit lokal → `__syncNow()` → perubahan di server.
3. Checkin (done) → `__syncNow()` → `GET /api/habits/logs` memuat log.
4. Buat habit via web lain / device lain → `__syncNow()` → muncul di lokal (today view).
5. Notes tetap berfungsi (OfflineDB legacy utuh).

Catat hasil verifikasi (mis. "5/5 ✅") untuk update memori [[project_offline_native]].

---

## Self-review notes

- **Spec coverage:** push mapper (T1), 4 handler op create/update(404-recreate)/delete/checkin (T2-T5), pullHabits skip-dirty + delete-clean (T6), pullHabitLogs upsert + pullHabitsAndLogs (T7), wiring sync() + drop ensureHabits (T8), SW bump (T9), suite+deploy+browser (T10). Semua bagian spec tercakup.
- **No backend change:** dikonfirmasi — semua endpoint sudah ada sejak #2e-1.
- **Type/nama konsisten:** `habitToCreatePayload`/`habitToUpdatePayload`/`checkinPayload`, `opHabitCreate/Update/Delete`, `opHabitCheckin`, `pullHabits/pullHabitLogs/pullHabitsAndLogs`, `ensureHabitCid`, `habitFromServer`, `habitChanged`. `serverIdOf(cid)` 1-arg; `mapPut/mapDelete/cidOf(type, serverId)`.
- **Frequency:** disimpan lokal sebagai JSON string; push `JSON.parse` → array; pull simpan apa adanya (server kirim string). Konsisten dgn `habithydrate`/`habitrepo`.
