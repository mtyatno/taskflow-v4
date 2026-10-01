"use strict";
// Pengerasan sinkronisasi drawing (putaran review independen): R1–R7 dari reviewer + kasus terkait.
// R1 heal salah sasaran, R2 gema push in-flight saat pull, R3 bytes dari record basi, R4 blob dihapus
// edit bersamaan saat push create, R5/R6 respons server basi (cache SW), R7 konfirmasi hapus remote.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut } = require("../../static/offline/idmap.js");
const { outboxAll, outboxAdd } = require("../../static/offline/outbox.js");
const { makeBlobStore } = require("../../static/offline/blobstore.js");
const repo = require("../../static/offline/drawingrepo.js");
const tagrepo = require("../../static/offline/tagrepo.js");
const { pushOutbox } = require("../../static/offline/syncpush.js");
const { pullDrawings, pullDrawingsAndReconcile, pullMindmapsAndReconcile } = require("../../static/offline/syncpull.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });
const blobStore = makeBlobStore();
const U1 = "2026-10-01T08:00:00.000001+07:00";
const U2 = "2026-10-01T08:05:00.000002+07:00";
const U3 = "2026-10-01T08:09:00.000003+07:00";

function snapX(shapes) { // shapes: {id: x}
  const store = {
    "document:document": { id: "document:document", typeName: "document", gridSize: 10, name: "", meta: {} },
    "page:page": { id: "page:page", typeName: "page", name: "Page 1", index: "a1", meta: {} },
  };
  for (const [id, x] of Object.entries(shapes)) {
    store["shape:" + id] = { id: "shape:" + id, typeName: "shape", type: "draw", parentId: "page:page", x, y: 0, props: { n: id } };
  }
  return JSON.stringify({ store, schema: { schemaVersion: 2, sequences: {} } });
}
function shapesX(json) {
  const s = JSON.parse(json);
  const out = {};
  for (const r of Object.values(s.store || {})) if (r && r.typeName === "shape") out[r.id.replace("shape:", "")] = r.x;
  return out;
}
async function rawRec(cid) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction("drawings", "readonly").objectStore("drawings").get(cid);
    r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error);
  });
}
async function allRecs() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction("drawings", "readonly").objectStore("drawings").getAll();
    r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error);
  });
}
async function putRecs(recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("drawings", "readwrite");
    for (const r of recs) tx.objectStore("drawings").put(r);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function record(cid, sid, data, over) {
  const ref = await blobStore.put(data, { mime: "application/json" });
  await putRecs([Object.assign({ cid, server_id: sid, title: "Gambar", blob_ref: ref, svg_preview: "", is_pinned: 0,
    created_at: U1, updated_at: U1, deleted: false, dirty: 0, base_rev: U1, rev: 2 }, over || {})]);
  if (sid != null) await mapPut("drawing", sid, cid);
  return ref;
}
function srvRow(id, data, updatedAt, over) {
  return Object.assign({ id, title: "Gambar", data_json: data, svg_preview: "<svg>srv</svg>", is_pinned: 0, tags: [], created_at: U1, updated_at: updatedAt }, over || {});
}
function transport(handler) {
  const calls = [];
  return { calls, request(m, p, b) { calls.push({ m, p, b }); return Promise.resolve(handler(m, p, b)); } };
}

// ── R1: heal hanya untuk record LAMA pra-perbaikan (jejak RC1) ──────────────────
test("R1: record legacy hasil pull lama (updated_at = base_rev, tanpa rev) & isi beda → adopsi server, bukan heal", async () => {
  const oldLocal = snapX({ a: 0, b: 0 });   // blob lama yang tertinggal
  const serverNew = snapX({ a: 100 });       // versi benar di server (a digeser, b dihapus)
  const ref = await blobStore.put(oldLocal, { mime: "application/json" });
  await putRecs([{ cid: "r1", server_id: 701, title: "Gambar", blob_ref: ref, svg_preview: "<svg>srv</svg>", is_pinned: 0,
    created_at: U1, updated_at: U2, deleted: false, dirty: 0, base_rev: U2 }]); // tanpa rev (legacy)
  await mapPut("drawing", 701, "r1");
  const out = await repo.getDrawing("r1", { online: true, fetch: () => Promise.resolve(srvRow(701, serverNew, U2)) });
  assert.deepEqual(shapesX(out.data_json), { a: 100 });
  const tr = transport(() => ({ status: 200, data: { id: 701, updated_at: U3 } }));
  await pushOutbox(tr);
  const put = tr.calls.find((c) => c.m === "PUT");
  assert.deepEqual(put ? shapesX(put.b.data_json) : shapesX(serverNew), { a: 100 }, "heal tidak boleh menimpa edit server yang benar");
  assert.equal((await rawRec("r1")).dirty, 0);
});

test("R1b: jejak RC1 asli (tanpa rev, updated_at lokal ≠ base_rev server, isi beda) → heal union + push", async () => {
  await record("r1b", 711, snapX({ a: 0, b: 0, c: 0 }), { rev: undefined, updated_at: "2026-10-01T01:04:59.123Z", base_rev: U2 });
  const out = await repo.getDrawing("r1b", { online: true, fetch: () => Promise.resolve(srvRow(711, snapX({ a: 0 }), U2)) });
  assert.deepEqual(shapesX(out.data_json), { a: 0, b: 0, c: 0 });
  const rec = await rawRec("r1b");
  assert.equal(rec.dirty, 1);
  assert.equal(rec.svg_stale, 1);
  const tr = transport(() => ({ status: 200, data: { id: 711, updated_at: U3 } }));
  await pushOutbox(tr);
  assert.deepEqual(shapesX(tr.calls.find((c) => c.m === "PUT").b.data_json), { a: 0, b: 0, c: 0 });
});

test("R1c: record pasca-perbaikan (punya rev) dengan base_rev sama tapi isi beda → adopsi server (bersih)", async () => {
  await record("r1c", 712, snapX({ a: 0, b: 0 }), { rev: 5, updated_at: "2026-10-01T01:04:59.123Z", base_rev: U2 });
  const out = await repo.getDrawing("r1c", { online: true, fetch: () => Promise.resolve(srvRow(712, snapX({ a: 7 }), U2)) });
  assert.deepEqual(shapesX(out.data_json), { a: 7 });
  const rec = await rawRec("r1c");
  assert.equal(rec.dirty, 0);
  assert.equal((await outboxAll()).length, 0);
});

// ── R2: pull saat PUT push in-flight tidak menghidupkan coretan yang dihapus ─────
test("R2: pull saat PUT in-flight + user hapus coretan → coretan terhapus TIDAK hidup lagi", async () => {
  await record("r2", 702, snapX({ a: 0, b: 0 }));
  await repo.updateDrawing("r2", { data_json: snapX({ a: 0, b: 0, c: 0 }), svg_preview: "<svg>3</svg>" }); // D5
  let serverData = null, release;
  const gate = new Promise((r) => { release = r; });
  let putSeen;
  const putSeenP = new Promise((r) => { putSeen = r; });
  const tr = { request: (m, p, b) => {
    if (m === "PUT") { serverData = b.data_json; putSeen(); return gate.then(() => ({ status: 200, data: { id: 702, updated_at: U2 } })); }
    return Promise.resolve({ status: 200, data: { id: 702, updated_at: U2 } });
  } };
  const pushP = pushOutbox(tr);
  await putSeenP;                                         // PUT D5 sudah diproses server (U2)
  await repo.updateDrawing("r2", { data_json: snapX({ a: 0, c: 0 }), svg_preview: "<svg>2</svg>" }); // D6: hapus b
  await pullDrawings([srvRow(702, undefined, U2)], (sid) => Promise.resolve(srvRow(sid, serverData, U2)));
  release();
  await pushP;
  const rec = await rawRec("r2");
  assert.deepEqual(shapesX(await blobStore.getBytes(rec.blob_ref)), { a: 0, c: 0 }, "gema push sendiri tidak boleh dianggap perubahan remote");
  assert.equal(rec.dirty, 1, "D6 belum terkirim");
  const tr2 = transport(() => ({ status: 200, data: { id: 702, updated_at: U3 } }));
  await pushOutbox(tr2);
  assert.deepEqual(shapesX(tr2.calls.find((c) => c.m === "PUT").b.data_json), { a: 0, c: 0 });
});

test("R2b: push selesai di tengah pull (setelah pull membaca record dirty) → merge dibatalkan (CAS base_rev)", async () => {
  await record("r2b", 722, snapX({ a: 0, b: 0 }));
  await repo.updateDrawing("r2b", { data_json: snapX({ a: 0, b: 0, c: 0 }) }); // D5
  let serverData = null, release;
  const gate = new Promise((r) => { release = r; });
  let putSeen;
  const putSeenP = new Promise((r) => { putSeen = r; });
  const tr = { request: (m, p, b) => {
    if (m === "PUT") { serverData = b.data_json; putSeen(); return gate.then(() => ({ status: 200, data: { id: 722, updated_at: U2 } })); }
    return Promise.resolve({ status: 200, data: { id: 722, updated_at: U2 } });
  } };
  const pushP = pushOutbox(tr);
  await putSeenP;
  await repo.updateDrawing("r2b", { data_json: snapX({ a: 0, c: 0 }) }); // D6: hapus b (sebelum pull membaca)
  // pull membaca record (D6, base_rev U1); selama fetch detail, push D5 selesai (base_rev → U2, gema tak lagi in-flight)
  const fetchOne = async (sid) => { release(); await pushP; return srvRow(sid, serverData, U2); };
  await pullDrawings([srvRow(722, undefined, U2)], fetchOne);
  const rec = await rawRec("r2b");
  assert.deepEqual(shapesX(await blobStore.getBytes(rec.blob_ref)), { a: 0, c: 0 }, "merge berbasis base_rev basi tidak boleh ditulis");
  assert.equal(rec.dirty, 1);
});

test("R2c: markDrawingPushed — base_rev hanya boleh MAJU (respons push lebih lama tidak memundurkan)", async () => {
  await record("r2c", 723, snapX({ a: 0 }));
  await repo.updateDrawing("r2c", { data_json: snapX({ a: 0, b: 0 }) });
  // pull menggabung perubahan remote U3 selama PUT in-flight → base_rev U3; respons PUT membawa U2 (lebih lama)
  const tr = { request: (m) => repo.mutateDrawing("r2c", (cur) => Object.assign({}, cur, { base_rev: U3 }))
    .then(() => ({ status: 200, data: { id: 723, updated_at: U2 } })) };
  await pushOutbox(tr);
  assert.equal((await rawRec("r2c")).base_rev, U3);
});

// ── R3: getDrawing membaca byte dari record terkini ─────────────────────────────
test("R3: getDrawing (dirty) saat updateDrawing selesai selama fetch → tidak pernah '{}'", async () => {
  await record("r3", 703, snapX({ a: 0 }), { dirty: 1, rev: 3 });
  let fetched = 0;
  const out = await repo.getDrawing("r3", { online: true, fetch: () => {
    fetched++;
    return repo.updateDrawing("r3", { data_json: snapX({ a: 0, b: 0 }), svg_preview: "<svg/>" }).then(() => srvRow(703, snapX({ a: 0 }), U1));
  } });
  assert.notEqual(out.data_json, "{}", "getDrawing tidak boleh mengembalikan '{}' padahal lokal punya data");
  assert.equal(fetched, 0, "record dirty: data lokal selalu menang → tidak menunggu jaringan");
  assert.deepEqual(shapesX(out.data_json), { a: 0 });
});

test("R3b: getDrawing (bersih) — edit selesai selama fetch → hasil memakai record & blob TERKINI", async () => {
  await record("r3b", 713, snapX({ a: 0 }), { rev: 3 });
  const out = await repo.getDrawing("r3b", { online: true, fetch: () =>
    repo.updateDrawing("r3b", { data_json: snapX({ a: 0, b: 0 }), svg_preview: "<svg/>" }).then(() => srvRow(713, snapX({ a: 0 }), U1)) });
  assert.deepEqual(shapesX(out.data_json), { a: 0, b: 0 });
  assert.equal((await rawRec("r3b")).dirty, 1);
});

test("R3c: readDrawingState — blob hilang karena edit bersamaan → record dibaca ulang, bytes dari blob baru", async () => {
  await record("r3c", 723, snapX({ a: 0 }), { rev: 3 });
  const bs = repo._BlobStore;
  const orig = bs.getBytes;
  let first = true;
  bs.getBytes = function (ref) {
    if (first) { // tepat sebelum blob lama dibaca, edit lain mengganti & menghapusnya
      first = false;
      return repo.updateDrawing("r3c", { data_json: snapX({ a: 0, b: 0 }) }).then(() => orig.call(bs, ref));
    }
    return orig.call(bs, ref);
  };
  try {
    const { rec, bytes } = await repo.readDrawingState("r3c");
    assert.ok(bytes, "harus membaca blob terbaru setelah baca ulang record");
    assert.deepEqual(shapesX(bytes), { a: 0, b: 0 });
    assert.equal(rec.rev, 4);
  } finally { bs.getBytes = orig; }
});

// ── R4: push create tidak pernah mengirim '{}' untuk record yang punya data ──────
test("R4: push create — edit bersamaan menghapus blob lama → POST tetap membawa data (bukan '{}'), edit menyusul", async () => {
  const d = await repo.createDrawing({ title: "x", data_json: snapX({ a: 0 }) });
  const orig = tagrepo.getEntityTags;
  let fired = false;
  tagrepo.getEntityTags = function (t, cid) {
    if (!fired && t === "drawing") { fired = true; return repo.updateDrawing(d.cid, { data_json: snapX({ a: 0, b: 0 }) }).then(() => orig.call(this, t, cid)); }
    return orig.call(this, t, cid);
  };
  const tr = transport(() => ({ status: 200, data: { id: 704, updated_at: U2 } }));
  try { await pushOutbox(tr); } finally { tagrepo.getEntityTags = orig; }
  const post = tr.calls.find((c) => c.m === "POST");
  assert.ok(post, "POST create harus terkirim");
  assert.notEqual(post.b.data_json, "{}", "POST tidak boleh '{}' padahal record punya data");
  const sent = shapesX(post.b.data_json);
  const rec = await rawRec(d.cid);
  if (JSON.stringify(sent) === JSON.stringify({ a: 0, b: 0 })) {
    assert.equal(rec.dirty, 0);
  } else {
    assert.deepEqual(sent, { a: 0 });
    assert.equal(rec.dirty, 1);
    const tr2 = transport(() => ({ status: 200, data: { id: 704, updated_at: U3 } }));
    await pushOutbox(tr2);
    assert.deepEqual(shapesX(tr2.calls.find((c) => c.m === "PUT").b.data_json), { a: 0, b: 0 });
  }
});

// ── R5/R6: respons server LEBIH LAMA dari base_rev (cache SW) diabaikan ─────────
test("R5: getDrawing dengan baris server lebih LAMA dari base_rev → lokal bersih dipertahankan", async () => {
  await record("r5", 705, snapX({ a: 0, b: 0, c: 0 }), { updated_at: U2, base_rev: U2, rev: 4 });
  const out = await repo.getDrawing("r5", { online: true, fetch: () => Promise.resolve(srvRow(705, snapX({ a: 0 }), U1)) });
  const rec = await rawRec("r5");
  assert.deepEqual(shapesX(out.data_json), { a: 0, b: 0, c: 0 });
  assert.equal(rec.base_rev, U2);
});

test("R6: pull dengan baris server LEBIH LAMA → record bersih tidak dibalik", async () => {
  await record("r6", 706, snapX({ a: 0, b: 0, c: 0 }), { updated_at: U2, base_rev: U2, rev: 4 });
  await pullDrawings([srvRow(706, undefined, U1)], (sid) => Promise.resolve(srvRow(sid, snapX({ a: 0 }), U1)));
  const rec = await rawRec("r6");
  assert.deepEqual(shapesX(await blobStore.getBytes(rec.blob_ref)), { a: 0, b: 0, c: 0 });
  assert.equal(rec.base_rev, U2);
});

test("R6b: pull — detail lebih lama dari base_rev walau daftar tampak baru → tidak menimpa", async () => {
  await record("r6b", 716, snapX({ a: 0, b: 0 }), { updated_at: U2, base_rev: U2, rev: 4 });
  await pullDrawings([srvRow(716, undefined, U3)], (sid) => Promise.resolve(srvRow(sid, snapX({ a: 0 }), U1)));
  const rec = await rawRec("r6b");
  assert.deepEqual(shapesX(await blobStore.getBytes(rec.blob_ref)), { a: 0, b: 0 });
});

test("R6c: getDrawing — record bersih dengan base_rev null mengadopsi data server", async () => {
  await record("r6c", 726, "{}", { base_rev: null, rev: 1 });
  const out = await repo.getDrawing("r6c", { online: true, fetch: () => Promise.resolve(srvRow(726, snapX({ a: 1 }), U1)) });
  assert.deepEqual(shapesX(out.data_json), { a: 1 });
  assert.equal((await rawRec("r6c")).base_rev, U1);
});

test("R6d: dirty + baris server lebih LAMA → tidak di-merge (tidak menghidupkan data lama)", async () => {
  await record("r6d", 736, snapX({ a: 0 }), { updated_at: U2, base_rev: U2, rev: 4, dirty: 1 });
  await outboxAdd({ op: "update", entity_type: "drawing", cid: "r6d", payload: { title: "Gambar" } });
  const res = await pullDrawings([srvRow(736, undefined, U1)], (sid) => Promise.resolve(srvRow(sid, snapX({ a: 0, old: 0 }), U1)));
  const rec = await rawRec("r6d");
  assert.deepEqual(shapesX(await blobStore.getBytes(rec.blob_ref)), { a: 0 });
  assert.equal(res.merged, 0);
});

// ── R7: hapus remote hanya bila server menjawab 404 secara eksplisit ────────────
test("R7: konfirmasi GET gagal (null / {detail:'OFFLINE'} / 5xx) → record lokal TIDAK dihapus", async () => {
  await record("r7", 707, snapX({ a: 0 }), { updated_at: U2, base_rev: U2 });
  for (const answer of [null, { detail: "OFFLINE" }, { status: 503 }, { status: 401 }]) {
    const res = await pullDrawings([], () => Promise.resolve(answer));
    assert.equal(res.deleted, 0, "jawaban " + JSON.stringify(answer) + " bukan 404");
    assert.ok(await rawRec("r7"));
  }
  const res404 = await pullDrawings([], () => Promise.resolve({ status: 404 }));
  assert.equal(res404.deleted, 1);
  assert.equal(await rawRec("r7"), null);
});

test("R7b: pullDrawingsAndReconcile — fetchOne mengembalikan {status:404} hanya untuk respons 404; 503 → null", async () => {
  await record("r7b", 717, snapX({ a: 0 }));
  await record("r7c", 718, snapX({ b: 0 }));
  const raw = (url) => {
    if (url === "/api/drawings") return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) });
    if (url === "/api/drawings/717") return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ detail: "Drawing tidak ditemukan" }) });
    return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({ detail: "OFFLINE" }) });
  };
  const res = await pullDrawingsAndReconcile(raw);
  assert.equal(res.deleted, 1);
  assert.equal(await rawRec("r7b"), null);
  assert.ok(await rawRec("r7c"), "503 bukan bukti terhapus");
});

