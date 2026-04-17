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

## 靜態報告導航（無 MCP 時）

掃描後（`--scan-only` 或 `--parse`）生成分層報告樹，**永遠從 INDEX.md 開始**：

```
.local/
  INDEX.md              ← L0：永遠 ~100-200 行，從這裡開始
  L1/<module>.md        ← 模組內 file map（按需讀取）
  L1/<module>/<sub>.md  ← 大模組子目錄（超過 50 個檔案時）
  L2/<module>/<file>.md ← 函式呼叫圖（按需讀取）
```

**導航策略：**
1. Read `.local/INDEX.md` → 看到模組結構 + health summary
2. Read `.local/L1/<module>.md` → 鎖定模組，看到檔案清單
3. Read `.local/L2/<module>/<file>.md` → 看到函式呼叫圖 + docstring

**禁止**直接讀取 `.local/scan_cache.json`、`.local/semantic_cache.json`、或任何原始碼。

---

## VizCode MCP Tools（MCP Server 在線時）

When you need to understand this repo's structure, prefer the MCP tools over reading source files directly — they save 96-99% of tokens vs reading raw source.

### 階層式揭露策略 (Hierarchical Disclosure)

**絕對禁止**一開始就讀取原始碼。遵循 L0 → L1 → L2 由上而下策略：

| 層級 | Tool | 何時使用 | ~Token 成本 |
|------|------|----------|------------|
| L0 | `vizcode_l0()` | **第一步**：了解全專案模組分群與跨模組依賴 | ~200 |
| L1 | `vizcode_l1(module)` | 鎖定模組後，展開其內部檔案依賴圖 | ~150 |
| L2 | `vizcode_l2(file)` | 鎖定檔案後，取得函式呼叫圖與行號 | ~300-1200 |

**其他工具：**

| Tool | Use when |
|------|----------|
| `vizcode_query(question)` | 關鍵字搜尋模組與語意邊 |
| `vizcode_path(source, target)` | 了解兩個檔案間的呼叫鏈 |
| `vizcode_explain(symbol)` | 取得模組角色與連接（快速摘要） |
| `vizcode_health()` | 取得 dead code / god files / circular imports |
| `vizcode_report()` | 取得 INDEX.md 內容（= `.local/INDEX.md`） |

**禁止**直接讀取 `.local/scan_cache.json` 或 `.local/semantic_cache.json` 原始檔案。

MCP tools require `/vizcode --ai` to have been run first (populates `semantic_cache.json`).
