# Tema PR A — Fondasi token, palet, dekorasi: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Memasang fondasi tema (atribut `data-palette`/`data-decor`, registri `TF.themes`, token semantik aksen + permukaan, `themes.css`, migrasi warna hard-coded) **tanpa mengubah satu piksel pun** tampilan Default terang/gelap.

**Architecture:** `data-theme` tetap satu-satunya sumbu yang dibaca pihak ketiga; dua atribut baru hanya mengganti token CSS. Logika preferensi (baca/normalisasi/resolve/apply) ada di modul murni `static/offline/themes.js` yang bisa dites di Node, dicerminkan oleh skrip boot inline di `<head>` (paritas dijaga tes). Warna keluarga aksen lime diganti token lewat skrip pemetaan nilai persis; warna permukaan di aturan gelap dirapikan manual ke token; sisa literal yang tidak bisa diganti tanpa mengubah tampilan dicatat untuk PR B.

**Tech Stack:** React tanpa build (`static/index.html` = `React.createElement`, JSX dilarang), CSS custom property, `node --test` (`tests/offline/*.test.js`) + jembatan pytest, Playwright E2E lokal (`temporary_files/`).

**Spec:** `docs/superpowers/specs/2026-10-26-tema-palet-dekorasi-design.md` (§3.1, §3.2, §3.4, §3.8, §3.9, §4 baris PR A, §5).

## Penyesuaian terhadap spec (diputuskan saat menulis plan)

- **R1 — `--accent-rgb`.** Ada 25 nilai alpha berbeda dari `rgba(168,197,0,a)` (±120 tempat). Alih-alih satu token per alpha, token `--accent-rgb: 168, 197, 0` dan setiap `rgba(168,197,0,a)` → `rgba(var(--accent-rgb), a)`. Palet (PR B) mengganti `--accent-rgb` saja. `--accent-soft/-duo/-ring` dari spec tetap dibuat untuk komponen baru.
- **R2 — dua token teks aksen.** Spec §3.2 menyebut `--accent-text` = `#6B8000`. Di kode ada `#7E9400` (17×, dashboard) dan `#6B8000` (9×, badge). Agar identik: `--accent-text: #7E9400` dan `--accent-text-strong: #6B8000`. `#5D6E00` (1×) dan `#6B7F00` (1×) → `--accent-text-strong` (selisih ≤ 2 satuan per kanal; toleransi E2E §Task 1).
- **R3 — `--accent-2`.** `#B6D400` (8×, `.tag-pill.active`, `.tpl-footer`, template) dan hover `#A3C100` (6×) adalah aksen kedua yang lebih terang: `--accent-2: #B6D400`, `--accent-2-hover: #A3C100`.
- **R4 — `theme-color` PR A tetap `#0f172a` di kedua mode** (nilai meta sekarang). Nilai Default terang `#FCFCFB` dari spec §3.4 diterapkan di PR B bersama palet (perubahan status bar yang terlihat).
- **R5 — "Ikuti sistem" logikanya masuk PR A** (`resolve` + pendengar `matchMedia`), UI-nya PR B. Tidak ada jalur UI yang menulis `system` di PR A.
- **R6 — literal netral di `index.html` tidak disentuh di PR A.** Mengganti `color: "#0f172a"` inline dengan `var(--text-primary)` mengubah tampilan gelap (literal itu sekarang salah di mode gelap). PR A hanya mengganti yang identik di kedua mode; sisanya dicatat (Task 5) untuk audit PR B.
- **R7 — Canvas/Chart.js** tidak bisa membaca `var()`: literal aksen di `ProductivityChart`/`StatusBarChart` diganti `tok("--accent")` lewat `dashChartColors` yang sudah ada (`accent`, `accentRgb`).

## Global Constraints

