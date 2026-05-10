# Mindmap Node Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow mindmap nodes to link to existing notes and tasks, with a panel inside the iframe (fullscreen-compatible) and a search picker in the parent React app.

**Architecture:** Links are stored as a `links` array on each node inside `data_json` (no backend changes). The link panel lives inside `vendor/mind-elixir/index.html` (vanilla JS) so it survives fullscreen. Communication is via postMessage between iframe and parent. Autosave is triggered by posting `{type:'change'}` to parent, reusing the existing debounce mechanism.

**Tech Stack:** Vanilla JS/HTML (iframe), React + Babel (parent SPA), existing `/api/search` endpoint, mind-elixir IIFE library.

---

## Files

| File | Action | What changes |
|------|--------|-------------|
| `static/vendor/mind-elixir/index.html` | Modify | Restructure HTML, add panel div + CSS, add selectNodes/unselectNodes listeners, findNode, renderPanel, addLink handler, removeLink, updateBadges, clearPanel |
| `static/index.html` | Modify | Add `LinkPickerModal` component (~120 lines before `MindmapPage`), extend `MindmapPage` props/state/message handler, add NoteModal render, wire props in `renderContent` |

---

## Task 1: iframe — Restructure HTML and add panel div + CSS

**Files:**
- Modify: `static/vendor/mind-elixir/index.html`

- [ ] **Step 1: Replace the `<body>` content**

Open `static/vendor/mind-elixir/index.html`. The current body is:
```html
<body>
  <div id="map"></div>
  <script src="MindElixir.iife.js"></script>
  <script>...</script>
</body>
```

Replace the `<style>` block and `<body>` with:

```html
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; }
    #app { display: flex; flex-direction: column; height: 100%; }
    #map { flex: 1; min-height: 0; overflow: hidden; }

    #link-panel {
      display: none;
      flex-shrink: 0;
      border-top: 2px solid #6c7ae0;
      background: #12122a;
      padding: 8px 12px;
      max-height: 160px;
      font-family: system-ui, sans-serif;
      font-size: 12px;
      color: #ccc;
    }
    #link-panel-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
      font-weight: 700;
      color: #ddd;
    }
    #link-panel-close {
      cursor: pointer;
      color: #666;
      font-size: 14px;
      line-height: 1;
      padding: 0 4px;
    }
    #link-panel-close:hover { color: #aaa; }
    #link-panel-items {
      display: flex;
      gap: 8px;
      align-items: stretch;
      overflow-x: auto;
    }
    .lp-card {
      background: #1e1e38;
      border: 1px solid #3a3a6a;
      border-radius: 7px;
      padding: 7px 10px;
      min-width: 160px;
      max-width: 220px;
      cursor: default;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .lp-card:hover { border-color: #6c7ae0; }
    .lp-card-row { display: flex; align-items: center; gap: 5px; }
    .lp-badge {
      border-radius: 3px;
      padding: 1px 5px;
      font-size: 9px;
      font-weight: 700;
      color: white;
      flex-shrink: 0;
    }
    .lp-badge-note { background: #6c7ae0; }
    .lp-badge-task { background: #e0a06c; }
    .lp-title { font-weight: 600; font-size: 11px; color: #ddd; flex: 1; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
    .lp-open { color: #6c7ae0; font-size: 14px; cursor: pointer; flex-shrink: 0; }
    .lp-open:hover { color: #9aa7f0; }
    .lp-remove { color: #e06c6c; font-size: 11px; cursor: pointer; flex-shrink: 0; }
    .lp-remove:hover { color: #ff9a9a; }
    .lp-preview { font-size: 10px; color: #666; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .lp-add-btn {
      background: transparent;
      border: 1.5px dashed #3a3a6a;
      border-radius: 7px;
      padding: 7px 14px;
      color: #6c7ae0;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      align-self: stretch;
      display: flex;
      align-items: center;
    }
    .lp-add-btn:hover { border-color: #6c7ae0; }

    .node-link-badge {
      position: absolute;
      top: -5px;
      right: -5px;
      background: #e0a06c;
      color: white;
      border-radius: 50%;
      width: 14px;
      height: 14px;
      font-size: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      pointer-events: none;
      z-index: 10;
    }
  </style>
</head>
<body>
  <div id="app">
    <div id="map"></div>
    <div id="link-panel">
      <div id="link-panel-header">
        <span id="link-panel-title">🔗 Links</span>
        <span id="link-panel-close" title="Tutup">✕</span>
      </div>
      <div id="link-panel-items"></div>
    </div>
  </div>
```

