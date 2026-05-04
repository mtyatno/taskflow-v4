import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('static/index.html', encoding='utf-8') as f:
    h = f.read()

# Add virtual instances after tasksWithDeadline.forEach block
old = ('      tasksWithDeadline.forEach(t => {\n'
       '        const { d } = parseDeadline(t.deadline);\n'
       '        if (!byDay[d]) byDay[d] = [];\n'
       '        byDay[d].push(t);\n'
       '      });\n\n'
       '      const firstDay = new Date(year, month, 1).getDay();')

new = ('      tasksWithDeadline.forEach(t => {\n'
       '        const { d } = parseDeadline(t.deadline);\n'
       '        if (!byDay[d]) byDay[d] = [];\n'
       '        byDay[d].push(t);\n'
       '      });\n\n'
       '      // Add virtual recurring instances\n'
       '      const recurringTasksInMonth = tasks.filter(t => t.recurrence_type && t.recurrence_end_date);\n'
       '      const firstDayStr = year + \'-\' + String(month+1).padStart(2,\'0\') + \'-01\';\n'
       '      const lastDayStr = new Date(year, month+1, 0).toISOString().slice(0,10);\n'
       '      recurringTasksInMonth.forEach(t => {\n'
       '        const occurrences = computeOccurrences(t, firstDayStr, lastDayStr);\n'
       '        const exceptions = recurExceptions[String(t.id)] || [];\n'
       '        const exMap = {};\n'
       '        exceptions.forEach(e => { exMap[e.occurrence_date] = e.status; });\n'
       '        occurrences.forEach(dateStr => {\n'
       '          const d = parseInt(dateStr.slice(8,10));\n'
       '          if (!byDay[d]) byDay[d] = [];\n'
       '          const existing = byDay[d].find(x => x.id === t.id && x._isRecurring);\n'
       '          if (!existing) {\n'
       '            byDay[d].push({ ...t, _isRecurring: true, _occurrenceDate: dateStr, _occurrenceStatus: exMap[dateStr] || null });\n'
       '          }\n'
       '        });\n'
       '      });\n\n'
       '      const firstDay = new Date(year, month, 1).getDay();')

if old in h:
    h = h.replace(old, new, 1)
    print('byDay virtual instances added: OK')
else:
    print('ERROR: byDay block pattern not found')
    sys.exit(1)

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(h)
print('Done')
