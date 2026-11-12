"use strict";
// Satu tab saja yang mengirim antrean / mengunduh checklist (perbaikan review akhir W2 PR B2 checklist offline).
// Tanpa kunci lintas tab, event `online` dan fetchAll 30 dtk memicu sync() di SETIAP tab: dua tab menguras antrean
// IndexedDB yang sama bersamaan, tab yang tertinggal mengirim ulang set_done(true) sesudah tab lain mengirim
// set_done(false) → server ≠ lokal sementara rev tersimpan ikut maju (tidak pernah diambil ulang). Kunci Web Locks
// (`navigator.locks`, TF.outbox.withQueueLock) mencakup pushOutbox dan pullChecklists: sinkron latar melewatinya bila
// dipegang tab lain (busy → dijadwalkan ulang), __pushNow menunggu. Dua tab = dua instans modul (cache require
// dibersihkan) di atas satu fake-indexeddb + satu navigator.locks palsu (tests/offline/weblocks_fake.js).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { deleteDB } = require("./setup.js");
const { createLockManager, installLocks } = require("./weblocks_fake.js");

const OFF = path.resolve(__dirname, "../../static/offline");
const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8");

function tab() {
  for (const k of Object.keys(require.cache)) if (k.startsWith(OFF)) delete require.cache[k];
  return {
    db: require(path.join(OFF, "db.js")),
    CR: require(path.join(OFF, "checklistrepo.js")),
    idmap: require(path.join(OFF, "idmap.js")),
    outbox: require(path.join(OFF, "outbox.js")),
    push: require(path.join(OFF, "syncpush.js")),
    pull: require(path.join(OFF, "syncpull.js")),
  };
}
function put(TFdb, store, recs, key) {
  return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, "readwrite");
    for (const r of recs) (key ? t.objectStore(store).put(r, key) : t.objectStore(store).put(r));
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  }));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// LCG bernih tetap: percobaan acak bisa diulang.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

// Server mini (dari probe reviewer): satu butir (id 11, task 7), centang SET, rev + rev_bumped seperti update_subtask.
function miniServer() {
  const S = { done: false, rev: 3, log: [] };
  S.apply = (method, p, body) => {
    if (method === "PATCH" && p === "/api/subtasks/11") {
      const want = !!body.is_done;
      const bumped = want !== S.done;
      if (bumped) { S.done = want; S.rev++; }
      return { status: 200, data: { id: 11, task_id: 7, parent_id: null, depth: 0, title: "a", is_done: S.done, sort_order: 0,
        changed_ids: bumped ? [11] : [], task_progress: { done: S.done ? 1 : 0, total: 1, progress: S.done ? 100 : 0, rev: S.rev, rev_bumped: bumped } } };
    }
    return { status: 404, data: { detail: "?" } };
  };
  S.transport = (name, delay) => ({
    request(method, p, body) {
      return new Promise((res) => setTimeout(() => {
        S.log.push(name + " " + method + " " + p + " " + JSON.stringify(body));
        res(S.apply(method, p, body));
      }, typeof delay === "function" ? delay() : delay));
    },
  });
  return S;
}

// Dua tab di atas satu DB berisi task t1 (server 7) dengan butir a (server 11), rev tersimpan 3; `toggles` aksi
// centang bergantian (true, false, …) dari tab A → antrean set_done.
async function twoTabs(toggles) {
  const A = tab();
  await deleteDB(A.db.DB_NAME);
  await put(A.db, "tasks", [{ cid: "t1", server_id: 7, title: "T", deleted: false, dirty: 0, rev: 1, progress: 0, checklist_total: 1, checklist_rev: 3 }]);
  await put(A.db, "subtasks", [{ cid: "a", server_id: 11, task_cid: "t1", parent_cid: null, title: "a", is_done: false, sort_order: 0 }]);
  await A.idmap.mapPut("task", 7, "t1");
  await A.idmap.mapPut("subtask", 11, "a");
  await put(A.db, "_meta", [{ t1: 3 }], "checklist_revs");
  await A.CR.start();
  for (let i = 0; i < toggles; i++) await A.CR.setDone("a", i % 2 === 0);
  const B = tab();
  await B.CR.start();
  return { A, B };
}
async function verdict(A, S) {
  const local = (await A.CR.itemsForTask("t1"))[0].is_done;
  const stored = (await A.CR.getRevs()).t1;
  const left = (await A.outbox.outboxAll()).length;
  return { same: local === S.done, local, server: S.done, stored, rev: S.rev, left };
}
function closeAll(...tabs) { for (const t of tabs) t.db._reset(); }

