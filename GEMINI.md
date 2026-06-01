# VizCode Codebase Guide

## 回覆語言

- 預設使用繁體中文。

## 專案主軸

VizCode 目前可以用三塊來理解：

1. `parsing (py)`
2. `AI (WebAI / AI report / CLI AI support)`
3. `Graph (galaxy / main graph[L0 L1 L2 L3] / dashboard)`

## 目前主入口

```bash
python src/vizcode.py
python src/vizcode.py <path> --scan-only
python src/vizcode.py <path> --chat
python src/vizcode.py <path> --ai "question"
launch.bat
```

不要再假設舊版根目錄 `vizcode.py`、`server.py`、`analyze_viz.py` 是主要工作位置；現在核心程式已經拆進 `src/`。

## Repo 結構

```text
src/
  vizcode.py
  core/
    analyze_viz.py
    detector.py
    parse_memo.py
    semantic_enricher.py
  parsers/
    python_parser.py
    js_parser.py
    go_parser.py
    c_cpp_parser.py
    csharp_parser.py
    bios_parser.py
    common_parser.py
    json_parser.py
  server/
    server.py
    mcp_server.py

ai/
  vizbridge.py
  chat_cli.py
  chat_modes.py
  ui_tools.py
  providers/
  install.py

static/
  viz.js
  viz_graph.js
  viz_dashboard.js
  viz_chat.js
  galaxy/
  symbol_view/
  file_viewers/
```

## 1. Parsing

主要看：

- `src/core/analyze_viz.py`
- `src/core/detector.py`
- `src/core/parse_memo.py`
- `src/parsers/*.py`

### Parser contract

目前 parser 主要回傳 6-tuple：

```python
(
    imports_or_refs,
    funcdefs,
    funccalls,
    extra_dict,
    func_calls_by_func,
    symbol_defs,
)
```

重點：

- `func_calls_by_func` 要和 `funcdefs` 對齊
- `symbol_defs` 給 symbol / structure / deeper graph view 使用

如果新增語言，通常還要同步修改：

- `src/core/analyze_viz.py`
- `src/core/detector.py`
- `static/viz_constants.js`
- `static/viz_sidebar.js`

## 2. AI

AI 分成三條線：

### Web AI

- `ai/vizbridge.py`
- `ai/ui_tools.py`
- `ai/chat_modes.py`
- `static/viz_chat.js`

透過 `src/server/server.py` 的 `/chat-stream` SSE endpoint 跑。

### AI report / MCP

- `src/server/mcp_server.py`
- `ai/install.py`
- `ai/skill_body.md`
- `.mcp.json`

主要依賴：

- `.vizcode/scan_cache.json`
- `.vizcode/semantic_cache.json`
- `.vizcode/INDEX.md`
- `.vizcode/L1/...`
- `.vizcode/L2/...`
- `.vizcode/L3/...`

### CLI AI support

```bash
python src/vizcode.py <path> --chat
python src/vizcode.py <path> --ai "question"
```

主要實作：

- `ai/chat_cli.py`
- `ai/vizbridge.py`

## 3. Graph

### Main graph

主要檔案：

- `static/viz.js`
- `static/viz_graph.js`
- `static/viz_layout.js`
- `static/viz_sidebar.js`
- `static/viz_toolbar.js`
- `static/viz_state.js`
- `static/viz_constants.js`

可用 `L0 / L1 / L2 / L3` 來理解：

- `L0`: module overview
- `L1`: file dependency graph
- `L2`: function / symbol drill-down
- `L3`: 更細的 symbol / structure / function interaction

### Galaxy

- `static/galaxy/viz_galaxy.js`
- `static/galaxy/viz_galaxy_graph.js`
- `static/galaxy/viz_galaxy_physics.js`

### Dashboard

- `static/viz_dashboard.js`

### Related surfaces

- `static/symbol_view/`
- `static/viz_code_panel.js`
- `static/file_viewers/`

## 工作指引

### 如果需求偏 parsing

先看：

- `src/core/analyze_viz.py`
- `src/parsers/*`

### 如果需求偏 AI

先看：

- `ai/vizbridge.py`
- `ai/chat_cli.py`
- `ai/chat_modes.py`
- `ai/ui_tools.py`
- `src/server/mcp_server.py`
- `src/server/server.py`

### 如果需求偏 graph / UI

先看：

- `static/viz.js`
- `static/viz_graph.js`
- `static/viz_dashboard.js`
- `static/galaxy/*`
- `static/symbol_view/*`
- `static/viz_chat.js`

## 探索策略

理解專案時，優先從高層往下：

1. 先確認需求屬於 `parsing`、`AI`、還是 `Graph`
2. 再進到對應主資料夾
3. 不要一開始就盲讀整包 `static/` 或所有 parser

## 驗證

常用 smoke test：

```bash
python src/vizcode.py
python src/vizcode.py <path> --scan-only
python src/vizcode.py <path> --chat
```

如果有改 Web AI 或 graph，至少確認：

- 首頁能開
- 分析流程可完成
- chat panel 可用
- main graph / galaxy / dashboard 沒有明顯壞掉
