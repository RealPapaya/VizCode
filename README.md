# VizCode

> **Understand any codebase at a glance — without installing anything.**

VizCode is a local-first code visualization tool that scans your project and renders an interactive dependency graph directly in your browser. No cloud uploads, no API keys, no `pip install`. Just run it and explore.

![VizCode Screenshot](docs/screenshot.png)

---

## ✨ Features

- **Zero dependencies** — pure Python standard library on the backend. Nothing to install.
- **Multi-language** — deep parsers for Python, JavaScript/TypeScript, Go, C/C++/BIOS/EDK2. 50+ additional languages via a universal fallback parser (Java, Rust, Swift, Kotlin, Ruby, PHP, and more).
- **Three zoom levels**
  - **L0 — Module Map** : high-level overview of your project's module structure
  - **L1 — File Dependency Graph** : file-level import/include relationships
  - **L2 — Function Call Flow** : call-graph inside a single file
- **Symbol View** — class-level graph with compound `PUBLIC / PRIVATE` member cards, bundled edges, expand/collapse, and Back/Forward navigation
- **Galaxy View** — full-codebase WebGL graph (Sigma.js) showing every module, file, and function in one canvas
- **Live search** — streaming fuzzy search across all symbols and file contents
- **Dual language UI** — English / 繁體中文 toggle built-in
- **Dark mode + themes** — multiple color themes out of the box
- **AI assistant integration** — MCP server + per-platform skill files let any major AI tool (Claude Code, Cursor, Windsurf, Gemini CLI) navigate your codebase without reading raw source files

---

## 🚀 Quick Start

**Requirements:** Python 3.6+ on Windows. Linux/macOS support is partial.

```bash
# 1. Clone
git clone https://github.com/RealPapaya/VizCode.git
cd VizCode

# 2. Run
launch.bat          # Windows
# or
python vizcode.py   # Any platform
```

A browser window opens at `http://localhost:7777`. You can optionally generate an AI report (`.local/vizcode_report.md`) before analysis for AI assistant consumption.

---

### AI Assistant Integration

VizCode ships with an MCP server and platform-specific skill files so AI tools can explore your codebase at a fraction of the token cost.

**Install configs for your AI tool:**

```bash
python ai/install.py --cursor      # Cursor AI
python ai/install.py --windsurf    # Windsurf
python ai/install.py --gemini      # Gemini CLI
python ai/install.py --copilot     # GitHub Copilot (static report only)
python ai/install.py --all         # all of the above
python ai/install.py --list        # show install status
```

**MCP tools (Cursor / Windsurf / Gemini CLI / Claude Code):**

| Tool | Purpose |
|------|---------|
| `vizcode_l0()` | Module overview + cross-module dependencies |
| `vizcode_l1(module)` | File list + import edges for a module |
| `vizcode_l2(file)` | Function call graph + docstrings for a file |
| `vizcode_query(q)` | Keyword search across modules and edges |
| `vizcode_path(a, b)` | Shortest dependency path from A to B |
| `vizcode_health()` | Dead code, god files, circular deps |
| `vizcode_report()` | Full INDEX.md overview |

**Claude Code additionally supports `/vizcode` skill:**

```
/vizcode --parse   # Scan + generate report + open browser
/vizcode --ai      # Scan + semantic analysis (LLM-inferred edges)
/vizcode           # Full flow (scan + AI + report + browser)
```

Semantic analysis (`--ai`) is Claude-only — it infers non-static relationships (runtime spawns, shared data files, protocol implementations) that AST cannot detect.

---

## 📊 Usage Modes

| Mode | Command | Interactive | AI Report | Browser | Use Case |
|------|---------|-------------|-----------|---------|----------|
| **TUI (with prompt)** | `launch.bat` or `python vizcode.py` | ✅ | 🤷 *You choose* | ✅ | **Flexible** — asks if you want report |
| **Direct scan** | `python vizcode.py <path>` | ✅ Progress only | ❌ | ✅ | Quick viz (no menu) |
| **Headless** | `python vizcode.py <path> --scan-only` | ❌ | ✅ | ❌ | CI/CD, AI integration |
| **Claude Parse** | `/vizcode --parse` | ❌ | ✅ | ✅ | Claude: AI analysis + viz |
| **Claude AI** | `/vizcode --ai` | ❌ | ✅ | ❌ | Claude: semantic analysis only |
| **Claude Full** | `/vizcode` | ❌ | ✅ | ✅ | Claude: complete workflow |

### When to generate AI report?

**Choose YES if:**
- ✅ You plan to ask AI about the codebase
- ✅ You want architectural insights (hotspots, communities, health)
- ✅ You're documenting the project structure
- ✅ First time analyzing a large codebase

**Choose NO if:**
- ⚡ You only need quick visualization
- ⚡ You've already generated the report before
- ⚡ You're in a hurry (report generation adds ~10-30 seconds)

---

