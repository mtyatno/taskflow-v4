# Petakan (Catatan ↔ Mindmap Tertaut) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Peta mindmap yang tertaut ke sebuah catatan, strukturnya cermin heading catatan, bisa diedit dua arah, dengan ringkasan per node dan "Buka di catatan" — semua berbasis aturan di perangkat.

**Architecture:** Modul murni `static/offline/notemap.js` mengurai markdown catatan menjadi bagian, membangun data mind-elixir, dan menyusun ulang markdown dari pohon yang diedit. Peta tertaut = baris `mindmaps` dengan `source_note_id` yang `data_json`-nya hanya pengaturan tampilan; isi selalu dibaca dari catatan dan edit ditulis ke catatan lewat `noterepo.applyMapEdit` (transaksi IndexedDB atas isi terbaru). Server menjaga pemilik/`list_id`/judul peta = catatan.

**Tech Stack:** JavaScript UMD (browser + `node --test` dengan `fake-indexeddb`), React tanpa build (JSX dikompilasi `compile.js`) di `static/index.html`, mind-elixir 5.15.1 di iframe, FastAPI + SQLite (`webapp.py`), pytest.

**Spec:** `docs/superpowers/specs/2026-10-18-petakan-note-mindmap-design.md`

## Global Constraints

- Tanpa LLM/AI dan tanpa panggilan jaringan untuk konversi; semua logika konversi di `notemap.js`.
- Catatan satu-satunya sumber data. `data_json` peta tertaut persis: `{"linked":1,"direction":2,"justify":false,"collapsed":[],"summary":true}` (default). Server menolak `nodeData` pada peta tertaut: 400 `{"detail":{"code":"LINKED_TREE_REJECTED"}}`.
- Heading: regex `^(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*\r?$`, teks tidak kosong, kolom 0; bukan heading di dalam fence ``` / ~~~ (penutup: karakter sama, panjang ≥ pembuka), di baris `^ {0,3}>`, di dalam `<details>…</details>`.
- Tanpa edit → `applyMindData` menghasilkan markdown identik byte per byte.
- Ringkasan: excerpt kalimat pertama paragraf pertama (gabung kalimat berikutnya di paragraf yang sama bila < 20 karakter), maks 120 karakter dipotong di batas kata + "…"; items ≤ 3 butir tingkat teratas dari daftar pertama, masing-masing ≤ 40 karakter + "…", `more` = sisa ("+N"); counts tampil "☑ d/t · 🖼 n · ⊞ n" hanya nilai > 0.
- Lipatan awal: ≤ 30 node (tanpa root) semua terbuka; > 30 → node kedalaman ≥ 2 (root = 0) `expanded: false`.
- Level > 6 → `{ ok: false, code: "LEVEL_OVERFLOW" }`. Teks default node baru: "Node baru". Root tanpa judul: "Tanpa judul".
- Jeda tulis 800 ms; riwayat undo maks 20.
- Teks UI persis: "Catatan baru saja berubah — peta dimuat ulang, ulangi perubahanmu" · "Tidak bisa diurungkan: catatan sudah berubah" · "Maksimal 6 tingkat heading" · "Hapus bagian «X» beserta isinya dari catatan?" · "Catatan sumber ada di Sampah" · "Catatan sumber tidak tersedia untukmu" · "Catatan belum tersedia di perangkat ini — sambungkan internet" · "Tambah node di sini atau heading di catatan" · "📄 Tertaut ke: " · "Tersimpan ke catatan" · "🧠 Petakan" · "🧠 Buka peta" · "+ Dari Catatan" · "📄 Buka di catatan" · "↗ Buka di halaman Notes" · "Ringkasan" · "Tertaut ke catatan" · "Peta tertaut mengikuti catatan" · "Perubahan ini akan merusak struktur catatan (ada blok kode/toggle yang tidak ditutup) — ubah lewat catatan" · "Gagal membuat peta" · "Hapus peta".
- Server: kolom `mindmaps.source_note_id INTEGER DEFAULT NULL` tanpa FK; index `ux_mindmaps_source_note` unik parsial; daftar menyaring peta tertaut kecuali `?linked=1`.
- Aturan repo: jangan pakai `border-left` aksen; tiap rilis frontend menaikkan versi SW di semua tempat (cek `main` dulu, nomor bisa sudah naik); naikkan `?v=` iframe bila iframe berubah dan `app.css?v=` bila `app.css` berubah; modul offline baru masuk precache `static/sw.js`; perbarui `.agents/CURRENT_STATE.md` + `.agents/SESSION_LOG.md` tiap PR; PR draft, merge hanya setelah Bapak bilang "merge dan deploy".
- Perintah cek: `npm install --no-save fake-indexeddb@6` (sekali), `npm test`, `python -m pytest tests/ -q`, `node temporary_files/check_inline_scripts.js static/index.html`, `node temporary_files/check_inline_scripts.js static/vendor/mind-elixir/index.html`.
- Tiga branch/PR: `claude/petakan-1-notemap` (Bagian A), `claude/petakan-2-backend` (Bagian B, dari `main`), `claude/petakan-3-ui` (Bagian C, dari `main` setelah A & B di-merge).

## Review Focus

1. **Heading dari catatan bersama berisi HTML atau link `javascript:`** → tampil sebagai teks/`href="#"` di kanvas, outline, dan ringkasan; tidak ada skrip yang jalan. Tes: Task A5.
2. **Catatan dengan blok kode atau `<details>` yang tidak ditutup**, lalu bagiannya dipindah → struktur catatan berubah tak terduga; harus ditolak (`unsafe`), catatan tidak ditulis. Tes: Task A4 (`verifyStructure`) + Task C6 (`planWrite`).
3. **Catatan CRLF atau tanpa baris akhir**, bagian terakhir dipindah ke atas → pemisah baris benar, tidak ada baris yang menyatu. Tes: Task A4.
4. **Catatan yang sama dipetakan offline di dua perangkat** → setelah sinkron hanya satu peta, tanpa duplikat lokal. Tes: Task C3.
5. **Catatan diketik di editor (perangkat yang sama) dalam jeda 800 ms sebuah edit peta** → edit peta ditolak sebagai stale, ketikan utuh. Tes: Task C2 + Task C6.

---

## Bagian A — PR 1: `notemap.js` (branch `claude/petakan-1-notemap`)

### Task A1: `parseNote`

**Files:**
- Create: `static/offline/notemap.js`
- Test: `tests/offline/notemap_parse.test.js`

**Interfaces:**
- Produces: modul UMD yang diekspor sebagai `root.TF.notemap` (browser) dan `module.exports` (node), pola sama dengan `static/offline/mindmapoutline.js:1-13`.
- Produces: `parseNote(markdown: string) → { intro: string, sections: Section[], eol: "\n" | "\r\n" }` dengan `Section = { sid: string, index: number, level: number, text: string, headingLine: string, body: string, parentSid: string|null, childSids: string[] }`. `sid = "s" + index`; `eol` = `"\r\n"` bila baris pertama yang berakhir pemisah memakai CRLF, selain itu `"\n"`.

- [ ] **Step 1: Write the failing tests**

```js
const NM = require("../../static/offline/notemap.js");
const texts = (p) => p.sections.map((s) => s.text);

