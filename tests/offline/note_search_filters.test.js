"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "../..");
const indexHtml = fs.readFileSync(path.join(ROOT, "static", "index.html"), "utf8").replace(/\r\n/g, "\n");
const swJs = fs.readFileSync(path.join(ROOT, "static", "sw.js"), "utf8").replace(/\r\n/g, "\n");

// Helper mirror of parseQuery logic
function parseQuery(query) {
  const negativeTags = [...query.matchAll(/(?:^|\s)-tag:(\S+)/gi)].map(m => m[1].toLowerCase());
  const syntaxTags = [...query.matchAll(/(?:^|\s)tag:(\S+)/gi)].map(m => m[1].toLowerCase());
  const cleanQuery = query
    .replace(/(?:^|\s)-tag:\S+/gi, " ")
    .replace(/(?:^|\s)tag:\S+/gi, " ")
    .trim();
  return {
    cleanQuery,
    syntaxTags,
    negativeTags
  };
}

// Helper mirror of applyFilters logic
function applyFilters(query, tags, base, untagged = false, tab = "all", publishedNoteIds = new Set(), sharedListIds = new Set()) {
  const { cleanQuery, syntaxTags, negativeTags } = parseQuery(query);
  const allActiveTags = [...new Set([...tags, ...syntaxTags])];
  let result = base;
  for (const tag of allActiveTags) {
    result = result.filter(n => (n.tags || []).map(t => t.toLowerCase()).includes(tag));
  }
  for (const ntag of negativeTags) {
    result = result.filter(n => !(n.tags || []).map(t => t.toLowerCase()).includes(ntag));
  }
  if (cleanQuery) {
    result = result.filter(n =>
      n.title?.toLowerCase().includes(cleanQuery.toLowerCase()) ||
      n.content?.toLowerCase().includes(cleanQuery.toLowerCase())
    );
  }
  if (untagged) result = result.filter(n => (n.tags || []).length === 0);
  if (tab === "pinned") result = result.filter(n => n.pinned);
  if (tab === "pub") result = result.filter(n => publishedNoteIds.has(n.id));
  if (tab === "shared") result = result.filter(n => n.list_id && sharedListIds.has(n.list_id));
  return result;
}

