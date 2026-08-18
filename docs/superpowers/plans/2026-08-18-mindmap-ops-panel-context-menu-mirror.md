# Mindmap Ops Panel — Context-Menu Mirror Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every right-click context-menu action reachable on tablet/phone by mirroring them as buttons in the iframe's 🔧 Ops panel.

**Architecture:** A new pure UMD module `static/offline/mindmapops.js` holds the testable logic (engine's node-topic check + root-guard flags); the iframe (`static/vendor/mind-elixir/index.html`) gets 8 new buttons whose handlers call public engine methods on the existing `mind` instance (`insertParent`, `focusNode`, `cancelFocus`, `moveUpNode`, `moveDownNode`, `createSummary`, `createArrow`). Persistence needs no changes — these methods fire the engine's `operation` bus event, which the iframe's existing listener already forwards as `change` → parent saves `data_json` (verified: `getData()` returns the FULL tree even during focus mode).

**Tech Stack:** Vanilla JS (UMD modules, no build), node:test for unit tests, mind-elixir 5.15.1 (vendored, NOT modified).

**Spec:** `docs/superpowers/specs/2026-08-18-mindmap-ops-panel-context-menu-mirror-design.md`

## Global Constraints

- **SW cache bump WAJIB** setiap ubah aset static: `static/sw.js` baris `const CACHE = ...` (saat ini `taskflow-v234-mindmap-header-wrap`) — cache-first tanpa bump = device sajikan file lama.
- **Bump `?v=` wajib** pada referensi aset ber-URL stabil: parent memuat iframe via `/static/vendor/mind-elixir/index.html?v=132` (static/index.html:9048) → naikkan ke `?v=133`.
- **JANGAN sentuh `static/vendor/mind-elixir/MindElixir.iife.js` / `MindElixir.css`** (engine vendored, no fork; `?v=120` mereka tetap).
- **Suite test harus tetap hijau**: baseline 402 pass (npm test, node --test tests/offline/*.test.js).
- **Label tombol = English persis context menu** (spec §3): Parent, Focus Mode, Cancel Focus Mode, Move up, Move down, Summary, Link, Bidirectional Link.
- UMD module pattern: tiru `static/offline/mindmapoutline.js` baris 1-8 (root.TF namespace, module.exports untuk node).
- Konvensi commit repo: `type(scope): summary` + baris `Co-Authored-By: Claude <noreply@anthropic.com>`.

---

### Task 1: Pure module `mindmapops.js` + unit tests (TDD)

**Files:**
- Create: `static/offline/mindmapops.js`
- Test: `tests/offline/mindmap_ops.test.js`

**Interfaces:**
- Produces (dipakai Task 3):
  - `window.TF.mindmapops.isNodeTopicTarget(el) -> bool` — true jika `el.parentElement.tagName` adalah `ME-PARENT` atau `ME-ROOT` (cek persis yang dipakai engine sebelum `createArrow`).
  - `window.TF.mindmapops.resolveTopicTarget(el) -> Element|null` — walk ke atas dari click target ke `me-tpc` terdekat, lalu cek `isNodeTopicTarget`; null kalau tidak ada. (Improvement kecil vs engine: tap yang jatuh di teks dalam node tetap resolve; engine pakai `parentElement` mentah.)
  - `window.TF.mindmapops.opsDisabledStates(isRoot) -> {parent, focus, moveUp, moveDown}` — semua `!!isRoot` (mirror flag `C` context menu engine).

- [ ] **Step 1: Tulis failing test**

`tests/offline/mindmap_ops.test.js`:

```js
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const OPS = require("../../static/offline/mindmapops.js");

const el = (tag, parent) => ({ tagName: tag, parentElement: parent });

test("isNodeTopicTarget: hanya me-tpc di dalam ME-PARENT / ME-ROOT", () => {
  const parent = el("ME-PARENT", el("ME-CHILD", null));
  assert.equal(OPS.isNodeTopicTarget(el("ME-TPC", parent)), true);
  assert.equal(OPS.isNodeTopicTarget(el("ME-TPC", el("ME-ROOT", null))), true);
  assert.equal(OPS.isNodeTopicTarget(el("ME-TPC", el("ME-CHILD", null))), false);
  assert.equal(OPS.isNodeTopicTarget(null), false);
  assert.equal(OPS.isNodeTopicTarget(el("SPAN", parent)), false);
});

test("resolveTopicTarget: walk dari inner text ke me-tpc", () => {
  const parent = el("ME-PARENT", el("ME-CHILD", el("ME-CHILDREN", null)));
  const tpc = el("ME-TPC", parent);
  const span = el("SPAN", tpc);
  assert.equal(OPS.resolveTopicTarget(span), tpc);
  assert.equal(OPS.resolveTopicTarget(tpc), tpc);
  // tap di area kosong map / node tanpa parent valid
  assert.equal(OPS.resolveTopicTarget(el("DIV", el("ME-MAP", null))), null);
  assert.equal(OPS.resolveTopicTarget(el("ME-TPC", el("ME-CHILD", null))), null);
  assert.equal(OPS.resolveTopicTarget(null), null);
});

test("opsDisabledStates mirror flag root context menu engine", () => {
  assert.deepEqual(OPS.opsDisabledStates(true),
    { parent: true, focus: true, moveUp: true, moveDown: true });
  assert.deepEqual(OPS.opsDisabledStates(false),
    { parent: false, focus: false, moveUp: false, moveDown: false });
});
```

- [ ] **Step 2: Jalankan — pastikan FAIL**

Run: `node --test tests/offline/mindmap_ops.test.js`
Expected: FAIL (`Cannot find module '../../static/offline/mindmapops.js'`)

- [ ] **Step 3: Implementasi module**

`static/offline/mindmapops.js`:

```js
;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    root.TF.mindmapops = factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  // Pure helpers for the iframe Ops panel (context-menu mirror).

  // The engine's context menu allows createArrow only when the click target
  // is a node topic (me-tpc) whose parent element is ME-PARENT or ME-ROOT.
  function isNodeTopicTarget(el) {
    if (!el || !el.parentElement) return false;
    const t = el.parentElement.tagName;
    return t === "ME-PARENT" || t === "ME-ROOT";
  }

  // Walk up from a map click target to the enclosing me-tpc, then apply the
  // engine's exact parent check. (Improvement over the engine's raw
  // parentElement check: taps landing on text inside a topic still resolve.)
  function resolveTopicTarget(el) {
    let cur = el;
    while (cur && cur.tagName !== "ME-TPC") cur = cur.parentElement;
    return cur && isNodeTopicTarget(cur) ? cur : null;
  }

  // Buttons the engine's context menu disables when the selected node is
  // the root (its C flag): addParent, focus, moveUp, moveDown.
  function opsDisabledStates(isRoot) {
    return {
      parent: !!isRoot,
      focus: !!isRoot,
      moveUp: !!isRoot,
      moveDown: !!isRoot,
    };
  }

  return {
    isNodeTopicTarget: isNodeTopicTarget,
    resolveTopicTarget: resolveTopicTarget,
    opsDisabledStates: opsDisabledStates,
  };
});
```

- [ ] **Step 4: Jalankan — pastikan PASS**

Run: `node --test tests/offline/mindmap_ops.test.js`
Expected: 3/3 pass

- [ ] **Step 5: Commit**

```bash
git add static/offline/mindmapops.js tests/offline/mindmap_ops.test.js
git commit -m "feat(mindmap): pure mindmapops module — node-topic resolve + ops root-guard

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Iframe markup — CSS hint + 8 tombol + script include (belum ada logic)

**Files:**
- Modify: `static/vendor/mind-elixir/index.html` (3 titik: `<style>` block, `#node-ops-panel`, script includes)
- Modify: `temporary_files/check_inline_scripts.js` (terima argumen file)

**Interfaces:**
- Consumes: module Task 1 (dimuat via `<script src="/static/offline/mindmapops.js?v=1"></script>`).
- Produces: id tombol yang dipakai Task 3: `ntb-parent`, `ntb-focus`, `ntb-cancelfocus`, `ntb-moveup`, `ntb-movedown`, `ntb-summary`, `ntb-link`, `ntb-linkbi`; id hint `ops-link-hint`.

- [ ] **Step 1: CSS** — sisipkan setelah blok rule `#node-ops-panel` (baris ~131-134 file):

```css
    #node-ops-panel button:disabled { opacity: 0.4; cursor: default; }
    #node-ops-panel button:disabled:hover, #node-ops-panel button:disabled:active { background: none; }
    #ops-link-hint {
      position: fixed;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--side-accent);
      color: var(--side-accent-ink);
      padding: 8px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
      font-family: system-ui, sans-serif;
      z-index: 9999;
      pointer-events: none;
      box-shadow: 0 4px 16px rgba(0,0,0,0.25);
      display: none;
    }
```

- [ ] **Step 2: 8 tombol baru di `#node-ops-panel`** — ganti isi panel (baris 316-324) menjadi (urutan persis spec §3):

```html
        <div id="node-ops-panel">
          <button id="ntb-child" title="Tambah Child (Tab)">↳<span class="lbl">Child</span></button>
          <button id="ntb-sibling" title="Tambah Sibling (Enter)">↵<span class="lbl">Sibling</span></button>
          <button id="ntb-promote" title="Naikan level — jadi sibling dari parent">↑<span class="lbl">Promote</span></button>
          <button id="ntb-parent" title="Tambah Parent (Ctrl+Enter)">⤴<span class="lbl">Parent</span></button>
          <div class="sep"></div>
          <button id="ntb-edit" title="Edit teks node (F2)">✏️<span class="lbl">Edit</span></button>
          <div class="sep"></div>
          <button id="ntb-focus" title="Focus Mode — tampilkan hanya subtree node ini">🎯<span class="lbl">Focus Mode</span></button>
          <button id="ntb-cancelfocus" title="Cancel Focus Mode — kembalikan peta penuh">🎯<span class="lbl">Cancel Focus Mode</span></button>
          <button id="ntb-moveup" title="Move up (PgUp)">⇧<span class="lbl">Move up</span></button>
          <button id="ntb-movedown" title="Move down (PgDn)">⇩<span class="lbl">Move down</span></button>
          <button id="ntb-summary" title="Summary — buat node ringkasan dari seleksi">⧉<span class="lbl">Summary</span></button>
          <button id="ntb-link" title="Link — hubungkan panah ke node lain (tap target)">🔗<span class="lbl">Link</span></button>
          <button id="ntb-linkbi" title="Bidirectional Link — panah dua arah (tap target)">⇄<span class="lbl">Bidirectional Link</span></button>
          <div class="sep"></div>
          <button id="ntb-delete" class="danger" title="Hapus node (Delete)">🗑️<span class="lbl">Hapus</span></button>
        </div>
```

- [ ] **Step 3: Script include module** — di `<head>` bawah, setelah baris `<script src="/static/offline/mindmapoutline.js?v=125"></script>` (baris 338), tambah:

```html
  <script src="/static/offline/mindmapops.js?v=1"></script>
```

- [ ] **Step 4: Generalisasi checker sintaks** — `temporary_files/check_inline_scripts.js`, ganti baris:

```js
const html = fs.readFileSync(path.join(__dirname, '..', 'static', 'index.html'), 'utf8');
```

menjadi:

```js
const htmlPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(__dirname, '..', 'static', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
```

(`path` sudah di-require di file ini.)

- [ ] **Step 5: Verifikasi sintaks iframe**

Run: `node temporary_files/check_inline_scripts.js static/vendor/mind-elixir/index.html`
Expected: `OK — ... inline scripts parse clean` (iframe punya 1 inline script)

- [ ] **Step 6: Commit**

```bash
git add static/vendor/mind-elixir/index.html temporary_files/check_inline_scripts.js
git commit -m "feat(mindmap): Ops panel markup — 8 context-menu mirror buttons + hint CSS

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Iframe wiring — handler + root-guard + link flow 2 langkah

**Files:**
- Modify: `static/vendor/mind-elixir/index.html` (inline script, semua perubahan di dalam fungsi `initMind(data)`)

**Interfaces:**
- Consumes: id tombol (Task 2), `window.TF.mindmapops` (Task 1), metode publik engine terverifikasi: `mind.insertParent()`, `mind.focusNode(el)` (el = elemen node, guard internal `nodeObj.parent`), `mind.cancelFocus()`, `mind.moveUpNode()`, `mind.moveDownNode()` (no-arg pakai `this.currentNode`, guard root internal), `mind.createSummary()` (pakai `this.currentNodes`), `mind.createArrow(fromEl, toEl, {bidirectional})` (elemen; fire `operation` → tersimpan).
- Produces: fungsi lokal `refreshOpsDisabled()`, `startLinkFlow(bidirectional)`, `cancelLinkFlow()` (dipakai juga oleh handler message di Task 3 ini).

- [ ] **Step 1: Variabel module-level** — setelah deklarasi `unselectTimer` (sekitar baris 346), tambah:

```js
    let linkFlowActive = false;
    let linkClickHandler = null;
    let linkHintEl = null;
```

- [ ] **Step 2: Fungsi link flow + hint + root-guard** — sisipkan sebelum `function initMind(data)` (sekitar baris 649):

```js
    function showLinkHint() {
      if (!linkHintEl) {
        linkHintEl = document.createElement('div');
        linkHintEl.id = 'ops-link-hint';
        document.getElementById('app').appendChild(linkHintEl);
      }
      linkHintEl.textContent = 'Tap node target';
      linkHintEl.style.display = 'block';
    }
    function hideLinkHint() {
      if (linkHintEl) linkHintEl.style.display = 'none';
    }
    function cancelLinkFlow() {
      if (linkClickHandler) {
        document.getElementById('map').removeEventListener('click', linkClickHandler);
        linkClickHandler = null;
      }
      linkFlowActive = false;
      hideLinkHint();
    }
    function startLinkFlow(bidirectional) {
      const sourceEl = mind.currentNodes && mind.currentNodes.length ? mind.currentNodes[0] : null;
      if (!sourceEl || linkFlowActive) return;
      linkFlowActive = true;
      showLinkHint();
      const mapEl = document.getElementById('map');
      linkClickHandler = (E) => {
        E.preventDefault();
        cancelLinkFlow();
        const tpc = window.TF.mindmapops.resolveTopicTarget(E.target);
        if (tpc) mind.createArrow(sourceEl, tpc, { bidirectional: bidirectional });
      };
      mapEl.addEventListener('click', linkClickHandler, { once: true });
    }
    function refreshOpsDisabled() {
      const isRoot = !!(currentNodeData && !currentNodeData.parent);
      const d = window.TF.mindmapops.opsDisabledStates(isRoot);
      document.getElementById('ntb-parent').disabled = d.parent;
      document.getElementById('ntb-focus').disabled = d.focus;
      document.getElementById('ntb-moveup').disabled = d.moveUp;
      document.getElementById('ntb-movedown').disabled = d.moveDown;
    }
```

- [ ] **Step 3: Panggil `refreshOpsDisabled()` di wrapped `selectNode`** — di dalam `mind.selectNode = el => {...}`, tepat setelah baris `switchTab('ops');` (sekitar baris 687), tambah:

```js
        refreshOpsDisabled();
```

- [ ] **Step 4: Batalkan link flow saat deselect** — di wrapped `mind.unselectNodes`, dalam callback `setTimeout` (sekitar baris 697-703), tambah sebagai baris pertama:

```js
          cancelLinkFlow();
```

- [ ] **Step 5: Handler 8 tombol baru** — sisipkan setelah handler `ntb-delete` (sekitar baris 735):

```js
      document.getElementById('ntb-parent').onclick = () => {
        if (!mind.currentNodes || mind.currentNodes.length === 0) return;
        if (!mind.currentNodes[0].nodeObj || !mind.currentNodes[0].nodeObj.parent) return;
        mind.insertParent();
      };
      document.getElementById('ntb-focus').onclick = () => {
        const el = mind.currentNodes && mind.currentNodes.length ? mind.currentNodes[0] : null;
        if (el && el.nodeObj && el.nodeObj.parent) mind.focusNode(el);
        // Catatan: focusNode clearSelection → panel Ops sembunyi (mirror desktop).
        // User tap node lain → panel muncul lagi, tombol Cancel Focus Mode tersedia.
      };
      document.getElementById('ntb-cancelfocus').onclick = () => { mind.cancelFocus(); };
      document.getElementById('ntb-moveup').onclick = () => {
        const el = mind.currentNodes && mind.currentNodes.length ? mind.currentNodes[0] : null;
        if (el && el.nodeObj && el.nodeObj.parent) mind.moveUpNode();
      };
      document.getElementById('ntb-movedown').onclick = () => {
        const el = mind.currentNodes && mind.currentNodes.length ? mind.currentNodes[0] : null;
        if (el && el.nodeObj && el.nodeObj.parent) mind.moveDownNode();
      };
      document.getElementById('ntb-summary').onclick = () => {
        if (mind.currentNodes && mind.currentNodes.length) mind.createSummary();
      };
      document.getElementById('ntb-link').onclick = () => startLinkFlow(false);
      document.getElementById('ntb-linkbi').onclick = () => startLinkFlow(true);
```

- [ ] **Step 6: Batalkan link flow di handler message** — di `window.addEventListener('message', ...)`:
  - di cabang `e.data.type === 'load'` (sekitar baris 895): tambah `cancelLinkFlow();` setelah `clearTimeout(unselectTimer);`
  - di cabang `'refresh'` (sekitar baris 913): tambah `cancelLinkFlow();` setelah `clearTimeout(unselectTimer);`
  - di cabang `'clearPanel'` (sekitar baris 940): tambah `cancelLinkFlow();` setelah `clearTimeout(unselectTimer);`

- [ ] **Step 7: Verifikasi sintaks + suite**

Run: `node temporary_files/check_inline_scripts.js static/vendor/mind-elixir/index.html`
Expected: parse clean
Run: `npm test`
Expected: 402 pass + 3 test baru Task 1 = 405, 0 fail

- [ ] **Step 8: Commit**

```bash
git add static/vendor/mind-elixir/index.html
git commit -m "feat(mindmap): wire Ops panel mirror buttons — focus/summary/link/move/parent

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Version bumps — iframe ?v + SW cache

**Files:**
- Modify: `static/index.html:9048`
- Modify: `static/sw.js:1`

- [ ] **Step 1: Bump referensi iframe**

`static/index.html` baris 9048: `src: "/static/vendor/mind-elixir/index.html?v=132"` → `src: "/static/vendor/mind-elixir/index.html?v=133"`

- [ ] **Step 2: Bump SW cache**

`static/sw.js` baris 1: `const CACHE = "taskflow-v234-mindmap-header-wrap";` → `const CACHE = "taskflow-v235-mindmap-ops-context-actions";`

- [ ] **Step 3: Verifikasi**

Run: `node temporary_files/check_inline_scripts.js` (static/index.html default) — Expected: parse clean
Run: `npm test` — Expected: 405 pass 0 fail

- [ ] **Step 4: Commit**

```bash
git add static/index.html static/sw.js
git commit -m "chore(mindmap): bump iframe ?v=133 + SW cache v235 for Ops mirror buttons

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Final verification & push

- [ ] **Step 1: Full suite** — Run: `npm test` → 405/405 pass, 0 fail
- [ ] **Step 2: Sintaks semua inline script** — Run: `node temporary_files/check_inline_scripts.js` dan `node temporary_files/check_inline_scripts.js static/vendor/mind-elixir/index.html` → keduanya parse clean
- [ ] **Step 3: Diff review** — Run: `git diff HEAD~4..HEAD --stat` → hanya 5 file: `static/offline/mindmapops.js`, `tests/offline/mindmap_ops.test.js`, `static/vendor/mind-elixir/index.html`, `static/index.html` (1 baris), `static/sw.js` (1 baris). Engine vendored TIDAK tersentuh.
- [ ] **Step 4: Push** — `git push origin main`
- [ ] **Step 5: Verifikasi live (curl)** — `curl -s https://todo.yatno.web.id/static/sw.js | head -1` → `taskflow-v235-mindmap-ops-context-actions`; `curl -s https://todo.yatno.web.id/static/vendor/mind-elixir/index.html | grep -c ntb-cancelfocus` → ≥ 1
- [ ] **Step 6: Update handover** — `.agents/CURRENT_STATE.md` + `.agents/SESSION_LOG.md`; checklist device-test untuk user:
  1. Ponsel/tablet → mindmap → buka sidebar (▸) → pilih node → Ops tampilkan 13 tombol.
  2. Focus Mode → hanya subtree tampil → tap node → Cancel Focus Mode → peta penuh kembali.
  3. Move up/down urutkan sibling; Summary buat node ringkasan.
  4. Link → hint "Tap node target" → tap node lain → panah tergambar → reload → panah masih ada (tersimpan di data_json).
  5. Bidirectional Link → panah dua arah, persisten setelah reload.
  6. Node root dipilih → Parent/Focus/Move up/Move down disabled.
  7. Desktop: context menu klik kanan tidak berubah, semua item masih jalan.