- Basis: `main` @ `64f3782` (SW `taskflow-v470-live-edit`, `app.css?v=367`, ADR terakhir ADR-031). Versi PR ini: SW `taskflow-v<N>-tema-fondasi`, `app.css?v=368`, `themes.css?v=1`; `<N>` = nomor kosong berikutnya setelah cek `main` dan PR terbuka saat Task 7 (saat plan ditulis: 471).
- `static/index.html` sudah terkompilasi: kode baru = `React.createElement(...)`. Setelah mengubahnya: `node temporary_files/check_inline_scripts.js` harus OK.
- Hanya klien: tanpa `webapp.py`, skema, API, router lokal, sinkron.
- **Tampilan Default identik** (spec §2.3): E2E Task 1 membandingkan screenshot 8 halaman × 2 mode; selisih per kanal > 3 pada piksel mana pun = gagal.
- Warna bermakna tidak disentuh (spec §3.8): `--p1..4`, `--q1/3/4`, `--pomodoro*`, `--break*`, `--success`, badge P/Q/GTD selain Next/Q2, `.ws-c0..7`, semua merah/oranye/kuning/hijau/biru/ungu non-lime.
- Nama kunci localStorage persis: `tf_theme` (`light`|`dark`|`system`), `tf_palette`, `tf_decor`. Semua akses dalam `try/catch`.
- Nama atribut persis: `data-theme`, `data-palette`, `data-decor`. Nilai `data-theme` hanya `light`|`dark`.
- Modul baru `static/offline/themes.js` dan `static/themes.css?v=1` masuk `STATIC` `sw.js` dengan URL persis (ADR-029); `themes.js` dimuat sebelum `ui-components.js`.
- Rilis: checklist `.agents/PROTOCOL.md` §4; entri `whatsnew.json` PR ini `silent`. Branch `claude/tema-fondasi-token`, PR draft, merge hanya setelah pemilik bilang "merge dan deploy".
- Pesan commit diakhiri baris atribusi sesi (Co-Authored-By + Claude-Session).
- Verifikasi standar: `npm test` (hanya `draw_local_reactive` yang diketahui boleh gagal), `python -m pytest tests/ -q`, `node temporary_files/check_inline_scripts.js`.

## Review Focus

1. **localStorage dilempar/diblokir (Safari privat, storage penuh)** — boot script dan App tidak boleh crash; tema jatuh ke `light`/`default`/`on`. Tes: Task 2 `readPrefs: storage melempar → bawaan`; Task 6 `boot script: storage melempar → atribut bawaan`.
2. **Nilai lama/asing di localStorage** (`tf_theme=dark` dari perangkat lama, `tf_palette=mint` dari versi mendatang yang di-rollback) — tetap gelap, palet Default, tanpa error. Tes: Task 2 `readPrefs: nilai asing → bawaan`.
3. **`apply()` dipanggil ulang dengan nilai sama** (setiap render App) — tidak boleh memanggil `setAttribute`, karena `MutationObserver` iframe Sketsa/mindmap dan grafik akan memicu `postMessage`/render ulang terus-menerus. Tes: Task 2 `apply: nilai sama → tanpa setAttribute`.
4. **Literal aksen di konteks non-CSS** (Chart.js canvas, `addColorStop`, nilai default prop yang masuk atribut SVG) — `var(--accent)` di sana = warna hitam/tidak valid. Tes: Task 4 `guard: tidak ada "var(--" di argumen addColorStop/borderColor Chart.js` + E2E Dashboard (grafik ikut screenshot).
5. **Urutan muat** — `TF.themes` harus ada sebelum `useState` App membaca preferensi; tag `<script src="/static/offline/themes.js">` yang hilang/dipindah = layar putih. Tes: Task 3 `themes.css dan themes.js dimuat index.html` (urutan sebelum `ui-components.js`, `index.html:340`); tes precache yang sudah ada menjaga `STATIC`.

---

### Task 1: Harness E2E + baseline screenshot dari `main`

**Files:**
- Create: `temporary_files/e2e_tema_fondasi.py`
- Create (hasil, tidak di-commit): `temporary_files/e2e_tema_fondasi/baseline/`, `.../after/`

**Interfaces:**
- Produces: `python3 temporary_files/e2e_tema_fondasi.py baseline` (simpan 16 PNG), `python3 temporary_files/e2e_tema_fondasi.py compare` (bandingkan `after/` dengan `baseline/`, cetak `PASS`/`FAIL` per gambar + jumlah piksel beda), opsi `--tolerance 3`.
- Pola harness: salin `start_server`, `open_app`, `check` dari `temporary_files/e2e_focus_page.py` (uvicorn lokal, konteks persisten, `tf_whatsnew_seen` = versi SW, `localStorage.tf_theme` = mode).

