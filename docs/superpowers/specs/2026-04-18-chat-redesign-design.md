# Chat Page Redesign — Design Spec

**Date:** 2026-04-18
**Status:** Approved

## Context

Chat page yang sudah berjalan ditemukan memiliki 4 masalah:
1. Tombol reply (↩) tertutup sebagian oleh panel shared lists karena overflow clipping
2. Quote block tidak bisa diklik untuk scroll ke pesan asli
3. Desain chat terasa old-fashioned
4. Chat terasa terpisah dari halaman sekitarnya (tidak menyatu dengan design system)

---

## Keputusan Desain

| Aspek | Keputusan |
|---|---|
| Layout utama | Modern Messenger — full-bleed, tetap height calc(100vh - 64px) |
| Panel shared lists | Light/cream (var(--bg-primary) = #EEEEE6), konsisten dengan sidebar app |
| Chat header | Gradient lime (accent → accent-hover), teks putih |
| Chat background | Subtle gradient #f8fafc → #f1f5f9 |
| Bubble orang lain | White, shadow 0 1px 4px, radius 4px 14px 14px 14px |
| Bubble self | Gradient lime, teks putih, shadow accent, radius 14px 4px 14px 14px |
| Input bar | Pill-shaped (border-radius 20px), send button bulat dengan gradient |
| Scroll ke asli | In scope — klik quote block → scrollIntoView ke pesan asli |
| Fix reply button | In scope — overflow visible + padding pada messages container |

---

## Bug Fix 1: Reply Button Tertutup Panel

**Root cause:** `.chat-room-messages` memiliki `overflow: hidden` (atau container parent lain) yang mengclip tombol `position: absolute; right: -34px` yang keluar dari bubble wrap.

**Fix:**
- Ubah messages scroll container agar `overflow-x: visible; overflow-y: auto`
- Tambah `padding: 0 40px` agar ada ruang untuk tombol reply di kiri dan kanan
- Pastikan `.chat-reply-btn` memiliki `z-index: 10`

---

## Bug Fix 2: Scroll ke Pesan Asli saat Klik Quote

**Behavior:**
- Tiap bubble wrap diberi atribut `data-msg-id={msg.id}` (sebagai `id` HTML: `id={\`msg-\${msg.id}\`}`)
- `.chat-quote-block` diberi `cursor: pointer` dan `onClick`:
  ```js
  onClick={() => {
    const el = document.getElementById(`msg-${msg.reply_to_id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // highlight singkat
      el.style.transition = 'background 0.3s';
      el.style.background = 'rgba(168,197,0,0.15)';
      setTimeout(() => { el.style.background = ''; }, 1200);
    } else {
      showToast('Pesan asli tidak ada di layar — scroll ke atas untuk memuatnya', 'info');
    }
  }}
  ```

---

## CSS Baru / Perubahan

### `.chat-list-panel` (panel kiri)
```css
.chat-list-panel {
  background: var(--bg-primary);       /* #EEEEE6 */
  border-right: 1px solid var(--border);
}
.chat-list-item.active {
  background: rgba(168,197,0,0.12);
  border-left: 3px solid var(--accent);
  color: var(--accent);
  font-weight: 600;
}
```

### `.chat-room-header` (header per list)
```css
.chat-room-header {
  background: linear-gradient(135deg, var(--accent), var(--accent-hover));
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.chat-room-header .header-name { font-weight: 700; color: white; font-size: 15px; }
.chat-room-header .header-meta { font-size: 12px; color: rgba(255,255,255,0.8); }
.chat-room-header-avatar {
  width: 32px; height: 32px; border-radius: 50%;
  background: rgba(255,255,255,0.25);
  display: flex; align-items: center; justify-content: center;
  color: white; font-weight: 700; font-size: 13px; flex-shrink: 0;
}
```

### `.chat-room-messages` (area pesan)
```css
.chat-room-messages {
  flex: 1;
  overflow-x: visible;
  overflow-y: auto;
  padding: 16px 40px;    /* 40px kiri-kanan untuk ruang tombol reply */
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: linear-gradient(180deg, #f8fafc, #f1f5f9);
}
[data-theme="dark"] .chat-room-messages {
  background: linear-gradient(180deg, var(--bg-card), var(--bg-primary));
}
```

### `.chat-bubble` (upgrade)
```css
/* Bubble orang lain */
.chat-bubble {
  background: white;
  border-radius: 4px 14px 14px 14px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.08);
  padding: 8px 12px;
  font-size: 14px;
  line-height: 1.5;
  color: var(--text-primary);
}
[data-theme="dark"] .chat-bubble {
  background: var(--bg-card);
  box-shadow: 0 1px 4px rgba(0,0,0,0.2);
}

/* Bubble self */
.chat-bubble.self {
  background: linear-gradient(135deg, var(--accent), var(--accent-hover));
  border-radius: 14px 4px 14px 14px;
  color: white;
  box-shadow: 0 2px 6px rgba(168,197,0,0.3);
}

/* Quote block dalam self bubble */
.chat-bubble.self .chat-quote-block {
  background: rgba(0,0,0,0.15);
  border-left-color: rgba(255,255,255,0.7);
}
.chat-bubble.self .chat-quote-block .quote-sender { color: rgba(255,255,255,0.9); }
.chat-bubble.self .chat-quote-block .quote-text { color: rgba(255,255,255,0.75); }
```

### `.chat-quote-block` (klik untuk scroll)
```css
.chat-quote-block { cursor: pointer; }
.chat-quote-block:hover { opacity: 0.85; }
```

### `.chat-reply-btn` (fix z-index)
```css
.chat-reply-btn { z-index: 10; }
```

### `.chat-input` & send button (upgrade)
```css
.chat-input {
  border-radius: 20px;
  padding: 9px 14px;
  background: var(--bg-primary);
}
.chat-send-btn {
  width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0;
  background: linear-gradient(135deg, var(--accent), var(--accent-hover));
  color: white; border: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-size: 15px;
  box-shadow: 0 2px 6px rgba(168,197,0,0.35);
  transition: transform 0.15s, box-shadow 0.15s;
}
.chat-send-btn:hover { transform: scale(1.08); box-shadow: 0 4px 10px rgba(168,197,0,0.45); }
.chat-send-btn:disabled { opacity: 0.5; transform: none; box-shadow: none; }
```

### Mobile (overflow adjustment)
```css
@media (max-width: 768px) {
  .chat-room-messages { padding: 12px 16px; }
}
```

---

## Perubahan JSX (ChatRoom)

### Header
Tambah div `.chat-room-header` sebelum messages area:
```jsx
<div className="chat-room-header">
  <div className="chat-room-header-avatar">
    {list.name[0].toUpperCase()}
  </div>
  <div>
    <div className="header-name">{list.name}</div>
    <div className="header-meta">{list.member_count ? `${list.member_count} anggota` : 'Shared list'}</div>
  </div>
</div>
```

### Messages container
Ganti class dari `.chat-messages` (atau inline style) ke `.chat-room-messages`.

### Bubble wrap
Tambah `id={`msg-${msg.id}`}` pada div `.chat-bubble-wrap`:
```jsx
<div id={`msg-${msg.id}`} className={`chat-bubble-wrap${isSelf ? ' self' : ''}`}>
```

### Quote block onClick
```jsx
<div
  className="chat-quote-block"
  onClick={() => {
    const el = document.getElementById(`msg-${msg.reply_to_id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.style.transition = 'background 0.3s';
      el.style.background = 'rgba(168,197,0,0.15)';
      setTimeout(() => { el.style.background = ''; }, 1200);
    } else {
      showToast('Pesan asli tidak ada di layar — scroll ke atas untuk memuatnya', 'info');
    }
  }}
>
```

## Perubahan JSX (ChatInputBar)

Ganti tombol send (sebelumnya `<button className="btn btn-primary">`) ke:
```jsx
<button className="chat-send-btn" onClick={handleSend} disabled={sending || (!text.trim() && !attachedTask)}>
  ➤
</button>
```

---

## Out of Scope

- Animasi masuk pesan (fade/slide) — bisa ditambah di iterasi berikutnya
- Unread badge di list panel
- Search pesan
