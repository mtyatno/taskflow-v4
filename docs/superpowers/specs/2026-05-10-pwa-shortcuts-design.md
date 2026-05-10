# PWA Shortcuts — Quick Create Task & Note

**Date:** 2026-05-10  
**Status:** Approved

## Overview

Add PWA home screen shortcuts to TaskFlow so users can long-press the app icon on Android and immediately jump to the new-task or new-note form — without navigating through the app first. On iOS, users achieve the same via the iOS Shortcuts app pointing to the same URLs.

## Goals

- Android: long-press PWA icon → shortcuts "Buat Task Baru" and "Buat Note Baru"
- iOS: user creates home screen shortcuts via iOS Shortcuts app (documented, no code change needed)
- App opens directly to the relevant form, already authenticated (no extra navigation)
- URL is cleaned up after action is consumed

## Non-Goals

- Native app (React Native / Capacitor)
- Real-time widget displaying task list
- Unauthenticated access via shortcut URL

## Architecture

### URL Convention

Two shortcut URLs trigger the respective actions:

| URL | Action |
|-----|--------|
| `/?action=new-task` | Open new task form modal |
| `/?action=new-note` | Navigate to Notes page + open new note modal |

### Flow

```
User taps shortcut
      ↓
PWA opens at /?action=new-task (or new-note)
      ↓
App() reads param via useState initializer (same pattern as ?join=)
      ↓
Auth check completes (existing token or login)
      ↓
useEffect fires: user + pendingAction both truthy
      ↓
  new-task → setEditTask(null); setShowForm(true)
  new-note → setPage("notes"), passes autoOpenNew=true to NotesPage
      ↓
URL cleaned: window.history.replaceState({}, "", "/")
```

## Components Changed

### 1. `static/manifest.json`

Add `shortcuts` array with two entries. Icons reference SVG files at `/static/`.

```json
"shortcuts": [
  {
    "name": "Buat Task Baru",
    "short_name": "Task Baru",
    "description": "Buka form tambah task baru",
    "url": "/?action=new-task",
    "icons": [{ "src": "/static/icon-new-task.svg", "sizes": "any", "type": "image/svg+xml" }]
  },
  {
    "name": "Buat Note Baru",
    "short_name": "Note Baru",
    "description": "Buka form tambah catatan baru",
    "url": "/?action=new-note",
    "icons": [{ "src": "/static/icon-new-note.svg", "sizes": "any", "type": "image/svg+xml" }]
  }
]
```

### 2. `static/index.html` — App() component

**Add state** (alongside existing `pendingJoinCode` state):
```js
const [pendingAction, setPendingAction] = useState(() => {
  const params = new URLSearchParams(window.location.search);
  return params.get("action") || "";
});
```

**Add useEffect** (alongside existing join useEffect):
```js
useEffect(() => {
  if (!user || !pendingAction) return;
  if (pendingAction === "new-task") {
    setEditTask(null);
    setShowForm(true);
  } else if (pendingAction === "new-note") {
    setPage("notes");
    setAutoOpenNote(true);
  }
  setPendingAction("");
  window.history.replaceState({}, "", "/");
}, [user, pendingAction]);
```

**Add state for note trigger:**
```js
const [autoOpenNote, setAutoOpenNote] = useState(false);
```

**Pass prop to NotesPage:**
```jsx
<NotesPage
  ...existing props...
  autoOpenNew={autoOpenNote}
  onAutoOpenDone={() => setAutoOpenNote(false)}
/>
```

### 3. `static/index.html` — NotesPage() component

**Add prop** `autoOpenNew = false` and `onAutoOpenDone`:
```js
function NotesPage({ tasks, showToast, onTaskClick, user, sharedLists = [], autoOpenNew = false, onAutoOpenDone }) {
```

**Add useEffect** after `openNew` is defined:
```js
useEffect(() => {
  if (autoOpenNew) {
    openNew();
    if (onAutoOpenDone) onAutoOpenDone();
  }
}, [autoOpenNew]);
```

### 4. New icon files

Two minimal SVG files in `static/`:

**`icon-new-task.svg`** — checkmark + plus on green background  
**`icon-new-note.svg`** — document + pencil on blue background

SVG format chosen because:
- Single file works for all sizes (`sizes: "any"`)
- No build step needed
- Renders crisply at any resolution

## Error Handling

- If user is not logged in when shortcut is tapped: app shows login page normally; `pendingAction` is preserved in state and fires once user logs in
- If `action` param is unrecognized: silently ignored (no `else` branch in the useEffect)

## Testing

- Android Chrome: install PWA → long-press icon → verify shortcuts appear → tap each → verify modal opens
- iOS: create shortcut via Shortcuts app → tap → verify correct page + modal opens
- Login flow: open shortcut URL while logged out → log in → verify modal auto-opens after login

## iOS Setup (User Documentation)

No code change needed. User does this once per shortcut:

1. Open iOS Shortcuts app
2. Tap `+` → Add Action → "Open URLs"
3. URL: `https://<taskflow-domain>/?action=new-task`
4. Tap shortcut name → "Add to Home Screen"
5. Set name "Task Baru" and choose icon
6. Repeat for note shortcut with `?action=new-note`
