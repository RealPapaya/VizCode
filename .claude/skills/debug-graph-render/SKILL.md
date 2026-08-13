---
name: debug-graph-render
description: Debug and fix rendering issues in the Cytoscape-based graph visualizer (static/viz.ts + static/features/graph/*). Use this skill whenever there are visual bugs in the dependency graph — including node positioning, edge rendering, color/shape incorrect, click events not working, zoom/pan broken, label truncation, or any canvas-related bugs in launcher.html / viz.ts / graph_*.ts. For Galaxy-view bugs use the galaxy-workflow skill instead.
---

# SKILL: Debug Graph Render Issues

Debugging the Cytoscape visualizer that powers the L0/L1/L2 main views. The frontend is a single-file SPA with no build step — changes to anything under `static/` take effect immediately on browser refresh (Ctrl+Shift+R).

## Architecture Quick Reference

```
static/launcher.html              — Entry SPA, loads static assets, shows progress bar
static/viz.ts                     — Bootstrap, top-level wiring, modal builders
static/features/graph/graph_*.ts  — Core layout, L1, L2, interact, style, multiselect
static/ui/viz_*.ts                — Sidebar, toolbar, code panel, layout, preferences
static/core/                      — viz_constants (colors/shapes), viz_state, viz_utils, viz_nav_history, i18n
static/styles/*.css               — Visual styles (split by area; see adjust-css skill)
```

Data flow: `src/server/server.py /result` → `build_html()` in `src/core/html_builder.py` → JSON embedded in HTML → `viz.ts` + `graph_*.ts` parse and render via Cytoscape.

## Diagnostic Checklist

Before changing any code, run through these checks:

### 1. Console errors
Open DevTools → Console. Look for:
- `TypeError` / `ReferenceError` → JavaScript syntax/logic bug
- `400/500` from fetch calls → backend issue, check `src/server/server.py`
- Cytoscape warnings about NaN positions → data has `null` nodes or circular refs

### 2. Identify which layer is broken

| Symptom | Likely Layer | File |
|---------|-------------|------|
| Nodes at (0,0) or overlapping | Layout engine | `static/features/graph/graph_core.ts` (Cytoscape layout opts) |
| Wrong color/shape | Styling | `static/styles/*.css` or `extColor()` / `FILE_TYPE_SHAPE` in `static/core/viz_constants.ts` |
| Click/hover does nothing | Event handler | `static/features/graph/graph_interact.ts` |
| Edges missing or wrong direction | Edge resolution | `src/core/analyze_viz.py` `add_edge()` |
| Graph blank but no error | Data empty | Check `/result` response JSON structure |
| Zoom broken | Cytoscape zoom | `static/features/graph/graph_core.ts` cy options |

### 3. Inspect the data
In browser console:
```javascript
// After graph loads, the cytoscape instance and data are usually stored in globals:
window.cy           // active Cytoscape instance
window._graphData   // raw JSON from /result
// Grep static/viz.ts or static/features/graph/graph_core.ts to confirm exact names.
```

## Common Fixes

### Nodes stuck at origin (0, 0)
The Cytoscape layout may not have run, or positions came back as `NaN`:
```javascript
// Force a re-layout in the console:
cy.layout({ name: 'dagre' }).run()
```
Check `static/features/graph/graph_core.ts` for layout option blocks.

### Edge not appearing
1. Check if `add_edge()` in `src/core/analyze_viz.py` created the edge in the JSON
2. Check if the frontend filters it out (look for `edge_type` filter logic in `static/features/graph/graph_interact.ts` and `static/ui/viz_sidebar.ts`)
3. Check if both source/target node IDs exist in the nodes array

### Node color wrong
Colors are assigned in two places:
- `extColor(ext)` in `static/core/viz_constants.ts` — maps file extension → color hex
- `module_color` dict in `src/core/analyze_viz.py` → passed as `color` field per module

CSS rules in `static/styles/*.css` and Cytoscape `style()` blocks in `static/features/graph/graph_style.ts` can override the inline `data(bg)` if specificity is higher.

### Click event not firing
Cytoscape event binding uses `cy.on('tap', 'node', handler)`. Common issues:
- Another element is intercepting the click (check `z-index` / `pointer-events` in CSS)
- The handler was bound before the cy instance existed (look in `static/features/graph/graph_interact.ts`)
- The node has `pointer-events: none` via a CSS class

### Labels truncated or overlapping
Look for a `MAX_LABEL_LEN` constant in `static/core/viz_constants.ts` or layout-spacing knobs in `static/features/graph/graph_core.ts`.

## Testing After Fix

1. Open `http://localhost:7777`
2. Analyze the `tests/fixtures/testproject/` directory — it's small, multilingual, and exercises all node types
3. Verify in browser DevTools → Network that `/result` returns valid JSON
4. Check Console for errors

## File Modification Rules

- **`static/viz.ts` + `static/features/graph/graph_*.ts`**: All Cytoscape rendering / interaction logic lives here. No backend changes needed for pure visual bugs.
- **`static/styles/*.css`**: Only for static appearance. Don't put layout logic here.
- **`src/core/analyze_viz.py`**: Only if the data in the JSON is wrong (wrong edges, missing nodes). This means the bug is in graph construction, not rendering.
- **`src/server/server.py`**: Only if the API response is malformed or the wrong data is being sent.