test("intro, sections, bodies, parents", () => {
  const p = NM.parseNote("Pembuka.\n# A\nisi a\n## B\nisi b\n# C\n");
  assert.equal(p.intro, "Pembuka.\n");
  assert.deepEqual(p.sections.map((s) => s.sid), ["s0", "s1", "s2"]);
  assert.deepEqual(p.sections.map((s) => s.level), [1, 2, 1]);
  assert.deepEqual(texts(p), ["A", "B", "C"]);
  assert.equal(p.sections[0].headingLine, "# A\n");
  assert.deepEqual(p.sections.map((s) => s.body), ["isi a\n", "isi b\n", ""]);
  assert.deepEqual(p.sections.map((s) => s.parentSid), [null, "s0", null]);
  assert.deepEqual(p.sections[0].childSids, ["s1"]);
});
test("level skip attaches to nearest higher heading", () => {
  const p = NM.parseNote("## A\n#### B\n### C\n");
  assert.deepEqual(p.sections.map((s) => s.parentSid), [null, "s0", "s0"]);
});
test("ignores fences, quotes, details, empty, setext, #tag", () => {
  const md = "# Ya1\n```\n# kode\n```\n~~~\n## x\n~~~\n> ## kutip\n<details>\n<summary>T</summary>\n\n## dalam\n</details>\n## \n#tag\nJudul\n===\n````\n```\n# no\n````\n## Ya2\n";
  assert.deepEqual(texts(NM.parseNote(md)), ["Ya1", "Ya2"]);
});
test("closing hashes stripped from text, kept in headingLine", () => {
  const s = NM.parseNote("## Judul ##\n").sections[0];
  assert.equal(s.text, "Judul"); assert.equal(s.headingLine, "## Judul ##\n");
});
test("CRLF preserved", () => {
  const p = NM.parseNote("# A\r\nx\r\n");
  assert.equal(p.eol, "\r\n"); assert.equal(p.sections[0].headingLine, "# A\r\n"); assert.equal(p.sections[0].body, "x\r\n");
});
test("slices concatenate back to the input", () => {
  for (const md of ["", "teks saja", "# A", "# A\nx", "a\n\n# B\n\ny\n## C\n```\n# z\n```\n"]) {
    const p = NM.parseNote(md);
    assert.equal(p.intro + p.sections.map((s) => s.headingLine + s.body).join(""), md);
  }
});
```

- [ ] **Step 2: Run** `node --test tests/offline/notemap_parse.test.js` — Expected: FAIL (`Cannot find module`).
- [ ] **Step 3: Implement `parseNote(markdown)` in `static/offline/notemap.js`.** Pisah baris dengan pemisahnya (`md.match(/[^\n]*\n|[^\n]+$/g) || []`); state `fence = {ch, len} | null` dan `detailsDepth` (naik per `<details` di baris, turun per `</details>`); heading hanya bila `!fence && detailsDepth === 0` dan baris tidak cocok `^ {0,3}>`; parent lewat stack (pop selama `top.level >= level`). Saat mencocokkan pola (fence, details, heading) abaikan `\r` di akhir baris, tetapi simpan baris mentah di `headingLine`/`body`.
- [ ] **Step 4: Run** test yang sama — Expected: PASS.
- [ ] **Step 5: Commit** `git add static/offline/notemap.js tests/offline/notemap_parse.test.js && git commit -m "feat(notemap): parseNote — urai heading catatan jadi bagian"`

### Task A2: `summarizeSection`

**Files:**
- Modify: `static/offline/notemap.js`
- Test: `tests/offline/notemap_summary.test.js`

**Interfaces:**
- Produces: `summarizeSection(body: string) → { excerpt: string, items: string[], more: number, counts: { checkDone: number, checkTotal: number, images: number, tables: number } } | null` (null bila excerpt kosong, items kosong, dan semua counts 0).

- [ ] **Step 1: Write the failing tests**

```js
test("spec example", () => {
  const s = NM.summarizeSection("Fokus ke kanal organik dulu karena biaya iklan naik. Target tiga bulan pertama adalah 1.000 pengguna aktif.\n- [ ] Riset kata kunci\n- [x] Buat kalender konten\n- [ ] Kerja sama komunitas\n");
  assert.equal(s.excerpt, "Fokus ke kanal organik dulu karena biaya iklan naik.");
  assert.deepEqual(s.items, ["Riset kata kunci", "Buat kalender konten", "Kerja sama komunitas"]);
  assert.equal(s.more, 0);
  assert.deepEqual(s.counts, { checkDone: 1, checkTotal: 3, images: 0, tables: 0 });
});
test("decimal not split; short sentence merges within paragraph", () => {
  assert.equal(NM.summarizeSection("Target 1.000 pengguna aktif. Lainnya.").excerpt, "Target 1.000 pengguna aktif.");
  assert.equal(NM.summarizeSection("Oke. Ini kalimat kedua yang cukup panjang.").excerpt, "Oke. Ini kalimat kedua yang cukup panjang.");
});
test("excerpt truncates at a word boundary", () => {
  const ex = NM.summarizeSection(("kata ").repeat(60) + "akhir.").excerpt;
  assert.ok(ex.length <= 121 && ex.endsWith("…") && !ex.endsWith(" …"));
});
test("items capped at 3 with more, each ≤ 40 chars", () => {
  const s = NM.summarizeSection("- satu\n- dua\n- tiga\n- empat\n- " + "panjang ".repeat(10) + "\n");
  assert.deepEqual(s.items, ["satu", "dua", "tiga"]); assert.equal(s.more, 2);
  const long = NM.summarizeSection("- " + "panjang ".repeat(10) + "\n").items[0];
  assert.ok(long.length <= 41 && long.endsWith("…"));
});
test("cleaning: wikilinks, links, formatting, images, draw, tasklink, code, callout, toggle", () => {
  const s = NM.summarizeSection("Lihat [[Catatan Lain]] dan [situs](http://x) untuk **detail**. ![g](a.png)\n::draw[abc]{title=\"G\"}\n[tasklink:xyz]\n```js\nconst a = 1;\n```\n");
  assert.equal(s.excerpt, "Lihat Catatan Lain dan situs untuk detail.");
  assert.equal(s.counts.images, 2);
  assert.equal(NM.summarizeSection("> [!NOTE]\n> Penting sekali untuk dibaca.\n").excerpt, "Penting sekali untuk dibaca.");
  assert.equal(NM.summarizeSection("<details>\n<summary>Ringkas</summary>\n\nIsi toggle.\n</details>\n").excerpt, "Ringkas");
});
test("counts tables and nested checklists; empty → null", () => {
  const s = NM.summarizeSection("| a | b |\n|---|---|\n| 1 | 2 |\n- [x] a\n  - [ ] b\n");
  assert.deepEqual(s.counts, { checkDone: 1, checkTotal: 2, images: 0, tables: 1 });
  assert.equal(NM.summarizeSection("  \n\n"), null);
  assert.equal(NM.summarizeSection("```\nkode saja\n```\n"), null);
});
```

- [ ] **Step 2: Run** `node --test tests/offline/notemap_summary.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement `summarizeSection(body)`.** Urutan bersih: fence & `$$…$$` dibuang; tag HTML dibuang (teks di dalamnya tetap); `![..](..)` → dihitung lalu dibuang; `::draw[..]{..}` → dihitung sebagai gambar lalu dibuang; `[tasklink:..]` dibuang; `[[X]]` → `X`; `[t](u)` → `t`; penanda `**`, `__`, `~~`, `==`, `` ` ``, `*x*`, `_x_` dibuang; baris `> [!TYPE]` dibuang dan prefiks `>` dilepas. Paragraf = blok baris berurutan yang bukan butir daftar (`^\s*([-*+]|\d+\.)\s`), bukan baris tabel (`^\s*\|`), dipisah baris kosong. Kalimat dipecah di `[.!?]` yang diikuti spasi/akhir.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -am "feat(notemap): summarizeSection — ringkasan bagian berbasis aturan"` (tambah file tes dengan `git add`).

### Task A3: `buildMindData` + `pathKey`

**Files:**
- Modify: `static/offline/notemap.js`
- Test: `tests/offline/notemap_build.test.js`

**Interfaces:**
- Consumes: `parseNote`, `summarizeSection`.
- Produces: `LINKED_VIEW_STATE_DEFAULT = { linked: 1, direction: 2, justify: false, collapsed: [], summary: true }`.
- Produces: `pathKey(parsed, sid: string) → string` — teks heading dari anak root sampai node dipisah `"\u001f"`; teks kembar di bawah induk yang sama diberi akhiran `#2`, `#3`, … per segmen.
- Produces: `buildMindData(parsed, { title: string, viewState?: { collapsed?: string[] } }) → { nodeData }`. Root `{ id: "root", topic: title || "Tanpa judul", root: true, expanded: true, nm: { sid: null, level: 0, summary: summarizeSection(parsed.intro) }, children }`; node `{ id: sid, topic: text, expanded, children, nm: { sid, level, summary } }`.

- [ ] **Step 1: Write the failing tests**

```js
const build = (md, title, vs) => NM.buildMindData(NM.parseNote(md), { title, viewState: vs }).nodeData;
test("tree shape, root title and intro summary", () => {
  const t = build("Pembuka.\n# A\nisi\n## B\n# C\n", "Rencana");
  assert.equal(t.topic, "Rencana"); assert.equal(t.root, true);
  assert.equal(t.nm.summary.excerpt, "Pembuka.");
  assert.deepEqual(t.children.map((c) => c.id), ["s0", "s2"]);
  assert.deepEqual(t.children[0].children.map((c) => c.id), ["s1"]);
  assert.equal(t.children[0].children[0].nm.level, 2);
  assert.equal(t.children[0].nm.summary.excerpt, "isi");
  assert.equal(build("", "").topic, "Tanpa judul");
  assert.deepEqual(build("teks", "T").children, []);
});
test("initial collapse: ≤30 all open, >30 depth ≥2 collapsed", () => {
  const thirty = Array.from({ length: 30 }, (_, i) => `# H${i}\n`).join("");
  assert.ok(build(thirty, "T").children.every((c) => c.expanded === true));
  const big = Array.from({ length: 11 }, (_, i) => `# A${i}\n## B${i}\n### C${i}\n`).join(""); // 33 node
  const t = build(big, "T");
  assert.equal(t.children[0].expanded, true);
  assert.equal(t.children[0].children[0].expanded, false);
});
test("saved collapsed keys win; unknown keys open", () => {
  const md = "# A\n## B\n# C\n";
  const p = NM.parseNote(md);
  const t = NM.buildMindData(p, { title: "T", viewState: { collapsed: [NM.pathKey(p, "s0")] } }).nodeData;
  assert.equal(t.children[0].expanded, false); assert.equal(t.children[1].expanded, true);
});
test("pathKey disambiguates duplicate siblings", () => {
  const p = NM.parseNote("# A\n## X\n## X\n");
  assert.equal(NM.pathKey(p, "s1"), "A\u001fX"); assert.equal(NM.pathKey(p, "s2"), "A\u001fX#2");
});
test("performance: 2,000 lines / 200 headings under 150 ms", () => {
  const md = Array.from({ length: 200 }, (_, i) => `## H${i}\n` + "Kalimat isi bagian ini cukup panjang.\n".repeat(9)).join("");
  const t0 = performance.now(); build(md, "Besar"); assert.ok(performance.now() - t0 < 150);
});
```

- [ ] **Step 2: Run** `node --test tests/offline/notemap_build.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement `pathKey`, `buildMindData`, `LINKED_VIEW_STATE_DEFAULT`.** Bangun dari `parentSid`/`childSids`; `expanded` = `!collapsed.includes(pathKey)` bila `viewState.collapsed` adalah array, selain itu aturan lipatan awal (Global Constraints).
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(notemap): buildMindData + pathKey (lipatan awal, ringkasan per node)"`

### Task A4: `applyMindData` + `verifyStructure`

**Files:**
- Modify: `static/offline/notemap.js`
- Test: `tests/offline/notemap_apply.test.js`

**Interfaces:**
- Consumes: `parseNote`, `buildMindData`.
- Produces: `sanitizeTopic(text: string) → string` (baris baru → spasi, buang `^#+\s*`, trim).
- Produces: `applyMindData(markdown: string, parsed, edited: NodeData) → { ok: true, markdown: string, title: string, removed: { count: number, hasContent: boolean, firstTitle: string|null } } | { ok: false, code: "LEVEL_OVERFLOW" }`. `title` = `sanitizeTopic(edited.topic)` bila tidak kosong, selain itu judul lama (`edited` root topic sebelum edit tidak diketahui → pemanggil membandingkan sendiri); `removed.firstTitle` = teks bagian pertama yang hilang (urutan dokumen).
- Produces: `verifyStructure(markdown: string, edited: NodeData) → boolean` — `true` bila `parseNote(markdown).sections` sama panjang dengan jumlah node non-root `edited` (pre-order) dan teks/level berurutan sama dengan yang dipakai saat serialisasi.

