# Notes Sidebar 3-Baris + Tabs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Panel kiri NotesPage jadi 3 baris operasi (search, tags, tabs) + daftar note full-scroll; tab All/Pinned/Pub/Shared menggantikan pill Published/Shared dan accordion pinned.

**Architecture:** Refactor state NotesPage: `filterPublished` + `filterListId` + `pinnedExpanded` → satu `notesTab`; `applyFilters` jadi tab-aware (`tab ∩ tags ∩ search`); JSX: header di-merge dengan subheader, tags row dirampingkan, baris tabs baru `.notes-tabs`, accordion pinned dihapus; CSS: flex-shrink:0 zona kontrol + min-height:0 list.

**Tech Stack:** Compiled React output di static/index.html (edit langsung, NO compile.js), CSS di static/app.css, node:test + pytest.

**Spec:** `docs/superpowers/specs/2026-08-23-notes-sidebar-tabs-design.md`

## Global Constraints

- `static/index.html` compiled output — edit langsung; JANGAN jalankan compile.js; JANGAN tambah JSX.
- Setiap ubah static → wajib bump SW (`static/sw.js`).
- JS tests: `node --test "tests/offline/*.test.js"` LAMBAT di Z: (3–5 menit) — baca output, laporkan angka asli. Pytest: `python -m pytest tests/`.
- Pemeriksa inline: `node scratch/check_inline.js static/index.html scratch/tmp_check` wajib 5/5.
- **Babel TDZ**: `const` yang dipakai di dependency array harus dideklarasi SEBELUM effect.
- Commit: `feat(notes): ...` / `style(notes): ...` + `Co-Authored-By: Claude <noreply@anthropic.com>`. Push = deploy (Actions) — jangan percaya Action hijau, verifikasi live curl.
- State `notesTab` TIDAK perlu persist (component-local, default `"all"`).

---

### Task 1: CSS — segmented tabs + flex fix zona kontrol

**Files:**
- Modify: `static/app.css` (tambah blok `.notes-tabs` + aturan flex)
- Test: `tests/offline/notes_page_layout.test.js` (tambah suite CSS)

**Interfaces:**
- Consumes: —
- Produces: kelas `.notes-tabs` (baris segmented) + `.notes-tab` (+ `.active`), dan aturan `.notes-left > *:not(.notes-left-inner) { flex-shrink: 0; }` + `.notes-left-inner { min-height: 0; }`. Task 2 memakai nama kelas ini di JSX.

- [ ] **Step 1: Tulis test yang gagal**

Tambahkan ke `tests/offline/notes_page_layout.test.js` (file sudah membaca `appCss` — cek cara baca di bagian atas file itu, ikuti pola):

```js
test("Notes sidebar tabs — CSS segmented & flex zone", async (t) => {
  await t.test("baris tabs segmented tersedia", () => {
    assert.ok(appCss.includes(".notes-tabs"), "harus ada .notes-tabs");
    const m = /\.notes-tab \{([^}]*)\}/.exec(appCss);
    assert.ok(m, "rule .notes-tab ada");
    assert.ok(/flex:\s*1/.test(m[1]), "tab flex:1 (equal width segmented)");
    assert.ok(/cursor:\s*pointer/.test(m[1]), "tab clickable");
    assert.ok(appCss.includes(".notes-tab.active"), "ada state .notes-tab.active");
  });

  await t.test("zona kontrol tidak menyusut, list dapat sisa ruang", () => {
    assert.match(appCss, /\.notes-left\s*>\s*\*:not\(\.notes-left-inner\)\s*\{\s*flex-shrink:\s*0/, "zona kontrol flex-shrink: 0");
    assert.match(appCss, /\.notes-left-inner\s*\{[^}]*min-height:\s*0/, ".notes-left-inner wajib min-height: 0");
  });
});
```

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `node --test tests/offline/notes_page_layout.test.js`
Expected: FAIL — `.notes-tabs` dan aturan flex belum ada.

- [ ] **Step 3: Implementasi CSS**

Tambahkan di `static/app.css` (dekat blok `.notes-left` ~734):

