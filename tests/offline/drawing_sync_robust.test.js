"use strict";
// Putaran review akhir: placeholder "{}" (detail gagal diambil) tidak boleh dianggap gambar kosong,
// push tidak macet di belakang request yang timeout, adopsi pin di pull tidak membalik toggle yang tertunda.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut } = require("../../static/offline/idmap.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const { makeBlobStore } = require("../../static/offline/blobstore.js");
const repo = require("../../static/offline/drawingrepo.js");
const { pushOutbox } = require("../../static/offline/syncpush.js");
const { pullDrawings } = require("../../static/offline/syncpull.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); repo.configureFetcher(null); });
const blobStore = makeBlobStore();
const U1 = "2026-10-01T08:00:00.000001+07:00";
const U2 = "2026-10-01T08:05:00.000002+07:00";
const U3 = "2026-10-01T08:09:00.000003+07:00";
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L5 5"/></svg>';

function snapX(shapes) {
  const store = { "document:document": { id: "document:document", typeName: "document" }, "page:page": { id: "page:page", typeName: "page" } };
  for (const [id, x] of Object.entries(shapes)) store["shape:" + id] = { id: "shape:" + id, typeName: "shape", type: "draw", parentId: "page:page", x, y: 0 };
  return JSON.stringify({ store, schema: { schemaVersion: 2, sequences: {} } });
}
function shapesX(json) {
  const out = {};
  for (const r of Object.values(JSON.parse(json).store || {})) if (r && r.typeName === "shape") out[r.id.replace("shape:", "")] = r.x;
  return out;
}
async function allRecs() {
  const db = await openDB();
  return new Promise((res, rej) => { const r = db.transaction("drawings", "readonly").objectStore("drawings").getAll(); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); });
}
async function rawRec(cid) {
  const db = await openDB();
  return new Promise((res, rej) => { const r = db.transaction("drawings", "readonly").objectStore("drawings").get(cid); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); });
}
async function putRecs(recs) {
  const db = await openDB();
  await new Promise((res, rej) => { const tx = db.transaction("drawings", "readwrite"); for (const r of recs) tx.objectStore("drawings").put(r); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
}
async function record(cid, sid, data, over) {
  const ref = data == null ? null : await blobStore.put(data, { mime: "application/json" });
  await putRecs([Object.assign({ cid, server_id: sid, title: "G", blob_ref: ref, svg_preview: "", is_pinned: 0,
    created_at: U1, updated_at: U1, deleted: false, dirty: 0, base_rev: U1, rev: 2 }, over || {})]);
  if (sid != null) await mapPut("drawing", sid, cid);
}
const listRow = (over) => Object.assign({ id: 7, client_id: "cid-A", title: "G", svg_preview: SVG, is_pinned: 0, created_at: U2, updated_at: U2 }, over || {});
function transport(handler) {
  const calls = [];
  return { calls, request(m, p, b) { calls.push({ m, p, b }); return Promise.resolve().then(() => handler(m, p, b)); } };
}

// ── 1. Placeholder dari pull yang gagal mengambil detail ─────────────────────
test("Pull: detail gagal → record data_missing, base_rev null, TANPA blob placeholder '{}'", async () => {
  await pullDrawings([listRow()], () => Promise.resolve(null));
  const recs = await allRecs();
  assert.equal(recs.length, 1);
  assert.equal(recs[0].data_missing, 1);
  assert.equal(recs[0].base_rev, null, "base_rev null → pull/getDrawing berikutnya mencoba ulang");
  assert.equal(recs[0].blob_ref, null, "tidak boleh ada blob placeholder '{}'");
  assert.equal(recs[0].svg_preview, SVG, "preview server tetap dipakai untuk tampilan");
});

test("Placeholder (reviewer): pull gagal + buka saat fetch timeout → data_missing (bukan kosong) → tidak ada data yang bisa menimpa server", async () => {
  const SERVER = snapX({ a: 1, b: 2, c: 3 });
  await pullDrawings([listRow()], () => Promise.resolve(null));
  const cid = (await allRecs())[0].cid;
  repo.configureFetcher(() => Promise.reject(new Error("AbortError")));
  const doc = await repo.getDrawing(cid, { online: true });
  assert.equal(doc.data_missing, 1);
  assert.equal(doc.data_json, null, "placeholder tidak boleh dikembalikan sebagai gambar kosong");
  // pull berikutnya (jaringan pulih) memperbaiki record
  const r2 = await pullDrawings([listRow()], () => Promise.resolve(Object.assign({}, listRow(), { data_json: SERVER })));
  assert.equal(r2.updated, 1);
  const rec = await rawRec(cid);
  assert.equal(rec.data_missing, 0);
  assert.equal(rec.base_rev, U2);
  assert.deepEqual(shapesX(await blobStore.getBytes(rec.blob_ref)), { a: 1, b: 2, c: 3 });
  const doc2 = await repo.getDrawing(cid, { online: false });
  assert.equal(doc2.data_missing, 0);
  assert.deepEqual(shapesX(doc2.data_json), { a: 1, b: 2, c: 3 });
});

test("getDrawing online memperbaiki record data_missing dari server", async () => {
  await pullDrawings([listRow()], () => Promise.resolve(null));
  const cid = (await allRecs())[0].cid;
  const doc = await repo.getDrawing(cid, { online: true, fetch: () => Promise.resolve(Object.assign({}, listRow(), { data_json: snapX({ a: 1 }) })) });
  assert.equal(doc.data_missing, 0);
  assert.deepEqual(shapesX(doc.data_json), { a: 1 });
  assert.equal((await rawRec(cid)).data_missing, 0);
});

test("Push: record data_missing (mis. judul diubah) → PUT TANPA data_json (server mempertahankan gambar)", async () => {
  await pullDrawings([listRow()], () => Promise.resolve(null));
  const cid = (await allRecs())[0].cid;
  await repo.updateDrawing(cid, { title: "Judul baru" });
  const tr = transport(() => ({ status: 200, data: { id: 7, updated_at: U3 } }));
  await pushOutbox(tr);
  const put = tr.calls.find((c) => c.m === "PUT");
  assert.ok(put, "PUT judul tetap dikirim");
  assert.equal(put.b.title, "Judul baru");
  assert.equal("data_json" in put.b, false, "tidak boleh mengirim data dari record data_missing");
});

test("Placeholder LAMA di DB (server_id, data '{}', svg_preview berisi gambar): fetch gagal → data_missing + ditandai agar pull memperbaiki", async () => {
  await record("lama", 8, "{}", { svg_preview: SVG, base_rev: U2, updated_at: U2 });
  const doc = await repo.getDrawing("lama", { online: true, fetch: () => Promise.reject(new Error("timeout")) });
  assert.equal(doc.data_missing, 1);
  assert.equal(doc.data_json, null);
  const rec = await rawRec("lama");
  assert.equal(rec.data_missing, 1);
  assert.equal(rec.base_rev, null);
  // online berhasil → diperbaiki
  const doc2 = await repo.getDrawing("lama", { online: true, fetch: () => Promise.resolve({ id: 8, title: "G", data_json: snapX({ q: 1 }), svg_preview: SVG, updated_at: U2 }) });
  assert.equal(doc2.data_missing, 0);
  assert.deepEqual(shapesX(doc2.data_json), { q: 1 });
});

test("Gambar memang kosong tetap 'kosong' (bukan data_missing): lokal belum punya server_id, atau server mengirim '{}' eksplisit", async () => {
  const d = await repo.createDrawing({ title: "Baru", data_json: "{}" });
  const g1 = await repo.getDrawing(d.cid, { online: false });
  assert.equal(g1.data_missing, 0);
  assert.equal(g1.data_json, "{}");
  await record("srv-kosong", 9, snapX({ a: 1 }), { base_rev: U1 });
  const g2 = await repo.getDrawing("srv-kosong", { online: true, fetch: () => Promise.resolve({ id: 9, title: "G", data_json: "{}", svg_preview: SVG, updated_at: U2 }) });
  assert.equal(g2.data_missing, 0, "server mengirim '{}' secara eksplisit");
  assert.equal(g2.data_json, "{}");
});

// ── 2. Request yang timeout tidak menahan op lain di antrian push ─────────────
test("Push: timeout (AbortError) pada satu op tidak menahan op lain; timeout kedua menghentikan antrian", async () => {
  await record("slow", 31, snapX({ a: 0 }));
  await repo.updateDrawing("slow", { data_json: snapX({ a: 0, b: 0 }) });
  const b = await repo.createDrawing({ title: "B", data_json: snapX({ x: 0 }) });
  const abort = () => { const e = new Error("The operation was aborted."); e.name = "AbortError"; return Promise.reject(e); };
  const calls = [];
  const tr = { request(m, p) { calls.push(m + " " + p); if (m === "PUT") return abort(); return Promise.resolve({ status: 200, data: { id: 32, updated_at: U2 } }); } };
  const r = await pushOutbox(tr);
  assert.deepEqual(calls, ["PUT /api/drawings/31", "POST /api/drawings"], "op B tetap dikirim");
  assert.equal((await rawRec(b.cid)).server_id, 32);
  assert.ok((await outboxAll()).some((o) => o.cid === "slow" && o.op === "update"), "op yang timeout tetap antre untuk dicoba lagi");
  assert.equal(r.remaining, 1);
  // dua timeout berturut-turut → jaringan dianggap macet → berhenti
  await record("slow2", 33, snapX({ a: 0 }));
  await repo.updateDrawing("slow2", { data_json: snapX({ a: 1 }) });
  const c = await repo.createDrawing({ title: "C", data_json: snapX({ y: 0 }) });
  const calls2 = [];
  const tr2 = { request(m, p) { calls2.push(m + " " + p); return abort(); } };
  await pushOutbox(tr2);
  assert.equal(calls2.length, 2, "berhenti setelah timeout kedua: " + JSON.stringify(calls2));
  assert.equal((await rawRec(c.cid)).server_id, null);
});

// ── 5. Pin: adopsi pin server tidak membalik toggle lokal yang masih tertunda ─
test("Pull Pass 5: pin di-toggle SELAMA pull → toggle lokal & op pin dipertahankan", async () => {
  await record("x", 41, snapX({ a: 0 }), { base_rev: U1 });
  await record("y", 42, snapX({ b: 0 }), { base_rev: U1, is_pinned: 0 });
  const fetchOne = (sid) => (sid === 41
    ? repo.togglePin("y").then(() => ({ id: 41, title: "G", data_json: snapX({ a: 1 }), svg_preview: "", is_pinned: 0, updated_at: U2 }))
    : Promise.resolve({ id: sid, title: "G", data_json: snapX({ b: 0 }), svg_preview: "", is_pinned: 0, updated_at: U1 }));
  await pullDrawings([
    { id: 41, title: "G", is_pinned: 0, updated_at: U2 },
    { id: 42, title: "G", is_pinned: 0, updated_at: U1 },
  ], fetchOne);
  assert.equal((await rawRec("y")).is_pinned, 1, "toggle user selama pull tidak boleh dibalik");
  assert.ok((await outboxAll()).some((o) => o.cid === "y" && o.op === "pin"));
});

test("Pull Pass 2: data server lebih baru TIDAK menimpa pin lokal yang op-nya masih tertunda", async () => {
  await record("z", 43, snapX({ a: 0 }), { base_rev: U1, is_pinned: 0 });
  await repo.togglePin("z");
  await pullDrawings([{ id: 43, title: "G", is_pinned: 0, updated_at: U2 }],
    () => Promise.resolve({ id: 43, title: "G", data_json: snapX({ a: 5 }), svg_preview: "", is_pinned: 0, updated_at: U2 }));
  const rec = await rawRec("z");
  assert.deepEqual(shapesX(await blobStore.getBytes(rec.blob_ref)), { a: 5 }, "data server tetap diadopsi");
  assert.equal(rec.is_pinned, 1, "pin lokal tertunda dipertahankan");
  const tr = transport((m) => (m === "GET" ? { status: 200, data: { id: 43, is_pinned: 0 } } : { status: 200, data: { id: 43, is_pinned: 1 } }));
  await pushOutbox(tr);
  assert.ok(tr.calls.some((c) => c.m === "PATCH" && c.p === "/api/drawings/43/pin"), "pin tetap terkirim");
});

test("togglePin: record & op pin ditulis dalam SATU transaksi (pembaca tidak pernah melihat salah satunya saja)", async () => {
  await record("t", 44, snapX({ a: 0 }));
  const db = await openDB();
  let seen = null;
  // baca drawings+outbox dalam satu transaksi tepat setelah togglePin dimulai
  const p = repo.togglePin("t");
  await new Promise((res) => {
    const tx = db.transaction(["drawings", "_outbox"], "readonly");
    let rec, ops;
    tx.objectStore("drawings").get("t").onsuccess = (e) => { rec = e.target.result; };
    tx.objectStore("_outbox").getAll().onsuccess = (e) => { ops = e.target.result; };
    tx.oncomplete = () => { seen = { pinned: rec.is_pinned, ops: ops.filter((o) => o.op === "pin").length }; res(); };
  });
  await p;
  assert.ok((seen.pinned === 0 && seen.ops === 0) || (seen.pinned === 1 && seen.ops === 1), "tidak konsisten: " + JSON.stringify(seen));
});
