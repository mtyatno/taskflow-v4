# Plans: Wikilink Styling Enhancement

## Overview
Three areas need changes in `static/index.html`:
1. **CSS** — `.wikilink-node` dashed underline, hover fix, dark theme overrides
2. **JS helper** — `renderWikilinksPreview()` for card previews
3. **JS integration** — Replace raw `.content.slice()` in Dashboard + Note list cards

---

## Change 1: CSS — Editor `.wikilink-node` dashed underline + dark theme

### 1a. Update `.wikilink-node` base style (replace lines 910-920)

**Old:**
```css
    .wikilink-node {
      color: var(--accent);
      background: rgba(168, 197, 0, 0.12);
      background: color-mix(in srgb, var(--accent) 10%, transparent);
      border-radius: 4px;
      padding: 0 3px;
      cursor: pointer;
      text-decoration: none;
      font-size: 0.95em;
      user-select: all;
    }
```

**New:**
```css
    .wikilink-node {
      color: var(--accent);
      background: color-mix(in srgb, var(--accent) 12%, transparent);
      border-radius: 4px;
      padding: 0 3px;
      cursor: pointer;
      text-decoration: none;
      border-bottom: 1.5px dashed var(--accent);
      font-size: 0.95em;
      user-select: all;
    }
```

Key changes:
- Removed hardcoded `rgba(168, 197, 0, 0.12)` fallback, kept only `color-mix()` (modern browsers)
- Added `border-bottom: 1.5px dashed var(--accent)` — the core fix
- Bumped opacity from 10% to 12% for slightly better visibility

### 1b. Update `.wikilink-node:hover` (replace lines 921-925)

**Old:**
```css
    .wikilink-node:hover {
      background: rgba(168, 197, 0, 0.22);
      background: color-mix(in srgb, var(--accent) 20%, transparent);
      text-decoration: underline;
    }
```

**New:**
```css
    .wikilink-node:hover {
      background: color-mix(in srgb, var(--accent) 22%, transparent);
      border-bottom-color: var(--accent-hover);
      opacity: 0.85;
    }
```

Key changes:
- Removed hardcoded fallback
- Removed `text-decoration: underline` (was solid underline, we use dashed border instead)
- Changed to `border-bottom-color: var(--accent-hover)` — subtle color shift on hover
- Bumped `opacity: 0.85` to maintain readability instead of changing geometry

### 1c. Add dark theme overrides (insert after line 988, before `</style>`)

**Insert:**
```css
    /* Dark mode — wikilink editor node */
    [data-theme="dark"] .wikilink-node {
      background: color-mix(in srgb, var(--accent) 18%, transparent);
    }
    [data-theme="dark"] .wikilink-node:hover {
      background: color-mix(in srgb, var(--accent) 28%, transparent);
    }
    /* Dark mode — wikilink read view */
    [data-theme="dark"] .wikilink {
      border-bottom-color: var(--accent);
    }
    [data-theme="dark"] .wikilink:hover {
      opacity: 0.8;
    }
    /* Dark mode — wikilink-broken (unresolved) */
    [data-theme="dark"] .wikilink-broken {
      color: #9ca3af;
      border-bottom-color: #9ca3af;
    }
```

Key changes:
- Dark mode `.wikilink-node` background: 18% accent vs 12% light — higher opacity compensates for dark bg
- Dark mode `.wikilink-node:hover`: 28% accent vs 22% light
- `.wikilink` preserves accent color in dark mode (already working, just explicit)
- `.wikilink-broken`: Uses `#9ca3af` instead of `--text-light (#737373)` for better visibility on dark bg

---

## Change 2: JS — `renderWikilinksPreview()` helper function

### 2a. Add function (insert before `renderMarkdown()`, around line 7325)

```javascript
    function renderWikilinksPreview(text, maxLen) {
      if (!text) return "";
      let html = escapeHtml(text);
      // Replace [[title]] and [[title|label]] with styled spans
      html = html.replace(/\[{2,}([^\[\]]+)\]{2,}/g, (match) => {
        const inner = match.replace(/^\[{2,}|\\]{2,}$/g, '');
        const parsed = parseWikilinkRaw(inner);
        const labelEsc = escapeHtml(parsed.label);
        const titleEsc = escapeHtml(parsed.title);
        return `<span class="wikilink" data-wiki-title="${escapeAttr(parsed.title)}">${labelEsc}</span>`;
      });
      // Truncate to maxLen without breaking HTML tags
      if (html.length <= maxLen) return html;
      let truncated = '';
      let inTag = false;
      let count = 0;
      for (let i = 0; i < html.length && count < maxLen; i++) {
        const ch = html[i];
        truncated += ch;
        if (ch === '<') inTag = true;
        else if (ch === '>') inTag = false;
        else if (!inTag) count++;
      }
      // Close any open tags
      if (inTag) {
        const lastLt = truncated.lastIndexOf('<');
        truncated = truncated.slice(0, lastLt);
      }
      // Close unclosed span tags
      const openSpans = (truncated.match(/<span[^>]*>/g) || []).length;
      const closeSpans = (truncated.match(/<\/span>/g) || []).length;
      for (let i = closeSpans; i < openSpans; i++) {
        truncated += '</span>';
      }
      return truncated + '...';
    }
```

Key behaviors:
- HTML-escapes content first (XSS safe)
- Finds `[[...]]` patterns and wraps them in `<span class="wikilink">`
- Uses existing `parseWikilinkRaw()` for label extraction
- Truncates to `maxLen` characters while preserving HTML structure
- Closes unclosed `<span>` tags after truncation

### 2b. Update Dashboard preview card (line ~6584)

**Old:**
```jsx
{n.title && <div className="note-card-preview" dangerouslySetInnerHTML={{ __html: n.content.slice(0,200) }} />}
```

**New:**
```jsx
{n.title && <div className="note-card-preview" dangerouslySetInnerHTML={{ __html: renderWikilinksPreview(n.content, 200) }} />}
```

### 2c. Update Note list card preview (line ~9508)

**Old:**
```jsx
{n.title && <div className="note-card-preview" dangerouslySetInnerHTML={{ __html: n.content.slice(0, 200) }} />}
```

**New:**
```jsx
{n.title && <div className="note-card-preview" dangerouslySetInnerHTML={{ __html: renderWikilinksPreview(n.content, 200) }} />}
```

---

## Verification Checklist

- [ ] Editor wikilinks show colored font + dashed underline in **light theme**
- [ ] Editor wikilinks show colored font + dashed underline in **dark theme**
- [ ] Editor wikilinks hover changes background and border color
- [ ] Dashboard "Notes Terbaru" preview renders wikilinks as styled spans
- [ ] Note list card previews render wikilinks as styled spans
- [ ] Preview truncation doesn't break HTML (no unclosed tags)
- [ ] `.wikilink-broken` has visible styling in dark mode
- [ ] Read mode wikilinks still work correctly (no regression)
- [ ] No console errors