- [ ] **Step 1: Tulis skrip.** Halaman: `dashboard`, `today`, `focus`, `calendar`, `notes`, `tasks` (Normal), `kanban`, `settings`; mode `light`, `dark`; viewport 1280×900, `animations: "disabled"`, `page.wait_for_timeout(600)` sebelum `screenshot(full_page=True)`; data seed sama di kedua jalankan (3 task P1/P2/P3 dengan deadline hari ini, 1 note, 1 habit — dibuat lewat API setelah login). Pembanding: PIL, `ImageChops.difference`, piksel beda = ada kanal > `tolerance`; ukuran berbeda = FAIL.
- [ ] **Step 2: Jalankan baseline** sebelum ada perubahan `static/` di branch (branch baru dari `main`): `python3 temporary_files/e2e_tema_fondasi.py baseline` → 16 file di `baseline/`. Bila `static/` sudah berubah: `git stash -u`, jalankan, `git stash pop`.
- [ ] **Step 3: Jalankan `compare` tanpa perubahan** (sanity): semua `PASS` dengan 0 piksel beda. Bila ada beda (jam, tanggal), sembunyikan elemen itu lewat `page.add_style_tag` di harness dan ulangi Step 2–3.
- [ ] **Step 4: Commit** — `test(tema): harness E2E screenshot identik + baseline`

### Task 2: Modul `TF.themes` (`static/offline/themes.js`)

**Files:**
- Create: `static/offline/themes.js` (pola UMD seperti `static/offline/whatsnew.js`)
- Test: `tests/offline/themes.test.js`

**Interfaces:**
- Produces (`module.exports` dan `window.TF.themes`):
  - `PALETTES: Array<{id, name, swatch:{light:{accent,soft,bg}, dark:{accent,soft,bg}}, themeColor:{light,dark}, decor:Object}>` — PR A hanya `default` (`themeColor` `{light:"#0f172a", dark:"#0f172a"}`, `decor: {}`, swatch dari nilai `:root`/gelap Task 3).
  - `KEYS = { mode:"tf_theme", palette:"tf_palette", decor:"tf_decor" }`.
  - `readPrefs(storage) -> {mode:"light"|"dark"|"system", palette:string, decor:"on"|"off"}`; `storage` = objek dengan `getItem` (boleh melempar).
  - `writePrefs(storage, prefs) -> void` (menulis ketiga kunci; melempar ditelan).
  - `resolve(prefs, systemDark:boolean) -> {theme:"light"|"dark", palette, decor, themeColor}`.
  - `apply(resolved, doc) -> {changed:string[]}`; `doc` = `{documentElement, querySelector}`; hanya `setAttribute` bila nilai berbeda; meta `theme-color` dibuat bila belum ada.
  - `decorFor(paletteId, slot) -> string|null`; `isDecorAvailable(paletteId) -> boolean`; `paletteById(id) -> entry|null`.

- [ ] **Step 1: Tulis tes gagal** `tests/offline/themes.test.js`:

```js
const th = require("../../static/offline/themes.js");
const mem = (o) => ({ getItem: (k) => (k in o ? o[k] : null), setItem: (k, v) => { o[k] = v; } });
test("readPrefs: kosong → bawaan", () => assert.deepEqual(th.readPrefs(mem({})), { mode: "light", palette: "default", decor: "on" }));
test("readPrefs: nilai lama dark tetap dark", () => assert.equal(th.readPrefs(mem({ tf_theme: "dark" })).mode, "dark"));
test("readPrefs: nilai asing → bawaan", () => assert.deepEqual(th.readPrefs(mem({ tf_theme: "blue", tf_palette: "mint", tf_decor: "maybe" })), { mode: "light", palette: "default", decor: "on" }));
test("readPrefs: storage melempar → bawaan", () => assert.equal(th.readPrefs({ getItem() { throw new Error("blocked"); } }).palette, "default"));
test("readPrefs: null storage → bawaan", () => assert.equal(th.readPrefs(null).mode, "light"));
test("resolve: system mengikuti systemDark", () => { assert.equal(th.resolve({ mode: "system", palette: "default", decor: "on" }, true).theme, "dark"); assert.equal(th.resolve({ mode: "system", palette: "default", decor: "on" }, false).theme, "light"); });
test("resolve: light/dark mengabaikan systemDark; themeColor dari registri", () => { const r = th.resolve({ mode: "light", palette: "default", decor: "off" }, true); assert.equal(r.theme, "light"); assert.equal(r.decor, "off"); assert.equal(r.themeColor, "#0f172a"); });
test("apply: memasang 3 atribut + meta, lalu nilai sama → tanpa setAttribute", () => {
  const calls = []; const el = { attrs: {}, getAttribute(k) { return this.attrs[k] ?? null; }, setAttribute(k, v) { calls.push(k); this.attrs[k] = v; } };
  const meta = { content: "#000", getAttribute(k) { return k === "content" ? this.content : null; }, setAttribute(k, v) { calls.push("meta"); this.content = v; } };
  const doc = { documentElement: el, querySelector: (s) => (s === 'meta[name="theme-color"]' ? meta : null) };
  const r = th.resolve({ mode: "dark", palette: "default", decor: "on" }, false);
  th.apply(r, doc); assert.deepEqual(el.attrs, { "data-theme": "dark", "data-palette": "default", "data-decor": "on" }); assert.equal(meta.content, "#0f172a");
  calls.length = 0; th.apply(r, doc); assert.deepEqual(calls, []);
});
test("writePrefs menulis 3 kunci; melempar ditelan", () => { const o = {}; th.writePrefs(mem(o), { mode: "system", palette: "default", decor: "off" }); assert.deepEqual(o, { tf_theme: "system", tf_palette: "default", tf_decor: "off" }); assert.doesNotThrow(() => th.writePrefs({ setItem() { throw new Error(); } }, { mode: "light" })); });
test("registri: default lengkap, decorFor/isDecorAvailable", () => { const d = th.paletteById("default"); assert.ok(d.swatch.light.accent && d.swatch.dark.accent && d.themeColor.light && d.themeColor.dark); assert.equal(th.decorFor("default", "page-corner"), null); assert.equal(th.isDecorAvailable("default"), false); assert.equal(th.paletteById("zzz"), null); });
```

