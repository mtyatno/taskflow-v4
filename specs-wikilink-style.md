# Specs: Wikilink Styling Enhancement

## Goal
All `[[wikilink]]` references throughout the application must render with:
- Colored font (accent color, `--accent: #A8C500`)
- Dashed underline (`border-bottom: 1.5px dashed var(--accent)`)
- Consistent appearance in both light and dark themes

## Scope

### 1. Editor mode (`.wikilink-node`) — Milkdown ProseMirror
- Add `border-bottom: 1.5px dashed var(--accent)` to always-visible styling
- Remove hardcoded `rgba()` fallback, keep `color-mix()` only
- Remove `text-decoration: underline` on hover (already prevented by Milkdown-specific rule at line 983)
- Update hover to enhance background opacity, preserve dashed border
- Add dark theme override for background color using CSS custom properties

### 2. Dashboard preview card — "Notes Terbaru" section
- Currently: `dangerouslySetInnerHTML={{ __html: n.content.slice(0,200) }}` shows raw `[[text]]`
- Fix: Run through lightweight wikilink-to-span converter via `renderWikilinksPreview()` before rendering

### 3. Note list card preview — Scratchpad sidebar
- Currently: `dangerouslySetInnerHTML={{ __html: n.content.slice(0, 200) }}` shows raw `[[text]]`
- Fix: Same approach — use `renderWikilinksPreview()`

### 4. Dark theme
- Add `[data-theme="dark"]` overrides for `.wikilink-node` and `.wikilink` classes
- Adjust `--accent` translucency for better contrast on dark backgrounds
- Fix `.wikilink-broken` color to use a visible gray (`#9ca3af`) in dark mode (was inherited `--text-light: #737373`, too dim)

### 5. Read mode (`.wikilink`) — Already correct, verify only
- CSS at line 808-809 already has colored font + dashed underline
- No changes needed to base rules

## Affected Files
- `static/index.html` — Single file containing all CSS styling and JS logic
- `specs-wikilink-style.md` — This file
- `plans-wikilink-style.md` — Implementation plan with code
