# Multi-Agent Collaboration & Context Synchronization System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a multi-agent collaboration protocol and shared memory system so that Claude, DeepSeek, Antigravity (Gemini), and future AI agents seamlessly share state, context, and history across sessions.

**Architecture:** Create 3 root entrypoint files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`) that direct agents to a central `.agents/` directory containing mandatory protocol guidelines, current project state, architectural decision records (ADRs), and session logs.

**Tech Stack:** Markdown, Git, File-based agent system prompts.

## Global Constraints

- Root entrypoint filenames: `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`.
- Shared memory directory: `.agents/`.
- Protocol files: `.agents/PROTOCOL.md`, `.agents/CURRENT_STATE.md`, `.agents/SESSION_LOG.md`, `.agents/DECISIONS.md`.
- Existing `.remember/` contents must be preserved as a legacy archive.

---

### Task 1: Create Central Shared Memory Directory and Protocol Files (`.agents/`)

**Files:**
- Create: `.agents/PROTOCOL.md`
- Create: `.agents/CURRENT_STATE.md`
- Create: `.agents/DECISIONS.md`
- Create: `.agents/SESSION_LOG.md`

**Interfaces:**
- Produces: Base `.agents/` directory structure and protocol templates.

- [ ] **Step 1: Create `.agents/PROTOCOL.md`**

Write `.agents/PROTOCOL.md` with explicit instructions for all AI agents:

```markdown
# AI Agent Collaboration Protocol

Every AI Agent (Claude, DeepSeek, Antigravity / Gemini, Cursor, Copilot, etc.) accessing this workspace MUST adhere to this 3-step workflow.

---

## 1. PRE-FLIGHT CHECK (Start of Session)