- [ ] **Step 2: Jalankan** `node --test tests/offline/themes.test.js` → FAIL (`Cannot find module`).
- [ ] **Step 3: Implementasi** `static/offline/themes.js` sesuai Interfaces. `readPrefs` menerima `mode` hanya dari himpunan `{light,dark,system}`, `palette` hanya id yang ada di `PALETTES`, `decor` `off` hanya bila persis `"off"`.
- [ ] **Step 4: Jalankan** → PASS.
- [ ] **Step 5: Commit** — `feat(tema): modul TF.themes (preferensi, resolve, apply, registri Default)`

### Task 3: Token baru di `app.css`, `themes.css`, precache

**Files:**
- Modify: `static/app.css:1-45` (`:root` dan `[data-theme="dark"]`)
- Create: `static/themes.css`
- Modify: `static/index.html:55` (tambah `<link rel="stylesheet" href="/static/themes.css?v=1">` tepat setelah `app.css`), `static/index.html:339-340` (tambah `<script src="/static/offline/themes.js"></script>` tepat sebelum `<script src="/static/ui-components.js">`), `static/sw.js` `STATIC` (dua entri baru)
- Test: `tests/offline/theme_guard.test.js` (dibuat di task ini, ditambah di Task 4–5)

**Interfaces:**
- Produces token `:root` (nilai Default, identik dengan literal yang ada): `--accent-rgb: 168, 197, 0`; `--accent-ink: #ffffff`; `--accent-text: #7E9400`; `--accent-text-strong: #6B8000`; `--accent-2: #B6D400`; `--accent-2-hover: #A3C100`; `--accent-soft: #F4FAD6`; `--accent-duo: rgba(168,197,0,0.22)`; `--accent-ring: rgba(168,197,0,0.35)`; `--bg-sidebar: var(--bg-primary)`; `--border-strong: #DDDDD5`; `--radius-sm: 6px`; `--radius-md: 10px`; `--radius-pill: 999px`; `--font-heading: inherit`. Blok gelap: `--accent-text: #A8C500`; `--accent-text-strong: #A8C500`; `--accent-soft: rgba(168,197,0,0.18)`; `--border-strong: #404040`. `--q2` → `var(--accent)`.
- `static/themes.css`: komentar header (tujuan, aturan "hanya selektor `[data-palette…]` dan deklarasi `--*`", rujukan spec §3.3) + blok kosong `[data-palette="default"] {}`.

- [ ] **Step 1: Tulis tes gagal** `tests/offline/theme_guard.test.js`:

