"use strict";
// Petakan C6: MindmapTabInstance (index.html) — sesi peta tertaut: muat dari catatan, tulis lewat
// noterepo.applyMapEdit, undo/redo, remapSids, openNoteAt, placeholder, header tertaut.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const indexHtml = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");

function extractTab() {
  const start = indexHtml.indexOf("function MindmapTabInstance(");
  assert.ok(start !== -1, "MindmapTabInstance harus ada");
  const end = indexHtml.indexOf("\nconst MINDMAP_DIRECTIONS", start);
  assert.ok(end !== -1);
  return indexHtml.slice(start, end);
}

test("MindmapTabInstance wires the linked session module and note write path", () => {
  const src = extractTab();
  assert.match(src, /TF\.notemapsession/);
  assert.match(src, /TF\.noterepo\.applyMapEdit|noterepo\.applyMapEdit/);
  assert.match(src, /isLinked\s*=\s*tab\?*\.source_note_cid != null \|\| tab\?*\.source_note_id != null/);
  assert.match(src, /api\.get\(['"`]\/api\/scratchpad\/['"`] \+ \(tab\.source_note_cid \|\| tab\.source_note_id\)\)/);
  assert.match(src, /\/api\/scratchpad\/trash/);
  assert.match(src, /linked: true/);
  assert.match(src, /showSummary/);
});

test("MindmapTabInstance handles linked iframe messages", () => {
  const src = extractTab();
  for (const t of ["openNoteAt", "undoRequest", "redoRequest", "remapSids", "setSummary"]) {
    assert.ok(src.includes(t), "pesan " + t);
  }
  assert.match(src, /tf:open-note-at/);
  assert.match(src, /locateHeading/);
  assert.match(src, /initialBlockTarget: modalBlockTarget/);
});

test("MindmapTabInstance uses the exact linked UI strings", () => {
  const src = extractTab();
  for (const s of [
    "Catatan baru saja berubah — peta dimuat ulang, ulangi perubahanmu",
    "Tidak bisa diurungkan: catatan sudah berubah",
    "Maksimal 6 tingkat heading",
    "Hapus bagian «",
    "» beserta isinya dari catatan?",
    "📄 Tertaut ke: ",
    "Tersimpan ke catatan",
    "Catatan sumber ada di Sampah",
    "Catatan sumber tidak tersedia untukmu",
    "Catatan belum tersedia di perangkat ini — sambungkan internet",
    "Tambah node di sini atau heading di catatan",
    "Perubahan ini akan merusak struktur catatan (ada blok kode/toggle yang tidak ditutup) — ubah lewat catatan",
    "Urutan ini tidak bisa ditulis ke catatan karena tingkat heading-nya tidak seragam — ubah lewat catatan",
    "Ringkasan",
    "Hapus peta",
  ]) assert.ok(src.includes(s), "teks: " + s);
});

test("linked view-state PUT carries no if_updated_at and no node tree", () => {
  const src = extractTab();
  const m = src.match(/const saveViewState = [\s\S]*?\n  \};/);
  assert.ok(m, "saveViewState ada");
  assert.match(m[0], /data_json: JSON\.stringify\(/);
  assert.doesNotMatch(m[0], /if_updated_at/);
  assert.doesNotMatch(m[0], /nodeData/);
});

test("linked maps never send addLink and guard against a missing module", () => {
  const src = extractTab();
  assert.match(src, /window\.TF && window\.TF\.notemapsession/);
  assert.match(src, /onSelect: link => \{\n\s*if \(isLinked\) \{[^}]*return; \}[\s\S]{0,400}addLink/);
  assert.match(src, /type === "requestLinkPicker" && !isLinked/);
});

// ── Harness perilaku: jalankan MindmapTabInstance asli dengan hook palsu (tanpa DOM/React). ──
const NM = require("../../static/offline/notemap.js");
const NS = require("../../static/offline/notemapsession.js");

function mountTab({ note, tabExtra = {}, trash = [], online = true, confirm = () => true, tfExtra = {}, getImpl = null, putImpl = null }) {
  const slots = [];
  let slot = 0;
  let effects = [];
  const prevDeps = [];
  const cleanups = [];
  const timers = [];
  const posted = [];
  const toasts = [];
  const puts = [];
  const events = {};
  const titles = [];
  let tree = null;
  const store = { note: note ? Object.assign({ cid: "nc1", id: 7, title: "Judul" }, note) : null };
  const win = {
    location: { origin: "o" },
    TF: {
      notemap: NM,
      notemapsession: NS,
      ...tfExtra,
      noterepo: {
        applyMapEdit: (cid, base, next) => {
          if (!store.note || store.note.cid !== cid) return Promise.resolve({ missing: true });
          if (store.note.content !== base) return Promise.resolve({ stale: true });
          store.note = Object.assign({}, store.note, { content: next.markdown, title: next.title });
          win.dispatchEvent({ type: "noteSaved", detail: { source: "notemap", cids: [cid] } });
          return Promise.resolve({ ok: true });
        },
      },
    },
    addEventListener: (t, h) => { (events[t] = events[t] || []).push(h); },
    removeEventListener: (t, h) => { events[t] = (events[t] || []).filter((x) => x !== h); },
    dispatchEvent: (ev) => { (events[ev.type] || []).slice().forEach((h) => h(ev)); },
    confirm,
  };
  const iframeWin = { postMessage: (m) => posted.push(m) };
  const api = {
    get: (url) => {
      if (getImpl) { const r = getImpl(url); if (r) return r; }
      if (store.failGet) return Promise.reject(new Error("offline"));
      if (url === "/api/scratchpad/trash") return Promise.resolve(trash);
      const m = url.match(/^\/api\/scratchpad\/(.+)$/);
      if (m && store.note && (m[1] === store.note.cid || m[1] === String(store.note.id))) return Promise.resolve(Object.assign({}, store.note));
      return Promise.reject(new Error("Note not found"));
    },
    put: (url, body) => { puts.push({ url, body }); return Promise.resolve(putImpl ? putImpl(url, body) : {}); },
    patch: () => Promise.resolve({}),
    del: () => Promise.resolve({}),
  };
  const React = {
    createElement(type, props, ...children) {
      if (props && props.ref && type === "iframe") props.ref.current = { contentWindow: iframeWin };
      if (type === "MindmapOutline" && props) tree = props.tree;
      return { type, props: props || {}, children };
    },
    Fragment: "Fragment",
  };
  const useState = (init) => {
    const i = slot++;
    if (!(i in slots)) slots[i] = typeof init === "function" ? init() : init;
    return [slots[i], (v) => { slots[i] = typeof v === "function" ? v(slots[i]) : v; dirty = true; }];
  };
  const useRef = (init) => { const i = slot++; if (!(i in slots)) slots[i] = { current: init }; return slots[i]; };
  let effIdx = 0;
  const useEffect = (fn, deps) => { const i = effIdx++; effects.push({ i, fn, deps }); };
  const src = extractTab();
  const Comp = new Function("React", "useState", "useRef", "useEffect", "api", "window", "document", "MutationObserver",
    "navigator", "CustomEvent", "MindmapOutline", "LinkPickerModal", "NoteModal", "NoteTrashModal", "MINDMAP_DIRECTIONS",
    "renderConflicts", "isOfflineErr", "setTimeout", "clearTimeout",
    src + "\nreturn MindmapTabInstance;")(React, useState, useRef, useEffect, api, win,
    { documentElement: { getAttribute: () => "light" }, addEventListener() {}, removeEventListener() {} },
    function () { this.observe = () => {}; this.disconnect = () => {}; },
    { onLine: online }, function (type, init) { this.type = type; this.detail = init && init.detail; },
    "MindmapOutline", "LinkPickerModal", "NoteModal", "NoteTrashModal", [], () => {}, () => false,
    (fn, ms) => { timers.push(fn); return timers.length; }, () => {});
  const tab = Object.assign({ id: 3, title: "Judul", user_id: 1, source_note_cid: "nc1", source_note_id: 7,
    data_json: JSON.stringify(NM.LINKED_VIEW_STATE_DEFAULT) }, tabExtra);
  const props = { tab, isActive: true, showToast: (m, k) => toasts.push(m), currentUserId: 1, onUpdateTitle: (id, t) => titles.push(t) };
  let dirty = false;
  let out = null;
  const render = () => {
    slot = 0; effIdx = 0; effects = [];
    out = Comp(props);
    for (const e of effects) {
      const prev = prevDeps[e.i];
      const changed = !e.deps || !prev || e.deps.some((d, k) => d !== prev[k]);
      if (!changed) continue;
      prevDeps[e.i] = e.deps;
      if (cleanups[e.i]) cleanups[e.i]();
      cleanups[e.i] = e.fn() || null;
    }
  };
  const settle = async () => {
    for (let n = 0; n < 20; n++) {
      await new Promise((r) => setImmediate(r));
      if (dirty) { dirty = false; render(); }
    }
  };
  const flushTimers = async () => { while (timers.length) { timers.shift()(); await settle(); } };
  const post = (data) => { (events.message || []).forEach((h) => h({ origin: "o", source: iframeWin, data })); };
  const message = async (data) => { post(data); await settle(); };
  render();
  return { store, posted, toasts, puts, titles, settle, flushTimers, message, post, get tree() { return tree; }, get out() { return out; }, win, slots };
}

// gen sesi yang terakhir dikirim ke iframe (load / remapSids) — iframe menyertakannya di tiap change.
const curGen = (h) => { const m = h.posted.filter((x) => x.type === "load" || x.type === "remapSids").pop(); return m && m.gen; };

const findText = (node, s) => {
  if (node == null || node === false) return false;
  if (typeof node === "string") return node.includes(s);
  if (Array.isArray(node)) return node.some((c) => findText(c, s));
  return findText(node.children, s);
};

test("behavior: loads the linked map from the note and writes a rename back with remapSids", async () => {
  const h = mountTab({ note: { content: "# A\nisi\n# B\n" } });
  await h.settle();
  const load = h.posted.find((m) => m.type === "load");
  assert.ok(load && load.linked === true && load.showSummary === true);
  assert.deepEqual(load.data.nodeData.children.map((c) => c.topic), ["A", "B"]);
  assert.ok(findText(h.out, "📄 Tertaut ke: "));
  const data = JSON.parse(JSON.stringify(load.data));
  data.nodeData.children.reverse(); // B, A
  await h.message({ type: "change", data, gen: curGen(h) });
  await h.flushTimers();
  assert.equal(h.store.note.content, "# B\n# A\nisi\n");
  const remap = h.posted.find((m) => m.type === "remapSids");
  assert.deepEqual(remap.pairs, [["s1", "s0"], ["s0", "s1"]]);
  assert.ok(findText(h.out, "Tersimpan ke catatan"));
  assert.equal(h.puts.length, 0, "tanpa perubahan view-state tidak ada PUT mindmap");
  // undo menulis isi sebelumnya
  await h.message({ type: "undoRequest" });
  assert.equal(h.store.note.content, "# A\nisi\n# B\n");
  await h.message({ type: "redoRequest" });
  assert.equal(h.store.note.content, "# B\n# A\nisi\n");
});

test("behavior: stale note → toast + reload; blocked undo after external edit", async () => {
  const h = mountTab({ note: { content: "# A\n" } });
  await h.settle();
  const load = h.posted.filter((m) => m.type === "load").pop();
  const data = JSON.parse(JSON.stringify(load.data));
  data.nodeData.children[0].topic = "A2";
  await h.message({ type: "change", data, gen: curGen(h) });
  h.store.note = Object.assign({}, h.store.note, { content: "# diketik\n" }); // diubah editor sebelum tulis
  await h.flushTimers();
  assert.ok(h.toasts.includes("Catatan baru saja berubah — peta dimuat ulang, ulangi perubahanmu"));
  assert.equal(h.store.note.content, "# diketik\n");
  const reloaded = h.posted.filter((m) => m.type === "load").pop();
  assert.equal(reloaded.data.nodeData.children[0].topic, "diketik");

  const h2 = mountTab({ note: { content: "# A\n" } });
  await h2.settle();
  const d2 = JSON.parse(JSON.stringify(h2.posted.find((m) => m.type === "load").data));
  d2.nodeData.children[0].topic = "A2";
  await h2.message({ type: "change", data: d2, gen: curGen(h2) });
  await h2.flushTimers();
  assert.equal(h2.store.note.content, "# A2\n");
  h2.store.note = Object.assign({}, h2.store.note, { content: "# luar\n" });
  h2.win.dispatchEvent({ type: "noteSaved", detail: { source: "editor", cids: ["nc1"] } });
  await h2.settle();
  await h2.message({ type: "undoRequest" });
  assert.ok(h2.toasts.includes("Tidak bisa diurungkan: catatan sudah berubah"));
  assert.equal(h2.store.note.content, "# luar\n");
});

test("behavior: collapse saves only view-state; overflow and unsafe reload", async () => {
  const h = mountTab({ note: { content: "# A\n## B\n" } });
  await h.settle();
  const data = JSON.parse(JSON.stringify(h.posted.find((m) => m.type === "load").data));
  data.nodeData.children[0].expanded = false;
  await h.message({ type: "change", data, gen: curGen(h) });
  await h.flushTimers();
  assert.equal(h.store.note.content, "# A\n## B\n");
  assert.equal(h.puts.length, 1);
  assert.equal(h.puts[0].url, "/api/mindmaps/3");
  assert.deepEqual(JSON.parse(h.puts[0].body.data_json), { linked: 1, direction: 2, justify: false, collapsed: ["A"], summary: true, touched: 1 });

  const u = mountTab({ note: { content: "# A\nisi\n# B\n```\nbuka\n" } });
  await u.settle();
  const ud = JSON.parse(JSON.stringify(u.posted.find((m) => m.type === "load").data));
  ud.nodeData.children.reverse();
  await u.message({ type: "change", data: ud, gen: curGen(u) });
  await u.flushTimers();
  assert.ok(u.toasts.includes("Perubahan ini akan merusak struktur catatan (ada blok kode/toggle yang tidak ditutup) — ubah lewat catatan"));
  assert.equal(u.store.note.content, "# A\nisi\n# B\n```\nbuka\n");
});

test("behavior: deleting a section with content asks first; cancel reloads", async () => {
  let asked = null;
  const h = mountTab({ note: { content: "# A\nisi\n# B\n" }, confirm: (q) => { asked = q; return false; } });
  await h.settle();
  const data = JSON.parse(JSON.stringify(h.posted.find((m) => m.type === "load").data));
  data.nodeData.children.shift();
  await h.message({ type: "change", data, gen: curGen(h) });
  await h.flushTimers();
  assert.equal(asked, "Hapus bagian «A» beserta isinya dari catatan?");
  assert.equal(h.store.note.content, "# A\nisi\n# B\n");
});

test("behavior: placeholders for missing note (trash / unavailable / offline)", async () => {
  const t = mountTab({ note: null, trash: [{ id: 7 }] });
  await t.settle();
  assert.ok(findText(t.out, "Catatan sumber ada di Sampah"));
  const u = mountTab({ note: null, trash: [] });
  await u.settle();
  assert.ok(findText(u.out, "Catatan sumber tidak tersedia untukmu"));
  assert.ok(findText(u.out, "Hapus peta"));
  const o = mountTab({ note: null, online: false });
  await o.settle();
  assert.ok(findText(o.out, "Catatan belum tersedia di perangkat ini — sambungkan internet"));
  const e = mountTab({ note: { content: "intro saja\n" } });
  await e.settle();
  assert.ok(findText(e.out, "Tambah node di sini atau heading di catatan"));
});

test("behavior: openNoteAt page dispatches tf:open-note-at with the heading", async () => {
  const h = mountTab({ note: { content: "# A\n# B\n" } });
  await h.settle();
  const got = [];
  h.win.addEventListener("tf:open-note-at", (ev) => got.push(ev.detail));
  await h.message({ type: "openNoteAt", sid: "s1", target: "page" });
  assert.deepEqual(got, [{ noteId: 7, heading: { index: 1, text: "B", occurrence: 0 } }]);
});

test("behavior: non-linked map keeps the old data_json autosave path", async () => {
  const data = { nodeData: { id: "root", topic: "M", root: true, children: [] }, direction: 2 };
  const h = mountTab({ note: null, tabExtra: { source_note_cid: null, source_note_id: null, data_json: JSON.stringify(data), updated_at: "t0" } });
  await h.settle();
  const ready = h.posted.length;
  await h.message({ type: "ready" });
  const load = h.posted.slice(ready).find((m) => m.type === "load");
  assert.ok(load && !load.linked && load.data.nodeData.topic === "M");
  const edited = JSON.parse(JSON.stringify(data));
  edited.nodeData.children.push({ id: "x", topic: "Anak", children: [] });
  await h.message({ type: "change", data: edited });
  await h.flushTimers();
  assert.equal(h.puts.length, 1);
  assert.equal(h.puts[0].body.if_updated_at, "t0");
  assert.equal(JSON.parse(h.puts[0].body.data_json).nodeData.children[0].topic, "Anak");
  assert.ok(findText(h.out, "Tersimpan") && !findText(h.out, "Tersimpan ke catatan"));
});

// #4 (B5): pembaruan jarak jauh lewat remoteUpdate; basis + if_updated_at maju hanya setelah remoteApplied.
test("behavior B5: remote update skipped while typing → save sends the old base; merged result applied via remoteUpdate", async () => {
  const live = require("../../static/offline/mindmaplive.js");
  const doc = (topics) => JSON.stringify({ nodeData: { id: "root", topic: "M", root: true, children: topics.map((t, i) => ({ id: "n" + i, topic: t, children: [] })) }, direction: 2 });
  const B = doc(["A", "B"]), S = doc(["A", "B server"]), Ltab = doc(["A lokal", "B"]), M = doc(["A lokal", "B server"]);
  const rec = { id: 3, title: "Judul", data_json: S, updated_at: "t1", last_editor_display_name: "Bob", last_edited_by: 2 };
  const h = mountTab({
    note: null, tfExtra: { mindmaplive: live },
    tabExtra: { source_note_cid: null, source_note_id: null, data_json: B, updated_at: "t0" },
    getImpl: (url) => (url === "/api/mindmaps/3" ? Promise.resolve(Object.assign({}, rec)) : null),
    putImpl: (url, body) => {
      Object.assign(rec, { data_json: M, updated_at: "t2", last_editor_display_name: null, last_edited_by: 1 });
      return Object.assign({}, rec, { merged: true, merge_conflicts: 0 });
    },
  });
  await h.settle();
  await h.message({ type: "ready" });
  // pull (__mindmapLive) mengganti record → mindmapSynced → tab menawarkan isi jarak jauh ke iframe
  h.win.dispatchEvent({ type: "mindmapSynced", detail: { source: "live", ids: [3] } });
  await h.settle();
  const up = h.posted.filter((m) => m.type === "remoteUpdate");
  assert.equal(up.length, 1);
  assert.equal(h.posted.filter((m) => m.type === "load").length, 1, "tidak ada load paksa");
  // pengguna sedang mengetik → iframe melewati
  await h.message({ type: "remoteSkipped", seq: up[0].seq });
  await h.message({ type: "change", data: JSON.parse(Ltab) });
  await h.flushTimers();
  assert.equal(h.puts.length, 1);
  const body = h.puts[0].body;
  assert.equal(body.if_updated_at, "t0");
  assert.equal(body.base_data_json, B);
  assert.equal(typeof body.session_id, "string"); assert.ok(body.session_id.length > 0);
  // hasil merge diterapkan lewat remoteUpdate; setelah remoteApplied basis + if_updated_at = hasil merge
  const up2 = h.posted.filter((m) => m.type === "remoteUpdate");
  const last = up2[up2.length - 1];
  assert.deepEqual(last.data.nodeData.children.map((c) => c.topic), ["A lokal", "B server"]);
  for (const m of up2.slice(1)) await h.message({ type: "remoteApplied", seq: m.seq });
  await h.message({ type: "change", data: JSON.parse(doc(["A lokal", "B server", "C"])) });
  await h.flushTimers();
  assert.equal(h.puts.length, 2);
  assert.equal(h.puts[1].body.if_updated_at, "t2");
  assert.equal(h.puts[1].body.base_data_json, M);
  assert.equal(h.puts[1].body.session_id, body.session_id, "session_id tetap per instans tab");
});

// R18: 3 bagian tingkat atas × 10 anak = 33 node.
const BIG = [0, 1, 2].map((i) => "# H" + i + "\n" + Array.from({ length: 10 }, (_, k) => "## c" + i + "-" + k + "\n").join("")).join("");
const findEl = (node, pred) => {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) { for (const c of node) { const f = findEl(c, pred); if (f) return f; } return null; }
  if (pred(node)) return node;
  return findEl(node.children, pred);
};
const lastLoad = (h) => h.posted.filter((m) => m.type === "load").pop();

test("behavior R18: fresh big linked map collapses depth>=2; a fold change saves touched and is honored", async () => {
  const h = mountTab({ note: { content: BIG } });
  await h.settle();
  const load = lastLoad(h);
  assert.equal(load.data.nodeData.children[0].expanded, true);
  assert.ok(load.data.nodeData.children.every((c) => c.children.every((g) => g.expanded === false)), "kedalaman ≥ 2 terlipat");

  const data = JSON.parse(JSON.stringify(load.data));
  data.nodeData.children[1].expanded = false;
  data.nodeData.children[0].children[0].expanded = true;
  await h.message({ type: "change", data, gen: curGen(h) });
  await h.flushTimers();
  assert.equal(h.store.note.content, BIG);
  const saved = JSON.parse(h.puts[h.puts.length - 1].body.data_json);
  assert.equal(saved.touched, 1);
  assert.ok(saved.collapsed.includes("H1"));
  assert.ok(!saved.collapsed.includes("H0\u001fc0-0"));

  const again = mountTab({ note: { content: BIG }, tabExtra: { data_json: JSON.stringify(saved) } });
  await again.settle();
  const l2 = lastLoad(again);
  assert.equal(l2.data.nodeData.children[1].expanded, false);
  assert.equal(l2.data.nodeData.children[0].expanded, true);
  assert.equal(l2.data.nodeData.children[0].children[0].expanded, true, "lipatan tersimpan dipakai");
  assert.equal(l2.data.nodeData.children[0].children[1].expanded, false);
});

test("behavior R18: toggling summary on an untouched big map keeps the initial collapse", async () => {
  const h = mountTab({ note: { content: BIG } });
  await h.settle();
  const btn = findEl(h.out, (n) => n.type === "button" && n.children.includes("Ringkasan"));
  assert.ok(btn, "tombol Ringkasan");
  btn.props.onClick();
  await h.settle();
  assert.ok(h.posted.some((m) => m.type === "setSummary" && m.show === false));
  await h.flushTimers();
  const saved = JSON.parse(h.puts[h.puts.length - 1].body.data_json);
  assert.equal(saved.summary, false);
  assert.equal("touched" in saved, false);
  const again = mountTab({ note: { content: BIG }, tabExtra: { data_json: JSON.stringify(saved) } });
  await again.settle();
  const l2 = lastLoad(again);
  assert.equal(l2.showSummary, false);
  assert.ok(l2.data.nodeData.children.every((c) => c.children.every((g) => g.expanded === false)), "tetap terlipat, bukan terbuka semua");
});

// Petakan C7: MindmapOutline mode tertaut.
function extractOutline() {
  const start = indexHtml.indexOf("function MindmapOutline(");
  assert.ok(start !== -1, "MindmapOutline harus ada");
  const end = indexHtml.indexOf("\nfunction MindmapTabInstance(", start);
  assert.ok(end !== -1);
  return indexHtml.slice(start, end);
}

test("C7 MindmapOutline declares the linked props with defaults", () => {
  const src = extractOutline();
  assert.match(src, /function MindmapOutline\(\{[^}]*\blinked = false\b[^}]*\}\)/);
  assert.match(src, /function MindmapOutline\(\{[^}]*\bshowSummary = true\b[^}]*\}\)/);
  assert.match(src, /function MindmapOutline\(\{[^}]*\bonOpenNoteAt = null\b[^}]*\}\)/);
  assert.match(src, /function MindmapOutline\(\{[^}]*\bonUndo = null\b[^}]*\bonRedo = null\b[^}]*\}\)/);
});

