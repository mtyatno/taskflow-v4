import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('static/index.html', encoding='utf-8') as f:
    h = f.read()

# Patch the task mode save: replace api.put and api.post calls with recurrencePayload merged
old = ('        // ── Task mode ─────────────────────────────────────────────\n'
       '        try {\n'
       '          if (isEdit) {\n'
       '            await api.put(`/api/tasks/${task.id}`, form);\n'
       '            onSave();\n'
       '          } else {\n'
       '            const newTask = await api.post("/api/tasks", form);\n')

new = ('        // ── Task mode ─────────────────────────────────────────────\n'
       '        const recurrencePayload = recurringOn ? {\n'
       '          recurrence_type: recurForm.type,\n'
       '          recurrence_days: recurForm.type === "weekly" ? JSON.stringify(recurForm.days) :\n'
       '                           recurForm.type === "monthly" ? JSON.stringify([recurForm.dayOfMonth]) : null,\n'
       '        } : { recurrence_type: null, recurrence_days: null };\n'
       '        try {\n'
       '          if (isEdit) {\n'
       '            await api.put(`/api/tasks/${task.id}`, { ...form, ...recurrencePayload });\n'
       '            onSave();\n'
       '          } else {\n'
       '            const newTask = await api.post("/api/tasks", { ...form, ...recurrencePayload });\n')

if old in h:
    h = h.replace(old, new, 1)
    print('Recurrence save payload: OK')
else:
    print('ERROR: task mode save pattern not found')
    # Debug: show what we have
    idx = h.find('// ── Task mode')
    if idx != -1:
        print('Found Task mode at:', idx)
        print(repr(h[idx:idx+300]))
    sys.exit(1)

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(h)
print('Done')
