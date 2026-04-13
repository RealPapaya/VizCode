# VizCode Enhancement Roadmap — Claude Code Skill & MCP Integration

> 日期：2026-04-13
> 版本：v0.3（內部規劃文件）
> 範圍：移除獨立 API 路徑 · Claude Code Skill · MCP Agent 整合

---

## 本次最重要的事：移除獨立 API 路徑

B1 實作完成後，經過評估決定移除透過獨立 Anthropic API key 呼叫 LLM 的整條路徑。原因：

1. 使用者需要自備 API key、設環境變數、自行承擔 token 費用，門檻過高
2. 有 Claude Code 訂閱的使用者不需要額外 API key，借用 Claude Code 自身的 context 即可
3. 兩條路並存會讓使用介面複雜，與「操作極簡化」的設計原則衝突

**需要刪除的內容：**

| 檔案 | 刪除內容 |
|------|---------|
| `semantic_enricher.py` | 所有 `_call_llm` / `_build_prompt` / API 呼叫邏輯，保留模組架構供 skill 模式填入結果 |
| `vizcode.py` | `--ai` / `--ai-threshold` / `--ai-model` / `--include-tests` 這四個 flag |
| `analyze_viz.py` | `ai_opts` 參數、`semantic` 進度階段（96–99%）、`meta.semantic_stats` |
| `server.py` | `/analyze` 接收 `ai_opts` 的部分、`_run_analysis_thread` 夾帶 `ai_opts` |

**保留的內容：**

| 檔案 | 保留原因 |
|------|---------|
| `parse_memo.py` | A1 快取，與 AI 無關，繼續使用 |
| `EDGE_TYPES['inferred']` | 前端虛線樣式已就緒，B2 skill 模式會寫入推斷邊 |
| `semantic_enricher.py` 模組骨架 | B2 skill 把語意分析結果格式化後透過此模組寫入快取 |
| `.local/semantic_cache.json` schema | B2 寫入格式不變，B3 MCP server 直接讀取 |

---

## 使用模式總覽

VizCode 支援兩個介面、四種使用情境：

**不在 Claude 底下（現有）**

| 啟動方式 | 瀏覽器 | AI 語意 | MCP | 目標使用者 |
|----------|--------|---------|-----|------------|
| `launch.bat` | ✓ | ✗ | ✗ | 想自己視覺化讀懂 codebase |

**Claude Code 底下（新增）**

| 指令 | 瀏覽器 | AI 語意 | MCP | 目標使用者 |
|------|--------|---------|-----|------------|
| `/vizcode --parse` | ✓ | ✗ | ✗ | 在 Claude 環境但只想自己看圖 |
| `/vizcode --ai` | ✗ | ✓ | ✓ | 讓 AI 理解 codebase，省後續 token |
| `/vizcode` | ✓ | ✓ | ✓ | 自己看 + AI 同時理解 |

**設計原則：**
- `/vizcode --parse` 與 `launch.bat` 行為完全一致，分析完自動開瀏覽器
- `/vizcode --ai` 不開瀏覽器，語意分析結果寫入快取供 MCP server 使用
- `/vizcode`（預設）兩者都做，自動開瀏覽器 + 啟動 MCP server
- 所有指令操作極簡，無需額外參數，不需要 API key

---

## 現有架構快照（清除 API 路徑後）

```
vizcode.py          ← TUI 入口（移除 --ai 相關 flag）
server.py           ← HTTP server (:7777)（移除 ai_opts）
analyze_viz.py      ← 核心掃描引擎（移除 semantic 階段）
detector.py         ← 專案類型偵測
parse_memo.py       ← 檔案層快取（A1，保留）
semantic_enricher.py← 語意快取寫入模組（清除 API 呼叫，保留架構）
parsers/
  python_parser.py
  js_parser.py
  go_parser.py
  bios_parser.py
  common_parser.py  ← 50+ 語言 fallback
static/
  viz.js / viz.css
  viz_graph.js      ← Cytoscape 圖引擎（inferred 邊虛線已支援）
  viz_search.js
  viz_galaxy.js     ← WebGL Galaxy View
  symbol_view.js
.local/
  scan_cache.json   ← parser 層快取（A1）
  semantic_cache.json← 語意快取（由 B2 skill 寫入）
```

---

## 線 B（續）｜Claude Code Skill + MCP

### B2 — Claude Code Skill

新增 `.claude/skills/vizcode/SKILL.md`，定義 `/vizcode` 的觸發行為。

**三條執行路徑：**

```
/vizcode --parse
    └─▶ python vizcode.py <path>
          └─▶ 純 AST 掃描 → 寫入 scan_cache.json → 開瀏覽器

/vizcode --ai
    └─▶ python vizcode.py <path> --scan-only
          └─▶ 純 AST 掃描 → 寫入 scan_cache.json
    └─▶ Claude Code 讀取 scan_cache.json
          └─▶ 分析模組語意角色與關聯
          └─▶ 透過 semantic_enricher.write_cache() 寫入 semantic_cache.json
    └─▶ python mcp_server.py（背景啟動）
    └─▶ 不開瀏覽器

/vizcode（預設）
    └─▶ 同 --ai 路徑
    └─▶ 額外開瀏覽器（瀏覽器顯示靜態邊 + 推斷邊虛線）
```

