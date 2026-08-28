"use strict";

// Regression tests untuk DrawPage open path (numeric server id vs string client CID / standalone open):
// 1. matchesDrawingId multi-field matching (d.id, d.cid, d.client_id, d.server_id)
// 2. matchesDrawingId digunakan di semua lookup DrawPage (list.find, drawings.find, openDrawing handler, prev.some, tab mapping)
// 3. selectDrawing mendukung id/cid fallback (d.id != null ? d.id : d.cid)
// 4. configureFetcher mendukung fallback ke idOrCid langsung jika sid == null (backend FastAPI mendukung integer id & string client_id)
// 5. useEffect([initialDrawingId, loading]) diguard dengan `if (!initialDrawingId || loading) return;` untuk mencegah mount race condition
// 6. Gagal buka menampilkan toast error yang sesuai ('Gambar tidak ditemukan' / 'Gambar tidak tersedia')

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexHtml = fs.readFileSync(path.resolve(__dirname, "../../static/index.html"), "utf8");

// Helper regex extractors
const selectDrawingBlock = () => indexHtml.match(/const selectDrawing = async d => \{[\s\S]*?\n  \};/);
const drawPageBlock = () => indexHtml.match(/function DrawPage\(\{[\s\S]*?\nfunction /);
const configureFetcherBlock = () => indexHtml.match(/window\.TF\.drawingrepo\.configureFetcher\([\s\S]*?\n  \}\);/);

function extractMatchesDrawingId(html) {
  const m = html.match(/const matchesDrawingId = (\([^)]*\) => \{[\s\S]*?\n  \});/);
  if (!m) return null;
  try {
    return new Function(`return (${m[1]});`)();
  } catch (e) {
    return null;
  }
}

