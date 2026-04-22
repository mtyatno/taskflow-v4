Act as an Expert UI/UX Engineer and Senior Full-Stack Python Developer. Your task is to build the frontend interface and logic for my personal productivity web application, "TaskFlow". 

I have attached the wireframes for the "Dashboard" and the "Notes/Second Brain" pages. Analyze them carefully.

### CORE ARCHITECTURE & CONSTRAINTS (CRITICAL)
1. 100% OFFLINE-FIRST: This app must run entirely offline on a local network. 
2. NO CLOUD SERVICES: Do not suggest or implement Firebase, AWS, or any external online databases. 
3. BACKEND: The backend is handled by Python. Provide frontend code that easily communicates with local Python APIs (e.g., standard fetch requests to localhost).
4. LOCAL ASSETS ONLY: Do not use online CDNs for fonts or icons. Assume all assets are served locally.
5. NO COMPLEX DATABASE CONCURRENCY: Data will be stored simply (e.g., local JSON files or plain local DBs managed by Python). Do not over-engineer the database layer.

### UI/UX & STYLING GUIDELINES
- Theme: Dark Mode natively. Backgrounds are deep dark grey/off-black. Primary accent color is Gold/Yellow. Text is off-white/light grey for readability.
- Framework: Use modern frontend tooling (e.g., HTML/CSS/JS with Tailwind CSS, or React/Vue/Svelte based on your best recommendation for a clean, single-page-app feel).
- Typography: Clean, sans-serif, highly legible. 
- Layout: Fixed left sidebar containing navigation, GTD modules (Inbox, Next Actions, etc.), and Second Brain modules (Notes, Tags, Project). The right side is the dynamic main content area.

### PAGE 1: DASHBOARD (Refer to Dashboard Mockup)
- Global Scratchpad (Omnipresent): A prominent input bar at the top ("⚡ Tulis apa saja..."). 
  - Workflow: It must support "Frictionless Capture". When the user types and presses 'Enter', the text must silently save to the local 'Inbox' or 'Notes' without opening any pop-ups, allowing immediate continued focus.
- Metrics Row: Cards displaying priority task counts (Active, Done 7 Days, Lakukan, Overdue, Inbox).
- Analytics: Two chart placeholders (Productivity Trend line chart and Completion chart).
- Eisenhower Matrix & Recent Notes: Lists showing priority tasks and recently added notes below the charts.

### PAGE 2: NOTES / SECOND BRAIN (Refer to Notes Page Mockup)
- List-Based Layout: A clean, vertical list view of all notes, optimized for rapid visual scanning.
- Search Bar: A dedicated search input at the top. Since data is local, this should be an instant, as-you-type filter function.
- Interaction Logic (Fase Clarify): 
  - Clicking a note item in the list opens the "⚡ Catatan" floating modal/pop-up.
  - The modal contains the note content, Tagging capabilities (e.g., #inspection, #grounding), and a "Simpan" button.
- Bi-directional Linking: The modal must show a section "Di-link ke Task". Implement logic to parse plain text for specific syntax (e.g., `[[Note Name]]` or `@TaskName`) to render clickable links between notes and tasks.

### YOUR FIRST OUTPUT
1. Acknowledge these constraints and briefly explain your proposed tech stack for the frontend (HTML/CSS/JS or Framework) that perfectly aligns with a Python backend.
2. Provide the boilerplate and layout structure (HTML/Tailwind or Components) for the Global Sidebar and the Global Scratchpad input bar. Ensure the dark mode aesthetics match the provided mockups.