# VIZCODE Architecture Reference

> This file is reference documentation — not loaded into Claude's context automatically.
> Read it only when working on a specific subsystem.

## Frontend Files (`static/`)

| File | Role |
|------|------|
| `viz.js` | **Boot file** (~330 lines). `DOMContentLoaded` init, global tooltip, keyboard, context menu. Loads last among viz modules. |
| `viz_utils.js` | Shared utility functions: `escapeHtml`, `showToast`, `fmtSize`, `T()`, etc. Loads first. |
| `viz_state.js` | Mutable runtime state: `state`, `l2State`, `codeState`, `cy`, `buildFileIdLookup()`. |
| `viz_constants.js` | Immutable constants: `FILE_TYPE_SHAPE`, `EDGE_TYPE_STYLE`, `extColor()`, `L2_LEGEND_ITEMS`. |
| `viz_preferences.js` | User preferences, theme, font, language: `_PREFS`, `initPreferences()`. |
| `viz_code_panel.js` | Code panel: init, open/close, file loading, renderers (code/image/PDF/hex). |
| `viz_office.js` | Office file viewer: xlsx (spreadsheet), docx (paragraphs), pptx (slides), legacy download. |
| `viz_toolbar.js` | L1/L2 toolbar, navigation history, node modal, external group toggles. |
| `viz_sidebar.js` | Sidebar tabs, file tree, FT filter, edge filter, node legend, stats. |
| `viz_graph.js` | Cytoscape core: `initCy`, `CY_STYLE`, highlight, all level navigation (L0/L1/L2). |
| `viz_search.js` | Full search system: streaming, fuzzy, virtual scroll, `initSearch`, `onSearch`. |
| `viz_dashboard.js` | Analytics dashboard overlay (Chart.js). |
| `viz_galaxy.js` | **Galaxy View.** Full-codebase Sigma.js WebGL graph (modules + files + functions). Dagre layout, highlight, tooltip, double-click navigation. |
| `viz_layout.js` | Layout presets, switcher UI, zoom controls. |
| `viz.css` | Main stylesheet (~3000 lines). |
| `i18n.js` | Chinese/English translation table. Loads before all viz modules. |
| `symbol_view.js` | CodeViz-style Symbol-Centric Graph. Loads after viz.js. |
| `symbol_view.css` | Symbol View styles. |
| `themes.css` | Theme styles. |
| `launcher.html` | SPA shell. Server injects `DATA` JSON and all scripts inline. |

## Load Order

`i18n.js` → `viz_utils.js` → `viz_state.js` → `viz_constants.js` → `viz_preferences.js` → `viz_code_panel.js` → `viz_office.js` → `viz_toolbar.js` → `viz_sidebar.js` → `viz_graph.js` → `viz_search.js` → `viz_dashboard.js` → `viz_galaxy.js` → `viz_layout.js` → `viz.js` → `trail_layouter.js` → `symbol_view.js`

Managed by `analyze_viz.py` `build_html()`.

## Navigation Levels (state machine)

- **L0** — Module overview (Cytoscape, `state.level = 0`)
- **L1** — File dependency graph (`state.level = 1`, `state.activeModule`) — Cytoscape
- **L2** — Function call-flow (`state.level = 2`, `state.activeFile`, `l2State`)
- **sv-view** — Structure View overlay; shown over L1/L2, hides `#cy`
- **Galaxy** — Full-codebase graph overlay (`#galaxy-overlay`); Sigma.js WebGL, independent of L0/L1/L2

## Key Global State

```js
window.DATA            // Full graph payload injected by server into HTML
  .funcs_by_file       // { "rel/path.py": [ { label, is_public, is_efiapi }, ... ] }
  .func_edges_by_file  // { "rel/path.py": [ { s: callerIdx, t: calleeIdx }, ... ] }
  .files_by_module     // { modId: [ { id, path, label, ext, file_type, func_count }, ... ] }
  .symbol_index        // { "sym_0": { id, name, kind, file, line, parent, children, ... } }
  .symbol_edges        // [ { from, to, type }, ... ]  types: call|inheritance|type_usage|import

state          // { level, activeModule, activeFile, ... }
l2State        // { activeFile, activeFuncIdx, ... }
codeState      // { currentFile, funcLineMap, funcList, rawLines, isOpen, ... }
_sv            // struct_view.js internal state (window._sv)
```

## Cross-module Interface (viz.js ↔ struct_view.js)

```
viz.js  ──calls──►  struct_view.js:
    svUpdateStructureBtn(fileRel, ext)
    svAfterRenderCode(src, ext, fname)
    svHideStructureBtn()
    svToggleStructView()

struct_view.js  ──calls──►  viz.js:
    jumpToFunc(name)
    openCodePanel()
    focusFunc(fileRel, idx)
    drillToFile(fileRel)
    state.level / l2State.activeFile / DATA.*
```

## Server API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /analyze` | Start analysis job, returns `job_id` via SSE |
| `GET /progress?job=JID` | Job progress stream (SSE) |
| `GET /result?job=JID` | Full analysis result JSON |
| `GET /file?path=...` | Read a source file |
| `GET /search?job=JID&q=...` | Full-text search |
| `GET /search-stream?job=JID&q=...` | Streaming search (SSE) |
| `GET /structure?job=JID&file=...` | File structure for Structure View |
| `GET /symbol-graph?job=JID&sym=SID` | Symbol-centric subgraph |
| `GET /symbol-refs?job=JID&sym=SID` | All references to a symbol |
| `GET /symbols?job=JID&query=...&kind=...` | Fuzzy symbol search |
