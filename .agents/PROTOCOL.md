# AI Agent Collaboration Protocol

Every AI Agent (Claude, DeepSeek, Antigravity / Gemini, Cursor, Copilot, etc.) accessing this workspace MUST adhere to this 4-step workflow.

---

## 1. PRE-FLIGHT CHECK (Start of Session)

Before executing any edits, code changes, or running diagnostic commands:
1. **Read Current State:** Read [.agents/CURRENT_STATE.md](file:///.agents/CURRENT_STATE.md) to understand current active tasks, system health, and known issues.
2. **Read Recent Logs:** Check the last 3 entries in [.agents/SESSION_LOG.md](file:///.agents/SESSION_LOG.md).
3. **Read Architecture Decisions:** Read [.agents/DECISIONS.md](file:///.agents/DECISIONS.md) to ensure your changes align with previous architectural decisions.
4. **Read Project Map:** Read [.agents/PROJECT_MAP.md](file:///.agents/PROJECT_MAP.md) — single source of truth untuk mapping domain/proyek ↔ lokasi codebase. Proyek yang tidak ada di tabel = JANGAN diasumsikan repo ini, tanya user dulu.

---

## 2. IN-FLIGHT EXECUTION (During Session)

1. **Preserve Integrity:** Maintain existing code conventions, documentation, and docstrings.
2. **Record Decisions:** If you make an important architectural choice (e.g. changing database schema, choosing offline fallback strategy, selecting library/framework), append a record to [.agents/DECISIONS.md](file:///.agents/DECISIONS.md).
3. **Verify Empirical Evidence:** Never claim a fix works without running test/verification commands.
4. **Superpowers Discipline:** You MUST strictly adhere to the Superpowers skills (Subagent-Driven Development, Test-Driven Development, Systematic Debugging). NEVER write implementation code inline. ALWAYS dispatch subagents for coding and reviewing.
5. **No Cowboy Coding:** NEVER push code and claim "It's done" without manually running the full test suite (`python -m pytest` or equivalent) and verifying the output yourself.

---

## 3. POST-FLIGHT HANDOVER (End of Session)

Before completing your turn or ending a session:
1. **Update Current State:** Update [.agents/CURRENT_STATE.md](file:///.agents/CURRENT_STATE.md) with:
   - Updated task status.
   - Known issues discovered or remaining.
   - Specific notes for the next AI agent.
2. **Log Session Work:** Append a new entry to [.agents/SESSION_LOG.md](file:///.agents/SESSION_LOG.md) using the standard format:
   ```markdown
   ## [YYYY-MM-DD HH:mm] - <Agent Identifier>
   - **Task:** <Brief summary of task>
   - **Changes:** <Key edits made>
   - **Files Touch:** <List of modified files>
   - **Status:** <Completed | In Progress | Needs Review>
   ```

---

## 4. CHECKLIST RILIS FRONTEND (setiap kenaikan versi SW)

1. Naikkan `CACHE` di `static/sw.js` dan `window.__SW_VERSION` (beserta fallback-nya) di `static/index.html`, lalu sesuaikan tes yang memeriksa versi. Bila mengganti string versi lama secara massal (mis. `sed` di seluruh `static/` dan `tests/`), **kecualikan `static/whatsnew.json`**: entri lama menyimpan versinya sendiri, dan rilis baru mendapat entri BARU di paling atas (butir 3).
2. Bila `app.css` berubah: naikkan `app.css?v=` di `index.html` **dan** entri yang sama di `STATIC`.
3. Tambahkan entri teratas di `static/whatsnew.json` untuk versi itu, di PR yang sama, sesuai aturan isi di `docs/superpowers/specs/2026-10-23-apa-yang-baru-design.md` §3.3 (dijaga `tests/test_whatsnew.py`). Ringkasnya: teks berbahasa Indonesia dari sudut pandang pengguna, `title` ≤ 60 karakter, tiap poin `new`/`fixed` ≤ 140 karakter, tanpa nama file, PR, atau istilah teknis. Rilis tanpa perubahan yang terasa oleh pengguna ditulis sebagai `{"version", "date", "silent": true}`.
4. Saat menggabungkan `main` dan nomor versi bentrok: pertahankan entri yang sudah ada di `main` apa adanya, naikkan versi PR ini di semua tempat termasuk `version` entrinya, dan pastikan entri itu tetap paling atas. Ubah hanya `version` pada entri milik PR ini; jangan mengubah `version` entri yang sudah ada di `main` (jangan `sed` massal ke `static/whatsnew.json`).
5. Jalankan `python -m pytest tests/test_whatsnew.py tests/test_sw_precache_node.py tests/test_app_update_node.py -q` sebelum push.