```js
const css = fs.readFileSync("static/app.css", "utf8"), tcss = fs.readFileSync("static/themes.css", "utf8"), html = fs.readFileSync("static/index.html", "utf8");
const root = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
test("token baru ada di :root", () => { for (const t of ["--accent-rgb","--accent-ink","--accent-text","--accent-text-strong","--accent-2","--accent-2-hover","--accent-soft","--accent-duo","--accent-ring","--bg-sidebar","--border-strong","--radius-sm","--radius-md","--radius-pill","--font-heading"]) assert.match(root, new RegExp(`\\n\\s*${t}:`), t); });
test("warna bermakna di :root tidak berubah", () => { for (const d of ["--p1: #ef4444", "--p2: #f97316", "--p3: #eab308", "--p4: #22c55e", "--q1: #ef4444", "--q3: #f97316", "--q4: #94a3b8", "--success: #22c55e", "--pomodoro: #ef4444", "--break: #22c55e"]) assert.ok(root.includes(d), d); assert.ok(root.includes("--q2: var(--accent)")); });
test("themes.css hanya blok [data-palette] berisi deklarasi --*", () => { const body = tcss.replace(/\/\*[\s\S]*?\*\//g, ""); for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) { assert.match(m[1].trim(), /^\[data-palette="[a-z]+"\](\[data-theme="dark"\])?$/); for (const d of m[2].split(";").map(s => s.trim()).filter(Boolean)) assert.match(d, /^--[a-z0-9-]+\s*:/, d); } });
test("themes.css dan themes.js dimuat index.html", () => { assert.match(html, /<link rel="stylesheet" href="\/static\/themes\.css\?v=1">/); assert.ok(html.indexOf('<script src="/static/offline/themes.js">') < html.indexOf('<script src="/static/ui-components.js">')); });
```

- [ ] **Step 2: Jalankan** `node --test tests/offline/theme_guard.test.js tests/offline/sw_precache_shell.test.js` → FAIL.
- [ ] **Step 3: Implementasi** token, `themes.css`, dua tag di `index.html`, dua entri `STATIC` (`git add static/themes.css` sebelum tes precache).
- [ ] **Step 4: Jalankan** kedua tes → PASS; `python3 temporary_files/e2e_tema_fondasi.py compare` → semua PASS (belum ada pemakai token).
- [ ] **Step 5: Commit** — `feat(tema): token semantik aksen/permukaan + themes.css + precache`

### Task 4: Migrasi mekanis keluarga aksen

**Files:**
- Create: `temporary_files/migrate_theme_tokens.js` (sekali pakai; argumen `--dry` mencetak laporan `file:baris: lama → baru`)
- Modify: `static/app.css` (semua literal keluarga aksen di luar `:root`/blok gelap token), `static/index.html` (hanya konteks CSS: `<style>`, objek `style:`, `el.style.background = …`; konteks Chart.js/SVG manual)
- Modify: `static/index.html:19107-19130` `dashChartColors` (+ `accent: tok("--accent", "#A8C500")`, `accentRgb: tok("--accent-rgb", "168, 197, 0")`), pemakai di `ProductivityChart`/`StatusBarChart` (`static/index.html:19169-19279`)
- Test: `tests/offline/theme_guard.test.js` (+3 tes)

**Interfaces:**
- Tabel pemetaan (nilai persis, huruf besar/kecil diabaikan): `#A8C500`→`var(--accent)`; `#95AD00`→`var(--accent-hover)`; `#7E9400`→`var(--accent-text)`; `#6B8000`,`#5D6E00`,`#6B7F00`→`var(--accent-text-strong)`; `#B6D400`→`var(--accent-2)`; `#A3C100`→`var(--accent-2-hover)`; `#F4FAD6`→`var(--accent-soft)`; `rgba(168,197,0,<a>)` (spasi opsional)→`rgba(var(--accent-rgb), <a>)`. Deklarasi di `:root`/`[data-theme="dark"]` token (baris 1–45) dikecualikan. `var(--accent, #A8C500)` (fallback, `index.html:44549`) dibiarkan.
- Konteks non-CSS di `index.html` (ditangani manual, bukan skrip): `addColorStop` (19169–19170) → `rgba(${c.accentRgb}, 0.14)` / `0)`; `borderColor`/`pointBackgroundColor` (19192, 19200) dan `backgroundColor` array (19279) → `c.accent`; `DashCardHead` default `color` (21183) dan kartu dashboard (22552, 22602, 22642) → `"var(--accent)"` hanya bila `color` dipakai di `style` (cek; bila masuk atribut SVG `fill`, pakai `style: { fill: … }`).

- [ ] **Step 1: Tulis tes gagal** (tambah ke `theme_guard.test.js`):