- [ ] **Step 1: Write the failing tests**

```js
const P = (md) => NM.parseNote(md);
const T = (md, title = "T") => JSON.parse(JSON.stringify(NM.buildMindData(P(md), { title }).nodeData));
const run = (md, mutate, title = "T") => { const t = T(md, title); mutate(t); return NM.applyMindData(md, P(md), t); };
const BASE = "Intro\n# A\nisi a\n## B\nisi b\n# C\nisi c\n";
const FIXTURES = [ "", "teks", "# A", "# A\nx", BASE, "# A\r\nx\r\n## B\r\ny", "## A ##\n```\n# kode\n```\n> ## q\n",
  "<details>\n<summary>S</summary>\n\n## in\n</details>\n# Luar\n", "# A\n## \n#### Lompat\n", "# 😀 Émoji\n::draw[d1]{title=\"G\"}\n[tasklink:t1]\n| a |\n|---|\n$$\nx\n$$\n" ];

test("identity on fixtures", () => { for (const md of FIXTURES) { const r = run(md, () => {}); assert.equal(r.markdown, md); assert.equal(r.removed.count, 0); } });
test("identity on 200 generated documents", () => {
  let a = 42; const rnd = () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const LINES = [() => "#".repeat(1 + Math.floor(rnd() * 6)) + " Judul " + Math.floor(rnd() * 9), () => "Paragraf isi.", () => "- butir", () => "- [x] cek",
    () => "```\n# bukan heading\n```", () => "> kutip", () => "", () => "<details>\n<summary>S</summary>\n\n## dalam\n</details>"];
  for (let i = 0; i < 200; i++) {
    const md = Array.from({ length: 5 + Math.floor(rnd() * 36) }, () => pick(LINES)()).join(rnd() < 0.2 ? "\r\n" : "\n") + (rnd() < 0.5 ? "\n" : "");
    assert.equal(run(md, () => {}).markdown, md);
  }
});
test("rename + sanitize + root title", () => {
  assert.equal(run(BASE, (t) => { t.children[0].children[0].topic = "Beta"; }).markdown, BASE.replace("## B\n", "## Beta\n"));
  assert.equal(run(BASE, (t) => { t.children[0].children[0].topic = "## Baru\nbaris"; }).markdown, BASE.replace("## B\n", "## Baru baris\n"));
  assert.equal(run(BASE, (t) => { t.children[0].children[0].topic = "   "; }).markdown, BASE);
  const r = run(BASE, (t) => { t.topic = "Judul Baru"; }); assert.equal(r.title, "Judul Baru"); assert.equal(r.markdown, BASE);
});
test("add child / top-level / empty note levels", () => {
  const nn = (topic = "Node baru") => ({ id: "x" + Math.random(), topic, children: [] });
  assert.equal(run(BASE, (t) => t.children[0].children.push(nn())).markdown, "Intro\n# A\nisi a\n## B\nisi b\n\n## Node baru\n# C\nisi c\n");
  assert.equal(run(BASE, (t) => t.children[1].children.push(nn())).markdown, BASE + "\n## Node baru\n");
  assert.equal(run("## A\nx\n", (t) => t.children.push(nn())).markdown, "## A\nx\n\n## Node baru\n");
  assert.equal(run("", (t) => t.children.push(nn())).markdown, "# Node baru\n");
});
test("insert parent shifts subtree; overflow rejected", () => {
  const r = run(BASE, (t) => { const b = t.children[0].children[0]; t.children[0].children[0] = { id: "p", topic: "P", children: [b] }; });
  assert.equal(r.markdown, "Intro\n# A\nisi a\n\n## P\n### B\nisi b\n# C\nisi c\n");
  const deep = "# 1\n## 2\n### 3\n#### 4\n##### 5\n###### 6\n";
  const o = run(deep, (t) => { let n = t; while (n.children[0]) n = n.children[0]; n.children.push({ id: "z", topic: "7", children: [] }); });
  assert.deepEqual(o, { ok: false, code: "LEVEL_OVERFLOW" });
});
test("move section with body; move under another parent re-levels", () => {
  assert.equal(run(BASE, (t) => t.children.reverse()).markdown, "Intro\n# C\nisi c\n# A\nisi a\n## B\nisi b\n");
  const r = run(BASE, (t) => { const b = t.children[0].children.pop(); t.children[1].children.push(b); });
  assert.equal(r.markdown, "Intro\n# A\nisi a\n# C\nisi c\n## B\nisi b\n");
});
test("delete reports removed content; duplicate copies body; foreign sid is new", () => {
  const d = run(BASE, (t) => t.children.shift());
  assert.equal(d.markdown, "Intro\n# C\nisi c\n"); assert.deepEqual(d.removed, { count: 2, hasContent: true, firstTitle: "A" });
  assert.equal(run("# A\n# B\n", (t) => t.children.pop()).removed.hasContent, false);
  const c = run(BASE, (t) => t.children.push(JSON.parse(JSON.stringify(t.children[1]))));
  assert.equal(c.markdown, BASE + "# C\nisi c\n");
  const f = run(BASE, (t) => t.children.push({ id: "q", topic: "Asing", nm: { sid: "s99" }, children: [] }));
  assert.equal(f.markdown, BASE + "\n# Asing\n");
});
test("CRLF and missing final newline when moving the last section", () => {
  assert.equal(run("# A\r\nisi\r\n# B\r\nakhir", (t) => t.children.reverse()).markdown, "# B\r\nakhir\r\n# A\r\nisi\r\n");
});
test("verifyStructure detects an unclosed fence swallowing later sections", () => {
  const md = "# A\nisi\n# B\n```\nterbuka\n";
  const t = T(md); t.children.reverse(); const r = NM.applyMindData(md, P(md), t);
  assert.equal(NM.verifyStructure(r.markdown, t), false);
  const ok = T(BASE); assert.equal(NM.verifyStructure(BASE, ok), true);
});
```

- [ ] **Step 2: Run** `node --test tests/offline/notemap_apply.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement `sanitizeTopic`, `applyMindData`, `verifyStructure`.** Algoritma (tidak ditentukan oleh signature):

```text
known = map sid→section dari parsed; used = Set(); T0 = level terkecil anak root asli (default 1)
visit(P) untuk tiap anak n dari P, urut pohon (pre-order; root P punya origSid = null, level = 0, shift = 0):
  src    = known[n.nm?.sid]                          (undefined → node baru/asing)
  isCopy = src && used.has(src.sid);  bila src && !isCopy → used.add(src.sid)
  same   = src && src.parentSid === P.origSid        (P.origSid = sid asal P: section P, atau sumber salinan P)
  base   = level anak pertama P yang `same` (dihitung lebih dulu dalam satu lintasan atas anak P)
           ?? (P root ? T0 : P.level + 1)
  n.level  = same ? src.level + P.shift : base
  n.shift  = src ? n.level − src.level : 0;   n.origSid = src ? src.sid : null
  n.level > 6 → return { ok:false, code:"LEVEL_OVERFLOW" }
  heading = (src && !isCopy && n.level === src.level && teks === src.text) ? src.headingLine
            : "#".repeat(n.level) + " " + teks + eol
  body    = src ? src.body : ""                       (salinan memakai body sumbernya)
  sebelum heading: bila keluaran tidak kosong dan tidak berakhir eol → tambah eol;
                   bila node BARU (bukan salinan) dan keluaran tidak kosong dan tidak berakhir eol+eol → tambah eol
  lalu visit(n)
removed = section asli yang sid-nya tidak dipakai; hasContent = ada body.trim() tidak kosong
```

- [ ] **Step 4: Run** — Expected: PASS (termasuk 200 dokumen acak).
- [ ] **Step 5: Commit** `git commit -m "feat(notemap): applyMindData — susun ulang catatan dari peta + verifyStructure"`

### Task A5: helper UI — `plainHeadingText`, `locateHeading`, `matchHeading`, `renderTopicNoteInline`, `renderSummaryHtml`

**Files:**
- Modify: `static/offline/notemap.js`
- Modify: `static/offline/mindmapoutline.js:238-280` (ekstrak sanitasi `href` di `renderTopicMd` menjadi `sanitizeHrefs(html)` dan ekspor; `renderTopicMd` memanggilnya — perilaku tidak berubah)
- Test: `tests/offline/notemap_ui_helpers.test.js`, `tests/offline/mindmapoutline.test.js` (tambah satu tes)

**Interfaces:**
- Consumes: `markedLib` (pola `req("../vendor/marked.min.js", root.marked)`), `TF.mindmapoutline.sanitizeHrefs`.
- Produces: `plainHeadingText(text) → string`; `locateHeading(parsed, sid|null) → { index, text, occurrence } | null` (null untuk root); `matchHeading(list: Array<{text: string}>, target) → number` (−1 bila tidak ada); `renderTopicNoteInline(topic) → string` (HTML); `renderSummaryHtml(summary|null) → string` (HTML, `""` untuk null).

- [ ] **Step 1: Write the failing tests**

```js
test("plain text and locate with occurrences", () => {
  assert.equal(NM.plainHeadingText("**Bold** [[Note X]] `code` [t](u) ==s=="), "Bold Note X code t s");
  assert.deepEqual(NM.locateHeading(NM.parseNote("# A\n# A\n"), "s1"), { index: 1, text: "A", occurrence: 1 });
  assert.equal(NM.locateHeading(NM.parseNote("# A\n"), null), null);
});
test("matchHeading: index first, then occurrence, else -1", () => {
  const list = [{ text: "Intro" }, { text: "A" }, { text: "A" }];
  assert.equal(NM.matchHeading(list, { index: 1, text: "a", occurrence: 0 }), 1);
  assert.equal(NM.matchHeading(list, { index: 9, text: "A", occurrence: 1 }), 2);
  assert.equal(NM.matchHeading(list, { index: 0, text: "Tidak ada", occurrence: 0 }), -1);
});
test("renderTopicNoteInline uses note rules and stays safe", () => {
  assert.match(NM.renderTopicNoteInline("==sorot=="), /<mark>sorot<\/mark>/);
  assert.match(NM.renderTopicNoteInline("__tebal__"), /<strong>tebal<\/strong>/);
  const x = NM.renderTopicNoteInline("<img src=x onerror=alert(1)> [x](javascript:alert(1)) [[Catatan]]");
  assert.ok(!x.includes("<img")); assert.match(x, /href="#"/); assert.match(x, /Catatan/); assert.ok(!x.includes("[["));
});
test("renderSummaryHtml escapes and formats", () => {
  const h = NM.renderSummaryHtml({ excerpt: "<b>x</b>", items: ["a", "b"], more: 2, counts: { checkDone: 1, checkTotal: 3, images: 2, tables: 0 } });
  assert.ok(!h.includes("<b>")); assert.match(h, /• a • b \+2/); assert.match(h, /☑ 1\/3 · 🖼 2/); assert.ok(!h.includes("⊞"));
  assert.equal(NM.renderSummaryHtml(null), "");
});
```

