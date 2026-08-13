# VizCode — Codebase Explorer

## 第一步：先跑掃描

```bash
python "<VIZCODE_ROOT>/vizcode.py" "<PROJECT_PATH>" --scan-only
```

等完成後 `.vizcode/scan_cache.json` 會更新，MCP 工具才能用最新資料。

> `<VIZCODE_ROOT>` = VizCode 安裝目錄（含 `vizcode.py` 的資料夾）  
> `<PROJECT_PATH>` = 目標 codebase 的根目錄

## 探索策略：L0 → L1 → L2 → L3

**絕對禁止**一開始就讀原始碼。遵循由上而下策略：

| 工具 | 用途 | ~Token |
|------|------|--------|
| `vizcode_l0()` | **第一步**：全局模組分群 + 跨模組依賴 | ~200 |
| `vizcode_l1(module)` | 鎖定模組後展開檔案依賴圖 | ~150/模組 |
| `vizcode_l2(file)` | 鎖定檔案後取得函式呼叫圖 | ~300–1200 |
| `vizcode_l3(file)` | 需要更細節時瀏覽 symbol、class/member、signature、symbol edge | ~500–1500 |
| `vizcode_query(q)` | 關鍵字搜尋模組與語意邊 | ~200 |
| `vizcode_path(a, b)` | A→B 最短依賴路徑 | ~100 |
| `vizcode_explain(sym)` | 模組角色快速摘要 | ~150 |
| `vizcode_health()` | Dead code / god files 健康報告 | ~200 |
| `vizcode_report()` | 取得 INDEX.md 總覽（L0 統計）| ~200 |

### 典型工作流程

1. `vizcode_l0()` — 看懂整體模組邊界
2. `vizcode_l1("parsers")` — 深入某個模組
3. `vizcode_l2("parsers/c_cpp_parser.py")` — 看特定檔案的函式圖
4. `vizcode_l3("parsers/c_cpp_parser.py")` — 需要 class/member/signature/edge type 細節時再進 L3
5. `vizcode_query("cache")` — 找所有跟 cache 相關的模組/邊

**禁止**直接讀取 `.vizcode/scan_cache.json` 或 `.vizcode/semantic_cache.json` 原始檔案。

### Parser Enrichment 驗證規則

修改 parser enrichment 時，除了 unit tests，也要在 `tests/fixtures/testproject/` 新增可保留的最小範例檔，讓實際 demo 專案能看見新增的解析能力。

- L1 enrichment：範例檔要能產生預期 file edge，並用分析結果確認 edge type / subtype / via。
- L3 enrichment：範例檔要能產生預期 symbol edge，並用分析結果確認 `type_usage` / `implements` / `inheritance` 等既有 edge 是否真的長出來。
- 不要刪除這些 fixture；若 parser 行為改變，更新 fixture 和測試，讓它們持續描述目前想支援的語法。