test("Note Search Filters: Parsing & Filtering Specifications", async (t) => {
  await t.test("1. Regex and parsing logic for syntaxTags and negativeTags", () => {
    // Basic positive & negative tag parsing
    const res1 = parseQuery("proyek tag:kerja -tag:arsip");
    assert.deepEqual(res1.syntaxTags, ["kerja"]);
    assert.deepEqual(res1.negativeTags, ["arsip"]);
    assert.equal(res1.cleanQuery, "proyek");

    // Case insensitivity
    const res2 = parseQuery("TAG:PENTING -Tag:Draft halo dunia");
    assert.deepEqual(res2.syntaxTags, ["penting"]);
    assert.deepEqual(res2.negativeTags, ["draft"]);
    assert.equal(res2.cleanQuery, "halo dunia");

    // Multiple positive and negative tags
    const res3 = parseQuery("-tag:lama tag:a tag:b -tag:sampah");
    assert.deepEqual(res3.syntaxTags, ["a", "b"]);
    assert.deepEqual(res3.negativeTags, ["lama", "sampah"]);
    assert.equal(res3.cleanQuery, "");

    // Verify tag: does not falsely capture -tag:
    const res4 = parseQuery("-tag:arsip");
    assert.deepEqual(res4.syntaxTags, [], "tag: should not match -tag:");
    assert.deepEqual(res4.negativeTags, ["arsip"]);
    assert.equal(res4.cleanQuery, "");

    // Pure search without tags
    const res5 = parseQuery("laporan bulanan");
    assert.deepEqual(res5.syntaxTags, []);
    assert.deepEqual(res5.negativeTags, []);
    assert.equal(res5.cleanQuery, "laporan bulanan");
  });

  await t.test("2. Simulated filter function behavior with notes collection", () => {
    const notes = [
      { id: 1, title: "Laporan Q1", content: "Selesai dikerjakan", tags: ["kerja", "q1"] },
      { id: 2, title: "Laporan Q2", content: "Dalam proses", tags: ["kerja", "q2", "arsip"] },
      { id: 3, title: "Ide Liburan", content: "Pantai dan gunung", tags: ["pribadi"] },
      { id: 4, title: "Catatan Rahasia", content: "Draft arsip dokumen", tags: ["pribadi", "arsip"] },
      { id: 5, title: "Catatan Tanpa Tag", content: "Hanya teks", tags: [] }
    ];

    // Filter by positive tag:kerja -> notes 1 and 2
    const filter1 = applyFilters("tag:kerja", [], notes);
    assert.deepEqual(filter1.map(n => n.id), [1, 2]);

    // Filter by positive tag:kerja and negative -tag:arsip -> note 1 only
    const filter2 = applyFilters("tag:kerja -tag:arsip", [], notes);
    assert.deepEqual(filter2.map(n => n.id), [1]);

    // Negative tag only: -tag:arsip -> notes 1, 3, 5
    const filter3 = applyFilters("-tag:arsip", [], notes);
    assert.deepEqual(filter3.map(n => n.id), [1, 3, 5]);

    // Negative tag + search text: -tag:arsip + "Laporan" -> note 1 ("Laporan Q1")
    const filter4 = applyFilters("Laporan -tag:arsip", [], notes);
    assert.deepEqual(filter4.map(n => n.id), [1]);

    // Active UI tag array + negative syntax tag
    const filter5 = applyFilters("-tag:arsip", ["kerja"], notes);
    assert.deepEqual(filter5.map(n => n.id), [1]);

    // Untagged filter
    const filterUntagged = applyFilters("", [], notes, true);
    assert.deepEqual(filterUntagged.map(n => n.id), [5]);
  });

  await t.test("3. Static code checks on static/index.html", () => {
    // Check parseQuery definition in static/index.html
    const iParse = indexHtml.indexOf("const parseQuery =");
    assert.ok(iParse > -1, "parseQuery must be defined in static/index.html");
    const parseQueryBody = indexHtml.slice(iParse, indexHtml.indexOf("const applyFilters =", iParse));
    assert.match(parseQueryBody, /negativeTags/, "parseQuery must extract negativeTags");
    assert.match(parseQueryBody, /-tag:\(/, "parseQuery regex must match -tag: group");
    assert.match(parseQueryBody, /negativeTags\s*\n\s*\};/, "parseQuery must return negativeTags");

    // Check applyFiltersStatic definition in static/index.html
    const iStatic = indexHtml.indexOf("const applyFiltersStatic =");
    assert.ok(iStatic > -1, "applyFiltersStatic must be defined in static/index.html");
    const staticBody = indexHtml.slice(iStatic, indexHtml.indexOf("const fetchNotes =", iStatic));
    assert.match(staticBody, /negativeTags/, "applyFiltersStatic must define negativeTags");
    assert.match(staticBody, /for\s*\(\s*const\s+\w+\s+of\s+negativeTags\s*\)/, "applyFiltersStatic must loop over negativeTags");

    // Check applyFilters definition in static/index.html
    const iApply = indexHtml.indexOf("const applyFilters =");
    assert.ok(iApply > -1, "applyFilters must be defined in static/index.html");
    const applyBody = indexHtml.slice(iApply, indexHtml.indexOf("const handleSearch =", iApply));
    assert.match(applyBody, /negativeTags/, "applyFilters must destructure negativeTags");
    assert.match(applyBody, /for\s*\(\s*const\s+\w+\s+of\s+negativeTags\s*\)/, "applyFilters must loop over negativeTags");
  });

  await t.test("4. Service Worker Cache Version bumped to v368", () => {
    assert.match(
      swJs,
      /^const CACHE = "taskflow-v368-habit-kpi-redesign";/m,
      "sw.js CACHE must be taskflow-v368-habit-kpi-redesign"
    );
  });
});
