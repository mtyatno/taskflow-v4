# PWA Shortcuts — Quick Create (Buat Baru)

**Date:** 2026-05-10  
**Status:** Approved

## Overview

Add a single PWA home screen shortcut to TaskFlow so users can long-press the app icon on Android and immediately open the "Buat Baru" form (TaskFormModal with 4 tabs: Task, Habit, Note, Goal). On iOS, users achieve the same via the iOS Shortcuts app. A one-time hint toast educates installed users about the feature.

## Goals

- Android: long-press PWA icon → shortcut "Buat Baru" → opens TaskFormModal (4 tabs, Task active)
- iOS: user creates home screen shortcut via iOS Shortcuts app (documented, no code change needed)
- One-time hint toast on first standalone launch after login
- Works offline: app shell served from SW cache, form submission uses existing OfflineDB queue

## Non-Goals

- Native app (React Native / Capacitor)
- Real-time widget displaying task list
- Separate shortcut per content type (Task / Note / Habit / Goal)
- Unauthenticated access via shortcut URL

## Architecture

### URL Convention

| URL                 | Action                                        |
| ------------------- | --------------------------------------------- |
| `/?action=new-task` | Open TaskFormModal (mode defaults to "task")  |

### Flow

```
User long-presses PWA icon → taps "Buat Baru"
      ↓
PWA opens at /?action=new-task
      ↓
App() reads param via useState initializer (same pattern as ?join=)
      ↓
Auth check completes (existing token or login)
      ↓
useEffect fires: user + pendingAction both truthy
      ↓
setEditTask(null); setShowForm(true)
      ↓
URL cleaned: window.history.replaceState({}, "", "/")
```

### Offline Behavior

- `/?action=new-task` → SW matches `url.pathname === "/"` → serves app shell from cache ✓
- Task/habit/note/goal submitted offline → existing `OfflineDB.queueAdd` handles queuing ✓

## Components Changed

### 1. `static/manifest.json`

Add `shortcuts` array with one entry. Icon references SVG at `/static/`.

```json
"shortcuts": [
  {
    "name": "Buat Baru",
    "short_name": "Buat Baru",
    "description": "Buka form tambah task, habit, note, atau goal",
    "url": "/?action=new-task",
    "icons": [{ "src": "/static/icon-new-task.svg", "sizes": "any", "type": "image/svg+xml" }]
  }
]
```

### 2. `static/sw.js` — tambah icon ke STATIC cache

```js
"/static/icon-new-task.svg",
```

### 3. `static/index.html` — App() component

**Add state** (alongside existing `pendingJoinCode`):

```js
const [pendingAction, setPendingAction] = useState(() => {
  const params = new URLSearchParams(window.location.search);
  return params.get("action") || "";
});
```

**Add useEffect** untuk consume action (alongside existing join useEffect):

```js
useEffect(() => {
  if (!user || !pendingAction) return;
  if (pendingAction === "new-task") {
    setEditTask(null);
    setShowForm(true);
  }
  setPendingAction("");
  window.history.replaceState({}, "", "/");
}, [user, pendingAction]);
```

**Add useEffect** untuk one-time hint (after user is set):

```js
useEffect(() => {
  if (!user) return;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
  if (isStandalone && !localStorage.getItem('tf_shortcut_hint')) {
    showToast("💡 Tekan lama ikon app untuk akses cepat buat task/habit/note");
    localStorage.setItem('tf_shortcut_hint', '1');
  }
}, [user]);
```

### 4. `static/icon-new-task.svg`

Minimal SVG — plus sign on accent-colored background. SVG format:
- Works for all sizes (`sizes: "any"`)
- No build step needed
- Renders crisply at any resolution

## Error Handling

- User not logged in when shortcut tapped: app shows login page; `pendingAction` preserved in state, fires after login
- Unrecognized `action` param: silently ignored

## Testing

- Android Chrome: install PWA → long-press icon → verify "Buat Baru" shortcut appears → tap → verify TaskFormModal opens with Task tab active
- Offline: disable network → tap shortcut → app opens from cache → submit task → verify item queued in OfflineDB → re-enable network → verify sync
- Hint: clear `tf_shortcut_hint` from localStorage → open app in standalone mode → verify toast appears once

## iOS Setup (User Documentation)

No code change needed. User does this once:

1. Open iOS Shortcuts app
2. Tap `+` → Add Action → "Open URLs"
3. URL: `https://<taskflow-domain>/?action=new-task`
4. Tap shortcut name → "Add to Home Screen"
5. Set name "Buat Baru" and choose icon