- [ ] **Step 2: Verify HTML structure**

Open the browser to the mindmap iframe URL directly: `http://localhost:8000/static/vendor/mind-elixir/index.html` (or whatever port the app runs on). The page should show a blank mind-elixir canvas. The panel div is hidden (`display:none`) so nothing else should appear. No JS errors in console.

- [ ] **Step 3: Commit**

```bash
git add static/vendor/mind-elixir/index.html
git commit -m "feat: restructure mindmap iframe HTML for link panel"
```

---

## Task 2: iframe — Node selection listeners + findNode

**Files:**
- Modify: `static/vendor/mind-elixir/index.html` (inside the `<script>` block)

- [ ] **Step 1: Add globals and findNode above `initMind`**

Inside the `<script>` block, before the `function initMind(data)` line, add:

```js
let currentNodeId = null;
let currentNodeData = null; // full nodeObj reference from getData()
let unselectTimer = null;

function findNode(node, id) {
  if (node.id === id) return node;
  for (const c of (node.children || [])) {
    const found = findNode(c, id);
    if (found) return found;
  }
  return null;
}

function showPanel() { document.getElementById('link-panel').style.display = 'block'; }
function hidePanel() { document.getElementById('link-panel').style.display = 'none'; }
```

- [ ] **Step 2: Add selectNodes/unselectNodes listeners inside `initMind`, after `mind.init(data)`**

After the line `mind.init(data);` and before or after the existing `mind.bus.addListener('operation', ...)` block, add:

```js
      mind.bus.addListener('selectNodes', (nodes) => {
        clearTimeout(unselectTimer);
        if (!nodes || nodes.length === 0) return;
        const node = nodes[0];
        currentNodeId = node.id;
        currentNodeData = findNode(mind.getData().nodeData, node.id);
        renderPanel(node.topic, currentNodeData ? (currentNodeData.links || []) : []);
        window.parent.postMessage(
          { type: 'nodeSelected', nodeId: node.id, topic: node.topic, links: currentNodeData ? (currentNodeData.links || []) : [] },
          window.location.origin
        );
      });

      mind.bus.addListener('unselectNodes', () => {
        unselectTimer = setTimeout(() => {
          currentNodeId = null;
          currentNodeData = null;
          hidePanel();
          window.parent.postMessage({ type: 'nodeDeselected' }, window.location.origin);
        }, 50);
      });
```

- [ ] **Step 3: Wire the close button**

After the listeners block, add:

```js
      document.getElementById('link-panel-close').onclick = () => {
        hidePanel();
        currentNodeId = null;
        currentNodeData = null;
        window.parent.postMessage({ type: 'nodeDeselected' }, window.location.origin);
      };
```

- [ ] **Step 4: Verify in browser**

Open the app, navigate to Mindmap, open any mindmap, click a node. Open DevTools → Console. You should see no errors. In the parent page's console, add temporarily: `window.addEventListener('message', e => console.log(e.data))` — clicking a node should log `{type: 'nodeSelected', nodeId: ..., topic: ..., links: []}`. Clicking empty space should log `{type: 'nodeDeselected'}` after ~50ms.

- [ ] **Step 5: Commit**

```bash
git add static/vendor/mind-elixir/index.html
git commit -m "feat: add node selection postMessage from mindmap iframe"
```

---

## Task 3: iframe — renderPanel function

**Files:**
- Modify: `static/vendor/mind-elixir/index.html`

- [ ] **Step 1: Add `renderPanel` before `initMind`**

