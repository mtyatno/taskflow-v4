# Wikilink Auto-Create Note Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ketika user mengetik `[[Judul Note Baru]]` di NoteModal dan judul itu belum ada, sistem otomatis membuat note tersebut via API, link langsung aktif (bisa diklik), dan user bisa langsung membuka note baru itu.

**Architecture:** Semua perubahan di `NoteModal` dalam `static/index.html`. Tidak ada perubahan backend — `POST /api/scratchpad` sudah ada dan bisa digunakan. Dropdown `[[` yang sudah ada (`wikiDropdown`) diperluas dengan opsi "✨ Buat note baru..." ketika query tidak cocok persis dengan note yang ada. Saat opsi itu dipilih, `createNewNote()` async function memanggil API, menambahkan judul baru ke state `noteTitles` lokal, lalu memanggil `insertWikilink()` — sehingga link langsung aktif tanpa reload.

**Tech Stack:** React (inline SPA, `static/index.html`), JSX Babel browser, existing `api.post("/api/scratchpad")`, existing `wikiDropdown` state pattern.

---

## File Map

| File | Aksi | Tanggung Jawab |
|------|------|----------------|
| `static/index.html` | Modify | `NoteModal`: tambah `canCreate` di wikiDropdown, tambah `createNewNote()`, update keyboard nav, update dropdown render |

---

## Task 1: Tambah opsi "Buat note baru" ke wiki autocomplete dropdown

**Context untuk implementer:**
- `NoteModal` mulai sekitar baris 5551 di `static/index.html`
- `noteTitles` state: `[{id, title}]` dari `/api/scratchpad/titles` (baris 5572, 5579)
- `wikiDropdown` state shape saat ini: `{ top, left, query, items, activeIdx }` (baris 5571)
- `handleContentChange` (baris 5647): mendeteksi `[[query` dan men-set `wikiDropdown` (baris 5684)
- `handleContentKeyDown` (baris 5591): navigasi keyboard untuk wikiDropdown (baris 5602–5611)
- `insertWikilink(title)` (baris 5687): mengganti `[[query` dengan `[[title]]` di textarea
- Dropdown render (baris 5776–5791): saat `wikiDropdown.items.length === 0` tampilkan teks "Tidak ditemukan" non-interaktif
- `POST /api/scratchpad` body: `{ title, content, tags, linked_task_ids, linked_task_id }` — semua field kecuali `title` bisa kosong/default

**Files:**
- Modify: `static/index.html` (NoteModal, baris sekitar 5571–5800)

- [ ] **Step 1: Tambah `canCreate` ke wikiDropdown state di `handleContentChange`**

Cari baris (sekitar 5674–5684):
```javascript
        const match = before.match(/\[\[([^\]]*)$/);
        if (!match) { setWikiDropdown(null); return; }
        const query = match[1].toLowerCase();
        const items = noteTitles.filter(n => n.title.toLowerCase().includes(query) && n.title !== title).slice(0, 6);
        // Use fixed positioning relative to viewport so modal overflow-y doesn't clip
        const rect = el.getBoundingClientRect();
        const lh = parseFloat(getComputedStyle(el).lineHeight) || 22;
        const linesBefore = before.split("\n").length;
        const rawTop = rect.top + linesBefore * lh;
        const top = rawTop + 260 > window.innerHeight ? rect.top - 4 : rawTop + 4;
        setWikiDropdown({ top, left: rect.left + 8, query, items, activeIdx: 0 });
```

Ganti dengan:
```javascript
        const match = before.match(/\[\[([^\]]*)$/);
        if (!match) { setWikiDropdown(null); return; }
        const query = match[1];
        const queryLow = query.toLowerCase();
        const items = noteTitles.filter(n => n.title.toLowerCase().includes(queryLow) && n.title !== title).slice(0, 6);
        const exactMatch = noteTitles.some(n => n.title.toLowerCase() === queryLow);
        const canCreate = query.trim().length > 0 && !exactMatch;
        // Use fixed positioning relative to viewport so modal overflow-y doesn't clip
        const rect = el.getBoundingClientRect();
        const lh = parseFloat(getComputedStyle(el).lineHeight) || 22;
        const linesBefore = before.split("\n").length;
        const rawTop = rect.top + linesBefore * lh;
        const top = rawTop + 260 > window.innerHeight ? rect.top - 4 : rawTop + 4;
        setWikiDropdown({ top, left: rect.left + 8, query, items, activeIdx: 0, canCreate });
```

