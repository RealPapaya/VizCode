# PARITY.md — CodeViz 功能差距追蹤

> 對標：CodeViz 2.0.7 Symbol-Centric 功能
> 更新時間：2026-04-04

---

## Symbol View（`symbol_view.js`）

### Node Types

| 功能 | 狀態 | Phase |
|------|------|-------|
| class / struct / interface / enum / typedef | ✅ 已實作 | P9 |
| function / method / field / enum_constant | ✅ 已實作 | P1 |
| Compound Class Card（PUBLIC/PRIVATE sections） | ✅ 已實作 | P3 |
| ExpandToggle（▼/▲） | ✅ 已實作 | P6 |
| Bundle Node（×N 折疊超過閾值的鄰居） | ❌ 未實作 | P10 |
| Namespace / File GroupNode（半透明框） | ❌ 未實作 | P11 |
| namespace / global_var / macro / union | ❌ 未實作 | — |
| template type_parameter / annotation | ❌ 不計劃（低優先） | — |

### Edge Types

| 功能 | 狀態 | Phase |
|------|------|-------|
| call / inheritance / member / import | ✅ 已實作 | P1 |
| type_usage / override / include | ✅ 已實作 | P1 |
| Bundled Edges（log2 寬度，×N label） | ✅ 已實作 | P4 |
| type_argument / specialization（C++ template） | ❌ 未實作 | P12 |
| macro_usage / annotation_usage / usage | ❌ 未實作 | — |

### UI 互動

| 功能 | 狀態 |
|------|------|
| Symbol-Centric Graph（center + incoming + outgoing） | ✅ 已實作 |
| Multi-file Code Snippets（taxi curve edges） | ✅ 已實作 |
| Back/Forward history + zoom 動畫 | ✅ 已實作 |
| Edge Type Filtering（pill toggles） | ✅ 已實作 |
| Reference Count Badges（節點右下角 ↙N） | ❌ 未實作 |

---

## 視覺化核心（Cytoscape.js / Sigma.js）

| 功能 | 狀態 |
|------|------|
| L0 Module Overview | ✅ 已實作 |
| L1 File Dependency Graph | ✅ 已實作 |
| L2 Function Call Flow | ✅ 已實作 |
| Galaxy View（Sigma.js WebGL） | ✅ 已實作 |
| Structure View（struct_view.js） | ✅ 已實作 |
| TrailLayouter（Sugiyama 8-stage） | ✅ 已實作 |

---

## 語言解析支援

| 語言 | 狀態 | Parser |
|------|------|--------|
| Python | ✅ 完整 | python_parser.py |
| JavaScript / TypeScript | ✅ 完整 | js_parser.py |
| Go | ✅ 完整 | go_parser.py |
| C / C++ / BIOS / UEFI（EDK2） | ✅ 完整 | bios_parser.py |
| 其他（Java, Rust, C#, Ruby, PHP 等） | ⚠️ 偵測 + 基礎 import | common_parser.py |

---

## Known Tech Debt

| 問題 | 檔案 | 優先度 |
|------|------|--------|
| Dotted import 解析失敗（`from core.engine import Engine`） | analyze_viz.py / parsers | 中 |
| Structure View arrows resize 不重繪 | struct_view.js | 低 |
| C/C++ `end_line` 不準確（未掃 `}` 結尾） | bios_parser.py | 低 |

---

## AI Harness 工作方法論（claw-code 架構採用狀況）

| 模式 | 狀態 |
|------|------|
| CLAUDE.md（專案持久上下文） | ✅ 已有 |
| Skills 系統（8 個 skills） | ✅ 已有 |
| memory.md（架構快照） | ✅ 已有 |
| Workflows（run-local, verify-analysis） | ✅ 已有 |
| PostToolUse Hook（Python 語法檢查） | ✅ 已配置（2026-04-04） |
| Stop Hook（session log） | ✅ 已配置（2026-04-04） |
| /compact 策略 | ✅ 已加入 CLAUDE.md |
| Session Memory 自動摘要（PostCompact hook） | ✅ 已配置（2026-04-04） |
| 自動化測試套件（pytest） | ✅ 43 tests，tests/ 目錄（2026-04-04） |
| 多 Agent 協作（TaskCreate + SendMessage） | ❌ 未實作 |
| AGENTS.md | ❌ 未建立 |
