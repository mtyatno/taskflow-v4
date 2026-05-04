import io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

with open('static/index.html', encoding='utf-8') as f:
    h = f.read()

old = ('const [form, setForm] = useState({\n'
       '        title: task?.title || "",\n'
       '        description: task?.description || "",\n'
       '        priority: task?.priority || "P3",\n'
       '        gtd_status: task?.gtd_status || "inbox",\n'
       '        project: task?.project || "",\n'
       '        context: task?.context || "",\n'
       '        deadline: task?.deadline || "",\n'
       '        waiting_for: task?.waiting_for || "",\n'
       '        list_id: task?.list_id || null,\n'
       '        assigned_to: task?.assigned_to || null,\n'
       '        progress: task?.progress || 0,\n'
       '      });')

new = (old + '\n'
       '      const [recurringOn, setRecurringOn] = React.useState(!!(task && task.recurrence_type));\n'
       '      const [recurForm, setRecurForm] = React.useState({\n'
       '        type: (task && task.recurrence_type) || "daily",\n'
       '        days: (task && task.recurrence_days) ? JSON.parse(task.recurrence_days) : [0,2,4],\n'
       '        dayOfMonth: (task && task.recurrence_days) ? JSON.parse(task.recurrence_days)[0] : 1,\n'
       '      });\n'
       '      const setRecur = (k, v) => setRecurForm(f => ({ ...f, [k]: v }));\n'
       '      const isRecurExpired = !!(task && task.recurrence_end_date && task.recurrence_end_date < new Date().toISOString().slice(0,10));')

if old in h:
    h = h.replace(old, new, 1)
    print('Recurrence state: OK')
else:
    print('ERROR: form state pattern not found')
    sys.exit(1)

with open('static/index.html', 'w', encoding='utf-8') as f:
    f.write(h)
print('Done')