Perubahan: simpan `query` asli (bukan lowercase), tambah `exactMatch` check, tambah `canCreate` ke state.

- [ ] **Step 2: Tambah fungsi `createNewNote` setelah `insertWikilink`**

Cari baris `insertWikilink` (sekitar 5687–5697):
```javascript
      const insertWikilink = (t) => {
        const el = textareaRef.current;
        if (!el) return;
        const pos = el.selectionStart;
        const before = content.slice(0, pos);
        const after  = content.slice(pos);
        const replaced = before.replace(/\[\[([^\]]*)$/, `[[${t}]]`);
        setContent(replaced + after);
        setWikiDropdown(null);
        setTimeout(() => { el.focus(); el.setSelectionRange(replaced.length, replaced.length); }, 0);
      };
```

Tambahkan tepat setelah fungsi tersebut (sebelum `insertTag`):
```javascript
      const createNewNote = async (newTitle) => {
        setWikiDropdown(null);
        try {
          const created = await api.post("/api/scratchpad", {
            title: newTitle, content: "", tags: [], linked_task_ids: [], linked_task_id: null,
          });
          setNoteTitles(prev => [{ id: created.id, title: created.title }, ...prev]);
          window.dispatchEvent(new Event("noteSaved"));
          insertWikilink(newTitle);
        } catch (_) {
          insertWikilink(newTitle);
        }
      };
```

Catatan: `setNoteTitles` memperbarui state lokal sehingga `renderMarkdown` akan merender link sebagai `wikilink` aktif (bukan `wikilink-broken`). Dispatch `noteSaved` agar NotesPage memperbarui daftar note di panel kiri.

- [ ] **Step 3: Update keyboard navigation di `handleContentKeyDown` untuk "create new" item**

Cari blok wikilink keyboard nav (sekitar baris 5602–5611):
```javascript
        // Wikilink dropdown navigation
        if (wikiDropdown) {
          if (e.key === "ArrowDown") { e.preventDefault(); setWikiDropdown(d => ({ ...d, activeIdx: Math.min(d.activeIdx + 1, d.items.length - 1) })); return; }
          if (e.key === "ArrowUp")   { e.preventDefault(); setWikiDropdown(d => ({ ...d, activeIdx: Math.max(d.activeIdx - 1, 0) })); return; }
          if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            if (wikiDropdown.items[wikiDropdown.activeIdx]) insertWikilink(wikiDropdown.items[wikiDropdown.activeIdx].title);
            return;
          }
          if (e.key === "Escape") { setWikiDropdown(null); return; }
        }
```

Ganti dengan:
```javascript
        // Wikilink dropdown navigation
        if (wikiDropdown) {
          const totalItems = wikiDropdown.items.length + (wikiDropdown.canCreate ? 1 : 0);
          if (e.key === "ArrowDown") { e.preventDefault(); setWikiDropdown(d => ({ ...d, activeIdx: Math.min(d.activeIdx + 1, totalItems - 1) })); return; }
          if (e.key === "ArrowUp")   { e.preventDefault(); setWikiDropdown(d => ({ ...d, activeIdx: Math.max(d.activeIdx - 1, 0) })); return; }
          if (e.key === "Enter" || e.key === "Tab") {
            e.preventDefault();
            if (wikiDropdown.activeIdx < wikiDropdown.items.length) {
              insertWikilink(wikiDropdown.items[wikiDropdown.activeIdx].title);
            } else if (wikiDropdown.canCreate) {
              createNewNote(wikiDropdown.query.trim());
            }
            return;
          }
          if (e.key === "Escape") { setWikiDropdown(null); return; }
        }
```

