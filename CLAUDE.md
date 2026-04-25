# CLAUDE.md

## Collaboration Rules

- 請優先使用繁體中文回覆，除非使用者先改用英文。
- 需求不明時先縮小範圍再動手，特別是功能邊界、檔案目標、是否要相容舊資料格式。
- 修改時以目前 repo 結構為準，不要再假設舊版根目錄 `server.py` / `analyze_viz.py` 仍是主入口。

## Project Snapshot

VizCode 目前已經是「本機優先、Python stdlib 後端、瀏覽器前端」的程式碼視覺化工具，主體可分成三塊：

1. `parsing (py)`
2. `AI (WebAI / AI report / CLI AI support)`
3. `Graph (galaxy / main graph: L0 L1 L2 L3 / dashboard)`

目前主要入口：

```bash
python src/vizcode.py
python src/vizcode.py <path> --scan-only
python src/vizcode.py <path> --chat
python src/vizcode.py <path> --ai "question"
launch.bat
```

## Current Layout

```text
src/
  vizcode.py              # CLI / TUI entry
  core/
    analyze_viz.py        # graph build pipeline
    detector.py           # project type detection
    parse_memo.py         # parse cache / memoization
    semantic_enricher.py  # semantic cache support
  parsers/
    python_parser.py
    js_parser.py
    go_parser.py
    bios_parser.py
    common_parser.py
    json_parser.py
  server/
    server.py             # HTTP server + API
    mcp_server.py         # MCP stdio tools

ai/
  vizbridge.py            # Web AI / tool loop / provider routing
  chat_cli.py             # CLI chat + one-shot AI
  chat_modes.py           # depth / output mode control
  ui_tools.py             # canvas-driving AI tools
  providers/              # anthropic/openai/gemini/grok/ollama/custom
  install.py              # install AI tool configs / skill files

static/
  launcher.html
  viz.js
  viz_graph.js
  viz_dashboard.js
  viz_chat.js
  galaxy/
  symbol_view/
  file_viewers/
```

## 1. Parsing (Python)

這一塊是整個資料產生鏈的核心，重點在 `src/core/` + `src/parsers/`。

### Main files

- `src/core/analyze_viz.py`
  - 掃描檔案、呼叫 parser、整理 modules / files / functions / edges / stats
  - 讀取 `static/` 資產並組出最終 HTML
- `src/core/detector.py`
  - 專案類型判斷
- `src/core/parse_memo.py`
  - parser 結果快取
- `src/parsers/*.py`
  - 語言別 parser

### Supported parser groups

- `python_parser.py`
- `js_parser.py`
- `go_parser.py`
- `bios_parser.py`
- `common_parser.py`：多語言 fallback
- `json_parser.py`：JSON / config 類資料

### Parser contract

目前 parser 介面以 6-tuple 為主：

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

其中：

- `funcdefs`: 函式定義清單
- `func_calls_by_func`: 與 `funcdefs` 平行的 per-function call list
- `symbol_defs`: 結構化 symbol 資料，給 symbol/structure 類視圖使用

有些 parser 失敗或 fallback 時可能額外附帶 `parse_diag`，但主流程至少要能正確吃前 6 個欄位。

### When editing parsing code

- 優先維持 `analyze_viz.py` 的資料契約，不要只改單一 parser。
- 新增語言時，通常要同步碰：
  - `src/parsers/<lang>_parser.py`
  - `src/core/analyze_viz.py`
  - `src/core/detector.py`
  - `static/viz_constants.js`
  - `static/viz_sidebar.js`
- 如果改了 parser 輸出格式，也要確認 graph / dashboard / MCP / AI 是否還吃得下去。

## 2. AI

AI 功能現在不是單一模組，而是三條線一起運作：

1. Web AI
2. AI Report / MCP context
3. CLI AI support

### 2.1 Web AI

由 `ai/vizbridge.py` 主導，透過 `src/server/server.py` 的 `/chat-stream` SSE endpoint 對前端提供串流回應。

關鍵檔案：

- `ai/vizbridge.py`
  - provider routing
  - tool-use loop
  - system prompt/context injection
  - 讀 `.local/scan_cache.json` / `.local/semantic_cache.json`
- `ai/ui_tools.py`
  - 把 AI 動作轉成前端 canvas action
- `ai/chat_modes.py`
  - `general / deep / quick` 與 output mode 限制
- `static/viz_chat.js`
  - 前端聊天 UI