test("DrawPage open path — multi-identifier matching & standalone open regression tests", async (t) => {
  await t.test("matchesDrawingId function exists and correctly matches across id, cid, client_id, server_id", () => {
    const fn = extractMatchesDrawingId(indexHtml);
    assert.ok(fn, "matchesDrawingId helper function harus didefinisikan di DrawPage");

    // Case 1: Target is CID string, drawing record has numeric id + cid/client_id
    assert.strictEqual(
      fn({ id: 105, server_id: 105, cid: "drw_abc", client_id: "drw_abc" }, "drw_abc"),
      true,
      "harus cocok jika target adalah CID dan drawing memiliki cid / client_id 'drw_abc'"
    );

    // Case 2: Target is numeric server ID (105), drawing record has cid as id + server_id 105
    assert.strictEqual(
      fn({ id: "drw_abc", cid: "drw_abc", server_id: 105 }, 105),
      true,
      "harus cocok jika target adalah server_id numeric 105"
    );

    // Case 3: Target is string number ('105'), drawing record has numeric id 105
    assert.strictEqual(
      fn({ id: 105, cid: "drw_abc" }, "105"),
      true,
      "harus cocok jika target adalah string '105' dan d.id = 105"
    );

    // Case 4: Non-matching ID and CID
    assert.strictEqual(
      fn({ id: 105, cid: "drw_abc" }, "drw_xyz"),
      false,
      "harus return false jika ID / CID tidak cocok"
    );

    // Case 5: Null / undefined edge cases
    assert.strictEqual(fn(null, "drw_abc"), false, "harus return false jika drawing record null");
    assert.strictEqual(fn({ id: 105 }, null), false, "harus return false jika targetId null");
    assert.strictEqual(fn({ id: 105 }, undefined), false, "harus return false jika targetId undefined");
  });

  await t.test("selectDrawing tidak lagi mem-push sync-on-open (no POST / getRaw / mapId / server_id guard)", () => {
    const sel = selectDrawingBlock();
    assert.ok(sel, "blok selectDrawing harus ditemukan");
    assert.ok(!sel[0].includes('api.post("/api/drawings"'), "selectDrawing tidak boleh memanggil api.post('/api/drawings') (junk-row generator)");
    assert.ok(!sel[0].includes("getRaw("), "selectDrawing tidak boleh memanggil drawingrepo.getRaw (branch sync-on-open dihapus)");
    assert.ok(!sel[0].includes("mapId("), "selectDrawing tidak boleh memanggil idmap.mapId (branch sync-on-open dihapus)");
    assert.ok(!sel[0].includes("server_id == null"), "guard sync-on-open (server_id == null) harus hilang dari selectDrawing");
    assert.ok(!sel[0].includes("client_id"), "POST payload client_id tidak boleh ada di selectDrawing");
  });

  await t.test("selectDrawing mendukung drawId fallback (d.id != null ? d.id : d.cid) dan fetch via api.get", () => {
    const sel = selectDrawingBlock();
    assert.ok(sel, "blok selectDrawing harus ditemukan");
    assert.ok(
      sel[0].includes("d.id != null ? d.id : d.cid") || sel[0].includes("d.id || d.cid"),
      "selectDrawing harus menentukan drawId dengan fallback d.id != null ? d.id : d.cid"
    );
    assert.ok(
      sel[0].includes("api.get(`/api/drawings/${drawId}`)") || sel[0].includes("api.get('/api/drawings/' + drawId)"),
      "selectDrawing harus fetch detail via api.get dengan drawId"
    );
    assert.ok(!sel[0].includes("__syncRawFetch"), "selectDrawing tidak boleh memakai __syncRawFetch bypass");
    assert.ok(sel[0].includes("|| d"), "fallback `|| d` (buka dari baris list) harus dipertahankan");
    assert.ok(
      sel[0].includes("matchesDrawingId(t, targetId)") || sel[0].includes("matchesDrawingId(t, drawId)"),
      "selectDrawing harus menggunakan matchesDrawingId untuk mengupdate openTabs"
    );
  });

  await t.test("lookup list.find(initialDrawingId) di DrawPage menggunakan matchesDrawingId", () => {
    assert.ok(
      indexHtml.includes("list.find(d => matchesDrawingId(d, initialDrawingId))"),
      "list.find harus memakai matchesDrawingId(d, initialDrawingId)"
    );
  });

  await t.test("lookup drawings.find(initialDrawingId) di DrawPage menggunakan matchesDrawingId", () => {
    assert.ok(
      indexHtml.includes("drawings.find(d => matchesDrawingId(d, initialDrawingId))"),
      "drawings.find(initialDrawingId) harus memakai matchesDrawingId(d, initialDrawingId)"
    );
  });

  await t.test("lookup drawings.find(openDrawing detail id) di DrawPage menggunakan matchesDrawingId", () => {
    assert.ok(
      indexHtml.includes("drawings.find(d => matchesDrawingId(d, id))"),
      "drawings.find(id) di event listener openDrawing harus memakai matchesDrawingId(d, id)"
    );
  });

  await t.test("prev.some / prev.find dedup saat menyisipkan full drawing menggunakan matchesDrawingId", () => {
    const matches = indexHtml.match(/prev\.(?:some|find)\(d => matchesDrawingId\(d, [^)]+\)\)/g) || [];
    assert.ok(
      matches.length >= 2,
      `harus ada minimal 2 pemanggilan matchesDrawingId di updater setDrawings(prev => ...) (ditemukan ${matches.length})`
    );
  });

  await t.test("useEffect([initialDrawingId, loading]) di-guard dengan if (!initialDrawingId || loading) return;", () => {
    const page = drawPageBlock();
    assert.ok(page, "komponen DrawPage harus ditemukan");
    assert.ok(
      page[0].includes("if (!initialDrawingId || loading) return;"),
      "useEffect([initialDrawingId, loading]) harus di-guard dengan `if (!initialDrawingId || loading) return;`"
    );
    assert.ok(
      page[0].includes("}, [initialDrawingId, loading]);"),
      "useEffect harus memasukkan loading ke dependency array [initialDrawingId, loading]"
    );
  });

  await t.test("configureFetcher di static/index.html mendukung fallback ke idOrCid langsung jika sid == null", () => {
    const fetcher = configureFetcherBlock();
    assert.ok(fetcher, "blok configureFetcher harus ditemukan di static/index.html");
    assert.ok(
      fetcher[0].includes("sid != null ? sid : idOrCid") || fetcher[0].includes("sid || idOrCid"),
      "configureFetcher harus fallback ke idOrCid jika sid == null"
    );
    assert.ok(
      fetcher[0].includes("__syncRawFetch"),
      "configureFetcher harus memanggil __syncRawFetch"
    );
  });

  await t.test("catch kedua effect initialDrawingId menampilkan toast 'Gambar tidak ditemukan' (tidak silent)", () => {
    const m1 = indexHtml.match(/list\.find\(d => matchesDrawingId\(d, initialDrawingId\)\)[\s\S]{0,600}?showToast\('Gambar tidak ditemukan', 'error'\);/);
    assert.ok(m1, "catch effect mount (list) harus showToast('Gambar tidak ditemukan', 'error')");
    const m2 = indexHtml.match(/drawings\.find\(d => matchesDrawingId\(d, initialDrawingId\)\)[\s\S]{0,600}?showToast\('Gambar tidak ditemukan', 'error'\);/);
    assert.ok(m2, "catch effect kedua (drawings) harus showToast('Gambar tidak ditemukan', 'error')");
  });

  await t.test("toast openDrawing menampilkan 'Gambar tidak tersedia' (bukan offline)", () => {
    assert.ok(indexHtml.includes("showToast('Gambar tidak tersedia', 'error')"), "toast not-found harus 'Gambar tidak tersedia'");
    assert.strictEqual(indexHtml.includes("Gambar tidak tersedia — offline"), false, "pesan lama '— offline' harus hilang");
  });
});
