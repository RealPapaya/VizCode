# Changelog

All notable changes to VizCode will be documented here.

## [v1.0.0] — 2026-06-02

### 🎉 Initial Public Release

#### Core Features
- **Zero-dependency backend** — pure Python standard library, nothing to `pip install`
- **Multi-language parsing** — deep AST parsers for Python, JavaScript/TypeScript, Go, C/C++, C#, BIOS/EDK2
- **50+ languages** via `common_parser.py` universal fallback (Java, Rust, Swift, Kotlin, Ruby, PHP, Lua, Haskell, …)

#### Graph Visualization
- **L0 — Module Map**: high-level module overview with treemap + cluster layout
- **L1 — File Dependency Graph**: file-level import/include relationships
- **L2 — Function Call Flow**: call-graph inside a single file
- **L3 — Symbol Browser**: detailed class/member/signature and symbol-edge view
- **Galaxy View**: full-codebase WebGL graph (Sigma.js) showing every module, file, and function in one canvas
- **Symbol View**: class-level graph with compound `PUBLIC / PRIVATE` member cards, bundled edges, expand/collapse

#### UI / UX
- **Live streaming fuzzy search** across all symbols and file contents
- **Dual language UI** — English / 繁體中文 toggle built-in
- **Dark mode + multiple themes** out of the box
- **Edge-type filtering** in sidebar
- **Explorer panel** with folder/file tree and file viewer

#### AI Integration
- **MCP server** — exposes `vizcode_l0/l1/l2/l3/query/path/health/report` tools to Claude Code, Cursor, Windsurf, Gemini CLI
- **AI chat panel** — web-based streaming chat with context-aware codebase Q&A
- **Terminal AI** — `--chat` interactive mode and `--ai "question"` one-shot mode
- **Semantic enrichment** — Claude infers non-static relationships (runtime spawns, shared data files, protocol implementations)
- **Platform install script** — `python ai/install.py --all` deploys configs for all supported AI tools

#### Developer Experience
- `launch.bat` / `launch.sh` — one-click launcher for Windows and macOS/Linux
- `pip install -e .` — installs a global `vizcode` command
- `--scan-only` headless mode for CI/CD and AI tool integration