```js
function renderPanel(topic, links) {
  document.getElementById('link-panel-title').textContent = '🔗 Links — ' + topic;
  const container = document.getElementById('link-panel-items');
  container.innerHTML = '';

  links.forEach((link, idx) => {
    const card = document.createElement('div');
    card.className = 'lp-card';

    const row = document.createElement('div');
    row.className = 'lp-card-row';

    const badge = document.createElement('span');
    badge.className = 'lp-badge ' + (link.type === 'note' ? 'lp-badge-note' : 'lp-badge-task');
    badge.textContent = link.type === 'note' ? 'NOTE' : 'TASK';

    const title = document.createElement('span');
    title.className = 'lp-title';
    title.textContent = link.title;

    const openBtn = document.createElement('span');
    openBtn.className = 'lp-open';
    openBtn.textContent = '↗';
    openBtn.title = 'Buka';
    openBtn.onclick = () => {
      window.parent.postMessage(
        { type: link.type === 'note' ? 'openNote' : 'openTask', id: link.id },
        window.location.origin
      );
    };

    const removeBtn = document.createElement('span');
    removeBtn.className = 'lp-remove';
    removeBtn.textContent = '✕';
    removeBtn.title = 'Hapus link';
    removeBtn.onclick = () => removeLinkAtIndex(idx);

    row.append(badge, title, openBtn, removeBtn);

    const preview = document.createElement('div');
    preview.className = 'lp-preview';
    if (link.type === 'task') {
      const parts = [];
      if (link.priority) parts.push(link.priority);
      if (link.deadline) parts.push('Due ' + link.deadline.slice(0, 10));
      if (link.status) parts.push(link.status);
      preview.textContent = parts.join(' · ') || '—';
    } else {
      preview.textContent = link.preview || '';
    }

    card.append(row, preview);
    container.appendChild(card);
  });

  // Add link button
  const addBtn = document.createElement('button');
  addBtn.className = 'lp-add-btn';
  addBtn.textContent = '+ Tambah link';
  addBtn.onclick = () => {
    window.parent.postMessage({ type: 'requestLinkPicker', nodeId: currentNodeId }, window.location.origin);
  };
  container.appendChild(addBtn);

  showPanel();
}
```

- [ ] **Step 2: Add `removeLinkAtIndex` before `initMind`**

```js
function removeLinkAtIndex(idx) {
  if (!currentNodeId || !currentNodeData) return;
  currentNodeData.links = (currentNodeData.links || []).filter((_, i) => i !== idx);
  renderPanel(currentNodeData.topic, currentNodeData.links);
  updateBadges();
  window.parent.postMessage({ type: 'change', data: mind.getData() }, window.location.origin);
}
```

Note: `updateBadges` is defined in Task 4. Add a stub for now:

```js
function updateBadges() { /* implemented in Task 4 */ }
```

- [ ] **Step 3: Verify**

Open the app, navigate to a mindmap, click a node that has no links. The panel should appear at the bottom with the header "🔗 Links — {topic}" and a "+ Tambah link" button. No errors in console. Click ✕ to close the panel — panel should hide.

- [ ] **Step 4: Commit**

```bash
git add static/vendor/mind-elixir/index.html
git commit -m "feat: add link panel renderPanel in mindmap iframe"
```

---

## Task 4: iframe — addLink handler + updateBadges

**Files:**
- Modify: `static/vendor/mind-elixir/index.html`

- [ ] **Step 1: Replace the `updateBadges` stub with the real implementation**

Find the stub `function updateBadges() { /* implemented in Task 4 */ }` and replace with:

```js
function updateBadges() {
  // Remove all existing badges
  document.querySelectorAll('.node-link-badge').forEach(el => el.remove());
  // Recursively add badges to nodes with links
  function addBadge(nodeData) {
    const count = (nodeData.links || []).length;
    if (count > 0) {
      // mind-elixir renders nodes as <me-tpc> elements; each has .nodeObj
      const allTopics = document.querySelectorAll('me-tpc');
      allTopics.forEach(el => {
        if (el.nodeObj && el.nodeObj.id === nodeData.id) {
          el.style.position = 'relative';
          const badge = document.createElement('span');
          badge.className = 'node-link-badge';
          badge.textContent = count;
          el.appendChild(badge);
        }
      });
    }
    (nodeData.children || []).forEach(addBadge);
  }
  addBadge(mind.getData().nodeData);
}
```