// ── Mindmap: detail gagal (503 network-only) tidak boleh menimpa dengan mindmap kosong ──
test("Mindmap pull: detail non-2xx (503 OFFLINE) tidak menimpa mindmap lokal dengan data default", async () => {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("mindmaps", "readwrite");
    tx.objectStore("mindmaps").put({ cid: "mm1", server_id: 91, title: "Peta", data_json: '{"nodeData":{"id":"root","topic":"Isi","root":true,"children":[{"id":"x","topic":"anak"}]}}', updated_at: U1, base_rev: U1, deleted: false, dirty: 0 });
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
  await mapPut("mindmap", 91, "mm1");
  const raw = (url) => {
    if (url === "/api/mindmaps") return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([{ id: 91, title: "Peta", updated_at: U2 }]) });
    return Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({ detail: "OFFLINE" }) });
  };
  await pullMindmapsAndReconcile(raw);
  const rec = await new Promise((res, rej) => {
    const r = db.transaction("mindmaps", "readonly").objectStore("mindmaps").get("mm1");
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  assert.match(rec.data_json, /anak/, "data mindmap lokal tidak boleh diganti default");
  assert.equal(rec.server_id, 91);
});

// ── Pin drawing tersinkron ke server (sebelumnya op 'pin' dibuang push) ──────────
test("Pin: op pin drawing → GET status server lalu PATCH /pin hanya bila berbeda", async () => {
  const d = await repo.createDrawing({ title: "P", data_json: snapX({ a: 0 }) });
  await pushOutbox(transport(() => ({ status: 200, data: { id: 741, updated_at: U1 } })));
  await repo.togglePin(d.cid);
  const tr = transport((m) => (m === "GET" ? { status: 200, data: { id: 741, is_pinned: 0 } } : { status: 200, data: { id: 741, is_pinned: 1 } }));
  await pushOutbox(tr);
  assert.deepEqual(tr.calls.map((c) => c.m + " " + c.p), ["GET /api/drawings/741", "PATCH /api/drawings/741/pin"]);
  assert.equal((await outboxAll()).length, 0);
  // status server sudah sama → tidak PATCH lagi
  await repo.togglePin(d.cid); await repo.togglePin(d.cid); // net: tetap pinned, dua op
  const tr2 = transport(() => ({ status: 200, data: { id: 741, is_pinned: 1 } }));
  await pushOutbox(tr2);
  assert.ok(tr2.calls.every((c) => c.m === "GET"), "status sama → tanpa PATCH");
  assert.equal((await outboxAll()).length, 0);
});

