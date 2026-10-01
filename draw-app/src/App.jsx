import { useEffect, useRef, useMemo } from 'react'
import { Tldraw, exportToBlob, loadSnapshot } from 'tldraw'
import 'tldraw/tldraw.css'

// Self-hosted tldraw assets (offline-first). Di-vendor dari cdn.tldraw.com/2.4.6 ke
// /static/vendor/tldraw/cdn/2.4.6 (di-copy vite dari draw-app/public/ saat build).
// Tanpa assetUrls ini, tldraw mem-fetch ikon/font/translations dari CDN -> canvas
// blank/tanpa toolbar saat offline. Daftar nama mengikuti rilis tldraw 2.4.6;
// saat upgrade tldraw, re-vendor aset + perbarui daftar ini.
const TLD_BASE = '/static/vendor/tldraw/cdn/2.4.6'
const ICONS = ["align-bottom","align-center-horizontal","align-center-vertical","align-left","align-right","align-top","arrow-left","arrowhead-arrow","arrowhead-bar","arrowhead-diamond","arrowhead-dot","arrowhead-none","arrowhead-square","arrowhead-triangle","arrowhead-triangle-inverted","blob","bring-forward","bring-to-front","broken","check","check-circle","chevron-down","chevron-left","chevron-right","chevron-up","chevrons-ne","chevrons-sw","clipboard-copied","clipboard-copy","color","cross-2","cross-circle","dash-dashed","dash-dotted","dash-draw","dash-solid","disconnected","discord","distribute-horizontal","distribute-vertical","dot","dots-horizontal","dots-vertical","drag-handle-dots","duplicate","edit","external-link","fill-fill","fill-none","fill-pattern","fill-semi","fill-solid","follow","following","font-draw","font-mono","font-sans","font-serif","geo-arrow-down","geo-arrow-left","geo-arrow-right","geo-arrow-up","geo-check-box","geo-cloud","geo-diamond","geo-ellipse","geo-heart","geo-hexagon","geo-octagon","geo-oval","geo-pentagon","geo-rectangle","geo-rhombus","geo-rhombus-2","geo-star","geo-trapezoid","geo-triangle","geo-x-box","github","group","horizontal-align-end","horizontal-align-middle","horizontal-align-start","info-circle","leading","link","lock","menu","minus","mixed","pack","plus","question-mark","question-mark-circle","redo","reset-zoom","rotate-ccw","rotate-cw","send-backward","send-to-back","share-1","size-extra-large","size-large","size-medium","size-small","spline-cubic","spline-line","stack-horizontal","stack-vertical","status-offline","stretch-horizontal","stretch-vertical","text-align-center","text-align-left","text-align-right","toggle-off","toggle-on","tool-arrow","tool-eraser","tool-frame","tool-hand","tool-highlight","tool-laser","tool-line","tool-media","tool-note","tool-pencil","tool-pointer","tool-screenshot","tool-text","trash","twitter","undo","ungroup","unlock","vertical-align-end","vertical-align-middle","vertical-align-start","warning-triangle","zoom-in","zoom-out"]
const LOCALES = ["ar","ca","cs","da","de","en","es","fa","fi","fr","gl","he","hi-in","hr","hu","id","it","ja","ko-kr","ku","my","ne","no","pl","pt-br","pt-pt","ro","ru","sl","sv","te","th","tr","uk","vi","zh-cn","zh-tw"]
const EMBEDS = ["codepen","codesandbox","excalidraw","felt","figma","github_gist","google_calendar","google_maps","google_slides","observable","replit","scratch","spotify","tldraw","val_town","vimeo","youtube"]
const fromList = (list, fn) => Object.fromEntries(list.map((k) => [k, fn(k)]))
const assetUrls = {
  fonts: {
    draw: `${TLD_BASE}/fonts/Shantell_Sans-Tldrawish.woff2`,
    serif: `${TLD_BASE}/fonts/IBMPlexSerif-Medium.woff2`,
    sansSerif: `${TLD_BASE}/fonts/IBMPlexSans-Medium.woff2`,
    monospace: `${TLD_BASE}/fonts/IBMPlexMono-Medium.woff2`,
  },
  icons: fromList(ICONS, (n) => `${TLD_BASE}/icons/icon/${n}.svg`),
  translations: fromList(LOCALES, (l) => `${TLD_BASE}/translations/${l}.json`),
  embedIcons: fromList(EMBEDS, (t) => `${TLD_BASE}/embed-icons/${t}.png`),
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function getExportFilename(format) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const ext = format === 'jpeg' ? 'jpg' : format;
  return `drawing_${ts}.${ext}`;
}

