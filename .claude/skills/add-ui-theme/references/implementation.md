# Implementation Guide: Add UI Theme

This guide provides the exact steps for registering a new theme in `themes.css` and updating UI toggles.

## Implementation Checklist

### 1. Define Theme Variables in `themes.css`

All themes must reside in the shared static stylesheet. Create a new `[data-theme="theme_name"]` block.

```css
[data-theme="my-new-theme"] {
    --bg: #ffffff;
    --panel: #f5f5f5;
    --panel2: #e0e0e0;
    --border: #cccccc;
    --card-bg: #fafafa;
    --accent: #2563eb;
    --accent2: #1d4ed8;
    --text: #1a1a1a;
    --muted: #6b7280;
}
```

### 2. Extend Global Overrides

If your new theme requires specific component overrides (e.g., hover states, borders for tabs, scrollbars), do so using the `data-theme` attribute selector just below the variable definition.

```css
[data-theme="my-new-theme"] .tab.active,
[data-theme="my-new-theme"] .tab:hover {
    background: var(--accent);
    color: #fff;
    border-color: var(--accent);
}

[data-theme="my-new-theme"] ::-webkit-scrollbar-thumb {
    background: var(--border);
}
```

### 3. Add to the Theme Carousel / Switcher

There are **two** places to register the `<option>` element — both must be updated:

- **`launcher.html`** — the project launcher page preference panel (`<select id="pref-theme-select">`)
- **`analyze_viz.py`** — the embedded HTML template for the visualizer page (same `pref-theme-select`, around line 1394)

Also add i18n keys in **`static/i18n.js`** for both `en` and `zh-tw` sections:
```js
themeOptMyTheme: 'My Theme',   // en section
themeOptMyTheme: '我的主題',   // zh-tw section
```

### 4. Light Theme Extra Work

Light themes (light `--bg`) require additional CSS and JS fixes beyond dark themes, because many elements hardcode dark colors.

#### 4a. Hardcoded dark backgrounds to override in `themes.css`

| Selector | Issue | Fix |
|---|---|---|
| `#cy.l2-view` | `background-color: #050a0f` hardcoded | Override with light warm color + subtle grid |
| `.l2-toolbar` | `background: rgba(9,14,20,0.92)` hardcoded | Override with light semi-transparent bg |
| `#graph-legend`, `#l2-legend` | `background: rgba(5,10,15,0.88/0.92)` hardcoded | Override with light semi-transparent bg |
| `#layout-switcher` | `background: rgba(5,10,15,0.90)` hardcoded | Override with light semi-transparent bg |
| `.tip-body` | `color: #cbd5e1` hardcoded (light gray) | Override with `color: var(--text)` |
| `#node-modal` | `box-shadow: 0 12px 48px rgba(0,0,0,0.8)` | Override with lighter shadow |

#### 4b. Syntax highlighting overrides in `themes.css`

All `.hljs-*` token colors are hardcoded for dark backgrounds. For a light theme, override all of them with dark, high-contrast variants. See the `parchment` block in `themes.css` for reference color values.

Also fix code panel micro-items:
- `.code-line:hover` — change `rgba(255,255,255,.03)` → dark-tinted equivalent
- `.code-line.fn-highlight` — change `rgba(0,212,255,.08)` → accent-tinted
- `#cp-code-wrap .line-content span:hover` — change `outline: 1px solid white` → `var(--text)`

#### 4c. Cytoscape graph nodes (`viz.js`)

Node backgrounds and label colors are set via JS data (`data(bg)` / `'color': '#e2e8f0'`) and are all hardcoded dark.
Add a `CY_THEME_OVERRIDES['my-new-theme']` entry in `viz.js` (near the `CY_THEME_OVERRIDES` constant, line ~648):

```js
CY_THEME_OVERRIDES['my-new-theme'] = [
    { selector: 'node', style: { 'background-color': '#ede8e0', 'color': '#020826' } },
    { selector: 'node:selected', style: { 'border-color': '#8c7851' } },
    { selector: 'edge', style: { 'text-background-color': '#f0ebe3', 'text-background-opacity': 0.92 } },
    { selector: '.hl', style: { 'border-color': '#020826' } },
    { selector: 'node[_t="drill_group"]', style: { 'background-color': '#e8e0d4', 'background-opacity': 0.88 } },
];
```

#### 4d. Node modal inline styles (`viz.js`)

The node details modal uses many `rgba(255,255,255,…)` inline styles that are invisible on light backgrounds.
Use the `_tC(dark, light)` helper (defined near `applyTheme`) to switch colors:

```js
// Instead of hardcoded rgba(255,255,255,…):
color: ${_tC('rgba(255,255,255,0.85)', 'var(--text)')}
background: ${_tC('rgba(255,255,255,0.03)', 'rgba(2,8,38,0.04)')}
color: ${_tC('#e2e8f0', 'var(--text)')}
// Hover/mouseout event listeners:
el.style.background = _tC('rgba(255,255,255,0.08)', 'rgba(2,8,38,0.08)')
```

### 5. Verify Common Mistakes

| Mistake | Fix |
|---|---|
| Hardcoding `color: #ff0000;` on a `.btn` | Use `color: var(--accent);` |
| Forgetting hover states | Ensure `.tab:hover` and `.btn:hover` are mapped to `--accent2` or similar. |
| Missing scrollbar colors | Add `::-webkit-scrollbar-thumb` override for the theme. |
| Forgetting to use `.sr-fuzzy-mark` logic | Verify search result highlights are readable on the new `--bg`. |
| Light theme: floating panels still dark | Add overrides for `.l2-toolbar`, `#graph-legend`, `#l2-legend`, `#layout-switcher`. |
| Light theme: graph nodes still dark | Add entry to `CY_THEME_OVERRIDES` in `viz.js`. |
| Light theme: modal dep items invisible | Use `_tC()` helper for inline `rgba(255,255,255,…)` colors in the modal builder. |
