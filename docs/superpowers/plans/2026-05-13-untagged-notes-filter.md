# Untagged Notes Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambahkan badge "tanpa tag" pada note card dan pill filter "Tanpa Tag" di sidebar Notes & Draw agar note tanpa tag mudah ditemukan.

**Architecture:** Semua perubahan ada di satu file `static/index.html`. State `filterUntagged` sudah ada (baris 9317) tapi belum dipakai — tinggal di-wire ke filter functions, handlers, dan render. Filter bersifat mutual exclusive dengan tag pills, bisa dikombinasikan dengan text search.

**Tech Stack:** React (inline JSX via Babel), CSS custom properties (var(--accent) dll.), single-file SPA

---

## File yang Dimodifikasi

- **Modify:** `static/index.html` — satu-satunya file yang diubah (CSS + JS + JSX semuanya inline)
- **Modify:** `static/sw.js` — bump cache version agar browser memuat ulang index.html terbaru

---

### Task 1: CSS — tambah class `.note-tag-untagged`

**Files:**
- Modify: `static/index.html` (sekitar baris 865)

- [ ] **Step 1: Tambah CSS class setelah baris `.note-tag`**

  Temukan baris 865 yang berisi `.note-tag { display: inline-flex ...` dan tambahkan baris baru tepat setelahnya:

  ```css
  .note-tag-untagged { display: inline-block; background: var(--bg-primary); border: 1px dashed var(--border); border-radius: 8px; padding: 1px 7px; font-size: 10px; color: var(--text-light); font-style: italic; cursor: pointer; transition: border-color 0.15s, color 0.15s; }
  .note-tag-untagged:hover { border-color: var(--accent); color: var(--accent); }
  ```

  Hasil di file (baris 865–867 setelah edit):
  ```
  865:    .note-tag { display: inline-flex; ... }
  866:    .note-tag-untagged { display: inline-block; background: var(--bg-primary); border: 1px dashed var(--border); border-radius: 8px; padding: 1px 7px; font-size: 10px; color: var(--text-light); font-style: italic; cursor: pointer; transition: border-color 0.15s, color 0.15s; }
  867:    .note-tag-untagged:hover { border-color: var(--accent); color: var(--accent); }
  868:    /* ── Redesigned tag pills ... ── */
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add static/index.html
  git commit -m "style: add .note-tag-untagged CSS class"
  ```

---

### Task 2: Update fungsi filter — `applyFiltersStatic` dan `applyFilters`

**Files:**
- Modify: `static/index.html` (baris 9330–9341 dan 9434–9446)

- [ ] **Step 1: Update `applyFiltersStatic` (baris 9330–9341)**

  Ganti:
  ```js
  const applyFiltersStatic = (query, tags, base) => {
    const syntaxTags = [...query.matchAll(/\btag:(\S+)/gi)].map(m => m[1].toLowerCase());
    const cleanQuery = query.replace(/\btag:\S+/gi, "").trim();
    const allTags = [...new Set([...tags, ...syntaxTags])];
    let result = base;
    for (const tag of allTags) result = result.filter(n => (n.tags || []).map(t => t.toLowerCase()).includes(tag));
    if (cleanQuery) result = result.filter(n =>
      n.title?.toLowerCase().includes(cleanQuery.toLowerCase()) ||
      n.content?.toLowerCase().includes(cleanQuery.toLowerCase())
    );
    return result;
  };
  ```

  Dengan:
  ```js
  const applyFiltersStatic = (query, tags, base, untagged = false) => {
    const syntaxTags = [...query.matchAll(/\btag:(\S+)/gi)].map(m => m[1].toLowerCase());
    const cleanQuery = query.replace(/\btag:\S+/gi, "").trim();
    const allTags = [...new Set([...tags, ...syntaxTags])];
    let result = base;
    for (const tag of allTags) result = result.filter(n => (n.tags || []).map(t => t.toLowerCase()).includes(tag));
    if (cleanQuery) result = result.filter(n =>
      n.title?.toLowerCase().includes(cleanQuery.toLowerCase()) ||
      n.content?.toLowerCase().includes(cleanQuery.toLowerCase())
    );
    if (untagged) result = result.filter(n => (n.tags || []).length === 0);
    return result;
  };
  ```

