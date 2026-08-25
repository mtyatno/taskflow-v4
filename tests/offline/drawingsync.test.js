"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset, openDB } = require("../../static/offline/db.js");
const { mapPut, cidOf, serverIdOf } = require("../../static/offline/idmap.js");
const { outboxAll, outboxAdd } = require("../../static/offline/outbox.js");
const { makeBlobStore } = require("../../static/offline/blobstore.js");
const { getEntityTags, setEntityTags } = require("../../static/offline/tagrepo.js");
const {
  pushOutbox, healStrandedDrawings,
} = require("../../static/offline/syncpush.js");
const {
  pullDrawings, pullDrawingsAndReconcile,
} = require("../../static/offline/syncpull.js");
const {
  createDrawing, getDrawing, listDrawings,
} = require("../../static/offline/drawingrepo.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); });

const blobStore = makeBlobStore();

async function putDrawings(recs) {
  const db = await openDB();
  await new Promise((res, rej) => {
    const tx = db.transaction("drawings", "readwrite");
    const os = tx.objectStore("drawings");
    for (const r of recs) os.put(r);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

async function allDrawings() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction("drawings", "readonly").objectStore("drawings").getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });
}

async function getDrawingRec(cid) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const r = db.transaction("drawings", "readonly").objectStore("drawings").get(cid);
    r.onsuccess = () => res(r.result || null);
    r.onerror = () => rej(r.error);
  });
}

function localDrawing(over) {
  return Object.assign({
    cid: over.cid,
    server_id: null,
    title: over.cid || "Drawing",
    blob_ref: null,
    svg_preview: "<svg></svg>",
    is_pinned: 0,
    created_at: "2026-08-25T10:00:00",
    updated_at: "2026-08-25T10:00:00",
    deleted: false,
    dirty: 0,
    base_rev: null,
  }, over);
}

function srvDrawing(over) {
  return Object.assign({
    id: over.id,
    title: "Server Drawing",
    data_json: '{"shapes":{}}',
    svg_preview: "<svg></svg>",
    is_pinned: 0,
    tags: [],
    created_at: "2026-08-25T10:00:00",
    updated_at: "2026-08-25T10:00:00",
  }, over);
}

function fakeTransport(handler) {
  const calls = [];
  return {
    calls,
    request(method, path, body) {
      calls.push({ method, path, body });
      const h = handler(method, path, body);
      if (h === "NETWORK") return Promise.reject(new Error("net"));
      return Promise.resolve(h);
    },
  };
}

// Test 1: opDrawingCreate in syncpush uses TFidmap.mapPut and updates server_id, dirty: 0, base_rev, and cleans outbox
test("Test 1: opDrawingCreate uses TFidmap.mapPut and updates server_id, dirty: 0, base_rev", async () => {
  const blobRef = await blobStore.put('{"canvas":1}', { mime: "application/json" });
  await putDrawings([
    localDrawing({
      cid: "draw-1",
      server_id: null,
      title: "My Drawing",
      blob_ref: blobRef,
      svg_preview: "<svg>1</svg>",
      dirty: 1,
      deleted: false,
    }),
  ]);
  await outboxAdd({
    op: "create",
    entity_type: "drawing",
    cid: "draw-1",
    payload: {
      title: "My Drawing",
      data_json: '{"canvas":1}',
      svg_preview: "<svg>1</svg>",
      is_pinned: 0,
      tags: ["art"],
    },
  });

  const tr = fakeTransport((method, path, body) => {
    assert.equal(method, "POST");
    assert.equal(path, "/api/drawings");
    assert.equal(body.title, "My Drawing");
    assert.equal(body.client_id, "draw-1");
    return { status: 200, data: { id: 701, updated_at: "2026-08-25T12:00:00" } };
  });

  const res = await pushOutbox(tr);
  assert.equal(res.pushed, 1);
  assert.equal(res.remaining, 0);

  // Verify idmap
  assert.equal(await serverIdOf("draw-1"), 701);
  assert.equal(await cidOf("drawing", 701), "draw-1");

  // Verify IndexedDB record
  const row = await getDrawingRec("draw-1");
  assert.equal(row.server_id, 701);
  assert.equal(row.dirty, 0);
  assert.equal(row.base_rev, "2026-08-25T12:00:00");

  // Verify outbox is empty
  const ops = await outboxAll();
  assert.equal(ops.length, 0);
});

