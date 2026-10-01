"use strict";
// Regression: persistensi & sinkronisasi drawing standalone (tldraw) — Notes ↔ Draw ↔ mesin lain.
// RC1 payload antrian basi, RC2 lost update di getDrawing online, RC3 write-back basi di push,
// RC6 pull menimpa record dirty tanpa op. Lihat brief-drawing-sync.md.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut, cidOf, serverIdOf } = require("../../static/offline/idmap.js");
const { outboxAll, outboxAdd } = require("../../static/offline/outbox.js");
const { makeBlobStore } = require("../../static/offline/blobstore.js");
const repo = require("../../static/offline/drawingrepo.js");
const { pushOutbox } = require("../../static/offline/syncpush.js");
const { pullDrawings } = require("../../static/offline/syncpull.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

const blobStore = makeBlobStore();
const U1 = "2026-10-01T08:00:00.000001+07:00";
const U2 = "2026-10-01T08:05:00.000002+07:00";
const U3 = "2026-10-01T08:09:00.000003+07:00";

// Snapshot mirip tldraw ({store, schema}) dengan shape ber-id tertentu.
function snap(ids) {
  const store = {
    "document:document": { id: "document:document", typeName: "document", gridSize: 10, name: "", meta: {} },
    "page:page": { id: "page:page", typeName: "page", name: "Page 1", index: "a1", meta: {} },
  };
  for (const id of ids) {
    store["shape:" + id] = { id: "shape:" + id, typeName: "shape", type: "draw", parentId: "page:page", x: 0, y: 0, props: { n: id } };
  }
  return JSON.stringify({ store, schema: { schemaVersion: 2, sequences: {} } });
}
function shapesOf(json) {
  const s = JSON.parse(json);
  return Object.values(s.store || {}).filter((r) => r && r.typeName === "shape").map((r) => r.id.replace("shape:", "")).sort();
}

function fakeTransport(handler) {
  const calls = [];
  return {
    calls,
    request(method, path, body) {
      calls.push({ method, path, body });
      return Promise.resolve(handler(method, path, body, calls.length));
    },
  };
}
function okServer(id, updatedAt) {
  return () => ({ status: 200, data: { id, updated_at: updatedAt } });
}

async function rawRec(cid) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction("drawings", "readonly").objectStore("drawings").get(cid);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => rej(r.error);
  });
}
async function allRecs() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction("drawings", "readonly").objectStore("drawings").getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });
}
async function putRecs(recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("drawings", "readwrite");
    for (const r of recs) tx.objectStore("drawings").put(r);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function drawingOps(cid) {
  return (await outboxAll()).filter((o) => o.entity_type === "drawing" && (!cid || o.cid === cid));
}
// Record bersih yang sudah tersinkron (server_id, base_rev) — dipakai sebagai keadaan awal.
async function syncedRecord(cid, sid, data, over) {
  const ref = await blobStore.put(data, { mime: "application/json" });
  await putRecs([Object.assign({
    cid, server_id: sid, title: "Gambar", blob_ref: ref, svg_preview: "<svg>old</svg>", is_pinned: 0,
    created_at: U1, updated_at: U1, deleted: false, dirty: 0, base_rev: U1, rev: 2,
  }, over || {})]);
  await mapPut("drawing", sid, cid);
  return ref;
}
function srvRow(id, data, updatedAt, over) {
  return Object.assign({ id, server_id: id, title: "Gambar", data_json: data, svg_preview: "<svg>srv</svg>", is_pinned: 0, tags: [], created_at: U1, updated_at: updatedAt }, over || {});
}

// ── A. mutateDrawing: satu transaksi readwrite get→fn→put ────────────────────

test("A1: mutateDrawing diekspor; menerapkan fn secara atomik dan mengembalikan record baru", async () => {
  assert.equal(typeof repo.mutateDrawing, "function", "drawingrepo.mutateDrawing harus diekspor");
  await putRecs([{ cid: "m1", server_id: null, title: "A", dirty: 0, rev: 4, deleted: false }]);
  const out = await repo.mutateDrawing("m1", (cur) => Object.assign({}, cur, { title: "B", rev: (cur.rev || 0) + 1 }));
  assert.equal(out.title, "B");
  const r = await rawRec("m1");
  assert.equal(r.title, "B");
  assert.equal(r.rev, 5);
});

test("A2: mutateDrawing — fn mengembalikan undefined = batal (tidak menulis), record hilang → fn(null)", async () => {
  await putRecs([{ cid: "m2", title: "A", dirty: 0, rev: 1, deleted: false }]);
  const out = await repo.mutateDrawing("m2", () => undefined);
  assert.equal(out, null);
  assert.equal((await rawRec("m2")).title, "A");
  let seen = "unset";
  const out2 = await repo.mutateDrawing("tidak-ada", (cur) => { seen = cur; return undefined; });
  assert.equal(seen, null);
  assert.equal(out2, null);
});

// ── B. updateDrawing: revisi lokal + antrian metadata ─────────────────────────

test("B1: createDrawing rev 1; updateDrawing → rev+1, dirty 1, blob baru ada & blob lama dihapus", async () => {
  const d = await repo.createDrawing({ title: "T", data_json: snap(["a"]) });
  const r0 = await rawRec(d.cid);
  assert.equal(r0.rev, 1);
  await repo.updateDrawing(d.cid, { data_json: snap(["a", "b"]) });
  const r1 = await rawRec(d.cid);
  assert.equal(r1.rev, 2);
  assert.equal(r1.dirty, 1);
  assert.notEqual(r1.blob_ref, r0.blob_ref);
  assert.equal(await blobStore.getBytes(r1.blob_ref), snap(["a", "b"]));
  assert.equal(await blobStore.getBytes(r0.blob_ref), undefined, "blob lama harus dihapus setelah mutasi sukses");
});

test("B2: updateDrawing saat op create tertunda → tidak menambah op update; payload tanpa data_json", async () => {
  const d = await repo.createDrawing({ title: "T", data_json: snap([]) });
  await repo.updateDrawing(d.cid, { data_json: snap(["a"]) });
  await repo.updateDrawing(d.cid, { data_json: snap(["a", "b"]) });
  const ops = await drawingOps(d.cid);
  assert.deepEqual(ops.map((o) => o.op), ["create"]);
  assert.equal(ops[0].payload.data_json, undefined, "payload op tidak boleh menyimpan salinan data_json (push membaca blob)");
});

test("B3: updateDrawing ×3 setelah create terkirim → satu op update, payload metadata ikut terbaru", async () => {
  const d = await repo.createDrawing({ title: "T", data_json: snap([]) });
  await pushOutbox(fakeTransport(okServer(301, U1)));
  await repo.updateDrawing(d.cid, { data_json: snap(["a"]), svg_preview: "<svg>1</svg>" });
  await repo.updateDrawing(d.cid, { data_json: snap(["a", "b"]), svg_preview: "<svg>2</svg>" });
  await repo.updateDrawing(d.cid, { title: "T3", data_json: snap(["a", "b", "c"]), svg_preview: "<svg>3</svg>" });
  const ops = await drawingOps(d.cid);
  assert.equal(ops.length, 1);
  assert.equal(ops[0].op, "update");
  assert.equal(ops[0].payload.data_json, undefined);
  assert.equal(ops[0].payload.title, "T3");
  assert.equal(ops[0].payload.svg_preview, "<svg>3</svg>");
});

test("B4: svg_stale — data tanpa svg → svg_stale 1; dengan svg → 0; getDrawing mengembalikan svg_stale", async () => {
  const d = await repo.createDrawing({ title: "T", data_json: snap([]) });
  await repo.updateDrawing(d.cid, { data_json: snap(["a"]), svg_stale: 1 });
  assert.equal((await rawRec(d.cid)).svg_stale, 1);
  const g1 = await repo.getDrawing(d.cid, { online: false });
  assert.equal(g1.svg_stale, 1);
  await repo.updateDrawing(d.cid, { data_json: snap(["a"]), svg_preview: "<svg>a</svg>", svg_stale: 0 });
  const g2 = await repo.getDrawing(d.cid, { online: false });
  assert.equal(g2.svg_stale, 0);
  assert.equal(g2.svg_preview, "<svg>a</svg>");
});

test("B5: updateDrawing yang berjalan bersamaan diterapkan sesuai urutan panggilan (data terakhir menang)", async () => {
  const d = await repo.createDrawing({ title: "T", data_json: snap([]) });
  const ps = [];
  for (let i = 1; i <= 5; i++) ps.push(repo.updateDrawing(String(d.cid), { data_json: snap(Array.from({ length: i }, (_, k) => "s" + k)) }));
  await Promise.all(ps);
  const r = await rawRec(d.cid);
  assert.deepEqual(shapesOf(await blobStore.getBytes(r.blob_ref)), ["s0", "s1", "s2", "s3", "s4"]);
  assert.equal(r.rev, 6);
});

// ── C. Push mengirim state terkini, tanpa write-back basi ────────────────────

test("C1 (brief #1): create → update ×3 → pushOutbox: POST membawa data TERAKHIR, tidak ada PUT basi", async () => {
  const d = await repo.createDrawing({ title: "Gambar", data_json: "{}" });
  await repo.updateDrawing(d.cid, { data_json: snap(["a"]), svg_preview: "<svg>1</svg>" });
  await repo.updateDrawing(d.cid, { data_json: snap(["a", "b"]), svg_preview: "<svg>2</svg>" });
  await repo.updateDrawing(d.cid, { data_json: snap(["a", "b", "c"]), svg_preview: "<svg>3</svg>" });
  const tr = fakeTransport((m) => (m === "POST" ? { status: 200, data: { id: 401, updated_at: U1 } } : { status: 200, data: { id: 401, updated_at: U2 } }));
  const res = await pushOutbox(tr);
  const posts = tr.calls.filter((c) => c.method === "POST");
  assert.equal(posts.length, 1);
  assert.deepEqual(shapesOf(posts[0].body.data_json), ["a", "b", "c"], "POST harus membawa data terbaru, bukan '{}' dari payload create");
  assert.equal(posts[0].body.svg_preview, "<svg>3</svg>");
  for (const c of tr.calls.filter((x) => x.method === "PUT")) {
    assert.deepEqual(shapesOf(c.body.data_json), ["a", "b", "c"], "tidak boleh ada PUT dengan data basi");
  }
  const r = await rawRec(d.cid);
  assert.equal(r.server_id, 401);
  assert.equal(r.dirty, 0);
  assert.equal(res.remaining, 0);
});

test("C2: setelah create terkirim, 3 edit → satu PUT berisi data & svg terakhir; record bersih, base_rev baru", async () => {
  const d = await repo.createDrawing({ title: "Gambar", data_json: "{}" });
  await pushOutbox(fakeTransport(okServer(402, U1)));
  for (const ids of [["a"], ["a", "b"], ["a", "b", "c", "d", "e", "f"]]) {
    await repo.updateDrawing(String(402), { data_json: snap(ids), svg_preview: "<svg>" + ids.length + "</svg>" });
  }
  const tr = fakeTransport(okServer(402, U2));
  await pushOutbox(tr);
  assert.equal(tr.calls.length, 1);
  assert.equal(tr.calls[0].method, "PUT");
  assert.equal(tr.calls[0].path, "/api/drawings/402");
  assert.deepEqual(shapesOf(tr.calls[0].body.data_json), ["a", "b", "c", "d", "e", "f"]);
  assert.equal(tr.calls[0].body.svg_preview, "<svg>6</svg>");
  const r = await rawRec(d.cid);
  assert.equal(r.dirty, 0);
  assert.equal(r.base_rev, U2);
  assert.equal((await drawingOps(d.cid)).length, 0);
});

test("C3 (brief #2): edit selama PUT in-flight → record tetap dirty, ada op update, blob_ref = blob terbaru & ada", async () => {
  const d = await repo.createDrawing({ title: "Gambar", data_json: "{}" });
  await pushOutbox(fakeTransport(okServer(403, U1)));
  await repo.updateDrawing(d.cid, { data_json: snap(["a"]) });
  let edited = false;
  const tr = {
    calls: [],
    request(method, path, body) {
      this.calls.push({ method, path, body });
      if (method === "PUT" && !edited) {
        edited = true;
        return repo.updateDrawing(d.cid, { data_json: snap(["a", "b"]) }).then(() => ({ status: 200, data: { id: 403, updated_at: U2 } }));
      }
      return Promise.resolve({ status: 200, data: { id: 403, updated_at: U3 } });
    },
  };
  await pushOutbox(tr);
  const r = await rawRec(d.cid);
  assert.equal(r.dirty, 1, "edit selama request tidak boleh ditandai bersih");
  assert.equal(r.base_rev, U2);
  const bytes = await blobStore.getBytes(r.blob_ref);
  assert.ok(bytes, "blob_ref harus menunjuk blob yang masih ada");
  assert.deepEqual(shapesOf(bytes), ["a", "b"]);
  const ops = await drawingOps(d.cid);
  assert.ok(ops.some((o) => o.op === "update"), "harus ada op update untuk edit yang belum terkirim");
  // push berikutnya mengirim edit tsb lalu bersih
  const tr2 = fakeTransport(okServer(403, U3));
  await pushOutbox(tr2);
  assert.equal(tr2.calls.length, 1);
  assert.deepEqual(shapesOf(tr2.calls[0].body.data_json), ["a", "b"]);
  const r2 = await rawRec(d.cid);
  assert.equal(r2.dirty, 0);
  assert.equal(r2.base_rev, U3);
});

test("C4: edit selama POST create in-flight → server_id tersimpan, tetap dirty + op update, blob terbaru", async () => {
  const d = await repo.createDrawing({ title: "Gambar", data_json: snap(["a"]) });
  const tr = {
    calls: [],
    request(method, path, body) {
      this.calls.push({ method, path, body });
      return repo.updateDrawing(d.cid, { data_json: snap(["a", "b"]) }).then(() => ({ status: 200, data: { id: 404, updated_at: U1 } }));
    },
  };
  await pushOutbox(tr);
  assert.equal(tr.calls.length, 1);
  assert.deepEqual(shapesOf(tr.calls[0].body.data_json), ["a"]);
  const r = await rawRec(d.cid);
  assert.equal(r.server_id, 404);
  assert.equal(await serverIdOf(d.cid), 404);
  assert.equal(r.dirty, 1);
  assert.deepEqual(shapesOf(await blobStore.getBytes(r.blob_ref)), ["a", "b"]);
  assert.ok((await drawingOps(d.cid)).some((o) => o.op === "update"));
});

test("C5: PUT 404 → op dihapus, record tetap dirty (pull yang merekonsiliasi)", async () => {
  await syncedRecord("c5", 405, snap(["a"]));
  await repo.updateDrawing("c5", { data_json: snap(["a", "b"]) });
  const tr = fakeTransport(() => ({ status: 404, data: { detail: "Drawing tidak ditemukan" } }));
  await pushOutbox(tr);
  assert.equal((await drawingOps("c5")).length, 0);
  const r = await rawRec("c5");
  assert.equal(r.dirty, 1);
  assert.deepEqual(shapesOf(await blobStore.getBytes(r.blob_ref)), ["a", "b"]);
});

test("C6: op update untuk record ber-server_id tanpa entri idmap tetap dikirim (tidak ditahan selamanya)", async () => {
  const ref = await blobStore.put(snap(["a", "b"]), { mime: "application/json" });
  await putRecs([{ cid: "c6", server_id: 406, title: "G", blob_ref: ref, svg_preview: "", is_pinned: 0, deleted: false, dirty: 1, base_rev: U1, rev: 3, updated_at: U1 }]);
  await outboxAdd({ op: "update", entity_type: "drawing", cid: "c6", payload: { title: "G" } });
  const tr = fakeTransport(okServer(406, U2));
  await pushOutbox(tr);
  assert.equal(tr.calls.length, 1);
  assert.equal(tr.calls[0].path, "/api/drawings/406");
  assert.deepEqual(shapesOf(tr.calls[0].body.data_json), ["a", "b"]);
  assert.equal((await rawRec("c6")).dirty, 0);
});

test("C7: op update lama (payload.data_json) pada record bersih → data payload digabung, tidak hilang", async () => {
  // Keadaan rusak versi lama: getDrawing menimpa record dengan versi server (bersih) tapi op berisi edit user tertinggal.
  await syncedRecord("c7", 407, snap(["a"]));
  await outboxAdd({ op: "update", entity_type: "drawing", cid: "c7", payload: { title: "Gambar", data_json: snap(["a", "b", "c", "d"]), svg_preview: "<svg>4</svg>" } });
  const tr = fakeTransport(okServer(407, U2));
  await pushOutbox(tr);
  assert.equal(tr.calls.length, 1);
  assert.deepEqual(shapesOf(tr.calls[0].body.data_json), ["a", "b", "c", "d"]);
  const r = await rawRec("c7");
  assert.equal(r.dirty, 0);
  assert.deepEqual(shapesOf(await blobStore.getBytes(r.blob_ref)), ["a", "b", "c", "d"], "lokal = server setelah push");
});

// ── D. getDrawing online: tidak ada lost update; heal data rusak lama ─────────

test("D1 (brief #3): getDrawing online dengan fetcher tertunda + updateDrawing di tengah → lokal tidak tertimpa, op tetap", async () => {
  await syncedRecord("d1", 501, snap(["a"]));
  let release;
  const gate = new Promise((r) => { release = r; });
  const fetcher = () => gate.then(() => srvRow(501, snap(["a"]), U1));
  const p = repo.getDrawing("d1", { online: true, fetch: fetcher });
  await new Promise((r) => setTimeout(r, 5));
  await repo.updateDrawing("d1", { data_json: snap(["a", "b", "c"]) });
  release();
  await p.catch(() => null);
  const r = await rawRec("d1");
  assert.equal(r.dirty, 1);
  assert.deepEqual(shapesOf(await blobStore.getBytes(r.blob_ref)), ["a", "b", "c"]);
  assert.ok((await drawingOps("d1")).some((o) => o.op === "update"), "op update tidak boleh dihapus getDrawing");
});

test("D2: getDrawing online — server berubah tapi user mengedit selama fetch → CAS gagal, edit lokal dipertahankan", async () => {
  await syncedRecord("d2", 502, snap(["a"]));
  let release;
  const gate = new Promise((r) => { release = r; });
  const p = repo.getDrawing("d2", { online: true, fetch: () => gate.then(() => srvRow(502, snap(["a", "srv"]), U2)) });
  await new Promise((r) => setTimeout(r, 5));
  await repo.updateDrawing("d2", { data_json: snap(["a", "mine"]) });
  release();
  const out = await p;
  assert.deepEqual(shapesOf(out.data_json), ["a", "mine"]);
  const r = await rawRec("d2");
  assert.equal(r.dirty, 1);
  assert.deepEqual(shapesOf(await blobStore.getBytes(r.blob_ref)), ["a", "mine"]);
  assert.ok((await drawingOps("d2")).some((o) => o.op === "update"));
});

test("D3 (brief #4a): getDrawing online saat dirty → tidak menimpa walau server lebih baru, op utuh", async () => {
  await syncedRecord("d3", 503, snap(["a"]));
  await repo.updateDrawing("d3", { data_json: snap(["a", "b"]) });
  const opsBefore = await drawingOps("d3");
  const out = await repo.getDrawing("d3", { online: true, fetch: () => Promise.resolve(srvRow(503, snap(["x"]), U3)) });
  assert.deepEqual(shapesOf(out.data_json), ["a", "b"]);
  const r = await rawRec("d3");
  assert.equal(r.dirty, 1);
  assert.deepEqual((await drawingOps("d3")).map((o) => o.qid), opsBefore.map((o) => o.qid));
});

test("D4 (brief #4b): getDrawing online saat bersih & server berubah → refresh dari server (dipertahankan)", async () => {
  const oldRef = await syncedRecord("d4", 504, snap(["a"]));
  const out = await repo.getDrawing("d4", { online: true, fetch: () => Promise.resolve(srvRow(504, snap(["a", "b", "c"]), U2, { title: "Baru", svg_preview: "<svg>3</svg>" })) });
  assert.deepEqual(shapesOf(out.data_json), ["a", "b", "c"]);
  assert.equal(out.title, "Baru");
  assert.equal(out.svg_stale, 0);
  const r = await rawRec("d4");
  assert.equal(r.dirty, 0);
  assert.equal(r.base_rev, U2);
  assert.equal(r.svg_preview, "<svg>3</svg>");
  assert.equal(await blobStore.getBytes(oldRef), undefined, "blob lama dibuang setelah refresh");
  assert.equal((await drawingOps("d4")).length, 0);
});

test("D5 (brief #5): heal — record legacy RC1 (bersih, base_rev sama, lokal ≠ server) → union, dirty, op update, svg_stale", async () => {
  // Keadaan rusak lama (RC1): lokal 6 coretan dirty 0, server 1 coretan, base_rev sama. Jejak RC1: record
  // pra-perbaikan (tanpa rev) & updated_at lokal (waktu edit, ISO Z) ≠ base_rev server (heal hanya untuk ini).
  await syncedRecord("d5", 505, snap(["a", "b", "c", "d", "e", "f"]), { rev: undefined, updated_at: "2026-10-01T00:59:59.000Z" });
  const out = await repo.getDrawing("d5", { online: true, fetch: () => Promise.resolve(srvRow(505, snap(["a", "z"]), U1)) });
  assert.deepEqual(shapesOf(out.data_json), ["a", "b", "c", "d", "e", "f", "z"]);
  assert.equal(out.svg_stale, 1);
  const r = await rawRec("d5");
  assert.equal(r.dirty, 1);
  assert.equal(r.svg_stale, 1);
  assert.equal(r.rev, 1);
  assert.deepEqual(shapesOf(await blobStore.getBytes(r.blob_ref)), ["a", "b", "c", "d", "e", "f", "z"]);
  assert.ok((await drawingOps("d5")).some((o) => o.op === "update"));
  const tr = fakeTransport(okServer(505, U2));
  await pushOutbox(tr);
  assert.deepEqual(shapesOf(tr.calls[0].body.data_json), ["a", "b", "c", "d", "e", "f", "z"]);
});

test("D5b: heal lewat GET memberi sinyal 'tf:outbox-queued' (UI menjadwalkan push walau tanpa mutasi)", async () => {
  await syncedRecord("d5b", 515, snap(["a", "b"]), { rev: undefined, updated_at: "2026-10-01T00:59:59.000Z" });
  const events = [];
  const prev = globalThis.dispatchEvent;
  globalThis.dispatchEvent = (ev) => { events.push(ev.type); return true; };
  try {
    await repo.getDrawing("d5b", { online: true, fetch: () => Promise.resolve(srvRow(515, snap(["a"]), U1)) });
    await repo.getDrawing("d5b", { online: true, fetch: () => Promise.resolve(srvRow(515, snap(["a", "b"]), U1)) });
  } finally {
    if (prev === undefined) delete globalThis.dispatchEvent; else globalThis.dispatchEvent = prev;
  }
  assert.deepEqual(events, ["tf:outbox-queued"], "tepat satu sinyal untuk satu heal (record dirty berikutnya tidak di-heal lagi)");
});

test("D6: heal tidak dipicu bila lokal ⊂ server (base_rev sama) → adopsi data server, tetap bersih", async () => {
  await syncedRecord("d6", 506, snap(["a"]));
  const out = await repo.getDrawing("d6", { online: true, fetch: () => Promise.resolve(srvRow(506, snap(["a", "b"]), U1)) });
  assert.deepEqual(shapesOf(out.data_json), ["a", "b"]);
  const r = await rawRec("d6");
  assert.equal(r.dirty, 0);
  assert.equal((await drawingOps("d6")).length, 0);
});

test("D7: blob lokal hilang (bersih, base_rev sama) → diperbaiki dari server", async () => {
  await putRecs([{ cid: "d7", server_id: 507, title: "G", blob_ref: "blob_hilang", svg_preview: "", is_pinned: 0, deleted: false, dirty: 0, base_rev: U1, rev: 1, updated_at: U1 }]);
  await mapPut("drawing", 507, "d7");
  const out = await repo.getDrawing("d7", { online: true, fetch: () => Promise.resolve(srvRow(507, snap(["a", "b"]), U1)) });
  assert.deepEqual(shapesOf(out.data_json), ["a", "b"]);
  const r = await rawRec("d7");
  assert.equal(r.dirty, 0);
  assert.deepEqual(shapesOf(await blobStore.getBytes(r.blob_ref)), ["a", "b"]);
});

test("D8: !rec → record lokal dibuat dengan cid = client_id server, idmap terisi, idempoten (panggilan bersamaan)", async () => {
  const row = srvRow(508, snap(["a", "b"]), U1, { client_id: "cid-mesin-a" });
  const [o1, o2] = await Promise.all([
    repo.getDrawing("cid-mesin-a", { online: true, fetch: () => Promise.resolve(row) }),
    repo.getDrawing("cid-mesin-a", { online: true, fetch: () => Promise.resolve(row) }),
  ]);
  assert.deepEqual(shapesOf(o1.data_json), ["a", "b"]);
  assert.deepEqual(shapesOf(o2.data_json), ["a", "b"]);
  const all = await allRecs();
  assert.equal(all.length, 1);
  assert.equal(all[0].cid, "cid-mesin-a");
  assert.equal(all[0].server_id, 508);
  assert.equal(all[0].dirty, 0);
  assert.equal(await cidOf("drawing", 508), "cid-mesin-a");
});

test("D9: !rec via cid lain tapi server_id sudah ada lokal (cid acak dari pull) → tidak membuat duplikat", async () => {
  await syncedRecord("cid-acak-pull", 509, snap(["a"]));
  const row = srvRow(509, snap(["a"]), U1, { client_id: "cid-mesin-a" });
  const out = await repo.getDrawing("cid-mesin-a", { online: true, fetch: () => Promise.resolve(row) });
  assert.deepEqual(shapesOf(out.data_json), ["a"]);
  const all = await allRecs();
  assert.equal(all.length, 1);
  assert.equal(all[0].cid, "cid-acak-pull");
});

// ── E. Pull tidak menimpa record dirty; tulis lewat CAS rev ───────────────────

test("E1 (brief #6): pull — record dirty tanpa op → op update diantre, lokal tidak ditimpa", async () => {
  await syncedRecord("e1", 601, snap(["a", "b", "c"]), { dirty: 1 });
  const r = await pullDrawings([srvRow(601, undefined, U1)], (sid) => Promise.resolve(srvRow(sid, snap(["a"]), U1)));
  const rec = await rawRec("e1");
  assert.equal(rec.dirty, 1);
  assert.deepEqual(shapesOf(await blobStore.getBytes(rec.blob_ref)), ["a", "b", "c"]);
  assert.ok((await drawingOps("e1")).some((o) => o.op === "update"), "op update harus diantre agar edit terkirim");
  assert.equal(r.updated, 0);
});

test("E2: pull — record dirty tanpa op & server berubah → digabung (union), tidak ditimpa", async () => {
  await syncedRecord("e2", 602, snap(["a", "mine"]), { dirty: 1 });
  await pullDrawings([srvRow(602, undefined, U2)], (sid) => Promise.resolve(srvRow(sid, snap(["a", "theirs"]), U2)));
  const rec = await rawRec("e2");
  assert.equal(rec.dirty, 1);
  assert.equal(rec.base_rev, U2);
  assert.deepEqual(shapesOf(await blobStore.getBytes(rec.blob_ref)), ["a", "mine", "theirs"]);
  assert.ok((await drawingOps("e2")).some((o) => o.op === "update"));
});

test("E3: pull — record bersih diedit selama fetchOne → tulis server dibatalkan (CAS rev), edit lokal selamat", async () => {
  await syncedRecord("e3", 603, snap(["a"]));
  const fetchOne = (sid) => repo.updateDrawing("e3", { data_json: snap(["a", "mine"]) })
    .then(() => srvRow(sid, snap(["a", "theirs"]), U2));
  await pullDrawings([srvRow(603, undefined, U2)], fetchOne);
  const rec = await rawRec("e3");
  assert.equal(rec.dirty, 1);
  assert.deepEqual(shapesOf(await blobStore.getBytes(rec.blob_ref)), ["a", "mine"]);
  assert.ok((await drawingOps("e3")).some((o) => o.op === "update"));
});

test("E4: pull — merge dirty dibatalkan bila record diedit selama fetch (CAS rev)", async () => {
  await syncedRecord("e4", 604, snap(["a", "mine"]), { dirty: 1 });
  await outboxAdd({ op: "update", entity_type: "drawing", cid: "e4", payload: { title: "Gambar" } });
  const fetchOne = (sid) => repo.updateDrawing("e4", { data_json: snap(["a", "mine", "mine2"]) })
    .then(() => srvRow(sid, snap(["a", "theirs"]), U2));
  await pullDrawings([srvRow(604, undefined, U2)], fetchOne);
  const rec = await rawRec("e4");
  assert.deepEqual(shapesOf(await blobStore.getBytes(rec.blob_ref)), ["a", "mine", "mine2"]);
  assert.equal(rec.dirty, 1);
});

// ── G. Mesin lain: cid lokal ≠ id direktif note (client_id mesin pembuat) ─────
// Daftar /api/drawings tidak membawa client_id → pull membuat record dengan cid acak, sedangkan note berisi
// ::draw[<cid mesin A>]. Simpan dari QuickDraw (PUT /api/drawings/<cid A>) harus tetap menemukan record itu.

test("G1: getRaw/updateDrawing menemukan record lewat client_id server (cid lokal berbeda)", async () => {
  await syncedRecord("cid-acak-b", 701, snap(["a"]), { client_id: "cid-mesin-a" });
  const r = await repo.getRaw("cid-mesin-a");
  assert.ok(r, "getRaw harus fallback ke client_id");
  assert.equal(r.cid, "cid-acak-b");
  await repo.updateDrawing("cid-mesin-a", { data_json: snap(["a", "b"]) });
  const rec = await rawRec("cid-acak-b");
  assert.equal(rec.dirty, 1);
  assert.deepEqual(shapesOf(await blobStore.getBytes(rec.blob_ref)), ["a", "b"]);
  assert.equal((await allRecs()).length, 1);
});

test("G2: pull menyimpan client_id dari baris server lengkap pada record baru", async () => {
  const fetchOne = (sid) => Promise.resolve(srvRow(sid, snap(["a"]), U1, { client_id: "cid-mesin-a" }));
  await pullDrawings([srvRow(702, undefined, U1)], fetchOne);
  const all = await allRecs();
  assert.equal(all.length, 1);
  assert.equal(all[0].client_id, "cid-mesin-a");
  const viaClient = await repo.getRaw("cid-mesin-a");
  assert.ok(viaClient && viaClient.server_id === 702);
});

test("G3: getDrawing online via cid mesin A, record lama (tanpa client_id) ditemukan lewat server_id → client_id dicatat, tanpa duplikat", async () => {
  await syncedRecord("cid-acak-lama", 703, snap(["a"]));
  const row = srvRow(703, snap(["a"]), U1, { client_id: "cid-mesin-a" });
  const out = await repo.getDrawing("cid-mesin-a", { online: true, fetch: () => Promise.resolve(row) });
  assert.deepEqual(shapesOf(out.data_json), ["a"]);
  assert.equal((await allRecs()).length, 1);
  assert.equal((await rawRec("cid-acak-lama")).client_id, "cid-mesin-a");
  // simpan berikutnya dari QuickDraw (id = cid mesin A) masuk ke record yang sama
  await repo.updateDrawing("cid-mesin-a", { data_json: snap(["a", "b"]) });
  const rec = await rawRec("cid-acak-lama");
  assert.equal(rec.dirty, 1);
  assert.deepEqual(shapesOf(await blobStore.getBytes(rec.blob_ref)), ["a", "b"]);
});
