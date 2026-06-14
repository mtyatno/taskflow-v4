# Design Spec: Share link → TaskFlow bookmark note (Android native + content extraction)

**Date:** 2026-06-14
**Status:** Approved
**Sub-project:** First of two requested Android features. The second — Android home-screen widgets (new item / task list / notes / habits) — is a separate, larger sub-project deferred to its own spec.

---

## Overview

In the installed PWA, sharing a URL to TaskFlow already works: the manifest `share_target` opens `/?share_url=…&share_title=…&share_text=…`, and the app auto-creates a personal **Note** (title = shared title, content = `**Source:** <url>` + any quoted text, tag `bookmark`). This stopped working once the user moved to the **native Android APK**, because a native app is only offered in Android's share sheet if its `AndroidManifest.xml` declares an `ACTION_SEND` intent-filter — which the Tauri-generated manifest does not.

This feature (1) makes the **native app a share target** for links/text, and (2) **enriches the saved bookmark with the shared page's readable content**, not just the URL — an upgrade that also applies to the web/PWA share path.

A browser share gives only the **URL** (and sometimes a title/selected text), never the page body. To capture the page content, the **backend** fetches the URL and extracts its readable article text (reader-mode style). No AI/summarization — the full extracted article is saved.

### Locked decisions
- **Behaviour:** auto-save as a personal note tagged `bookmark` (no capture dialog), matching the old PWA flow, **plus** the extracted page content.
- **Content:** server-side readability extraction of the **full article text** (no AI summary).
- **Native customization mechanism:** **CI patch after `tauri android init`** (keep regenerating `gen/android`; a workflow step patches the manifest + activity). `gen/android` stays gitignored. (Committing `gen/android` was considered and deferred — revisit when widgets land.)
- **Extraction library:** `trafilatura` (Python) — robust article extraction + title.

### Out of scope (deferred)
- Android home-screen widgets (separate sub-project).
- A quick-capture/edit dialog or choosing note-vs-task on share (auto-save only).
- AI summarization.
- Sharing **into** a specific shared list (saves to personal notes).
- iOS share extension.

---

## 1. Android share-target registration (CI patch)

`android.yml` gains a step **after `npx tauri android init`** and **before `npx tauri android build`** that patches the generated project:

- **`gen/android/app/src/main/AndroidManifest.xml`** — add to the main `<activity>` a second `<intent-filter>`:
  ```xml
  <intent-filter>
    <action android:name="android.intent.action.SEND" />
    <category android:name="android.intent.category.DEFAULT" />
    <data android:mimeType="text/plain" />
  </intent-filter>
  ```
  This makes TaskFlow appear in the share sheet for shared text/links. The launcher `MAIN`/`LAUNCHER` intent-filter is left intact.

- The patch is applied with a small, resilient script (idempotent; fails loudly if the anchor it edits is missing, so a Tauri template change surfaces in CI rather than silently dropping the feature).

The exact patch tooling (e.g. a Node/Python script invoked from the workflow) is an implementation detail; the requirement is: **manifest has the SEND intent-filter, activity has the capture code (below), and the build still succeeds.**

---

## 2. Native → webview handoff

The shared text must reach the JS app. The chosen mechanism is a **file handoff** (language-agnostic, no need for a webview reference or a full Tauri plugin):

1. **Kotlin (patched `MainActivity`)** — on `onCreate` and `onNewIntent`, if `intent.action == ACTION_SEND` and type is text, read `EXTRA_TEXT` (the shared URL/text) and `EXTRA_SUBJECT` (often the page title), then write a small JSON payload (`{ "text": …, "subject": … }`) to a fixed file in the app's private storage (e.g. `filesDir/pending_share.json`).
2. **Rust command** `get_pending_share()` in `src-tauri/src/lib.rs` (committed, survives regeneration) — reads the file, deletes it, returns the payload (or `null`). Registered via `.invoke_handler(generate_handler![get_pending_share])`.
3. **JS** — on startup **and** on app-resume (`visibilitychange`/`focus`), call `window.__TAURI__.core.invoke('get_pending_share')` (only when running natively — `API_BASE` set + `window.__TAURI__` present). If a payload is returned, feed it into the **existing** share handler by setting `shareData` (`{ url, title, text }`), reusing the same code the PWA path uses.