## 🗺️ How It Works

```
launch.bat  (or /vizcode --parse)
  └─▶ vizcode.py          (TUI — pick a directory)
        └─▶ server.py     (HTTP server on :7777)
              └─▶ analyze_viz.py   (scan → build graph JSON)
                    ├─▶ detector.py        (auto-detect project type)
                    └─▶ parsers/*.py       (per-language AST extraction)
                              ↓
                    browser ← launcher.html + inlined JS/CSS

python vizcode.py <path> --scan-only   (headless scan for AI tools)
  └─▶ .local/scan_cache.json
  └─▶ .local/INDEX.md + L1/ + L2/     (hierarchical report tree)
  └─▶ mcp_server.py                   (MCP stdio, used by all AI tools)
        └─▶ vizcode_l0 / l1 / l2 / query / path / health / …

/vizcode --ai  (Claude Code only — semantic enrichment)
  └─▶ Claude infers non-static relationships from scan_cache
        └─▶ semantic_enricher.py  (writes .local/semantic_cache.json)
```

The browser graph shows static edges (imports, calls). The MCP server additionally exposes semantic edges inferred by Claude (`/vizcode --ai`), visible to any AI tool that connects afterward.

---

## 🌐 Language Support

| Language | Parser | Depth |
|----------|--------|-------|
| Python | `python_parser.py` | imports · functions · classes · methods |
| JavaScript / TypeScript | `js_parser.py` | imports · functions · classes · interfaces · enums |
| Go | `go_parser.py` | imports · functions · structs · interfaces |
| C / C++ / BIOS / EDK2 | `bios_parser.py` | includes · functions · structs · typedefs · enums · INF/SDL sections |
| Java, Rust, Swift, Kotlin, Ruby, PHP, Lua, Haskell, … (50+) | `common_parser.py` | imports · functions · classes (language-aware patterns) |

---

## 📁 Project Structure

```
VizCode/
├── vizcode.py           # TUI entry point  (--scan-only for headless scan)
├── server.py            # HTTP server + API endpoints
├── analyze_viz.py       # Core analysis engine
├── detector.py          # Project type detection
├── semantic_enricher.py # Semantic cache I/O (read/write .local/semantic_cache.json)
├── mcp_server.py        # MCP stdio server (vizcode_query/path/explain)
├── parsers/
│   ├── python_parser.py
│   ├── js_parser.py
│   ├── go_parser.py
│   ├── bios_parser.py
│   └── common_parser.py
├── static/
│   ├── viz.js / viz.css          # Main frontend (boot + styles)
│   ├── viz_graph.js              # Cytoscape graph engine
│   ├── viz_search.js             # Streaming fuzzy search
│   ├── viz_galaxy.js             # Galaxy View (Sigma.js WebGL)
│   ├── symbol_view.js            # Symbol-Centric Graph
│   ├── trail_layouter.js         # Sugiyama layout engine
│   └── ...
├── .mcp.json            # MCP server declaration for Claude Code
├── ai/
│   ├── install.py       # Deploy AI configs: python ai/install.py --all
│   ├── skill_body.md    # Shared skill content (single source of truth)
│   ├── mcp_template.json
│   └── templates/       # Per-platform frontmatter (cursor/windsurf/gemini/copilot)
├── .local/
│   ├── scan_cache.json        # Per-file AST cache
│   ├── semantic_cache.json    # AI-inferred edges (written by /vizcode --ai)
│   ├── INDEX.md               # L0 report (~100-200 lines, always start here)
│   ├── L1/<module>.md         # Per-module file map
│   └── L2/<module>/<file>.md  # Per-file function call graph
└── launch.bat           # One-click launcher (Windows)
```

---

## 🔌 API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /analyze` | Start an analysis job (SSE stream) |
| `GET /result?job=JID` | Full analysis JSON |
| `GET /file?path=...` | Read a source file |
| `GET /search-stream?job=JID&q=...` | Streaming full-text search |
| `GET /symbol-graph?job=JID&sym=SID` | Symbol-centric subgraph |
| `GET /symbol-refs?job=JID&sym=SID` | All references to a symbol |
| `GET /symbols?job=JID&query=...&kind=...` | Fuzzy symbol search |

---

## 🛠️ Extending VizCode

### Add a new language parser

1. Create `parsers/mylang_parser.py` with a `scan_mylang(src, ext)` function returning a 6-tuple:
   ```python
   return (imports, funcdefs, funccalls, extra, calls_by_func, symbol_defs)
   ```
2. Dispatch it in `analyze_viz.py` → `scan_file()`.
3. Register the extension in `SCAN_EXT` / `FILE_TYPE_MAP`.

### Add a new theme

Edit `static/themes.css` — each theme is a single CSS class applied to `<body>`.

---

## 📄 License

MIT — see [LICENSE](LICENSE).

---

<p align="center">
  Built for developers who want to <em>see</em> their code, not just read it.
</p>