test("dua tab mengirim bersamaan (A cepat, B lambat 40 ms): satu tab saja yang menguras, server = lokal", async () => {
  const mgr = createLockManager();
  const uninstall = installLocks(mgr);
  try {
    const { A, B } = await twoTabs(2); // set_done(true), set_done(false) → lokal akhir: belum selesai
    const S = miniServer();
    const [ra, rb] = await Promise.all([A.push.pushOutbox(S.transport("A", 0)), B.push.pushOutbox(S.transport("B", 40))]);
    const v = await verdict(A, S);
    assert.deepEqual([v.same, v.local, v.server, v.left], [true, false, false, 0], JSON.stringify({ v, log: S.log }));
    assert.equal(S.log.length, 2, "setiap entri terkirim tepat sekali: " + S.log.join(" | "));
    assert.ok(S.log.every((l) => l.startsWith("A ")), "hanya tab pemegang kunci yang mengirim");
    assert.equal(ra.pushed, 2);
    assert.deepEqual([rb.busy, rb.pushed, rb.remaining], [true, 0, -1], "tab lain: busy → dijadwalkan ulang oleh pemanggil");
    assert.equal(v.stored, v.rev, "rev tersimpan = rev server hanya karena isinya memang sama");
    assert.equal(mgr.isHeld("tf-antrean-sinkron:" + A.db.DB_NAME), false, "kunci dilepas");
    closeAll(A, B);
  } finally { uninstall(); }
});

test("dua tab, latensi acak 5–50 ms dan mulai acak 0–30 ms: 40 percobaan, 0 menyimpang", async () => {
  const mgr = createLockManager();
  const uninstall = installLocks(mgr);
  try {
    const bad = [];
    for (let i = 1; i <= 40; i++) {
      const r = rng(i);
      const { A, B } = await twoTabs(6);
      const S = miniServer();
      const lat = () => 5 + Math.floor(r() * 45);
      const off = Math.floor(r() * 30);
      await Promise.all([A.push.pushOutbox(S.transport("A", lat)), sleep(off).then(() => B.push.pushOutbox(S.transport("B", lat)))]);
      const v = await verdict(A, S);
      if (!v.same || v.left !== 0 || S.log.length !== 6) bad.push({ i, v, sent: S.log.length });
      closeAll(A, B);
    }
    assert.deepEqual(bad, [], "percobaan menyimpang: " + JSON.stringify(bad.slice(0, 3)));
  } finally { uninstall(); }
});

test("pullChecklists di tab X saat tab Y sedang mengirim → dilewati tanpa unduh (memori tetap dimuat ulang); sesudah dilepas berjalan", async () => {
  const mgr = createLockManager();
  const uninstall = installLocks(mgr);
  try {
    const { A: Y, B: X } = await twoTabs(1);
    await put(Y.db, "tasks", [{ cid: "t2", server_id: 8, title: "T2", deleted: false, dirty: 0, rev: 1, progress: 0, checklist_total: 1, checklist_rev: 2 }]);
    await Y.idmap.mapPut("task", 8, "t2");
    await Y.CR.setRev("t2", 1);
    const S = miniServer();
    let open;
    const gate = new Promise((r) => { open = r; });
    const pushing = Y.push.pushOutbox({ request: (m, p, b) => gate.then(() => S.apply(m, p, b)) });
    const name = "tf-antrean-sinkron:" + Y.db.DB_NAME;
    for (let i = 0; i < 50 && !mgr.isHeld(name); i++) await sleep(2);
    assert.equal(mgr.isHeld(name), true, "tab Y memegang kunci selama mengirim");
    const fetched = [];
    const rawFetch = (u) => {
      fetched.push(u);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ 8: { rev: 2, items: [
        { id: 81, task_id: 8, parent_id: null, depth: 0, title: "b", is_done: false, sort_order: 0 }] } }) });
    };
    let refreshed = 0;
    const realRefresh = X.CR.refresh;
    X.CR.refresh = () => { refreshed++; return realRefresh.call(X.CR); };
    const r1 = await X.pull.pullChecklists(rawFetch);
    assert.equal(r1.locked, true);
    assert.deepEqual(fetched, [], "tanpa unduh selama tab lain memegang kunci");
    assert.equal(refreshed, 1, "memori kesiapan tetap dimuat ulang dari IndexedDB");
    open();
    const ry = await pushing;
    assert.equal(ry.pushed, 1);
    const r2 = await X.pull.pullChecklists(rawFetch);
    assert.equal(r2.locked, undefined);
    assert.equal(fetched.length, 1, "kunci bebas → unduh berjalan");
    assert.deepEqual((await X.CR.itemsForTask("t2")).map((i) => i.title), ["b"]);
    closeAll(X, Y);
  } finally { uninstall(); }
});

