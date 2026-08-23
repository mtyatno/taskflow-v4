# Floating ToC ala Medium — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ubah ToC NotePanel menjadi tombol melayang (fixed) — lingkaran ikon di kanan-tengah desktop, FAB kecil di atas FAB Buat Baru pada mobile — plus scroll-spy highlight section aktif.

**Architecture:** CSS-only repositioning (tanpa portal, tanpa modul baru) + state `tocActiveIdx` dan IntersectionObserver inline di `NotePanel` (compiled output di `static/index.html`). DOM trigger tetap di lokasinya; hanya CSS yang mengeluarkannya dari alur artikel.

**Tech Stack:** Vanilla JS + React (pre-compiled JSX di index.html), CSS di `static/app.css`, `node:test` untuk JS suite, pytest.

**Spec:** `docs/superpowers/specs/2026-08-23-floating-toc-fly-design.md`

## Global Constraints

- `static/index.html` adalah **compiled output** (`/*#__PURE__*/React.createElement`) — edit output-nya LANGSUNG. JANGAN jalankan `node compile.js` (tidak ada `<script type="text/babel">`; script akan no-op, tapi jangan menambah JSX mentah).
- Setiap ubah aset static → **wajib bump** versi cache di `static/sw.js` (SW cache-first; tanpa bump, device lama sajikan aset lama).
- JS tests: `node --test "tests/offline/*.test.js"` — di drive Z: LAMBAT (3–5 menit). Selalu jalankan sendiri dan baca output; jangan percaya laporan jumlah test dari orang lain.
- Pytest: `python -m pytest tests/` (JANGAN `python -m pytest` bare — `test_ext_auth.py` & `test_task_recurrence.py` di repo root butuh server localhost:8080 dan gagal saat collection).
- Pemeriksa parse inline script: `node scratch/check_inline.js static/index.html scratch/tmp_check` (alat ada di workspace; mengekstrak & `node --check` tiap `<script>` inline). Wajib 5/5 OK.
- **Babel TDZ:** `const`/`let` yang direferensikan di dependency array `useEffect` harus dideklarasikan SEBELUM pemanggilan effect. `tocItems` didefinisikan di baris ~19553 — effect scroll-spy WAJIB diletakkan setelahnya.
- Commit message mengikuti konvensi repo: `feat(notes): ...` / `fix(notes): ...` + baris `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Deploy = `git push origin main` (Actions `deploy.yml` auto pull+build). Verifikasi live via `curl` — jangan percaya status Action hijau.

---

### Task 1: CSS — anchor fixed, trigger lingkaran, popover reposition, konsolidasi

**Files:**
- Modify: `static/app.css` (hapus duplikat di blok `@media (max-width: 767px)` ~baris 1014–1022; ganti blok umum ~baris 1879–1913)
- Test: `tests/offline/note_toc.test.js` (tulis ulang file ini — content lengkap di bawah)

**Interfaces:**
- Consumes: —
- Produces: class CSS `.floating-toc-anchor` (fixed; mobile FAB di atas `.fab`), `.floating-toc-trigger` (lingkaran 44px mobile / 40px desktop), `.floating-toc-popover` (absolute; buka ke atas di mobile, ke kiri di desktop; animasi `toc-pop-in` opacity-only), `.note-toc-item` + `.note-toc-item.active` unscoped (tint `rgba(168,197,0,0.12)`).

- [ ] **Step 1: Tulis test yang gagal**

Tulis ulang SELURUH isi `tests/offline/note_toc.test.js` dengan konten berikut:

```js
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const cssPath = path.resolve(__dirname, "../../static/app.css");
const appCss = fs.readFileSync(cssPath, "utf8");

