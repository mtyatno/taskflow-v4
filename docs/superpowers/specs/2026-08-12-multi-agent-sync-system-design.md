# Multi-Agent Collaboration & Context Synchronization System Design

**Date:** 2026-08-12  
**Status:** Approved  
**Target Project:** TaskFlow V5.0 (`Z:\Todolist Manager V5.0`)  
**Target Agents:** Claude, DeepSeek, Antigravity (Gemini), Cursor, Copilot, and future AI agents.

---

## 1. Executive Summary & Objective

When multiple AI agents (Claude, DeepSeek, Antigravity/Gemini, etc.) operate on the same repository across different sessions, each agent lacks inherent awareness of actions taken by other agents in previous sessions. Without a unified protocol, agents risk re-diagnosing resolved issues, overwriting architectural choices, or working with stale assumptions.

This design establishes a **Universal Multi-Agent Synchronization System** utilizing standardized root entrypoint files and a structured `.agents/` shared memory folder. Every agent entering the codebase is automatically instructed to read current project status before starting work and to document changes before completing a session.

---

## 2. File & Directory Architecture

```
Z:\Todolist Manager V5.0\
├── AGENTS.md                   # Universal entrypoint for DeepSeek, Cursor, generic LLMs
├── CLAUDE.md                   # Entrypoint for Claude Code / Claude Desktop
├── GEMINI.md                   # Entrypoint for Antigravity / Gemini CLI
└── .agents/                    # Central Shared Memory Directory
    ├── PROTOCOL.md             # Mandatory rules & lifecycle workflow for agents
    ├── CURRENT_STATE.md        # Real-time state (Active task, working features, broken features)
    ├── SESSION_LOG.md          # Chronological log of agent sessions and changes
    └── DECISIONS.md            # Architecture Decision Records (ADRs)
```

---

## 3. Detailed Component Specifications

### 3.1. Root Entrypoints (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`)
Each root entrypoint file will contain concise, un-ignorable instructions:
1. **Mandatory Pre-Flight Check:** Read `.agents/CURRENT_STATE.md` and `.agents/SESSION_LOG.md` before executing any edits or diagnosis.
2. **Protocol Enforcement:** Read and follow `.agents/PROTOCOL.md`.
3. **Mandatory Post-Flight Update:** Update `.agents/CURRENT_STATE.md` and append a session entry to `.agents/SESSION_LOG.md` before finishing or pausing.

### 3.2. `.agents/PROTOCOL.md` (Agent Workflow Standard)
Defines the strict 3-step lifecycle for all AI agent sessions:

1. **Phase 1: Session Initialization (Start)**
   - Read `.agents/CURRENT_STATE.md` to understand what is working, what is broken, and what is currently being worked on.
   - Read the last 3 entries in `.agents/SESSION_LOG.md`.
   - Read relevant decisions in `.agents/DECISIONS.md`.

2. **Phase 2: Execution & Modification (Work)**
   - Maintain documentation integrity.
   - If a significant design decision is made (e.g., choosing REST over WebSockets, offline base64 fallback strategy), append an entry to `.agents/DECISIONS.md`.
   - Always run empirical verification commands before declaring success.

3. **Phase 3: Session Handover (Finish / Pause)**
   - Update `.agents/CURRENT_STATE.md`:
     - Set `Active Task` (Completed / In Progress).
     - Update `System Health` (Working / Known Issues).
     - Leave `Notes for Next Agent`.
   - Append to `.agents/SESSION_LOG.md`:
     - Timestamp (ISO 8601 or local format).
     - Agent Identifier (e.g., `Antigravity (Gemini 3.6 Flash)`, `Claude 3.7 Sonnet`, `DeepSeek V3`).
     - Summary of changes made.
     - List of modified/created files.

### 3.3. `.agents/CURRENT_STATE.md`
Contains the single-source-of-truth regarding current repo state:
- **Active Sprint / Task**: What is currently being built or debugged.
- **Working Systems**: Key verified subsystems (e.g., TaskFlow WebApp, Python Backend, Tauri desktop/mobile builds).
- **Known Issues & Bugs**: Tracked issues preventing blind re-investigation.
- **Handover Notes**: Direct messages to whichever AI agent runs next.

### 3.4. `.agents/SESSION_LOG.md`
Append-only log recording every agent's contribution:
```markdown
## [YYYY-MM-DD HH:mm] - <Agent Identifier>
- **Task:** <Description of task>
- **Changes:** <Key edits made>
- **Files Modified:** [<file_1>](file:///path), [<file_2>](file:///path)
- **Status:** <Completed | In Progress | Needs Review>
```

### 3.5. `.agents/DECISIONS.md`
Lightweight Architecture Decision Records (ADR):
```markdown
### ADR-001: <Title>
- **Date:** YYYY-MM-DD
- **Agent:** <Agent Identifier>
- **Context:** <Why this decision was needed>
- **Decision:** <What was chosen>
- **Consequences:** <Impact on future development>
```

---

## 4. Legacy Integration (`.remember/` Folder)

Existing historical notes from `.remember/` (`recent.md`, `archive.md`, `today-*.md`) will be preserved.
- `recent.md` and key context will be seeded into `.agents/SESSION_LOG.md` and `.agents/CURRENT_STATE.md` so historical context is not lost.
- `.remember/` will remain intact as a historical archive.

---

## 5. Verification & Validation Plan

1. **Existence Check:** Verify all files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, and `.agents/*`) are created in root workspace.
2. **Syntax & Link Check:** Ensure all markdown links use valid standard Markdown and relative/absolute `file://` URLs where appropriate.
3. **Initial State Seeding:** Populate `CURRENT_STATE.md` with current verified status of TaskFlow V5.0 project.
