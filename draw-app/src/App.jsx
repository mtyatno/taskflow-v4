import { useEffect, useRef } from 'react'
import { Tldraw } from 'tldraw'
import 'tldraw/tldraw.css'

export default function App() {
  const noteId = new URLSearchParams(window.location.search).get('noteId') || 'default'
  const editorRef = useRef(null)

  useEffect(() => {
    // Beritahu parent bahwa iframe siap
    window.parent.postMessage({ type: 'ready' }, '*')

    const handler = (e) => {
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
    })
  }

  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <Tldraw
        persistenceKey={`tldraw-note-${noteId}`}
        onMount={handleMount}
      />
    </div>
  )
}