- [ ] **Step 2: Update `applyFilters` (baris 9434–9446)**

  Ganti:
  ```js
  const applyFilters = (query, tags, base) => {
    const { cleanQuery, syntaxTags } = parseQuery(query);
    const allActiveTags = [...new Set([...tags, ...syntaxTags])];
    let result = base;
    for (const tag of allActiveTags) {
      result = result.filter(n => (n.tags || []).map(t => t.toLowerCase()).includes(tag));
    }
    if (cleanQuery) result = result.filter(n =>
      n.title?.toLowerCase().includes(cleanQuery.toLowerCase()) ||
      n.content?.toLowerCase().includes(cleanQuery.toLowerCase())
    );
    return result;
  };
  ```

  Dengan:
  ```js
  const applyFilters = (query, tags, base, untagged = false) => {
    const { cleanQuery, syntaxTags } = parseQuery(query);
    const allActiveTags = [...new Set([...tags, ...syntaxTags])];
    let result = base;
    for (const tag of allActiveTags) {
      result = result.filter(n => (n.tags || []).map(t => t.toLowerCase()).includes(tag));
    }
    if (cleanQuery) result = result.filter(n =>
      n.title?.toLowerCase().includes(cleanQuery.toLowerCase()) ||
      n.content?.toLowerCase().includes(cleanQuery.toLowerCase())
    );
    if (untagged) result = result.filter(n => (n.tags || []).length === 0);
    return result;
  };
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add static/index.html
  git commit -m "refactor: add untagged param to applyFilters and applyFiltersStatic"
  ```

---

### Task 3: Update `fetchNotes` signature dan semua call sites-nya

**Files:**
- Modify: `static/index.html` (baris 9343–9354, 9380–9384, 9480, 9509, 9532–9538)

- [ ] **Step 1: Update `fetchNotes` signature (baris 9343–9354)**

  Ganti:
  ```js
  const fetchNotes = async (filterQ = "", filterTags = []) => {
    try {
      const data = await api.get("/api/scratchpad");
      await OfflineDB.cacheSet("scratchpad_notes", data);
      setAllNotes(data);
      setNotes(filterQ || filterTags.length ? applyFiltersStatic(filterQ, filterTags, data) : data);
    } catch (e) {
      const cached = await OfflineDB.cacheGet("scratchpad_notes") || [];
      setAllNotes(cached);
      setNotes(filterQ || filterTags.length ? applyFiltersStatic(filterQ, filterTags, cached) : cached);
    }
    setLoading(false);
  };
  ```

  Dengan:
  ```js
  const fetchNotes = async (filterQ = "", filterTags = [], untagged = false) => {
    try {
      const data = await api.get("/api/scratchpad");
      await OfflineDB.cacheSet("scratchpad_notes", data);
      setAllNotes(data);
      setNotes(filterQ || filterTags.length || untagged ? applyFiltersStatic(filterQ, filterTags, data, untagged) : data);
    } catch (e) {
      const cached = await OfflineDB.cacheGet("scratchpad_notes") || [];
      setAllNotes(cached);
      setNotes(filterQ || filterTags.length || untagged ? applyFiltersStatic(filterQ, filterTags, cached, untagged) : cached);
    }
    setLoading(false);
  };
  ```

- [ ] **Step 2: Update `useEffect` noteSaved listener (baris 9380–9384)**

  Ganti:
  ```js
  useEffect(() => {
    const handler = () => fetchNotes(q, activeTags);
    window.addEventListener("noteSaved", handler);
    return () => window.removeEventListener("noteSaved", handler);
  }, [q, activeTags]);
  ```

  Dengan:
  ```js
  useEffect(() => {
    const handler = () => fetchNotes(q, activeTags, filterUntagged);
    window.addEventListener("noteSaved", handler);
    return () => window.removeEventListener("noteSaved", handler);
  }, [q, activeTags, filterUntagged]);
  ```

- [ ] **Step 3: Update call di `handleSave` (baris 9480)**

  Ganti:
  ```js
  await fetchNotes(q, activeTags);
  ```
  Dengan:
  ```js
  await fetchNotes(q, activeTags, filterUntagged);
  ```

- [ ] **Step 4: Update call di `handleDelete` (baris 9509)**

  Ganti:
  ```js
  fetchNotes(q, activeTags);
  ```
  Dengan:
  ```js
  fetchNotes(q, activeTags, filterUntagged);
  ```

- [ ] **Step 5: Update call di `handlePin` (baris 9532–9538)**

  Ganti:
  ```js
  const handlePin = async (id) => {
    try {
      const updated = await api.patch(`/api/scratchpad/${id}/pin`, {});
      const refresh = allNotes.map(n => n.id === id ? updated : n);
      setAllNotes(refresh);
      setNotes(applyFilters(q, activeTags, refresh));
    } catch (e) { showToast(e.message, "error"); }
  };
  ```
  Dengan:
  ```js
  const handlePin = async (id) => {
    try {
      const updated = await api.patch(`/api/scratchpad/${id}/pin`, {});
      const refresh = allNotes.map(n => n.id === id ? updated : n);
      setAllNotes(refresh);
      setNotes(applyFilters(q, activeTags, refresh, filterUntagged));
    } catch (e) { showToast(e.message, "error"); }
  };
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add static/index.html
  git commit -m "refactor: thread filterUntagged through fetchNotes and call sites"
  ```