test("C7 MindmapOutline renders linked topics and summaries via notemap, normal maps keep renderTopicMd", () => {
  const src = extractOutline();
  assert.match(src, /linked[^\n]*renderTopicNoteInline|renderTopicNoteInline[\s\S]{0,200}renderTopicMd/);
  assert.match(src, /renderSummaryHtml\(n\.nm && n\.nm\.summary\)/);
  assert.match(src, /linked && showSummary/);
  assert.match(src, /window\.TF && window\.TF\.notemap/);
  assert.match(src, /MO\.renderTopicMd\(n\.topic\)/);
});

test("C7 MindmapOutline linked menu items, open handlers and hidden link features", () => {
  const src = extractOutline();
  assert.ok(src.includes('"📄 Buka di catatan"'));
  assert.ok(src.includes('"↗ Buka di halaman Notes"'));
  assert.match(src, /onOpenNoteAt\([^)]*"modal"\)/);
  assert.match(src, /onOpenNoteAt\([^)]*"page"\)/);
  assert.match(src, /e\.ctrlKey \|\| e\.metaKey/);
  assert.match(src, /!linked && menuItem\("🔗 Tambah link"/);
  assert.match(src, /linkCount > 0 && !linked/);
  assert.match(src, /linksPopId != null && !linked/);
});