**R&D risk (flagged):** reliable `ACTION_SEND` capture on cold start vs. running app, and the Kotlin↔Rust file-path agreement (the Kotlin `filesDir` vs. the path the Rust command reads), are the parts most likely to need 1–N CI iterations — like the initial APK build. The path is coordinated explicitly (both sides target the app's private `files` dir); if Tauri's resolver and Kotlin's `filesDir` differ, the Rust side resolves the same absolute path.

The web/PWA path is unchanged (it still arrives via `?share_url=…` query params); only the **native delivery** is new.

---

## 3. Backend content extraction

New endpoint **`POST /api/bookmark/extract`** (auth: `get_current_user`), body `{ "url": "<http(s) url>" }` → `{ "title": "...", "content": "...", "url": "..." }`.

- Validates the URL is `http`/`https`; rejects others.
- **SSRF guard:** reject obviously-internal targets (localhost, private/loopback/link-local IP ranges, the VPS's own host); only fetch public hosts.
- Fetches with a timeout (~10 s), a browser-like User-Agent, a response **size cap** (e.g. 5 MB), and only proceeds for HTML content types.
- Extracts the main article (title + readable text) with **trafilatura**; on extraction failure returns `{ title: <best available>, content: "" }` (caller falls back to URL-only).
- Caps the returned content to a sane length (e.g. ~50 000 chars) to avoid giant notes.
- New Python dependency `trafilatura` → add to requirements; **requires a `taskflow-web` restart** after deploy.

This endpoint is independently testable and immediately improves the **web/PWA** share too.

---

## 4. Frontend bookmark save (web + native)

Enhance the existing share handler (`static/index.html`, the `shareData` auto-clip effect):

1. When `shareData` has a `url`, call `apiUrl('/api/bookmark/extract')` with the url.
2. Build the note:
   - **title** = extracted title || `shareData.title` || url
   - **content** = `**Source:** <url>` + (extracted content ? `\n\n` + content : (shareData.text ? `\n\n> ` + shareData.text : ""))
   - **tags** = `["bookmark"]`
3. Save via the existing offline note layer (`api.post('/api/scratchpad', …)` — intercepted by `noteroutes`, so it is offline-capable and syncs).
4. Toast "Tersimpan di Notes! 📎". (Drop the PWA-era `window.close()` for the native app, where it doesn't apply; keep a clean post-save state.)

**Offline / error handling:** the extract call needs the backend. If it fails (offline, timeout, extraction error), skip the content and save the note with **url + title** only (current behaviour) — never block the bookmark on extraction. The note creation itself works offline via the outbox.

---

## 5. Architecture & isolation

Two loosely-coupled pieces, sequenced in the plan:

- **(a) Extraction + save** — backend `extract` endpoint + frontend share-handler enrichment. Testable, and works on the **web** immediately (no native build needed).
- **(b) Native Android share** — the CI manifest/activity patch + Rust `get_pending_share` command + JS native-delivery glue. R&D, validated via CI build + on-device.

Building (a) first de-risks: the content/save logic is proven on web before the native plumbing is added.

---

## 6. Testing & Verification

- **Backend:** unit-test `extract` against a saved HTML fixture (title + body extracted; non-HTML / bad URL / SSRF target rejected). No live network in tests.
- **Frontend:** the offline Node suite stays green (no offline-module change expected); the share-handler enrichment is plumbing verified by inline-script parse + manual web check (share via the installed PWA → note has Source + article).
- **Native:** not unit-testable. Acceptance = build the APK, share a link from Chrome Android → TaskFlow opens and a bookmark note appears with the page content. Likely 1–N CI iterations on the manifest/activity patch.
- SW cache version bumped on the static change.

---

## 7. Known gaps after this feature
- Paywalled / JS-rendered pages may extract little or nothing (server fetch sees no JS) → falls back to url-only.
- No de-duplication of repeated bookmarks of the same URL.
- Native share capture reliability across Android launchers/OEMs may need tuning.
- Widgets remain a separate, larger sub-project.