```css
    .notes-left > *:not(.notes-left-inner) { flex-shrink: 0; }
    .notes-left-inner { min-height: 0; }
    .notes-tabs {
      display: flex;
      gap: 3px;
      padding: 2px;
      background: var(--bg-primary);
      border: 1px solid var(--border);
      border-radius: 8px;
      margin: 0 16px 8px 0;
    }
    .notes-tab {
      flex: 1;
      padding: 4px 2px;
      font-size: 11.5px;
      font-weight: 600;
      color: var(--text-secondary);
      background: transparent;
      border: none;
      border-radius: 6px;
      cursor: pointer;
      text-align: center;
      transition: background 0.12s ease, color 0.12s ease;
      font-family: inherit;
      white-space: nowrap;
    }
    .notes-tab:hover { color: var(--text-primary); }
    .notes-tab.active {
      background: var(--accent);
      color: #111;
    }
```

Perhatikan indentasi blok tempat kamu menyisipkan (match style sekitar). Kalau `.notes-left-inner` sudah punya rule dengan `flex: 1; overflow-y: auto;` (baris ~735), TAMBAHKAN properti `min-height: 0;` ke rule yang SUDAH ada, bukan rule baru. Rule `.notes-tabs`/`.notes-tab` taruh di blok umum (tidak di dalam @media) supaya berlaku desktop & mobile.

- [ ] **Step 4: Jalankan, pastikan PASS**

Run: `node --test tests/offline/notes_page_layout.test.js`
Expected: PASS semua (lama + baru).

- [ ] **Step 5: Commit**

