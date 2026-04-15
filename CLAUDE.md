# CLAUDE.md

## Collaboration Rules

- **Ask before assuming.** If requirements are unclear — especially scope, file targets, or expected behaviour — ask first.
- **Respond in Traditional Chinese (繁體中文)** unless the user writes in English first.

## Project Overview

**VIZCODE** is a local, zero-dependency code visualization tool. Scans a codebase and generates an interactive HTML dependency/call graph. Goal: CodeViz-level code exploration (symbol-centric navigation, graph view, code snippets).

## Running the App

```bash
python vizcode.py   # CLI + TUI
# or
launch.bat
```

`http://localhost:7777` in Chrome. No build step. Hard-refresh: `Ctrl+Shift+R`.

Kill port if occupied: `netstat -ano | findstr :7777` → `taskkill /PID <PID> /F`

## Testing / Verification

No automated test runner. Use `testproject/` as smoke-test target.

```bash
curl http://localhost:7777/jobs
curl "http://localhost:7777/result?job=<JID>" | python -c "import json,sys; d=json.load(sys.stdin); print(list(d.keys()))"
```

## Architecture

Full frontend file list, load order, global state, and API endpoints → see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Backend

| File | Role |
|------|------|
| `vizcode.py` | CLI launcher + TUI. Spawns `server.py`. |
| `server.py` | HTTP server (port 7777, stdlib only). API endpoints, SSE. |
| `analyze_viz.py` | **Core engine.** `build_graph(root)` → assembles `DATA`. |
| `detector.py` | Detects project type (Python / JS / Go / BIOS). |
| `parsers/bios_parser.py` | C/C++/UEFI/EDK2 parser |
| `parsers/python_parser.py` | Python parser |
| `parsers/js_parser.py` | JS/TS/JSX/TSX parser |
| `parsers/go_parser.py` | Go parser |

### Navigation Levels

- **L0** — Module overview (`state.level = 0`)
- **L1** — File dependency graph (`state.level = 1`)
- **L2** — Function call-flow (`state.level = 2`)
- **sv-view** — Structure View overlay (over L1/L2)
- **Galaxy** — Sigma.js WebGL full-codebase graph (`#galaxy-overlay`)

## Parser Interface Contract

All `parsers/*.py` scan functions **must** return:

```python
return (
    imports_or_refs,      # list[str]
    funcdefs,             # list[dict]: [{label, is_efiapi, is_static}, ...]
    funccalls,            # list[str]
    extra_dict,           # dict | None
    func_calls_by_func,   # list[list[str]]
)
```

Pure text transformers — no imports from `analyze_viz.py`. Wrap all I/O in `try/except`; fail silently.

## Code Style

- **Zero external dependencies**: stdlib only (Python); only libs in `launcher.html` (frontend).
- Python: `snake_case` / `UPPER_SNAKE_CASE` / `PascalCase`. Dividers: `# ─── Title ───`
- JavaScript: `camelCase` / `UPPER_SNAKE_CASE`. No `var`. No raw `innerHTML` with user input. Dividers: `// ── Title ───`
- Functions over 60 lines should be split.

## Adding a New Language Parser

1. Create `parsers/<lang>_parser.py` returning the tuple above.
2. Register in `analyze_viz.py`: `SCAN_EXT`, `FILE_TYPE_MAP`, `scan_file()`.
3. Update `detector.py`.
4. Update `static/viz_constants.js`: `extColor()`, `FILE_TYPE_SHAPE`.
5. Update `static/viz_sidebar.js`: `FT_GROUPS`.

## VizCode MCP Tools

When you need to understand this repo's structure, prefer the MCP tools over reading source files directly — they save significant context.

| Tool | Use when |
|------|----------|
| `vizcode_query(question)` | Finding which modules handle a feature |
| `vizcode_path(source, target)` | Understanding call chain between two files |
| `vizcode_explain(symbol)` | Getting a module's role + connections |

**禁止**直接讀取 `.local/scan_cache.json` 或 `.local/semantic_cache.json` 原始檔案。

MCP tools require `/vizcode --ai` to have been run first (populates `semantic_cache.json`).
