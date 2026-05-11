---
name: adjust-css
description: Adjust CSS styles in the VIZCODE frontend. Use this skill whenever the user wants to change colors, spacing, fonts, borders, backgrounds, shadows, border-radius, opacity, or any visual appearance of nodes/panels/UI elements. Trigger on requests like "change color", "adjust spacing", "border too thick", "background color", "font size", "pill too tall", "section color", "border radius", etc.
---

# SKILL: Adjust CSS — VIZCODE Frontend

## File Map

| What to change | Which file |
|----------------|------------|
| Global color scheme, background, panel, border | `static/viz.css` (`:root` CSS variables) |
| Themes (dark/light/solarized) | `static/themes.css` |
| Symbol View SVG node appearance (background/border/effects) | `static/symbol_view/symbol_view.css` |
| Symbol View layout spacing/size constants | `static/symbol_view/sv_graph.js` (top-level `_SV_*` constants) |
| Symbol View color mapping definitions | `static/symbol_view/sv_core.js` (`_SV_KIND_COLOR`, `_SV_EDGE_COLOR`) |
| Main view (L0/L1/L2) graph node colors and shapes | `static/viz_state.js` or `static/viz.js` (`extColor()`, `FILE_TYPE_SHAPE`) |

## CSS Variable Reference (viz.css :root)

```css
--bg          /* Bottom-most background */
--panel       /* Panel / section background */
--panel2      /* Card / node background */
--border      /* All border colors */
--text        /* Primary text */
--muted       /* Secondary text (section headers, etc.) */
--accent      /* Highlight color (selected / active) */
--code-font   /* Code font */
```

## Symbol View (V3) SVG Styles (symbol_view.css)

Symbol View now uses pure SVG rendering (no Cytoscape dependency). All appearance is defined in `static/symbol_view/symbol_view.css`:

- **Node base**: `.sv-node .sv-node-bg` (fill/stroke)
- **Type border colors**: `.sv-kind-class .sv-node-bg`, `.sv-kind-method .sv-node-bg`, etc.
- **Methods**: `.sv-node.sv-method-public .sv-node-bg`, `.sv-node.sv-method-private .sv-node-bg`
- **Focus/expanded nodes**: `.sv-node.sv-focus-pill`, `.sv-node.sv-focus .sv-node-bg`
- **Labels and text**: `.sv-node-name`, `.sv-node-kind`, `.sv-access`, `.sv-pill-name`
- **Edges**: `.sv-edge`, `.sv-edge-hit`, `.sv-edge:hover`
- **Focus detail card (HTML in SVG)**: `.sv-fd-card`, `.sv-fd-header`, `.sv-fd-section`, etc.

## Symbol View Layout Constants (top of sv_graph.js)

To adjust node size, spacing, and layout distances, modify the constants at the top of `static/symbol_view/sv_graph.js`:

```js
const _SV_CLASS_PAD_X   = 16;   // Class card horizontal padding
const _SV_CLASS_PAD_TOP = 46;   // Class card top padding (title area)
const _SV_METHOD_H      = 34;   // Method node height
const _SV_PILL_H        = 30;   // Focus pill height
const _SV_FUNC_H        = 42;   // Top-level function height
// ... other _SV_* size variables
```

## Workflow

1. **Read the target file** — Use the File Map above to locate the relevant `.css` or `.js` file.
2. **Locate and modify** — Find the corresponding class name or `_SV_` constant.
3. **Finish and verify** — After editing, ask the user to press **Ctrl+Shift+R** or do a hard refresh in the browser to see the changes.

## Notes

- **No Cytoscape Style**: Symbol View has fully moved away from Cytoscape. There is no longer a `_symBuildCyStyle()`. All styles should be edited directly in CSS or SVG attributes.
- **No layout_editor.html**: This preview tool no longer exists. All changes must be verified by refreshing the project page directly.
- When adjusting SVG dimensions, make sure the `_SV_*` constants in `sv_graph.js` stay consistent with the font/margin settings in `symbol_view.css` (e.g., increasing font size without increasing `_SV_METHOD_H` will cause text clipping).