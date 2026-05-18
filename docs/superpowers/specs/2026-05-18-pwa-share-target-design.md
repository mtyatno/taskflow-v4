# PWA Share Target — Design Spec
**Date:** 2026-05-18  
**Status:** Draft

## Overview

Tambahkan Web Share Target API ke TaskFlow PWA sehingga user mobile dapat men-share URL dari browser apapun langsung ke Notes dengan tag `#bookmark`. Tidak memerlukan extension browser.

## Goals

- User bisa share URL dari Chrome Android, Firefox Android, Samsung Internet, Safari iOS ke TaskFlow
- Auto-save langsung tanpa konfirmasi
- Kalau belum login: login dulu, data tersimpan di sessionStorage, auto-save setelah login
- Setelah save: toast sukses → `window.close()` (2 detik)
- TaskFlow harus sudah di-install sebagai PWA (Add to Home Screen)

## Non-Goals

- File sharing (gambar, dokumen)
- Edit note sebelum save
- Pilih destination (selain Notes pribadi)

---

## Architecture

Approach: **GET share_target di root `/`** — mengikuti pola `?join=`, `?ext_auth=1`, `?action=` yang sudah ada di SPA.

### Perubahan File

| File | Perubahan |
|------|-----------|
| `static/manifest.json` | Tambah field `share_target` |
| `static/index.html` | Tambah `shareData` state + auto-clip logic di `App` component |

Tidak ada perubahan backend — menggunakan endpoint `POST /api/scratchpad` yang sudah ada.

---

## Section 1: manifest.json

Tambah `share_target` di `static/manifest.json`:

```json
"share_target": {
  "action": "/",
  "method": "GET",
  "params": {
    "title": "share_title",
    "text":  "share_text",
    "url":   "share_url"
  }
}
```

Saat user share URL → OS navigasi ke:
```
https://todo.yatno.web.id/?share_title=<judul>&share_url=<url>&share_text=<teks>
```

---

## Section 2: SPA — State Detection

Di `App` component, tambah `shareData` state mengikuti pola existing:

```jsx
const [shareData, setShareData] = useState(() => {
  const params = new URLSearchParams(window.location.search);
  const url = params.get('share_url');
  if (!url) return null;
  return {
    url,
    title: params.get('share_title') || url,
    text:  params.get('share_text') || ''
  };
});
```

---

## Section 3: SPA — Auto-clip Flow

### Skenario A: User sudah login

`useEffect` dengan dependency `[user, shareData]`:

```jsx
useEffect(() => {
  if (!user || !shareData) return;
  const content = shareData.text
    ? `**Source:** ${shareData.url}\n\n> ${shareData.text}`
    : `**Source:** ${shareData.url}`;
  api.post('/api/scratchpad', {
    title: shareData.title,
    content,
    tags: ['bookmark']
  }).then(() => {
    showToast('Tersimpan di Notes! 📎');
    setShareData(null);
    window.history.replaceState({}, '', '/');
    setTimeout(() => window.close(), 2000);
  }).catch(err => {
    showToast('Gagal menyimpan: ' + err.message, 'error');
    setShareData(null);
    window.history.replaceState({}, '', '/');
  });
}, [user, shareData]);
```

### Skenario B: Belum login

Deteksi `shareData` pada mount → simpan ke `sessionStorage`:

```jsx
useEffect(() => {
  if (shareData && !tokenStore.get()) {
    sessionStorage.setItem('pendingShare', JSON.stringify(shareData));
    window.history.replaceState({}, '', '/');
  }
}, []);
```

Setelah login berhasil (saat `user` di-set), cek sessionStorage:

```jsx
useEffect(() => {
  if (!user) return;
  const pending = sessionStorage.getItem('pendingShare');
  if (!pending) return;
  sessionStorage.removeItem('pendingShare');
  const data = JSON.parse(pending);
  setShareData(data);
}, [user]);
```

`setShareData` akan trigger Skenario A (useEffect di atas).

### Clean URL

`window.history.replaceState({}, '', '/')` dipanggil segera setelah deteksi agar refresh tidak re-trigger save.

---

## Error Handling

- API gagal: tampil toast error, clear shareData, clean URL, jangan close window (biarkan user di app)
- `share_url` tidak ada di params: skip, tidak ada aksi
- `window.close()` gagal (tab tidak dibuka oleh script): graceful — user tetap di app, tidak error

---

## Cara Install PWA (prerequisite)

User harus install TaskFlow sebagai PWA di device agar muncul di share sheet:
- **Android Chrome**: Menu ⋮ → "Add to Home screen"
- **Android Firefox**: Menu → "Install"
- **iOS Safari**: Share → "Add to Home Screen"

Setelah install, "TaskFlow" akan muncul sebagai opsi di share sheet OS.
