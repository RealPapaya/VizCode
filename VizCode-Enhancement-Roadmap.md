# VizCode Enhancement Roadmap — AI Layer & Agent Integration

> 日期：2026-04-10
> 版本：v0.1（內部規劃文件）
> 範圍：持久化快取 · AI 語意增強（選配）· MCP Agent 整合

---

## 背景與動機

VizCode 目前的核心優勢明確：零依賴、符號級精確度、L0/L1/L2 三層互動導航、Symbol View、BIOS/EDK2 特殊支援。這些是純 AST 靜態分析能做到最好的地方，不需要改。

但有兩個問題在大型 repo 上會逐漸變成痛點：

1. **每次 scan 都是全量重建**：101 個檔案的 repo 改了一個函數，整個圖要重跑。
2. **AST 邊沒有語意分層**：`import` 和「這個模組在架構上負責 X」是不同層次的資訊，目前全部混在一起，也無法讓 AI agent 查詢圖譜。

本文件規劃兩條平行開發線，解決這兩個問題，同時不破壞現有的零依賴特性。

---

## 現有架構快照

```
vizcode.py          ← TUI 入口
server.py           ← HTTP server (:7777)
analyze_viz.py      ← 核心掃描引擎
detector.py         ← 專案類型偵測
parsers/
  python_parser.py
  js_parser.py
  go_parser.py
  bios_parser.py
  common_parser.py  ← 50+ 語言 fallback
static/
  viz.js / viz.css
  viz_graph.js      ← Cytoscape 圖引擎
  viz_search.js
  viz_galaxy.js     ← WebGL Galaxy View
  symbol_view.js
```

目前的分析結果是單次計算後注入 HTML，無持久狀態，無法跨 session 查詢。

---

## 線 A｜持久化快取 + 邊分類

### A1 — `graph_store.py`

在 `analyze_viz.py` 完成掃描後，把結果序列化成 `vizcode-out/scan_cache.json`。

**快取結構（每個檔案一個 entry）：**

```json
{
  "version": 1,
  "scanned_at": "2026-04-10T08:00:00Z",
  "files": {
    "analyze_viz.py": {
      "sha256": "a3f9...",
      "nodes": [...],
      "edges": [...]
    }
  }
}
```

重跑時的邏輯：

```python
for file in project_files:
    current_hash = sha256(file)
    if cache.get(file) and cache[file]["sha256"] == current_hash:
        reuse_cached(file)
    else:
        rescan(file)
        update_cache(file, current_hash)
```

對 `testproject/` 這類目錄，`detector.py` 應標記為 `role: "test_fixture"`，讓後續分析可以選擇性跳過或降權。這解決了「demo 程式碼污染主圖」的問題。

### A2 — 邊分類標籤

目前所有邊在圖裡地位相同。加入 `kind` 欄位：

| kind | 含義 | 來源 |
|------|------|------|
| `import` | 靜態 import/include，100% 確定 | AST |
| `call` | 函數呼叫，靜態可見 | AST |
| `inherit` | 繼承關係 | AST |
| `inferred` | AI 推斷的語意關係 | LLM（選配） |

前端在 L1/L2 View 用顏色和線型區分：實線 = 靜態確定，虛線 = 推斷。Tooltip 顯示依據。

---

## 線 B｜AI 語意層（選配）

### B1 — `semantic_enricher.py`

**設計原則：AI 是增強層，不是核心依賴。**

```
python vizcode.py              # 純 AST，零成本，現有行為不變
python vizcode.py --ai         # 啟用語意增強，需要 LLM API key
```

啟用後的流程：

```
AST 掃描完成
    ↓
semantic_enricher.py 接手
    ↓
對每個模組的 docstring + 函數簽名批次送 LLM
    ↓
LLM 回傳：「這個模組負責 X，與 Y 有語意關聯」
    ↓
寫入 scan_cache.json，kind = "inferred"，附 confidence score
    ↓
低於門檻（預設 0.7）的邊不寫入
```

LLM 呼叫用批次模式，同一個 session 內不重複呼叫已快取的模組。每次分析結束後報告：

```
[VizCode] AI 語意分析完成
  靜態邊：1,204 條
  推斷邊：87 條（confidence ≥ 0.7）
  略過：23 條（低於門檻）
  LLM 呼叫：14 次（快取命中：61 個模組）
```

**需要特別過濾的輸入類型：**

- SVG icon 檔案（純圖形，無語意可提取）→ 直接跳過，只記 `type: "asset"`
- 自動生成的程式碼（lock files, build artifacts）→ `detector.py` 標記後略過
- `test_fixture` 角色的目錄 → 預設不送入語意分析，除非加 `--include-tests`

### B2 — MCP stdio server

新增 `mcp_server.py`，實作 MCP 協議的 stdio transport，讓 Claude Code 等 agent 可以直接查詢 VizCode 的圖譜。

**暴露三個 tool：**

```python
vizcode_query(question: str) -> str
# 自然語言問圖譜結構
# 範例："什麼模組依賴 build_graph？"

vizcode_path(source: str, target: str) -> list[str]
# 兩個符號之間的最短依賴路徑
# 範例：vizcode_path("server.py", "python_parser.py")

vizcode_explain(symbol: str) -> str
# 解釋某個符號在整個 codebase 中的角色
# 範例：vizcode_explain("analyze_viz.scan_file")
```

啟動方式：

```bash
python mcp_server.py --cache vizcode-out/scan_cache.json
```

Claude Code 的 `CLAUDE.md` 加入：

```markdown
## VizCode MCP
當需要理解這個 repo 的結構時，優先使用 vizcode_query / vizcode_path / vizcode_explain，
而不是直接讀原始碼。
```

這樣 agent 在做 code review 或架構分析時，可以用一次 tool call 取得結構資訊，而不是消耗大量 context 讀原始碼。

---

## 開發順序與時程估算

```
Week 1-2   A1  graph_store.py + 增量快取邏輯
Week 2-3   A2  邊分類標籤 + 前端顏色區分
Week 3-5   B1  semantic_enricher.py（--ai 模式）
Week 5-6   B2  mcp_server.py
```

A1 是所有後續功能的地基，必須先做。B2 的查詢品質取決於 B1 的語意邊品質，所以 B1 先於 B2。

---

## 不做的事（刻意邊界）

- **跨內容類型**（PDF、圖片）：VizCode 是 code-first 工具，不試圖處理非程式碼內容
- **社群偵測**：Louvain/Leiden 在異質圖上碎片化嚴重，先觀察 A2 的邊分類能否提供足夠的結構洞察
- **獨立知識圖報告**：輸出格式保持以視覺化為主，不做純文字的分析報告

---

## VizCode 的不可取代優勢（需要持續強化）

1. **符號級精確度**：完整的 L2 call-flow，有 `source_location`，可以直接跳到原始碼
2. **互動式導航**：點擊展開、drill-down、history back/forward，這是靜態圖報告做不到的
3. **Symbol View**：以符號為中心的 ego graph，是本工具獨有的分析視角
4. **BIOS/EDK2 支援**：特殊 domain 優勢，持續維護
5. **零成本核心**：不啟用 `--ai` 的情況下，完全不依賴 LLM，本地離線可用
