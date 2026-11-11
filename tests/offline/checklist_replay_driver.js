"use strict";
// Penggerak JSONL untuk tests/test_checklist_offline_replay_node.py (uji putar ulang antrean checklist offline,
// perbaikan review W1): pytest mengirim satu perintah JSON per baris, berkas ini menjalankan rute lokal checklist
// (taskroutes + checklistroutes + checklistrepo di atas fake-indexeddb) dan membalas satu baris JSON.
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
const { deleteDB } = require("./setup.js");

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
  return { error: "perintah tidak dikenal: " + c.cmd };
}

const rl = readline.createInterface({ input: process.stdin });
let chain = Promise.resolve();
rl.on("line", (line) => {
  chain = chain.then(async () => {
    let out;
    try { out = await handle(JSON.parse(line)); } catch (e) { out = { crash: String((e && e.stack) || e) }; }
    process.stdout.write(JSON.stringify(out) + "\n");
  });
});
rl.on("close", () => { chain.then(() => process.exit(0)); });
