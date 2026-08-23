# Agent Instructions & Synchronization Guidelines

> **IMPORTANT:** You are operating in a multi-agent shared workspace. Other agents (Claude, DeepSeek, Antigravity/Gemini) work in this repository.

## 🚨 MANDATORY WORKFLOW RULES

1. **BEFORE DOING ANYTHING:**
   - Read [.agents/CURRENT_STATE.md](file:///.agents/CURRENT_STATE.md) to check current active tasks and project status.
   - Read [.agents/PROTOCOL.md](file:///.agents/PROTOCOL.md) for execution standards.
   - Check recent entries in [.agents/SESSION_LOG.md](file:///.agents/SESSION_LOG.md).
   - Read [.agents/PROJECT_MAP.md](file:///.agents/PROJECT_MAP.md) — the single source of truth for domain ↔ codebase mapping (this repo contains ONLY Alurik (dulu TaskFlow); unknown project → ask the user).


2. **SUPERPOWERS PLUGIN DISCIPLINE (CRITICAL):**
   - **NO COWBOY CODING:** NEVER write implementation code inline without a subagent.
   - **SUBAGENT-DRIVEN:** You WAJIB (MUST) use `invoke_subagent` to delegate coding tasks and to review code (via `task-reviewer-prompt.md` or `code-reviewer.md`).
   - **EVIDENCE BEFORE COMPLETION:** You WAJIB (MUST) run `pytest` or verify JS manually before claiming a task is done.

3. **BEFORE COMPLETING YOUR TURN / SESSION:**
   - Update [.agents/CURRENT_STATE.md](file:///.agents/CURRENT_STATE.md) with updated status and handover notes.
   - Append your session summary to [.agents/SESSION_LOG.md](file:///.agents/SESSION_LOG.md).