Plus di `mindmapoutline.test.js`: `test("sanitizeHrefs blocks javascript: and keeps https", ...)` — `sanitizeHrefs('<a href="javascript:x">a</a><a href="https://e.id">b</a>')` berisi `href="#"` dan `href="https://e.id"`.

- [ ] **Step 2: Run** `node --test tests/offline/notemap_ui_helpers.test.js tests/offline/mindmapoutline.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement.** `renderTopicNoteInline`: escape `& < >` → `[[X]]` → `X` → `==x==` → `<mark>x</mark>` → `markedLib.parseInline(…, { gfm: true })` → `sanitizeHrefs`. `renderSummaryHtml`: `<div class="nm-sum">` dengan `nm-sum-ex`, `nm-sum-it` (`"• " + items.join(" • ") + (more ? " +" + more : "")`), `nm-sum-ct` (gabung " · "), semua teks di-escape. Normalisasi untuk `matchHeading`/`locateHeading`: `plainHeadingText(x).toLowerCase().replace(/\s+/g, " ").trim()`.
- [ ] **Step 4: Run** — Expected: PASS; `npm test` seluruhnya hijau (perilaku `renderTopicMd` tidak berubah).
- [ ] **Step 5: Commit** `git commit -m "feat(notemap): helper UI (locate/match heading, render topic & ringkasan aman)"`

### Task A6: PR 1

- [ ] **Step 1:** `npm test` → semua lulus; `python -m pytest tests/ -q` → lulus (tidak ada perubahan backend); `git diff main --stat` hanya `static/offline/notemap.js`, `static/offline/mindmapoutline.js`, tes, `.agents/`.
- [ ] **Step 2:** Perbarui `.agents/CURRENT_STATE.md` (bagian Petakan: "PR 1/3 draft") dan tambah entri `.agents/SESSION_LOG.md`. Tanpa bump SW (modul belum dimuat halaman).
- [ ] **Step 3:** `git push -u origin claude/petakan-1-notemap`; buat draft PR "feat(notemap): fondasi Petakan (PR 1/3)" berisi ringkasan + hasil tes.

---

## Bagian B — PR 2: backend (branch `claude/petakan-2-backend` dari `main`)

Semua tes Bagian B di `tests/test_petakan.py`, memakai pola `U`, `_mk_list`, `_mk_note`, `_mk_mindmap`, `_row`, `_exec` dari `tests/test_sync_audit_server.py:17-96` (salin helper yang dipakai ke file baru; impor `db`, `register_user` dari `conftest`, plus `json`, `sqlite3`, `pytest`, `webapp`).

### Task B1: migrasi kolom + index

**Files:**
- Modify: `webapp.py` (setelah blok migrasi `mindmaps.last_edited_by`, sekitar baris 638-646), `schema-db.md` (tabel `mindmaps`)
- Test: `tests/test_petakan.py`

**Interfaces:**
- Produces: kolom `mindmaps.source_note_id`, index `ux_mindmaps_source_note`.

- [ ] **Step 1: Write the failing test**

```python
def test_migration_adds_source_note_id_and_unique_index():
    webapp.migrate_db(); webapp.migrate_db()  # idempoten
    conn = db()
    cols = [r["name"] for r in conn.execute("PRAGMA table_info(mindmaps)")]
    assert "source_note_id" in cols
    idx = {r["name"]: r["unique"] for r in conn.execute("PRAGMA index_list(mindmaps)")}
    assert idx.get("ux_mindmaps_source_note") == 1
    conn.execute("INSERT INTO mindmaps (user_id,title,created_at,updated_at,source_note_id) VALUES (1,'a','x','x',424242)")
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO mindmaps (user_id,title,created_at,updated_at,source_note_id) VALUES (1,'b','x','x',424242)")
    conn.rollback(); conn.close()
```

- [ ] **Step 2: Run** `python -m pytest tests/test_petakan.py -q` — Expected: FAIL.
- [ ] **Step 3: Implement** blok migrasi dengan pola `PRAGMA table_info` yang sama: `ALTER TABLE mindmaps ADD COLUMN source_note_id INTEGER DEFAULT NULL` lalu `CREATE UNIQUE INDEX IF NOT EXISTS ux_mindmaps_source_note ON mindmaps(source_note_id) WHERE source_note_id IS NOT NULL`. Dokumentasikan di `schema-db.md`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(petakan): kolom mindmaps.source_note_id + index unik"`

### Task B2: `POST /api/mindmaps` untuk peta tertaut

**Files:**
- Modify: `webapp.py` — `MindmapCreate` (~1117) tambah `source_note_id: Optional[int] = None`; konstanta `LINKED_VIEW_STATE_DEFAULT = '{"linked":1,"direction":2,"justify":false,"collapsed":[],"summary":true}'` di dekat `_mindmap_enrich` (~4418); cabang baru di awal `create_mindmap` (~7256)
- Test: `tests/test_petakan.py`

**Interfaces:**
- Consumes: `_note_access_clause(uid)` (~4393).
- Produces: `POST /api/mindmaps {source_note_id}` → baris peta tertaut (lihat spec §6.2).

- [ ] **Step 1: Write the failing tests**

```python
def test_create_linked_map_uses_note_owner_list_and_title(client):
    o, m = U(client), U(client); lid = _mk_list(o, m)
    n = _mk_note(o, title="Rencana", content="# A\n", list_id=lid)
    r = m.post("/api/mindmaps", json={"title": "x", "data_json": '{"nodeData":{}}', "source_note_id": n["id"]})
    assert r.status_code == 200, r.text
    mm = r.json()
    assert (mm["user_id"], mm["list_id"], mm["title"], mm["source_note_id"]) == (o.id, lid, "Rencana", n["id"])
    assert json.loads(mm["data_json"]) == {"linked": 1, "direction": 2, "justify": False, "collapsed": [], "summary": True}

def test_create_linked_map_idempotent_per_note(client):
    o = U(client); n = _mk_note(o)
    a = o.post("/api/mindmaps", json={"title": "x", "source_note_id": n["id"], "client_id": "c1"}).json()
    b = o.post("/api/mindmaps", json={"title": "y", "source_note_id": n["id"], "client_id": "c2"}).json()
    assert a["id"] == b["id"]
    assert _row("SELECT COUNT(*) c FROM mindmaps WHERE source_note_id = ?", n["id"])["c"] == 1

def test_create_linked_map_inaccessible_note_404(client):
    o, s = U(client), U(client); n = _mk_note(o)
    assert s.post("/api/mindmaps", json={"title": "x", "source_note_id": n["id"]}).status_code == 404
    assert o.post("/api/mindmaps", json={"title": "x", "source_note_id": 99999999}).status_code == 404
```

- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** cabang `if req.source_note_id is not None:` dalam satu `with get_db() as conn:` — note = `SELECT id, user_id, list_id, title FROM scratchpad_notes WHERE id = ? AND {note_ac}`; tidak ada → `HTTPException(404, "Catatan tidak ditemukan")`; peta dengan `source_note_id` itu sudah ada → kembalikan `_mindmap_enrich(dict(row), conn)`; selain itu INSERT (`user_id = note.user_id`, `title = note.title or "Tanpa judul"`, `data_json = LINKED_VIEW_STATE_DEFAULT`, `list_id = note.list_id`, `client_id = req.client_id`, `last_edited_by = uid`, `source_note_id`); `sqlite3.IntegrityError` → kembalikan baris yang ada. Jalur non-tertaut tidak berubah.
- [ ] **Step 4: Run** — Expected: PASS; `tests/test_mindmaps.py` & `tests/test_sync_audit_server.py -k mindmap` tetap lulus.
- [ ] **Step 5: Commit** `git commit -m "feat(petakan): POST /api/mindmaps source_note_id (idempoten, ikut catatan)"`

### Task B3: penyaringan daftar `?linked=1`

**Files:**
- Modify: `webapp.py` — `list_mindmaps` (~7044) dan `get_list_mindmaps` (~7243): parameter `linked: int = 0`, kolom `source_note_id` di SELECT, `AND source_note_id IS NULL` bila `linked != 1`
- Test: `tests/test_petakan.py`

- [ ] **Step 1: Write the failing tests**

```python
def test_lists_hide_linked_without_flag(client):
    o = U(client); lid = _mk_list(o); n = _mk_note(o, list_id=lid)
    normal = _mk_mindmap(o, list_id=lid); linked = o.post("/api/mindmaps", json={"title": "x", "source_note_id": n["id"]}).json()
    ids = lambda r: {x["id"] for x in r.json()}
    assert normal["id"] in ids(o.get("/api/mindmaps")) and linked["id"] not in ids(o.get("/api/mindmaps"))
    both = o.get("/api/mindmaps?linked=1").json()
    assert {normal["id"], linked["id"]} <= {x["id"] for x in both}
    assert next(x for x in both if x["id"] == linked["id"])["source_note_id"] == n["id"]
    assert linked["id"] not in ids(o.get(f"/api/lists/{lid}/mindmaps"))
    assert linked["id"] in ids(o.get(f"/api/lists/{lid}/mindmaps?linked=1"))
    assert o.get(f"/api/mindmaps/{linked['id']}").json()["source_note_id"] == n["id"]
```

