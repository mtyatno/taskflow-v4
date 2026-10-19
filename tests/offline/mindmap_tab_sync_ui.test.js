"use strict";
// Workstream D (T3): index.html — sync() mengirim mindmapSynced {cids, ids}; tab mindmap memuat ulang bila tidak
// dirty; autosave membawa if_updated_at dan menangani conflict_copy; conflict bar merender notice conflict_copy.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const indexHtml = fs.readFileSync(path.join(__dirname, "../../static/index.html"), "utf8");

function extractSync() {
  const m = indexHtml.match(/function sync\(\) \{[\s\S]*?\n\}/);
  assert.ok(m, "function sync() harus ada");
  return m[0];
}

test("sync(): mindmap pull with changed records dispatches mindmapSynced {cids, ids} + mindmapSaved; nothing when unchanged", async () => {
  const events = [];
  const mk = (mmRes) => {
    const win = {
      TF: {
        syncpull: {
          pullAndReconcile: () => Promise.resolve(),
          pullMindmapsAndReconcile: () => Promise.resolve(mmRes),
        },
        syncpush: { pushOutbox: () => Promise.resolve({ pushed: 0 }) },
      },
      dispatchEvent(ev) { events.push(ev); },
    };
    function FakeEvent(type, init) { this.type = type; this.detail = init && init.detail; }
    return new Function("window", "renderConflicts", "schedulePush", "__syncRawFetch", "__syncTransport", "runSyncExclusive", "CustomEvent",
      "let __syncPending = null;\n" + extractSync() + "\nreturn sync;")(win, () => {}, () => {}, () => {}, {}, (task) => Promise.resolve().then(task), FakeEvent);
  };
  await mk({ created: 1, updated: 1, deleted: 0, pinned: 0, conflictCopies: 1, changed: [{ cid: "a", server_id: 5 }, { cid: "copy", server_id: null }] })();
  const synced = events.find((e) => e.type === "mindmapSynced");
  assert.ok(synced, "mindmapSynced dikirim");
  assert.deepEqual(synced.detail.cids, ["a", "copy"]);
  assert.deepEqual(synced.detail.ids, [5]);
  assert.ok(events.some((e) => e.type === "mindmapSaved"), "daftar sidebar/pinned dimuat ulang");
  events.length = 0;
  await mk({ created: 0, updated: 0, deleted: 0, pinned: 0, conflictCopies: 0, changed: [] })();
  assert.equal(events.some((e) => e.type === "mindmapSynced" || e.type === "mindmapSaved"), false);
  events.length = 0;
  // hasil pull versi lama (tanpa `changed`) tidak melempar
  await mk({ created: 0, updated: 0, deleted: 0 })();
  // PR 5: pull task sukses selalu memancarkan tf:projects-changed (bukan event mindmap)
  assert.equal(events.filter((e) => e.type !== "tf:projects-changed").length, 0);
});

test("noticeText renders conflict_copy notices (✂ … disimpan sebagai '(konflik) …') and keeps the old kinds", () => {
  const m = indexHtml.match(/const __entityNoun = [\s\S]*?\nfunction noticeText\(n\) \{[\s\S]*?\n\}/);
  assert.ok(m, "noticeText harus ada");
  const noticeText = new Function(m[0] + "\nreturn noticeText;")();
  const t = noticeText({ entity: "mindmap", kind: "conflict_copy", title: "Peta", copyTitle: "(konflik) Peta", editor: "Bob" });
  assert.match(t, /^✂ Edit offline-mu pada 'Peta' disimpan sebagai '\(konflik\) Peta' karena peta diubah di perangkat lain/);
  assert.match(t, /Bob/);
  assert.match(noticeText({ entity: "note", kind: "conflict_copy", title: "N" }), /catatan diubah di perangkat lain/);
  assert.match(noticeText({ entity: "mindmap", kind: "overwritten", title: "X", editor: "Ann" }), /ditimpa oleh Ann/);
  assert.match(noticeText({ entity: "mindmap", kind: "delete_refused", title: "X" }), /tidak bisa dihapus/);
  // renderConflicts memakai helper itu di kedua tempat (bar hanya notice & bar konflik + notice)
  const rc = indexHtml.match(/function renderConflicts\(\) \{[\s\S]*?\n\}/)[0];
  assert.equal((rc.match(/label\.textContent = noticeText\(n\);/g) || []).length, 2);
  // S2: remote_deleted pada entitas non-task menawarkan "Simpan sebagai <entitas> baru"
  assert.match(rc, /__entityNoun\(c\.entity\)/);
});

test("MindmapTabInstance: autosave carries if_updated_at, handles conflict_copy, reloads on mindmapSynced only when not dirty", () => {
  const start = indexHtml.indexOf("function MindmapTabInstance(");
  const end = indexHtml.indexOf("function MindmapPage(");
  assert.ok(start > 0 && end > start);
  const code = indexHtml.slice(start, end);
  assert.match(code, /if_updated_at: lastKnownAtRef\.current/, "autosave mengirim if_updated_at");
  assert.match(code, /if \(res && res\.conflict_copy\) \{/, "respons conflict_copy ditangani (tab memuat ulang versi server)");
  assert.match(code, /window\.addEventListener\("mindmapSynced", handler\);/);
  assert.match(code, /if \(pendingEditRef\.current\) return;/, "tab dirty mempertahankan isinya");
  assert.match(code, /lastKnownAtRef\.current = tab\.updated_at != null \? tab\.updated_at : null;/, "revisi yang dimuat dicatat per tab");
  // rename tidak mengirim ulang data_json basi, dan edit tertunda dikirim dulu
  assert.match(code, /await flushSave\(\);/);
  assert.doesNotMatch(code, /title: renameVal\.trim\(\),\s*data_json: tab\.data_json/);
  // tab ditutup → edit tertunda tidak dibuang
  assert.match(code, /if \(pendingSaveRef\.current\) doSave\(\);/);
  // share mem-bump updated_at di server → diadopsi sebagai base_rev + lastKnownAt (bukan 409 / salinan konflik palsu)
  assert.match(code, /patch\.updated_at = updated\.updated_at; patch\.base_rev = updated\.updated_at;/);
  assert.match(code, /window\.TF\.db\.mutate\("mindmaps", match\.cid, cur =>/);
  assert.match(code, /if \(updated\.updated_at\) lastKnownAtRef\.current = updated\.updated_at;/);
});

test("MindmapPage reloads the sidebar list on mindmapSynced / mindmapSaved", () => {
  const start = indexHtml.indexOf("function MindmapPage(");
  const code = indexHtml.slice(start, start + 20000);
  assert.match(code, /window\.addEventListener\("mindmapSynced", handler\);\s*window\.addEventListener\("mindmapSaved", handler\);/);
});