// Test 2: healStrandedDrawings identifies stranded unpushed drawings and appends create op to _outbox
test("Test 2: healStrandedDrawings identifies stranded unpushed drawings and appends create op", async () => {
  const b1 = await blobStore.put('{"d":1}', { mime: "application/json" });
  const b2 = await blobStore.put('{"d":2}', { mime: "application/json" });
  await putDrawings([
    localDrawing({ cid: "draw-s1", title: "Stranded 1", blob_ref: b1, server_id: null, deleted: false }),
    localDrawing({ cid: "draw-s2", title: "Stranded 2", blob_ref: b2, server_id: null, deleted: false }),
  ]);
  await setEntityTags("drawing", "draw-s1", ["sketch"]);

  const initialOps = await outboxAll();
  assert.equal(initialOps.length, 0);

  const count = await healStrandedDrawings();
  assert.equal(count, 2);

  const healedOps = await outboxAll();
  assert.equal(healedOps.length, 2);
  const cids = new Set(healedOps.map((o) => o.cid));
  assert.equal(cids.has("draw-s1"), true);
  assert.equal(cids.has("draw-s2"), true);
  assert.equal(healedOps.every((o) => o.entity_type === "drawing" && o.op === "create"), true);

  const op1 = healedOps.find((o) => o.cid === "draw-s1");
  assert.equal(op1.payload.title, "Stranded 1");
  assert.deepEqual(op1.payload.tags, ["sketch"]);
  assert.equal(op1.payload.data_json, '{"d":1}');
});

// Test 3: healStrandedDrawings does not duplicate outbox op if create op already exists in _outbox
test("Test 3: healStrandedDrawings does not duplicate outbox op if create op already exists", async () => {
  await putDrawings([
    localDrawing({ cid: "draw-existing", title: "Existing Op Draw", server_id: null, deleted: false }),
  ]);
  await outboxAdd({
    op: "create",
    entity_type: "drawing",
    cid: "draw-existing",
    payload: { title: "Existing Op Draw" },
  });

  const count = await healStrandedDrawings();
  assert.equal(count, 0);

  const ops = await outboxAll();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].cid, "draw-existing");
});

// Test 4: healStrandedDrawings ignores deleted drawings, drawings with valid server_id, or note-attached drawings
test("Test 4: healStrandedDrawings ignores deleted drawings, valid server_id, or note-attached drawings", async () => {
  await putDrawings([
    localDrawing({ cid: "draw-del", title: "Deleted Draw", server_id: null, deleted: true }),
    localDrawing({ cid: "draw-synced", title: "Synced Draw", server_id: 123, deleted: false }),
    localDrawing({ cid: "draw-note-attached", title: "Note Attached", server_id: null, deleted: false, note_cid: "note-xyz" }),
  ]);

  const count = await healStrandedDrawings();
  assert.equal(count, 0);

  const ops = await outboxAll();
  assert.equal(ops.length, 0);
});

// Test 5: End-to-end pushOutbox autoheals stranded drawing, sends payload with client_id, sets server_id, dirty: 0, and clears outbox
test("Test 5: End-to-end pushOutbox autoheals stranded drawing and pushes to server", async () => {
  const b = await blobStore.put('{"shapes":{"1":{"type":"box"}}}', { mime: "application/json" });
  await putDrawings([
    localDrawing({
      cid: "draw-e2e",
      title: "E2E Autoheal Draw",
      blob_ref: b,
      svg_preview: "<svg>e2e</svg>",
      server_id: null,
      deleted: false,
    }),
  ]);
  await setEntityTags("drawing", "draw-e2e", ["diagram", "flow"]);

  const opsBefore = await outboxAll();
  assert.equal(opsBefore.length, 0);

  const tr = fakeTransport((method, path, body) => {
    assert.equal(method, "POST");
    assert.equal(path, "/api/drawings");
    assert.equal(body.client_id, "draw-e2e");
    assert.equal(body.title, "E2E Autoheal Draw");
    assert.equal(body.svg_preview, "<svg>e2e</svg>");
    assert.equal(body.data_json, '{"shapes":{"1":{"type":"box"}}}');
    assert.deepEqual(body.tags, ["diagram", "flow"]);
    return { status: 200, data: { id: 808, updated_at: "2026-08-25T14:00:00" } };
  });

  const res = await pushOutbox(tr);
  assert.equal(res.pushed, 1);
  assert.equal(res.remaining, 0);
  assert.equal(tr.calls.length, 1);

  assert.equal(await serverIdOf("draw-e2e"), 808);
  const row = await getDrawingRec("draw-e2e");
  assert.equal(row.server_id, 808);
  assert.equal(row.dirty, 0);
  assert.equal(row.base_rev, "2026-08-25T14:00:00");

  const opsAfter = await outboxAll();
  assert.equal(opsAfter.length, 0);
});

