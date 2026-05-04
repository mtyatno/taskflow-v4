import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('static/index.html', encoding='utf-8') as f:
    h = f.read()

# --- Patch 1: chip render - add unique key, onClick, and recurring badge ---
old_chip = (
    'dayTasks.slice(0, 2).map(t => {\n'
    '                            const c = chipColor(t);\n'
    '                            return (\n'
    '                              <div key={t.id}\n'
    '                                style={{ fontSize: 10, lineHeight: 1.3, padding: "1px 4px", borderRadius: 3, marginBottom: 2,\n'
    '                                  background: c.bg, color: c.color, fontWeight: 500,\n'
    '                                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",\n'
    '                                  textDecoration: t.gtd_status === "done" ? "line-through" : "none" }}\n'
    '                                title={t.title}>{t.title}</div>\n'
    '                            );\n'
    '                          })'
)

new_chip = (
    'dayTasks.slice(0, 2).map(t => {\n'
    '                            const c = chipColor(t);\n'
    '                            const chipKey = t._isRecurring ? (t.id + \'_\' + t._occurrenceDate) : t.id;\n'
    '                            const isDoneOcc = t._occurrenceStatus === \'done\';\n'
    '                            return (\n'
    '                              <div key={chipKey}\n'
    '                                onClick={t._isRecurring ? (e => { e.stopPropagation(); setRecurPopup({ task: t, date: t._occurrenceDate }); }) : undefined}\n'
    '                                style={{ fontSize: 10, lineHeight: 1.3, padding: "1px 4px", borderRadius: 3, marginBottom: 2,\n'
    '                                  background: c.bg, color: c.color, fontWeight: 500,\n'
    '                                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",\n'
    '                                  textDecoration: (t.gtd_status === "done" || isDoneOcc) ? "line-through" : "none",\n'
    '                                  cursor: t._isRecurring ? "pointer" : "default",\n'
    '                                  opacity: isDoneOcc ? 0.6 : 1 }}\n'
    '                                title={t.title}>{t._isRecurring ? "🔁 " : ""}{t.title}</div>\n'
    '                            );\n'
    '                          })'
)

if old_chip in h:
    h = h.replace(old_chip, new_chip, 1)
    print('Chip render patched: OK')
else:
    print('ERROR: chip render pattern not found')
    sys.exit(1)

# --- Patch 2: Add recurPopup modal before closing of CalendarView ---
# Find the closing pattern of CalendarView return
old_end = (
    '          )}\n'
    '        </div>\n'
    '      );\n'
    '    }\n\n'
    '    // ── Dashboard ───'
)

new_end = (
    '          )}\n'
    '        </div>\n'
    '        {recurPopup && (\n'
    '          <div style={{ position: "fixed", inset: 0, zIndex: 200 }} onClick={() => setRecurPopup(null)}>\n'
    '            <div onClick={e => e.stopPropagation()} style={{\n'
    '              position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",\n'
    '              background: "var(--bg-card)", border: "1px solid var(--border)", borderRadius: 14,\n'
    '              padding: 20, minWidth: 260, boxShadow: "0 8px 32px rgba(0,0,0,0.18)", zIndex: 201\n'
    '            }}>\n'
    '              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>🔁 {recurPopup.task.title}</div>\n'
    '              <div style={{ fontSize: 13, color: "var(--text-light)", marginBottom: 14 }}>\n'
    '                {new Date(recurPopup.date + \'T00:00:00\').toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}\n'
    '              </div>\n'
    '              {recurPopup.task._occurrenceStatus === \'done\' ? (\n'
    '                <div style={{ color: "#16a34a", fontWeight: 600, fontSize: 13 }}>✓ Sudah selesai</div>\n'
    '              ) : (\n'
    '                <div style={{ display: "flex", gap: 8 }}>\n'
    '                  <button onClick={async () => {\n'
    '                    await api.post(\'/api/tasks/\' + recurPopup.task.id + \'/occurrences/\' + recurPopup.date + \'/mark\', { status: "done" });\n'
    '                    setRecurPopup(null);\n'
    '                    const fl = year + \'-\' + String(month+1).padStart(2,\'0\') + \'-01\';\n'
    '                    const ll = new Date(year, month+1, 0).toISOString().slice(0,10);\n'
    '                    api.get(\'/api/recurring/exceptions?from=\' + fl + \'&to=\' + ll).then(d => setRecurExceptions(d || {})).catch(()=>{});\n'
    '                  }} style={{ padding: "6px 14px", borderRadius: 8, background: "var(--accent)", color: "#000", border: "none", fontWeight: 700, cursor: "pointer", fontSize: 13 }}>\n'
    '                    ✓ Selesai\n'
    '                  </button>\n'
    '                  <button onClick={async () => {\n'
    '                    await api.post(\'/api/tasks/\' + recurPopup.task.id + \'/occurrences/\' + recurPopup.date + \'/mark\', { status: "skipped" });\n'
    '                    setRecurPopup(null);\n'
    '                    const fl = year + \'-\' + String(month+1).padStart(2,\'0\') + \'-01\';\n'
    '                    const ll = new Date(year, month+1, 0).toISOString().slice(0,10);\n'
    '                    api.get(\'/api/recurring/exceptions?from=\' + fl + \'&to=\' + ll).then(d => setRecurExceptions(d || {})).catch(()=>{});\n'
    '                  }} style={{ padding: "6px 14px", borderRadius: 8, background: "var(--bg-primary)", color: "var(--text-secondary)", border: "1px solid var(--border)", cursor: "pointer", fontSize: 13 }}>\n'
    '                    — Lewati\n'
    '                  </button>\n'
    '                  <button onClick={() => { setRecurPopup(null); onTaskClick && onTaskClick(recurPopup.task); }}\n'
    '                    style={{ padding: "6px 14px", borderRadius: 8, background: "var(--bg-primary)", color: "var(--text-secondary)", border: "1px solid var(--border)", cursor: "pointer", fontSize: 13 }}>\n'
    '                    Lihat Task\n'
    '                  </button>\n'
    '                </div>\n'
    '              )}\n'
    '            </div>\n'
    '          </div>\n'
    '        )}\n'
    '      );\n'
    '    }\n\n'
    '    // ── Dashboard ───'
)

if old_end in h:
    h = h.replace(old_end, new_end, 1)
    print('Popup modal added: OK')
else:
    print('ERROR: CalendarView closing pattern not found')
    sys.exit(1)

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(h)
print('Done')