---

### Task 4: Tambah handler dan update handlers yang ada

**Files:**
- Modify: `static/index.html` (baris 9448–9459 dan setelah handleTagFilter)

- [ ] **Step 1: Update `handleSearch` (baris 9448–9451)**

  Ganti:
  ```js
  const handleSearch = (val) => {
    setQ(val);
    setNotes(applyFilters(val, activeTags, allNotes));
  };
  ```
  Dengan:
  ```js
  const handleSearch = (val) => {
    setQ(val);
    setNotes(applyFilters(val, activeTags, allNotes, filterUntagged));
  };
  ```

- [ ] **Step 2: Update `handleTagFilter` (baris 9453–9459)**

  Ganti:
  ```js
  const handleTagFilter = (tag) => {
    const next = activeTags.includes(tag)
      ? activeTags.filter(t => t !== tag)
      : [...activeTags, tag];
    setActiveTags(next);
    setNotes(applyFilters(q, next, allNotes));
  };
  ```
  Dengan:
  ```js
  const handleTagFilter = (tag) => {
    setFilterUntagged(false);
    const next = activeTags.includes(tag)
      ? activeTags.filter(t => t !== tag)
      : [...activeTags, tag];
    setActiveTags(next);
    setNotes(applyFilters(q, next, allNotes, false));
  };
  ```

- [ ] **Step 3: Tambah `handleUntaggedFilter` tepat setelah `handleTagFilter`**

  Tambahkan blok berikut setelah penutup `handleTagFilter`:
  ```js
  const handleUntaggedFilter = () => {
    const next = !filterUntagged;
    setFilterUntagged(next);
    if (next) setActiveTags([]);
    setNotes(applyFilters(q, [], allNotes, next));
  };
  ```

- [ ] **Step 4: Update tombol "✕ reset" (baris 9620–9625)**

  Ganti:
  ```jsx
  {activeTags.length > 0 && (
    <span onClick={() => { setActiveTags([]); setNotes(applyFilters(q, [], allNotes)); }}
      style={{ fontSize: 9, color: '#98A2B3', cursor: 'pointer', marginLeft: 'auto' }}>
      ✕ reset
    </span>
  )}
  ```
  Dengan:
  ```jsx
  {(activeTags.length > 0 || filterUntagged) && (
    <span onClick={() => { setActiveTags([]); setFilterUntagged(false); setNotes(applyFilters(q, [], allNotes, false)); }}
      style={{ fontSize: 9, color: '#98A2B3', cursor: 'pointer', marginLeft: 'auto' }}>
      ✕ reset
    </span>
  )}
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add static/index.html
  git commit -m "feat: add handleUntaggedFilter and update handleTagFilter/handleSearch/reset"
  ```

---

### Task 5: Render — badge di note card

**Files:**
- Modify: `static/index.html` (baris 9739–9757, di dalam `sortedNotes.map`)

- [ ] **Step 1: Tambah badge `tanpa tag` di note card**

  Temukan blok ini di dalam `sortedNotes.map` (baris 9739–9746):
  ```jsx
  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
    {(n.tags || []).map(tag => (
      <span key={tag} className="note-tag"
        style={{ cursor: "pointer", fontSize: 11, background: activeTags.includes(tag) ? "var(--accent)" : undefined, color: activeTags.includes(tag) ? "#111" : undefined }}
        onClick={e => { e.stopPropagation(); handleTagFilter(tag); }}>
        #{tag}
      </span>
    ))}
  ```

  Tambahkan badge tepat setelah closing `})}` dari `.map(tag =>`:
  ```jsx
  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
    {(n.tags || []).map(tag => (
      <span key={tag} className="note-tag"
        style={{ cursor: "pointer", fontSize: 11, background: activeTags.includes(tag) ? "var(--accent)" : undefined, color: activeTags.includes(tag) ? "#111" : undefined }}
        onClick={e => { e.stopPropagation(); handleTagFilter(tag); }}>
        #{tag}
      </span>
    ))}
    {(n.tags || []).length === 0 && (
      <span className="note-tag-untagged"
        onClick={e => { e.stopPropagation(); handleUntaggedFilter(); }}>
        ⬜ tanpa tag
      </span>
    )}
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add static/index.html
  git commit -m "feat: add untagged badge to note cards"
  ```

---

### Task 6: Render — pill filter di sidebar dan empty state

**Files:**
- Modify: `static/index.html` (baris 9627–9641 dan 9714–9720)