// Test 6: ensureDrawingCid fallback in pullDrawings matches existing local record and repairs _idmap
test("Test 6: ensureDrawingCid matches existing local record when _idmap is missing", async () => {
  const b = await blobStore.put('{"canvas":55}', { mime: "application/json" });
  await putDrawings([
    localDrawing({
      cid: "draw-local-55",
      server_id: 55,
      title: "Existing Local Drawing",
      blob_ref: b,
      base_rev: "2026-08-25T10:00:00",
      dirty: 0,
    }),
  ]);

  // Verify idmap has no entry initially
  assert.equal(await cidOf("drawing", 55), undefined);

  const fetchOne = (sid) => Promise.resolve({
    id: sid,
    title: "Existing Local Drawing",
    data_json: '{"canvas":55}',
    svg_preview: "<svg></svg>",
    is_pinned: 0,
    tags: [],
    updated_at: "2026-08-25T10:00:00",
  });

  const r = await pullDrawings([srvDrawing({ id: 55, title: "Existing Local Drawing", updated_at: "2026-08-25T10:00:00" })], fetchOne);
  assert.equal(r.created, 0);

  // Verify idmap repaired
  assert.equal(await cidOf("drawing", 55), "draw-local-55");

  // Verify no duplicate record created
  const all = await allDrawings();
  assert.equal(all.length, 1);
  assert.equal(all[0].cid, "draw-local-55");
});

// Test 7: pullDrawings creates new local records for drawings arriving from server
test("Test 7: pullDrawings creates new local records for drawings arriving from server", async () => {
  const fetchOne = (sid) => Promise.resolve({
    id: sid,
    title: "Server Sketch",
    data_json: '{"elements":[1,2,3]}',
    svg_preview: "<svg>sketch</svg>",
    is_pinned: 1,
    tags: ["art", "sketch"],
    created_at: "2026-08-25T01:00:00",
    updated_at: "2026-08-25T02:00:00",
  });

  const r = await pullDrawings([
    srvDrawing({ id: 101, title: "Server Sketch", is_pinned: 1, updated_at: "2026-08-25T02:00:00" }),
  ], fetchOne);

  assert.equal(r.created, 1);
  const all = await allDrawings();
  assert.equal(all.length, 1);
  const rec = all[0];
  assert.equal(rec.server_id, 101);
  assert.equal(rec.title, "Server Sketch");
  assert.equal(rec.svg_preview, "<svg>sketch</svg>");
  assert.equal(rec.is_pinned, 1);
  assert.equal(rec.dirty, 0);
  assert.equal(rec.base_rev, "2026-08-25T02:00:00");

  const data = await blobStore.getBytes(rec.blob_ref);
  assert.equal(data, '{"elements":[1,2,3]}');

  const tags = await getEntityTags("drawing", rec.cid);
  assert.deepEqual(tags.map((t) => t.name).sort(), ["art", "sketch"]);
});

