# Chat Page Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesain chat page menjadi Modern Messenger style, fix reply button clipping, dan tambah scroll-to-original pada quote block.

**Architecture:** Semua perubahan hanya di `static/index.html` — CSS block dan dua komponen React (`ChatRoom`, `ChatInputBar`). Tidak ada perubahan backend. Fix clipping dilakukan via `padding: 0 40px` pada `.chat-messages` agar button `position: absolute; left/right: -34px` tidak keluar batas container.

**Tech Stack:** React 18 UMD, CSS variables (`--accent`, `--bg-primary`, `--bg-card`), single-file SPA.

---

## Files yang Dimodifikasi

- Modify: `static/index.html` — CSS block (~baris 166–238), `ChatRoom` component, `ChatInputBar` component

---

## Task 1: CSS Overhaul

**Files:**
- Modify: `static/index.html` — CSS block (baris ~166–238)

- [ ] **Step 1: Update `.chat-list-item.active`**

  Cari:
  ```css
  .chat-list-item.active { background: var(--bg-card); border-left: 3px solid var(--accent); }
  ```
  Ganti dengan:
  ```css
  .chat-list-item.active { background: rgba(168,197,0,0.12); border-left: 3px solid var(--accent); color: var(--accent); font-weight: 600; }
  ```

- [ ] **Step 2: Update `.chat-messages` — fix clipping + gradient background**

  Cari:
  ```css
  .chat-messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
  ```
  Ganti dengan:
  ```css
  .chat-messages { flex: 1; overflow-y: auto; padding: 16px 40px; display: flex; flex-direction: column; gap: 10px; background: linear-gradient(180deg, #f8fafc, #f1f5f9); }
  [data-theme="dark"] .chat-messages { background: linear-gradient(180deg, var(--bg-card), var(--bg-primary)); }
  ```

- [ ] **Step 3: Upgrade `.chat-bubble` dan `.chat-bubble.self`**

  Cari:
  ```css
  .chat-bubble { max-width: 70%; padding: 8px 12px; border-radius: 0 12px 12px 12px; font-size: 14px; line-height: 1.5; background: var(--bg-primary); color: var(--text-primary); }
  .chat-bubble.self { border-radius: 12px 0 12px 12px; background: #dcfce7; }
  [data-theme="dark"] .chat-bubble.self { background: rgba(168,197,0,0.18); }
  .chat-bubble.mentioned { background: rgba(168,197,0,0.1); }
  ```
  Ganti dengan:
  ```css
  .chat-bubble { max-width: 70%; padding: 8px 12px; border-radius: 4px 14px 14px 14px; font-size: 14px; line-height: 1.5; background: white; color: var(--text-primary); box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  [data-theme="dark"] .chat-bubble { background: #2d2d2d; box-shadow: 0 1px 4px rgba(0,0,0,0.2); }
  .chat-bubble.self { border-radius: 14px 4px 14px 14px; background: linear-gradient(135deg, var(--accent), var(--accent-hover)); color: white; box-shadow: 0 2px 6px rgba(168,197,0,0.3); }
  .chat-bubble.mentioned { background: rgba(168,197,0,0.1); }
  ```

- [ ] **Step 4: Tambah style quote block di dalam self bubble**

  Cari:
  ```css
  [data-theme="dark"] .chat-quote-block { background: rgba(255,255,255,0.07); }
  .chat-quote-block .quote-sender { font-weight: 700; color: var(--accent); margin-bottom: 2px; font-size: 11px; }
  .chat-quote-block .quote-text {
    color: var(--text-secondary); overflow: hidden;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  }
  ```
  Ganti dengan:
  ```css
  [data-theme="dark"] .chat-quote-block { background: rgba(255,255,255,0.07); }
  .chat-quote-block .quote-sender { font-weight: 700; color: var(--accent); margin-bottom: 2px; font-size: 11px; }
  .chat-quote-block .quote-text {
    color: var(--text-secondary); overflow: hidden;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  }
  .chat-bubble.self .chat-quote-block { background: rgba(0,0,0,0.15); border-left-color: rgba(255,255,255,0.6); cursor: pointer; }
  .chat-bubble.self .chat-quote-block .quote-sender { color: rgba(255,255,255,0.9); }
  .chat-bubble.self .chat-quote-block .quote-text { color: rgba(255,255,255,0.75); }
  .chat-quote-block { cursor: pointer; }
  .chat-quote-block:hover { opacity: 0.82; }
  ```

