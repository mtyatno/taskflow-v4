# Spec: Filter "Tanpa Tag" pada Notes & Draw

**Date:** 2026-05-13  
**Status:** Approved

## Latar Belakang

Di halaman Notes & Draw, tags adalah satu-satunya sistem navigasi (tidak ada folder). Notes tanpa tag sulit ditemukan karena tidak muncul di filter manapun. Fitur ini menambahkan:

1. Badge visual pada note card yang tidak memiliki tag
2. Pill filter khusus di sidebar untuk menyaring note tanpa tag

## Desain Visual (Opsi A — dashed subtle)

### Badge di Note Card

- Muncul **hanya** jika `n.tags.length === 0`
- Teks: `⬜ tanpa tag`
- Style: `background` gelap, `border: 1px dashed`, warna muted/gray, font-style italic
- **Interaktif**: klik badge mengaktifkan filter Tanpa Tag di sidebar (setara klik pill)
- Tidak muncul jika note sudah punya minimal satu tag

### Pill Filter di Sidebar (Search Panel)

- Posisi: di bawah section "Semua Tags", setelah separator tipis (`1px solid var(--border)`)
- Label: `⬜ Tanpa Tag` + count badge berisi jumlah note tanpa tag dari `allNotes`
- Style **inactive**: background gelap, `border: 1px dashed`, warna muted
- Style **active**: background `var(--accent)`, teks `#111`, font-weight bold — identik dengan tag pill aktif
- Hanya tampil jika ada ≥1 note tanpa tag di `allNotes`

## Perilaku Filter

### Mutual Exclusion dengan Tag Pills

- Mengaktifkan filter Tanpa Tag → `activeTags` di-reset ke `[]`
- Mengklik tag pill mana pun → `filterUntagged` di-set ke `false`
- Alasan: tidak mungkin ada note yang sekaligus memiliki tag dan tidak memiliki tag

### Kombinasi yang Valid

| Kondisi | Hasil |
|---|---|
| `filterUntagged=true`, `q=""` | Semua note tanpa tag |
| `filterUntagged=true`, `q="keyword"` | Note tanpa tag yang mengandung keyword |
| `filterUntagged=false`, `activeTags=["kerja"]` | Note dengan tag #kerja |
| `filterUntagged=false`, `activeTags=[]`, `q="x"` | Semua note mengandung "x" |

### Reset Filter

- Tombol "✕ reset" yang sudah ada pada tag section juga me-reset `filterUntagged`
- `handleDelete` dan `handleSave` mempertahankan state `filterUntagged` saat refresh

### Empty State Message

Saat tidak ada hasil, pesan menyesuaikan kondisi aktif:
- `filterUntagged=true` → "Tidak ada catatan tanpa tag."
- `activeTags.length > 0` → (pesan existing)
- `q` ada → (pesan existing)
- Default → (pesan existing)

## Perubahan Kode (`static/index.html`)

### State

```js
// Sudah ada di baris 9317, tinggal di-wire:
const [filterUntagged, setFilterUntagged] = useState(false);
```

### `applyFilters` dan `applyFiltersStatic`

Tambah parameter `untagged = false`:

```js
const applyFilters = (query, tags, base, untagged = false) => {
  // ... logika existing ...
  if (untagged) result = result.filter(n => (n.tags || []).length === 0);
  return result;
};
```

`applyFiltersStatic` mendapat perubahan sama. Semua call site diperbarui untuk meneruskan `filterUntagged`.

### Handler Baru

```js
const handleUntaggedFilter = () => {
  const next = !filterUntagged;
  setFilterUntagged(next);
  if (next) setActiveTags([]);
  setNotes(applyFilters(q, [], allNotes, next));
};
```

### `handleTagFilter` — Reset Untagged

```js
const handleTagFilter = (tag) => {
  setFilterUntagged(false);           // tambah ini
  const next = activeTags.includes(tag) ? ... : ...;
  // ... sisa logika existing ...
};
```

### `fetchNotes` Call Sites

Semua pemanggilan `fetchNotes(q, activeTags)` diperbarui menjadi `fetchNotes(q, activeTags, filterUntagged)`. Signature `fetchNotes` ditambah parameter `untagged = false`.

### Reset Button

```js
// Tombol "✕ reset" existing:
onClick={() => {
  setActiveTags([]);
  setFilterUntagged(false);          // tambah ini
  setNotes(applyFilters(q, [], allNotes, false));
}}
```

### Render — Note Card

```jsx
{/* Di bawah tags map, setelah render tag pills */}
{(n.tags || []).length === 0 && (
  <span
    className="note-tag-untagged"
    onClick={e => { e.stopPropagation(); handleUntaggedFilter(); }}
  >
    ⬜ tanpa tag
  </span>
)}
```

### CSS

```css
.note-tag-untagged {
  display: inline-block;
  background: var(--bg-primary);
  border: 1px dashed var(--border);
  border-radius: 8px;
  padding: 1px 7px;
  font-size: 10px;
  color: var(--text-light);
  font-style: italic;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.note-tag-untagged:hover {
  border-color: var(--accent);
  color: var(--accent);
}
```

### Render — Sidebar Pill (di bawah "Semua Tags")

```jsx
{(() => {
  const untaggedCount = allNotes.filter(n => (n.tags || []).length === 0).length;
  if (untaggedCount === 0) return null;
  return (
    <>
      <div style={{ borderTop: '1px solid var(--border)', margin: '8px 0' }} />
      <span
        onClick={handleUntaggedFilter}
        className={`tag-pill${filterUntagged ? ' active' : ''}`}
        style={!filterUntagged ? { border: '1px dashed var(--border)', background: 'transparent', color: 'var(--text-light)', fontStyle: 'italic' } : {}}
      >
        ⬜ Tanpa Tag
        <span className="tag-count">{untaggedCount}</span>
      </span>
    </>
  );
})()}
```

## Tidak Dalam Scope

- Perubahan pada backend / API
- Filter Tanpa Tag di pinned notes section
- Bulk tagging untuk note tanpa tag