- [ ] **Step 2: Handle `addLink` in the `window.addEventListener('message', ...)` handler**

Inside the existing message handler (the `window.addEventListener('message', (e) => { ... })` block), add after the existing `if (e.data && e.data.type === 'load')` block:

```js
      if (e.data && e.data.type === 'addLink') {
        if (!currentNodeId || e.data.nodeId !== currentNodeId) return;
        // Re-fetch currentNodeData from live getData() to get latest state
        currentNodeData = findNode(mind.getData().nodeData, currentNodeId);
        if (!currentNodeData) return;
        if (!currentNodeData.links) currentNodeData.links = [];
        // Avoid duplicates
        const alreadyLinked = currentNodeData.links.some(
          l => l.type === e.data.link.type && l.id === e.data.link.id
        );
        if (alreadyLinked) return;
        currentNodeData.links.push(e.data.link);
        renderPanel(currentNodeData.topic, currentNodeData.links);
        updateBadges();
        window.parent.postMessage({ type: 'change', data: mind.getData() }, window.location.origin);
      }
```

- [ ] **Step 3: Call `updateBadges` after `mind.init(data)` in `initMind`**

Find the line `mind.init(data);` inside `initMind`. Add `updateBadges();` on the next line (after a small timeout so the DOM has rendered):

```js
      mind.init(data);
      setTimeout(updateBadges, 300);
```

- [ ] **Step 4: Verify badges**

Open app → Mindmap. Click a node, add a link via "+ Tambah link" (picker not wired yet — skip for now). After Task 6+7 are done, come back and verify that nodes with links show an orange badge with the link count.

For now, verify that `updateBadges()` runs without errors by checking the console after loading a mindmap.

- [ ] **Step 5: Commit**

```bash
git add static/vendor/mind-elixir/index.html
git commit -m "feat: add addLink handler and node badges in mindmap iframe"
```

---

## Task 5: iframe — clearPanel on load + re-init badge on load

**Files:**
- Modify: `static/vendor/mind-elixir/index.html`

- [ ] **Step 1: Handle `clearPanel` message**

Inside the existing `window.addEventListener('message', ...)` handler, add:

```js
      if (e.data && e.data.type === 'clearPanel') {
        currentNodeId = null;
        currentNodeData = null;
        clearTimeout(unselectTimer);
        hidePanel();
      }
```

- [ ] **Step 2: Re-run badges after `load` message**

The existing `load` handler calls `initMind(e.data.data)`. After it, add badge update:

```js
      if (e.data && e.data.type === 'load') {
        initMind(e.data.data);
        setTimeout(updateBadges, 300); // re-run after DOM renders
      }
```

Replace the existing:
```js
      if (e.data && e.data.type === 'load') {
        initMind(e.data.data);
      }
```

with:
```js
      if (e.data && e.data.type === 'load') {
        hidePanel();
        currentNodeId = null;
        currentNodeData = null;
        initMind(e.data.data);
        setTimeout(updateBadges, 300);
      }
```

- [ ] **Step 3: Verify**

Open the app, open mindmap A, click a node (panel appears), then switch to mindmap B. The panel should disappear immediately when switching. No stale state from previous mindmap.

- [ ] **Step 4: Commit**

```bash
git add static/vendor/mind-elixir/index.html
git commit -m "feat: clear link panel on mindmap switch"
```

---

## Task 6: Parent — LinkPickerModal component

**Files:**
- Modify: `static/index.html`

- [ ] **Step 1: Add `LinkPickerModal` component**

Find the comment `// ── Mindmap page ──` in `static/index.html` (around line 4391). Insert the following component *before* that comment:

```jsx
    // ── Link Picker Modal (for Mindmap node linking) ────────────
    function LinkPickerModal({ existingLinks = [], onSelect, onClose }) {
      const [query, setQuery] = React.useState("");
      const [tab, setTab] = React.useState("all"); // "all" | "notes" | "tasks"
      const [results, setResults] = React.useState(null);
      const [loading, setLoading] = React.useState(false);
      const debounceRef = React.useRef(null);
      const inputRef = React.useRef(null);

      React.useEffect(() => { inputRef.current?.focus(); }, []);

      React.useEffect(() => {
        clearTimeout(debounceRef.current);
        if (!query.trim()) { setResults(null); return; }
        setLoading(true);
        debounceRef.current = setTimeout(() => {
          api.get(`/api/search?q=${encodeURIComponent(query.trim())}`)
            .then(data => { setResults(data); setLoading(false); })
            .catch(() => { setResults(null); setLoading(false); });
        }, 300);
      }, [query]);

      const existingSet = new Set(existingLinks.map(l => `${l.type}-${l.id}`));

      const notes = (results?.notes || []).filter(n => !existingSet.has(`note-${n.id}`));
      const tasks = (results?.tasks || []).filter(t => !existingSet.has(`task-${t.id}`));
      const allItems = tab === 'notes' ? notes.map(n => ({...n, _type:'note'}))
                     : tab === 'tasks' ? tasks.map(t => ({...t, _type:'task'}))
                     : [...notes.map(n => ({...n, _type:'note'})), ...tasks.map(t => ({...t, _type:'task'}))];

      const handleSelect = (item) => {
        const link = item._type === 'note'
          ? { type: 'note', id: item.id, title: item.title, preview: (item.content || '').slice(0, 60) }
          : { type: 'task', id: item.id, title: item.title, priority: item.priority, deadline: item.deadline, status: item.gtd_status };
        onSelect(link);
      };

      return (
        <div className="modal-overlay" onClick={onClose}>
          <div className="modal-content" style={{ maxWidth: 420, maxHeight: '70vh', display:'flex', flexDirection:'column' }}
               onClick={e => e.stopPropagation()}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
              <span style={{ fontWeight:700, fontSize:15 }}>🔗 Tambah Link</span>
              <button className="btn-ghost" onClick={onClose} style={{ fontSize:18, lineHeight:1 }}>✕</button>
            </div>

            <input ref={inputRef} value={query} onChange={e => setQuery(e.target.value)}
              placeholder="Cari note atau task..."
              style={{ width:'100%', padding:'8px 12px', borderRadius:8, border:'1px solid var(--border)',
                background:'var(--bg-primary)', color:'var(--text-primary)', fontSize:13, marginBottom:10, outline:'none' }} />

            <div style={{ display:'flex', gap:6, marginBottom:10 }}>
              {['all','notes','tasks'].map(t => (
                <button key={t} onClick={() => setTab(t)}
                  style={{ padding:'4px 12px', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer',
                    background: tab===t ? 'var(--accent)' : 'var(--bg-primary)',
                    color: tab===t ? 'white' : 'var(--text-secondary)',
                    border:'1px solid var(--border)' }}>
                  {t === 'all' ? 'Semua' : t === 'notes' ? 'Notes' : 'Tasks'}
                </button>
              ))}
            </div>

            <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:6 }}>
              {!query.trim() && (
                <div style={{ color:'var(--text-light)', fontSize:13, textAlign:'center', padding:24 }}>
                  Ketik untuk mencari...
                </div>
              )}
              {loading && <div style={{ color:'var(--text-light)', fontSize:13, textAlign:'center', padding:16 }}>Mencari...</div>}
              {!loading && query.trim() && allItems.length === 0 && (
                <div style={{ color:'var(--text-light)', fontSize:13, textAlign:'center', padding:24 }}>Tidak ada hasil</div>
              )}
              {allItems.map(item => (
                <div key={`${item._type}-${item.id}`}
                  onClick={() => handleSelect(item)}
                  style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 10px', borderRadius:8,
                    border:'1px solid var(--border)', background:'var(--bg-primary)',
                    cursor:'pointer', transition:'border-color 0.15s' }}
                  onMouseOver={e => e.currentTarget.style.borderColor='var(--accent)'}
                  onMouseOut={e => e.currentTarget.style.borderColor='var(--border)'}>
                  <span style={{ background: item._type==='note' ? '#6c7ae0' : '#e0a06c',
                    color:'white', borderRadius:3, padding:'1px 6px', fontSize:10, fontWeight:700, flexShrink:0 }}>
                    {item._type === 'note' ? 'NOTE' : 'TASK'}
                  </span>
                  <span style={{ fontWeight:600, fontSize:13, flex:1, overflow:'hidden', whiteSpace:'nowrap', textOverflow:'ellipsis' }}>
                    {item.title}
                  </span>
                  {item._type === 'task' && item.priority && (
                    <span style={{ background:'var(--bg-card)', border:'1px solid var(--border)',
                      borderRadius:3, padding:'1px 5px', fontSize:10, color:'var(--text-secondary)', flexShrink:0 }}>
                      {item.priority}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      );
    }
```

