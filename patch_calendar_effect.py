import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('static/index.html', encoding='utf-8') as f:
    h = f.read()

# Insert useEffect for recurring exceptions AFTER holidays useEffect closing
old = '      }, [year]);\n\n      const prevMonth = () => {'
new = ('      }, [year]);\n\n'
       '      React.useEffect(() => {\n'
       '        const recurringTasks = tasks.filter(t => t.recurrence_type && t.recurrence_end_date);\n'
       '        if (recurringTasks.length === 0) { setRecurExceptions({}); return; }\n'
       '        const firstDay = new Date(year, month, 1).toISOString().slice(0,10);\n'
       '        const lastDay = new Date(year, month + 1, 0).toISOString().slice(0,10);\n'
       '        api.get(`/api/recurring/exceptions?from=${firstDay}&to=${lastDay}`)\n'
       '          .then(data => setRecurExceptions(data || {}))\n'
       '          .catch(() => setRecurExceptions({}));\n'
       '      }, [year, month, tasks]);\n\n'
       '      const prevMonth = () => {')

if old in h:
    h = h.replace(old, new, 1)
    print('useEffect added: OK')
else:
    print('ERROR: holidays useEffect closing pattern not found')
    sys.exit(1)

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(h)
print('Done')
