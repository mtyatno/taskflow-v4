import { useEffect, useRef, useMemo } from 'react'
import { Tldraw, exportToBlob } from 'tldraw'
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
  const isRemoteLoadingRef = useRef(false)
  const lastSnapshotStrRef = useRef("")
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

  const syncToParent = async () => {
    if (!editorRef.current) return;
    try {
      const editor = editorRef.current;
      const snapshot = JSON.stringify(editor.store.getSnapshot());
      lastSnapshotStrRef.current = snapshot;
      const svg = await generateSvgString(editor);
      window.parent.postMessage({ type: 'change', noteId, data: snapshot, svg }, '*');
    } catch (err) {
      console.error('syncToParent error:', err);
    }
  };

  useEffect(() => {
    // Beritahu parent bahwa iframe siap
    window.parent.postMessage({ type: 'ready', noteId }, '*')

    const handler = (e) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'load' && editorRef.current && e.data.data) {
        try {
          const incomingRaw = e.data.data;
          const incomingStr = typeof incomingRaw === 'string' ? incomingRaw : JSON.stringify(incomingRaw);
          if (incomingStr === lastSnapshotStrRef.current) return;
          isRemoteLoadingRef.current = true;
          if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
          }
          const snapshot = typeof incomingRaw === 'string' ? JSON.parse(incomingRaw) : incomingRaw;
          editorRef.current.store.loadSnapshot(snapshot);
          lastSnapshotStrRef.current = incomingStr;
          setTimeout(() => {
            isRemoteLoadingRef.current = false;
          }, 800);
        } catch (_) {
          isRemoteLoadingRef.current = false;
        }
      }
      if (e.data?.type === 'requestSnapshot' && editorRef.current) {
        syncToParent();
      }
      if (e.data?.type === 'export' && editorRef.current) {
        doExport(editorRef.current, null, e.data.format || 'png', null);
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [noteId])

  const handleMount = (editor) => {
    editorRef.current = editor
    window.parent.postMessage({ type: 'ready', noteId }, '*')

    editor.store.listen(() => {
      if (isRemoteLoadingRef.current) return;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(syncToParent, 600);
    }, { scope: 'document' })
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
