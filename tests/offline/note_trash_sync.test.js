"use strict";
// Trash & Restore × sync offline (temuan review): restore tidak boleh dibatalkan op delete yang masih
// tertunda (S1), dan backlink/outlink lokal harus pulih setelah note dibuat ulang oleh pull (S2).
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset } = require("../../static/offline/db.js");
const idmap = require("../../static/offline/idmap.js");
const { outboxAll } = require("../../static/offline/outbox.js");
const repo = require("../../static/offline/noterepo.js");
const query = require("../../static/offline/notequery.js");
const { pullNotes } = require("../../static/offline/syncpull.js");
const { pushOutbox } = require("../../static/offline/syncpush.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); repo.setCurrentUser({ user_id: 1 }); });

// Server mini: DELETE memindahkan note ke trash (seperti webapp), restore mengembalikan id asli.
function makeServer() {
  const notes = new Map(), trash = new Map();
  let nextId = 100;
  return {
    notes, trash,
    list: () => [...notes.values()].map((n) => ({ ...n })),
    restore(id) { notes.set(id, trash.get(id)); trash.delete(id); return { ...notes.get(id) }; },
    transport(opts = {}) {
      const calls = [];
      return {
        calls,
        request(method, path, body) {
          calls.push(method + " " + path);
          let m;
          if (method === "DELETE" && (m = path.match(/^\/api\/scratchpad\/(\d+)$/))) {
            const id = +m[1];
            if (notes.has(id)) { trash.set(id, notes.get(id)); notes.delete(id); }
            if (opts.loseDeleteResponse) return Promise.resolve({ status: 503, data: { detail: "OFFLINE" } });
            return Promise.resolve({ status: 200, data: { ok: true } });
          }
          if (method === "PUT" && (m = path.match(/^\/api\/scratchpad\/(\d+)$/))) {
            const id = +m[1];
            if (!notes.has(id)) return Promise.resolve({ status: 404, data: { detail: "nf" } });
            const n = { ...notes.get(id), ...body, updated_at: "T-put-" + id };
            notes.set(id, n); return Promise.resolve({ status: 200, data: n });
          }
          if (method === "POST" && path === "/api/scratchpad") {
            const id = nextId++;
            const n = { id, ...body, linked_to: [], updated_at: "T-post-" + id, user_id: 1 };
            notes.set(id, n); return Promise.resolve({ status: 200, data: n });
          }
          return Promise.resolve({ status: 404, data: null });
        },
      };
    },
  };
}

const N10 = { id: 10, title: "Alpha", content: "isi alpha", tags: [], linked_to: [], linked_task_ids: [], list_id: null, user_id: 1, updated_at: "T1", client_id: "orig-cid" };
const N20 = { id: 20, title: "Beta", content: "lihat [[Alpha]]", tags: [], linked_to: [10], linked_task_ids: [], list_id: null, user_id: 1, updated_at: "T2" };
function seeded() { const S = makeServer(); S.notes.set(10, { ...N10 }); S.notes.set(20, { ...N20 }); return S; }

test("S1: respons DELETE hilang → restore → sync tidak menghapus note lagi", async () => {
  const S = seeded();
  await pullNotes(S.list());
  const cid10 = await idmap.cidOf("note", 10);
  await repo.deleteNote(cid10, {});
  const r1 = await pushOutbox(S.transport({ loseDeleteResponse: true })); // server sudah trash, respons 503
  assert.equal(r1.remaining, 1);
  assert.deepEqual([...S.trash.keys()], [10]);

  const restored = S.restore(10);
  // handleTrashRestored: buang delete tertunda untuk note ini, lalu __syncNow (pull → push)
  const d = await repo.discardPendingDelete(restored.id);
  assert.equal(d.dropped, 1);
  assert.equal((await outboxAll()).length, 0);
  const pr = await pullNotes(S.list());
  assert.equal(pr.skipped, 0);
  const t2 = S.transport();
  await pushOutbox(t2);
  assert.deepEqual(t2.calls, [], "tidak boleh ada DELETE ulang");
  assert.deepEqual([...S.notes.keys()].sort(), [10, 20]);
  assert.deepEqual([...S.trash.keys()], []);

  const cidAfter = await idmap.cidOf("note", 10);
  const rec = await repo.getNoteRaw(cidAfter);
  assert.equal(rec.deleted, false);
  assert.equal(rec.dirty, 0);
  assert.equal(rec.title, "Alpha");
  assert.deepEqual((await query.getBacklinks(cidAfter)).map((n) => n.title), ["Beta"]);
});

test("discardPendingDelete: tanpa op delete tertunda → no-op; op note lain tidak tersentuh", async () => {
  const S = seeded();
  await pullNotes(S.list());
  const cid10 = await idmap.cidOf("note", 10);
  const cid20 = await idmap.cidOf("note", 20);
  await repo.updateNote(cid20, { content: "edit beta" }, {});
  assert.deepEqual(await repo.discardPendingDelete(10), { dropped: 0 });
  assert.deepEqual(await repo.discardPendingDelete(999), { dropped: 0 }); // tidak dikenal di idmap
  assert.equal((await repo.getNoteRaw(cid10)).deleted, false);

  await repo.deleteNote(cid10, {});
  assert.deepEqual(await repo.discardPendingDelete(10), { dropped: 1 });
  const ops = await outboxAll();
  assert.deepEqual(ops.map((o) => o.op + ":" + (o.cid === cid20 ? "beta" : "?")), ["update:beta"]);
});

test("S2: setelah hapus+restore bersih, pull memulihkan backlinks/outlinks lokal note yang dibuat ulang", async () => {
  const S = seeded();
  await pullNotes(S.list());
  const old10 = await idmap.cidOf("note", 10);
  const cid20 = await idmap.cidOf("note", 20);
  assert.deepEqual((await query.getBacklinks(old10)).map((n) => n.title), ["Beta"]);
  await repo.deleteNote(old10, {});
  await pushOutbox(S.transport());
  await pullNotes(S.list()); // perangkat lain / pull berikut: note 10 hilang → rekaman + idmap dibuang
  S.restore(10);
  await pullNotes(S.list());
  const new10 = await idmap.cidOf("note", 10);
  assert.notEqual(new10, old10, "pull membuat ulang note dengan cid baru");
  assert.deepEqual((await query.getBacklinks(new10)).map((n) => n.title), ["Beta"]);
  const beta = await query.getNote(cid20);
  assert.deepEqual(beta.linked_to.length, 1);
  const betaRaw = await repo.getNoteRaw(cid20);
  assert.deepEqual(JSON.parse(betaRaw.linked_to_cids), [new10]);
  assert.equal(betaRaw.dirty, 0);
  assert.equal(betaRaw.base_rev, "T2");
});

test("S2: rekaman dirty yang menautkan note yang dibuat ulang TIDAK ditimpa oleh pull", async () => {
  const S = seeded();
  await pullNotes(S.list());
  const old10 = await idmap.cidOf("note", 10);
  const cid20 = await idmap.cidOf("note", 20);
  S.trash.set(10, S.notes.get(10)); S.notes.delete(10); // dihapus di perangkat lain
  await pullNotes(S.list());
  await repo.updateNote(cid20, { content: "edit lokal tertunda" }, {}); // Beta dirty, op update tertunda
  const before = await repo.getNoteRaw(cid20);
  S.restore(10);
  await pullNotes(S.list());
  const after = await repo.getNoteRaw(cid20);
  assert.equal(after.content, "edit lokal tertunda");
  assert.equal(after.dirty, 1);
  assert.equal(after.linked_to_cids, before.linked_to_cids);
  assert.notEqual(await idmap.cidOf("note", 10), old10);
});

test("S2: link pulih juga pada pull berikutnya (bukan hanya pull yang membuat ulang note)", async () => {
  const S = seeded();
  await pullNotes(S.list());
  const cid20 = await idmap.cidOf("note", 20);
  S.trash.set(10, S.notes.get(10)); S.notes.delete(10);
  await pullNotes(S.list());
  await repo.updateNote(cid20, { content: "lihat [[Alpha]] lagi" }, {}); // Alpha tak ada lokal → linked_to_cids []
  S.restore(10);
  await pullNotes(S.list()); // Beta dirty → dilewati
  await pushOutbox(S.transport()); // PUT Beta → base_rev = updated_at server; server menautkan Alpha
  S.notes.get(20).linked_to = [10];
  const r = await pullNotes(S.list());
  assert.equal(r.relinked, 1);
  const new10 = await idmap.cidOf("note", 10);
  assert.deepEqual((await query.getBacklinks(new10)).map((n) => n.title), ["Beta"]);
  const again = await pullNotes(S.list());
  assert.equal(again.relinked, 0, "tidak menulis ulang bila sudah sesuai");
});

test("opNoteDelete: fallback ke rec.server_id bila _idmap hilang", async () => {
  const S = seeded();
  await pullNotes(S.list());
  const cid10 = await idmap.cidOf("note", 10);
  // Simulasikan _idmap hilang/terhapus, tapi rec.server_id masih 10
  await idmap.mapDelete("note", 10);
  assert.equal(await idmap.serverIdOf(cid10), undefined);

  await repo.deleteNote(cid10, {});
  const t = S.transport();
  const res = await pushOutbox(t);
  assert.equal(res.pushed, 1);
  assert.deepEqual(t.calls, ["DELETE /api/scratchpad/10"]);
  assert.deepEqual([...S.trash.keys()], [10]);
});