async function generateSvgString(editor) {
  try {
    const shapeIds = Array.from(editor.getCurrentPageShapeIds().values());
    if (!shapeIds || shapeIds.length === 0) return '';

    // 1. Try editor.getSvg (DOM element)
    try {
      if (typeof editor.getSvg === 'function') {
        const svgEl = await editor.getSvg(shapeIds, { scale: 1, background: true });
        if (svgEl) {
          return new XMLSerializer().serializeToString(svgEl);
        }
      }
    } catch (_) {}

    // 2. Try editor.getSvgString
    try {
      if (typeof editor.getSvgString === 'function') {
        const res = await editor.getSvgString(shapeIds, { scale: 1, background: true });
        if (res?.svg) return res.svg;
      }
    } catch (_) {}

    // 3. Try exportToBlob
    try {
      const blob = await exportToBlob({ editor, ids: shapeIds, format: 'svg', opts: { scale: 1, background: true } });
      if (blob) {
        const text = await blob.text();
        if (text && text.includes('<svg')) return text;
      }
    } catch (_) {}
  } catch (err) {
    console.error('generateSvgString error:', err);
  }
  return '';
}

async function doExport(editor, shapeIds, format, helpers) {
  try {
    let ids = shapeIds;
    if (!ids || ids.length === 0) {
      ids = editor.getSelectedShapeIds();
    }
    if (!ids || ids.length === 0) {
      ids = Array.from(editor.getCurrentPageShapeIds().values());
    }
    if (!ids || ids.length === 0) {
      if (helpers?.addToast) {
        helpers.addToast({
          title: 'Kanvas kosong',
          description: 'Tidak ada objek atau gambar di kanvas untuk diekspor.',
          severity: 'info',
        });
      }
      return;
    }

    const background = editor.getInstanceState().exportBackground ?? true;
    const blob = await exportToBlob({
      editor,
      ids,
      format,
      opts: {
        scale: format === 'png' ? 2 : 1,
        background,
      },
    });

    if (!blob) {
      throw new Error('Gagal membuat file export.');
    }

    const mimeType = format === 'json' ? 'application/json' : format === 'svg' ? 'image/svg+xml' : 'image/png';
    const typedBlob = blob.type ? blob : new Blob([blob], { type: mimeType });
    const filename = getExportFilename(format);

    downloadBlob(typedBlob, filename);

    if (helpers?.addToast) {
      helpers.addToast({
        title: 'Export Berhasil',
        description: `${filename} berhasil didownload.`,
        severity: 'success',
      });
    }
  } catch (err) {
    console.error('Export error:', err);
    if (helpers?.addToast) {
      helpers.addToast({
        title: 'Export Gagal',
        description: err?.message || 'Terjadi kesalahan saat mengekspor gambar.',
        severity: 'error',
      });
    }
  }
}

