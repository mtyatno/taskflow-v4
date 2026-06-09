import { useEffect, useRef } from 'react'
import { Tldraw } from 'tldraw'
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

export default function App() {
  const noteId = new URLSearchParams(window.location.search).get('noteId') || 'default'
  const editorRef = useRef(null)

  useEffect(() => {
    // Beritahu parent bahwa iframe siap
    window.parent.postMessage({ type: 'ready' }, '*')

    const handler = (e) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'load' && editorRef.current && e.data.data) {
        try {
          const snapshot = JSON.parse(e.data.data)
          editorRef.current.store.loadSnapshot(snapshot)
        } catch (_) {}
      }
      if (e.data?.type === 'requestSnapshot' && editorRef.current) {
        const snapshot = JSON.stringify(editorRef.current.store.getSnapshot())
        window.parent.postMessage({ type: 'change', data: snapshot }, '*')
      }
    }
    window.addEventListener('message', handler)
    return () => window.removeEventListener('message', handler)
  }, [])

  const handleMount = (editor) => {
    editorRef.current = editor

    let debounceTimer
    editor.store.listen(() => {
      clearTimeout(debounceTimer)
      debounceTimer = setTimeout(() => {
        const snapshot = JSON.stringify(editor.store.getSnapshot())
        window.parent.postMessage({ type: 'change', data: snapshot }, '*')
      }, 1000)
    }, { scope: 'document' })
  }

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw
        assetUrls={assetUrls}
        persistenceKey={`tldraw-note-${noteId}`}
        onMount={handleMount}
      />
    </div>
  )
}
