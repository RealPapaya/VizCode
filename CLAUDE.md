# CLAUDE.md

## Collaboration Rules

- Clarify scope before acting — especially feature boundaries, target files, and backward compatibility.
- Always work within the **current repo structure**. Do not assume legacy root-level `server.py` / `analyze_viz.py` still exist.

---

## Project Overview

**VizCode** — local-first, Python stdlib backend + browser frontend code visualization tool.

**Three pillars:** `Parsing (py)` · `AI (Web / Report / CLI)` · `Graph (Galaxy / L0–L3 / Dashboard)`

```bash
python src/vizcode.py
python src/vizcode.py <path> --scan-only
python src/vizcode.py <path> --chat
python src/vizcode.py <path> --ai "question"
launch.bat
```

---

## Current Layout

```text
src/
  vizcode.py              # CLI / TUI entry point
  core/
    analyze_viz.py        # Graph build pipeline
    html_builder.py       # HTML template: build_html() / inject_data()
    detector.py           # Project type detection
    parse_memo.py         # Parser result caching
    semantic_enricher.py  # Semantic cache support
    analytics_helpers.py  # Stats / aggregations for the graph
    code_health.py        # Health scoring
    git_history.py        # Git log enrichment
    health_backfill.py    # Backfill missing health metrics
    qa_cache.py           # Q&A response cache
  parsers/
    python_parser.py  js_parser.py  go_parser.py
    c_cpp_parser.py   csharp_parser.py
    uefi_parser.py    acpi_parser.py    asm_parser.py   # firmware (spec-backed)
    common_parser.py  json_parser.py
    # dedicated long-tail parsers (same 6-tuple contract): java, rust, kotlin,
    # scala, groovy, dart, swift, objc, php, perl, lua, shell, r, protobuf,
    # graphql, zig, d, sql, css (css/scss/sass/less/styl), ruby, crystal, julia,
    # elixir, vbnet, clojure, erlang, fsharp, ocaml, nim, haskell, elm,
    # html, yaml, powershell (ps1/psm1/psd1), toml
  server/
    server.py             # HTTP server + API
    job_manager.py        # Job state, viewer lifecycle, analysis thread
    fetcher.py            # ZIP / git / npm input helpers
    mcp_server.py         # MCP stdio tools

ai/
  vizbridge.py            # Web AI / tool loop / provider routing
  chat_cli.py             # CLI chat + one-shot AI
  chat_modes.py           # Depth / output mode control
  ui_tools.py             # Canvas-driving AI tools
  providers/              # anthropic / openai / gemini / grok / ollama / custom
  install.py              # Install AI configs and skill files

static/
  launcher.html
  viz.js                       # SPA bootstrap / D3 + Cytoscape main view
  core/                        # i18n, viz_constants, viz_state, viz_utils, viz_nav_history
  ui/                          # viz_layout, viz_sidebar, viz_toolbar, viz_code_panel, viz_preferences
  styles/                      # themes.css + viz_base / viz_chat / viz_code / viz_features / viz_overlays / viz_panels
  features/
    graph/                     # graph_core / graph_l1 / graph_l2 / graph_interact / graph_style / graph_multiselect
    galaxy_view/               # viz_galaxy / viz_galaxy_graph / viz_galaxy_physics
    Dashboard_view/            # dashboard_*.js + widgets/
    symbol_view/               # sv_core / sv_graph / sv_search / symbol_view.css
    viz_chat.js  viz_search.js  viz_help.js
  file_viewers/                # viz_markdown / viz_office / viz_pdf
  icon/
```

---

## 1. Parsing

Core of the data pipeline — lives in `src/core/` and `src/parsers/`.

- `analyze_viz.py` — scans files, calls parsers, builds modules / edges / stats
- `html_builder.py` — HTML skeleton + asset embedding
- `detector.py` — project type detection
- `parse_memo.py` — parser result caching
- `common_parser.py` — multi-language fallback · `json_parser.py` — config/JSON data

### Parser Contract (6-tuple)

```python
(imports_or_refs, funcdefs, funccalls, extra_dict, func_calls_by_func, symbol_defs)
```

### When Editing Parsers

- Keep `analyze_viz.py` data contract intact — don't change just one parser in isolation.
- Adding a new language requires touching:
  `src/parsers/<lang>_parser.py` · `src/core/analyze_viz.py` · `src/core/detector.py` · `static/core/viz_constants.js` · `static/ui/viz_sidebar.js`
- If parser output format changes, verify graph / dashboard / MCP / AI still consume it correctly.

---

## 2. AI

Three parallel tracks:

### 2.1 Web AI
`ai/vizbridge.py` → SSE via `/chat-stream` → `static/features/viz_chat.js`
- Provider routing, tool-use loop, system prompt injection
- Reads `.vizcode/scan_cache.json` / `.vizcode/semantic_cache.json`

### 2.2 AI Report / MCP Context
Low-token project understanding for external AI agents.
- `src/server/mcp_server.py` — tools: `vizcode_l0/l1/l2/l3/query/path/explain/health/report`
- Data: `.vizcode/scan_cache.json` · `INDEX.md` · `L1/` · `L2/` · `L3/`

### 2.3 CLI AI
```bash
python src/vizcode.py <path> --chat
python src/vizcode.py <path> --ai "question"
```
Implemented in `ai/chat_cli.py` + `ai/vizbridge.py`.

### AI Config
- Config: `ai/config.json` · `.vizcode/key/ai_keys.json`
- Providers: `anthropic` · `openai` · `gemini` · `grok` · `ollama` · `custom`

---

## 3. Graph

| View | Key Files |
|------|-----------|
| **Main graph (L0–L3)** | `static/viz.js`, `static/features/graph/graph_*.js`, `static/ui/viz_layout.js`, `static/ui/viz_sidebar.js`, `static/ui/viz_toolbar.js`, `static/core/viz_state.js`, `static/core/viz_constants.js` |
| **Galaxy** | `static/features/galaxy_view/viz_galaxy.js`, `viz_galaxy_graph.js`, `viz_galaxy_physics.js` |
| **Dashboard** | `static/features/Dashboard_view/dashboard_*.js` (+ `widgets/`) |
| **Symbol / Structure** | `static/features/symbol_view/`, `static/ui/viz_code_panel.js`, `static/file_viewers/` |

Graph levels: `L0` module overview · `L1` file deps · `L2` function drill-down · `L3` fine-grained symbol interaction

---

## Backend / Frontend Flow

```
vizcode.py  →  server.py  →  analyze_viz.py  →  static/*.js  →  vizbridge.py (AI/SSE)
```

---

## Editing Quick Reference

| Focus Area | Start Here |
|------------|------------|
| Parsing | `src/core/analyze_viz.py`, `src/parsers/*`, `src/core/detector.py` |
| AI | `ai/vizbridge.py`, `ai/chat_cli.py`, `ai/chat_modes.py`, `src/server/mcp_server.py` |
| Server / Jobs | `src/server/server.py`, `src/server/job_manager.py`, `src/server/fetcher.py` |
| Graph / UI | `static/viz.js`, `static/features/graph/*`, `static/features/Dashboard_view/*`, `static/features/galaxy_view/*`, `static/features/viz_chat.js` |

---

## Verification

No automated test suite. Use smoke tests:

```bash
python src/vizcode.py
python src/vizcode.py <path> --scan-only
```

After changes, verify: homepage loads · analysis completes · chat panel works · graph / galaxy / dashboard render correctly.
