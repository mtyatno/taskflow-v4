"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { makeRouter } = require("../../static/offline/router.js");

test("dispatch routes GET with query to handler", async () => {
  const r = makeRouter();
  r.register("GET", "/api/tasks", async (ctx) => ({ ok: true, q: ctx.query.gtd_status }));
  const res = await r.dispatch("GET", "/api/tasks?gtd_status=inbox");
  assert.deepEqual(res, { ok: true, q: "inbox" });
});

test("dispatch extracts path params", async () => {
  const r = makeRouter();
  r.register("PUT", "/api/tasks/:cid", async (ctx) => ({ cid: ctx.params.cid, body: ctx.body }));
  const res = await r.dispatch("PUT", "/api/tasks/abc-123", { title: "x" });
  assert.deepEqual(res, { cid: "abc-123", body: { title: "x" } });
});

test("dispatch distinguishes methods on same path", async () => {
  const r = makeRouter();
  r.register("GET", "/api/tasks", async () => "list");
  r.register("POST", "/api/tasks", async () => "created");
  assert.equal(await r.dispatch("POST", "/api/tasks"), "created");
});

test("hasRoute reports whether a path is handled locally", () => {
  const r = makeRouter();
  r.register("GET", "/api/tasks", async () => null);
  assert.equal(r.hasRoute("GET", "/api/tasks?x=1"), true);
  assert.equal(r.hasRoute("GET", "/api/lists"), false);
});

test("dispatch throws for an unregistered route", async () => {
  const r = makeRouter();
  await assert.rejects(() => r.dispatch("GET", "/api/nope"), /no local route/i);
});

test("more specific static route wins over param route regardless of registration order", async () => {
  const r = makeRouter();
  r.register("GET", "/api/tasks/:cid", async () => "param");
  r.register("GET", "/api/tasks/summary", async () => "static");
  assert.equal(await r.dispatch("GET", "/api/tasks/summary"), "static");
});