- [ ] **Step 2–4:** Run (FAIL) → implement → run (PASS).
- [ ] **Step 5: Commit** `git commit -m "feat(petakan): daftar mindmap menyaring peta tertaut kecuali ?linked=1"`

### Task B4: aturan PUT dan share untuk peta tertaut

**Files:**
- Modify: `webapp.py` — `update_mindmap` (~7302), `share_mindmap` (~7214)
- Test: `tests/test_petakan.py`

- [ ] **Step 1: Write the failing tests**

```python
def _linked(o, **note_kw):
    n = _mk_note(o, title="Sumber", **note_kw)
    return n, o.post("/api/mindmaps", json={"title": "x", "source_note_id": n["id"]}).json()

def test_put_linked_rejects_tree_and_ignores_title_base_rev(client):
    o = U(client); n, mm = _linked(o)
    r = o.put(f"/api/mindmaps/{mm['id']}", json={"data_json": '{"nodeData":{"id":"root"}}'})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "LINKED_TREE_REJECTED"
    vs = '{"linked":1,"direction":3,"justify":true,"collapsed":["A"],"summary":false}'
    r = o.put(f"/api/mindmaps/{mm['id']}", json={"title": "Lain", "data_json": vs, "base_rev": "basi"})
    assert r.status_code == 200 and r.json()["title"] == "Sumber" and r.json()["data_json"] == vs

def test_share_linked_409_and_normal_put_still_checks_base_rev(client):
    o = U(client); lid = _mk_list(o); n, mm = _linked(o)
    r = o.patch(f"/api/mindmaps/{mm['id']}/share", json={"list_id": lid})
    assert r.status_code == 409 and "Peta tertaut mengikuti catatan" in r.text
    normal = _mk_mindmap(o)
    assert o.put(f"/api/mindmaps/{normal['id']}", json={"data_json": "{}", "base_rev": "basi"}).status_code == 409
```

- [ ] **Step 2–4:** Run (FAIL) → implement (`row["source_note_id"] is not None` → tolak bila `req.data_json` berisi kunci `nodeData` hasil `json.loads`; lewati `_check_base_rev`; `new_title = row["title"]`; share → `HTTPException(409, "Peta tertaut mengikuti catatan")` setelah cek keberadaan) → run (PASS).
- [ ] **Step 5: Commit** `git commit -m "feat(petakan): PUT/share untuk peta tertaut"`

### Task B5: penyamaan dari catatan + hapus permanen

**Files:**
- Modify: `webapp.py` — helper baru `_sync_linked_mindmap(conn, note_id: int) -> None` dan `_delete_linked_mindmaps(conn, note_ids: list[int]) -> None` (di dekat `_mindmap_enrich`, ~4418); panggil `_sync_linked_mindmap` setelah tulis di `create_scratchpad` (~5444), `update_scratchpad` (~5640), `share_scratchpad` (~5727), restore (~4678); panggil `_delete_linked_mindmaps` di `_purge_expired_trashed_notes` (~4621, kumpulkan `note_id` yang kedaluwarsa sebelum DELETE), `purge_trashed_note` (~4762), `empty_trashed_notes` (~4770, kumpulkan `note_id` milik user sebelum DELETE)
- Test: `tests/test_petakan.py`

**Interfaces:**
- Produces: `_sync_linked_mindmap` — `UPDATE mindmaps SET list_id=?, title=?, user_id=?, updated_at=? WHERE source_note_id=? AND (list_id IS NOT ? OR title IS NOT ? OR user_id IS NOT ?)` dengan nilai dari catatan; `updated_at` hanya berubah bila ada baris yang berubah.

- [ ] **Step 1: Write the failing tests**

```python
def test_share_unshare_rename_sync_and_noop(client):
    o = U(client); lid = _mk_list(o); n, mm = _linked(o)
    before = _row("SELECT updated_at FROM mindmaps WHERE id=?", mm["id"])["updated_at"]
    o.put(f"/api/scratchpad/{n['id']}", json={"title": "Sumber", "content": "isi baru"})
    assert _row("SELECT updated_at FROM mindmaps WHERE id=?", mm["id"])["updated_at"] == before
    o.patch(f"/api/scratchpad/{n['id']}/share", json={"list_id": lid})
    assert _row("SELECT list_id FROM mindmaps WHERE id=?", mm["id"])["list_id"] == lid
    o.patch(f"/api/scratchpad/{n['id']}/share", json={"list_id": None})
    assert _row("SELECT list_id FROM mindmaps WHERE id=?", mm["id"])["list_id"] is None
    o.put(f"/api/scratchpad/{n['id']}", json={"title": "Baru", "content": "isi baru"})
    assert _row("SELECT title FROM mindmaps WHERE id=?", mm["id"])["title"] == "Baru"

def test_trash_keeps_map_restore_and_purges_delete_it(client):
    o = U(client); n, mm = _linked(o)
    o.delete(f"/api/scratchpad/{n['id']}")
    assert _row("SELECT source_note_id FROM mindmaps WHERE id=?", mm["id"])["source_note_id"] == n["id"]
    assert o.post(f"/api/scratchpad/trash/{n['id']}/restore").status_code == 200
    o.delete(f"/api/scratchpad/{n['id']}"); o.delete(f"/api/scratchpad/trash/{n['id']}")
    assert _row("SELECT id FROM mindmaps WHERE id=?", mm["id"]) is None
    n2, mm2 = _linked(o); o.delete(f"/api/scratchpad/{n2['id']}"); o.delete("/api/scratchpad/trash")
    assert _row("SELECT id FROM mindmaps WHERE id=?", mm2["id"]) is None
    n3, mm3 = _linked(o); o.delete(f"/api/scratchpad/{n3['id']}")
    _exec("UPDATE trashed_notes SET deleted_at='2000-01-01T00:00:00+07:00' WHERE note_id=?", n3["id"])
    conn = db(); webapp._purge_expired_trashed_notes(conn); conn.commit(); conn.close()
    assert _row("SELECT id FROM mindmaps WHERE id=?", mm3["id"]) is None
```

- [ ] **Step 2–4:** Run (FAIL) → implement → run (PASS).
- [ ] **Step 5: Commit** `git commit -m "feat(petakan): peta tertaut mengikuti list_id/judul catatan; hapus saat purge"`

### Task B6: PR 2

- [ ] **Step 1:** `python -m pytest tests/ -q` → semua lulus; `python -m py_compile webapp.py`.
- [ ] **Step 2:** `.agents/` diperbarui (catat: deploy wajib `sudo systemctl restart taskflow-web`; kompatibel mundur karena klien lama tidak mengirim `source_note_id` dan daftar menyaring peta tertaut).
- [ ] **Step 3:** Push + draft PR "feat(petakan): backend peta tertaut (PR 2/3)".

---

## Bagian C — PR 3: frontend + offline (branch `claude/petakan-3-ui` dari `main` setelah PR 1 & 2)

### Task C1: repo & route lokal untuk peta tertaut

**Files:**
- Modify: `static/offline/mindmaprepo.js` (`createMindmap`, `recordFromServer`, `updateMindmap`, ekspor)
- Modify: `static/offline/mindmaproutes.js` (`meta`, rute POST)
- Test: `tests/offline/mindmaprepo_linked.test.js`

**Interfaces:**
- Consumes: `TF.noterepo.findNoteRaw(idOrCid)` (cid atau id server), `TF.notemap.LINKED_VIEW_STATE_DEFAULT` — keduanya dibaca malas di dalam fungsi (`req("./noterepo.js", root.TF && root.TF.noterepo)` saat dipanggil), seperti `syncpush.js` membaca `noterepo`.
- Produces: `isLinked(rec) → boolean` (`rec.source_note_cid != null || rec.source_note_id != null`).
- Produces: `createMindmap(input, opts)` menerima `input.source_note_ref` (cid atau id server catatan). Bila ada: peta lokal tidak terhapus dengan `source_note_cid` sama → kembalikan itu (tanpa op baru); catatan tidak ada/terhapus → reject `Error("Note not found")`; selain itu record baru `{ source_note_cid: note.cid, source_note_id: note.server_id ?? null, title: note.title || "Tanpa judul", list_id: note.list_id ?? null, user_id: note.user_id ?? curUid(), data_json: JSON.stringify(LINKED_VIEW_STATE_DEFAULT) }` + op create.
- Produces: `recordFromServer(s, cid)` menyalin `source_note_id`; `updateMindmap` mengabaikan `if_updated_at` untuk record tertaut (tanpa salinan konflik).
- Produces: `meta(rec)` di route menambah `source_note_id`, `source_note_cid`; POST route meneruskan `source_note_ref`.

- [ ] **Step 1: Write the failing tests** — tulis record catatan `{cid:"n1", server_id:7, title:"Rencana", list_id:3, user_id:5, content:"# A\n", deleted:false}` ke store `scratchpad_notes`, lalu:

```js
test("createMindmap from note ref copies note fields, one op; second call reuses", async () => {
  const a = await createMindmap({ source_note_ref: "n1" });
  assert.deepEqual([a.source_note_cid, a.source_note_id, a.title, a.list_id, a.user_id], ["n1", 7, "Rencana", 3, 5]);
  assert.deepEqual(JSON.parse(a.data_json), { linked: 1, direction: 2, justify: false, collapsed: [], summary: true });
  const b = await createMindmap({ source_note_ref: 7 });
  assert.equal(b.cid, a.cid); assert.equal((await outboxAll()).length, 1);
  await assert.rejects(createMindmap({ source_note_ref: "tidak-ada" }), /Note not found/);
});
test("linked updateMindmap ignores stale if_updated_at (no conflict copy)", async () => {
  const a = await createMindmap({ source_note_ref: "n1" });
  const out = await updateMindmap(a.cid, { data_json: '{"linked":1,"direction":3}', if_updated_at: "basi" });
  assert.equal(out.conflict_copy, undefined); assert.equal((await getRaw(a.cid)).data_json, '{"linked":1,"direction":3}');
});
test("routes expose source_note fields and accept source_note_ref", async () => {
  const r = buildTaskRouter();
  const created = await r.dispatch("POST", "/api/mindmaps", { source_note_ref: 7 });
  const list = await r.dispatch("GET", "/api/mindmaps");
  const row = list.find((m) => m.id === created.id);
  assert.equal(row.source_note_cid, "n1"); assert.equal(row.source_note_id, 7);
});
```

