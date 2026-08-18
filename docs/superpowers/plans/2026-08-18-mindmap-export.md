# Mindmap Export (PNG/SVG) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a PNG + SVG export row at the top of the mindmap iframe's right sidebar, using the engine's built-in `exportSvg`/`exportPng`, with the download filename derived from the mindmap title.

**Architecture:** One new pure helper (`safeExportName`) joins the existing tested module `static/offline/mindmapops.js`; the iframe gets two buttons wired to `mind.exportPng()`/`mind.exportSvg()` plus a blob-download trigger; the parent passes the mindmap title in the existing `load` message. Version bumps per the project's cache-first rules.

**Tech Stack:** Vanilla JS, engine mind-elixir 5.15.1 built-in export (verified: `exportSvg(excludeLinkText=false,opts)` → Blob; `exportPng(excludeLinkText=false,opts)` → async Blob via canvas).

**Spec:** `docs/superpowers/specs/2026-08-18-mindmap-export-design.md`

## Global Constraints

- **SW cache bump WAJIB** setiap ubah aset static: `static/sw.js` baris 1 (saat ini `taskflow-v235-mindmap-ops-context-actions`) → `taskflow-v236-mindmap-export`.
- **Bump `?v=` wajib** pada referensi aset ber-URL stabil: `static/offline/mindmapops.js?v=1` (di iframe) → `?v=2` (file-nya dimodifikasi); iframe parent ref `/static/vendor/mind-elixir/index.html?v=133` (static/index.html:9048) → `?v=134`.
- **JANGAN sentuh `static/vendor/mind-elixir/MindElixir.iife.js` / `MindElixir.css`** (engine vendored).
- **Suite test tetap hijau**: baseline 405 + test baru `safeExportName` (~4) = ~409.
- **UMD module pattern**: edit `static/offline/mindmapops.js` mengikuti pola yang ada (root.TF, module.exports).
- Konvensi commit: `type(scope): summary` + `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Label/teks UI: judul tooltip bahasa Indonesia ("Ekspor PNG (gambar)", "Ekspor SVG (vektor)"); nama file otomatis.

---

### Task 1: Pure helper `safeExportName` + unit tests (TDD)

**Files:**
- Modify: `static/offline/mindmapops.js` (tambah 1 export; jangan ubah 3 export lama)
- Test: `tests/offline/mindmap_ops.test.js` (tambah test baru; jangan ubah test lama)

**Interfaces:**
- Produces: `window.TF.mindmapops.safeExportName(title, ext) -> string` — sanitasi nama file: ganti `[\\/:*?"<>|]` dan karakter kontrol → `-`, trim, kolaps whitespace beruntun → satu spasi, fallback `"mindmap"` kalau hasil kosong, return `` `${name}.${ext}` ``. Dipakai Task 3.

- [ ] **Step 1: Tulis failing test** — tambahkan di `tests/offline/mindmap_ops.test.js`:

```js
test("safeExportName: sanitasi karakter path-hostile, fallback, ekstensi", () => {
  assert.equal(OPS.safeExportName("Rencana Q3: /v1", "png"), "Rencana Q3- -v1.png");
  assert.equal(OPS.safeExportName('a\\b/c:d*e?f"g<h>i|j', "svg"), "a-b-c-d-e-f-g-h-i-j.svg");
  assert.equal(OPS.safeExportName("   ", "png"), "mindmap.png");
  assert.equal(OPS.safeExportName("", "svg"), "mindmap.svg");
  assert.equal(OPS.safeExportName(null, "png"), "mindmap.png");
  assert.equal(OPS.safeExportName("  Rencana   Akhir\tTahun  ", "png"), "Rencana Akhir Tahun.png");
});
```

- [ ] **Step 2: Jalankan — pastikan FAIL**

Run: `node --test tests/offline/mindmap_ops.test.js`
Expected: FAIL (`OPS.safeExportName is not a function`)

- [ ] **Step 3: Implementasi** — di `static/offline/mindmapops.js`, sebelum blok `return {`, tambah:

```js
  // safeExportName(title, ext): sanitasi judul mindmap jadi nama file yang
  // aman di semua OS (ganti karakter path-hostile dan kontrol dengan "-"),
  // fallback "mindmap" kalau kosong, lalu tambahkan ekstensi.
  function safeExportName(title, ext) {
    const raw = typeof title === "string" ? title : "";
    const cleaned = raw
      .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
    const name = cleaned || "mindmap";
    return name + "." + ext;
  }
```

dan tambahkan `safeExportName: safeExportName,` ke objek `return {`.

- [ ] **Step 4: Jalankan — pastikan PASS**

Run: `node --test tests/offline/mindmap_ops.test.js`
Expected: 4/4 pass (3 lama + 1 baru)

- [ ] **Step 5: Commit**

```bash
git add static/offline/mindmapops.js tests/offline/mindmap_ops.test.js
git commit -m "feat(mindmap): safeExportName helper in mindmapops module

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Iframe markup — export row (CSS + HTML, tanpa logic)

**Files:**
- Modify: `static/vendor/mind-elixir/index.html` (2 titik: `<style>` block + `#side-panel` HTML)

- [ ] **Step 1: CSS** — sisipkan sebelum rule `#side-tabs` (sekitar baris 50):

```css
    #export-row { display: flex; gap: 4px; padding: 8px 8px 4px; flex-shrink: 0; }
    #export-row button {
      flex: 1;
      background: var(--side-card);
      border: 1px solid var(--side-border);
      border-radius: 6px;
      color: var(--side-text);
      font-size: 11px;
      font-weight: 600;
      font-family: system-ui, sans-serif;
      padding: 5px 0;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
    }
    #export-row button:hover, #export-row button:active { background: var(--side-hover); border-color: var(--side-accent); }
    #export-row button:disabled { opacity: 0.4; cursor: default; }
```

- [ ] **Step 2: HTML** — di dalam `#side-panel`, SEBELUM `<div id="side-tabs">` (sekitar baris 289), sisipkan:

```html
      <div id="export-row">
        <button id="export-png" title="Ekspor PNG (gambar)">🖼 PNG</button>
        <button id="export-svg" title="Ekspor SVG (vektor)">📄 SVG</button>
      </div>
```

- [ ] **Step 3: Verifikasi sintaks**

Run: `node temporary_files/check_inline_scripts.js static/vendor/mind-elixir/index.html`
Expected: parse clean

- [ ] **Step 4: Commit**

```bash
git add static/vendor/mind-elixir/index.html
git commit -m "feat(mindmap): export row markup — PNG/SVG buttons above sidebar tabs

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Wiring — export handlers + title dari parent

**Files:**
- Modify: `static/vendor/mind-elixir/index.html` (inline script)
- Modify: `static/index.html` (1 baris: `load` message ditambah `title`)

**Interfaces:**
- Consumes: `window.TF.mindmapops.safeExportName` (Task 1), tombol `#export-png`/`#export-svg` (Task 2), `mind.exportPng()` / `mind.exportSvg()` (engine, terverifikasi).
- Produces: variabel `currentMindmapTitle` (dipakai handler export).

- [ ] **Step 1: Variabel title** — dekat `let mind = null;` (sekitar baris 340), tambah:

```js
    let currentMindmapTitle = "mindmap";
```

- [ ] **Step 2: Tangkap title di message `load`** — di cabang `e.data.type === 'load'` (sekitar baris 895), setelah `initMind(e.data.data);`, tambah:

```js
        currentMindmapTitle = (typeof e.data.title === "string" && e.data.title.trim()) ? e.data.title.trim() : "mindmap";
```

- [ ] **Step 3: Handler export** — sisipkan setelah blok handler 8 tombol Ops (setelah handler `ntb-linkbi`, sekitar baris 837), masih di dalam `initMind`:

```js
      // ── Export PNG/SVG (engine built-in) ─────────────────────────
      let exporting = false;
      const downloadBlob = (blob, filename) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      };
      const doExport = async (kind) => {
        if (!mind || exporting) return;
        exporting = true;
        try {
          const blob = kind === "png" ? await mind.exportPng() : mind.exportSvg();
          downloadBlob(blob, window.TF.mindmapops.safeExportName(currentMindmapTitle, kind));
        } catch (_) {
          // engine export gagal — diam saja (tanpa toast; iframe tak punya toast)
        } finally {
          exporting = false;
        }
      };
      document.getElementById("export-png").onclick = () => doExport("png");
      document.getElementById("export-svg").onclick = () => doExport("svg");
```

- [ ] **Step 4: Parent kirim title** — `static/index.html` di fungsi `sendLoad` (sekitar baris 8300-8303), ubah payload jadi:

```js
        iframeRef.current?.contentWindow?.postMessage({
          type: "load",
          data: tree,
          title: selected?.title || ""
        }, window.location.origin);
```

- [ ] **Step 5: Verifikasi**

Run: `node temporary_files/check_inline_scripts.js static/vendor/mind-elixir/index.html` dan `node temporary_files/check_inline_scripts.js`
Expected: keduanya parse clean
Run: `npm test`
Expected: 409 pass 0 fail

- [ ] **Step 6: Commit**

```bash
git add static/vendor/mind-elixir/index.html static/index.html
git commit -m "feat(mindmap): wire PNG/SVG export buttons + pass title via load message

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Version bumps

**Files:**
- Modify: `static/vendor/mind-elixir/index.html` (ref module `mindmapops.js?v=1` → `?v=2`)
- Modify: `static/index.html:9048` (iframe `?v=133` → `?v=134`)
- Modify: `static/sw.js:1` (CACHE → `taskflow-v236-mindmap-export`)

- [ ] **Step 1: Tiga edit persis** (grep konfirmasi string saat ini dulu):

```
/static/offline/mindmapops.js?v=1      → /static/offline/mindmapops.js?v=2
/static/vendor/mind-elixir/index.html?v=133 → ...?v=134
taskflow-v235-mindmap-ops-context-actions → taskflow-v236-mindmap-export
```

- [ ] **Step 2: Verifikasi** — checker keduanya + `npm test` (409 pass 0 fail)

- [ ] **Step 3: Commit**

```bash
git add static/vendor/mind-elixir/index.html static/index.html static/sw.js
git commit -m "chore(mindmap): bump mindmapops ?v=2 + iframe ?v=134 + SW cache v236 for export

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Final verification & push

- [ ] **Step 1:** `npm test` → 409/409 pass 0 fail
- [ ] **Step 2:** checker keduanya parse clean
- [ ] **Step 3:** `git diff --stat <merge-base>..HEAD` — hanya: mindmapops.js, mindmap_ops.test.js, iframe index.html, static/index.html, sw.js (+ spec/plan docs). Engine vendored tak tersentuh.
- [ ] **Step 4:** `git push origin main`
- [ ] **Step 5:** Verifikasi live curl: `sw.js` head-1 = `taskflow-v236-mindmap-export`; iframe `?v=134` mengandung `id="export-png"`; `mindmapops.js?v=2` mengandung `safeExportName`.
- [ ] **Step 6:** Handover `.agents/CURRENT_STATE.md` + `.agents/SESSION_LOG.md` + checklist device-test user (7 item dari spec §7).
