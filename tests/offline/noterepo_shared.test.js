"use strict";
const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { deleteDB } = require("./setup.js");
const { DB_NAME, _reset } = require("../../static/offline/db.js");
const { createNote, updateNote, getNoteRaw, setCurrentUser } = require("../../static/offline/noterepo.js");

beforeEach(async () => { _reset(); await deleteDB(DB_NAME); setCurrentUser(null); });

test("createNote stores list_id and stamps owner+last_edited_by from current user", async () => {
  setCurrentUser({ user_id: 5, username: "me", display_name: "Me" });
  const rec = await createNote({ title: "Shared", content: "x", list_id: 9 }, {});
  assert.equal(rec.list_id, 9);
  assert.equal(rec.user_id, 5);
  assert.equal(rec.last_edited_by, 5);
});

test("createNote defaults list_id null (personal) when omitted", async () => {
  setCurrentUser({ user_id: 5 });
  const rec = await createNote({ title: "Personal", content: "" }, {});
  assert.equal(rec.list_id, null);
});

test("updateNote stamps last_edited_by from current user", async () => {
  setCurrentUser({ user_id: 5 });
  const rec = await createNote({ title: "A", content: "", list_id: 9 }, {});
  setCurrentUser({ user_id: 7 }); // a different member edits
  await updateNote(rec.cid, { content: "edited" }, {});
  const raw = await getNoteRaw(rec.cid);
  assert.equal(raw.last_edited_by, 7);
  assert.equal(raw.content, "edited");
});
