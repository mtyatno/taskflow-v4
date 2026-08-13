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