export default function App() {
  const noteId = new URLSearchParams(window.location.search).get('noteId') || 'default'
  const editorRef = useRef(null)
  const loadedRef = useRef(false)         // load pertama dari parent sudah diterapkan → baru boleh mengedit & mengirim
  const lastSnapshotStrRef = useRef("")   // snapshot terakhir yang dikirim/dimuat (deteksi gema)
  const recentSentRef = useRef([])        // beberapa snapshot terakhir yang dikirim iframe ini
  const userRevRef = useRef(0)            // naik setiap ada perubahan dokumen oleh user
  const sentRevRef = useRef(0)            // userRev yang sudah terkirim ke parent
  const syncSeqRef = useRef(0)            // nomor urut snapshot yang diambil
  const postedSeqRef = useRef(0)          // nomor urut snapshot terakhir yang terkirim
  const debounceTimerRef = useRef(null)

  const uiOverrides = useMemo(() => ({
    actions(editor, actions, defaultHelpers) {
      return {
        ...actions,
        'export-as-svg': {
          ...actions['export-as-svg'],
          onSelect() {
            doExport(editor, editor.getSelectedShapeIds(), 'svg', defaultHelpers);
          },
        },
        'export-as-png': {
          ...actions['export-as-png'],
          onSelect() {
            doExport(editor, editor.getSelectedShapeIds(), 'png', defaultHelpers);
          },
        },
        'export-as-json': {
          ...actions['export-as-json'],
          onSelect() {
            doExport(editor, editor.getSelectedShapeIds(), 'json', defaultHelpers);
          },
        },
        'export-all-as-svg': {
          ...actions['export-all-as-svg'],
          onSelect() {
            doExport(editor, Array.from(editor.getCurrentPageShapeIds().values()), 'svg', defaultHelpers);
          },
        },
        'export-all-as-png': {
          ...actions['export-all-as-png'],
          onSelect() {
            doExport(editor, Array.from(editor.getCurrentPageShapeIds().values()), 'png', defaultHelpers);
          },
        },
        'export-all-as-json': {
          ...actions['export-all-as-json'],
          onSelect() {
            doExport(editor, Array.from(editor.getCurrentPageShapeIds().values()), 'json', defaultHelpers);
          },
        },
      };
    },
  }), []);

  // Data gambar dari parent sudah diterapkan (atau gambar baru yang memang kosong) → kanvas boleh diedit.
  const markLoaded = () => {
    if (loadedRef.current) return
    loadedRef.current = true
    const editor = editorRef.current
    if (editor) editor.updateInstanceState({ isReadonly: false })
  }

  const rememberSent = (snapshot) => {
    lastSnapshotStrRef.current = snapshot
    const arr = recentSentRef.current
    if (arr[arr.length - 1] !== snapshot) arr.push(snapshot)
    if (arr.length > 3) arr.shift()
  }

  // Kirim snapshot + svg ke parent. reqId (opsional) = balasan requestSnapshot (parent menunggu sebelum menutup).
  const syncToParent = async (reqId) => {
    if (!editorRef.current || !loadedRef.current) return;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    try {
      const editor = editorRef.current;
      const rev = userRevRef.current;
      const seq = ++syncSeqRef.current;
      const snapshot = JSON.stringify(editor.store.getStoreSnapshot());
      rememberSent(snapshot);
      const svg = await generateSvgString(editor);
      if (seq < postedSeqRef.current) {
        // snapshot yang lebih baru sudah terkirim lebih dulu (svg async selesai terbalik) → jangan kirim yang basi
        if (reqId) window.parent.postMessage({ type: 'change', noteId, data: null, reqId }, '*');
        return;
      }
      postedSeqRef.current = seq;
      const msg = { type: 'change', noteId, data: snapshot, svg };
      if (reqId) msg.reqId = reqId;
      window.parent.postMessage(msg, '*');
      if (rev > sentRevRef.current) sentRevRef.current = rev;
    } catch (err) {
      console.error('syncToParent error:', err);
    }
  };

  useEffect(() => {
    // Beritahu parent bahwa iframe siap
    window.parent.postMessage({ type: 'ready', noteId }, '*')

    const handler = (e) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'load' && editorRef.current) {
        try {
          const editor = editorRef.current;
          const legacyParent = e.data.v == null; // parent versi lama (belum mengirim flag empty)
          const incomingRaw = e.data.data;
          const incomingStr = incomingRaw == null ? '' : (typeof incomingRaw === 'string' ? incomingRaw : JSON.stringify(incomingRaw));
          let snapshot = null;
          try { snapshot = incomingStr ? (typeof incomingRaw === 'string' ? JSON.parse(incomingRaw) : incomingRaw) : null; } catch (_) { snapshot = null; }
          const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
          const hasStore = isObj(snapshot) && (isObj(snapshot.store) || (isObj(snapshot.document) && isObj(snapshot.document.store)));
          const isEmptyObject = isObj(snapshot) && Object.keys(snapshot).length === 0;
          if (hasStore) {
            // Gema: snapshot yang baru saja dikirim iframe ini sendiri → abaikan (jangan timpa coretan yang lebih baru)
            const isEcho = incomingStr === lastSnapshotStrRef.current || recentSentRef.current.includes(incomingStr);
            if (!isEcho) {
              // Muat sebagai perubahan REMOTE: tidak memicu listener source 'user' (tidak dikirim balik) dan
              // tanpa jendela buta — coretan user sesaat setelah load tetap terekam & tersimpan.
              editor.store.mergeRemoteChanges(() => {
                loadSnapshot(editor.store, snapshot);
              });
              lastSnapshotStrRef.current = incomingStr;
            }
            markLoaded();
            // svg preview di parent basi (mis. tersimpan lewat flush pagehide tanpa svg) → kirim snapshot+svg segar sekali
            if (e.data.svgStale) setTimeout(() => syncToParent(), 50);
          } else if (e.data.empty === true || (legacyParent && isEmptyObject)) {
            // Gambar baru/kosong: kanvas kosong siap diedit (kanvas yang sudah dimuat tidak dikosongkan)
            markLoaded();
          }
          // Selain itu snapshot tidak dikenal/rusak → tetap read-only: jangan pernah menimpa data yang tak terbaca.
        } catch (err) {
          console.error('load snapshot error:', err);
        }
      }
      if (e.data?.type === 'loadError') {
        // Parent gagal memuat data gambar → tetap read-only; tidak ada yang dikirim sehingga data tidak tertimpa.
        console.warn('load gambar gagal — kanvas read-only');
      }
      // requestSnapshot: balas dengan data HANYA bila sudah loaded & ada perubahan user yang belum terkirim;
      // selain itu data null (tutup sebelum data tiba / tanpa edit tidak boleh menimpa gambar).
      if (e.data?.type === 'requestSnapshot') {
        if (editorRef.current && loadedRef.current && userRevRef.current !== sentRevRef.current) syncToParent(e.data.reqId);
        else window.parent.postMessage({ type: 'change', noteId, data: null, reqId: e.data.reqId }, '*');
      }
      if (e.data?.type === 'export' && editorRef.current) {
        doExport(editorRef.current, null, e.data.format || 'png', null);
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [noteId])

  useEffect(() => {
    // Iframe dibongkar (tab Draw ditutup / pindah halaman / modal ditutup) sebelum debounce 600ms jalan:
    // kirim snapshot terakhir secara SINKRON tanpa svg (svg async tidak sempat) → parent menandai svg_stale.
    const onPageHide = () => {
      const editor = editorRef.current;
      if (editor && loadedRef.current && userRevRef.current !== sentRevRef.current) {
        try {
          if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
          }
          const snapshot = JSON.stringify(editor.store.getStoreSnapshot());
          window.parent.postMessage({ type: 'change', noteId, data: snapshot }, '*');
          postedSeqRef.current = ++syncSeqRef.current;
          sentRevRef.current = userRevRef.current;
          rememberSent(snapshot);
        } catch (_) {}
      }
    }
    // Aplikasi masuk background (HP) → kirim perubahan tertunda sekarang, jangan tunggu debounce
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && loadedRef.current && userRevRef.current !== sentRevRef.current) syncToParent();
    }
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [noteId])

  const handleMount = (editor) => {
    editorRef.current = editor
    // Read-only sampai 'load' pertama dari parent diterapkan: menutup sebelum data tiba tidak boleh
    // menimpa gambar dengan kanvas kosong.
    if (!loadedRef.current) editor.updateInstanceState({ isReadonly: true })
    window.parent.postMessage({ type: 'ready', noteId }, '*')

    // Hanya perubahan dokumen oleh USER yang dikirim ke parent; snapshot yang dimuat dari parent
    // (mergeRemoteChanges → source 'remote') tidak memicu listener ini.
    editor.store.listen(() => {
      if (!loadedRef.current) return;
      userRevRef.current++;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => syncToParent(), 600);
    }, { source: 'user', scope: 'document' })
  }

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw
        assetUrls={assetUrls}
        onMount={handleMount}
        overrides={uiOverrides}
      />
    </div>
  )
}