- [ ] **Step 4: Update dropdown render untuk tampilkan opsi "Buat note baru"**

Cari blok render wikiDropdown (sekitar baris 5776–5791):
```jsx
            {/* Wikilink autocomplete dropdown */}
            {wikiDropdown && (
              <div ref={wikiDropdownRef} className="wiki-autocomplete"
                style={{ position: "fixed", top: wikiDropdown.top, left: wikiDropdown.left }}>
                {wikiDropdown.items.length > 0 ? wikiDropdown.items.map((n, i) => (
                  <div key={n.id} className={`wiki-autocomplete-item${i === wikiDropdown.activeIdx ? " active" : ""}`}
                    onMouseDown={e => { e.preventDefault(); insertWikilink(n.title); }}>
                    [[{n.title}]]
                  </div>
                )) : (
                  <div className="wiki-autocomplete-item" style={{ color: "var(--text-light)", cursor: "default", fontStyle: "italic" }}>
                    {noteTitles.length === 0 ? "Belum ada catatan bertajuk" : "Tidak ditemukan"}
                  </div>
                )}
              </div>
            )}
```

Ganti dengan:
```jsx
            {/* Wikilink autocomplete dropdown */}
            {wikiDropdown && (
              <div ref={wikiDropdownRef} className="wiki-autocomplete"
                style={{ position: "fixed", top: wikiDropdown.top, left: wikiDropdown.left }}>
                {wikiDropdown.items.map((n, i) => (
                  <div key={n.id} className={`wiki-autocomplete-item${i === wikiDropdown.activeIdx ? " active" : ""}`}
                    onMouseDown={e => { e.preventDefault(); insertWikilink(n.title); }}>
                    [[{n.title}]]
                  </div>
                ))}
                {wikiDropdown.canCreate && (
                  <div
                    className={`wiki-autocomplete-item${wikiDropdown.activeIdx === wikiDropdown.items.length ? " active" : ""}`}
                    style={{ borderTop: wikiDropdown.items.length > 0 ? "1px solid var(--border)" : undefined, color: "var(--accent)", fontWeight: 600 }}
                    onMouseDown={e => { e.preventDefault(); createNewNote(wikiDropdown.query.trim()); }}>
                    ✨ Buat note "{wikiDropdown.query.trim()}"
                  </div>
                )}
                {!wikiDropdown.canCreate && wikiDropdown.items.length === 0 && (
                  <div className="wiki-autocomplete-item" style={{ color: "var(--text-light)", cursor: "default", fontStyle: "italic" }}>
                    Belum ada catatan bertajuk
                  </div>
                )}
              </div>
            )}
```

Perubahan: item yang ada tetap ditampilkan; `canCreate` menambah item "✨ Buat note..." di bawah, dengan separator jika ada item di atas; activeIdx === items.length → item create yang highlight.

- [ ] **Step 5: Manual test**

1. Buka NoteModal (klik note mana saja atau buat baru)
2. Di textarea content, ketik `[[Catatan Test Baru` — dropdown harus muncul dengan opsi "✨ Buat note "Catatan Test Baru""
3. Ketik judul note yang sudah ada (misal `[[Task`) — dropdown harus menampilkan matches tanpa opsi "Buat baru" jika ada exact match
4. Pilih opsi "Buat note..." dengan klik atau Enter — `[[Catatan Test Baru]]` harus tersisip di content
5. Switch ke preview mode — link harus berwarna accent (aktif, bukan abu-abu broken)
6. Klik link → harus membuka note "Catatan Test Baru"
7. Di NotesPage panel kiri harus muncul note baru tersebut

- [ ] **Step 6: Commit dan push**

```bash
git add static/index.html
git commit -m "feat: auto-create note when inserting unknown [[wikilink]] in NoteModal"
git push origin main
```

---

## Catatan Deploy

Tidak ada perubahan backend — tidak perlu restart service.
```bash
git pull origin main
# hard refresh browser (Ctrl+Shift+R)
```
