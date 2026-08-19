# AI Agent Collaboration Protocol

Every AI Agent (Claude, DeepSeek, Antigravity / Gemini, Cursor, Copilot, etc.) accessing this workspace MUST adhere to this 3-step workflow.

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