test("C7 MindmapOutline routes undo/redo to onUndo/onRedo when linked", () => {
  const src = extractOutline();
  assert.match(src, /linked \? onUndo : undo/);
  assert.match(src, /linked \? onRedo : redo/);
});

test("C7 MindmapTabInstance wires the new MindmapOutline props", () => {
  const src = extractTab();
  assert.match(src, /linked: isLinked/);
  assert.match(src, /showSummary: showSummary/);
  assert.match(src, /onOpenNoteAt: isLinked \? openLinkedNoteAt : null/);
  assert.match(src, /onUndo: isLinked \? \(\) => linkedUndoRedo\("undo"\) : null/);
  assert.match(src, /onRedo: isLinked \? \(\) => linkedUndoRedo\("redo"\) : null/);
});

// Petakan C8: buka catatan tepat di heading (NoteModal, NotePanel/NotesPage, App).
test("C8: NoteModal, NotePanel and App open a note at a heading", () => {
  assert.match(indexHtml, /initialBlockTarget\.kind === ["']heading["']/);
  assert.match(indexHtml, /matchHeading\(/);
  assert.match(indexHtml, /nm-heading-flash/);
  assert.match(indexHtml, /addEventListener\("tf:open-note-at"/);
  assert.match(indexHtml, /initialHeading: pendingNoteHeading/);
  assert.match(indexHtml, /window\.TF && window\.TF\.notemap/);
  assert.doesNotMatch(indexHtml.match(/\.nm-heading-flash \{[^}]*\}/)[0], /border[-]?left/i);
});

test("C8: NotePanel applies the heading only to the target note id", () => {
  assert.match(indexHtml, /String\(note\.id\) !== String\(initialHeadingNoteId\)/);
  assert.match(indexHtml, /initialHeadingNoteId: panelHeading \? panelHeading\.noteId : null/);
  assert.match(indexHtml, /setPanelHeading\(prev => prev && String\(prev\.noteId\) === String\(id\) \? null : prev\)/);
});

// Petakan C9: titik masuk (tombol Petakan, + Dari Catatan, badge tertaut).
test("C9 entry points: Petakan buttons, + Dari Catatan, linked badge, tf:petakan event", () => {
  assert.match(indexHtml, /🧠 Petakan/);
  assert.match(indexHtml, /🧠 Buka peta/);
  assert.match(indexHtml, /\+ Dari Catatan/);
  assert.match(indexHtml, /new CustomEvent\("tf:petakan"/);
  assert.match(indexHtml, /addEventListener\("tf:petakan"/);
  assert.match(indexHtml, /title: "Tertaut ke catatan"/);
  assert.match(indexHtml, /source_note_ref/);
  assert.match(indexHtml, /Gagal membuat peta/);
  assert.match(indexHtml, /function useLinkedMapId\(/);
});

test("C9 tf:petakan handler posts source_note_ref and opens the map", () => {
  const i = indexHtml.indexOf('addEventListener("tf:petakan"');
  assert.ok(i !== -1);
  const src = indexHtml.slice(Math.max(0, i - 900), i + 200);
  assert.match(src, /api\.post\("\/api\/mindmaps", \{\s*title: "",\s*source_note_ref: /);
  assert.match(src, /setPendingMindmapId\(created\.id\)/);
  assert.match(src, /setPage\("mindmap"\)/);
});

// ── Final review C (item 2): generasi sesi — sid dari versi catatan lain tidak pernah ditulis. ──
const STALE = "Catatan baru saja berubah — peta dimuat ulang, ulangi perubahanmu";
const loads = (h) => h.posted.filter((m) => m.type === "load");

test("gen: load and remapSids carry the session gen; the tree is stamped with it", async () => {
  const h = mountTab({ note: { content: "# A\nisi\n# B\n" } });
  await h.settle();
  const load = lastLoad(h);
  assert.equal(typeof load.gen, "string");
  assert.ok(load.data.nodeData.children.every((c) => c.nm.ns === load.gen));
  assert.equal(load.data.gen, load.gen, "outlineTree / data membawa gen yang sama");
  const data = JSON.parse(JSON.stringify(load.data));
  data.nodeData.children.reverse();
  await h.message({ type: "change", data, gen: load.gen });
  await h.flushTimers();
  const remap = h.posted.find((m) => m.type === "remapSids");
  assert.ok(remap.gen && remap.gen !== load.gen, "tulisan menghasilkan gen baru");
  assert.ok(h.tree.children.every((c) => c.nm.ns === remap.gen), "outline ikut diremap (sid + ns)");
  // change berikutnya dengan gen baru tetap ditulis
  const d2 = JSON.parse(JSON.stringify(data));
  d2.nodeData.children[0].topic = "B2";
  for (const c of d2.nodeData.children) c.nm = Object.assign({}, c.nm, { ns: remap.gen });
  d2.nodeData.children[0].nm.sid = "s0"; d2.nodeData.children[1].nm.sid = "s1";
  await h.message({ type: "change", data: d2, gen: remap.gen });
  await h.flushTimers();
  assert.equal(h.store.note.content, "# B2\n# A\nisi\n");
});

test("gen: a change from an older gen is dropped and the map reloads (no write)", async () => {
  const h = mountTab({ note: { content: "# A\nisi\n# B\nb\n# C\n" } });
  await h.settle();
  const n0 = loads(h).length;
  const old = lastLoad(h);
  const data = JSON.parse(JSON.stringify(old.data));
  data.nodeData.children[2].children.push({ id: "x", topic: "Anak", children: [] });
  await h.message({ type: "change", data, gen: "gen-lama" });
  await h.flushTimers();
  assert.equal(h.store.note.content, "# A\nisi\n# B\nb\n# C\n");
  assert.equal(loads(h).length, n0 + 1, "peta dimuat ulang");
  assert.notEqual(lastLoad(h).gen, old.gen);
  assert.ok(h.toasts.includes(STALE));
  // change tanpa gen sama sekali juga dibuang
  await h.message({ type: "change", data });
  await h.flushTimers();
  assert.equal(h.store.note.content, "# A\nisi\n# B\nb\n# C\n");
});

test("gen: Focus-Mode-style stale tree after a reload never scrambles the note", async () => {
  // Repro final review: muat [A,B,C], catatan berubah jadi [X,A,B,C], iframe mengirim pohon lama.
  const h = mountTab({ note: { content: "# A\na\n# B\nb\n# C\nc\n" } });
  await h.settle();
  const old = lastLoad(h);
  h.store.note = Object.assign({}, h.store.note, { content: "# X\nx\n# A\na\n# B\nb\n# C\nc\n" });
  h.win.dispatchEvent({ type: "noteSaved", detail: { source: "editor", cids: ["nc1"] } });
  await h.settle();
  assert.notEqual(lastLoad(h).gen, old.gen);
  const stale = JSON.parse(JSON.stringify(old.data));
  stale.nodeData.children[1].children.push({ id: "n", topic: "Node baru", children: [] });
  await h.message({ type: "change", data: stale, gen: old.gen });
  await h.flushTimers();
  assert.equal(h.store.note.content, "# X\nx\n# A\na\n# B\nb\n# C\nc\n");
});

test("gen: an edit pending from an older gen is discarded when loadLinked completes (toast once)", async () => {
  const h = mountTab({ note: { content: "# A\nisi\n# B\n" } });
  await h.settle();
  const g1 = lastLoad(h).gen;
  const data = JSON.parse(JSON.stringify(lastLoad(h).data));
  data.nodeData.children.reverse();
  h.post({ type: "change", data: {}, gen: "lain" }); // memicu loadLinked (belum selesai)
  h.post({ type: "change", data, gen: g1 }); // masih gen sesi saat ini → tertunda
  await h.settle();
  await h.flushTimers();
  assert.equal(h.store.note.content, "# A\nisi\n# B\n");
  assert.equal(h.toasts.filter((t) => t === STALE).length >= 1, true);
});

test("gen: outline edits carry the outline tree gen; a stale one is dropped", async () => {
  const h = mountTab({ note: { content: "# A\nisi\n# B\n" } });
  await h.settle();
  const outline = findEl(h.out, (n) => n.type === "MindmapOutline");
  const staleOnChange = outline.props.onChange;
  const staleTree = JSON.parse(JSON.stringify(outline.props.tree));
  // catatan berubah dari luar → muat ulang, gen baru
  h.store.note = Object.assign({}, h.store.note, { content: "# Z\n# A\nisi\n# B\n" });
  h.win.dispatchEvent({ type: "noteSaved", detail: { source: "editor", cids: ["nc1"] } });
  await h.settle();
  const n0 = loads(h).length;
  staleTree.children.reverse();
  staleOnChange(staleTree);
  await h.settle();
  await h.flushTimers();
  assert.equal(h.store.note.content, "# Z\n# A\nisi\n# B\n");
  assert.equal(loads(h).length, n0 + 1);
  assert.ok(!h.posted.some((m) => m.type === "refresh" && m.data && m.data.nodeData === staleTree), "pohon basi tidak dikirim ke kanvas");
  // outline segar tetap menulis
  const fresh = findEl(h.out, (n) => n.type === "MindmapOutline");
  const t = JSON.parse(JSON.stringify(fresh.props.tree));
  t.children[0].topic = "Z2";
  fresh.props.onChange(t);
  await h.settle();
  await h.flushTimers();
  assert.equal(h.store.note.content, "# Z2\n# A\nisi\n# B\n");
});

test("checkNoteChanged: a failed note fetch does not reload over a pending edit", async () => {
  const h = mountTab({ note: { content: "# A\nisi\n# B\n" } });
  await h.settle();
  await h.message({ type: "openNoteAt", sid: "s0", target: "modal" });
  const modal = findEl(h.out, (n) => n.type === "NoteModal");
  assert.ok(modal, "NoteModal terbuka");
  const load = lastLoad(h);
  const data = JSON.parse(JSON.stringify(load.data));
  data.nodeData.children[0].topic = "A2";
  h.post({ type: "change", data, gen: load.gen });
  h.store.failGet = true;
  const n0 = loads(h).length;
  modal.props.onClose();
  await h.settle();
  assert.equal(loads(h).length, n0, "tidak memuat ulang di atas edit tertunda");
  h.store.failGet = false;
  await h.flushTimers();
  assert.equal(h.store.note.content, "# A2\nisi\n# B\n");
});

// Final review C (item 4, R19): modul Ops iframe ikut precache SW.
test("R19: sw.js precaches mindmapops.js next to the mindmap modules", () => {
  const sw = fs.readFileSync(path.join(__dirname, "../../static/sw.js"), "utf8");
  const list = sw.slice(sw.indexOf("const STATIC = ["), sw.indexOf("];", sw.indexOf("const STATIC = [")));
  for (const f of ["mindmapops.js", "mindmapoutline.js", "notemap.js", "notemapsession.js"]) {
    assert.ok(list.includes('"/static/offline/' + f + '"'), f);
  }
});