Before executing any edits, code changes, or running diagnostic commands:
1. **Read Current State:** Read [.agents/CURRENT_STATE.md](file:///.agents/CURRENT_STATE.md) to understand current active tasks, system health, and known issues.
2. **Read Recent Logs:** Check the last 3 entries in [.agents/SESSION_LOG.md](file:///.agents/SESSION_LOG.md).
3. **Read Architecture Decisions:** Read [.agents/DECISIONS.md](file:///.agents/DECISIONS.md) to ensure your changes align with previous architectural decisions.

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
```

- [ ] **Step 2: Create `.agents/CURRENT_STATE.md` template**

Write `.agents/CURRENT_STATE.md`:

```markdown
# Current Workspace State & Handover

**Last Updated:** 2026-08-12  
**Updated By:** Setup Phase  

---

## 📌 Active Task
- Multi-Agent Synchronization System Setup.

## 🟢 Working Subsystems
- **TaskFlow WebApp (`webapp.py`, `static/index.html`):** Task management, scratchpad, notes, Pomodoro, calendar view.
- **SQLite Database (`repository.py`, `models.py`):** Schema migrations and task/note data access.
- **Telegram Bot (`bot.py`):** Bot interface for tasks & habits.

## 🔴 Known Issues / In Progress
- Attachment upload 422 errors fixed via direct endpoint (bypassing offline router UUID mapping). Base64 fallback in progress.

## ✉️ Notes for Next Agent
- Please review `.agents/PROTOCOL.md` before making any major code changes.
```

- [ ] **Step 3: Create `.agents/DECISIONS.md` template**

Write `.agents/DECISIONS.md`:

```markdown
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
```

- [ ] **Step 4: Create `.agents/SESSION_LOG.md` template**

Write `.agents/SESSION_LOG.md`:

```markdown
# Multi-Agent Session Log

Chronological history of work performed by AI agents in this workspace.

---
```

- [ ] **Step 5: Verify files created**

Run: Verify files `.agents/PROTOCOL.md`, `.agents/CURRENT_STATE.md`, `.agents/DECISIONS.md`, and `.agents/SESSION_LOG.md` exist.

---

### Task 2: Create Root Agent Entrypoints (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`)

**Files:**
- Create: `AGENTS.md`
- Create: `CLAUDE.md`
- Create: `GEMINI.md`

**Interfaces:**
- Consumes: Task 1 `.agents/` protocol files.

- [ ] **Step 1: Create `AGENTS.md`**

Write `AGENTS.md`:

```markdown
# Agent Instructions & Synchronization Guidelines

> **IMPORTANT:** You are operating in a multi-agent shared workspace. Other agents (Claude, DeepSeek, Antigravity/Gemini) work in this repository.

## 🚨 MANDATORY WORKFLOW RULES

1. **BEFORE DOING ANYTHING:**
   - Read [.agents/CURRENT_STATE.md](file:///.agents/CURRENT_STATE.md) to check current active tasks and project status.
   - Read [.agents/PROTOCOL.md](file:///.agents/PROTOCOL.md) for execution standards.
   - Check recent entries in [.agents/SESSION_LOG.md](file:///.agents/SESSION_LOG.md).

2. **BEFORE COMPLETING YOUR TURN / SESSION:**
   - Update [.agents/CURRENT_STATE.md](file:///.agents/CURRENT_STATE.md) with updated status and handover notes.
   - Append your session summary to [.agents/SESSION_LOG.md](file:///.agents/SESSION_LOG.md).
```

- [ ] **Step 2: Create `CLAUDE.md`**

Write `CLAUDE.md`:

```markdown
# Claude Code / Claude Desktop Instructions

> **IMPORTANT:** You are operating in a multi-agent shared workspace.

## 🚨 MANDATORY WORKFLOW RULES

1. **BEFORE DOING ANYTHING:**
   - Read [.agents/CURRENT_STATE.md](file:///.agents/CURRENT_STATE.md) to check current active tasks and project status.
   - Read [.agents/PROTOCOL.md](file:///.agents/PROTOCOL.md) for execution standards.
   - Check recent entries in [.agents/SESSION_LOG.md](file:///.agents/SESSION_LOG.md).

2. **BEFORE COMPLETING YOUR TURN / SESSION:**
   - Update [.agents/CURRENT_STATE.md](file:///.agents/CURRENT_STATE.md) with updated status and handover notes.
   - Append your session summary to [.agents/SESSION_LOG.md](file:///.agents/SESSION_LOG.md).
```

- [ ] **Step 3: Create `GEMINI.md`**

Write `GEMINI.md`:

```markdown
# Antigravity / Gemini Instructions

> **IMPORTANT:** You are operating in a multi-agent shared workspace.

## 🚨 MANDATORY WORKFLOW RULES

1. **BEFORE DOING ANYTHING:**
   - Read [.agents/CURRENT_STATE.md](file:///.agents/CURRENT_STATE.md) to check current active tasks and project status.
   - Read [.agents/PROTOCOL.md](file:///.agents/PROTOCOL.md) for execution standards.
   - Check recent entries in [.agents/SESSION_LOG.md](file:///.agents/SESSION_LOG.md).

2. **BEFORE COMPLETING YOUR TURN / SESSION:**
   - Update [.agents/CURRENT_STATE.md](file:///.agents/CURRENT_STATE.md) with updated status and handover notes.
   - Append your session summary to [.agents/SESSION_LOG.md](file:///.agents/SESSION_LOG.md).
```

- [ ] **Step 4: Verify root files created**

Verify `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` exist in root.

---

### Task 3: Seed Historical Logs & Complete Initial Handover

**Files:**
- Modify: `.agents/SESSION_LOG.md`
- Modify: `.agents/CURRENT_STATE.md`

- [ ] **Step 1: Seed `.agents/SESSION_LOG.md` with historical entries from `.remember/`**

Append historical session summaries from `.remember/recent.md` and `.remember/today-2026-08-11.md` into `.agents/SESSION_LOG.md`.

- [ ] **Step 2: Log current system initialization session**

Append current session entry to `.agents/SESSION_LOG.md`:
```markdown
## [2026-08-12 21:15] - Antigravity (Gemini 3.6 Flash)
- **Task:** Initialized Universal Multi-Agent Collaboration & Synchronization System.
- **Changes:** Created `AGENTS.md`, `CLAUDE.md`, `GEMINI.md` entrypoints and `.agents/` protocol directory (`PROTOCOL.md`, `CURRENT_STATE.md`, `SESSION_LOG.md`, `DECISIONS.md`).
- **Files Modified:** `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.agents/*`
- **Status:** Completed
```

---

### Task 4: Final Verification & Git Commit

**Files:**
- Repository root

- [ ] **Step 1: Verify file existence and markdown links**
- [ ] **Step 2: Run git status check to verify all files tracked**
- [ ] **Step 3: Commit changes**