- [ ] **Step 2–4:** Run (FAIL) → implement → run (PASS); `node --test tests/offline/mindmap*.test.js` tetap hijau.
- [ ] **Step 5: Commit** `git commit -m "feat(petakan): repo & route lokal peta tertaut"`

### Task C2: `noterepo.applyMapEdit`

**Files:**
- Modify: `static/offline/noterepo.js` (fungsi baru + ekspor)
- Test: `tests/offline/noterepo_mapedit.test.js`

**Interfaces:**
- Produces: `applyMapEdit(cid: string, baseContent: string, next: { markdown: string, title: string }, opts?: { now?: string }) → Promise<{ ok: true, note } | { stale: true, note } | { missing: true }>`. Hitung `resolveLinkedTo(next.markdown)` sebelum transaksi; di dalam `TFdb.mutate("scratchpad_notes", cid, …)`: hilang/terhapus → missing; `cur.content !== baseContent` → stale tanpa tulis; selain itu tulis `content`, `title`, `linked_to_cids`, `updated_at`, `dirty: 1`, `rev + 1`, `last_edited_by = curUid()`, `last_editor_* = null`. Setelah ok: `coalesceUpdateOp(cid, {})` lalu `emitWindowEvent("noteSaved", { source: "notemap", cids: [cid] })`.

- [ ] **Step 1: Write the failing tests**

```js
test("ok writes, coalesces one update op, recomputes wikilinks, emits noteSaved", async () => {
  // store: note n1 {content:"# A\n"} + note n2 {title:"Lain"}; globalThis.window = { dispatchEvent: (e) => events.push(e) }; globalThis.CustomEvent = class { constructor(t, i) { this.type = t; this.detail = i.detail; } };
  const r = await applyMapEdit("n1", "# A\n", { markdown: "# A\n[[Lain]]\n", title: "Baru" });
  assert.ok(r.ok); const n = await getNoteRaw("n1");
  assert.deepEqual([n.content, n.title, n.dirty], ["# A\n[[Lain]]\n", "Baru", 1]);
  assert.deepEqual(JSON.parse(n.linked_to_cids), ["n2"]);
  assert.equal((await outboxAll()).filter((o) => o.cid === "n1" && o.op === "update").length, 1);
  assert.equal(events[0].type, "noteSaved"); assert.equal(events[0].detail.source, "notemap");
});
test("stale content is not overwritten", async () => {
  const r = await applyMapEdit("n1", "# versi lama\n", { markdown: "# X\n", title: "X" });
  assert.ok(r.stale); assert.equal((await getNoteRaw("n1")).content, "# A\n"); assert.equal((await outboxAll()).length, 0);
});
test("missing note", async () => { assert.deepEqual(await applyMapEdit("zz", "", { markdown: "", title: "" }), { missing: true }); });
```

- [ ] **Step 2–4:** Run (FAIL) → implement → run (PASS).
- [ ] **Step 5: Commit** `git commit -m "feat(petakan): noterepo.applyMapEdit (CAS atas isi terbaru)"`

### Task C3: push peta tertaut

**Files:**
- Modify: `static/offline/syncpush.js` — `mindmapToCreatePayload`/`mindmapToUpdatePayload` (~132-146), `opMindmapCreate` (~1055), `processOp` (teruskan `pending` ke `opMindmapCreate`)
- Test: `tests/offline/mindmapsync_linked_push.test.js`

**Interfaces:**
- Consumes: `TF.mindmaprepo.isLinked`.
- Produces: payload create tertaut `{ title, data_json, list_id, client_id, source_note_id }`; payload update tertaut tanpa `base_rev`.
- Produces: `opMindmapCreate(op, transport, result, pending)`: untuk record tertaut, catatan (`scratchpad_notes[rec.source_note_cid]`) hilang/terhapus → hapus record peta lokal + buang op; id server catatan (`note.server_id ?? TFidmap.serverIdOf(note.cid)`) belum ada → `return` (op ditahan); selain itu POST dengan `source_note_id`. Respons `id` yang sudah dipetakan ke cid lain (`TFidmap.cidOf("mindmap", id)` ≠ `op.cid`) → gabung: record yang sudah terpetakan dipertahankan, `data_json` diambil dari record dengan `updated_at` lebih baru (dirty bila berubah), record `op.cid` dihapus, op dibuang.

- [ ] **Step 1: Write the failing tests** (pola `fakeTransport` & `mm()` dari `tests/offline/mindmapsync_push.test.js:13-38`):

```js
test("linked create is held until the note has a server id", async () => { /* note n1 server_id null; pushOutbox → transport.calls.length === 0; op masih ada */ });
test("linked create sends source_note_id once the note is pushed", async () => { /* note n1 server_id 7 → POST body.source_note_id === 7 */ });
test("note deleted → op dropped and local map removed", async () => { /* note n1 deleted:true → op hilang, getMM(cid) undefined */ });
test("server returns an existing linked map already pulled locally → merged", async () => {
  await put("scratchpad_notes", [{ cid: "n1", server_id: 7, title: "N", content: "", deleted: false }]);
  await put("mindmaps", [mm({ cid: "a", server_id: 50, source_note_cid: "n1", source_note_id: 7, dirty: 0, updated_at: "2026-10-18T01:00:00Z", data_json: '{"linked":1,"direction":2}' }),
                         mm({ cid: "b", source_note_cid: "n1", source_note_id: 7, dirty: 1, updated_at: "2026-10-18T02:00:00Z", data_json: '{"linked":1,"direction":3}' })]);
  await mapPut("mindmap", 50, "a");
  await outboxAdd({ op: "create", entity_type: "mindmap", cid: "b", payload: { cid: "b" } });
  const t = fakeTransport(() => ({ status: 200, data: { id: 50, updated_at: "2026-10-18T03:00:00Z", source_note_id: 7 } }));
  await pushOutbox(t);
  assert.equal(await getMM("b"), undefined);
  assert.equal((await getMM("a")).data_json, '{"linked":1,"direction":3}'); // view-state yang lebih baru dipakai
  assert.equal(await cidOf("mindmap", 50), "a");
  assert.equal((await outboxAll()).filter((o) => o.cid === "b").length, 0);
});
test("linked update payload omits base_rev", () => { /* mindmapToUpdatePayload({..., source_note_cid:"n1", base_rev:"x"}).base_rev === undefined */ });
```

- [ ] **Step 2–4:** Run (FAIL) → implement → run (PASS); `node --test tests/offline/mindmapsync_*.test.js` hijau.
- [ ] **Step 5: Commit** `git commit -m "feat(petakan): push peta tertaut (tahan sampai catatan ter-push, gabung duplikat)"`

### Task C4: pull peta tertaut

**Files:**
- Modify: `static/offline/syncpull.js` — `pullMindmapsAndReconcile` (~962: URL `/api/mindmaps?linked=1`), `writeMindmapFull` (~847: isi `source_note_cid` dari `TFidmap.cidOf("note", fullRow.source_note_id)`), cabang edit-vs-edit di `pullMindmaps` (~893: record tertaut → `result.skipped++`, tanpa `adoptServerWithConflictCopy`)
- Modify: `static/offline/mindmaproutes.js` — `GET /api/lists/:id/mindmaps` menyertakan `source_note_id`
- Test: `tests/offline/mindmapsync_linked_pull.test.js`

- [ ] **Step 1: Write the failing tests**

```js
test("pull uses ?linked=1 and resolves source_note_cid", async () => {
  // mapPut("note", 7, "n1"); rawFetch mencatat URL; list [{id: 50, source_note_id: 7, ...}], detail sama + data_json view-state
  await pullMindmapsAndReconcile(rawFetch);
  assert.ok(urls.includes("/api/mindmaps?linked=1"));
  assert.equal((await getAll("mindmaps"))[0].source_note_cid, "n1");
});
test("dirty linked map with pending op never becomes a conflict copy", async () => {
  // local {cid:"a", server_id:50, source_note_cid:"n1", dirty:1, base_rev:"r1"} + op update; server updated_at "r2"
  const res = await pullMindmaps(list, fetchOne);
  assert.equal(res.conflictCopies, 0); assert.equal((await getAll("mindmaps")).length, 1);
});
```

- [ ] **Step 2–4:** Run (FAIL) → implement → run (PASS); `node --test tests/offline/mindmapsync_*pull*.test.js tests/offline/syncconflict_mindmaps.test.js` hijau.
- [ ] **Step 5: Commit** `git commit -m "feat(petakan): pull peta tertaut"`

### Task C5: mode tertaut di iframe kanvas

**Files:**
- Modify: `static/offline/mindmapops.js` (helper murni + ekspor)
- Modify: `static/vendor/mind-elixir/index.html` (script `notemap.js`, `initMind`, handler `message`, panel Ops, CSS ringkasan)
- Test: `tests/offline/mindmap_ops.test.js` (tambah tes)

**Interfaces:**
- Produces (mindmapops): `engineOptions(linked: boolean, handlers: { openModal: Function, openPage: Function }) → object` — tertaut: `{ allowUndo: false, newTopicName: "Node baru", contextMenu: { focus: true, link: false, extend: [ { name: "📄 Buka di catatan", key: "Ctrl+Click", onclick: handlers.openModal }, { name: "↗ Buka di halaman Notes", onclick: handlers.openPage } ] } }`; biasa: `{ contextMenu: true }`.
- Produces: `isOpenNoteClick(evt) → boolean` (`evt.button === 0 && (evt.ctrlKey || evt.metaKey)`).
- Produces: `LINKED_HIDDEN_SELECTORS` = `["#ntb-summary", "#ntb-link", "#ntb-linkbi", '.side-tab[data-tab="links"]', ...["underline", "highlight", "heading", "table", "ul", "ol", "hr", "align"].map((a) => `#fmt-panel [data-act="${a}"]`)]`.
- Protokol iframe: `load` membawa `linked`, `showSummary`; pesan baru `setSummary { show }` dan `remapSids { pairs: Array<[nodeId, sid]> }` (iframe menyetel `nodeObj.nm = Object.assign(nodeObj.nm || {}, { sid })` untuk tiap pasangan, tanpa render ulang); iframe mengirim `openNoteAt { sid, target: "modal" | "page" }`, `undoRequest`, `redoRequest`.

