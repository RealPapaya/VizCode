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

---

## 🚀 Quick Start

**Requirements:** Python 3.8+ · Windows (Linux/macOS support is partial)

```bash
# 1. Clone
git clone https://github.com/RealPapaya/VizCode.git
cd VizCode

# 2. Run
launch.bat          # Windows
# or
python vizcode.py   # Any platform
```

A browser window opens at `http://localhost:7777`. Enter the path to your project and click **Analyze**.

---

## 🗺️ How It Works

```
launch.bat
  └─▶ vizcode.py          (TUI — pick a directory)
        └─▶ server.py     (HTTP server on :7777)
              └─▶ analyze_viz.py   (scan → build graph JSON)
                    ├─▶ detector.py        (auto-detect project type)
                    └─▶ parsers/*.py       (per-language AST extraction)
                              ↓
                    browser ← launcher.html + inlined JS/CSS
```

The entire analysis result is a single self-contained JSON object injected into the HTML — no database, no state files.

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
├── vizcode.py           # TUI entry point
├── server.py            # HTTP server + API endpoints
├── analyze_viz.py       # Core analysis engine
├── detector.py          # Project type detection
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