test("Floating ToC CSS — tombol melayang ala Medium", async (t) => {
  await t.test("anchor fixed tersedia (satu sumber kebenaran)", () => {
    assert.ok(appCss.includes(".floating-toc-anchor"), "harus ada selector .floating-toc-anchor");
    const count = (appCss.match(/\.floating-toc-trigger \{/g) || []).length;
    assert.strictEqual(count, 1, "blok .floating-toc-trigger harus tepat 1 (duplikat media-scoped dihapus)");
    const mediaDup = /@media \(max-width: 767px\)[\s\S]*?\.floating-toc/.exec(appCss);
    assert.strictEqual(mediaDup, null, "tidak boleh ada floating-toc di dalam blok @media (max-width: 767px) lama");
  });

  await t.test("mobile: FAB 44px di atas FAB Buat Baru (bottom 92px + safe-area)", () => {
    assert.ok(appCss.includes("bottom: calc(92px + env(safe-area-inset-bottom, 0px))"), "anchor mobile di 92px + safe-area");
    const m = /\.floating-toc-trigger \{([^}]*)\}/.exec(appCss);
    assert.ok(m, "rule .floating-toc-trigger ada");
    const body = m[1];
    assert.ok(/width:\s*44px/.test(body), "mobile: width 44px");
    assert.ok(/height:\s*44px/.test(body), "mobile: height 44px");
    assert.ok(/border-radius:\s*50%/.test(body), "bentuk lingkaran");
  });

  await t.test("desktop (min-width 769): kanan-tengah, 40px, popover ke kiri", () => {
    const desktop = /@media \(min-width: 769px\)[\s\S]*?\.floating-toc-anchor \{([^}]*)\}/.exec(appCss);
    assert.ok(desktop, "harus ada @media (min-width: 769px) dengan .floating-toc-anchor");
    assert.ok(/top:\s*50%/.test(desktop[1]), "top 50%");
    assert.ok(/transform:\s*translateY\(-50%\)/.test(desktop[1]), "translateY(-50%)");
    const popover = /@media \(min-width: 769px\)[\s\S]*?\.floating-toc-popover \{([^}]*)\}/.exec(appCss);
    assert.ok(popover, "popover desktop override ada");
    assert.ok(/right:\s*calc\(100% \+ 8px\)/.test(popover[1]), "popover membuka ke kiri tombol");
    const trigDesktop = /@media \(min-width: 769px\)[\s\S]*?\.floating-toc-trigger \{([^}]*)\}/.exec(appCss);
    assert.ok(trigDesktop && /width:\s*40px/.test(trigDesktop[1]), "desktop: 40px");
  });

  await t.test("mobile: popover membuka ke atas", () => {
    const m = /\.floating-toc-popover \{([^}]*)\}/.exec(appCss);
    assert.ok(m, "rule .floating-toc-popover ada");
    assert.ok(/position:\s*absolute/.test(m[1]), "popover absolute terhadap anchor fixed");
    assert.ok(/bottom:\s*calc\(100% \+ 8px\)/.test(m[1]), "buka ke atas dari FAB");
  });

  await t.test("item aktif ter-highlight dengan tint accent", () => {
    const m = /\.note-toc-item\.active \{([^}]*)\}/.exec(appCss);
    assert.ok(m, "rule .note-toc-item.active unscoped ada");
    assert.ok(/rgba\(168,197,0,0\.12\)/.test(m[1]), "background tint accent");
    assert.ok(/color:\s*var\(--accent\)/.test(m[1]), "teks accent");
  });

  await t.test("animasi popover opacity-only (tidak bentrok transform)", () => {
    assert.ok(appCss.includes("@keyframes toc-pop-in"), "keyframes toc-pop-in ada");
    const m = /\.floating-toc-popover \{([^}]*)\}/.exec(appCss);
    assert.ok(/animation:\s*toc-pop-in/.test(m[1]), "popover pakai toc-pop-in");
  });

  await t.test("ToC statis lama benar-benar hilang", () => {
    assert.strictEqual(appCss.includes(".note-toc-sticky"), false, ".note-toc-sticky tidak boleh ada");
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `node --test tests/offline/note_toc.test.js`
Expected: FAIL — asersi anchor/`toc-pop-in`/`bottom: calc(92px ...)` gagal (belum ada di app.css).

- [ ] **Step 3: Implementasi CSS**

**3a. Hapus duplikat di blok `@media (max-width: 767px)`** (dibuka di app.css baris ~987). Hapus 8 baris lama berikut dari dalam blok itu:

```
    .note-toc-item { display: block; font-size: 10.5px; color: var(--text-secondary); cursor: pointer; padding: 2px 6px; border-radius: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.45; transition: background 0.1s, color 0.1s; }
    .note-toc-item:hover { background: var(--bg-primary); color: var(--text-primary); }
    .note-toc-item.active { color: var(--accent); font-weight: 700; }
    .floating-toc-trigger { display: inline-flex; align-items: center; gap: 5px; background: var(--bg-card); border: 1px solid var(--border); border-radius: 20px; padding: 4px 11px; font-size: 11.5px; font-weight: 600; color: var(--text-secondary); cursor: pointer; transition: all 0.18s ease; }
    .floating-toc-trigger:hover { background: var(--bg-primary); border-color: var(--accent); color: var(--accent); }
    .floating-toc-trigger.active { background: rgba(168,197,0,0.12); border-color: var(--accent); color: var(--accent); }
    .floating-toc-popover { width: 250px; max-height: 60vh; overflow-y: auto; background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.18); padding: 10px 12px; backdrop-filter: blur(12px); scrollbar-width: none; }
    .floating-toc-popover::-webkit-scrollbar { display: none; }
```

**3b. Ganti blok umum lama** (baris ~1879–1913) dengan blok konsolidasi berikut:

```css
/* ── Floating ToC ala Medium — tombol melayang (mobile-first: FAB di atas FAB Buat Baru) ── */
.floating-toc-anchor {
  position: fixed;
  right: 16px;
  bottom: calc(92px + env(safe-area-inset-bottom, 0px));
  z-index: 60;
}
.floating-toc-trigger {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--bg-card);
  border: 1px solid var(--border);
  color: var(--text-secondary);
  font-size: 18px;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0,0,0,0.14);
  transition: border-color 0.18s ease, color 0.18s ease, transform 0.18s ease;
}
.floating-toc-trigger:hover {
  border-color: var(--accent);
  color: var(--accent);
  transform: scale(1.06);
}
.floating-toc-trigger.active {
  background: rgba(168,197,0,0.12);
  border-color: var(--accent);
  color: var(--accent);
}
.floating-toc-popover {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  width: 250px;
  max-height: 60vh;
  overflow-y: auto;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.18);
  padding: 10px 12px;
  backdrop-filter: blur(12px);
  scrollbar-width: none;
  animation: toc-pop-in 0.15s ease;
}
.floating-toc-popover::-webkit-scrollbar { display: none; }
@keyframes toc-pop-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
.note-toc-item {
  display: block;
  font-size: 11px;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 3px 6px;
  border-radius: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.45;
  transition: background 0.1s, color 0.1s;
}
.note-toc-item:hover { background: var(--bg-primary); color: var(--text-primary); }
.note-toc-item.active {
  background: rgba(168,197,0,0.12);
  color: var(--accent);
  font-weight: 700;
}
@media (min-width: 769px) {
  .floating-toc-anchor {
    top: 50%;
    bottom: auto;
    transform: translateY(-50%);
  }
  .floating-toc-trigger {
    width: 40px;
    height: 40px;
    font-size: 17px;
  }
  .floating-toc-popover {
    right: calc(100% + 8px);
    top: 50%;
    bottom: auto;
    transform: translateY(-50%);
  }
}
```

Teks lama blok umum yang diganti (pastikan persis, termasuk indentasi):

```
.floating-toc-trigger {
  display: inline-flex; align-items: center; gap: 5px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 20px;
  padding: 4px 11px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.18s ease;
}
.floating-toc-trigger:hover {
  background: var(--bg-primary);
  border-color: var(--accent);
  color: var(--accent);
}
.floating-toc-trigger.active {
  background: rgba(168,197,0,0.12);
  border-color: var(--accent);
  color: var(--accent);
}
.floating-toc-popover {
  width: 250px;
  max-height: 60vh;
  overflow-y: auto;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.18);
  padding: 10px 12px;
  backdrop-filter: blur(12px);
  scrollbar-width: none;
}
.floating-toc-popover::-webkit-scrollbar { display: none; }
```

Catatan: `transform: translateY(-50%)` pada popover desktop tidak konflik dengan animasi karena `toc-pop-in` hanya mengubah `opacity` (inilah alasan animasi lama `scale-in` — yang menimpa `transform` — DITANGGALKAN di Task 2).

- [ ] **Step 4: Jalankan test, pastikan PASS**

Run: `node --test tests/offline/note_toc.test.js`
Expected: PASS 7/7 (atau semua subtest).

- [ ] **Step 5: Commit**

```bash
git add static/app.css tests/offline/note_toc.test.js
git commit -m "style(notes): reposition floating ToC as fixed anchor with circle trigger

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: NotePanel — anchor class, ikon-only, state scroll-spy, item aktif

**Files:**
- Modify: `static/index.html` (NotePanel; 7 edit kecil, semuanya di compiled output)
- Test: `tests/offline/note_toc.test.js` (tambahkan suite markup di file yang sama)

**Interfaces:**
- Consumes: class CSS dari Task 1 (`.floating-toc-anchor`, `toc-pop-in`).
- Produces: state `tocActiveIdx` + setter `setTocActiveIdx`, ref `tocSpyRef` di `.note-rendered`, class item aktif, handler klik yang set `tocActiveIdx(item.idx)`. Task 3 hanya bump SW — tidak ada dependensi kode.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `tests/offline/note_toc.test.js` (file yang sama dari Task 1; tambahkan di bawah, plus deklarasi indexHtml):

```js
const indexPath = path.resolve(__dirname, "../../static/index.html");
const indexHtml = fs.readFileSync(indexPath, "utf8");

test("Floating ToC JSX — markup NotePanel", async (t) => {
  const notePanelMatch = indexHtml.match(/function NotePanel\(\{[\s\S]*?^function /m);
  const notePanelCode = notePanelMatch ? notePanelMatch[0] : "";
  assert.ok(notePanelCode.length > 0, "NotePanel harus ada di static/index.html");

  await t.test("trigger jadi anchor fixed (tanpa inline relative)", () => {
    assert.ok(notePanelCode.includes('className: "floating-toc-anchor"'), "wrapper pakai class floating-toc-anchor");
    assert.strictEqual(notePanelCode.includes('style: { position: "relative", display: "inline-block" }'), false, "inline style relative di wrapper harus dihapus");
  });

  await t.test("tombol lingkaran ikon saja (label Isi (N) hilang)", () => {
    assert.ok(notePanelCode.includes('React.createElement("span", null, "📑")'), "ikon 📑 ada");
    assert.strictEqual(notePanelCode.includes("`Isi (${tocItems.length})`"), false, "label teks Isi (N) harus hilang");
    assert.strictEqual(notePanelCode.includes('"▲" : "▼"'), false, "indikator panah harus hilang");
  });

  await t.test("popover tanpa positioning inline (CSS yang pegang)", () => {
    assert.strictEqual(notePanelCode.includes('top: "calc(100% + 6px)"'), false, "inline top popover lama harus hilang");
    assert.strictEqual(notePanelCode.includes('zIndex: 200'), false, "inline zIndex 200 popover harus hilang");
    assert.ok(notePanelCode.includes('className: "floating-toc-popover"'), "popover hanya pakai class");
  });

  await t.test("state tocActiveIdx + ref tocSpyRef + observer wiring", () => {
    assert.match(notePanelCode, /const \[tocActiveIdx, setTocActiveIdx\] = React\.useState\(null\)/, "state tocActiveIdx ada");
    assert.match(notePanelCode, /const tocSpyRef = React\.useRef\(null\)/, "ref tocSpyRef ada");
    assert.match(notePanelCode, /typeof IntersectionObserver === "undefined"/, "guard IntersectionObserver ada");
    assert.match(notePanelCode, /querySelectorAll\('\[id="note-h-"\]'\)/, "scope observer ke heading dalam container");
    assert.match(notePanelCode, /rootMargin: "-15% 0px -60% 0px"/, "band scroll-spy 15%–60%");
    assert.match(notePanelCode, /setTocActiveIdx\(parseInt\(m\[1\], 10\)\)/, "parse idx dari id heading");
  });

  await t.test("effect observer SETELAH deklarasi tocItems (regresi TDZ)", () => {
    const tocItemsIdx = notePanelCode.indexOf('const tocItems = useMemo(() => extractHeadings(note.content || ""), [note.content]);');
    const observerIdx = notePanelCode.indexOf("new IntersectionObserver");
    assert.ok(tocItemsIdx > -1 && observerIdx > -1, "kedua penanda ada");
    assert.ok(observerIdx > tocItemsIdx, "observer WAJIB setelah deklarasi tocItems (TDZ)");
  });

  await t.test("tocSpyRef terpasang di .note-rendered milik panel", () => {
    assert.match(notePanelCode, /className: "note-rendered",\s*ref: tocSpyRef/, "ref tocSpyRef di div note-rendered");
  });

  await t.test("item aktif via template class + klik set aktif instan", () => {
    assert.match(notePanelCode, /className: `note-toc-item\$\{tocActiveIdx === item\.idx \? " active" : ""\}`/, "class active pada item yang cocok");
    assert.match(notePanelCode, /setTocOpen\(false\);\s*setTocActiveIdx\(item\.idx\)/, "klik item langsung set active idx");
  });
});
```

- [ ] **Step 2: Jalankan test, pastikan GAGAL**

Run: `node --test tests/offline/note_toc.test.js`
Expected: FAIL pada suite JSX (markup belum diubah).

- [ ] **Step 3: Implementasi — 7 edit di `static/index.html`**

Semua edit di compiled output; `old_string` harus persis (perhatikan koma & indentasi). Periksa dulu setiap `old_string` unik dengan grep sebelum Edit.

**Edit 1 — wrapper jadi anchor (baris ~20412–20414):**

OLD:
```
  }, att.file_size > 1048576 ? (att.file_size / 1048576).toFixed(1) + 'MB' : Math.round(att.file_size / 1024) + 'KB'))))), tocItems.length >= 2 && /*#__PURE__*/React.createElement("div", {
    ref: tocRef,
    style: { position: "relative", display: "inline-block" }
  }, /*#__PURE__*/React.createElement("button", {
```

NEW:
```
  }, att.file_size > 1048576 ? (att.file_size / 1048576).toFixed(1) + 'MB' : Math.round(att.file_size / 1024) + 'KB'))))), tocItems.length >= 2 && /*#__PURE__*/React.createElement("div", {
    ref: tocRef,
    className: "floating-toc-anchor"
  }, /*#__PURE__*/React.createElement("button", {
```

**Edit 2 — tombol ikon-only (baris ~20420):**

OLD:
```
  }, /*#__PURE__*/React.createElement("span", null, "📑"), `Isi (${tocItems.length})`, /*#__PURE__*/React.createElement("span", { style: { fontSize: 9, opacity: 0.7 } }, tocOpen ? "▲" : "▼")),
```

NEW:
```
  }, /*#__PURE__*/React.createElement("span", null, "📑")),
