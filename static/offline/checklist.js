;(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory(root);
  } else {
    root.TF = root.TF || {};
    root.TF.checklist = factory(root);
  }
})(typeof self !== "undefined" ? self : globalThis, function (root) {
  "use strict";

  // Checklist bertingkat: logika pohon murni di klien (spec docs/superpowers/specs/2026-11-06-checklist-bertingkat-design.md
  // §5, §6.4, §7.1–§7.3, §9; rencana PR B R1). Tanpa DOM/React; semua traversal iteratif (aman untuk kedalaman
  // berapa pun). Server (`checklist_tree.py`, `repository.move_subtask`) adalah acuan: hasil di sini HARUS sama —
  // dijaga vektor bersama tests/fixtures/checklist_tree_vectors.json + checklist_percent_vectors.json.
  //
  // Butir = bentuk API `{id, task_id, parent_id, depth, title, is_done, sort_order}` (field lain ikut tersalin).
  //
  // - Pohon efektif: saudara urut `(sort_order NULL→0, id)`. Induk yang tidak ada atau di task lain → level atas.
  //   Dalam setiap siklus, anggota dengan `(sort_order, id)` terkecil naik ke level atas. `parent_id` efektif = null
  //   untuk butir depth 0 (sama dengan `GET …/subtasks`), selain itu = `parent_id` tersimpan.
  // - `preorder(items)` → salinan baru pre-order + `depth` + `parent_id` efektif. Masukan tidak diubah.
  // - `topLevelCounts(items)` → `{done, total}` level atas. `childCounts(items, id)` → `{done, total}` anak langsung
  //   (chip lipat). `descendantIds(items, id)` → id turunan pre-order tanpa akar (`[]` bila tidak dikenal).
  // - `visibleRows(items, collapsedSet)` → `[{item, depth, hasChildren, collapsed}]` pre-order; turunan butir
  //   terlipat tidak muncul. `collapsed` hanya true untuk butir yang punya anak. `collapsedSet`: Set / array / null.
  // - Target pindah `{parent_id, index}` (atau null bila tidak mungkin) dengan semantik `index` server: posisi akhir
  //   di antara saudara baru SETELAH butir dikeluarkan dari tempat lamanya.
  //   · `indentTarget` = anak terakhir saudara sebelumnya P → `{P.id, jumlah anak P}`; butir pertama → null.
  //   · `outdentTarget` = tepat di bawah induk Q → `{parent_id efektif Q, posisi Q + 1}`; level atas → null.
  //     Saudara berikutnya tetap di induk lama.
  //   · `siblingMoveTarget(items, id, dir)` (dir −1/+1) = tukar dengan saudara sebelum/sesudah; ujung / dir 0 → null.
  //   Lipatan tidak memengaruhi ketiganya (dihitung dari daftar lengkap).
  // - Seret: `rows` = `visibleRows` TANPA subtree yang diseret; `gap` 0..rows.length = celah sebelum `rows[gap]`.
  //   · `dropRange(rows, gap)` → `{min, max}`: min = `rows[gap].depth` (0 bila tidak ada), max = `rows[gap-1].depth + 1`
  //     (0 bila tidak ada); min > max → min = max. `gap` di-clamp.
  //   · `dropTarget(items, rows, dragId, gap, depth)` → `depth` di-clamp ke `dropRange`; induk = baris terdekat di
  //     atas celah dengan depth == depth−1 (null untuk depth 0); `index` dihitung terhadap SEMUA saudara di `items`
  //     (termasuk anak tersembunyi butir terlipat) = jumlah saudara (tanpa butir yang diseret) sebelum celah dalam
  //     pre-order penuh — jatuh sebagai anak butir terlipat = anak terakhir. null bila posisi sekarang, id tidak
  //     dikenal, atau induk tujuan = butir yang diseret / turunannya.
  // - `applyMove(items, id, parent_id, index)` → daftar baru pre-order (bentuk `preorder`), meniru `move_subtask`:
  //   `index` null/undefined = akhir, desimal dipotong, di-clamp `0..n`; kelompok saudara lama dan baru dinomori
  //   ulang `0..n−1` menurut urutan tampil (kelompok lain tidak disentuh, `sort_order` NULL/kembar tetap); posisi
  //   sama → daftar tidak berubah (= `preorder(items)`); turunan ikut. Tujuan tidak sah (id / induk tidak dikenal,
  //   induk = diri / turunan / task lain, index bukan angka) → null (server akan menolak; jangan kirim).
  // - Kotak tambah bawah: `maxAddDepth(items)` = depth butir terakhir pre-order + 1 (0 bila kosong);
  //   `addParentFor(items, depth)` → id induk = leluhur butir terakhir pada tingkat depth−1 (butir terakhir itu
  //   sendiri bila depth = depth-nya + 1), null untuk 0; `depth` di-clamp ke `0..maxAddDepth`.
  // - `autoScrollDelta(pointerY, rect)`: < 40 px dari `rect.top` → negatif, < 40 px dari `rect.bottom` → positif,
  //   besarnya `max(1, round(16 × (40 − jarak) / 40))` maks 16; 0 selain itu (pola kanbanAutoScrollDelta).
  // - Lipat per perangkat: `loadCollapsed(storage)` → Set id angka (urutan penambahan); `saveCollapsed(storage, ids)`
  //   menyimpan array maks `COLLAPSE_MAX` (yang paling lama ditambahkan dibuang dulu) dan mengembalikan array itu.
  //   Setiap akses `try/catch`; JSON rusak / bukan array / storage null → kosong tanpa galat.
  // - `lockFor(task, counts)`: `counts.loaded && counts.total > 0` → `{done, total, percent}`; hitungan belum dimuat
  //   dan `task.checklist_total > 0` → `{pending: true}`; selain itu null.

  const COLLAPSE_KEY = "tf_check_collapsed";
  const COLLAPSE_MAX = 500;
  const SCROLL_EDGE = 40;
  const SCROLL_MAX = 16;

  function percent(done, total) {
    const t = Number(total) || 0;
    if (!t) return null;
    return Math.floor((Number(done) * 200 + t) / (2 * t));
  }

  // ── pohon efektif ──────────────────────────────────────────────────────────

  const soOf = (it) => Number(it.sort_order) || 0;
  function cmpId(a, b) { return a < b ? -1 : a > b ? 1 : 0; }
  function cmpItem(a, b) { return (soOf(a) - soOf(b)) || cmpId(a.id, b.id); }
  const taskOf = (it) => (it.task_id == null ? null : it.task_id);

  // Induk efektif setiap id (Map id → id|null) — sama dengan checklist_tree.preorder.
  function effectiveParents(list, byId) {
    const parent = new Map();
    for (const it of list) {
      const p = it.parent_id;
      const pr = p != null ? byId.get(p) : undefined;
      parent.set(it.id, pr !== undefined && taskOf(pr) === taskOf(it) ? p : null);
    }
    // Setiap komponen yang tidak sampai ke level atas punya tepat satu siklus; putus pada anggota terkecil.
    const resolved = new Set();
    for (const start of byId.keys()) {
      const path = [];
      const pos = new Map();
      let n = start;
      while (n != null && !resolved.has(n)) {
        if (pos.has(n)) {
          let breaker = n;
          for (let i = pos.get(n) + 1; i < path.length; i++) {
            if (cmpItem(byId.get(path[i]), byId.get(breaker)) < 0) breaker = path[i];
          }
          parent.set(breaker, null);
          break;
        }
        pos.set(n, path.length);
        path.push(n);
        n = parent.get(n);
      }
      for (const x of path) resolved.add(x);
    }
    return parent;
  }

  function preorder(items) {
    const list = Array.isArray(items) ? items.filter((it) => it && typeof it === "object") : [];
    const byId = new Map();
    for (const it of list) byId.set(it.id, it);
    const parent = effectiveParents(list, byId);
    const roots = [];
    const children = new Map();
    for (const it of list) {
      const p = parent.get(it.id);
      if (p == null) roots.push(it);
      else {
        if (!children.has(p)) children.set(p, []);
        children.get(p).push(it);
      }
    }
    roots.sort(cmpItem);
    for (const kids of children.values()) kids.sort(cmpItem);
    const out = [];
    const stack = [];
    for (let i = roots.length - 1; i >= 0; i--) stack.push([roots[i], 0]);
    while (stack.length) {
      const [it, depth] = stack.pop();
      out.push(Object.assign({}, it, { depth, parent_id: depth ? it.parent_id : null }));
      const kids = children.get(it.id);
      if (kids) for (let i = kids.length - 1; i >= 0; i--) stack.push([kids[i], depth + 1]);
    }
    return out;
  }

  // Indeks butir di daftar pre-order; -1 bila tidak ada.
  function indexOfId(flat, id) {
    for (let i = 0; i < flat.length; i++) if (flat[i].id === id) return i;
    return -1;
  }
  // Ujung (eksklusif) subtree flat[i].
  function subtreeEnd(flat, i) {
    let j = i + 1;
    while (j < flat.length && flat[j].depth > flat[i].depth) j++;
    return j;
  }
  // Saudara (urutan tampil) dengan induk efektif `parentId` di daftar pre-order.
  function siblingsIn(flat, parentId) {
    return flat.filter((r) => r.parent_id === parentId);
  }
  function countDone(list) {
    let done = 0;
    for (const r of list) if (r.is_done) done++;
    return { done, total: list.length };
  }

  function topLevelCounts(items) {
    return countDone(preorder(items).filter((r) => r.depth === 0));
  }

  function childCounts(items, id) {
    const flat = preorder(items);
    if (indexOfId(flat, id) < 0) return { done: 0, total: 0 };
    return countDone(siblingsIn(flat, id));
  }

  function descendantIds(items, id) {
    const flat = preorder(items);
    const i = indexOfId(flat, id);
    if (i < 0) return [];
    return flat.slice(i + 1, subtreeEnd(flat, i)).map((r) => r.id);
  }

  function toSet(collapsed) {
    if (collapsed instanceof Set) return collapsed;
    if (collapsed && typeof collapsed.has === "function") return collapsed;
    return new Set(Array.isArray(collapsed) ? collapsed : []);
  }

  function visibleRows(items, collapsedSet) {
    const set = toSet(collapsedSet);
    const flat = preorder(items);
    const rows = [];
    let hideBelow = -1; // depth butir terlipat yang turunannya sedang disembunyikan
    for (let i = 0; i < flat.length; i++) {
      const it = flat[i];
      if (hideBelow >= 0) {
        if (it.depth > hideBelow) continue;
        hideBelow = -1;
      }
      const hasChildren = i + 1 < flat.length && flat[i + 1].depth > it.depth;
      const collapsed = hasChildren && set.has(it.id);
      rows.push({ item: it, depth: it.depth, hasChildren, collapsed });
      if (collapsed) hideBelow = it.depth;
    }
    return rows;
  }

  // ── target pindah (keyboard) ───────────────────────────────────────────────

  // {flat, it, sibs, pos} untuk id; null bila tidak dikenal.
  function locate(items, id) {
    const flat = preorder(items);
    const i = indexOfId(flat, id);
    if (i < 0) return null;
    const it = flat[i];
    const sibs = siblingsIn(flat, it.parent_id);
    return { flat, it, sibs, pos: sibs.findIndex((r) => r.id === id) };
  }

  function indentTarget(items, id) {
    const L = locate(items, id);
    if (!L || L.pos <= 0) return null;
    const prev = L.sibs[L.pos - 1];
    return { parent_id: prev.id, index: siblingsIn(L.flat, prev.id).length };
  }

  function outdentTarget(items, id) {
    const L = locate(items, id);
    if (!L || L.it.parent_id == null) return null;
    const q = L.flat[indexOfId(L.flat, L.it.parent_id)];
    const qPos = siblingsIn(L.flat, q.parent_id).findIndex((r) => r.id === q.id);
    return { parent_id: q.parent_id, index: qPos + 1 };
  }

  function siblingMoveTarget(items, id, dir) {
    const d = Number(dir) > 0 ? 1 : Number(dir) < 0 ? -1 : 0;
    if (!d) return null;
    const L = locate(items, id);
    if (!L) return null;
    const to = L.pos + d;
    if (to < 0 || to >= L.sibs.length) return null;
    return { parent_id: L.it.parent_id, index: to };
  }

  // ── seret ──────────────────────────────────────────────────────────────────

  function clampGap(rows, gap) {
    const n = Array.isArray(rows) ? rows.length : 0;
    const g = Math.trunc(Number(gap)) || 0;
    return Math.max(0, Math.min(g, n));
  }

  function dropRange(rows, gap) {
    const list = Array.isArray(rows) ? rows : [];
    const g = clampGap(list, gap);
    let min = list[g] ? list[g].depth : 0;
    const max = list[g - 1] ? list[g - 1].depth + 1 : 0;
    if (min > max) min = max;
    return { min, max };
  }

  function dropTarget(items, rows, dragId, gap, depth) {
    const list = Array.isArray(rows) ? rows : [];
    const L = locate(items, dragId);
    if (!L) return null;
    const g = clampGap(list, gap);
    const range = dropRange(list, g);
    const want = Math.trunc(Number(depth)) || 0;
    const d = Math.max(range.min, Math.min(want, range.max));

    let parentId = null;
    if (d > 0) {
      for (let i = g - 1; i >= 0; i--) {
        if (list[i].depth === d - 1) { parentId = list[i].item.id; break; }
      }
      if (parentId == null) return null;
    }

    const flat = L.flat;
    const di = indexOfId(flat, dragId);
    const dragged = new Set(flat.slice(di, subtreeEnd(flat, di)).map((r) => r.id));
    if (parentId != null && dragged.has(parentId)) return null;

    // Celah dalam pre-order penuh tanpa subtree yang diseret: sebelum baris tampil pertama (≥ gap) yang bukan
    // bagian subtree itu; tidak ada → akhir.
    const full = flat.filter((r) => !dragged.has(r.id));
    let cut = full.length;
    for (let i = g; i < list.length; i++) {
      const k = indexOfId(full, list[i].item.id);
      if (k >= 0) { cut = k; break; }
    }
    let index = 0;
    for (let i = 0; i < cut; i++) if (full[i].parent_id === parentId) index++;

    if (parentId === L.it.parent_id && index === L.pos) return null;
    return { parent_id: parentId, index };
  }

  // ── pindah lokal (optimistis) ──────────────────────────────────────────────

  function applyMove(items, id, parent_id, index) {
    const L = locate(items, id);
    if (!L) return null;
    const flat = L.flat;
    const target = parent_id == null ? null : parent_id;
    if (target != null) {
      const pi = indexOfId(flat, target);
      if (pi < 0 || taskOf(flat[pi]) !== taskOf(L.it)) return null;
      const di = indexOfId(flat, id);
      if (pi >= di && pi < subtreeEnd(flat, di)) return null; // diri sendiri / turunannya
    }
    let idx = null;
    if (index != null) {
      const n = Number(index);
      if (!Number.isFinite(n)) return null;
      idx = Math.trunc(n);
    }

    const same = target === L.it.parent_id;
    const oldRest = L.sibs.filter((r) => r.id !== id);
    const newRest = same ? oldRest : siblingsIn(flat, target);
    const pos = idx == null ? newRest.length : Math.max(0, Math.min(idx, newRest.length));
    if (same && pos === L.pos) return flat;

    const order = new Map(); // id → sort_order baru
    if (!same) oldRest.forEach((r, i) => order.set(r.id, i));
    const group = newRest.slice();
    group.splice(pos, 0, L.it);
    group.forEach((r, i) => order.set(r.id, i));

    const next = flat.map((r) => {
      const patch = {};
      if (order.has(r.id)) patch.sort_order = order.get(r.id);
      if (r.id === id) patch.parent_id = target;
      return Object.assign({}, r, patch);
    });
    return preorder(next);
  }

  // ── kotak tambah bawah ─────────────────────────────────────────────────────

  function maxAddDepth(items) {
    const flat = preorder(items);
    return flat.length ? flat[flat.length - 1].depth + 1 : 0;
  }

  function addParentFor(items, depth) {
    const flat = preorder(items);
    const max = flat.length ? flat[flat.length - 1].depth + 1 : 0;
    const d = Math.max(0, Math.min(Math.trunc(Number(depth)) || 0, max));
    if (d === 0) return null;
    for (let i = flat.length - 1; i >= 0; i--) if (flat[i].depth === d - 1) return flat[i].id;
    return null;
  }

  // ── auto-scroll ────────────────────────────────────────────────────────────

  function autoScrollDelta(pointerY, rect) {
    const fromTop = pointerY - rect.top;
    const fromBottom = rect.bottom - pointerY;
    const step = (dist) => Math.min(SCROLL_MAX, Math.max(1, Math.round(SCROLL_MAX * (SCROLL_EDGE - dist) / SCROLL_EDGE)));
    if (fromTop < SCROLL_EDGE) return -step(fromTop);
    if (fromBottom < SCROLL_EDGE) return step(fromBottom);
    return 0;
  }

  // ── lipat per perangkat ────────────────────────────────────────────────────

  function idOrNull(x) {
    if (typeof x === "number") return Number.isInteger(x) ? x : null;
    if (typeof x === "string" && /^-?\d+$/.test(x.trim())) return Number(x);
    return null;
  }
  // Id unik (urutan pertama kali muncul), hanya bilangan bulat; maks COLLAPSE_MAX terakhir.
  function cleanIds(list) {
    const seen = new Set();
    for (const x of list) {
      const n = idOrNull(x);
      if (n != null && !seen.has(n)) seen.add(n);
    }
    const arr = Array.from(seen);
    return arr.length > COLLAPSE_MAX ? arr.slice(arr.length - COLLAPSE_MAX) : arr;
  }

  function loadCollapsed(storage) {
    let raw = null;
    try { raw = storage ? storage.getItem(COLLAPSE_KEY) : null; } catch (_) { raw = null; }
    if (typeof raw !== "string" || !raw) return new Set();
    let arr;
    try { arr = JSON.parse(raw); } catch (_) { return new Set(); }
    return Array.isArray(arr) ? new Set(cleanIds(arr)) : new Set();
  }

  function saveCollapsed(storage, ids) {
    let list = [];
    try { list = ids == null ? [] : Array.from(ids); } catch (_) { list = []; }
    const arr = cleanIds(list);
    try { if (storage) storage.setItem(COLLAPSE_KEY, JSON.stringify(arr)); } catch (_) { /* penuh / diblokir */ }
    return arr;
  }

  // ── kunci Progress ─────────────────────────────────────────────────────────

  function lockFor(task, counts) {
    if (counts && counts.loaded) {
      const total = Number(counts.total) || 0;
      if (total > 0) {
        const done = Number(counts.done) || 0;
        return { done, total, percent: percent(done, total) };
      }
      return null;
    }
    if (task && Number(task.checklist_total) > 0) return { pending: true };
    return null;
  }

  return {
    COLLAPSE_KEY, COLLAPSE_MAX,
    percent, preorder, topLevelCounts, childCounts, descendantIds, visibleRows,
    indentTarget, outdentTarget, siblingMoveTarget, dropRange, dropTarget, applyMove,
    maxAddDepth, addParentFor, autoScrollDelta, loadCollapsed, saveCollapsed, lockFor,
  };
});