```bash
git add static/app.css tests/offline/notes_page_layout.test.js
git commit -m "style(notes): segmented tab bar CSS and fixed control-zone flex

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: JSX + state — tabs, tags ramping, header merge, hapus accordion

**Files:**
- Modify: `static/index.html` (NotesPage, region ~20600–21400)
- Test: `tests/offline/notes_page_layout.test.js` (perbarui asersi lama + tambah suite tabs)

**Interfaces:**
- Consumes: kelas CSS dari Task 1 (`.notes-tabs`, `.notes-tab`, `.notes-tab.active`).
- Produces: state `notesTab` + handler `handleTabChange(tab)`; `applyFilters(query, tags, base, untagged, tab)` tab-aware. Task 3 hanya SW bump + deploy.

**Pola umum:** semua edit pada compiled output; verifikasi setiap old_string unik dengan grep sebelum Edit; nomor baris bisa drift — adaptasi konteks, jaga NEW text persis.

- [ ] **Step 1: Tulis test yang gagal (perbarui `notes_page_layout.test.js`)**

1. Asersi LAMA yang harus DIGANTI (hapus/ubah): pencarian string berikut di file test:
   - `filterPublished` / `filterListId` / `pinnedExpanded` — ganti dengan asersi KETIDAKADAAN (lihat #2).
2. Tambahkan suite baru (ekstrak kode NotesPage seperti pola existing: `indexHtml.match(/function NotesPage\(\{[\s\S]*?^function /m)` — hati-hati: NotesPage didefinisikan ~20600; pattern ini juga cocok untuk fungsi lain, pakai anchor `function NotesPage({` ):

```js
test("Notes sidebar tabs — struktur JSX & state", async (t) => {
  await t.test("state notesTab menggantikan filter lama", () => {
    assert.match(notesPageCode, /const \[notesTab, setNotesTab\] = React\.useState\("all"\)/, "state notesTab default all");
    assert.strictEqual(notesPageCode.includes("filterPublished"), false, "filterPublished harus hilang");
    assert.strictEqual(notesPageCode.includes("filterListId"), false, "filterListId harus hilang");
    assert.strictEqual(notesPageCode.includes("pinnedExpanded"), false, "pinnedExpanded harus hilang");
  });

  await t.test("4 tab segmented dengan label benar", () => {
    assert.ok(notesPageCode.includes('className: "notes-tabs"'), "baris .notes-tabs ada");
    for (const label of ["All", "Pinned", "Pub", "Shared"]) {
      assert.ok(notesPageCode.includes(`"${label}"`), `label tab ${label} ada`);
    }
    assert.match(notesPageCode, /handleTabChange\(/ , "handler handleTabChange terpakai");
  });

  await t.test("pills lama hilang dari baris tags", () => {
    assert.strictEqual(notesPageCode.includes("isAllActive"), false, "pill Semua hilang");
    assert.strictEqual(notesPageCode.includes("filterPublished ? ' active'"), false, "pill Published hilang");
    assert.strictEqual(notesPageCode.includes("pinned-note-item"), false, "accordion pinned hilang");
  });

  await t.test("applyFilters tab-aware (tab ∩ tags ∩ search)", () => {
    assert.match(notesPageCode, /tab === "pinned"\)\s*result = result\.filter\(n => n\.pinned\)/, "tab pinned filter n.pinned");
    assert.match(notesPageCode, /tab === "pub"\)\s*result = result\.filter\(n => publishedNoteIds\.has\(n\.id\)\)/, "tab pub pakai publishedNoteIds");
    assert.match(notesPageCode, /tab === "shared"\)\s*result = result\.filter\(n => n\.list_id\s*&&\s*sharedListIds\.has\(n\.list_id\)\)/, "tab shared pakai sharedListIds");
  });

  await t.test("empty state per tab", () => {
    assert.ok(notesPageCode.includes("Belum ada catatan yang di-pin"), "empty pinned");
    assert.ok(notesPageCode.includes("Belum ada catatan yang di-publish"), "empty pub");
    assert.ok(notesPageCode.includes("Belum ada catatan yang di-share"), "empty shared");
  });

  await t.test("header berisi count + sort (subheader lama hilang)", () => {
    assert.match(notesPageCode, /Catatan \(\$\{sortedNotes\.length\}\)/, "count di header");
    // subheader lama: pattern lama `marginBottom: 6` + sort select sebagai baris sendiri dihapus —
    // asersi: hanya SATU kemunculan select sort (regex count):
    const sortCount = (notesPageCode.match(/value:\s*sortBy/g) || []).length;
    assert.strictEqual(sortCount, 1, "select sort hanya 1 (di header)");
  });
});
```

Catatan implementer: kalau regex di atas tidak match persis setelah implementasi (formatting compiled), sesuaikan regex seminimal mungkin TANPA melemahkan intent asersi (verifikasi dengan menjalankan test).

- [ ] **Step 2: Jalankan, pastikan GAGAL**

Run: `node --test tests/offline/notes_page_layout.test.js`
Expected: FAIL — struktur lama masih ada.

- [ ] **Step 3: State & filter logic (~20634–20851)**

Edit state (hapus 3, tambah 1):
- Hapus: `const [pinnedExpanded, setPinnedExpanded] = useState(false);` (~20634)
- Hapus: `const [filterPublished, setFilterPublished] = useState(false);` (~20639)
- Hapus: `const [filterListId, setFilterListId] = useState(null);` (~20640)
- Tambah (di tempat yang sama): `const [notesTab, setNotesTab] = React.useState("all");`

Tambah helper shared list ids (dekat `publishedNoteIds` memo ~20684):
```js
  const sharedListIds = React.useMemo(() => new Set(listsWithNotes.map(l => l.id)), [listsWithNotes]);
```
(Pastikan `listsWithNotes` sudah terdefinisi SEBELUM baris ini di file — grep posisinya; kalau baru didefinisi setelahnya, pindahkan memo ke bawah definisi listsWithNotes.)

Refactor `applyFiltersStatic` (~20685) dan `applyFilters` (~20811): ganti 2 param terakhir `listId = null, published = false` → `tab = "all"`; ganti dua baris filter `if (listId)...` dan `if (published)...` dengan:
```js
    if (tab === "pinned") result = result.filter(n => n.pinned);
    if (tab === "pub") result = result.filter(n => publishedNoteIds.has(n.id));
    if (tab === "shared") result = result.filter(n => n.list_id && sharedListIds.has(n.list_id));
```
Update `fetchNotes` (~20695): signature `(filterQ = "", filterTags = [], untagged = false, tab = "all")`; `hasFilter = filterQ || filterTags.length || untagged || tab !== "all"`; panggilan applyFiltersStatic meneruskan `tab`.

Update handler-hanlder (~20827–20852):
- `handleSearch`: ganti `filterListId, filterPublished` → `notesTab` (dua argumen terakhir).
- `handleTagFilter`: sama.
- `handleUntaggedFilter`: sama.
- HAPUS `handleListFilter` dan `handlePublishedFilter` seluruhnya.
- TAMBAH:
```js
  const handleTabChange = tab => {
    setNotesTab(tab);
    setNotes(applyFilters(q, activeTags, allNotes, filterUntagged, tab));
  };
```

- [ ] **Step 4: Header merge (~21044–21049 dan ~21335–21375)**

Header saat ini (dalam satu row): tombol `+ Baru` (21044) + tombol ✕ (21049). Subheader (row sendiri, 21335–21375): `<span>` "Catatan (N)" + `<select>` sortBy.

- Hapus ROW subheader (seluruh createElement wrapper row + isi) — tapi PINDAHKAN isinya ke header: span count + select.
- Di row header: setelah tombol `+ Baru` dan sebelum tombol ✕, sisipkan span count:
  `/*#__PURE__*/React.createElement("span", { style: { fontSize: 12, fontWeight: 700, color: "var(--text-secondary)", flex: 1, marginLeft: 4, whiteSpace: "nowrap" } }, \`Catatan (${sortedNotes.length})\`),`
  lalu select sort dengan style lama (fontSize 11, border, radius 6, padding "2px 6px", background var(--bg-primary), color var(--text-secondary), cursor pointer) berisi 4 option yang sama (Terbaru/Terlama/A–Z/Terbanyak link).
- Verifikasi: tepat 1 kemunculan `value: sortBy` di seluruh file.

- [ ] **Step 5: Tags row dirampingkan (~21130–21270)**

Baca region dengan saksama. Hapus:
1. Pill Published (~21142, className template `tag-pill${filterPublished ? ' active' : ''}`).
2. Pill "Semua" (~21157, yang pakai `isAllActive`).
3. Pill Shared (~21180–21191, `👥 Shared (${listsWithNotes.length})` + onClick handleListFilter).
Pertahankan: 2 tag teratas + pill `🏷️ +N Tags ▾` + popover `allTagsPopoverOpen` lengkap (termasuk "⬜ Tanpa Tag" dan daftar tag di dalamnya).
Setelah penghapusan, pastikan sisa ekspresi JSX tetap valid (koma antar argumen rapi).

- [ ] **Step 6: Sisipkan baris tabs + hapus accordion pinned**

1. HAPUS seluruh blok accordion pinned: mulai IIFE `(() => {` yang berisi `📌 Disematkan (${pinned.length})` (~21270) sampai penutupnya `})()` (sebelum row "Catatan (N)"/subheader lama ~21335). Termasuk `const pinned = allNotes.filter(n => n.pinned)` di dalamnya.
2. SISIPKAN baris tabs SETELAH tags row (sebelum `.notes-left-inner`):
```js
      /*#__PURE__*/React.createElement("div", {
        className: "notes-tabs"
      },
        /*#__PURE__*/React.createElement("button", { type: "button", className: `notes-tab${notesTab === "all" ? " active" : ""}`, onClick: () => handleTabChange("all") }, "All"),
        /*#__PURE__*/React.createElement("button", { type: "button", className: `notes-tab${notesTab === "pinned" ? " active" : ""}`, onClick: () => handleTabChange("pinned") }, "Pinned"),
        /*#__PURE__*/React.createElement("button", { type: "button", className: `notes-tab${notesTab === "pub" ? " active" : ""}`, onClick: () => handleTabChange("pub") }, "Pub"),
        /*#__PURE__*/React.createElement("button", { type: "button", className: `notes-tab${notesTab === "shared" ? " active" : ""}`, onClick: () => handleTabChange("shared") }, "Shared")
      ),
```
Posisikan sebagai argumen di parent `.notes-left` (setelah elemen tags row, sebelum `.notes-left-inner` — ikuti pola koma sibling).

- [ ] **Step 7: Empty state per tab (~21386–21393)**

Ganti ekspresi pesan kosong di `.notes-left-inner`:
```js
filterUntagged ? "Tidak ada catatan tanpa tag." : activeTags.length > 0 ? `Tidak ada catatan dengan tag ${activeTags.map(t => "#" + t).join(" + ")}` : q ? "Tidak ada catatan yang cocok." : notesTab === "pinned" ? "Belum ada catatan yang di-pin." : notesTab === "pub" ? "Belum ada catatan yang di-publish." : notesTab === "shared" ? "Belum ada catatan yang di-share." : "Belum ada catatan. Tulis sesuatu!"
```
(cascade: filter aktif → pesan filter; kalau hanya tab → pesan tab.)

- [ ] **Step 8: Verifikasi**

1. `node scratch/check_inline.js static/index.html scratch/tmp_check` → 5/5 OK (WAJIB — satu syntax error = blank page).
2. `node --test tests/offline/notes_page_layout.test.js` → PASS semua.
3. `grep -n "filterPublished\|filterListId\|pinnedExpanded\|pinned-note-item" static/index.html` → nol hasil.
4. `node --test "tests/offline/*.test.js"` → suite penuh hijau (catat angka).

- [ ] **Step 9: Commit**

```bash
git add static/index.html tests/offline/notes_page_layout.test.js
git commit -m "feat(notes): 3-row sidebar ops with All/Pinned/Pub/Shared tabs

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: SW bump + verifikasi penuh + deploy + handover

**Files:**
- Modify: `static/sw.js` (1 baris), `.agents/CURRENT_STATE.md`, `.agents/SESSION_LOG.md`

**Interfaces:**
- Consumes: Task 1 CSS + Task 2 JSX (ter-commit).
- Produces: SW `taskflow-v305-notes-sidebar-tabs` LIVE.

- [ ] **Step 1: Bump SW**

`const CACHE = "taskflow-v304-alurik-brand-icons";` → `const CACHE = "taskflow-v305-notes-sidebar-tabs";`

- [ ] **Step 2: Verifikasi penuh**

```bash
node --check static/sw.js
node --test "tests/offline/*.test.js"      # catat angka
python -m pytest tests/                    # 47/47
node scratch/check_inline.js static/index.html scratch/tmp_check   # 5/5
```

- [ ] **Step 3: Commit + push**

```bash
git add static/sw.js
git commit -m "chore(sw): bump cache taskflow-v305-notes-sidebar-tabs

Co-Authored-By: Claude <noreply@anthropic.com>"
git push origin main
```

- [ ] **Step 4: Verifikasi live (jangan percaya Action hijau)**

Poll tiap ~20s maks 5 menit sampai `curl -s https://todo.yatno.web.id/static/sw.js | head -1` menampilkan `taskflow-v305-notes-sidebar-tabs`; lalu:
```bash
curl -s https://todo.yatno.web.id/ | grep -c "notes-tabs"      # ≥ 3 (CSS kelas JSX)
curl -s https://todo.yatno.web.id/static/app.css | grep -c "notes-tab"  # ≥ 3
```

- [ ] **Step 5: Handover `.agents/*`**

- `.agents/CURRENT_STATE.md`: ganti blok 🟢 Active Task dengan ringkasan fitur ini (3 baris + tabs; state notesTab; kombinasi tab∩tags∩search; SW v305; LIVE) + device-test checklist dari spec.
- `.agents/SESSION_LOG.md`: append entri standar.
- Commit + push `.agents/*` terpisah: `docs(agents): record notes sidebar tabs feature`.

---

## Device-test checklist (user)

1. Desktop: panel kiri = header + search + tags + tabs + list scroll penuh — banyak kartu terlihat.
2. Tab All/Pinned/Pub/Shared menampilkan subset benar; kombinasi dengan tag & search; count "Catatan (N)" berubah.
3. Tab Pinned: klik card membuka note; accordion lama tidak ada.
4. Mobile: baris & tab rapi, list scroll.
5. Dark mode konsisten.
6. Hard refresh (Ctrl+Shift+R) — SW v305.