**新增 `vizcode.py` 的 `--scan-only` flag：**

只做 AST 掃描並寫入 `scan_cache.json`，不觸發任何 LLM 呼叫，不開瀏覽器。供 SKILL.md 在語意分析前呼叫。

**SKILL.md 核心內容：**

```markdown
## 觸發條件
使用者輸入 /vizcode、/vizcode --parse、或 /vizcode --ai

## --parse 模式
1. 執行 python vizcode.py <path>
2. 回報：分析完成，瀏覽器已開啟 http://localhost:7777

## --ai 模式
1. 執行 python vizcode.py <path> --scan-only
2. 讀取 .local/scan_cache.json，取得每個模組的 imports / funcdefs / extras
3. 針對每個模組分析：這個模組負責什麼、與哪些模組有語意關聯、關聯的理由
4. 呼叫 semantic_enricher.write_cache() 寫入推斷邊（含 confidence）
5. 執行 python mcp_server.py（背景）
6. 回報統計：靜態邊 N 條，推斷邊 N 條，MCP server 已就緒

## 預設模式（無 flag）
同 --ai 模式，最後額外開瀏覽器

## 快取判斷
semantic_cache.json 存在且模組 hash 未變時，跳過語意分析直接使用快取
```

**`semantic_enricher.py` 保留的介面：**

API 呼叫邏輯全部刪除，只保留讀寫快取的函式供 SKILL.md 使用：

```python
def write_cache(project_root, inferred_edges: list[dict]) -> None:
    """
    inferred_edges 格式：
    [
      {
        "source": "analyze_viz.py",
        "target": "python_parser.py",
        "confidence": 0.88,
        "reason": "analyze_viz 呼叫 python_parser 做 AST 提取，語意上是編排者與執行者的關係"
      },
      ...
    ]
    寫入 .local/semantic_cache.json
    """

def read_cache(project_root) -> list[dict]:
    """讀取現有推斷邊，供 MCP server 和瀏覽器使用"""

def is_cache_valid(project_root, scan_cache: dict) -> bool:
    """比對 semantic_cache 的模組 hash 與 scan_cache，判斷是否需要重新分析"""
```

---

### B3 — MCP stdio server

新增 `mcp_server.py`，實作 MCP 協議的 stdio transport。

**自動啟動：**

`/vizcode` 和 `/vizcode --ai` 完成後，SKILL.md 在背景執行：

```bash
python mcp_server.py --scan .local/scan_cache.json --sem .local/semantic_cache.json
```

若 port 已佔用，跳過啟動直接使用現有 server。

**三個 tool：**

```python
vizcode_query(question: str) -> str
# 回傳摘要子圖，格式：
# 模組名 → 關係類型 → 模組名（confidence）
# reason: ...
# 不回傳 raw funcdefs / funccalls 內容

vizcode_path(source: str, target: str) -> list[str]
# 只回傳路徑上的模組名列表
# 範例：["server.py", "analyze_viz.py", "python_parser.py"]
# 不帶任何 payload

vizcode_explain(symbol: str) -> str
# 回傳：該模組角色摘要（一段話）+ 直接相連模組名
# 不回傳完整 funcdefs / funccalls 原始內容
```

**自動注入 CLAUDE.md：**

安裝 skill 時，同步在專案的 `CLAUDE.md` 加入：

```markdown
## VizCode
當需要理解這個 repo 的結構時，優先使用 MCP tool vizcode_query / vizcode_path / vizcode_explain，
而不是直接讀原始碼。這可以大幅減少 token 消耗。
禁止直接讀取 scan_cache.json 或 semantic_cache.json 原始檔案。
```

---

## 開發順序

```
已完成   A1  parse_memo.py（per-file 快取）
已完成   A2  邊分類標籤（import/call/inherit/inferred）
已完成   B1  semantic_enricher.py（API 版，現在清除 API 部分）

下一步
  Step 1  清除 API 路徑（見本文件第一節）
  Step 2  B2  SKILL.md + --scan-only flag + semantic_enricher 保留介面
  Step 3  B3  mcp_server.py（三個 tool + 自動啟動）
```

Step 1 必須先做，確保清除乾淨後再疊加 B2/B3，避免兩條路徑的邏輯互相干擾。

---

## 不做的事（刻意邊界）

- **獨立 API key 模式**：已移除，不再支援
- **跨內容類型**（PDF、圖片、影片）：VizCode 是 code-first 工具
- **社群偵測**：待 B3 完成後評估語意邊品質再決定
- **多平台支援**（Cursor、Codex 等）：先專注 Claude Code

---

## VizCode 的不可取代優勢

1. **符號級精確度**：完整的 L2 call-flow，有 `source_location`，可以直接跳到原始碼
2. **互動式導航**：點擊展開、drill-down、history back/forward，靜態圖報告做不到
3. **Symbol View**：以符號為中心的 ego graph，本工具獨有
4. **BIOS/EDK2 支援**：特殊 domain 優勢，持續維護
5. **零成本核心**：`launch.bat` 和 `/vizcode --parse` 完全不依賴 LLM，離線可用
6. **Token 節省**：`/vizcode --ai` 讓 Claude Code 一次理解整個 codebase，後續對話大幅減少 context 消耗
7. **無需 API key**：只需要 Claude Code 訂閱，零額外設定
