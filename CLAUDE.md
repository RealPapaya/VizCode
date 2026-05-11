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
  parsers/
    python_parser.py  js_parser.py  go_parser.py
    bios_parser.py    common_parser.py  json_parser.py
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
  launcher.html  viz.js  viz_graph.js  viz_dashboard.js  viz_chat.js
  galaxy/  symbol_view/  file_viewers/
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
  `src/parsers/<lang>_parser.py` · `analyze_viz.py` · `detector.py` · `viz_constants.js` · `viz_sidebar.js`
- If parser output format changes, verify graph / dashboard / MCP / AI still consume it correctly.

---

## 2. AI

Three parallel tracks:

### 2.1 Web AI
`ai/vizbridge.py` → SSE via `/chat-stream` → `static/viz_chat.js`
- Provider routing, tool-use loop, system prompt injection
- Reads `.vizcode/scan_cache.json` / `.vizcode/semantic_cache.json`

### 2.2 AI Report / MCP Context
Low-token project understanding for external AI agents.
- `src/server/mcp_server.py` — tools: `vizcode_l0/l1/l2/query/path/explain/health/report`
- Data: `.vizcode/scan_cache.json` · `INDEX.md` · `L1/` · `L2/`

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
| **Main graph (L0–L3)** | `viz.js`, `viz_graph.js`, `viz_layout.js`, `viz_sidebar.js`, `viz_toolbar.js`, `viz_state.js`, `viz_constants.js` |
| **Galaxy** | `galaxy/viz_galaxy.js`, `viz_galaxy_graph.js`, `viz_galaxy_physics.js` |
| **Dashboard** | `viz_dashboard.js` |
| **Symbol / Structure** | `symbol_view/`, `viz_code_panel.js`, `file_viewers/` |

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
| Parsing | `analyze_viz.py`, `src/parsers/*`, `detector.py` |
| AI | `vizbridge.py`, `chat_cli.py`, `chat_modes.py`, `mcp_server.py` |
| Server / Jobs | `server.py`, `job_manager.py`, `fetcher.py` |
| Graph / UI | `viz.js`, `viz_graph.js`, `viz_dashboard.js`, `galaxy/*`, `viz_chat.js` |

---

## Verification

No automated test suite. Use smoke tests:

```bash
python src/vizcode.py
python src/vizcode.py <path> --scan-only
```

After changes, verify: homepage loads · analysis completes · chat panel works · graph / galaxy / dashboard render correctly.
