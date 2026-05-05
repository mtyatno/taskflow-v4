import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('static/index.html', encoding='utf-8') as f:
    h = f.read()

errors = []

# ═══════════════════════════════════════════════════════════════════
# PATCH 1: NotePanel drawing handler
# ═══════════════════════════════════════════════════════════════════

old_panel = (
    "        if (note?.id) {\n"
    "          api.get(`/api/drawings/${note.id}`)\n"
    "            .then(data => setDrawPendingData(data.data_json))\n"
    "            .catch(() => {});\n"
    "        }\n"
    "\n"
    "        const handler = (e) => {\n"
    "          if (e.origin !== window.location.origin) return;\n"
    "          if (e.data?.type === 'ready') setDrawIframeReady(true);\n"
    "          if (e.data?.type === 'change' && e.data.data && note?.id) {\n"
    "            if (!navigator.onLine) { setDrawSyncStatus('offline'); return; }\n"
    "            setDrawSyncStatus('saving');\n"
    "            api.put(`/api/drawings/${note.id}`, { data_json: e.data.data })\n"
    "              .then(() => setDrawSyncStatus('saved'))\n"
    "              .catch(() => setDrawSyncStatus('offline'));\n"
    "          }\n"
    "        };\n"
    "        window.addEventListener('message', handler);\n"
    "\n"
    "        const onlineHandler = () => {\n"
    "          if (drawIframeRef.current && note?.id)\n"
    "            drawIframeRef.current.contentWindow.postMessage({ type: 'requestSnapshot' }, '*');\n"
    "        };\n"
    "        window.addEventListener('online', onlineHandler);"
)

new_panel = (
    "        if (note?.id) {\n"
    "          const _lsKey = 'draw_pending_' + note.id;\n"
    "          api.get(`/api/drawings/${note.id}`)\n"
    "            .then(data => {\n"
    "              const local = localStorage.getItem(_lsKey);\n"
    "              setDrawPendingData(local || data.data_json);\n"
    "              if (local) setDrawSyncStatus('offline');\n"
    "            })\n"
    "            .catch(() => {\n"
    "              const local = localStorage.getItem(_lsKey);\n"
    "              if (local) { setDrawPendingData(local); setDrawSyncStatus('offline'); }\n"
    "            });\n"
    "        }\n"
    "\n"
    "        const handler = (e) => {\n"
    "          if (e.origin !== window.location.origin) return;\n"
    "          if (e.data?.type === 'ready') setDrawIframeReady(true);\n"
    "          if (e.data?.type === 'change' && e.data.data && note?.id) {\n"
    "            try { localStorage.setItem('draw_pending_' + note.id, e.data.data); } catch(_) {}\n"
    "            if (!navigator.onLine) { setDrawSyncStatus('offline'); return; }\n"
    "            setDrawSyncStatus('saving');\n"
    "            api.put(`/api/drawings/${note.id}`, { data_json: e.data.data })\n"
    "              .then(() => {\n"
    "                setDrawSyncStatus('saved');\n"
    "                try { localStorage.removeItem('draw_pending_' + note.id); } catch(_) {}\n"
    "              })\n"
    "              .catch(() => setDrawSyncStatus('offline'));\n"
    "          }\n"
    "        };\n"
    "        window.addEventListener('message', handler);\n"
    "\n"
    "        const onlineHandler = () => {\n"
    "          if (!note?.id) return;\n"
    "          const local = localStorage.getItem('draw_pending_' + note.id);\n"
    "          if (local) {\n"
    "            api.put(`/api/drawings/${note.id}`, { data_json: local })\n"
    "              .then(() => {\n"
    "                setDrawSyncStatus('saved');\n"
    "                try { localStorage.removeItem('draw_pending_' + note.id); } catch(_) {}\n"
    "              })\n"
    "              .catch(() => setDrawSyncStatus('offline'));\n"
    "          } else if (drawIframeRef.current) {\n"
    "            drawIframeRef.current.contentWindow.postMessage({ type: 'requestSnapshot' }, '*');\n"
    "          }\n"
    "        };\n"
    "        window.addEventListener('online', onlineHandler);"
)

if old_panel in h:
    h = h.replace(old_panel, new_panel, 1)
    print('Patch 1 (NotePanel drawing): OK')
else:
    errors.append('Patch 1 FAILED — NotePanel drawing handler not found')

# ═══════════════════════════════════════════════════════════════════
# PATCH 2: NoteModal drawing handler
# ═══════════════════════════════════════════════════════════════════

