# VIZCODE — Symbol View 功能路線圖

> 目標：在 VIZCODE 的 L0/L1/L2 框架不動的前提下，實作 Symbol-Centric 功能。
> Structure 按鈕 → 進入 Symbol View（`#sym-view`，`position:absolute; inset:0` 在 `#graph-wrap` 內）

---

## 一、Symbol View Node Types

| Symbol Kind | VIZCODE kind | 狀態 |
|----------------------|--------------|------|
| `NODE_CLASS` | `class` | ✅ |
| `NODE_STRUCT` | `struct` | ✅ |
| `NODE_INTERFACE` | `interface` | ✅ |
| `NODE_ENUM` | `enum` | ✅ |
| `NODE_TYPEDEF` | `typedef` | ✅ |
| `NODE_FUNCTION` | `function` | ✅ |
| `NODE_METHOD` | `method` | ✅ |
| `NODE_FIELD` | `field` | ✅ |
| `NODE_ENUM_CONSTANT` | `enum_constant` | ✅ |
| `NODE_NAMESPACE` | `namespace` | ❌ 未實作 |
| `NODE_GLOBAL_VARIABLE` | `global_var` | ❌ 未實作 |
| `NODE_MACRO` | `macro` | ❌ 未實作 |
| `NODE_UNION` | `union` | ❌ 未實作 |
| `NODE_TYPE_PARAMETER` | `type_param` | ❌ 未實作（Template/Generic） |
| `NODE_ANNOTATION` | `annotation` | ❌ 未實作 |
| `NODE_BUILTIN_TYPE` | `builtin` | ❌ 不計畫實作 |
| `NODE_FILE` | — | ❌ 不計畫（用 VIZCODE L1 代替） |
| `NODE_MODULE` / `NODE_PACKAGE` | — | ❌ 不計畫（用 VIZCODE L0 代替） |

### Edge Types

| Edge Type | VIZCODE type | 狀態 |
|----------------------|--------------|------|
| `EDGE_CALL` | `call` | ✅ |
| `EDGE_INHERITANCE` | `inheritance` | ✅ |
| `EDGE_MEMBER` | `member` | ✅ |
| `EDGE_IMPORT` | `import` | ✅ |
| `EDGE_TYPE_USAGE` | `type_usage` | ✅ |
| `EDGE_OVERRIDE` | `override` | ✅ |
| `EDGE_INCLUDE` | `include` | ✅ |
| `EDGE_BUNDLED_EDGES` | — | ✅ 由 Phase 4 視覺表示 |
| `EDGE_TYPE_ARGUMENT` | `type_argument` | ❌ 未實作（Template） |
| `EDGE_TEMPLATE_SPECIALIZATION` | `specialization` | ❌ 未實作（Template） |
| `EDGE_MACRO_USAGE` | `macro_usage` | ❌ 未實作 |
| `EDGE_ANNOTATION_USAGE` | `annotation_usage` | ❌ 未實作 |
| `EDGE_USAGE` | `usage` | ❌ 未實作 |

### Graph Node 類型

| 節點元件 | VIZCODE 對應 | 狀態 |
|---------------------|-------------|------|
| Class Card（base） | Cytoscape node | ✅ |
| Access Section（PUBLIC/PRIVATE section header） | `isGroup:true` compound child | ✅ |
| Member Badge（member badge） | member badge node | ✅ |
| Expand Toggle（▼/▲ 按鈕） | toggle badge | ✅ |
| Bundle Node（N nodes 折疊為一個圓形 badge） | ❌ BundleNode 未實作 | ❌ |
| Group Node（NAMESPACE/FILE/INHERITANCE 分組框） | ❌ GroupNode 未實作 | ❌ |
| Qualifier Node（虛線框顯示 parent namespace） | ❌ 未實作 | ❌ |
| Text Node（純文字說明節點） | ❌ 未實作 | ❌ |

### Group Types

| GroupType | 用途 | 狀態 |
|-----------|------|------|
| `DEFAULT` | 普通分組框 | ❌ |
| `FRAMELESS` | 無框分組（VIZCODE 的 PUBLIC/PRIVATE section 概念） | ✅ 概念上有 |
| `FILE` | 以檔案為邊界的分組框 | ❌ |
| `NAMESPACE` | 以 namespace 為邊界 | ❌ |
| `INHERITANCE` | 繼承鏈的視覺分組 | ❌ |

---

## 二、已完成的 Phase（Phase 1–9）