- `static/viz_chat.css`
  - 聊天樣式

### 2.2 AI Report / MCP context

這條線是讓外部 AI agent 低 token 成本理解專案。

關鍵檔案：

- `src/server/mcp_server.py`
  - `vizcode_l0 / l1 / l2 / query / path / explain / health / report`
- `ai/install.py`
  - 安裝 Cursor / Windsurf / Gemini / Copilot 等設定
- `ai/skill_body.md`
  - skill 共用內容
- `.mcp.json`
  - 本地 MCP 宣告

常見資料來源：

- `.local/scan_cache.json`
- `.local/semantic_cache.json`
- `.local/INDEX.md`
- `.local/L1/...`
- `.local/L2/...`

### 2.3 CLI AI support

使用 `src/vizcode.py` 搭配：

```bash
python src/vizcode.py <path> --chat
python src/vizcode.py <path> --ai "question"
```

實作主要在：

- `ai/chat_cli.py`
- `ai/vizbridge.py`

### AI config notes

- 設定檔主要在 `ai/config.json` 與 `.local/key/ai_keys.json`
- provider 目前包含：
  - `anthropic`
  - `openai`
  - `gemini`
  - `grok`
  - `ollama`
  - `custom`

## 3. Graph

Graph 端目前可以再分成四個視角：

1. `main graph`
2. `galaxy`
3. `dashboard`
4. `symbol / structure related views`

### 3.1 Main graph

主圖相關檔案：

- `static/viz.js`：前端啟動
- `static/viz_graph.js`：主 graph engine
- `static/viz_layout.js`：layout
- `static/viz_sidebar.js`
- `static/viz_toolbar.js`
- `static/viz_state.js`
- `static/viz_constants.js`

主圖層級目前至少要用這樣理解：

- `L0`: module overview
- `L1`: file dependency graph
- `L2`: function / symbol drill-down
- `L3`: 更細的 function / symbol / structure 層互動

注意：UI 名稱上雖然常講 `L0/L1/L2/L3`，但實作上會分散在 main graph、symbol view、code panel、dashboard 之間，不一定全都在同一支 JS。

### 3.2 Galaxy

完整全域圖在：

- `static/galaxy/viz_galaxy.js`
- `static/galaxy/viz_galaxy_graph.js`
- `static/galaxy/viz_galaxy_physics.js`

用途是整個 codebase 的全域視角，不是取代 L0/L1/L2，而是平行的一種大圖模式。

### 3.3 Dashboard

Dashboard 在：

- `static/viz_dashboard.js`

這邊通常承接統計、摘要、health 類資訊，會和 parsing stats、AI report、graph state 有關。

### 3.4 Related graph surfaces

- `static/symbol_view/`
  - symbol-centric view
- `static/viz_code_panel.js`
  - code panel / snippet / viewer integration
- `static/file_viewers/`
  - markdown / office / pdf viewers

## Backend / Frontend Flow

目前大致流程：

1. `src/vizcode.py` 啟動 TUI/CLI
2. `src/server/server.py` 提供 HTTP API 與頁面
3. `src/core/analyze_viz.py` 掃描並產生 graph data
4. `static/*.js` 消費 graph data 並渲染互動 UI
5. `ai/vizbridge.py` 透過 SSE + tool calls 驅動 Web AI / CLI AI / MCP context

## Practical Editing Guidance

### 如果需求偏 parsing

優先看：

- `src/core/analyze_viz.py`
- `src/parsers/*`
- `src/core/detector.py`

### 如果需求偏 AI

優先看：

- `ai/vizbridge.py`
- `ai/chat_cli.py`
- `ai/chat_modes.py`
- `ai/ui_tools.py`
- `src/server/mcp_server.py`
- `src/server/server.py`

### 如果需求偏 graph / UI

優先看：

- `static/viz.js`
- `static/viz_graph.js`
- `static/viz_dashboard.js`
- `static/galaxy/*`
- `static/symbol_view/*`
- `static/viz_chat.js`

## Verification Notes

- 這個專案目前沒有看到完整自動化測試主流程可依賴。
- 驗證通常以實際跑專案與 smoke test 為主：

```bash
python src/vizcode.py
python src/vizcode.py <path> --scan-only
python src/vizcode.py <path> --chat
```

- 若修改 Web AI / graph，至少確認：
  - 首頁可開
  - 分析流程可完成
  - chat panel 正常
  - main graph / galaxy / dashboard 沒有明顯壞掉