test("Pin: drawing dipin sebelum create terkirim → op pin ditahan lalu terkirim setelah create", async () => {
  const d = await repo.createDrawing({ title: "P2", data_json: snapX({ a: 0 }) });
  await repo.togglePin(d.cid);
  const tr = transport((m) => {
    if (m === "POST") return { status: 200, data: { id: 742, updated_at: U1 } };
    if (m === "GET") return { status: 200, data: { id: 742, is_pinned: 0 } };
    return { status: 200, data: { id: 742, is_pinned: 1 } };
  });
  await pushOutbox(tr);
  assert.deepEqual(tr.calls.map((c) => c.m), ["POST", "GET", "PATCH"]);
  assert.equal((await outboxAll()).length, 0);
});

// ── Pull memakai client_id dari daftar sebagai cid record baru (lookup langsung) ─
test("Pull: client_id pada daftar server dipakai sebagai cid record baru", async () => {
  await pullDrawings([srvRow(751, undefined, U1, { client_id: "cid-dari-mesin-a" })], (sid) => Promise.resolve(srvRow(sid, snapX({ a: 0 }), U1, { client_id: "cid-dari-mesin-a" })));
  const all = await allRecs();
  assert.equal(all.length, 1);
  assert.equal(all[0].cid, "cid-dari-mesin-a");
  const viaKey = await repo.getRaw("cid-dari-mesin-a");
  assert.equal(viaKey.server_id, 751);
});
