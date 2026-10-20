"use strict";
// Task 2 (dashboard welcome/sync gate): sync() menulis penanda sync awal & memancarkan tf:sync-state.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const indexHtml = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");

const rej = () => Promise.reject(Object.assign(new Error("http 503"), { status: 503 }));
const ok = () => Promise.resolve({ created: 0, updated: 0, deleted: 0 });

function build(over = {}, { introgate = true, igOver = {} } = {}) {
  const m = indexHtml.match(/function sync\(\) \{[\s\S]*?\n\}/);
  assert.ok(m, "function sync() harus ada");
  const marked = [];
  const events = [];
  const pushCalls = [];
  const win = {
    TF: {
      syncpull: Object.assign({
        pullAndReconcile: ok, pullRecurringExceptions: ok, pullHabitsAndLogs: ok,
        pullNotesAndReconcile: ok, pullMindmapsAndReconcile: ok, pullDrawingsAndReconcile: ok,
      }, over),
      listsync: { pullAndReconcileLists: ok },
      syncpush: { pushOutbox: () => { pushCalls.push(1); return Promise.resolve({ pushed: 1, remaining: 0 }); } },
    },
    dispatchEvent(e) { events.push({ type: e.type, detail: e.detail }); },
  };
  if (introgate) {
    win.TF.introgate = Object.assign({ currentUserId: () => "7", readInitialSync: () => Promise.resolve(false), markInitialSync: (u) => { marked.push(u); return Promise.resolve(); } }, igOver);
  }
  const CE = function (type, init) { this.type = type; this.detail = init && init.detail; };
  const sync = new Function("window", "renderConflicts", "schedulePush", "__syncRawFetch", "__syncTransport", "runSyncExclusive", "CustomEvent",
    "let __syncPending = null;\n" + m[0] + "\nreturn sync;")(win, () => {}, () => {}, () => {}, {}, (task) => Promise.resolve().then(task), CE);
  return { sync, win, marked, events, pushCalls };
}
const tick = () => new Promise((r) => setImmediate(r));

test("sync(): pull task & note sukses → markInitialSync(\"7\") sekali, event tf:initial-sync terkirim", async () => {
  const h = build();
  const r = await h.sync();
  await tick();
  assert.deepEqual(h.marked, ["7"]);
  const ev = h.events.filter((e) => e.type === "tf:initial-sync");
  assert.equal(ev.length, 1);
  assert.deepEqual(ev[0].detail, { user_id: "7" });
  assert.equal(r.pushed, 1, "nilai kembali sync() tetap hasil push");
});

test("sync(): pull note gagal → tidak ada markInitialSync, tidak ada tf:initial-sync, lastFailed true", async () => {
  const h = build({ pullNotesAndReconcile: rej });
  await h.sync(); await tick();
  assert.deepEqual(h.marked, []);
  assert.equal(h.events.filter((e) => e.type === "tf:initial-sync").length, 0);
  assert.equal(h.win.__syncState.lastFailed, true);
});

test("sync(): pull task gagal → tidak ada markInitialSync, lastFailed true", async () => {
  const h = build({ pullAndReconcile: rej });
  await h.sync(); await tick();
  assert.deepEqual(h.marked, []);
  assert.equal(h.win.__syncState.lastFailed, true);
});

test("sync(): event tf:sync-state pertama running:true, terakhir running:false; __syncState.running false setelah selesai", async () => {
  const h = build();
  await h.sync(); await tick();
  const st = h.events.filter((e) => e.type === "tf:sync-state");
  assert.ok(st.length >= 2);
  assert.equal(st[0].detail.running, true);
  assert.equal(st[st.length - 1].detail.running, false);
  assert.equal(st[st.length - 1].detail.lastFailed, false);
  assert.equal(h.win.__syncState.running, false);
});

test("sync(): langkah lain (habits/mindmaps) gagal tapi task & note sukses → tetap ditandai, lastFailed false", async () => {
  const h = build({ pullHabitsAndLogs: rej, pullMindmapsAndReconcile: rej });
  await h.sync(); await tick();
  assert.deepEqual(h.marked, ["7"]);
  assert.equal(h.win.__syncState.lastFailed, false);
});

test("sync(): tanpa window.TF.introgate → tidak melempar, push tetap berjalan", async () => {
  const h = build({}, { introgate: false });
  const r = await h.sync();
  assert.equal(r.pushed, 1);
  assert.equal(h.pushCalls.length, 1);
});

test("sync(): penanda sudah ada → markInitialSync tidak dipanggil lagi dan tanpa tf:initial-sync", async () => {
  const h = build({}, { igOver: { readInitialSync: () => Promise.resolve(true) } });
  const r = await h.sync(); await tick();
  assert.deepEqual(h.marked, []);
  assert.equal(h.events.filter((e) => e.type === "tf:initial-sync").length, 0);
  assert.equal(r.pushed, 1);
  assert.equal(h.win.__syncState.running, false);
});

test("sync(): currentUserId melempar → sync tetap resolve dan tf:sync-state terakhir running:false", async () => {
  const h = build({}, { igOver: { currentUserId: () => { throw new Error("boom"); } } });
  const r = await h.sync(); await tick();
  assert.equal(r.pushed, 1);
  const st = h.events.filter((e) => e.type === "tf:sync-state");
  assert.equal(st[st.length - 1].detail.running, false);
  assert.deepEqual(h.marked, []);
});

test("sync(): user berganti antara awal run dan finish → tanpa markInitialSync dan tanpa tf:initial-sync", async () => {
  let n = 0;
  const h = build({}, { igOver: { currentUserId: () => (n++ === 0 ? "7" : "8") } });
  await h.sync(); await tick();
  assert.deepEqual(h.marked, []);
  assert.equal(h.events.filter((e) => e.type === "tf:initial-sync").length, 0);
  assert.equal(h.win.__syncState.running, false);
});

test("sync(): __userEpoch naik selama run (logout/clearLocalUserData) → tanpa markInitialSync", async () => {
  let h;
  h = build({ pullNotesAndReconcile: () => { h.win.__userEpoch = (h.win.__userEpoch || 0) + 1; return ok(); } });
  await h.sync(); await tick();
  assert.deepEqual(h.marked, []);
  assert.equal(h.events.filter((e) => e.type === "tf:initial-sync").length, 0);
});

test("sync(): jalur normal menandai dengan uid saat run dimulai (epoch tetap)", async () => {
  const h = build();
  h.win.__userEpoch = 3;
  await h.sync(); await tick();
  assert.deepEqual(h.marked, ["7"]);
  const ev = h.events.filter((e) => e.type === "tf:initial-sync");
  assert.deepEqual(ev.map((e) => e.detail), [{ user_id: "7" }]);
});