// Test 8: pullDrawings updates existing records when s.updated_at !== local.base_rev
test("Test 8: pullDrawings updates existing records when server updated_at differs", async () => {
  const bOld = await blobStore.put('{"v":1}', { mime: "application/json" });
  await putDrawings([
    localDrawing({
      cid: "draw-up",
      server_id: 202,
      title: "Old Title",
      blob_ref: bOld,
      base_rev: "2026-08-25T01:00:00",
      dirty: 0,
    }),
  ]);
  await mapPut("drawing", 202, "draw-up");

  const fetchOne = (sid) => Promise.resolve({
    id: sid,
    title: "Updated Title",
    data_json: '{"v":2}',
    svg_preview: "<svg>v2</svg>",
    is_pinned: 0,
    tags: ["v2"],
    updated_at: "2026-08-25T05:00:00",
  });

  const r = await pullDrawings([
    srvDrawing({ id: 202, title: "Updated Title", updated_at: "2026-08-25T05:00:00" }),
  ], fetchOne);

  assert.equal(r.updated, 1);
  const rec = await getDrawingRec("draw-up");
  assert.equal(rec.title, "Updated Title");
  assert.equal(rec.svg_preview, "<svg>v2</svg>");
  assert.equal(rec.base_rev, "2026-08-25T05:00:00");
  assert.equal(rec.dirty, 0);

  const data = await blobStore.getBytes(rec.blob_ref);
  assert.equal(data, '{"v":2}');
});

// Test 9: pullDrawings cleans phantom duplicate rows
test("Test 9: pullDrawings cleans phantom duplicate rows", async () => {
  const b1 = await blobStore.put('{"c":1}', { mime: "application/json" });
  const b2 = await blobStore.put('{"c":2}', { mime: "application/json" });
  await putDrawings([
    localDrawing({ cid: "draw-canon", server_id: 303, title: "Canonical", blob_ref: b1, base_rev: "2026-08-25T01:00:00" }),
    localDrawing({ cid: "draw-phantom", server_id: 303, title: "Phantom", blob_ref: b2, base_rev: "2026-08-25T01:00:00" }),
  ]);
  await mapPut("drawing", 303, "draw-canon");

  const fetchOne = (sid) => Promise.resolve({
    id: sid,
    title: "Canonical",
    data_json: '{"c":1}',
    svg_preview: "<svg></svg>",
    is_pinned: 0,
    tags: [],
    updated_at: "2026-08-25T01:00:00",
  });

  await pullDrawings([
    srvDrawing({ id: 303, title: "Canonical", updated_at: "2026-08-25T01:00:00" }),
  ], fetchOne);

  const all = await allDrawings();
  assert.equal(all.length, 1);
  assert.equal(all[0].cid, "draw-canon");
  assert.equal(await getDrawingRec("draw-phantom"), null);
});

// Test 10: pullDrawings restores stale tombstones without pending outbox delete op
test("Test 10: pullDrawings restores stale tombstones from server when there is no pending outbox delete op", async () => {
  const b = await blobStore.put('{"tomb":1}', { mime: "application/json" });
  await putDrawings([
    localDrawing({
      cid: "draw-tomb",
      server_id: 404,
      title: "Tombstone",
      blob_ref: b,
      deleted: true,
      dirty: 1,
      base_rev: "2026-08-25T01:00:00",
    }),
  ]);
  await mapPut("drawing", 404, "draw-tomb");

  const fetchOne = (sid) => Promise.resolve({
    id: sid,
    title: "Restored Drawing",
    data_json: '{"tomb":false}',
    svg_preview: "<svg>restored</svg>",
    is_pinned: 0,
    tags: [],
    updated_at: "2026-08-25T01:00:00",
  });

  const r = await pullDrawings([
    srvDrawing({ id: 404, title: "Restored Drawing", updated_at: "2026-08-25T01:00:00" }),
  ], fetchOne);

  assert.equal(r.created, 1);
  const rec = await getDrawingRec("draw-tomb");
  assert.equal(rec.deleted, false);
  assert.equal(rec.dirty, 0);
  assert.equal(rec.title, "Restored Drawing");
});

