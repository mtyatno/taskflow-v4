untuk feature notes :
Act as a Senior Python Developer. 
I need the Python backend logic to handle Bi-directional Linking (Backlinking) using the [[Note Title]] syntax.

Please write the following Python functions:
1. A function using the `re` module that takes a raw text string, parses it, and extracts all substrings enclosed in `[[ ]]`. It should return a clean list of these note titles.
2. A mock function demonstrating how to update a note's record. It should take the current note's data and the extracted list of linked titles, find the matching Note IDs from a simple local data structure (e.g., a dictionary/list of dicts), and save them under a key called `linked_to`.
3. A function to retrieve "Linked Mentions" (Backlinks): Given a target Note ID, scan the local data structure and return a list of all notes that contain this target Note ID in their `linked_to` list.

Keep the code clean, well-commented, and optimized for simple local processing without complex locking mechanisms.



Act as an Expert UI/UX Engineer. I have a 100% offline-first local productivity web app.  I need vanilla JavaScript logic to handle the frontend experience of Bi-directional Linking (like Obsidian or Roam).

Please provide the JS code and necessary CSS (or Tailwind classes) for two features:

FEATURE 1: The Autocomplete Dropdown (Phase Capture)
- I have a textarea for writing notes.
- Write a JS event listener that detects when a user types `[[`.
- When detected, it should trigger a function (simulate a fetch call returning an array of mock note titles).
- Render a small, elegantly styled dropdown positioned near the text cursor (caret).
- If the user selects a title from the dropdown, replace the `[[` with `[[Selected Title]]` in the textarea and close the dropdown.

FEATURE 2: Visual Rendering (Phase Clarify/Read)
- Write a JS function that takes a plain text string from the database (e.g., "Review the [[Server Config]] today.") and parses it.
- Replace the `[[Server Config]]` syntax with a clickable HTML element (e.g., `<span class="text-yellow-400 cursor-pointer hover:underline">Server Config</span>`).
- Provide the basic HTML structure to append a "Disebutkan di:" (Linked Mentions) section at the bottom of the note container.

Ensure the interactions are frictionless and the styling perfectly matches a premium dark mode aesthetic.