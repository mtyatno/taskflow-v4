# Architecture Decision Records (ADR)

---

### ADR-001: Multi-Agent Synchronization Protocol
- **Date:** 2026-08-12
- **Agent:** Antigravity (Gemini 3.6 Flash)
- **Context:** Multiple AI agents (Claude, DeepSeek, Antigravity/Gemini) access this workspace across different sessions, causing context loss and duplicate work.
- **Decision:** Standardize multi-agent context via root entrypoints (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`) and a shared memory folder (`.agents/`).
- **Consequences:** All agents must read `.agents/CURRENT_STATE.md` at start and log changes to `.agents/SESSION_LOG.md` at end.

---

### ADR-002: Native Filesystem Storage for Tauri JWT Tokens
- **Date:** 2026-08-05
- **Agent:** Claude
- **Context:** Android WebView `localStorage` is not persistent across app restarts in Tauri mobile builds.
- **Decision:** Replaced `localStorage` token storage with native filesystem JWT storage via Rust `app_data_dir()` commands and frontend JS integration.

---

### ADR-003: Retention of tldraw v2.4.6 for Drawing Canvas
- **Date:** 2026-08-19
- **Agent:** Antigravity (Gemini 3.7 Flash)
- **Context:** Evaluated upgrading `tldraw` to v5.3.2. Version 3+ introduces watermarks ("Made with tldraw") for non-commercial/free use and requires re-vendoring of offline assets and snapshot schema migrations.
- **Decision:** Retain `tldraw` v2.4.6. It is completely stable, watermark-free, 100% offline-first with self-hosted assets in `draw-app/public/cdn/2.4.6/`, and has custom export overrides for PNG/SVG/JSON.


---

### ADR-004: Note Trash via snapshot table `trashed_notes` (bukan kolom `deleted_at`)
- **Date:** 2026-10-02
- **Agent:** Claude
- **Context:** Fitur Sampah note butuh hapus yang bisa dipulihkan 30 hari. ±30 query di `webapp.py` membaca `scratchpad_notes` (list, search, titles, backlinks, halaman publik, export, bot); soft-delete lewat kolom memaksa semua query difilter dan satu yang terlewat membocorkan note terhapus.
- **Decision:** Hapus tetap menghapus dari `scratchpad_notes` (cascade lama tidak berubah), tetapi dalam transaksi yang sama menulis snapshot JSON (semua kolom + tag + pin + publish + lampiran) ke `trashed_notes`. Restore memasukkan kembali dengan id asli. Purge lazy setelah `NOTE_TRASH_RETENTION_DAYS = 30`. Endpoint `/api/scratchpad/trash*` hanya online (router lokal & SW tidak melayaninya). Spec: `docs/superpowers/specs/2026-10-02-note-trash-design.md`.
- **Consequences:** Query lama tidak tersentuh. Klien: setelah restore buang op outbox `delete` tertunda (`noterepo.discardPendingDelete`) dan pull memperbarui `linked_to_cids` basi. Keterbatasan: perangkat lain yang mengedit note saat note dihapus membuat salinan baru (POST setelah PUT 404) → setelah restore ada 2 note. File lampiran Nextcloud tidak dibersihkan saat hapus permanen (perilaku lama). Deploy wajib restart service agar `migrate_db()` membuat tabel.