// Test 11: pullDrawings protects active pending outbox delete ops
test("Test 11: pullDrawings protects active pending outbox delete ops", async () => {
  await putDrawings([
    localDrawing({
      cid: "draw-act-del",
      server_id: 505,
      title: "Active Delete",
      deleted: true,
      dirty: 1,
    }),
  ]);
  await mapPut("drawing", 505, "draw-act-del");
  await outboxAdd({
    op: "delete",
    entity_type: "drawing",
    cid: "draw-act-del",
    payload: {},
  });

  const fetchOne = (sid) => Promise.resolve({
    id: sid,
    title: "Server Title",
    data_json: "{}",
    svg_preview: "",
    is_pinned: 0,
    tags: [],
    updated_at: "2026-08-25T01:00:00",
  });

  const r = await pullDrawings([
    srvDrawing({ id: 505, title: "Server Title", updated_at: "2026-08-25T01:00:00" }),
  ], fetchOne);

  const rec = await getDrawingRec("draw-act-del");
  assert.equal(rec.deleted, true);
  assert.equal((await outboxAll()).length, 1);
});

// Test 12: pullDrawings deletes local records removed from server when no pending local changes
test("Test 12: pullDrawings deletes clean local records removed from server", async () => {
  const b = await blobStore.put('{"vanish":1}', { mime: "application/json" });
  await putDrawings([
    localDrawing({
      cid: "draw-vanish",
      server_id: 606,
      title: "Vanished",
      blob_ref: b,
      deleted: false,
      dirty: 0,
    }),
  ]);
  await mapPut("drawing", 606, "draw-vanish");

  const r = await pullDrawings([], () => Promise.resolve(null));
  assert.equal(r.deleted, 1);
  assert.equal(await getDrawingRec("draw-vanish"), null);
  assert.equal(await cidOf("drawing", 606), undefined);
});

// Test 13: pullDrawings adopts server is_pinned status when no pending pin op in outbox
test("Test 13: pullDrawings adopts server is_pinned status when no pending pin op exists", async () => {
  const b = await blobStore.put('{"p":1}', { mime: "application/json" });
  await putDrawings([
    localDrawing({
      cid: "draw-pin",
      server_id: 707,
      title: "Pin Test",
      blob_ref: b,
      is_pinned: 0,
      base_rev: "2026-08-25T01:00:00",
      dirty: 0,
    }),
  ]);
  await mapPut("drawing", 707, "draw-pin");

  const fetchOne = (sid) => Promise.resolve({
    id: sid,
    title: "Pin Test",
    data_json: '{"p":1}',
    svg_preview: "",
    is_pinned: 1,
    tags: [],
    updated_at: "2026-08-25T01:00:00",
  });

  const r = await pullDrawings([
    srvDrawing({ id: 707, title: "Pin Test", is_pinned: 1, updated_at: "2026-08-25T01:00:00" }),
  ], fetchOne);

  assert.equal(r.pinned, 1);
  const rec = await getDrawingRec("draw-pin");
  assert.equal(rec.is_pinned, 1);
});

// Test 14: pullDrawingsAndReconcile fetches list and details, calling pullDrawings
test("Test 14: pullDrawingsAndReconcile fetches list and details, calling pullDrawings", async () => {
  const fakeRawFetch = (url) => {
    if (url === "/api/drawings") {
      return Promise.resolve({
        json: () => Promise.resolve([
          { id: 808, title: "Fetched Draw", is_pinned: 0, updated_at: "2026-08-25T09:00:00" },
        ]),
      });
    }
    if (url === "/api/drawings/808") {
      return Promise.resolve({
        json: () => Promise.resolve({
          id: 808,
          title: "Fetched Draw",
          data_json: '{"shapes":{"box":1}}',
          svg_preview: "<svg>reconcile</svg>",
          is_pinned: 0,
          tags: ["reconcile"],
          created_at: "2026-08-25T09:00:00",
          updated_at: "2026-08-25T09:00:00",
        }),
      });
    }
    return Promise.reject(new Error("Unknown url: " + url));
  };

  const r = await pullDrawingsAndReconcile(fakeRawFetch);
  assert.equal(r.created, 1);

  const all = await allDrawings();
  assert.equal(all.length, 1);
  const rec = all[0];
  assert.equal(rec.server_id, 808);
  assert.equal(rec.title, "Fetched Draw");
  assert.equal(rec.svg_preview, "<svg>reconcile</svg>");
  assert.equal(await blobStore.getBytes(rec.blob_ref), '{"shapes":{"box":1}}');
  const tags = await getEntityTags("drawing", rec.cid);
  assert.deepEqual(tags.map((t) => t.name), ["reconcile"]);
});