```js
const LIME = /#(A8C500|95AD00|7E9400|6B8000|5D6E00|6B7F00|B6D400|A3C100|F4FAD6)\b|rgba\(\s*168\s*,\s*197\s*,\s*0\s*,/i;
const stripRoot = (s) => s.replace(/:root \{[\s\S]*?\}\s*\[data-theme="dark"\] \{[\s\S]*?\}/, "");
test("guard: tidak ada literal lime di app.css di luar blok token", () => assert.equal(stripRoot(css).match(new RegExp(LIME.source, "gi")), null));
test("guard: tidak ada literal lime di index.html kecuali fallback var(--accent, #A8C500)", () => { const h = html.replace(/var\(--accent, #A8C500\)/g, ""); assert.equal(h.match(new RegExp(LIME.source, "gi")), null); });
test("guard: Chart.js tidak menerima var()", () => { const chart = html.slice(html.indexOf("function ProductivityChart("), html.indexOf("function DashCardHead(")); assert.doesNotMatch(chart, /addColorStop\([^)]*var\(|borderColor:\s*"var\(|backgroundColor:\s*\[[^\]]*var\(/); });
```

- [ ] **Step 2: Jalankan** → FAIL (literal masih ada).
- [ ] **Step 3: Tulis skrip, jalankan `--dry`,** simpan laporannya ke `temporary_files/tema_migrasi_aksen.txt`; tinjau baris `index.html` satu per satu; jalankan tanpa `--dry` untuk `app.css` dan untuk baris `index.html` yang konteksnya CSS; kerjakan konteks non-CSS manual sesuai Interfaces.
- [ ] **Step 4: Jalankan** `node --test tests/offline/theme_guard.test.js && node temporary_files/check_inline_scripts.js && python3 temporary_files/e2e_tema_fondasi.py compare` → PASS semua, 0 piksel beda (grafik dashboard termasuk).
- [ ] **Step 5: Commit** — `refactor(tema): literal aksen lime → token (--accent*, --accent-rgb)`

### Task 5: Migrasi manual aturan gelap & literal permukaan di `app.css`

**Files:**
- Modify: `static/app.css` (±223 aturan `[data-theme="dark"]`, literal netral di aturan terang)
- Create: `tests/offline/theme_dark_allowlist.json` (daftar selektor aturan gelap yang boleh tetap memakai literal, dengan alasan)
- Create: `docs/superpowers/plans/2026-10-26-tema-fondasi-sisa-hex.md` (laporan literal netral `index.html` yang ditunda, untuk audit PR B)
- Test: `tests/offline/theme_guard.test.js` (+2 tes)

**Interfaces:**
- Aturan keputusan per aturan gelap `[data-theme="dark"] S { p: v }`:
  1. `v` kini token (hasil Task 4) → biarkan.
  2. `v` warna bermakna (merah/oranye/kuning/hijau/biru/ungu, badge P/Q/GTD, pomodoro, break) → biarkan, masukkan `S` ke allowlist dengan alasan `"warna bermakna"`.
  3. `v` netral yang sama dengan nilai token gelap (`#171717`→`--bg-page`; `#262626`→`--bg-card`; `#404040`→`--border` atau `--border-strong` sesuai peran; `#e5e5e5`/`#a3a3a3`/`#737373`→`--text-*`; `rgba(255,255,255,0.08)`→`--bg-hover`; `rgba(255,255,255,0.03)`→`--bg-subtle`; `rgba(255,255,255,0.10)`→`--bg-selected`; `#fff` di atas aksen→`--accent-ink`) → ganti aturan **terang** `S` agar memakai token yang sama (bila terang masih literal) lalu **hapus** aturan gelap; bila tidak ada padanan terang, aturan gelap diganti memakai token.
  4. `v` netral tanpa token (`#525252`, `#3A4048`, `#D0D5DD`, `rgba(0,0,0,0.5)` bayangan, `rgba(255,255,255,0.07/0.06/0.12)`) → selisih ≤ 3 satuan dari token terdekat: pakai token terdekat; selain itu → biarkan, allowlist alasan `"netral tanpa token"`. Jangan menambah token baru di task ini.
- `theme_dark_allowlist.json`: `[{ "selector": "[data-theme=\"dark\"] .badge-p1", "reason": "warna bermakna" }, …]`.

- [ ] **Step 1: Tulis tes gagal** (tambah ke `theme_guard.test.js`):