- [ ] **Step 1: Write the failing tests**

```js
test("engineOptions linked vs normal", () => {
  const o = MMops.engineOptions(true, { openModal: () => "m", openPage: () => "p" });
  assert.equal(o.allowUndo, false); assert.equal(o.newTopicName, "Node baru");
  assert.equal(o.contextMenu.link, false);
  assert.deepEqual(o.contextMenu.extend.map((e) => e.name), ["📄 Buka di catatan", "↗ Buka di halaman Notes"]);
  assert.deepEqual(MMops.engineOptions(false, {}), { contextMenu: true });
});
test("isOpenNoteClick", () => {
  assert.equal(MMops.isOpenNoteClick({ button: 0, ctrlKey: true }), true);
  assert.equal(MMops.isOpenNoteClick({ button: 0, metaKey: true }), true);
  assert.equal(MMops.isOpenNoteClick({ button: 0 }), false);
});
test("hidden selectors cover arrows, summary, links tab and block formats", () => {
  for (const s of ["#ntb-link", "#ntb-summary", '.side-tab[data-tab="links"]', '#fmt-panel [data-act="table"]']) assert.ok(MMops.LINKED_HIDDEN_SELECTORS.includes(s));
});
```

- [ ] **Step 2: Run** `node --test tests/offline/mindmap_ops.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement helper, lalu iframe.** Di iframe: tambah `<script src="/static/offline/notemap.js?v=1"></script>` setelah `mindmapoutline.js`; `initMind(data, linked)` membuat mesin sekali dengan `Object.assign(opsiLama, MMops.engineOptions(linked, …))` dan, bila tertaut, `markdown: (t, n) => TF.notemap.renderTopicNoteInline(t) + (showSummary ? TF.notemap.renderSummaryHtml(n && n.nm && n.nm.summary) : "")`; listener `click` fase capture di `#map`: `MMops.resolveTopicTarget(e.target)` + `isOpenNoteClick` → `preventDefault`, kirim `openNoteAt { sid: nodeObj.nm ? nodeObj.nm.sid : null, target: "modal" }`; tombol Ops baru `#ntb-opennote` ("📄 Buka di catatan", paling atas, tersembunyi kecuali tertaut); sembunyikan `LINKED_HIDDEN_SELECTORS` saat tertaut; keydown tertaut: Ctrl+Z → `undoRequest`, Ctrl+Shift+Z/Ctrl+Y → `redoRequest`; `setSummary` → set flag lalu `mind.refresh(mind.getData())`; `remapSids` → cari node lewat `mind.findEle(id)?.nodeObj` dan setel `nm.sid`. CSS: `.nm-sum{font-size:11px;line-height:1.35;margin-top:4px;max-width:260px;opacity:.75}`, `.nm-sum-ex{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}`, `.nm-sum-it{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`, `.nm-sum-ct{font-size:10px}` (tanpa border-left).
- [ ] **Step 4: Run** tes + `node temporary_files/check_inline_scripts.js static/vendor/mind-elixir/index.html` — Expected: PASS, skrip inline OK.
- [ ] **Step 5: Commit** `git commit -m "feat(petakan): mode tertaut di kanvas mind-elixir"`

### Task C6: sesi peta tertaut di `MindmapTabInstance`

**Files:**
- Create: `static/offline/notemapsession.js` (helper murni, `TF.notemapsession`)
- Modify: `static/index.html` — `MindmapTabInstance` (~9312-9832)
- Test: `tests/offline/notemapsession.test.js`, `tests/offline/petakan_tab_ui.test.js`

**Interfaces:**
- Consumes: `TF.notemap.{parseNote, buildMindData, applyMindData, verifyStructure, pathKey, locateHeading}`, `TF.noterepo.applyMapEdit`.
- Produces: `createSession({ noteCid, baseContent, title }) → Session` (`Session = { noteCid, baseContent, title, parsed, undo: [], redo: [] }`).
- Produces: `planWrite(session, edited) → { kind: "noop" } | { kind: "overflow" } | { kind: "unsafe" } | { kind: "write", next: { markdown, title }, removed }` (`unsafe` = `!verifyStructure(next.markdown, edited)`; `noop` = markdown dan judul sama dengan sesi).
- Produces: `commitWrite(session, next) → Session` (dorong `{ before: {markdown, title}, after: next }` ke `undo` maks 20, kosongkan `redo`, perbarui `baseContent/title/parsed`).
- Produces: `remapSids(edited) → Array<[nodeId, sid]>` (pre-order non-root: `["s0", "s1", …]`).
- Produces: `viewStateFrom(edited, parsed, prev) → { viewState, changed }` (`collapsed` = `pathKey` node `expanded === false`; `direction`, `justify` dari data; `summary` dari `prev`).
- Produces: `undoStep(session, currentContent) → { next } | { blocked: true }` dan `redoStep(...)` dengan aturan `top.after.markdown === currentContent`.

- [ ] **Step 1: Write the failing tests** (`notemapsession.test.js`)

```js
test("planWrite: noop, write, overflow, unsafe", () => {
  const s = NS.createSession({ noteCid: "n1", baseContent: "# A\nisi\n# B\n", title: "T" });
  const tree = () => JSON.parse(JSON.stringify(NM.buildMindData(s.parsed, { title: "T" }).nodeData));
  assert.deepEqual(NS.planWrite(s, tree()), { kind: "noop" });
  const t = tree(); t.children[1].topic = "B2";
  const w = NS.planWrite(s, t); assert.equal(w.kind, "write"); assert.equal(w.next.markdown, "# A\nisi\n# B2\n");
  const u = NS.createSession({ noteCid: "n1", baseContent: "# A\nisi\n# B\n```\nbuka\n", title: "T" });
  const ut = JSON.parse(JSON.stringify(NM.buildMindData(u.parsed, { title: "T" }).nodeData)); ut.children.reverse();
  assert.equal(NS.planWrite(u, ut).kind, "unsafe");
});
test("commitWrite + undo/redo with blocking", () => {
  let s = NS.createSession({ noteCid: "n1", baseContent: "# A\n", title: "T" });
  s = NS.commitWrite(s, { markdown: "# B\n", title: "T" });
  assert.deepEqual(NS.undoStep(s, "# B\n").next, { markdown: "# A\n", title: "T" });
  assert.deepEqual(NS.undoStep(s, "# diketik\n"), { blocked: true });
  for (let i = 0; i < 25; i++) s = NS.commitWrite(s, { markdown: `# ${i}\n`, title: "T" });
  assert.equal(s.undo.length, 20);
});
test("remapSids pre-order; viewStateFrom detects collapse change", () => {
  const s = NS.createSession({ noteCid: "n1", baseContent: "# A\n## B\n# C\n", title: "T" });
  const t = JSON.parse(JSON.stringify(NM.buildMindData(s.parsed, { title: "T" }).nodeData));
  assert.deepEqual(NS.remapSids(t).map((x) => x[1]), ["s0", "s1", "s2"]);
  t.children[0].expanded = false;
  const v = NS.viewStateFrom(t, s.parsed, { linked: 1, direction: 2, justify: false, collapsed: [], summary: true });
  assert.equal(v.changed, true); assert.deepEqual(v.viewState.collapsed, ["A"]);
});
```

UI test (`petakan_tab_ui.test.js`, gaya regex seperti `tests/offline/mindmap_tab_sync_ui.test.js`): `MindmapTabInstance` memuat `TF.notemapsession`, `TF.noterepo.applyMapEdit`, pesan `openNoteAt`, `undoRequest`, `redoRequest`, `remapSids`, dan string persis "Catatan baru saja berubah — peta dimuat ulang, ulangi perubahanmu", "Tidak bisa diurungkan: catatan sudah berubah", "Maksimal 6 tingkat heading", "Hapus bagian «", "📄 Tertaut ke: ", "Tersimpan ke catatan", "Catatan sumber ada di Sampah", "Catatan sumber tidak tersedia untukmu", "Catatan belum tersedia di perangkat ini — sambungkan internet", "Tambah node di sini atau heading di catatan".

- [ ] **Step 2: Run** `node --test tests/offline/notemapsession.test.js tests/offline/petakan_tab_ui.test.js` — Expected: FAIL.
- [ ] **Step 3: Implement `notemapsession.js`, lalu wiring tab** (perilaku dari spec §5.5 & §8.2):
  - `isLinked = tab.source_note_cid != null || tab.source_note_id != null`.
  - Muat: `api.get('/api/scratchpad/' + (tab.source_note_cid || tab.source_note_id))` → sesi + `buildMindData(parsed, { title, viewState })` + `direction`/`justify` dari view-state → `load { data, title, linked: true, showSummary }`. Gagal: catatan lokal tidak ada → online: cek `GET /api/scratchpad/trash` (ada `note_id` → "Catatan sumber ada di Sampah" + tombol ke Sampah, selain itu "Catatan sumber tidak tersedia untukmu"); offline → "Catatan belum tersedia di perangkat ini — sambungkan internet". Root tanpa anak → petunjuk "Tambah node di sini atau heading di catatan".
  - `change` (kanvas/outline) → jadwal 800 ms → `planWrite`: `overflow` → toast "Maksimal 6 tingkat heading" + muat ulang; `unsafe` → toast "Perubahan ini akan merusak struktur catatan (ada blok kode/toggle yang tidak ditutup) — ubah lewat catatan" + muat ulang; `write` dengan `removed.hasContent` → `window.confirm("Hapus bagian «" + removed.firstTitle + "» beserta isinya dari catatan?")`, batal → muat ulang; lalu `applyMapEdit(noteCid, session.baseContent, next)`: `stale` → toast "Catatan baru saja berubah — peta dimuat ulang, ulangi perubahanmu" + muat ulang; `ok` → `commitWrite`, kirim `remapSids` ke iframe (pesan `remapSids { pairs }`, iframe menyetel `nodeObj.nm = Object.assign(nodeObj.nm || {}, { sid })`) dan ke `outlineTree`, status "Tersimpan ke catatan".
  - View-state: `viewStateFrom` → bila `changed` → `api.put('/api/mindmaps/' + tab.id, { data_json: JSON.stringify(viewState) })` (tanpa `if_updated_at`), jeda 800 ms.
  - `noteSaved`: abaikan bila isi catatan === `session.baseContent`; selain itu muat ulang bila tidak ada simpan tertunda.
  - `undoRequest`/`redoRequest` + Ctrl+Z di outline → `undoStep/redoStep` → `applyMapEdit` → muat ulang; `blocked` → toast "Tidak bisa diurungkan: catatan sudah berubah".
  - Header tertaut: "📄 Tertaut ke: " + judul (klik → buka catatan dari atas), Share disembunyikan dan diganti badge workspace bila `tab.list_id`, Rename → `applyMapEdit(noteCid, baseContent, { markdown: baseContent, title: baru })`, Hapus hanya bila `tab.user_id === currentUserId`, tombol "Ringkasan" (flip `viewState.summary`, kirim `setSummary`, simpan view-state).
  - `openNoteAt { sid, target }`: `modal` → `setModalNote(note)` + `setModalBlockTarget(Object.assign({ kind: "heading" }, TF.notemap.locateHeading(session.parsed, sid)))` (sid null → `null`); `page` → `window.dispatchEvent(new CustomEvent("tf:open-note-at", { detail: { noteId, heading } }))`.
  - Placeholder "Catatan sumber tidak tersedia untukmu" menampilkan tombol "Hapus peta" bila `tab.user_id === currentUserId` (peta yang catatannya sudah dihapus permanen tapi belum tersapu pull).
- [ ] **Step 4: Run** tes + `node temporary_files/check_inline_scripts.js static/index.html` — Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat(petakan): sesi peta tertaut di tab mindmap"`

