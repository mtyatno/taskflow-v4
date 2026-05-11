# Notes Panel Wikilink Navigation Fix Plan

**Date:** 2026-05-11  
**Status:** In Progress

## Goal

Perbaiki klik `[[wikilink]]` pada panel kanan halaman **Notes & Draw** (renderer `marked`) agar membuka note target secara konsisten. Perubahan ini tidak mengubah perilaku editor Milkdown.

## Context

- Editor modal note memakai Milkdown.
- Panel kanan **Notes & Draw** memakai `marked.parse(...)` via `renderMarkdown(...)`.
- Bug terjadi pada klik hasil render panel kanan, bukan pada input editor.

## Root Cause

Resolver link di panel kanan mengandalkan `data-wiki-title` + pencarian title langsung. Ini rapuh pada variasi case/whitespace/simbol, duplikasi title, dan data lama.

## Scope

- **In scope**
  - `static/index.html`:
    - helper parser/normalizer wikilink
    - `renderMarkdown(...)`
    - `NotePanel` click resolver
    - panggilan render panel + print
- **Out of scope**
  - plugin Milkdown editor
  - backend API

## Resolution Rule

- `[[123]]` diperlakukan sebagai **title terlebih dahulu**, jika tidak ketemu baru fallback ke ID.

## Implementation Steps

### Step 1 — Add helpers

Tambahkan helper berikut di area util markdown:

```js
function normalizeWikiText(s = "") {
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function escapeHtml(s = "") {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(s = "") {
  return escapeHtml(String(s)).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function parseWikilinkRaw(raw = "") {
  let token = String(raw).trim();
  token = token.replace(/^\[+/, "").replace(/\]+$/, "").trim();

  const parts = token.split("|");
  const left = (parts[0] || "").trim();
  const label = (parts[1] || "").trim();

  let explicitId = null;
  const m = left.match(/^(?:id|note)\s*:\s*(\d+)$/i);
  if (m) explicitId = m[1];

  return { raw: token, title: left, label: label || left, explicitId };
}
```

### Step 2 — Upgrade markdown rendering metadata

Ubah `renderMarkdown` agar menerima `allNotes` dan menambahkan atribut:

```js
function renderMarkdown(text, noteTitles = [], allNotes = []) { ... }
```

Untuk wikilink valid, output span minimal:

```html
<span class="wikilink" data-wiki-id="..." data-wiki-title="..." data-wiki-raw="...">...</span>
```

Untuk broken link, simpan metadata `data-wiki-title` dan `data-wiki-raw` agar fallback resolver tetap bisa berjalan.

### Step 3 — Add deterministic note lookup maps

Di `NotePanel`, tambah memoized maps:

```js
const notesById = useMemo(() => new Map((allNotes || []).map(n => [String(n.id), n])), [allNotes]);

const notesByNormTitle = useMemo(() => {
  const map = new Map();
  for (const n of allNotes || []) {
    const key = normalizeWikiText(n.title || "");
    if (key && !map.has(key)) map.set(key, n);
  }
  return map;
}, [allNotes]);
```

### Step 4 — Strengthen click resolver in NotePanel

Ubah `handlePreviewClick` dengan urutan resolve:

1. `data-wiki-id`
2. `data-wiki-title` (title-first)
3. `data-wiki-raw` parse fallback (`id:` support)

Jika target ditemukan, panggil `onNavigate(target)`.

### Step 5 — Use updated render function consistently

Pastikan call site panel kanan dan print memakai signature baru:

```js
renderMarkdown(note.content || "", titleStrings, allNotes)
```

## Code QC Crosscheck (Plan vs Implementation)

QC harus memverifikasi:

1. Ada helper: `normalizeWikiText`, `escapeAttr`, `parseWikilinkRaw`.
2. `renderMarkdown` menerima argumen `allNotes`.
3. Output wikilink menyertakan `data-wiki-id` saat target ditemukan.
4. `handlePreviewClick` resolve dengan urutan id -> title -> raw fallback.
5. Rule `[[123]]` tetap title-first.
6. Tidak ada perubahan logic Milkdown editor.

## Functional Checks

1. `[[Existing Note]]` bisa klik dan membuka note target.
2. `[[id:123]]` membuka note ID 123.
3. `[[123]]` tetap title-first.
4. `[[Title|Alias]]` tampil alias dan tetap navigasi ke title.
5. Link dengan karakter quote/simbol tidak merusak HTML dan tetap klikable.
6. Broken wikilink tidak crash UI.