```js
const allow = new Set(JSON.parse(fs.readFileSync("tests/offline/theme_dark_allowlist.json", "utf8")).map(e => e.selector));
const darkRules = [...css.matchAll(/(\[data-theme="dark"\][^{]*)\{([^}]*)\}/g)].map(m => [m[1].trim(), m[2]]);
const LITERAL = /#[0-9a-f]{3,8}\b|rgba?\(\s*\d/i;
test("guard: aturan gelap berliteral hanya yang di-allowlist", () => { const bad = darkRules.filter(([s, b]) => LITERAL.test(b) && !allow.has(s)).map(([s]) => s); assert.deepEqual(bad, []); });
test("guard: allowlist tidak basi dan ≤ 80 entri", () => { const sels = new Set(darkRules.map(([s]) => s)); for (const s of allow) assert.ok(sels.has(s), "basi: " + s); assert.ok(allow.size <= 80, String(allow.size)); });
```

- [ ] **Step 2: Jalankan** → FAIL (allowlist belum ada / banyak aturan berliteral).
- [ ] **Step 3: Kerjakan** aturan demi aturan (urut baris), bangun allowlist. Target: aturan gelap berliteral yang tersisa ≤ 80 dan semuanya kelas 2 atau 4. Buat `tema-fondasi-sisa-hex.md`: daftar `index.html:baris` literal netral (`#0f172a`, `#64748b`, `#94a3b8`, `#262626`, `#171717`, `#e5e5e5`, `#f1f5f9`, `#e2e8f0`, `#cbd5e1`, `#1e293b`) dengan konteks 1 baris, dikelompokkan per halaman, kolom "pengaruh mode gelap sekarang" (benar/salah) — tanpa mengubah `index.html`.
- [ ] **Step 4: Jalankan** `node --test tests/offline/theme_guard.test.js && python3 temporary_files/e2e_tema_fondasi.py compare` → PASS, 0 piksel beda. Bila ada beda: aturan itu salah kelas; kembalikan dan masukkan allowlist.
- [ ] **Step 5: Commit** — `refactor(tema): aturan gelap app.css → token; allowlist + laporan sisa hex`

### Task 6: Boot script `<head>`, integrasi App, pengamat atribut

**Files:**
- Modify: `static/index.html:230-233` (ganti IIFE `tf_theme` dengan boot script ber-`id="tf-theme-boot"`), `static/index.html:41951-41958` (`theme`/`toggleTheme` App), `static/index.html:19107-19116` `useThemeName`, `static/index.html:14733-14744` pengamat iframe (dan pengamat serupa lain: `grep -n 'attributeFilter: \["data-theme"\]'`)
- Test: `tests/offline/theme_boot.test.js`

**Interfaces:**
- Boot script (ES5, `try/catch` menyeluruh, tanpa `TF.themes` karena belum dimuat): membaca tiga kunci dengan normalisasi yang sama dengan `readPrefs` (himpunan palet valid ditulis literal `["default"]` — PR B menambah), mode `system` → `matchMedia("(prefers-color-scheme: dark)").matches`, memasang `data-theme`/`data-palette`/`data-decor` dan `content` meta `theme-color` dari tabel literal `{default:{light:"#0f172a",dark:"#0f172a"}}`.
- App: `const [themePrefs, setThemePrefsState] = useState(() => window.TF.themes.readPrefs(localStorage))`; `const systemDark = useSystemDark(themePrefs.mode === "system")` (hook baru: `matchMedia` + `addEventListener("change")`, hanya aktif bila argumen `true`); `const resolvedTheme = useMemo(() => TF.themes.resolve(themePrefs, systemDark), [themePrefs, systemDark])`; `useEffect(() => { TF.themes.apply(resolvedTheme, document); }, [resolvedTheme])`; `const theme = resolvedTheme.theme` (pemakai `theme` lain tidak berubah); `const setThemePrefs = useCallback(patch => setThemePrefsState(p => { const n = { ...p, ...patch }; TF.themes.writePrefs(localStorage, n); return n; }), [])`; `toggleTheme = () => setThemePrefs({ mode: resolvedTheme.theme === "dark" ? "light" : "dark" })`. `ThemeToggle` dan kedua pemanggilnya tidak berubah.
- Semua `attributeFilter: ["data-theme"]` → `["data-theme", "data-palette"]`.

- [ ] **Step 1: Tulis tes gagal** `tests/offline/theme_boot.test.js` — ekstrak `<script id="tf-theme-boot">…</script>` dari `index.html`, jalankan di `vm.runInNewContext` dengan `localStorage` palsu, `document.documentElement` palsu (`setAttribute` mencatat), `document.querySelector` → meta palsu, `matchMedia` palsu; bandingkan dengan `TF.themes.resolve` untuk matriks `mode ∈ {light,dark,system,blue,null} × palette ∈ {default,mint,null} × decor ∈ {on,off,x} × systemDark ∈ {true,false}`:

```js
test("boot script = TF.themes.resolve untuk seluruh matriks", () => { for (const c of cases) { const got = runBoot(c.storage, c.systemDark); const want = th.resolve(th.readPrefs(mem(c.storage)), c.systemDark); assert.deepEqual(got.attrs, { "data-theme": want.theme, "data-palette": want.palette, "data-decor": want.decor }, JSON.stringify(c)); assert.equal(got.meta, want.themeColor); } });
test("boot script: storage melempar → atribut bawaan", () => assert.deepEqual(runBoot({ getItem() { throw new Error(); } }, false).attrs, { "data-theme": "light", "data-palette": "default", "data-decor": "on" }));
test("App memakai TF.themes dan pengamat mengawasi data-palette", () => { assert.match(html, /TF\.themes\.readPrefs\(localStorage\)/); assert.match(html, /TF\.themes\.apply\(resolvedTheme, document\)/); assert.doesNotMatch(html, /attributeFilter: \["data-theme"\]\s*\}/); assert.doesNotMatch(html, /localStorage\.setItem\('tf_theme'/); });
```

- [ ] **Step 2: Jalankan** → FAIL.
- [ ] **Step 3: Implementasi** sesuai Interfaces.
- [ ] **Step 4: Jalankan** `node --test tests/offline/theme_boot.test.js tests/offline/themes.test.js && node temporary_files/check_inline_scripts.js && python3 temporary_files/e2e_tema_fondasi.py compare` → PASS; tambah cek E2E di skrip (mode `verify`): (a) buka dengan `tf_theme=dark` → `document.documentElement.dataset` = `{theme:"dark", palette:"default", decor:"on"}` sebelum React (`page.evaluate` di `domcontentloaded`); (b) klik toggle header → `tf_theme` berganti, atribut berganti; (c) `localStorage.tf_theme="system"` + `emulate_media(color_scheme="dark")` → `data-theme=dark`, ganti ke `light` → `data-theme=light` tanpa reload; (d) logout → ketiga kunci tetap.
- [ ] **Step 5: Commit** — `feat(tema): boot script atribut tema + App memakai TF.themes`

### Task 7: Versi, jembatan CI, handover

**Files:**
- Modify: `static/sw.js:1` (`CACHE`), `static/index.html` (`window.__SW_VERSION` + fallback, `app.css?v=368`), `static/sw.js` `STATIC` (`/static/app.css?v=368`), `static/whatsnew.json` (entri teratas `{ "version": "taskflow-v<N>-tema-fondasi", "date": "<tanggal>", "silent": true }`), `tests/offline/account_settings_ui.test.js:102-106` (versi)
- Create: `tests/test_theme_node.py` (pola `tests/test_app_update_node.py`; `NODE_TESTS = ["themes", "theme_guard", "theme_boot"]`)
- Modify: `.agents/DECISIONS.md` (ADR-032 sesuai spec §8), `.agents/CURRENT_STATE.md` (entri baru paling atas: status, versi, sisa = `tema-fondasi-sisa-hex.md`, langkah PR B), `.agents/SESSION_LOG.md`

- [ ] **Step 1: Cek nomor versi** di `main` dan PR terbuka (`gh pr list`); pilih `<N>` kosong berikutnya.
- [ ] **Step 2: Terapkan** versi di semua tempat; tulis `tests/test_theme_node.py` dengan `EXPECTED_NODE_TESTS = {"themes","theme_guard","theme_boot"}`.
- [ ] **Step 3: Jalankan** `python -m pytest tests/test_whatsnew.py tests/test_sw_precache_node.py tests/test_app_update_node.py tests/test_theme_node.py tests/test_version.py -q && npm test && python -m pytest tests/ -q && node temporary_files/check_inline_scripts.js && python3 temporary_files/e2e_tema_fondasi.py compare && python3 temporary_files/e2e_tema_fondasi.py verify` → semua PASS (npm: hanya `draw_local_reactive` yang boleh gagal).
- [ ] **Step 4: Tulis** ADR-032, CURRENT_STATE, SESSION_LOG.
- [ ] **Step 5: Commit** — `chore(tema): rilis v<N> tema-fondasi (silent) + ADR-032 + handover`; push `claude/tema-fondasi-token`; PR draft berjudul "Tema PR A — fondasi token & palet (tanpa perubahan tampilan)" berisi ringkasan R1–R7, jumlah literal yang dimigrasi, tautan laporan sisa hex.