- [ ] **Step 2: Verify component exists (no errors)**

Save the file. Open the app and navigate to any page — there should be no JS syntax errors in the console (the component is not yet mounted, just defined).

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "feat: add LinkPickerModal component for mindmap node linking"
```

---

## Task 7: Parent — Extend MindmapPage

**Files:**
- Modify: `static/index.html`

- [ ] **Step 1: Update MindmapPage signature and add new state**

Find:
```js
    function MindmapPage({ showToast }) {
```

Replace with:
```js
    function MindmapPage({ showToast, onTaskClick, tasks = [] }) {
```

Then find the existing state declarations block in `MindmapPage` (the block with `useState` calls). Add these new state variables after the existing ones (after `const iframeRef = useRef(null);` line):

```js
      const [modalNote, setModalNote]           = useState(null);
      const [showLinkPicker, setShowLinkPicker] = useState(false);
      const [pickerNodeId, setPickerNodeId]     = useState(null);
      const [currentNodeLinks, setCurrentNodeLinks] = useState([]);
```

- [ ] **Step 2: Extend the iframe message handler**

Find the existing `useEffect` that has `window.addEventListener("message", handler)` in `MindmapPage`. Inside the `handler` function, there are existing `if (e.data && e.data.type === "ready" ...)` and `if (e.data && e.data.type === "change" ...)` blocks.

Add these new blocks inside the same `handler`, after the existing blocks:

```js
          if (e.data && e.data.type === "nodeSelected") {
            setCurrentNodeLinks(e.data.links || []);
          }
          if (e.data && e.data.type === "nodeDeselected") {
            setCurrentNodeLinks([]);
          }
          if (e.data && e.data.type === "openNote") {
            api.get(`/api/scratchpad/${e.data.id}`)
              .then(note => setModalNote(note))
              .catch(() => showToast("Gagal memuat note", "error"));
          }
          if (e.data && e.data.type === "openTask") {
            if (typeof onTaskClick === "function") {
              const found = tasks.find(t => t.id === e.data.id);
              if (found) { onTaskClick(found); }
              else {
                api.get(`/api/tasks/${e.data.id}`)
                  .then(t => onTaskClick(t))
                  .catch(() => showToast("Gagal memuat task", "error"));
              }
            }
          }
          if (e.data && e.data.type === "requestLinkPicker") {
            setPickerNodeId(e.data.nodeId);
            setShowLinkPicker(true);
          }
```

- [ ] **Step 3: Send `clearPanel` when switching mindmaps**

Find the `selectMindmap` function inside `MindmapPage`:
```js
      const selectMindmap = async (m) => {
        if (selected?.id === m.id) return;
```

Add a `clearPanel` postMessage at the top of the function body, after the early return:

```js
      const selectMindmap = async (m) => {
        if (selected?.id === m.id) return;
        iframeRef.current?.contentWindow?.postMessage({ type: 'clearPanel' }, window.location.origin);
        setCurrentNodeLinks([]);
```

- [ ] **Step 4: Add LinkPickerModal and NoteModal renders**

Find the `return (` at the start of `MindmapPage`'s JSX. At the very end of the returned JSX (just before the closing `</div>` of the outermost element), add:

```jsx
          {showLinkPicker && (
            <LinkPickerModal
              existingLinks={currentNodeLinks}
              onSelect={(link) => {
                iframeRef.current?.contentWindow?.postMessage(
                  { type: 'addLink', nodeId: pickerNodeId, link },
                  window.location.origin
                );
                setCurrentNodeLinks(prev => [...prev, link]);
                setShowLinkPicker(false);
                setPickerNodeId(null);
              }}
              onClose={() => { setShowLinkPicker(false); setPickerNodeId(null); }}
            />
          )}
          {modalNote && (
            <NoteModal
              note={modalNote}
              tasks={tasks}
              onClose={() => setModalNote(null)}
              onSave={async (updates) => {
                try {
                  const saved = await api.put(`/api/scratchpad/${modalNote.id}`, updates);
                  setModalNote(null);
                  return saved;
                } catch(e) { showToast("Gagal simpan", "error"); }
              }}
              onDelete={async (id) => {
                try { await api.del(`/api/scratchpad/${id}`); setModalNote(null); } catch(e) {}
              }}
              onTaskClick={onTaskClick}
              showToast={showToast}
            />
          )}
```

- [ ] **Step 5: Verify**

Open the app → Mindmap → open a mindmap → click a node → panel appears at the bottom of the iframe. Click "+ Tambah link" → `LinkPickerModal` should appear as a React modal. Type a search term — results should appear. Click a result — modal closes, panel updates with the new link, the mindmap autosaves. Click ↗ on a note link → NoteModal opens. Click ↗ on a task link → task detail modal opens.

- [ ] **Step 6: Commit**

```bash
git add static/index.html
git commit -m "feat: extend MindmapPage with link picker and openNote/openTask handlers"
```

---

## Task 8: Wire MindmapPage props in App

**Files:**
- Modify: `static/index.html`

- [ ] **Step 1: Update the MindmapPage render in `renderContent`**

Find (around line 10279):
```jsx
        if (page === "mindmap") {
          return <MindmapPage showToast={showToast} />;
        }
```

Replace with:
```jsx
        if (page === "mindmap") {
          return <MindmapPage showToast={showToast} onTaskClick={setSelectedTask} tasks={tasks} />;
        }
```

- [ ] **Step 2: End-to-end verification**

Full flow test:

1. Open app → navigate to Mindmap
2. Open any mindmap → click a node → link panel appears at bottom of canvas
3. Click "+ Tambah link" → picker modal opens → search "test" → results appear
4. Click a Note result → modal closes → panel shows note link with preview
5. Click ↗ on the note link → NoteModal opens → close it
6. Click "+ Tambah link" again → search → pick a Task → panel shows task link with priority/deadline
7. Click ↗ on the task link → TaskDetailModal opens → close it
8. Click ✕ on a link in the panel → link disappears from panel → autosave triggers
9. Switch to a different mindmap → panel disappears
10. Switch back → links are still there (persisted via autosave)
11. Try fullscreen: press browser fullscreen (F11) → panel remains visible at bottom

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "feat: wire onTaskClick and tasks props to MindmapPage"
```

---

## Self-Review

**Spec coverage:**
- ✅ Data model — links in node `data_json` (Task 1–5)
- ✅ Panel inside iframe — vanilla HTML/CSS (Task 1)
- ✅ Panel layout — header + link cards + add button (Task 3)
- ✅ Node badges — `updateBadges()` (Task 4)
- ✅ postMessage protocol — all 9 message types covered (Tasks 2–5, 7)
- ✅ selectNodes/unselectNodes events with 50ms debounce (Task 2)
- ✅ findNode recursive helper (Task 2)
- ✅ addLink deduplication check (Task 4)
- ✅ clearPanel on mindmap switch (Task 5, Task 7 Step 3)
- ✅ LinkPickerModal — search, tabs, exclude existing (Task 6)
- ✅ openNote → NoteModal (Task 7)
- ✅ openTask → onTaskClick (Task 7)
- ✅ MindmapPage new props wired in App (Task 8)
- ✅ No backend changes

**Placeholder scan:** No TBDs or incomplete steps found.

**Type consistency:**
- `link` object shape `{type, id, title, preview?, priority?, deadline?, status?}` used consistently in Task 3 `renderPanel`, Task 4 `addLink`, Task 6 `handleSelect`, Task 7 `onSelect`
- `currentNodeData` is the live reference from `findNode(mind.getData().nodeData, ...)` — refreshed on addLink to avoid stale data
- `findNode` defined in Task 2, used in Tasks 2 and 4
- `renderPanel`, `hidePanel`, `showPanel`, `updateBadges` all defined before `initMind` (Tasks 3–4), called from within `initMind` and message handler
