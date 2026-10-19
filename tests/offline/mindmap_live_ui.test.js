"use strict";
// PR B #4 (Task B5): UI langsung — EventSource per tab, remoteUpdate iframe, penanda "🟢 Langsung", aturan SW stream.
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { buildTaskRouter } = require("../../static/offline/taskroutes.js");
const { mapPut } = require("../../static/offline/idmap.js");
const mm = require("../../static/offline/mindmaprepo.js");
const live = require("../../static/offline/mindmaplive.js");

const iframe = fs.readFileSync(path.join(__dirname, "../../static/vendor/mind-elixir/index.html"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");
const sw = fs.readFileSync(path.join(__dirname, "../../static/sw.js"), "utf8");
function slice(src, a, b) {
  const s = src.indexOf(a); assert.ok(s !== -1, a + " harus ada");
  const e = src.indexOf(b, s + a.length); assert.ok(e !== -1, b + " harus ada setelah " + a);
  return src.slice(s, e);
}

// ── Sumber (brief B5) ──────────────────────────────────────────────

test("__mindmapLive pulls one map exclusively, notifies tabs and pushes when dirty", () => {
  const f = slice(html, "window.__mindmapLive = ", "\n};");
  assert.match(f, /runSyncExclusive\(/);
  assert.match(f, /pullMindmapOne\(__syncRawFetch, /);
  assert.match(f, /"mindmapSynced"/);
  assert.match(f, /source: "live"/);
  assert.match(f, /__pushNow\(\)/);
});

test("MindmapTabInstance subscribes to the stream only for shared, non-linked, synced maps", () => {
  const t = slice(html, "function MindmapTabInstance(", "\nconst MINDMAP_DIRECTIONS");
  assert.match(t, /new EventSource\(/);
  assert.match(t, /\/stream`\)/);
  assert.match(t, /isLinked \|\| tab\.list_id == null/);
  assert.match(t, /mindmap_access_lost/);
  assert.match(t, /"Akses ke peta ini dicabut"/);
  assert.match(t, /"Peta ini dihapus oleh pemiliknya"/);
  assert.match(t, /"🟢 Langsung"/);
  assert.match(t, /base_data_json: baseDocRef\.current/);
  assert.match(t, /type: "remoteUpdate"/);
  assert.match(t, /remoteSkipped/);
});

test("iframe skips remote updates while a node is being edited", () => {
  const h = slice(iframe, "e.data.type === 'remoteUpdate'", "\n      }\n");
  assert.match(h, /input-box/);
  assert.match(h, /remoteSkipped/);
  assert.match(h, /remoteApplied/);
  assert.match(h, /exitFocusMode/);
  assert.doesNotMatch(h, /postChange\(\)/); // pembaruan jarak jauh bukan edit pengguna
});

test("noticeText renders merge_conflict; SW never caches mindmap streams", () => {
  const nt = slice(html, "function noticeText(", "\nfunction renderConflicts");
  assert.match(nt, /merge_conflict/);
  assert.match(nt, /node diubah bersamaan oleh/);
  assert.match(sw, /\\\/api\\\/mindmaps\\\/\[\^\/\]\+\\\/stream\$/);
});

// ── Sumber (aturan yang mengikat) ─────────────────────────────────

test("tab: session_id per instance, stream closed on unmount/offline, reconnect with backoff", () => {
  const t = slice(html, "function MindmapTabInstance(", "\nconst MINDMAP_DIRECTIONS");
  assert.match(t, /session_id: sessionIdRef\.current/);
  assert.match(t, /mindmaplive\.newSessionId\(\)/);
  assert.match(t, /addEventListener\("offline", /);
  assert.match(t, /removeEventListener\("offline", /);
  assert.match(t, /addEventListener\("online", /);
  assert.match(t, /mindmaplive\.backoffMs\(/);
  assert.match(t, /es\.close\(\)/);
  assert.match(t, /title: "Perubahan anggota lain tampil otomatis"/);
  // __mindmapLive hanya lewat helper window (yang memakai runSyncExclusive), tidak pernah pullMindmapOne langsung
  assert.doesNotMatch(t, /pullMindmapOne\(/);
  // tab tidak lagi memuat ulang kanvas dengan "load" dari record jarak jauh
  const apply = slice(t, "const applyRecordToTab = ", "\n  };");
  assert.doesNotMatch(apply, /type: "load"/);
  assert.doesNotMatch(apply, /lastKnownAtRef\.current = /); // if_updated_at maju hanya setelah remoteApplied
});

test("sw: stream rule comes before the X-TF-Sync rule and never touches the cache", () => {
  const i = sw.indexOf("\\/stream$/.test(url.pathname)");
  assert.ok(i !== -1);
  assert.ok(i < sw.indexOf('request.headers.get("X-TF-Sync") === "1"'));
  const rule = sw.slice(i, sw.indexOf("return;", i));
  assert.doesNotMatch(rule, /caches\.|cache\.put/);
});

test("index.html loads mindmaplive.js and the SW precaches it", () => {
  assert.match(html, /<script src="\/static\/offline\/mindmaplive\.js"><\/script>/);
  assert.match(sw, /"\/static\/offline\/mindmaplive\.js"/);
});

test("index.html loads mindmapmerge.js before mindmaprepo.js and the SW precaches it", () => {
  const tag = '<script src="/static/offline/mindmapmerge.js"></script>';
  const repoTag = '<script src="/static/offline/mindmaprepo.js"></script>';
  const i = html.indexOf(tag);
  assert.ok(i !== -1, "tag script mindmapmerge.js harus ada");
  assert.ok(html.indexOf(repoTag) !== -1, "tag script mindmaprepo.js harus ada");
  assert.ok(i < html.indexOf(repoTag), "mindmapmerge.js harus dimuat sebelum mindmaprepo.js");
  assert.match(sw, /"\/static\/offline\/mindmapmerge\.js"/);
  assert.ok(sw.indexOf('"/static/offline/mindmapmerge.js"') < sw.indexOf('"/static/offline/mindmaprepo.js"'));
});

// ── Helper TF.mindmaplive ──────────────────────────────────────────

const ref = (v) => ({ current: v });
function makeRefs() {
  return { baseDocRef: ref(null), lastKnownAtRef: ref(null), remoteStaleRef: ref(false), remoteSeqRef: ref(0), pendingRemoteRef: ref(new Map()) };
}
const D = (topics) => JSON.stringify({ nodeData: { id: "root", topic: "Akar", root: true,
  children: topics.map((t, i) => ({ id: "n" + i, topic: t, children: [] })) } });

test("backoffMs grows exponentially and is capped (never a hot loop)", () => {
  assert.equal(live.backoffMs(0), live.RECONNECT_MIN_MS);
  assert.equal(live.backoffMs(1), live.RECONNECT_MIN_MS * 2);
  assert.equal(live.backoffMs(50), live.RECONNECT_MAX_MS);
  assert.ok(live.RECONNECT_MIN_MS >= 1000);
  for (let a = 0; a < 20; a++) assert.ok(live.backoffMs(a + 1) >= live.backoffMs(a));
});

test("newSessionId is random per call", () => {
  const a = live.newSessionId(), b = live.newSessionId();
  assert.equal(typeof a, "string"); assert.ok(a.length >= 8); assert.notEqual(a, b);
});

test("load sets base and if_updated_at from the same snapshot and clears pending/stale", () => {
  const r = makeRefs(); const L = live.createTabLive(r);
  r.remoteStaleRef.current = true; r.pendingRemoteRef.current.set(3, {});
  L.load({ data_json: "X", updated_at: "t1" });
  assert.deepEqual([r.baseDocRef.current, r.lastKnownAtRef.current, r.remoteStaleRef.current, r.pendingRemoteRef.current.size], ["X", "t1", false, 0]);
});

test("offerRemote → applied advances base and if_updated_at together; skipped advances nothing", () => {
  const r = makeRefs(); const L = live.createTabLive(r);
  L.load({ data_json: D(["A"]), updated_at: "t1" });
  const msg = L.offerRemote({ data_json: D(["A2"]), updated_at: "t2", title: "M" });
  assert.equal(msg.type, "remoteUpdate"); assert.equal(msg.seq, 1); assert.equal(msg.title, "M");
  assert.equal(msg.data.nodeData.root, true);
  assert.deepEqual([r.baseDocRef.current, r.lastKnownAtRef.current], [D(["A"]), "t1"]); // belum diterapkan
  const e = L.applied(1);
  assert.equal(e.dataStr, D(["A2"]));
  assert.deepEqual([r.baseDocRef.current, r.lastKnownAtRef.current], [D(["A2"]), "t2"]);
  assert.equal(L.applied(1), null); // seq tak dikenal → tidak ada efek

  const m2 = L.offerRemote({ data_json: D(["A3"]), updated_at: "t3" });
  L.skipped(m2.seq);
  assert.deepEqual([r.baseDocRef.current, r.lastKnownAtRef.current, r.remoteStaleRef.current], [D(["A2"]), "t2", true]);
  assert.equal(r.pendingRemoteRef.current.size, 0);
});

test("offerRemote with content equal to the base (e.g. echo of own save) → null, no canvas reload; if_updated_at advances", () => {
  const r = makeRefs(); const L = live.createTabLive(r);
  L.load({ data_json: D(["A"]), updated_at: "t1" });
  assert.equal(L.offerRemote({ data_json: D(["A"]), updated_at: "t2", title: "M" }, { title: "M" }), null);
  assert.deepEqual([r.baseDocRef.current, r.lastKnownAtRef.current, r.pendingRemoteRef.current.size, r.remoteSeqRef.current], [D(["A"]), "t2", 0, 0]);
  // judul berubah → tetap ditawarkan (iframe memakai judul untuk nama ekspor)
  const m = L.offerRemote({ data_json: D(["A"]), updated_at: "t3", title: "M2" }, { title: "M" });
  assert.equal(m && m.type, "remoteUpdate");
  // ada tawaran lain di jalan → tidak dipotong (urutan seq tetap berlaku)
  const r2 = makeRefs(); const L2 = live.createTabLive(r2);
  L2.load({ data_json: D(["A"]), updated_at: "t1" });
  L2.offerRemote({ data_json: D(["B"]), updated_at: "t2" });
  assert.equal(L2.offerRemote({ data_json: D(["A"]), updated_at: "t3" }).type, "remoteUpdate");
});

test("offerRemote with unparseable data → null, nothing pending", () => {
  const r = makeRefs(); const L = live.createTabLive(r);
  assert.equal(L.offerRemote({ data_json: "{oops", updated_at: "t2" }), null);
  assert.equal(L.offerRemote(null), null);
  assert.equal(r.pendingRemoteRef.current.size, 0);
});

test("local edit racing an in-flight remoteUpdate → applied does not advance base (pending save merges)", () => {
  const r = makeRefs(); const L = live.createTabLive(r);
  L.load({ data_json: D(["A"]), updated_at: "t1" });
  const msg = L.offerRemote({ data_json: D(["A", "remote"]), updated_at: "t2" });
  L.noteLocalEdit(); // iframe mengirim change sebelum memproses remoteUpdate
  const e = L.applied(msg.seq);
  assert.equal(e.revert, true); // kanvas dikembalikan ke versi lokal
  assert.deepEqual([r.baseDocRef.current, r.lastKnownAtRef.current, r.remoteStaleRef.current], [D(["A"]), "t1", true]);
});

test("raced remoteUpdate superseded by a newer one (e.g. merged save result) → no revert, newer applies normally", () => {
  const r = makeRefs(); const L = live.createTabLive(r);
  L.load({ data_json: D(["A"]), updated_at: "t1" });
  const m1 = L.offerRemote({ data_json: D(["A", "remote"]), updated_at: "t2" });
  L.noteLocalEdit();
  const m2 = L.offerRemote({ data_json: D(["A lokal", "remote"]), updated_at: "t3" }); // hasil merge autosave
  const e1 = L.applied(m1.seq);
  assert.equal(e1.revert, false);
  L.applied(m2.seq);
  assert.deepEqual([r.baseDocRef.current, r.lastKnownAtRef.current], [D(["A lokal", "remote"]), "t3"]);
});

test("saved: base = saved data_json; if_updated_at advances only for a plain save", () => {
  const r = makeRefs(); const L = live.createTabLive(r);
  L.load({ data_json: "B", updated_at: "t1" });
  assert.deepEqual(L.saved("L1", { data_json: "L1", updated_at: "t2" }), { applyResult: false });
  assert.deepEqual([r.baseDocRef.current, r.lastKnownAtRef.current], ["L1", "t2"]);
  assert.deepEqual(L.saved("L2", { data_json: "M", updated_at: "t3", merged: true, merge_conflicts: 0 }), { applyResult: true });
  assert.deepEqual([r.baseDocRef.current, r.lastKnownAtRef.current], ["L2", "t2"]);
  assert.deepEqual(L.saved("L3", { data_json: "S", updated_at: "t4", conflict_copy: { title: "(konflik) M" } }), { applyResult: true });
  assert.equal(r.lastKnownAtRef.current, "t2");
});

test("wholeMapCopyToast matches the whole-map conflict_copy notice wording", () => {
  assert.equal(live.wholeMapCopyToast("M", "(konflik) M", "Bob"), "✂ Edit offline-mu pada 'M' disimpan sebagai '(konflik) M' karena peta diubah di perangkat lain (Bob).");
  assert.equal(live.wholeMapCopyToast("M", "(konflik) M", null), "✂ Edit offline-mu pada 'M' disimpan sebagai '(konflik) M' karena peta diubah di perangkat lain.");
  const nt = slice(html, "function noticeText(", "\nfunction renderConflicts");
  assert.match(nt, /"✂ Edit offline-mu pada '" \+ title \+ "' disimpan sebagai '"/);
  assert.match(nt, /karena " \+ __entityNoun\(n\.entity\) \+ " diubah di perangkat lain"/);
});

test("conflictToast uses the spec text", () => {
  assert.equal(live.conflictToast("Bob", "(konflik) M"), "✂ Sebagian perubahanmu bentrok dengan Bob — versimu disimpan sebagai '(konflik) M'");
  assert.equal(live.conflictToast(null, "(konflik) M"), "✂ Sebagian perubahanmu bentrok dengan anggota lain — versimu disimpan sebagai '(konflik) M'");
});

// ── Perilaku dengan router lokal + IndexedDB ───────────────────────

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); mm.setCurrentUser(null); });
async function put(store, recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    for (const x of recs) tx.objectStore(store).put(x);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function all(store) {
  const db = await openDB();
  return new Promise((res) => { const q = db.transaction(store).objectStore(store).getAll(); q.onsuccess = () => res(q.result || []); });
}
function rec(over) {
  return Object.assign({
    cid: "m", server_id: 10, title: "M", pinned: false, list_id: 7, user_id: 1,
    last_edited_by: 2, last_editor_username: "bob", last_editor_display_name: "Bob",
    created_at: "2026-10-15T00:00:00", deleted: false, dirty: 0, rev: 1,
  }, over);
}
const topics = (s) => JSON.parse(s).nodeData.children.map((c) => c.topic);
const bodyOf = (r, sessionId, dataStr) => ({
  data_json: dataStr, if_updated_at: r.lastKnownAtRef.current, base_data_json: r.baseDocRef.current, session_id: sessionId,
});

test("REQUIRED: remote update skipped while typing, then the user saves → remote change survives through the merge", async () => {
  const B = D(["A", "B"]), S = D(["A", "B server"]), Ltab = D(["A lokal", "B"]);
  // Tab dimuat pada t1.
  await put("mindmaps", [rec({ data_json: B, updated_at: "t1", base_rev: "t1", base_data_json: B, base_title: "M", base_data_rev: "t1" })]);
  await mapPut("mindmap", 10, "m");
  const r = makeRefs(); const L = live.createTabLive(r); const sid = live.newSessionId();
  L.load({ data_json: B, updated_at: "t1" });
  // Anggota lain menyimpan → pull (__mindmapLive) mengganti record bersih dengan versi server t2.
  await put("mindmaps", [rec({ data_json: S, updated_at: "t2", base_rev: "t2", base_data_json: S, base_title: "M", base_data_rev: "t2", rev: 2 })]);
  const R = buildTaskRouter();
  const fresh = await R.dispatch("GET", "/api/mindmaps/10");
  const msg = L.offerRemote(fresh);
  // Pengguna sedang mengetik di #input-box → iframe membalas remoteSkipped.
  L.skipped(msg.seq);
  assert.equal(r.remoteStaleRef.current, true);
  assert.deepEqual([r.baseDocRef.current, r.lastKnownAtRef.current], [B, "t1"]);
  // Pengguna selesai mengetik → change → autosave.
  L.noteLocalEdit();
  const res = await R.dispatch("PUT", "/api/mindmaps/10", bodyOf(r, sid, Ltab));
  assert.equal(res.merged, true); assert.equal(res.merge_conflicts, 0); assert.equal(res.conflict_copy, undefined);
  assert.deepEqual(topics(res.data_json), ["A lokal", "B server"]);
  const recs = await all("mindmaps");
  assert.equal(recs.length, 1, "tidak ada salinan konflik");
  assert.deepEqual(topics(recs[0].data_json), ["A lokal", "B server"]);
  // Tab menerapkan hasil merge (remoteUpdate) → basis = hasil merge, if_updated_at = record.
  const out = L.saved(Ltab, res);
  assert.equal(out.applyResult, true);
  const m2 = L.offerRemote(res);
  L.applied(m2.seq);
  assert.deepEqual([r.baseDocRef.current, r.lastKnownAtRef.current], [res.data_json, res.updated_at]);
  // Simpan berikutnya dari kanvas yang sudah memuat hasil merge = tulis biasa, tidak ada yang hilang.
  const Lnext = D(["A lokal", "B server", "C"]);
  const res2 = await R.dispatch("PUT", "/api/mindmaps/10", bodyOf(r, sid, Lnext));
  assert.equal(res2.merged, undefined);
  assert.deepEqual(topics(res2.data_json), ["A lokal", "B server", "C"]);
});

test("control: advancing base/if_updated_at on a skipped update would lose the remote change", async () => {
  const S = D(["A", "B server"]), Ltab = D(["A lokal", "B"]);
  await put("mindmaps", [rec({ data_json: S, updated_at: "t2", base_rev: "t2", base_data_json: S, base_title: "M", base_data_rev: "t2", rev: 2 })]);
  await mapPut("mindmap", 10, "m");
  // Salah: basis/if_updated_at dimajukan ke t2 padahal kanvas tidak pernah menerapkannya.
  const res = await buildTaskRouter().dispatch("PUT", "/api/mindmaps/10", { data_json: Ltab, if_updated_at: "t2", base_data_json: S, session_id: "x" });
  assert.deepEqual(topics(res.data_json), ["A lokal", "B"]); // "B server" hilang
});

test("isEcho: event whose updated_at is the record's base_rev needs no pull", async () => {
  await put("mindmaps", [rec({ data_json: D(["A"]), updated_at: "local-ts", base_rev: "t5" })]);
  await mapPut("mindmap", 10, "m");
  assert.equal(await live.isEcho(10, "t5"), true);
  assert.equal(await live.isEcho(10, "t6"), false);
  assert.equal(await live.isEcho(99, "t5"), false);
});

// ── Fix round 1 ────────────────────────────────────────────────────

const ops = require("../../static/offline/mindmapops.js");

// Salinan setia plugin undo mind-elixir (MindElixir.iife.js `kn`): snapshot `o` hanya maju pada "operation".
function fakeMindWithUndo(initial) {
  const listeners = {};
  const mind = {
    nodeData: JSON.parse(JSON.stringify(initial)),
    getData() { return { nodeData: JSON.parse(JSON.stringify(this.nodeData)) }; },
    refresh(d) { if (d) this.nodeData = JSON.parse(JSON.stringify(d.nodeData)); },
    clearSelection() {}, selectNodes() {}, findEle() { return null; },
    bus: { addListener(n, f) { (listeners[n] = listeners[n] || []).push(f); }, fire(n, a) { (listeners[n] || []).forEach((f) => f(a)); } },
  };
  let t = [], n = -1, o = mind.getData();
  mind.undo = function () { if (n > -1) { const a = t[n]; o = a.prev; mind.refresh(a.prev); n--; } };
  mind.clearHistory = function () { t = []; n = -1; o = mind.getData(); mind.clearSelection(); };
  mind.bus.addListener("operation", (a) => {
    if (a.name === "beginEdit") return;
    t = t.slice(0, n + 1); const c = mind.getData(); t.push({ prev: o, next: c }); o = c; n = t.length - 1;
  });
  return mind;
}
const tree = (topics) => ({ id: "root", topic: "Akar", root: true, children: topics.map((x, i) => ({ id: "n" + i, topic: x, children: [] })) });
const tops = (mind) => mind.nodeData.children.map((c) => c.topic);

test("undo plugin: without a reset, undo after a remote apply resurrects the pre-remote tree (control)", () => {
  const m = fakeMindWithUndo(tree(["A"]));
  m.nodeData.children[0].topic = "A1"; m.bus.fire("operation", { name: "finishEdit" }); // edit lokal
  m.refresh({ nodeData: tree(["A1", "B remote"]) }); // remoteUpdate
  m.undo();
  assert.deepEqual(tops(m), ["A"]); // "B remote" hilang
});

test("resetUndo after a remote apply: undo can no longer restore the pre-remote tree", () => {
  const m = fakeMindWithUndo(tree(["A"]));
  m.nodeData.children[0].topic = "A1"; m.bus.fire("operation", { name: "finishEdit" });
  m.refresh({ nodeData: tree(["A1", "B remote"]) });
  assert.equal(ops.resetUndo(m), true);
  m.undo();
  assert.deepEqual(tops(m), ["A1", "B remote"]);
  // edit sesudahnya tetap bisa di-undo — kembali ke pohon jarak jauh, bukan ke pohon lama
  m.nodeData.children[1].topic = "B2"; m.bus.fire("operation", { name: "finishEdit" });
  m.undo();
  assert.deepEqual(tops(m), ["A1", "B remote"]);
  assert.equal(ops.resetUndo({}), false); // mesin tanpa undo (peta tertaut allowUndo:false)
  assert.equal(ops.resetUndo(null), false);
});

test("iframe resets undo history after remote apply and after a refresh (raced revert / outline edit)", () => {
  const h = slice(iframe, "e.data.type === 'remoteUpdate'", "\n      }\n");
  assert.match(h, /mind\.refresh\(cleanMindData\(e\.data\.data\)\)[\s\S]*mindmapops\.resetUndo\(mind\)/);
  const r = slice(iframe, "e.data.type === 'refresh'", "\n      }\n");
  assert.match(r, /mind\.refresh\(cleanMindData\(e\.data\.data\)\)[\s\S]*mindmapops\.resetUndo\(mind\)/);
  assert.match(iframe, /<script src="\/static\/offline\/mindmapops\.js\?v=8"><\/script>/);
});

test("stream: only the active tab subscribes; badge only while connected on the active tab", () => {
  const t = slice(html, "function MindmapTabInstance(", "\nconst MINDMAP_DIRECTIONS");
  const eff = slice(t, "// #4 kolaborasi langsung: satu EventSource", "\n  }, [");
  assert.match(eff, /!isActive \|\| isLinked \|\| tab\.list_id == null/);
  assert.match(t, /\}, \[tab\?\.id, tab\?\.list_id, isLinked, isActive\]\);/);
  assert.match(t, /liveOn && isActive && !isLinked/);
  // callback dibaca lewat ref (closure basi)
  assert.match(eff, /const cb = liveCbRef\.current;/);
  assert.match(eff, /cb\.onDeleteMindmap && cb\.onDeleteMindmap\(tab\.id\)/);
  assert.match(eff, /cb\.showToast && cb\.showToast\(/);
  assert.doesNotMatch(eff, /[^.]showToast\(ev\.type/);
  // editor jarak jauh dari sinyal stream
  assert.match(eff, /ev\.editor_name/);
  assert.match(eff, /String\(ev\.editor_id\) !== String\(currentUserId\)/);
  // batas percobaan + cek akses
  assert.match(eff, /mindmaplive\.shouldReconnect\(/);
});

test("shouldReconnect caps consecutive failed attempts", () => {
  assert.equal(live.shouldReconnect(0), true);
  assert.equal(live.shouldReconnect(live.RECONNECT_MAX_ATTEMPTS - 1), true);
  assert.equal(live.shouldReconnect(live.RECONNECT_MAX_ATTEMPTS), false);
  assert.ok(live.RECONNECT_MAX_ATTEMPTS >= 3 && live.RECONNECT_MAX_ATTEMPTS <= 20);
});

// ── Review akhir: undo Outline tidak boleh menghapus perubahan anggota lain ─────────────────────────
function mountOutline(props) {
  const src = slice(html, "function MindmapOutline(", "\nfunction MindmapTabInstance(");
  const slots = []; let slot = 0;
  const useState = (init) => { const i = slot++; if (!(i in slots)) slots[i] = typeof init === "function" ? init() : init; return [slots[i], (v) => { slots[i] = typeof v === "function" ? v(slots[i]) : v; }]; };
  const useRef = (init) => { const i = slot++; if (!(i in slots)) slots[i] = { current: init }; return slots[i]; };
  const React = { createElement: (type, p, ...children) => ({ type, props: p || {}, children }), Fragment: "Fragment" };
  const win = { TF: { mindmapoutline: require("../../static/offline/mindmapoutline.js") } };
  const Comp = new Function("React", "useState", "useRef", "window", "document", src + "\nreturn MindmapOutline;")(
    React, useState, useRef, win, { addEventListener() {}, removeEventListener() {} });
  slots[0] = "n1"; // activeId (useState pertama)
  let cur = Object.assign({}, props);
  let out = null;
  const render = (p) => { if (p) cur = Object.assign({}, cur, p); slot = 0; out = Comp(cur); return out; };
  const key = (k, extra) => out.props.onKeyDown(Object.assign({ key: k, ctrlKey: true, target: { tagName: "DIV" }, preventDefault() {}, stopPropagation() {} }, extra || {}));
  return { render, key };
}

test("Outline undo after a remote update cannot restore the pre-remote tree (history cleared per historyEpoch)", () => {
  const T0 = { id: "root", topic: "Akar", root: true, children: [{ id: "n1", topic: "Satu", children: [] }] };
  const changes = [];
  const h = mountOutline({ tree: T0, onChange: (t) => changes.push(t), historyEpoch: 0 });
  h.render();
  h.key("d"); // duplikat n1 → satu entri undo (pohon T0)
  assert.equal(changes.length, 1);
  const remote = { id: "root", topic: "Akar", root: true, children: [{ id: "n1", topic: "Satu diubah Ana", children: [] }] };
  // kontrol: tanpa epoch baru, Ctrl+Z mengembalikan T0 → perubahan Ana hilang
  h.render({ tree: remote });
  h.key("z");
  assert.equal(changes.length, 2);
  assert.equal(changes[1], T0);
  // dengan epoch baru (remoteApplied): riwayat dikosongkan → undo/redo tidak melakukan apa pun
  const h2 = mountOutline({ tree: T0, onChange: (t) => changes.push(t), historyEpoch: 0 });
  h2.render(); h2.key("d");
  const n = changes.length;
  h2.render({ tree: remote, historyEpoch: 1 });
  h2.key("z"); h2.key("z", { shiftKey: true }); h2.key("y");
  assert.equal(changes.length, n, "undo/redo kosong setelah pembaruan jarak jauh");
});

test("tab bumps the Outline historyEpoch on remoteApplied and on the raced revert", () => {
  const t = slice(html, "function MindmapTabInstance(", "\nconst MINDMAP_DIRECTIONS");
  assert.match(t, /historyEpoch: outlineEpoch/);
  const ra = slice(t, 'e.data.type === "remoteApplied"', 'e.data.type === "remoteSkipped"');
  assert.equal((ra.match(/setOutlineEpoch\(/g) || []).length, 2);
});
