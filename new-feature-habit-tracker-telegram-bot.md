Act as an expert Backend Developer and Telegram Bot API Specialist. We are expanding the Telegram Bot for our 'TaskFlow' productivity app to support a new 'Habit Tracker' module.

CRITICAL TECH STACK INFO: I am currently using FastAPI for my backend and python-telegram-bot v21 for my Telegram bot. DO NOT change these core libraries. Write all new callback handlers and logic strictly using python-telegram-bot's async syntax. For the scheduled phase reminders, DO NOT use external schedulers like APScheduler or node-cron; instead, strictly use the built-in JobQueue from python-telegram-bot


The goal for the Habit module is to provide frictionless, dopamine-driven habit check-ins directly via Telegram using scheduled reminders and Inline Keyboards.

Please implement the following bot workflows and backend logic:

### 1. Database & State Sync Context
- Assume we have a `Habit` table and a `HabitLog` table in our database. 
- Actions taken in the Telegram bot must update the database immediately so the Web App UI stays perfectly in sync (and vice-versa).

### 2. Scheduled Phase Reminders (Cron Jobs)
Implement a scheduler (e.g., node-cron) to send push notifications to the user based on their specific daily phases (Timezone: UTC+7 / WIB):
- Morning Phase (05:30): Fetch all habits with `phase === 'pagi'`. Send: "☀️ Selamat pagi! Waktunya memulai mesin." attached with inline keyboards for each morning habit.
- Afternoon Phase (12:00 or 15:00): Fetch all habits with `phase === 'siang'`. Send: "⚡ Jeda sebentar. Waktunya reset." with inline keyboards.
- Night Phase (21:00): Fetch all habits with `phase === 'malam'`. Send: "🌙 Waktunya transisi istirahat." with inline keyboards.

### 3. Inline Keyboard & Callback Logic
When a habit is sent by the bot, it MUST use `InlineKeyboardMarkup`.
- For each habit, provide two inline buttons side-by-side: `[ ✅ Selesai ]` and `[ ⏭️ Skip ]`.
- Include the habit ID and action in the `callback_data` (e.g., `habit_done_123` or `habit_skip_123`).
- **If "✅ Selesai" is clicked:** 1. Insert a log into `HabitLog` with status 'done'.
  2. Answer the callback query.
  3. Edit the original message text to replace the buttons with text like: "✅ [Habit Name] selesai! 🔥 Streak: X Hari."
- **If "⏭️ Skip" is clicked:**
  1. Update the `HabitLog` status to 'skipped' (this maintains the streak without adding to it).
  2. Edit the message to say: "⏭️ [Habit Name] di-skip. Balas pesan ini dengan alasan singkat (opsional)."
  3. Set a temporary state in the bot (e.g., using session or Redis) to listen for the user's next text input to save as the `skipReason`.

### 4. Automated Summaries
- **Daily Wrap-up (Trigger at 21:45):** Send a summary calculating completed vs. pending habits for today. Example: "Pagi: 3/3 | Siang: 1/1 | Malam: 0/1."
- **Weekly Heatmap (Trigger on Sunday at 20:00):** Fetch the last 7 days of logs for each habit. Output a visual string using emojis. Example: "Push-up: 🟩🟩🟥🟩🟩🟩🟩 (85%)".

### 5. Manual Slash Commands
- `/habittoday`: Force triggers the check-in list for today's habits that haven't been completed yet, rendering the Inline Keyboards.
- `/streak`: Queries the database and returns a top-list of the user's longest active habit streaks.

Please provide the necessary routing logic, callback query handlers, and cron job setups. Use the existing language/framework stack of the bot (e.g., Node.js with Telegraf or Python with aiogram). Focus on writing clean, modular code for the callback data parsing.