- [ ] **Step 1: Tambah pill "Tanpa Tag" di sidebar setelah block "Semua Tags"**

  Temukan blok `{tagsOpen && ...}` (sekitar baris 9627–9641):
  ```jsx
                                  {tagsOpen && (
                                    <div className="tag-scroll">
                                      {rest.map(t => {
                                        const isActive = activeTags.includes(t.name) || parseQuery(q).syntaxTags.includes(t.name);
                                        return (
                                          <span key={t.name} onClick={() => handleTagFilter(t.name)}
                                            className={`tag-pill${isActive ? ' active' : ''}`}>
                                            #{t.name}
                                            <span className="tag-count">{t.count || 0}</span>
                                          </span>
                                        );
                                      })}
                                    </div>
                                  )}
  ```

  Tambahkan blok pill Tanpa Tag tepat setelah closing `)}` dari `{tagsOpen && ...}`:
  ```jsx
                                  {tagsOpen && (
                                    <div className="tag-scroll">
                                      {rest.map(t => {
                                        const isActive = activeTags.includes(t.name) || parseQuery(q).syntaxTags.includes(t.name);
                                        return (
                                          <span key={t.name} onClick={() => handleTagFilter(t.name)}
                                            className={`tag-pill${isActive ? ' active' : ''}`}>
                                            #{t.name}
                                            <span className="tag-count">{t.count || 0}</span>
                                          </span>
                                        );
                                      })}
                                    </div>
                                  )}
                                  {(() => {
                                    const untaggedCount = allNotes.filter(n => (n.tags || []).length === 0).length;
                                    if (untaggedCount === 0) return null;
                                    return (
                                      <>
                                        <div style={{ borderTop: '1px solid var(--border)', margin: '8px 0' }} />
                                        <span
                                          onClick={handleUntaggedFilter}
                                          className={`tag-pill${filterUntagged ? ' active' : ''}`}
                                          style={!filterUntagged ? { border: '1px dashed var(--border)', background: 'transparent', color: 'var(--text-light)', fontStyle: 'italic' } : {}}>
                                          ⬜ Tanpa Tag
                                          <span className="tag-count">{untaggedCount}</span>
                                        </span>
                                      </>
                                    );
                                  })()}
  ```

- [ ] **Step 2: Update empty state message (baris 9714–9720)**

  Ganti:
  ```jsx
                  ) : sortedNotes.length === 0 ? (
                    <div style={{ color: "var(--text-secondary)", textAlign: "center", padding: 40, fontSize: 13 }}>
                      {activeTags.length > 0
                        ? `Tidak ada catatan dengan tag ${activeTags.map(t => "#" + t).join(" + ")}`
                        : q ? "Tidak ada catatan yang cocok."
                        : "Belum ada catatan. Tulis sesuatu!"}
                    </div>
  ```
  Dengan:
  ```jsx
                  ) : sortedNotes.length === 0 ? (
                    <div style={{ color: "var(--text-secondary)", textAlign: "center", padding: 40, fontSize: 13 }}>
                      {filterUntagged
                        ? "Tidak ada catatan tanpa tag."
                        : activeTags.length > 0
                        ? `Tidak ada catatan dengan tag ${activeTags.map(t => "#" + t).join(" + ")}`
                        : q ? "Tidak ada catatan yang cocok."
                        : "Belum ada catatan. Tulis sesuatu!"}
                    </div>
  ```

- [ ] **Step 3: Verifikasi visual di browser**

  Buka app di browser, navigasi ke Notes & Draw, lalu cek:
  1. Note tanpa tag menampilkan badge `⬜ tanpa tag` di bawah card
  2. Note dengan tag tidak menampilkan badge tersebut
  3. Klik badge → pill "Tanpa Tag" di sidebar jadi aktif (warna accent), daftar note berfilter hanya yang tanpa tag
  4. Ketik teks di search box saat filter Tanpa Tag aktif → list menyempit ke note tanpa tag yang cocok
  5. Klik tag pill normal → filter Tanpa Tag reset, badge di card masih muncul
  6. Klik "✕ reset" saat filter Tanpa Tag aktif → filter reset, semua note muncul lagi
  7. Pill "Tanpa Tag" tidak muncul di sidebar jika semua note sudah punya tag

- [ ] **Step 4: Commit**

  ```bash
  git add static/index.html
  git commit -m "feat: add Tanpa Tag filter pill in sidebar and update empty state message"
  ```

---

### Task 7: Bump SW cache version

**Files:**
- Modify: `static/sw.js` (baris 1)

- [ ] **Step 1: Bump cache name**

  Ganti baris 1 di `static/sw.js`:
  ```js
  const CACHE = "taskflow-v38-wikilink-style";
  ```
  Dengan:
  ```js
  const CACHE = "taskflow-v39-untagged-filter";
  ```

- [ ] **Step 2: Commit dan push**

  ```bash
  git add static/sw.js
  git commit -m "chore: bump SW cache to v39 for untagged filter"
  git push
  ```