- [ ] **Step 5: Update z-index `.chat-reply-btn`**

  Cari (dalam blok `/* ── Chat Reply ── */`):
  ```css
  .chat-reply-btn {
    position: absolute; top: 0;
    background: var(--bg-card); border: 1px solid var(--border); border-radius: 50%;
    width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;
    font-size: 13px; cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,0.1);
    opacity: 0; transition: opacity 0.15s; z-index: 2; color: var(--text-secondary);
  }
  ```
  Ganti `z-index: 2` → `z-index: 10`:
  ```css
  .chat-reply-btn {
    position: absolute; top: 0;
    background: var(--bg-card); border: 1px solid var(--border); border-radius: 50%;
    width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;
    font-size: 13px; cursor: pointer; box-shadow: 0 1px 4px rgba(0,0,0,0.1);
    opacity: 0; transition: opacity 0.15s; z-index: 10; color: var(--text-secondary);
  }
  ```

- [ ] **Step 6: Tambah CSS `.chat-room-header` dan `.chat-send-btn`**

  Cari:
  ```css
  .chat-reply-preview {
  ```
  Tambahkan SEBELUMNYA:
  ```css
  /* ── Chat Header (Gradient) ── */
  .chat-room-header { background: linear-gradient(135deg, var(--accent), var(--accent-hover)); padding: 10px 16px; display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
  .chat-room-header-avatar { width: 32px; height: 32px; border-radius: 50%; background: rgba(255,255,255,0.25); display: flex; align-items: center; justify-content: center; color: white; font-weight: 700; font-size: 13px; flex-shrink: 0; }
  .chat-room-header .header-name { font-weight: 700; color: white; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chat-room-header .header-meta { font-size: 11px; color: rgba(255,255,255,0.8); }
  /* ── Chat Send Button ── */
  .chat-send-btn { width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0; background: linear-gradient(135deg, var(--accent), var(--accent-hover)); color: white; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 16px; box-shadow: 0 2px 6px rgba(168,197,0,0.35); transition: transform 0.15s, box-shadow 0.15s; }
  .chat-send-btn:hover { transform: scale(1.08); box-shadow: 0 4px 10px rgba(168,197,0,0.45); }
  .chat-send-btn:disabled { opacity: 0.45; transform: none; box-shadow: none; cursor: default; }
  ```

- [ ] **Step 7: Upgrade `.chat-input` ke pill shape**

  Cari:
  ```css
  .chat-input { flex: 1; resize: none; border: 1px solid var(--border); border-radius: 10px; padding: 8px 12px; font-size: 14px; font-family: inherit; outline: none; background: var(--bg-primary); color: var(--text-primary); max-height: 120px; overflow-y: auto; }
  ```
  Ganti dengan:
  ```css
  .chat-input { flex: 1; resize: none; border: 1px solid var(--border); border-radius: 20px; padding: 9px 14px; font-size: 14px; font-family: inherit; outline: none; background: var(--bg-primary); color: var(--text-primary); max-height: 120px; overflow-y: auto; }
  ```

- [ ] **Step 8: Update mobile CSS**

  Cari dalam `@media (max-width: 768px)`:
  ```css
  .chat-input-bar { padding: 8px 10px; gap: 6px; }
  .chat-input { font-size: 13px; padding: 7px 10px; min-width: 0; }
  .chat-input-bar .btn { padding: 7px 12px; font-size: 12px; }
  ```
  Ganti dengan:
  ```css
  .chat-input-bar { padding: 8px 10px; gap: 6px; }
  .chat-input { font-size: 13px; padding: 7px 10px; min-width: 0; }
  .chat-input-bar .btn { padding: 7px 12px; font-size: 12px; }
  .chat-messages { padding: 12px 16px; }
  ```

- [ ] **Step 9: Commit**

  ```bash
  git add static/index.html
  git commit -m "feat: chat CSS overhaul — gradient header, modern bubbles, fix reply btn clipping"
  ```

---

## Task 2: ChatRoom JSX — Header + Bubble ID + Quote Scroll

**Files:**
- Modify: `static/index.html` — `ChatRoom` component (~baris 4152–4232)