| Phase | 功能 | 說明 |
|-------|------|----------------------|
| **1** | Symbol Index | 統一 symbol table（`symbol_index` + `symbol_edges`） |
| **2** | Symbol-Centric Graph 基礎 | Graph View 以 symbol 為中心重新佈局，`symViewOpen/Activate/Close` |
| **3** | Compound Class Card + TrailLayouter | PUBLIC/PRIVATE section compound node + Sugiyama 8-stage 佈局 |
| **4** | Bundled Edges | log2 寬度，×N label，edge click tooltip |
| **5** | Multi-file Code Snippets | Code View 右側顯示跨檔案 def/ref 片段，taxi curve edges |
| **6** | Node Expand/Collapse | ▼/▲ 按鈕，折疊後顯示 class 名稱 |
| **7** | Edge Type Filtering | Graph View toolbar：toggle 各 edge type pill，跨導航保留 filter state |
| **8** | Back/Forward + 動畫 | 全域導航 history/future stack，280ms ease-out-cubic zoom-to-fit |
| **9** | 擴充 Node Types | struct/interface/enum/typedef，`«stereotype»` 前綴，CSS 顏色區分 |

---

## 三、待實作的 Phase

### Phase 10：Bundle Node

**設計目標：**
當 center node 的 incoming/outgoing 鄰居超過閾值時，多餘的同類 symbol 被折疊為一個帶圓形數字徽章的 Bundle Node。點擊 Bundle Node → 展開顯示所有隱藏節點。

**VIZCODE 實作目標：**
- `symbol_view.js`：若 incoming 或 outgoing 超過 `BUNDLE_THRESHOLD`（=8），多出的同類 node 折疊為一個 `isBundleNode:true` 的特殊節點
- Bundle Node 樣式：圓形，直徑 48px，中央顯示 `×N`，顏色同所屬 kind
- 點擊 Bundle Node → `_symExpandBundle(bundleId)` → 展開隱藏節點（重繪）
- 後端 `/symbol-graph` 需新增 `"bundled": true` flag 當鄰居數超過閾值

---

### Phase 11：Namespace / File GroupNode

**設計目標：**
多個 symbol 若屬於同一 namespace 或同一 file，在圖中被一個半透明的圓角框包覆。

**VIZCODE 實作目標：**
- 若多個 incoming/outgoing neighbor 屬於同一檔案，以 Cytoscape compound parent 包覆它們
- 顯示檔案名稱作為 group label（左上角）
- 點擊 group header → 呼叫 `loadFileInPanel`
- GroupNode 的 kind 為 `file`，樣式：dashed border，背景半透明

---

### Phase 12：Template / Generic 關係

**設計目標：**
C++ template 的 `TYPE_ARGUMENT` 和 `TEMPLATE_SPECIALIZATION` 都以虛線邊顯示。

**VIZCODE 實作目標：**
- `bios_parser.py`：解析 `template<>` 宣告，產生 `type_argument` / `specialization` symbol_edges
- `symbol_view.js`：`type_argument` edge 用虛線橙色，`specialization` 用虛線紫色
- Edge type filter pill 新增這兩種類型

**優先度：低**（C++ only，regex 解析難度高）

---

### Phase 13：Reference Count Badges

**設計目標：**
每個 symbol 節點右下角顯示「被引用次數」的小圓形徽章。

**VIZCODE 實作目標：**
- 後端 `/symbol-graph` 回應利用現有 `total_in/total_out` 欄位
- `symbol_view.js`：為每個 neighbor node 在右下角加 `isRefBadge:true` 子節點，顯示 `↙ N`
- 樣式：14×14px 圓形，白字，深灰背景

**優先度：低**

---

## 四、關鍵檔案清單

### 後端

| 檔案 | 角色 |
|------|------|
| `vizcode.py` | CLI launcher + TUI 動畫 |
| `server.py` | HTTP server port 7777；`/symbol-graph`, `/symbol-refs`, `/symbols` |
| `analyze_viz.py` | 核心引擎；Phase F 建構 `symbol_index` + `symbol_edges` |
| `detector.py` | 專案類型偵測 |
| `parsers/python_parser.py` | Python：6-tuple，symbol_defs，is_public 正確 |
| `parsers/bios_parser.py` | C/C++/UEFI：6-tuple，symbol_defs（struct/typedef/enum） |
| `parsers/js_parser.py` | JS/TS：6-tuple，symbol_defs（class/interface/enum/typedef） |
| `parsers/go_parser.py` | Go：6-tuple，symbol_defs（struct/interface/function） |

### 前端（`static/`）