### Task C7: `MindmapOutline` mode tertaut

**Files:**
- Modify: `static/index.html` — `MindmapOutline` (~8683-9311) dan pemanggilnya di `MindmapTabInstance`
- Test: `tests/offline/petakan_tab_ui.test.js` (tambah asersi)

**Interfaces:**
- Produces: props baru `linked = false`, `showSummary = true`, `onOpenNoteAt = null` (`(sid, target) => void`), `onUndo = null`, `onRedo = null`.

- [ ] **Step 1: Write the failing test** — asersi regex: `function MindmapOutline({ … linked … onOpenNoteAt … })`, pemakaian `renderTopicNoteInline` dan `renderSummaryHtml` bila `linked`, item menu "📄 Buka di catatan" dan "↗ Buka di halaman Notes", item "🔗 Tambah link" dibungkus kondisi `!linked`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** Tertaut: topik dirender `TF.notemap.renderTopicNoteInline`; baris kedua `renderSummaryHtml(n.nm && n.nm.summary)` bila `showSummary`; Ctrl/Cmd+Click baris → `onOpenNoteAt(n.nm ? n.nm.sid : null, "modal")`; tombol ↗ saat hover; menu konteks dua item baru; chip/popover link dan "🔗 Tambah link" disembunyikan; Ctrl+Z/Ctrl+Shift+Z/Ctrl+Y memanggil `onUndo`/`onRedo` (bukan `undoRef`/`redoRef`). Peta biasa tidak berubah.
- [ ] **Step 4: Run** — Expected: PASS; inline check OK.
- [ ] **Step 5: Commit** `git commit -m "feat(petakan): outline untuk peta tertaut"`

### Task C8: buka catatan tepat di heading

**Files:**
- Modify: `static/index.html` — efek `initialBlockTarget` di `NoteModal` (~23120-23205); `NotesPage` (~26503) dan `NotePanel` (~24825) prop `initialHeading`; `App` (~30588) state `pendingNoteHeading` + listener `tf:open-note-at`; CSS `.nm-heading-flash`
- Test: `tests/offline/petakan_tab_ui.test.js` (tambah asersi)

**Interfaces:**
- Consumes: `TF.notemap.matchHeading(list, target)`; `target = { kind: "heading", index, text, occurrence }`.
- Produces: `NoteModal` menangani `initialBlockTarget.kind === "heading"` sebelum strategi lama: `const hs = extractDocHeadings(doc); const i = TF.notemap.matchHeading(hs, initialBlockTarget); targetPos = i >= 0 ? hs[i].pos + 1 : 1`, lalu elemen DOM heading diberi kelas `nm-heading-flash` selama 1500 ms.
- Produces: `NotePanel({ …, initialHeading = null })`: setelah render, `Array.from(container.querySelectorAll('[id^="note-h-"]')).map((el) => ({ text: el.textContent }))` → `matchHeading` → `scrollIntoView({ behavior: "smooth", block: "start" })` + kelas flash.
- Produces: App mendengar `tf:open-note-at` → `setPendingNoteId(noteId); setPendingNoteHeading(heading); setPage("notes")`; `NotesPage` menerima `initialHeading: pendingNoteHeading` dan `onInitialNoteConsumed` juga mengosongkan heading.

- [ ] **Step 1: Write the failing test** — asersi regex untuk `initialBlockTarget.kind === "heading"`, `matchHeading(`, `nm-heading-flash`, `addEventListener("tf:open-note-at"`, `initialHeading: pendingNoteHeading`.
- [ ] **Step 2–4:** Run (FAIL) → implement → run (PASS) + inline check.
- [ ] **Step 5: Commit** `git commit -m "feat(petakan): buka catatan di heading (editor & halaman Notes)"`

### Task C9: titik masuk

**Files:**
- Modify: `static/index.html` — `App` (listener `tf:petakan`), `NotePanel` bar aksi `.notes-panel-actions` (~25812), header `NoteModal` (dekat tombol Focus/Share, ~24640), `MindmapPage` (tombol "+ Dari Catatan" + pemilih, ~10000-10060), `MindmapListItem` (~8293)
- Test: `tests/offline/petakan_tab_ui.test.js` (tambah asersi)

**Interfaces:**
- Consumes: route lokal `POST /api/mindmaps { source_note_ref }` (Task C1), `GET /api/scratchpad/titles`.
- Produces: event `tf:petakan { noteId }` → App: `api.post("/api/mindmaps", { title: "", source_note_ref: noteId })` → `setPendingMindmapId(created.id); setPage("mindmap")`; gagal → toast "Gagal membuat peta".
- Produces: helper komponen `useLinkedMapId(noteId)` → id peta tertaut atau `null` (dari `api.get("/api/mindmaps")`, cocokkan `source_note_id`/`source_note_cid` dengan `noteId`), dipakai untuk label "🧠 Petakan" vs "🧠 Buka peta".

- [ ] **Step 1: Write the failing test** — asersi regex: "🧠 Petakan", "🧠 Buka peta", "+ Dari Catatan", `new CustomEvent("tf:petakan"`, `addEventListener("tf:petakan"`, `title: "Tertaut ke catatan"`, `source_note_ref`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.** `NotePanel`: tombol ikon `mindmap` dengan label sesuai `useLinkedMapId`; `NoteModal`: pill yang sama (hanya bila `note?.id`); `MindmapPage`: "+ Dari Catatan" membuka input pencarian (filter `includes` tanpa huruf besar/kecil, maks 20 hasil) → klik → POST → tambahkan ke `mindmaps` bila belum ada → `selectMindmap`; `MindmapListItem`: badge 📄 dengan `title: "Tertaut ke catatan"` bila `m.source_note_id != null || m.source_note_cid != null`.
- [ ] **Step 4: Run** — Expected: PASS; inline check OK.
- [ ] **Step 5: Commit** `git commit -m "feat(petakan): tombol Petakan, + Dari Catatan, badge tertaut"`

### Task C10: rilis PR 3

**Files:**
- Modify: `static/index.html` (tag `<script src="/static/offline/notemap.js"></script>` dan `<script src="/static/offline/notemapsession.js"></script>` setelah `mindmapoutline.js` di ~273; iframe `?v=140` → `?v=141`; `window.__SW_VERSION` + teks fallback), `static/sw.js` (CACHE + precache dua modul), `webapp.py` (`sw_cache`), `tests/test_version.py`, semua `tests/offline/*.test.js` yang menyebut versi lama (`grep -rl "<versi lama>" tests`), `static/app.css?v=` bila `app.css` disentuh
- Modify: `.agents/CURRENT_STATE.md`, `.agents/SESSION_LOG.md`

- [ ] **Step 1:** `git fetch origin main` dan cek versi SW terbaru di `main`; pilih `taskflow-vNNN-petakan` dengan NNN berikutnya; ganti di semua tempat di atas.
- [ ] **Step 2:** `npm test`, `python -m pytest tests/ -q`, `node temporary_files/check_inline_scripts.js static/index.html`, `node temporary_files/check_inline_scripts.js static/vendor/mind-elixir/index.html`, `git diff main -U0 | grep -iE "border-?left"` → tanpa hasil.
- [ ] **Step 3:** Uji browser (Playwright, server lokal) sesuai spec §10: buat peta dari catatan (mode baca, editor, "+ Dari Catatan"); edit catatan → peta berubah; tiap aksi tabel spec §5.4 → catatan berubah; konfirmasi hapus + Ctrl+Z; Ctrl/Cmd+Click, klik kanan, tombol Ops; Ringkasan on/off; catatan bersama → anggota melihat & mengedit; offline → online; `GET /api/mindmaps` tanpa `linked=1` tidak memuat peta tertaut.
- [ ] **Step 4:** Perbarui `.agents/`, push, draft PR "feat: Petakan — catatan ↔ mindmap tertaut (PR 3/3)" dengan hasil tes dan tangkapan layar.