- [ ] **Step 1: Ganti inline header dengan `.chat-room-header`**

  Cari (header lama dengan inline style):
  ```jsx
          {/* Header */}
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", fontWeight: 600, fontSize: 15, color: "var(--text-primary)", flexShrink: 0, display: "flex", alignItems: "center", gap: 10 }}>
            {onBack && (
              <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", fontSize: 22, padding: "0 4px 0 0", lineHeight: 1 }} title="Kembali">‹</button>
            )}
            <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>💬 {list.name}</span>
            <span style={{ fontSize: 12, fontWeight: 400, color: "var(--text-light)", flexShrink: 0 }}>{list.role === "owner" ? "Owner" : "Member"}</span>
          </div>
  ```
  Ganti dengan:
  ```jsx
          {/* Header */}
          <div className="chat-room-header">
            {onBack && (
              <button onClick={onBack} style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.85)", fontSize: 22, padding: "0 4px 0 0", lineHeight: 1 }} title="Kembali">‹</button>
            )}
            <div className="chat-room-header-avatar">{list.name[0].toUpperCase()}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="header-name">{list.name}</div>
              <div className="header-meta">{list.role === "owner" ? "Owner" : "Member"}</div>
            </div>
          </div>
  ```

- [ ] **Step 2: Tambah `id` pada setiap bubble wrap**

  Cari:
  ```jsx
                  <div className={`chat-bubble-wrap${isSelf ? " self" : ""}`}>
  ```
  Ganti dengan:
  ```jsx
                  <div id={`msg-${msg.id}`} className={`chat-bubble-wrap${isSelf ? " self" : ""}`}>
  ```

- [ ] **Step 3: Tambah `onClick` scroll-to-original pada quote block**

  Cari:
  ```jsx
                        {msg.reply_to_id && msg.reply_to_content && (
                          <div className="chat-quote-block">
                            <div className="quote-sender">{msg.reply_to_display_name || msg.reply_to_username}</div>
                            <div className="quote-text">{msg.reply_to_content}</div>
                          </div>
                        )}
  ```
  Ganti dengan:
  ```jsx
                        {msg.reply_to_id && msg.reply_to_content && (
                          <div className="chat-quote-block" onClick={() => {
                            const el = document.getElementById(`msg-${msg.reply_to_id}`);
                            if (el) {
                              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                              el.style.transition = 'background 0.4s';
                              el.style.background = 'rgba(168,197,0,0.18)';
                              setTimeout(() => { el.style.background = ''; }, 1400);
                            } else {
                              showToast('Pesan asli tidak ada di layar — scroll ke atas untuk memuatnya', 'error');
                            }
                          }}>
                            <div className="quote-sender">{msg.reply_to_display_name || msg.reply_to_username}</div>
                            <div className="quote-text">{msg.reply_to_content}</div>
                          </div>
                        )}
  ```

- [ ] **Step 4: Verifikasi manual**

  1. Buka chat, hover bubble → tombol ↩ muncul dan tidak tertutup panel kiri
  2. Reply ke sebuah pesan, scroll ke atas, lalu klik quote block → pesan asli di-scroll ke tengah layar dan highlight sebentar
  3. Klik quote block yang pesan aslinya belum di-load → muncul toast error

- [ ] **Step 5: Commit**

  ```bash
  git add static/index.html
  git commit -m "feat: ChatRoom — gradient header, bubble id, scroll-to-original on quote click"
  ```

---

## Task 3: ChatInputBar — Send Button

**Files:**
- Modify: `static/index.html` — `ChatInputBar` component (~baris 4435)

- [ ] **Step 1: Ganti tombol Kirim dengan `.chat-send-btn`**

  Cari:
  ```jsx
          <button className="btn btn-primary btn-sm" onClick={handleSend} disabled={sending || (!text.trim() && !attachedTask)} style={{ flexShrink: 0 }}>
            {sending ? "..." : "Kirim"}
          </button>
  ```
  Ganti dengan:
  ```jsx
          <button className="chat-send-btn" onClick={handleSend} disabled={sending || (!text.trim() && !attachedTask)} title="Kirim">
            {sending ? "·" : "➤"}
          </button>
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add static/index.html
  git commit -m "feat: ChatInputBar — round gradient send button"
  ```

---

## Task 4: Deploy

- [ ] **Step 1: Push ke GitHub**

  ```bash
  git push origin main
  ```

- [ ] **Step 2: Verifikasi production**

  Buka `https://todo.yatno.web.id`, masuk ke page Diskusi:
  - Panel kiri: background cream, item aktif highlight lime dengan border kiri
  - Header chat: gradient lime, nama list + role, avatar bulat
  - Area messages: background gradient putih ke abu sangat muda
  - Bubble orang lain: putih, shadow halus, sudut rounded
  - Bubble self: gradient lime, teks putih, sudut rounded asimetris
  - Hover bubble → tombol ↩ muncul, **tidak tertutup panel kiri**
  - Klik quote block → scroll smooth ke pesan asli + highlight
  - Tombol kirim: bulat, gradient lime, hover scale
  - Dark mode: bubble orang lain gelap, self tetap lime, messages background gelap
