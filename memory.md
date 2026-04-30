# VIZCODE — AI 核心記憶與快速上手指南

> ⚠️ **所有 AI Agent 注意** ⚠️
> 這是一份幫助你快速理解專案的指南。每次重大架構修改後，**必須**同步更新此檔案，以確保給下一位 AI 接手時資訊是最新的。

---

## 🚀 系統概覽 (System Overview)

- **專案名稱**: VIZCODE V4
- **專案用途**: 本地端 (Local) 的程式碼視覺化工具。掃描使用者的 codebase 並產生互動式的 HTML 關聯圖 (Dependency Graph / Call Graph)。
- **啟動方式**: 執行 `launch.bat` → 自動開啟互動式終端機 CLI `vizcode.py` → 啟動本地伺服器 `server.py` → 在 Chrome 打開 `http://localhost:7777`。
- **核心特色**: 完全依賴 Python 標準函式庫 (無 pip 安裝需求)、支援多語言 (Pluggable Parser)、前後端分離架構。
- **渲染架構**: L0/L1/L2 使用 Cytoscape.js (`#cy`)；Galaxy View 使用 Sigma.js + graphology 進行 WebGL 全域圖渲染 (modules + files + functions 整合視圖)。Galaxy 為獨立 overlay (`#galaxy-overlay`)，不影響主視圖。

---

## 📂 核心檔案地圖與相依關係

為了方便人類與 AI 快速閱讀，請參考以下結構化的檔案樹狀圖設計：

### 🟢 啟動與伺服器 (Entry & Server)
- 📄 **`launch.bat`** (腳本)
  - **用途**: Windows 專屬啟動腳本。設定 UTF-8 環境。
  - **👉 觸發**: `vizcode.py`
- 🐍 **`vizcode.py`** (後端)
  - **用途**: 互動式終端機介面 (TUI)，供使用者選擇歷史紀錄與目錄。
  - **🆕 `--scan-only` flag**: 純 AST 掃描模式，不開瀏覽器、不顯示 TUI，由 `/vizcode` skill 呼叫。
  - **👉 觸發**: 以子程序 (Subprocess) 啟動 `server.py`
- 🌐 **`server.py`** (後端)
  - **用途**: HTTP 伺服器 (Port 7777)，負責處理網頁請求與 `/analyze` 背景任務。
  - **👉 觸發**: 載入 `analyze_viz.py` 進行分析，發送 `launcher.html` 給瀏覽器。
- 🤖 **`mcp_server.py`** (後端)
  - **用途**: MCP stdio server (JSON-RPC 2.0, Content-Length framing)。提供 3 個工具：`vizcode_query`、`vizcode_path`、`vizcode_explain`。
  - **👉 觸發**: 由 Claude Code 根據 `.mcp.json` 自動管理生命週期；讀取 `.local/scan_cache.json` 與 `.local/semantic_cache.json`。
- 🧠 **`semantic_enricher.py`** (後端)
  - **用途**: `.local/semantic_cache.json` 的讀寫介面。API 呼叫邏輯已移除，快取由 `/vizcode --ai` skill 填入。
  - **CLI 模式**: `python semantic_enricher.py write <root> < edges.json` / `check <root> < scan_cache.json`。
  - **👉 觸發**: 由 SKILL.md (`/vizcode`) 呼叫以寫入語意推斷邊。