```

**Edit 3 — popover tanpa inline style (baris ~20421–20429):**

OLD:
```
  tocOpen && /*#__PURE__*/React.createElement("div", {
    className: "floating-toc-popover scale-in",
    style: {
      position: "absolute",
      top: "calc(100% + 6px)",
      right: 0,
      zIndex: 200
    }
  }, /*#__PURE__*/React.createElement("div", {
```

NEW:
```
  tocOpen && /*#__PURE__*/React.createElement("div", {
    className: "floating-toc-popover"
  }, /*#__PURE__*/React.createElement("div", {
```

**Edit 4 — item dapat class aktif (baris ~20446–20447):**

OLD:
```
    key: item.idx,
    className: "note-toc-item",
    style: { paddingLeft: 6 + (item.level - 1) * 10 },
```

NEW:
```
    key: item.idx,
    className: `note-toc-item${tocActiveIdx === item.idx ? " active" : ""}`,
    style: { paddingLeft: 6 + (item.level - 1) * 10 },
```

**Edit 5 — klik item set aktif instan (baris ~20449–20453):**

OLD:
```
    onClick: () => {
      setTocOpen(false);
      const el = document.getElementById(`note-h-${item.idx}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    },
```

NEW:
```
    onClick: () => {
      setTocOpen(false);
      setTocActiveIdx(item.idx);
      const el = document.getElementById(`note-h-${item.idx}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    },
```

**Edit 6 — ref tocSpyRef di .note-rendered (baris ~20277–20279):**

OLD:
```
  }, /*#__PURE__*/React.createElement("div", {
    className: "note-rendered",
    style: {
      lineHeight: 1.75
    },
```

NEW:
```
  }, /*#__PURE__*/React.createElement("div", {
    className: "note-rendered",
    ref: tocSpyRef,
    style: {
      lineHeight: 1.75
    },
```

**Edit 7 — state + effect scroll-spy, SETELAH deklarasi tocItems (baris ~19553):**

OLD:
```
  const tocItems = useMemo(() => extractHeadings(note.content || ""), [note.content]);
```

NEW:
```
  const tocItems = useMemo(() => extractHeadings(note.content || ""), [note.content]);
  const [tocActiveIdx, setTocActiveIdx] = React.useState(null);
  const tocSpyRef = React.useRef(null);
  React.useEffect(() => {
    const container = tocSpyRef.current;
    if (!container || tocItems.length < 2 || typeof IntersectionObserver === "undefined") return;
    const headings = container.querySelectorAll('[id^="note-h-"]');
    if (!headings.length) return;
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(e => e.isIntersecting);
      if (!visible.length) return;
      let top = visible[0];
      for (let i = 1; i < visible.length; i++) {
        if (visible[i].boundingClientRect.top < top.boundingClientRect.top) top = visible[i];
      }
      const m = /note-h-(\d+)$/.exec(top.target.id);
      if (m) setTocActiveIdx(parseInt(m[1], 10));
    }, { root: null, rootMargin: "-15% 0px -60% 0px", threshold: 0 });
    headings.forEach(h => observer.observe(h));
    return () => observer.disconnect();
  }, [tocItems, note.id]);
```

**PENTING:** Jangan letakkan effect ini di blok state atas (~19320) — `tocItems` dideklarasikan di 19553; dependency array mengevaluasi `tocItems` saat render → TDZ ReferenceError (Babel pre-compile tidak transform `const`→`var`).

- [ ] **Step 4: Verifikasi parse + test**

Run:
1. `node scratch/check_inline.js static/index.html scratch/tmp_check` — Expected: 5/5 script OK (syntax error apa pun = seluruh app blank, ini yang terjadi pada bug `38cd66f`).
2. `node --test tests/offline/note_toc.test.js` — Expected: PASS semua (CSS + JSX).
3. `node --test "tests/offline/*.test.js"` — Expected: PASS semua (497 + test baru, 0 fail).

- [ ] **Step 5: Commit**

```bash
git add static/index.html tests/offline/note_toc.test.js
git commit -m "feat(notes): floating ToC button with scroll-spy active section

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: SW bump + verifikasi penuh + deploy + handover

**Files:**
- Modify: `static/sw.js` (1 baris)
- Modify: `.agents/CURRENT_STATE.md`, `.agents/SESSION_LOG.md` (handover)

**Interfaces:**
- Consumes: Task 1 CSS + Task 2 markup (sudah ter-commit).
- Produces: SW cache `taskflow-v300-floating-toc-fab` live.

- [ ] **Step 1: Bump SW cache**

OLD: `const CACHE = "taskflow-v299-fix-toc-syntax";`
NEW: `const CACHE = "taskflow-v300-floating-toc-fab";`

- [ ] **Step 2: Verifikasi penuh (WAJIB dijalankan & dibaca outputnya)**

```bash
node --check static/sw.js
node --test "tests/offline/*.test.js"
python -m pytest tests/
node scratch/check_inline.js static/index.html scratch/tmp_check
```
Expected: semua hijau (JS suite penuh, 43/43 pytest, 5/5 inline).

- [ ] **Step 3: Commit + push**

```bash
git add static/sw.js
git commit -m "chore(sw): bump cache taskflow-v300-floating-toc-fab

Co-Authored-By: Claude <noreply@anthropic.com>"
git push origin main
```

- [ ] **Step 4: Verifikasi live (JANGAN percaya Action hijau)**

```bash
curl -s https://todo.yatno.web.id/static/sw.js | head -1   # → taskflow-v300-floating-toc-fab
curl -s https://todo.yatno.web.id/ | grep -c "floating-toc-anchor"   # → ≥1
curl -s https://todo.yatno.web.id/static/app.css | grep -c "toc-pop-in"   # → ≥2
```
Poll SW sampai v300 muncul (deploy Actions butuh 1–3 menit).

- [ ] **Step 5: Update handover**

- `.agents/CURRENT_STATE.md`: ganti blok Active Task dengan ringkasan fitur ini (root cause lama sudah selesai) + device-test checklist.
- `.agents/SESSION_LOG.md`: append entri format standar.
- Commit + push `.agents/*`.

**Device-test checklist (untuk user):**
1. Desktop buka note dengan ≥2 heading → lingkaran 📑 muncul di kanan-tengah layar; artikel full-width (tidak ada baris tombol inline).
2. Klik lingkaran → popover membuka ke kiri; scroll artikel → item aktif ter-highlight mengikuti section.
3. Klik item → lompat mulus ke section, popover tertutup.
4. Klik di luar popover → menutup.
5. Mobile → FAB 📑 kecil di atas FAB + Buat Baru; popover membuka ke atas.
6. Dark mode → tombol & popover konsisten (bg-card/border).
7. Hard refresh (Ctrl+Shift+R) — SW cache lama menyajikan aset lama sampai SW baru aktif.
