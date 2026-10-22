"use strict";

// Tandai selesai harus instan: handleDone / handleDoneAll / handleDoneParentOnly memperbarui state `tasks`
// secara optimistik (helper top-level markTasksDoneLocal) SEBELUM fetchAll() — fetchAll menunggu sync() penuh
// (pull semua domain + push outbox) sehingga tanpa ini baris task baru hilang 10–15 dtk kemudian di produksi.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8").replace(/\r\n/g, "\n");

function topFnSource(name) {
  const start = indexHtml.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = indexHtml.indexOf("\n}\n", start + 1);
  return indexHtml.slice(start, end + 2);
}

function handlerSource(name) {
  const start = indexHtml.indexOf(`\n  const ${name} = async `);
  assert.ok(start >= 0, `${name} must exist`);
  const end = indexHtml.indexOf("\n  };\n", start + 1);
  assert.ok(end > start, `${name} end must be found`);
  return indexHtml.slice(start, end);
}

// Jalur sukses = isi try terluar sebelum `} catch (err) {`.
function successPath(name) {
  const src = handlerSource(name);
  const idx = src.lastIndexOf("} catch (err) {");
  assert.ok(idx > 0, `${name} must have outer catch`);
  return src.slice(0, idx);
}

test("markTasksDoneLocal: tandai done + completed_at + is_overdue false, banding id via String (cid / int)", () => {
  const markTasksDoneLocal = new Function(topFnSource("markTasksDoneLocal") + "\nreturn markTasksDoneLocal;")();
  const other = { id: 3, title: "lain", gtd_status: "next" };
  const prev = [
    { id: 7, title: "a", gtd_status: "next", completed_at: null, is_overdue: true },
    { id: "c-abc", title: "b", gtd_status: "next" },
    other,
  ];
  const next = markTasksDoneLocal(prev, ["7", "c-abc"], "2026-10-22T03:00:00.000Z");
  assert.equal(next[0].gtd_status, "done");
  assert.equal(next[0].completed_at, "2026-10-22T03:00:00.000Z");
  assert.equal(next[0].is_overdue, false, "task selesai tidak lagi terlambat (sama dengan server/router lokal)");
  assert.equal(next[0].title, "a");
  assert.equal(next[1].gtd_status, "done");
  assert.equal(next[2], other, "task lain tidak disentuh");
  assert.equal(prev[0].gtd_status, "next", "state lama tidak dimutasi");
  // int vs string
  assert.equal(markTasksDoneLocal([{ id: "12" }], [12], "x")[0].gtd_status, "done");
  // tanpa now → ISO sekarang
  assert.match(markTasksDoneLocal([{ id: 1 }], [1])[0].completed_at, /^\d{4}-\d\d-\d\dT/);
  // prev bukan array → aman
  assert.deepEqual(markTasksDoneLocal(null, [1]), null);
});

for (const [name, idsExpr] of [
  ["handleDone", "[taskId]"],
  ["handleDoneParentOnly", "[taskId]"],
  ["handleDoneAll", "[...children.map(c => c.id), taskId]"],
]) {
  test(`${name}: jalur sukses setTasks optimistik done sebelum fetchAll()`, () => {
    const ok = successPath(name);
    const opt = ok.indexOf(`setTasks(prev => markTasksDoneLocal(prev, ${idsExpr}))`);
    const fetchIdx = ok.indexOf("fetchAll();");
    const doneCall = ok.lastIndexOf("/done`)");
    assert.ok(opt > 0, `${name} must optimistically mark done`);
    assert.ok(fetchIdx > 0, `${name} must still call fetchAll()`);
    assert.ok(doneCall > 0 && doneCall < opt, `${name}: optimistic update after done call succeeded`);
    assert.ok(opt < fetchIdx, `${name}: optimistic update before fetchAll()`);
    assert.ok(!ok.includes("await fetchAll"), `${name}: fetchAll tetap tidak di-await`);
  });
}