| 檔案 | 角色 |
|------|------|
| `viz.js` | 主前端（~7600 行）；Structure 按鈕呼叫 `symViewOpen()` |
| `viz.css` | 主 stylesheet |
| `symbol_view.js` | Symbol View 核心邏輯（compound nodes，TrailLayouter 整合） |
| `symbol_view.css` | Symbol View 樣式（`#sym-view`, `.kind-*`, `.sym-snippet-*`） |
| `trail_layouter.js` | Sugiyama layout engine（8-stage 階層佈局）|
| `struct_view.js` | 舊版 Structure View（fallback 路徑） |
| `i18n.js` | 中英雙語翻譯 |
| `themes.css` | 主題樣式 |

> **JS 載入順序**（`build_html()` 的 `js_assets`）：
> `i18n.js` → `viz.js` → `struct_view.js` → `trail_layouter.js` → `symbol_view.js`

---

## 五、全域狀態速查

```js
window.DATA
  .symbol_index   // { symId: { id, name, kind, file, line, is_public, parent, children, module } }
  .symbol_edges   // [ { from, to, type } ]  types: call|inheritance|type_usage|import|override|include|member
  .funcs_by_file  // { "rel/path.py": [ { label, is_public, is_efiapi } ] }

// symbol_view.js 模組頂層 const（非 window 全域）
_sym = {
  active:          null,   // current center symId
  history:         [],     // Back stack
  future:          [],     // Forward stack
  cy:              null,   // Cytoscape instance in #sym-cy
  collapsed:       Set,    // collapsed card node IDs
  hiddenEdgeTypes: Set,    // filtered-out edge types
  jobId:           null,
  ready:           false,
}
```

---

## 六、Parser 介面（6-tuple）

```python
return (
    imports_or_refs,    # list[str]
    funcdefs,           # list[dict]: [{label, is_efiapi, is_static}]
    funccalls,          # list[str]
    extra_dict,         # dict | None
    func_calls_by_func, # list[list[str]]
    symbol_defs,        # list[dict]: [{name, kind, line, end_line, parent, bases, is_public}]
                        # kind: class|method|function|field|struct|enum|interface|typedef|enum_constant
)
```

---

## 七、Server API 速查

| Endpoint | 說明 |
|----------|------|
| `POST /analyze` | 開始分析，SSE 回傳 job_id |
| `GET /result?job=JID` | 完整分析結果 JSON |
| `GET /file?path=...` | 讀取原始碼 |
| `GET /symbols?job=JID&query=...&kind=...` | Fuzzy symbol 搜尋 |
| `GET /symbol-graph?job=JID&sym=SID` | Symbol-centric 子圖（center + incoming + outgoing） |
| `GET /symbol-refs?job=JID&sym=SID` | Symbol 所有引用位置 |
| `GET /search-stream?job=JID&q=...` | 串流全文搜尋（SSE） |
| `GET /structure?job=JID&file=...` | 檔案結構（供 struct_view.js） |

`/symbol-graph` 回應格式：
```json
{
  "center":   { "id", "name", "kind", "file", "line", "is_public", "module",
                "children": [{ "id", "name", "kind", "line", "end_line", "is_public", "access_level" }] },
  "incoming": [{ "sym": {...}, "edge_type": "call|...", "count": N }],
  "outgoing": [{ "sym": {...}, "edge_type": "...", "count": N }],
  "total_in": N, "total_out": N
}
```

---

## 八、已知 Tech Debt

| 問題 | 檔案 | 說明 |
|------|------|------|
| Dotted import 解析失敗 | `analyze_viz.py` / parsers | `from core.engine import Engine` → `file_edges_by_module` 空 |
| Structure View arrows 不重繪 | `struct_view.js` | resize 後箭頭位置不更新，無 ResizeObserver |
| C/C++ `end_line` 不準確 | `bios_parser.py` | `end_line = line_no`（未掃 `}` 結尾） |

---

## 九、TrailLayouter 內部設計備忘

| 設計概念 | 對應實作位置 |
|----------|-----------------|
| Node kind 定義 | `viz_constants.js` `FILE_TYPE_SHAPE` |
| Edge type 定義 | `viz_constants.js` `EDGE_TYPE_STYLE` |
| Group type 定義 | `symbol_view.js` compound node 分組邏輯 |
| Bundle Node 渲染 | `symbol_view.js` `isBundleNode` 路徑（Phase 10 待實作）|
| Group Node 渲染 | `symbol_view.js` compound parent 路徑（Phase 11 待實作）|
| Access section 渲染 | `symbol_view.js` `__public` / `__private` group nodes |
| Expand Toggle 渲染 | `symbol_view.js` `isToggle` badge |
| Sugiyama 佈局算法 | `trail_layouter.js` 8-stage 主邏輯 |
| Access level 定義 | `analyzer_viz.py` → `access_level` 欄位 |
| DummyNode 資料結構 | `trail_layouter.js` `insertVirtualNodes()` |