old_modal = (
    "        api.get(`/api/drawings/${note.id}`)\n"
    "          .then(data => setPendingDrawData(data.data_json))\n"
    "          .catch(() => {});\n"
    "\n"
    "        const handler = (e) => {\n"
    "          if (e.origin !== window.location.origin) return;\n"
    "          if (e.data?.type === 'ready') {\n"
    "            setIframeReady(true);\n"
    "          }\n"
    "          if (e.data?.type === 'change' && e.data.data) {\n"
    "            if (!navigator.onLine) {\n"
    "              setSyncStatus('offline');\n"
    "              return;\n"
    "            }\n"
    "            setSyncStatus('saving');\n"
    "            api.put(`/api/drawings/${note.id}`, { data_json: e.data.data })\n"
    "              .then(() => setSyncStatus('saved'))\n"
    "              .catch(() => setSyncStatus('offline'));\n"
    "          }\n"
    "        };\n"
    "        window.addEventListener('message', handler);\n"
    "\n"
    "        const onlineHandler = () => {\n"
    "          if (iframeRef.current) {\n"
    "            iframeRef.current.contentWindow.postMessage({ type: 'requestSnapshot' }, '*');\n"
    "          }\n"
    "        };\n"
    "        window.addEventListener('online', onlineHandler);"
)

new_modal = (
    "        const _lsKeyModal = 'draw_pending_' + note.id;\n"
    "        api.get(`/api/drawings/${note.id}`)\n"
    "          .then(data => {\n"
    "            const local = localStorage.getItem(_lsKeyModal);\n"
    "            setPendingDrawData(local || data.data_json);\n"
    "            if (local) setSyncStatus('offline');\n"
    "          })\n"
    "          .catch(() => {\n"
    "            const local = localStorage.getItem(_lsKeyModal);\n"
    "            if (local) { setPendingDrawData(local); setSyncStatus('offline'); }\n"
    "          });\n"
    "\n"
    "        const handler = (e) => {\n"
    "          if (e.origin !== window.location.origin) return;\n"
    "          if (e.data?.type === 'ready') {\n"
    "            setIframeReady(true);\n"
    "          }\n"
    "          if (e.data?.type === 'change' && e.data.data) {\n"
    "            try { localStorage.setItem(_lsKeyModal, e.data.data); } catch(_) {}\n"
    "            if (!navigator.onLine) {\n"
    "              setSyncStatus('offline');\n"
    "              return;\n"
    "            }\n"
    "            setSyncStatus('saving');\n"
    "            api.put(`/api/drawings/${note.id}`, { data_json: e.data.data })\n"
    "              .then(() => {\n"
    "                setSyncStatus('saved');\n"
    "                try { localStorage.removeItem(_lsKeyModal); } catch(_) {}\n"
    "              })\n"
    "              .catch(() => setSyncStatus('offline'));\n"
    "          }\n"
    "        };\n"
    "        window.addEventListener('message', handler);\n"
    "\n"
    "        const onlineHandler = () => {\n"
    "          const local = localStorage.getItem(_lsKeyModal);\n"
    "          if (local && note.id) {\n"
    "            api.put(`/api/drawings/${note.id}`, { data_json: local })\n"
    "              .then(() => {\n"
    "                setSyncStatus('saved');\n"
    "                try { localStorage.removeItem(_lsKeyModal); } catch(_) {}\n"
    "              })\n"
    "              .catch(() => setSyncStatus('offline'));\n"
    "          } else if (iframeRef.current) {\n"
    "            iframeRef.current.contentWindow.postMessage({ type: 'requestSnapshot' }, '*');\n"
    "          }\n"
    "        };\n"
    "        window.addEventListener('online', onlineHandler);"
)

if old_modal in h:
    h = h.replace(old_modal, new_modal, 1)
    print('Patch 2 (NoteModal drawing): OK')
else:
    errors.append('Patch 2 FAILED — NoteModal drawing handler not found')

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(h)

# Verify
with open('static/index.html', encoding='utf-8') as f:
    v = f.read()

print()
print('=== Verification ===')
print('localStorage.setItem draw_pending (NotePanel):', v.count("localStorage.setItem('draw_pending_' + note.id") >= 1)
print('localStorage.setItem draw_pending (NoteModal):', v.count('localStorage.setItem(_lsKeyModal') >= 1)
print('onlineHandler syncs from localStorage:', v.count("localStorage.getItem('draw_pending_' + note.id)") >= 1)
print('onlineHandler syncs modal from localStorage:', v.count('localStorage.getItem(_lsKeyModal)') >= 1)
print('Load prioritizes local pending (panel):', "local || data.data_json" in v)
print('Load prioritizes local pending (modal):', v.count("local || data.data_json") >= 2)

print()
if errors:
    for e in errors:
        print('ERROR:', e)
else:
    print('All patches OK')
