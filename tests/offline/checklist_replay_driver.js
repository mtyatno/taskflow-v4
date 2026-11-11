"use strict";
// Penggerak JSONL untuk tests/test_checklist_offline_replay_node.py (uji putar ulang antrean checklist offline,
// perbaikan review W1): pytest mengirim satu perintah JSON per baris, berkas ini menjalankan rute lokal checklist
// (taskroutes + checklistroutes + checklistrepo di atas fake-indexeddb) dan membalas satu baris JSON.
// Perintah `push` menjalankan syncpush.pushOutbox SUNGGUHAN; setiap request transport-nya dikirim ke pytest sebagai
// baris {"req": {method, path, body}} dan jawaban pytest (satu baris {status, data}, dari TaskRepository) menjadi
// respons transport — antrean diputar ulang oleh kode push aplikasi, bukan tiruan Python. Perintah `pull` menulis
// `checklist_rev` server ke record task (seperti pull task / TASK_DERIVED) lalu menjalankan syncpull.pullChecklists
// SUNGGUHAN dengan rawFetch yang dijembatani dengan cara yang sama (GET /api/checklists).
// Bukan berkas tes node (tidak berakhiran .test.js).
require("./setup.js");
const path = require("node:path");
const readline = require("node:readline");

const OFF = path.resolve(__dirname, "../../static/offline");
const TFdb = require(path.join(OFF, "db.js"));
const { mapPut } = require(path.join(OFF, "idmap.js"));
const { outboxAll } = require(path.join(OFF, "outbox.js"));
const CR = require(path.join(OFF, "checklistrepo.js"));
const T = require(path.join(OFF, "taskroutes.js"));
const SP = require(path.join(OFF, "syncpush.js"));
const SL = require(path.join(OFF, "syncpull.js"));
const { deleteDB } = require("./setup.js");

// Jembatan transport push → pytest: satu request menunggu satu baris jawaban {status, data}, atau {net: true}
// (jaringan putus / respons hilang → TypeError) / {abort: true} (batas waktu → AbortError).
let waiter = null;
const transport = {
  request(method, p, body) {
    return new Promise((resolve, reject) => {
      waiter = (ans) => {
        if (ans && ans.net) { reject(new TypeError("Failed to fetch")); return; }
        if (ans && ans.abort) { const e = new Error("abort"); e.name = "AbortError"; reject(e); return; }
        resolve(ans);
      };
      process.stdout.write(JSON.stringify({ req: { method, path: p, body: body === undefined ? null : body } }) + "\n");
    });
  },
};

function put(store, recs) {
  return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, "readwrite");
    for (const r of recs) t.objectStore(store).put(r);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  }));
}
function getAll(store) {
  return TFdb.openDB().then((db) => new Promise((resolve, reject) => {
    const r = db.transaction(store, "readonly").objectStore(store).getAll();
    r.onsuccess = () => resolve(r.result || []);
    r.onerror = () => reject(r.error);
  }));
}

let router = null;
async function handle(c) {
  if (c.cmd === "init") {
    CR._reset();
    TFdb._reset();
    await deleteDB(TFdb.DB_NAME);
    await put("tasks", c.tasks || []);
    await put("subtasks", c.records || []);
    for (const [sid, cid] of c.idmap || []) await mapPut("subtask", sid, cid);
    await CR.start();
    await CR.markHydrated();
    for (const [k, v] of c.revs || []) await CR.setRev(k, v);
    router = T.buildTaskRouter();
    return { ok: true };
  }
  if (c.cmd === "route") {
    const local = T.shouldRouteLocally(router, c.method, c.path);
    try {
      return { local, ok: true, res: await router.dispatch(c.method, c.path, c.body) };
    } catch (e) {
      return { local, ok: false, status: e.status, detail: e.body ? e.body.detail : String(e.message) };
    }
  }
  if (c.cmd === "items") return { items: await CR.itemsForTask(c.task || "t1") };
  if (c.cmd === "records") return { records: await getAll("subtasks") };
  if (c.cmd === "queue") return { queue: (await outboxAll()).filter((o) => o.entity_type === "subtasks") };
  if (c.cmd === "revs") return { revs: await CR.getRevs() };
  if (c.cmd === "push") return { result: await SP.pushOutbox(transport) };
  if (c.cmd === "pull") {
    await TFdb.mutate("tasks", c.task || "t1", (cur) => (cur ? Object.assign({}, cur, { checklist_rev: c.checklist_rev }) : undefined));
    const rawFetch = (u) => transport.request("GET", u, undefined)
      .then((r) => ({ ok: r.status >= 200 && r.status < 300, status: r.status, json: () => Promise.resolve(r.data) }));
    return { result: await SL.pullChecklists(rawFetch) };
  }
  if (c.cmd === "task") {
    const db = await TFdb.openDB();
    return { task: await new Promise((res) => { const r = db.transaction("tasks").objectStore("tasks").get(c.task || "t1"); r.onsuccess = () => res(r.result || null); }) };
  }
  return { error: "perintah tidak dikenal: " + c.cmd };
}

const rl = readline.createInterface({ input: process.stdin });
let chain = Promise.resolve();
rl.on("line", (line) => {
  if (waiter) { const w = waiter; waiter = null; w(JSON.parse(line)); return; }
  chain = chain.then(async () => {
    let out;
    try { out = await handle(JSON.parse(line)); } catch (e) { out = { crash: String((e && e.stack) || e) }; }
    process.stdout.write(JSON.stringify(out) + "\n");
  });
});
rl.on("close", () => { chain.then(() => process.exit(0)); });