test("galat / exception di tengah pengurasan → kunci dilepas, tab lain bisa mengirim", async () => {
  const mgr = createLockManager();
  const uninstall = installLocks(mgr);
  try {
    const { A, B } = await twoTabs(1);
    const S = miniServer();
    const name = "tf-antrean-sinkron:" + A.db.DB_NAME;
    // (1) exception di luar penanganan per op (baca antrean gagal) → pushOutbox menolak, kunci dilepas
    const real = A.outbox.outboxAll;
    A.outbox.outboxAll = () => Promise.reject(new Error("IDB rusak"));
    await assert.rejects(A.push.pushOutbox(S.transport("A", 0)), /IDB rusak/);
    A.outbox.outboxAll = real;
    assert.equal(mgr.isHeld(name), false, "kunci dilepas sesudah exception");
    // (2) galat jaringan per op → drain berhenti, op tetap, kunci dilepas
    const ra = await A.push.pushOutbox({ request: () => Promise.reject(new TypeError("Failed to fetch")) });
    assert.equal(ra.remaining, 1);
    assert.equal(mgr.isHeld(name), false, "kunci dilepas sesudah galat jaringan");
    // (3) tab lain langsung bisa mengirim
    const rb = await B.push.pushOutbox(S.transport("B", 0));
    assert.deepEqual([rb.busy, rb.pushed, rb.remaining], [undefined, 1, 0]);
    assert.equal(S.done, true);
    // (4) pullChecklists yang melempar juga melepas kunci
    const realGet = B.CR.getRevs;
    B.CR.getRevs = () => Promise.reject(new Error("meta rusak"));
    await assert.rejects(B.pull.pullChecklists(() => Promise.reject(new Error("x"))), /meta rusak/);
    B.CR.getRevs = realGet;
    assert.equal(mgr.isHeld(name), false, "kunci dilepas sesudah pullChecklists melempar");
    closeAll(A, B);
  } finally { uninstall(); }
});

test("waitLock (__pushNow): menunggu tab lain selesai lalu mengirim entri yang masuk sesudahnya", async () => {
  const mgr = createLockManager();
  const uninstall = installLocks(mgr);
  try {
    const { A, B } = await twoTabs(1);
    const S = miniServer();
    let open;
    let sent = false;
    const gate = new Promise((r) => { open = r; });
    const pa = A.push.pushOutbox({ request: (m, p, b) => { sent = true; return gate.then(() => { S.log.push("A " + JSON.stringify(b)); return S.apply(m, p, b); }); } });
    for (let i = 0; i < 100 && !sent; i++) await sleep(2);
    assert.equal(sent, true, "tab A sudah membaca antrean dan mengirim entri pertama");
    await B.CR.setDone("a", false); // aksi baru di tab B sesudah tab A membaca antrean
    const skip = await B.push.pushOutbox(S.transport("B", 0));
    assert.equal(skip.busy, true, "sinkron latar: dilewati");
    const pb = B.push.pushOutbox(S.transport("B", 0), { waitLock: true });
    await sleep(20);
    assert.deepEqual(S.log, [], "tab B menunggu, belum mengirim apa pun");
    open();
    const [ra, rb] = await Promise.all([pa, pb]);
    assert.equal(ra.pushed, 1);
    assert.deepEqual([rb.busy, rb.pushed, rb.remaining], [undefined, 1, 0]);
    assert.deepEqual(S.log, ['A {"is_done":true}', 'B PATCH /api/subtasks/11 {"is_done":false}']);
    assert.equal(S.done, false);
    closeAll(A, B);
  } finally { uninstall(); }
});

test("tanpa navigator.locks (browser/WebView lama) atau request kunci gagal → perilaku lama: tetap jalan tanpa kunci", async () => {
  assert.equal(globalThis.navigator && globalThis.navigator.locks, undefined);
  const { A, B } = await twoTabs(1);
  const S = miniServer();
  const r = await A.push.pushOutbox(S.transport("A", 0));
  assert.deepEqual([r.busy, r.pushed], [undefined, 1]);
  await A.CR.setDone("a", false);
  const uninstall = installLocks({ request: () => Promise.reject(new DOMException("tidak diizinkan", "SecurityError")) });
  try {
    const r2 = await B.push.pushOutbox(S.transport("B", 0));
    assert.deepEqual([r2.busy, r2.pushed], [undefined, 1], "kunci gagal sebelum callback → jalan tanpa kunci");
    assert.equal(S.done, false);
  } finally { uninstall(); }
  closeAll(A, B);
});

test("index.html: __pushNow (dorong sekarang, mis. sebelum logout / bagikan) menunggu kunci; sinkron latar tidak", () => {
  assert.match(indexHtml, /window\.__pushNow = \(\) => \(window\.TF && window\.TF\.syncpush\) \? runSyncExclusive\(\(\) => window\.TF\.syncpush\.pushOutbox\(__syncTransport, \{ waitLock: true \}\)\) : Promise\.resolve\(null\);/);
  assert.match(indexHtml, /runSyncExclusive\(\(\) => window\.TF\.syncpush\.pushOutbox\(__syncTransport\)\)\n/, "schedulePush: tanpa waitLock");
  assert.match(indexHtml, /\.then\(\(\) => window\.TF\.syncpush\.pushOutbox\(__syncTransport\)\) \/\/ 401 di sini/, "sync(): tanpa waitLock");
});