### 🤖 AI 整合層 VIZBRIDGE (Web Chat + CLI AI)
> AI 層**共用同一份邏輯**：Web UI 的對話面板與 CLI 的 `--chat` / `--ai` 都走 `ai/vizbridge.py`。零 pip dependency（四家 provider 皆用 `urllib`）。
- 🧠 **`ai/vizbridge.py`** — 核心引擎：`VizBridge.stream_response()` 驅動 tool-use 迴圈；`ProviderRouter` 分派到四家 provider；`ToolRegistry` 合併 MCP 資料工具與 UI canvas 工具。
- 💬 **`ai/chat_cli.py`** — 終端機 REPL (`--chat` 互動模式) 與一次性查詢 (`--ai "question"`) 入口。共用 `_stream_response()` pretty-printer。
- 🎨 **`ai/ui_tools.py`** — **畫布驅動工具**（VizBridge 專用，不暴露給 MCP）：`vizcode_ui_goto_l0 / _l1 / _l2`、`vizcode_ui_highlight_node`、`vizcode_ui_highlight_path`。回傳 `{action, args, message}` 給前端 dispatch。
- 🌐 **`ai/providers/`** — Anthropic / OpenAI / Gemini / Ollama 四家 provider wrapper（全部 `urllib`，zero pip）。
- 📦 **`ai/install.py`** — 部署 IDE rules（Cursor / Windsurf / Gemini / Copilot）。
- 🔑 **`ai/config.json`** — API keys（gitignored）。由 Web UI 的 `/chat-config` GET/POST 與設定 modal 維護。
- **Web UI 入口**: `static/viz_chat.js` + `static/viz_chat.css`（draggable / resizable 面板、markdown-lite、mermaid inline 渲染、tool badges、SSE 串流）。
- **SSE event contract** (`/chat-stream`): `delta | tool_call | ui_action | done | error`。`ui_action` 由前端 `_dispatchUiAction()` 轉派到 `loadLevel0 / drillToModule / drillToFile / highlightNode / cytoscape dijkstra`。
- **Mermaid 渲染**: chat 泡泡內 ` ```mermaid ` code fence 於訊息 finalise 時 lazy-load CDN 並 inline 渲染為 SVG（不另開視窗）。

### 🟣 Claude Code Skill & MCP (B2/B3)
- 📋 **`.claude/skills/vizcode/SKILL.md`** (Skill)
  - **用途**: 定義 `/vizcode`、`/vizcode --parse`、`/vizcode --ai` 三條執行路徑。
  - `--parse`: 純 AST 掃描 + 開瀏覽器；`--ai`: 掃描 → Claude 語意分析 → 寫入快取；預設: 兩者皆做。
- 📄 **`.mcp.json`** (設定)
  - **用途**: 向 Claude Code 宣告 `vizcode` MCP server。`enableAllProjectMcpServers: true`（在 `.claude/settings.json`）讓 Claude Code 自動核准。
- 📁 **`.local/scan_cache.json`** (快取)
  - **用途**: Parser 層快取（A1）。`entries[filename] → {file_sha, parser_sha, payload: {imports, funcdefs, funccalls}}`。
- 📁 **`.local/semantic_cache.json`** (快取)
  - **用途**: 語意推斷邊快取（B2）。`edges[{source, target, confidence, reason}]`；由 `/vizcode --ai` 填入，MCP server 讀取。

### 🔴 核心分析引擎 (Backend Analysis)
- 🧠 **`analyze_viz.py`** (後端)
  - **用途**: **系統的大腦與心臟**。遍歷資料夾、建立專案依賴圖表 (Nodes & Edges)、產出最終 JSON。
  - **🔄 依賴**: `detector.py` 以及所有的 `parsers/*.py`
- 🕵️ **`detector.py`** (後端)
  - **用途**: 掃描資料夾內的特徵檔案，判斷目前的專案類型 (Python, JS, Go 或 BIOS)。
- 🧩 **`parsers/`** (後端)
  - **用途**: 各獨立語言的解析器，只負責將原始碼轉為統一格式的資料 (Tuple) 交還給 `analyze_viz.py`。
  - `bios_parser.py`: 解析 BIOS 相關檔案 (C/C++, ASM, EDK2, INF, SDL 等)
  - `python_parser.py`: 解析 `.py`
  - `js_parser.py`: 解析 `.js`, `.ts`, `.jsx`, `.tsx`
  - `go_parser.py`: 解析 `.go`
  - `common_parser.py`: **通用 Fallback Parser**，處理所有其他 52 種語言 (Java/Kotlin/Scala/Dart/Swift/ObjC/C#/F#/VB/Ruby/PHP/Perl/Lua/Shell/R/Julia/Rust/Zig/D/Nim/Crystal/Elixir/Erlang/Haskell/OCaml/Elm/Clojure/SQL/GraphQL/Proto 等)；語言感知的 import pattern、正確的 comment stripping、word-boundary 型別偵測。

### 🔵 前端視覺化 (Frontend UI)
- 🖥️ **`launcher.html`** (前端)
  - **用途**: 單頁應用 (SPA) 介面。顯示讀取進度條，並作為畫布的容器。
  - **🔄 依賴**: 載入 `static/` 下的靜態資源。

#### viz.js 模組化架構

`viz.js` 原為一個 ~8000 行的單體檔案，現已拆分為 10 個功能模組 + 1 個 boot 檔。
所有檔案共享同一全域 scope（由 `analyze_viz.py` 串接後注入 `<script>` tag），**不使用 ES modules**。

| 模組檔案 | 行數 | 職責 |
|---------|-----|------|
| `viz_utils.js` | ~150 | 共用工具函式：`escapeHtml`, `showToast`, `showLoading`, `fmtSize`, `_pathDist`, `T()`, `_tC()` 等 |
| `viz_state.js` | ~120 | 可變執行期狀態：`state`, `l2State`, `depMapState`, `codeState`, `cy`, `buildFileIdLookup()` |
| `viz_constants.js` | ~290 | 不可變常數表：`FILE_TYPE_SHAPE`, `EDGE_TYPE_STYLE`, `extColor()`, `LEGEND_EDGES/NODES` |
| `viz_preferences.js` | ~380 | 使用者偏好：`_PREFS`, theme/font/lang, `initPreferences()` |
| `viz_code_panel.js` | ~580 | Code Panel：init/open/close/load, render (code/image/PDF/hex), func bar |
| `viz_office.js` | ~100 | Office 檔案檢視器：xlsx (試算表)、docx (段落)、pptx (投影片)、legacy 下載。`renderOffice()` 由此提供。 |
| `viz_toolbar.js` | ~910 | L1/L2 toolbar, 導航歷史, external toggles, node modal |
| `viz_sidebar.js` | ~650 | Sidebar tabs, file tree, FT_GROUPS, edge filter, node legend, stats |
| `viz_graph.js` | ~2000 | Cytoscape 核心：`initCy`, `CY_STYLE`, highlight, `loadLevel0`→`drillToFile`, `renderL2Flowchart`, `renderFilesFlat()` |
| `viz_galaxy.js` | ~350 | **Galaxy View**：Sigma.js WebGL 全域圖 (L0+L1+L2 整合)。dagre 階層佈局、highlight、tooltip、雙擊導航。API: `openGalaxy()`, `closeGalaxy()` |
| `viz_search.js` | ~1400 | 搜尋系統全部：state, streaming, fuzzy, virtual scroll, `initSearch`, `onSearch` |
| `viz_dashboard.js` | ~310 | Dashboard overlay：Chart.js 圖表, stat strip |
| `viz_layout.js` | ~380 | Layout presets, switcher UI, zoom controls |
| **`viz.js`** (boot) | ~330 | `DOMContentLoaded` boot, tooltip, keyboard (`onKey`), context menu, global tooltip |

- **⚠️ Structure 按鈕**: 優先呼叫 `symViewOpen()`，若檔案無 symbol 才 fallback 到 `svToggleStructView()`。
- 💅 **`static/viz.css`** — 所有介面的視覺外觀定義。
- 🌍 **`static/i18n.js`** — 管理中英雙語的翻譯對照表。
- 🌐 **`static/symbol_view.js`** — Symbol-Centric Graph（以 symbol 為中心的互動式關聯圖）。
  - **Entry points**: `symViewOpen(fileRel)` / `symViewActivate(symId)` / `symViewClose()`。
- 🎨 **`static/symbol_view.css`** — Symbol View 專用樣式。


---

## 🔄 系統核心資料流 (Data Flow Workflow)

當使用者在網頁上輸入路徑並點擊「Analyze」時，整個系統的資料流向如下：

1. **Frontend Request**: 使用者在 `launcher.html` 點擊分析，網頁發送 POST 請求至 `http://localhost:7777/analyze`。
2. **Server Handling**: `server.py` 接收到請求，開啟一個子線程 (Thread)，開始 Server 端的事件串流 (SSE)。
3. **Core Engine Starts**: `server.py` 呼叫 `analyze_viz.py` 的主函式，開始掃描指定的目錄。
4. **Project Detection**: `analyze_viz.py` 先呼叫 `detector.py` 判定專案類型 (如 Python 或 BIOS)。
5. **File Parsing (Dispatch)**: `analyze_viz.py` 讀取每一個檔案，並根據副檔名分發 (Dispatch) 給對應的 `parsers/` 下的模組。
    - 各個 Parser (`xxx_parser.py`) 只需要負責把程式碼轉成統一格式的 Tuple (Imports, FuncDefs, Calls)。
6. **Graph Building**: `analyze_viz.py` 統整所有 Parser 的結果，建立 Nodes (檔案/函式) 和 Edges (依賴/呼叫關係)，轉換成巨大的 JSON 物件。
7. **Frontend Rendering**: `server.py` 將包含 JSON 的 HTML 結果發送回瀏覽器。`launcher.html` 載入後，`static/viz.js` 接手，將 JSON 物件渲染成視覺化的關聯圖。

---

## 🛠️ AI 擴充與修改指南 (Extensibility Guide)

如果你需要新增或修改功能，請嚴格遵守以下對應位置，**不要改錯檔案**：

### 情境 1：新增一種新的程式語言支援 (例如：Java)
> ⚡ **大多數語言已由 `common_parser.py` 自動處理！** 只有需要高精度 AST 解析才需要獨立 parser。

若語言已在 `SCAN_EXT` / `FILE_TYPE_MAP` 中：`common_parser.py` 會自動處理 import/函式/class 提取。只需更新前端即可。

若需獨立 parser：
1. **建立 Parser**: 在 `parsers/` 資料夾下新增 `java_parser.py`，實作 `scan_java(src, ext)` 並回傳標準 6-tuple。
2. **在 `scan_file()` 中分派**: 修改 `analyze_viz.py` 中的 `scan_file()` 加入 `if ext == '.java': result = scan_java(src, ext)`（放在 common fallback 之前）。
3. **`SCAN_EXT` / `FILE_TYPE_MAP`**: 若副檔名還未登錄，才需新增。
4. **專案偵測**: 修改 `detector.py`，加入識別 Java 專案的特徵。
5. **前端樣式**: `viz_constants.js` 的 `extColor()` / `FILE_TYPE_SHAPE` / `FILE_TYPE_FULL_NAME`；`viz_sidebar.js` 的 `FT_GROUPS`。

### 情境 2：修改或修復 BIOS (C/C++/EDK2) 的解析邏輯
- **唯一需要修改的地方**: `parsers/bios_parser.py`。
- `analyze_viz.py` 和 `detector.py` 完全**不需要碰**。BIOS 所有的正規表示式與邊界案例都在這個 parser 裡面。

### 情境 3：修改畫面上節點的顏色、形狀或連線的外觀
- 修改相關的 `static/viz_constants.js` (顏色/形狀/常數表) 或 `static/viz_graph.js` (畫布算圖邏輯) 或 `static/viz.css` (靜態外觀)。

### 情境 4：修改伺服器機制、增加 API Endpoints
- 修改 **`server.py`** 下的 `Handler` class (`do_GET`, `do_POST`)。

### 情境 5：修改終端機操作畫面 (CLI/TUI)
- 修改 **`vizcode.py`** 裡面的 `TUI` 類別 (包含 Banner、動畫、按鍵回應)。

### 情境 6：修改 Claude Code Skill 或 MCP 工具
- **Skill 邏輯** → `.claude/skills/vizcode/SKILL.md`（Claude 讀取這份文件決定如何執行 `/vizcode`）
- **MCP tools 實作** → `mcp_server.py`（`_tool_query / _tool_path / _tool_explain`）
- **語意快取 I/O** → `semantic_enricher.py`（`write_cache / read_cache / is_cache_valid`）
- **MCP server 宣告** → `.mcp.json`（新增/移除工具後需同步更新 `TOOLS` 清單與 JSON Schema）

---

## 💡 統一的 Parser 介面規範

任何在 `parsers/` 下的模組，其 `scan_xxx()` 函式回傳格式：

**標準 5-tuple** (舊格式，BIOS/JS/Go parsers 部分仍使用):
```python
return (
    imports_or_refs,      # list[str]: 這個檔案依賴的外部模組/檔案/字串
    funcdefs,             # list[dict]: [{label, is_efiapi, is_static}, ...]
    funccalls,            # list[str]: 這個檔案呼叫了哪些外部函式
    extra_dict,           # dict | None: 額外 Metadata (BIOS 用，通常 None)
    func_calls_by_func,   # list[list[str]]: 每個 funcdef 對應的呼叫陣列
)
```

**擴充 6-tuple** (全部 5 個 parser 均已實作 ✅，含 common_parser):
```python
return (
    imports_or_refs,
    funcdefs,
    funccalls,
    extra_dict,
    func_calls_by_func,
    symbol_defs,          # list[dict]: [{kind, name, line, end_line, bases, parent, is_public}, ...]
                          # kind: 'class'|'struct'|'interface'|'enum'|'typedef'|'method'|'function'
                          # bases: 繼承的父類名稱 (for inheritance edges)
                          # parent: 所屬的 class 名稱 (None = top-level)
)
```

`analyze_viz.py` 的 `scan_file()` 會偵測 tuple 長度，6-tuple 時自動提取 `symbol_defs` 並存入 `file_symdefs`。`build_graph()` 在 Phase F 統一將所有 `symbol_defs` 組合為 `symbol_index` (dict) 和 `symbol_edges` (list)，注入最終 JSON。

## 🔮 Symbol View 架構備忘 (Phase 1–9)

- **資料來源**: `DATA.symbol_index` (build_graph Phase F 建立) + API `/symbol-graph?job=JID&sym=SID`
- **`/symbol-graph` 回應格式**:
  ```json
  {
    "center": { "id", "name", "kind", "file", "line", "is_public",
                "children": [{id, name, kind, line, end_line, is_public, access_level}] },
    "incoming": [{ "sym": {...}, "edge_type": "call|inheritance|import", "count": N }],
    "outgoing": [{ "sym": {...}, "edge_type": "...", "count": N }]
  }
  ```
- **Compound node 層次**: class card → PUBLIC group → member badges；member 有 `access_level` 分 public/private。
- **Edge 線寬**: `lineWidth = min(1.5 + log2(count), 6)`；count=1 時 1.5px，多條合併時自動加粗。
- **不可拖曳**: `cy.nodes().ungrabify()` 在每次 render 後呼叫。
- **Edge curve**: `taxi`（正交折線，`taxi-turn: 60%`）。
- **Snippet panel** (`#sym-snippet-panel`): click member badge → `/symbol-refs` → 右側 360px 欄；definition 黃框，reference 灰框；navigate 時自動關閉。
- **Symbol edge types**: `call` (橘 #fb923c), `inheritance` (藍 #60a5fa), `import` (綠 #34d399), `member` (紫 #c084fc), `override` (粉 #f472b6), `type_usage` (黃 #fbbf24), `include` (灰 #94a3b8)
- **Phase 7 Edge Filter**: Toolbar pills → `_sym.hiddenEdgeTypes` Set → `edge.style('display','none'/'element')`；filter 在導航時保留，re-render 後 `_symApplyEdgeFilters()` 重新套用。
- **Phase 8 Back/Forward**: `_sym.history`（back stack）+ `_sym.future`（forward stack）；`symViewActivate(id, _fromHistory)` 若為 back/forward 操作不清除 future；`cy.animate({ fit }, {duration:280})` 每次 render 後淡入動畫。
- **`build_html()` 載入順序**: `viz.css` → `themes.css` → `symbol_view.css` → `i18n.js` → `viz_utils.js` → `viz_state.js` → `viz_constants.js` → `viz_preferences.js` → `viz_code_panel.js` → **`viz_office.js`** → `viz_toolbar.js` → `viz_sidebar.js` → `viz_graph.js` → **`viz_sigma.js`** → `viz_search.js` → `viz_dashboard.js` → `viz_layout.js` → **`viz.js`** (boot) → `trail_layouter.js` → **`symbol_view.js`**

## 📊 專案整合記錄 (Integration Log)

### 2026-04-28: 前端渲染效能優化
**問題**: 大型 codebase（2000+ 檔案）渲染時記憶體用量 >2GB，畫布互動卡頓。

**診斷**:
1. `cy.elements()` 重複呼叫（每次呼叫遍歷所有元素建新 Collection，O(n) 成本）
2. `highlightNode()`、`clearHighlight()` 連續呼叫 `cy.elements()` 多次，造成多次 redraw
3. `_spatialPlacementNow()` 的 label 重疊檢測為 O(n²)（線性掃描 `placed[]` 陣列）
4. CY_STYLE 中 edge 的 CSS `transition-*` 屬性，為每條邊建立動畫計時器
5. `edge:selected` 的 `shadow-*` 屬性在 Canvas 上渲染成本高
6. `min-zoomed-font-size: 0` 強制渲染所有縮放級別的文字

**已實施優化**:
1. ✅ **批次操作**: `highlightNode()`, `highlightNodes()`, `clearHighlight()`, `_resetGraphHighlightPreservingPin()`, `_applyGraphIsolateState()` 均用 `cy.batch()` 包裹，單次 `cy.elements()` 呼叫後批次修改 class，避免多次 redraw。
2. ✅ **空間網格**: `_spatialPlacementNow()` 改用 80px 網格（`Map<cellKey, [bb]>`）快速查找鄰居，重疊檢測從 O(n²) 降至 O(n)（平均）。
3. ✅ **移除 CSS transition**: `edge` 樣式不再有 `transition-property/duration/timing-function`，節省每條邊的計時器。
4. ✅ **移除 shadow**: `edge:selected` 不再有 `shadow-blur/shadow-color/shadow-opacity`，降低 Canvas 渲染成本。
5. ✅ **調整 min-zoomed-font-size**: 節點預設從 `0` 改為 `4`，低縮放時不渲染看不見的文字。
6. ✅ **既有節點/邊限制保持**:
   - L0 module_edges: 300 條（按 weight 排序）
   - L1 nodes: 250 個（visible files），edges: 600 條
   - L2 callers/callees (showFuncView): 各 8 個

**預期效果**:
- 記憶體用量降低 40–60%（避免多餘集合建立、計時器、shadow 渲染緩衝區）
- highlightNode 互動延遲從 ~150ms 降至 ~30ms（批次操作 + 單次 redraw）
- label placement 速度提升 10–50x（空間網格 O(n) vs 線性掃描 O(n²)）

---

### 2026-04-28: L0/L1 相機位置修復 & Galaxy too-large 按鈕修復
**Bug 1 — L1 → L0 返回時相機未 fit**
- **根因**: `applyLayoutWithCache()` cache hit 路徑設定 `fit: false`，且 `onStop(true)` 僅呼叫 `showLoading(false)`，沒有呼叫 `cy.fit()`，導致從 L1 返回 L0 時相機停在 L1 的位置。
- **修復**: `static/viz_layout.js` — `applyLayoutWithCache` cache hit 的 `layoutstop` callback 加入 `cy.animate({ fit, padding: 40, duration: 350 })`。

**Bug 2 — Galaxy too-large 時頂部按鈕未亮**
- **根因**: `static/galaxy/viz_galaxy.js` 的 too-large 分支只做了 `container.classList.add('active')` 然後 `return`，從未設定 `state.galaxyActive = true` 也未呼叫 `syncTopbarModeButtons()`，導致 `getTopbarMode()` 回傳 `'graph'`，galaxy-btn 不亮，使用者無法切回主圖。
- **修復**: too-large 分支在 `return` 之前加入 `state.galaxyActive = true` 與 `syncTopbarModeButtons()` 呼叫。

---

### 2026-04-28: Tooltip 簡略模式優化
**改動**: L0/L1/L2 hover 提示框改為兩段式設計。

**行為**:
- **hover 到 node** → 顯示 `#tooltip`，預設只顯示 `.tip-brief`（**僅檔名/模組名**），位置在鼠標右下角 +32px offset（原為 +14px）。
- **hover 到提示框** → CSS `:hover` 切換：`.tip-brief` 隱藏，`.tip-full` 展開完整內容（路徑、meta data、dependencies）。

**修改位置**:
- `static/viz.js` — `showTooltip()` 末段：計算 `briefName`（按 `_t` type 取檔名/模組名），HTML 結構改為 `<div class="tip-brief">...</div><div class="tip-full">全部舊內容</div>`；offset `+14` → `+32`。
- `static/viz.css` — `#tooltip` 加入 `.tip-brief`、`.tip-full` class 規則；`#tooltip:hover` 時反轉顯示。

---

### 2026-04-23: NotebookLM 整合
- **安裝套件**: `notebooklm-py[browser]`, `playwright`, `yt-dlp`
- **功能**: 可使用 NotebookLM API 建立筆記本、新增來源（包括 YouTube 影片）、AI 分析

- **使用方式**:
  ```bash
  # CLI 模式
  python -m notebooklm use <notebook_id>
  python -m notebooklm ask "問題"
  
  # Python API
  from notebooklm import NotebookLMClient
  async with await NotebookLMClient.from_storage() as client:
      result = await client.chat.ask(notebook_id, "問題")
  ```

---

## 📜 備忘：BIOS 的 Edge Type 與顏色定義
(保留這部分是因為 BIOS 結構過於龐大，常需要除錯)
- Includes (`#include`): `#c084fc` (紫色)
- Sources (`[Sources]`): `#ffd700` (金色)
- Packages (`[Packages]`): `#00d4ff` (青色)
- LibraryClasses: `#a78bfa` (淺紫)
- Components: `#60a5fa` (藍色)
- Guid/Protocol Ref: `#fb923c` (橘色)
- String Ref (`.uni`): `#e879f9` (粉紅)
- VFR/HFR Callbacks: `#f87171` (紅色)
