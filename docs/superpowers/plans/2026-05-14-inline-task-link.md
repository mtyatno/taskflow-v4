# Inline Task Link — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tambah fitur task linking inline di dalam teks note — ketik `[task`, pilih dari dropdown, muncul sebagai badge priority inline; section "Di-link ke Task" menjadi read-only derived dari konten teks.

**Architecture:** Tambah ProseMirror node baru `tasklink` (serial ke `[tasklink:ID]` dalam markdown) mengikuti pola wikilink yang sudah ada. Trigger detection di `handleEditorChange`, insert via `insertTasklink()`. Section "Di-link ke Task" berubah menjadi pure read-only: derived dari parsing konten, tanpa UI tambah/hapus. Scope task picker difilter berdasarkan `sharedLists` prop; badge task yang tidak accessible menampilkan fallback.

**Tech Stack:** React (Babel JSX, no build step — raw in `static/index.html`), Milkdown (`window.MilkdownBundle`), ProseMirror, remark AST transformer (pola identik dengan wikilink). SW cache di `static/sw.js`.

---

## File Map

| File                | Perubahan                                                                                                                                                                   |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `static/index.html` | CSS + `remarkTasklinkPlugin` + `createTasklinkPlugin` + `extractTaskIdsFromContent` + update `MilkdownEditor` + update `NoteModal` state/handlers/UI + update `NoteToolbar` |
| `static/sw.js`      | Bump cache version v85 → v86                                                                                                                                                |

Semua perubahan React/JS ada di satu file. Ikuti pola existing dengan ketat — tidak ada restrukturisasi file.

---

### Task 1: CSS — Tasklink Node Badge Styles

**Files:**

- Modify: `static/index.html` — tepat setelah blok CSS `.wikilink-node` (sekitar line 1006–1020)

- [ ] **Step 1: Cari anchor CSS wikilink-node**

```bash
grep -n "wikilink-node" static/index.html | head -10
```

Expected: menampilkan baris `.wikilink-node {` di sekitar line 1006.

- [ ] **Step 2: Tambah CSS tasklink-node setelah blok wikilink-node**

Tambahkan tepat setelah penutup `}` dari blok `.wikilink-node:hover { ... }`:

```css
    .tasklink-node {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      background: #fef9c3;
      border: 1px solid #fde68a;
      border-radius: 4px;
      padding: 1px 7px;
      font-size: 12px;
      font-weight: 600;
      color: #92400e;
      cursor: pointer;
      vertical-align: middle;
      text-decoration: none;
      transition: opacity 0.15s;
      user-select: none;
    }
    .tasklink-node:hover { opacity: 0.75; }
    .tasklink-status-label {
      color: white;
      font-size: 9px;
      padding: 0 5px;
      border-radius: 2px;
      letter-spacing: 0.3px;
      font-weight: 700;
    }
    .tasklink-priority-label {
      color: white;
      font-size: 10px;
      padding: 0 4px;
      border-radius: 2px;
      font-weight: 700;
    }
    .tasklink-node-fallback {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      padding: 1px 7px;
      font-size: 12px;
      font-weight: 600;
      color: #64748b;
      vertical-align: middle;
      user-select: none;
    }
```

Juga tambahkan dark mode setelah blok `[data-theme="dark"] .wikilink-node:hover { ... }`:

```css
    [data-theme="dark"] .tasklink-node {
      background: rgba(254,249,195,0.12);
      border-color: rgba(253,230,138,0.3);
      color: #fde68a;
    }
    [data-theme="dark"] .tasklink-node:hover { opacity: 0.75; }
    [data-theme="dark"] .tasklink-node-fallback {
      background: rgba(241,245,249,0.08);
      border-color: rgba(203,213,225,0.2);
      color: #94a3b8;
    }
```

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "style: add tasklink-node badge CSS"
```

---

### Task 2: Helper Functions — `remarkTasklinkPlugin` dan `extractTaskIdsFromContent`

**Files:**

- Modify: `static/index.html` — tepat setelah `remarkWikilinkPlugin` function (sekitar line 8267)

- [ ] **Step 1: Cari anchor remarkWikilinkPlugin**

```bash
grep -n "function remarkWikilinkPlugin\|function extractTaskIds\|function createWikilinkPlugin" static/index.html
```

Expected output menunjukkan `remarkWikilinkPlugin` di ~line 8234, `createWikilinkPlugin` di ~line 8269.

- [ ] **Step 2: Tambah `remarkTasklinkPlugin` dan `extractTaskIdsFromContent` setelah `remarkWikilinkPlugin`**

Sisipkan tepat sebelum baris `function createWikilinkPlugin(onWikilinkClick) {`:

```javascript
    function remarkTasklinkPlugin() {
      return function transformer(tree) {
        function walk(node, parent, index) {
          if (node.type === 'text' && typeof node.value === 'string') {
            const regex = /\[tasklink:(\d+)\]/g;
            const parts = [];
            let lastIndex = 0;
            let match;
            while ((match = regex.exec(node.value)) !== null) {
              if (match.index > lastIndex) {
                parts.push({ type: 'text', value: node.value.slice(lastIndex, match.index) });
              }
              parts.push({ type: 'tasklink', taskId: Number(match[1]) });
              lastIndex = regex.lastIndex;
            }
            if (parts.length > 0) {
              if (lastIndex < node.value.length) {
                parts.push({ type: 'text', value: node.value.slice(lastIndex) });
              }
              parent.children.splice(index, 1, ...parts);
              return index + parts.length;
            }
          }
          if (node.children && Array.isArray(node.children)) {
            let i = 0;
            while (i < node.children.length) {
              const next = walk(node.children[i], node, i);
              i = next !== undefined ? next : i + 1;
            }
          }
        }
        walk(tree, null, 0);
      };
    }

    function extractTaskIdsFromContent(markdown) {
      const matches = [...(markdown || '').matchAll(/\[tasklink:(\d+)\]/g)];
      return [...new Set(matches.map(m => Number(m[1])))];
    }
```

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "feat: add remarkTasklinkPlugin and extractTaskIdsFromContent"
```

---

### Task 3: `createTasklinkPlugin(tasksGetter)` — ProseMirror Node + Remark Plugin

**Files:**

- Modify: `static/index.html` — tepat setelah `createWikilinkPlugin` function (setelah line `return [wikilinkRemark, wikilinkNode];`)

Priority color map identik dengan PriBadge: P1=#ef4444, P2=#f97316, P3=#eab308, P4=#94a3b8.
Status DONE: `gtd_status === 'done' || gtd_status === 'archived'`.

- [ ] **Step 1: Cari penutup createWikilinkPlugin**

```bash
grep -n "return \[wikilinkRemark, wikilinkNode\]\|function extractHeadings" static/index.html
```

Expected: menemukan `return [wikilinkRemark, wikilinkNode];` di ~line 8307, `function extractHeadings` di ~line 8310.

- [ ] **Step 2: Sisipkan `createTasklinkPlugin` antara `createWikilinkPlugin` dan `extractHeadings`**

```javascript
    function createTasklinkPlugin(tasksGetter) {
      const MB = window.MilkdownBundle;

      const PRI_COLORS = { P1: '#ef4444', P2: '#f97316', P3: '#eab308', P4: '#94a3b8' };

      const tasklinkNode = MB.$node('tasklink', () => ({
        group: 'inline',
        inline: true,
        atom: true,
        attrs: { taskId: { default: 0 } },
        toDOM: (node) => {
          const tasks = tasksGetter();
          const task = tasks.find(t => t.id === node.attrs.taskId);
          if (!task) {
            return ['span', { class: 'tasklink-node-fallback', 'data-tasklink': '', 'data-tasklink-id': String(node.attrs.taskId) },
              ['span', { class: 'tasklink-status-label', style: 'background:#3b82f6' }, 'OPEN'],
              ' ',
              ['span', { class: 'tasklink-priority-label', style: 'background:#94a3b8' }, '?'],
              ' task tidak tersedia',
            ];
          }
          const isDone = task.gtd_status === 'done' || task.gtd_status === 'archived';
          const statusLabel = isDone ? 'DONE' : 'OPEN';
          const statusColor = isDone ? '#16a34a' : '#3b82f6';
          const priority = task.priority || 'P4';
          const priColor = PRI_COLORS[priority] || '#94a3b8';
          return ['span', {
            class: 'tasklink-node',
            'data-tasklink': '',
            'data-tasklink-id': String(task.id),
            title: `Task: ${task.title}`,
          },
            ['span', { class: 'tasklink-status-label', style: `background:${statusColor}` }, statusLabel],
            ' ',
            ['span', { class: 'tasklink-priority-label', style: `background:${priColor}` }, priority],
            ` ${task.title}`,
          ];
        },
        parseDOM: [{
          tag: 'span[data-tasklink]',
          getAttrs: (dom) => ({ taskId: Number(dom.getAttribute('data-tasklink-id') || 0) }),
        }],
        parseMarkdown: {
          match: (node) => node.type === 'tasklink',
          runner: (state, node, type) => {
            state.addNode(type, { taskId: node.taskId });
          },
        },
        toMarkdown: {
          match: (node) => node.type.name === 'tasklink',
          runner: (state, node) => {
            state.addNode('text', undefined, `[tasklink:${node.attrs.taskId}]`);
          },
        },
      }));

      const tasklinkRemark = MB.$remark('tasklink-remark', () => remarkTasklinkPlugin);

      return [tasklinkRemark, tasklinkNode];
    }
```

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "feat: add createTasklinkPlugin with ProseMirror tasklink node"
```

---

### Task 4: Update `MilkdownEditor` — Tambah Props + Plugin + Click Handler

**Files:**

- Modify: `static/index.html` — function `MilkdownEditor` (~line 8116)

`MilkdownEditor` saat ini: `{ value, onChange, minHeight, editorRef, onWikilinkClick }`.
`handleContainerClick` saat ini: hanya cek `[data-wikilink]`.

- [ ] **Step 1: Update function signature**

Ubah baris:

```javascript
    function MilkdownEditor({ value, onChange, minHeight, editorRef, onWikilinkClick }) {
```

Menjadi:

```javascript
    function MilkdownEditor({ value, onChange, minHeight, editorRef, onWikilinkClick, tasksGetter, onTasklinkClick }) {
```

- [ ] **Step 2: Tambah plugin `.use(createTasklinkPlugin(tasksGetter))` setelah wikilink plugin**

Ubah:

```javascript
          .use(createWikilinkPlugin(onWikilinkClick))
          .create()
```

Menjadi:

```javascript
          .use(createWikilinkPlugin(onWikilinkClick))
          .use(createTasklinkPlugin(tasksGetter || (() => [])))
          .create()
```

- [ ] **Step 3: Update `handleContainerClick` — tambah deteksi `[data-tasklink]`**

Ubah:

```javascript
      const handleContainerClick = React.useCallback((e) => {
        const target = e.target.closest('[data-wikilink]');
        if (target && onWikilinkClick) {
          onWikilinkClick(target.getAttribute('data-title'));
        }
      }, [onWikilinkClick]);
```

Menjadi:

```javascript
      const handleContainerClick = React.useCallback((e) => {
        const wikiTarget = e.target.closest('[data-wikilink]');
        if (wikiTarget && onWikilinkClick) {
          onWikilinkClick(wikiTarget.getAttribute('data-title'));
          return;
        }
        const taskTarget = e.target.closest('[data-tasklink]');
        if (taskTarget && onTasklinkClick) {
          onTasklinkClick(Number(taskTarget.getAttribute('data-tasklink-id') || 0));
        }
      }, [onWikilinkClick, onTasklinkClick]);
```

- [ ] **Step 4: Commit**

```bash
git add static/index.html
git commit -m "feat: wire tasksGetter and onTasklinkClick into MilkdownEditor"
```

---

### Task 5: NoteModal — Tambah State, Refs, dan Update `initTaskIds`

**Files:**

- Modify: `static/index.html` — bagian atas `NoteModal` function (~line 8360)

`initTaskIds` saat ini: hanya baca dari `note.linked_task_ids` / `note.linked_task_id`.
Perlu tambah: ekstrak dari konten (backward compat = union keduanya).

- [ ] **Step 1: Update `initTaskIds` — union dari content + DB IDs**

Ubah:

```javascript
      const initTaskIds = () => {
        if (note?.linked_task_ids?.length) return note.linked_task_ids;
        if (note?.linked_task_id) return [note.linked_task_id];
        return [];
      };
```

Menjadi:

```javascript
      const initTaskIds = () => {
        const contentIds = extractTaskIdsFromContent(note?.content || '');
        const dbIds = note?.linked_task_ids?.length
          ? note.linked_task_ids
          : (note?.linked_task_id ? [note.linked_task_id] : []);
        return [...new Set([...contentIds, ...dbIds])];
      };
```

- [ ] **Step 2: Hapus state `showTaskSearch`, ganti dengan `taskDropdown`**

Ubah:

```javascript
      const [taskSearch, setTaskSearch]       = useState("");
      const [showTaskSearch, setShowTaskSearch] = useState(false);
      const [creatingTask, setCreatingTask]   = useState(false);
```

Menjadi:

```javascript
      const [taskDropdown, setTaskDropdown]   = useState(null);
```

(`taskSearch`, `showTaskSearch`, `creatingTask` dihapus — diganti oleh `taskDropdown.query`)

- [ ] **Step 3: Tambah `allKnownTasksRef` dan stable `tasksGetterRef` setelah deklarasi state**

Cari baris:

```javascript
      const milkdownEditorRef         = React.useRef(null);
```

Tambahkan tepat sesudahnya:

```javascript
      const allKnownTasksRef          = React.useRef([]);
      const tasksGetterRef            = React.useRef(() => allKnownTasksRef.current);
      const taskDropdownRef           = React.useRef(null);
```

- [ ] **Step 4: Tambah `pickerTasks` dan update `allKnownTasksRef` di area derived values**

Cari baris (sekitar line 8834):

```javascript
      const allKnownTasks = [...tasks, ...localNewTasks.filter(t => !tasks.find(x => x.id === t.id))];
      const linkedTasks   = allKnownTasks.filter(t => linkedTaskIds.includes(t.id));
      const filteredTasks = allKnownTasks.filter(t =>
        t.gtd_status !== "done" && t.gtd_status !== "archived" &&
        t.title.toLowerCase().includes(taskSearch.toLowerCase())
      ).slice(0, 8);
```

Ubah menjadi:

```javascript
      const allKnownTasks = [...tasks, ...localNewTasks.filter(t => !tasks.find(x => x.id === t.id))];
      allKnownTasksRef.current = allKnownTasks;
      const linkedTasks   = allKnownTasks.filter(t => linkedTaskIds.includes(t.id));

      // pickerTasks: scope filtered by shared lists
      // If note is shared, show only tasks from shared list IDs (tasks need list_id field).
      // Verify field name: check t.list_id in your task objects.
      const pickerTasks = React.useMemo(() => {
        if (!sharedLists?.length) return allKnownTasks.filter(t => t.gtd_status !== 'done' && t.gtd_status !== 'archived');
        const sharedIds = new Set(sharedLists.map(l => l.id));
        return allKnownTasks.filter(t =>
          t.gtd_status !== 'done' && t.gtd_status !== 'archived' &&
          sharedIds.has(t.list_id)
        );
      }, [allKnownTasks, sharedLists]);

      const taskDropdownItems = taskDropdown !== null
        ? pickerTasks
            .filter(t => !linkedTaskIds.includes(t.id) && t.title.toLowerCase().includes((taskDropdown.query || '').toLowerCase()))
            .slice(0, 8)
        : [];
```

**Note:** Jika tasks tidak punya field `list_id`, skip filter sharedIds — gunakan `return allKnownTasks.filter(...)` tanpa scope filtering. Verifikasi dengan `console.log(tasks[0])` di browser.

- [ ] **Step 5: Commit**

```bash
git add static/index.html
git commit -m "feat: add taskDropdown state, tasksGetterRef, pickerTasks to NoteModal"
```

---

### Task 6: Update `handleEditorChange` — Task Trigger Detection + Sync `linkedTaskIds`

**Files:**

- Modify: `static/index.html` — function `handleEditorChange` (~line 8633)

Trigger regex: `/\[(task|tasks|todo|todos|tugas)[a-zA-Z0-9 ]*$/i` pada `textBefore`.
Guard: pastikan tidak diawali `[` (itu wikilink territory).
Sync: setiap edit, `setLinkedTaskIds` dari `extractTaskIdsFromContent(markdown)`.

- [ ] **Step 1: Update `handleEditorChange`**

Ubah seluruh function (dari `const handleEditorChange = (markdown) => {` sampai penutup `};`):

```javascript
      const handleEditorChange = (markdown) => {
        setContent(markdown);
        autoConvertWikilinkAtCursor();

        // Auto-extract tags
        const extracted = [...new Set(
          (markdown.match(/#([a-zA-Z0-9_À-ɏ]+)/g) || [])
            .map(t => t.slice(1).toLowerCase().trim())
        )].filter(Boolean);
        if (JSON.stringify(extracted) !== JSON.stringify(tags)) {
          setTags(extracted);
        }

        // Sync linkedTaskIds from content (source of truth)
        const parsedTaskIds = extractTaskIdsFromContent(markdown);
        setLinkedTaskIds(prev => {
          if (JSON.stringify(prev.slice().sort()) === JSON.stringify(parsedTaskIds.slice().sort())) return prev;
          return parsedTaskIds;
        });

        const textBefore = getTextBeforeCursor();
        const getPos = getCursorCoords;

        // Tag autocomplete
        const tagMatch = textBefore.match(/#([a-zA-Z0-9_À-ɏ]*)$/);
        if (tagMatch) {
          const query = tagMatch[1].toLowerCase();
          const items = existingTags
            .filter(t => t.name.startsWith(query) && !extracted.includes(t.name))
            .slice(0, 6);
          if (items.length > 0) {
            const coords = getPos();
            setTagDropdown({ query, items, top: coords.top, left: coords.left });
          } else {
            setTagDropdown(null);
          }
        } else {
          setTagDropdown(null);
        }

        // Task link trigger detection: [task, [tasks, [todo, [todos, [tugas (case-insensitive)
        // Guard: char before [ must NOT be [ (that would be wikilink territory)
        const taskTriggerMatch = textBefore.match(/\[(task|tasks|todo|todos|tugas)[a-zA-Z0-9 ]*$/i);
        if (taskTriggerMatch) {
          const charBeforeBracket = textBefore[textBefore.length - taskTriggerMatch[0].length - 1];
          if (charBeforeBracket !== '[') {
            const coords = getPos();
            const queryRaw = taskTriggerMatch[0].slice(1 + taskTriggerMatch[1].length);
            setTaskDropdown(prev => ({
              top: coords.top,
              left: coords.left,
              query: queryRaw.trimStart(),
              activeIdx: 0,
            }));
            setWikiDropdown(null);
            return;
          }
        }
        setTaskDropdown(null);

        // Wikilink autocomplete
        const wikiMatch = textBefore.match(/\[\[([^\]]*)$/);
        if (!wikiMatch) { setWikiDropdown(null); return; }
        const query = wikiMatch[1];
        const queryTrimmed = query.trim();
        const queryLow = queryTrimmed.toLowerCase();
        const items = noteTitles
          .filter(n => n.title.toLowerCase().includes(queryLow) && n.title !== title)
          .slice(0, 6);
        const exactMatch = noteTitles.some(n => n.title.toLowerCase() === queryLow);
        const canCreate = queryTrimmed.length > 0 && !exactMatch;
        const coords = getPos();
        setWikiDropdown({ top: coords.top, left: coords.left, query, items, activeIdx: 0, canCreate });
      };
```

- [ ] **Step 2: Commit**

```bash
git add static/index.html
git commit -m "feat: task trigger detection and linkedTaskIds sync in handleEditorChange"
```

---

### Task 7: `insertTasklink(taskId)` dan `openTaskDropdown()`

**Files:**

- Modify: `static/index.html` — setelah `insertWikilink` function (~line 8681)

- [ ] **Step 1: Tambah `insertTasklink` dan `openTaskDropdown` setelah `insertWikilink`**

Cari baris akhir `insertWikilink` (`editor.action(ctx => ctx.get(MB.editorViewCtx).focus());` diikuti `};`), tambahkan setelahnya:

```javascript
      const insertTasklink = (taskId) => {
        setTaskDropdown(null);
        const editor = milkdownEditorRef.current;
        if (!editor) return;
        const MB = window.MilkdownBundle;
        editor.action(ctx => {
          const view = ctx.get(MB.editorViewCtx);
          const { from } = view.state.selection;
          const textBefore = view.state.doc.textBetween(0, from, '\n', '\0');
          const triggerMatch = textBefore.match(/\[(task|tasks|todo|todos|tugas)[a-zA-Z0-9 ]*$/i);
          const replaceFrom = triggerMatch ? from - triggerMatch[0].length : from;
          const nodeType = view.state.schema.nodes.tasklink;
          if (nodeType) {
            view.dispatch(view.state.tr.replaceWith(replaceFrom, from, nodeType.create({ taskId })));
          }
        });
        editor.action(ctx => ctx.get(MB.editorViewCtx).focus());
      };

      const openTaskDropdown = () => {
        const coords = getCursorCoords();
        setTaskDropdown({ top: coords.top, left: coords.left, query: '', activeIdx: 0 });
        const editor = milkdownEditorRef.current;
        if (editor) {
          const MB = window.MilkdownBundle;
          editor.action(ctx => ctx.get(MB.editorViewCtx).focus());
        }
      };
```

- [ ] **Step 2: Commit**

```bash
git add static/index.html
git commit -m "feat: add insertTasklink and openTaskDropdown functions"
```

---

### Task 8: Keydown Handler — Tambah Task Dropdown Navigation

**Files:**

- Modify: `static/index.html` — useEffect keydown (~line 8348–8378)

- [ ] **Step 1: Cari useEffect keydown**

```bash
grep -n "container.addEventListener.*keydown\|tagDropdown, wikiDropdown" static/index.html | head -5
```

- [ ] **Step 2: Update useEffect — tambah `taskDropdown` handling**

Ubah seluruh useEffect (yang berisi `onKeyDown` dan dependency array `[tagDropdown, wikiDropdown]`):

```javascript
      useEffect(() => {
        const container = milkdownEditorRef.current
          ? document.querySelector('.milkdown-editor')
          : null;
        if (!container) return;

        const onKeyDown = (e) => {
          if (tagDropdown) {
            if (e.key === 'Escape') { setTagDropdown(null); return; }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              if (tagDropdown.items[0]) insertTag(tagDropdown.items[0].name);
              return;
            }
          }
          if (taskDropdown) {
            const total = taskDropdownItems.length;
            if (e.key === 'ArrowDown') { e.preventDefault(); setTaskDropdown(d => ({ ...d, activeIdx: Math.min((d.activeIdx || 0) + 1, total - 1) })); return; }
            if (e.key === 'ArrowUp')   { e.preventDefault(); setTaskDropdown(d => ({ ...d, activeIdx: Math.max((d.activeIdx || 0) - 1, 0) })); return; }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              const chosen = taskDropdownItems[(taskDropdown.activeIdx || 0)];
              if (chosen) insertTasklink(chosen.id);
              return;
            }
            if (e.key === 'Escape') { setTaskDropdown(null); return; }
          }
          if (wikiDropdown) {
            const total = wikiDropdown.items.length + (wikiDropdown.canCreate ? 1 : 0);
            if (e.key === 'ArrowDown') { e.preventDefault(); setWikiDropdown(d => ({ ...d, activeIdx: Math.min(d.activeIdx + 1, total - 1) })); return; }
            if (e.key === 'ArrowUp')   { e.preventDefault(); setWikiDropdown(d => ({ ...d, activeIdx: Math.max(d.activeIdx - 1, 0) })); return; }
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              if (wikiDropdown.activeIdx < wikiDropdown.items.length) {
                insertWikilink(wikiDropdown.items[wikiDropdown.activeIdx].title);
              } else if (wikiDropdown.canCreate) {
                createNewNote(wikiDropdown.query.trim());
              }
              return;
            }
            if (e.key === 'Escape') { setWikiDropdown(null); return; }
          }
        };

        container.addEventListener('keydown', onKeyDown, true);
        return () => container.removeEventListener('keydown', onKeyDown, true);
      }, [tagDropdown, taskDropdown, taskDropdownItems, wikiDropdown]);
```

**Note:** Jika `container` di versi aslinya bukan `document.querySelector('.milkdown-editor')` — sesuaikan dengan cara yang ada. Yang penting: `taskDropdown` dan `taskDropdownItems` masuk dependency array.

**Babel TDZ warning:** `taskDropdownItems` harus dideklarasikan (via `const`) SEBELUM useEffect ini di dalam NoteModal. Pastikan urutan deklarasi benar. `taskDropdownItems` sudah dideklarasikan di Task 5 Step 4 (di area derived values, sebelum useEffect).

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "feat: add task dropdown keyboard navigation in keydown handler"
```

---

### Task 9: Task Dropdown UI — Render di dalam NoteModal JSX

**Files:**

- Modify: `static/index.html` — tepat setelah wikilink dropdown UI (~line 8942–8965), di dalam blok `<div style={{ position: "relative", flex: 1, minWidth: 0 }}>` yang membungkus MilkdownEditor

- [ ] **Step 1: Cari anchor wikilink dropdown UI**

```bash
grep -n "wiki-autocomplete\|wikiDropdown &&\|taskDropdown &&" static/index.html | head -10
```

- [ ] **Step 2: Tambah task dropdown setelah penutup wikilink dropdown `</div>)`**

Setelah blok `{wikiDropdown && ( <div ref={wikiDropdownRef} ... > ... </div> )}`, tambahkan:

```jsx
            {/* Task link autocomplete dropdown */}
            {taskDropdown && (
              <div ref={taskDropdownRef} className="wiki-autocomplete"
                style={{ position: "fixed", top: taskDropdown.top, left: taskDropdown.left, zIndex: 1060 }}>
                <input
                  className="input"
                  style={{ width: "100%", padding: "5px 8px", fontSize: 12, marginBottom: 4, borderRadius: 5 }}
                  placeholder="Cari task..."
                  value={taskDropdown.query || ''}
                  onChange={e => setTaskDropdown(d => ({ ...d, query: e.target.value, activeIdx: 0 }))}
                  autoFocus
                  onMouseDown={e => e.stopPropagation()}
                />
                {taskDropdownItems.map((t, i) => (
                  <div key={t.id}
                    className={`wiki-autocomplete-item${i === (taskDropdown.activeIdx || 0) ? " active" : ""}`}
                    onMouseDown={e => { e.preventDefault(); insertTasklink(t.id); }}>
                    <PriBadge p={t.priority} />
                    <span style={{ marginLeft: 4 }}>{t.title}</span>
                  </div>
                ))}
                {taskDropdownItems.length === 0 && (
                  <div className="wiki-autocomplete-item" style={{ color: "var(--text-light)", cursor: "default", fontStyle: "italic" }}>
                    {(taskDropdown.query || '').trim() ? "Task tidak ditemukan" : "Ketik nama task..."}
                  </div>
                )}
              </div>
            )}
```

- [ ] **Step 3: Tambah click-outside handler untuk taskDropdown**

Di area useEffect lainnya (berdekatan dengan `shareRef` click-outside handler), tambahkan:

```javascript
      useEffect(() => {
        if (!taskDropdown) return;
        const close = (e) => {
          if (taskDropdownRef.current && !taskDropdownRef.current.contains(e.target)) setTaskDropdown(null);
        };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
      }, [taskDropdown]);
```

- [ ] **Step 4: Commit**

```bash
git add static/index.html
git commit -m "feat: render task autocomplete dropdown in NoteModal"
```

---

### Task 10: Update `NoteToolbar` — Tambah `onInsertTask` Prop dan Button "+ Task"

**Files:**

- Modify: `static/index.html` — function `NoteToolbar` (~line 7890)

Button menggunakan `onMouseDown` + `e.preventDefault()` agar fokus editor tidak hilang (identik dengan semua button toolbar lainnya).

- [ ] **Step 1: Update function signature NoteToolbar**

Ubah:

```javascript
    function NoteToolbar({ milkdownEditorRef, noteId, onAttachUploaded, content, onApplyTemplate }) {
```

Menjadi:

```javascript
    function NoteToolbar({ milkdownEditorRef, noteId, onAttachUploaded, content, onApplyTemplate, onInsertTask }) {
```

- [ ] **Step 2: Tambah button "+ Task" di toolbar**

Cari baris di return JSX NoteToolbar:

```javascript
          <button onMouseDown={e => { e.preventDefault(); cmd(window.MilkdownBundle.wrapInBlockquoteCommand.key); }} title="Blockquote" style={{ fontSize: 15 }}>❝</button>
          <div className="sep"/>
          {/* More dropdown */}
```

Ubah menjadi:

```javascript
          <button onMouseDown={e => { e.preventDefault(); cmd(window.MilkdownBundle.wrapInBlockquoteCommand.key); }} title="Blockquote" style={{ fontSize: 15 }}>❝</button>
          <div className="sep"/>
          <button
            type="button"
            onMouseDown={e => { e.preventDefault(); onInsertTask?.(); }}
            title="Tambah link task inline"
            style={{ fontSize: 11, fontWeight: 700, color: '#92400e', background: 'rgba(254,249,195,0.6)', border: '1px solid #fde68a', borderRadius: 5, padding: '2px 7px', cursor: 'pointer', height: 28, display: 'inline-flex', alignItems: 'center' }}>
            + Task
          </button>
          <div className="sep"/>
          {/* More dropdown */}
```

- [ ] **Step 3: Commit**

```bash
git add static/index.html
git commit -m "feat: add + Task button to NoteToolbar"
```

---

### Task 11: Wire Up di NoteModal — Update Semua MilkdownEditor Calls + NoteToolbar Call

**Files:**

- Modify: `static/index.html` — dua tempat `<MilkdownEditor` dan satu `<NoteToolbar` di NoteModal

Ada dua instance `MilkdownEditor` di NoteModal: normal view (~line 8929) dan expanded view (~line 9305).
Ada dua instance `NoteToolbar`: normal (~line 8918) dan expanded (~line 9293).

- [ ] **Step 1: Cari semua instance yang perlu diupdate**

```bash
grep -n "<MilkdownEditor\|<NoteToolbar" static/index.html | head -10
```

- [ ] **Step 2: Update `onTasklinkClick` handler — tambah ke NoteModal**

Setelah `openTaskDropdown`, tambahkan:

```javascript
      const handleTasklinkClick = React.useCallback((taskId) => {
        const task = allKnownTasksRef.current.find(t => t.id === taskId);
        if (!task) return;
        onClose();
        setTimeout(() => onTaskClick?.(task), 60);
      }, [onClose, onTaskClick]);
```

- [ ] **Step 3: Update kedua `<MilkdownEditor` calls — tambah props baru**

Untuk setiap `<MilkdownEditor`, tambahkan dua props baru:

```jsx
              tasksGetter={tasksGetterRef.current}
              onTasklinkClick={handleTasklinkClick}
```

Contoh hasil akhir normal view MilkdownEditor:

```jsx
             <MilkdownEditor
              value={content}
              onChange={handleEditorChange}
              minHeight={expanded ? 'calc(100vh - 320px)' : 120}
              editorRef={milkdownEditorRef}
              onWikilinkClick={t => {
                const parsed = parseWikilinkRaw(t);
                const target = noteTitles.find(n => n.title === parsed.title)
                  || (parsed.explicitId && noteTitles.find(n => String(n.id) === parsed.explicitId))
                  || (parsed.numericId && noteTitles.find(n => String(n.id) === parsed.numericId));
                if (target) onNavigate?.(target);
              }}
              tasksGetter={tasksGetterRef.current}
              onTasklinkClick={handleTasklinkClick}
            />
```

- [ ] **Step 4: Update kedua `<NoteToolbar` calls — tambah `onInsertTask` prop**

Untuk setiap `<NoteToolbar`, tambahkan:

```jsx
onInsertTask={openTaskDropdown}
```

- [ ] **Step 5: Commit**

```bash
git add static/index.html
git commit -m "feat: wire tasksGetter, onTasklinkClick, onInsertTask into NoteModal"
```

---

### Task 12: Section "Di-link ke Task" — Make Read-Only, Remove Add/Search UI

**Files:**

- Modify: `static/index.html` — section Di-link ke Task (~line 9116–9177)

Hapus: button "+ Tambah Link Task", search input, create task option.
Pertahankan: label count, daftar task, button "Buka".
Ubah: button ✕ di tiap task DIHAPUS — satu-satunya cara hapus adalah delete badge dari teks.

- [ ] **Step 1: Ganti seluruh blok section Di-link ke Task**

Cari dan ganti blok dari `{/* Link ke Task */}` sampai `</div>` penutupnya (sekitar line 9116–9178):

```jsx
          {/* Link ke Task — read-only, derived dari parsing konten */}
          {linkedTaskIds.length > 0 && (
            <div>
              <div className="note-modal-section-label">Di-link ke Task ({linkedTaskIds.length})</div>
              {linkedTasks.map(t => (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--bg-primary)", borderRadius: 8, padding: "8px 12px", marginBottom: 6 }}>
                  <PriBadge p={t.priority} />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.title}</span>
                  <button
                    onClick={() => { onClose(); setTimeout(() => onTaskClick && onTaskClick(t), 60); }}
                    style={{ background: "none", border: "1px solid var(--border)", borderRadius: 6, fontSize: 11, fontWeight: 600, color: "var(--accent)", cursor: "pointer", padding: "2px 8px", flexShrink: 0 }}>
                    Buka
                  </button>
                </div>
              ))}
              <div style={{ fontSize: 11, color: "var(--text-light)", marginTop: 4, fontStyle: "italic" }}>
                Hapus link: klik badge task di dalam teks note.
              </div>
            </div>
          )}
```

- [ ] **Step 2: Hapus fungsi dan state yang tidak lagi dipakai**

Hapus dari NoteModal:

- function `createAndLinkTask` (seluruhnya — menciptakan task dari section search)
- `const [localNewTasks, setLocalNewTasks] = useState([]);` — tidak ada lagi penambahan via section

Untuk `localNewTasks`: ubah `allKnownTasks` definition:

```javascript
      const allKnownTasks = tasks;
```

(hapus spread `localNewTasks`)

- [ ] **Step 3: Verifikasi tidak ada referensi yang tersisa ke state yang dihapus**

```bash
grep -n "showTaskSearch\|setShowTaskSearch\|taskSearch\|setTaskSearch\|creatingTask\|setCreatingTask\|createAndLinkTask\|localNewTasks\|setLocalNewTasks" static/index.html | grep -v "^\s*//"
```

Expected: tidak ada output (semua sudah dihapus). Jika masih ada, hapus.

- [ ] **Step 4: Commit**

```bash
git add static/index.html
git commit -m "feat: section Di-link ke Task now read-only, derived from note content"
```

---

### Task 13: SW Cache Bump

**Files:**

- Modify: `static/sw.js` — line 1

- [ ] **Step 1: Bump cache version**

Ubah:

```javascript
const CACHE = "taskflow-v85-tpl-group-order";
```

Menjadi:

```javascript
const CACHE = "taskflow-v86-inline-tasklink";
```

- [ ] **Step 2: Commit dan push**

```bash
git add static/sw.js
git commit -m "chore: bump SW cache to v86 for inline tasklink feature"
git push
```

Expected: CI/CD deploy ke VPS via GitHub push, pre-compile JSX berjalan otomatis.

---

## Self-Review

**Spec coverage check:**

| Requirement                               | Task                                                      |
| ----------------------------------------- | --------------------------------------------------------- |
| Trigger `[task`, `[todo`, `[tugas` dll    | Task 6                                                    |
| Toolbar button "+ Task"                   | Task 10                                                   |
| Badge kuning + OPEN/DONE label + priority | Task 3 (toDOM) + Task 1 (CSS)                             |
| OPEN = biru, DONE = hijau                 | Task 3 (toDOM)                                            |
| Klik badge → buka task modal              | Task 4 (click handler) + Task 11 (handleTasklinkClick)    |
| Source of truth = teks                    | Task 6 (setLinkedTaskIds dari content)                    |
| Section read-only, no add button          | Task 12                                                   |
| Auto-sync section ← content               | Task 6 (setLinkedTaskIds) + Task 12 (derived linkedTasks) |
| Serialisasi `[tasklink:ID]`               | Task 3 (toMarkdown runner)                                |
| Parse `[tasklink:ID]` dari markdown       | Task 2 (remarkTasklinkPlugin) + Task 3 (parseMarkdown)    |
| Dropdown search input                     | Task 9                                                    |
| Keyboard nav dropdown                     | Task 8                                                    |
| Scope: private → semua tasks              | Task 5 (pickerTasks)                                      |
| Scope: shared → filter list tasks         | Task 5 (pickerTasks dengan sharedIds)                     |
| Privacy guard: task tidak accessible      | Task 3 (toDOM fallback badge)                             |
| Backward compat DB linked_task_ids        | Task 5 (initTaskIds union)                                |
| SW cache bump                             | Task 13                                                   |
| Dark mode                                 | Task 1                                                    |

**Potential issues:**

1. **`list_id` field** — Task 5 Step 4: verifikasi field name task object. Jika tidak ada, skip scope filtering.
2. **Dua MilkdownEditor instances** — Task 11 Step 3: pastikan KEDUA instance diupdate (normal + expanded).
3. **Babel TDZ** — `taskDropdownItems` harus dideklarasikan sebelum keydown useEffect (Task 8). Urutan di file: derived values (Task 5) → useEffects (Task 8). Ini sudah benar.
4. **`container` di keydown useEffect** — verifikasi cara mendapatkan container DOM element sesuai kode asli.
5. **`conflictBanner` handler** — baris `setLinkedTaskIds(conflictBanner.linked_task_ids || [])` (~line 8899) akan mengoverride content-parsed IDs. Ini acceptable: conflict resolution memang reset state dari server.
