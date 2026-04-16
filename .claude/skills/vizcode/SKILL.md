---
name: vizcode
description: Scan a codebase and optionally run semantic analysis + MCP server. Trigger on /vizcode, /vizcode --parse, /vizcode --ai.
---

# SKILL: VizCode — Codebase Scanner & Semantic Analyzer

This skill runs VizCode to scan a codebase and (optionally) analyze it semantically using Claude's understanding.

## Modes

| Invocation | Browser | Semantic | MCP |
|------------|---------|----------|-----|
| `/vizcode --parse` | ✓ | ✗ | ✗ |
| `/vizcode --ai`   | ✗ | ✓ | ✓ |
| `/vizcode`        | ✓ | ✓ | ✓ |

---

## Step 1 — Determine project root

Ask the user for the project path if not provided. Default to the current working directory if they don't specify one.

Set `<VIZCODE_ROOT>` = absolute path to the VizCode installation (the directory containing `vizcode.py`).
Set `<PROJECT_PATH>` = the target codebase to scan (resolved to absolute path).

---

## --parse Mode

### Step 1 — Generate Report

First, run AST scan to generate `vizcode_report.md`:
```bash
python "<VIZCODE_ROOT>/vizcode.py" "<PROJECT_PATH>" --scan-only
```

Wait for completion. This writes:
- `<PROJECT_PATH>/.local/scan_cache.json`
- `<PROJECT_PATH>/.local/vizcode_report.md`

### Step 2 — Open Browser

Then launch the visualizer:
```bash
python "<VIZCODE_ROOT>/vizcode.py" "<PROJECT_PATH>"
```

Report: "分析完成，report.md 已生成，瀏覽器已開啟 http://localhost:7777"

---

## --ai Mode

### Phase 1 — AST Scan

```bash
python "<VIZCODE_ROOT>/vizcode.py" "<PROJECT_PATH>" --scan-only
```

Wait for completion. The scan writes `<PROJECT_PATH>/.local/scan_cache.json`.

### Phase 2 — Cache Validity Check

Read `<PROJECT_PATH>/.local/scan_cache.json`.

Run:
```bash
python "<VIZCODE_ROOT>/semantic_enricher.py" check "<PROJECT_PATH>" < "<PROJECT_PATH>/.local/scan_cache.json"
```

If the output is `valid`, skip Phase 3–4 and go straight to Phase 5 (the existing semantic cache is up-to-date).

### Phase 3 — Semantic Analysis

**原則：AST 能算出來的不要問 LLM。LLM 只補 AST 的盲點。**

#### Step A — 用 AST 取得結構（不讀原始 JSON）

依序呼叫 MCP 工具取得結構化資料：

1. **`vizcode_l0()`** — 取得全局模組分群 + AST 解析出的跨模組依賴邊
2. **`vizcode_l1(module)`** — 對每個模組呼叫，取得模組內檔案清單 + import 邊

這兩步已能建立所有**靜態可知的關聯**（import、include、呼叫鏈），不需要 LLM 判斷。

> 如需深入特定檔案的函式呼叫關係，呼叫 `vizcode_l2(file)`。但 Phase 3 通常 L0+L1 已足夠。

#### Step B — LLM 只推斷 AST 看不到的語意邊

根據 Step A 取得的結構，**跳過**所有已有靜態邊的模組對。

只針對以下情況推斷新的 semantic edge：
- **Subprocess / runtime spawn**（如 `vizcode.py` 用 subprocess 啟動 `server.py`）
- **共享資料檔案**（A 寫 cache，B 讀 cache，但兩者沒有 import 關係）
- **Protocol/interface 關係**（A 實作 B 定義的介面，但無直接 import）
- **協作管線**（A 產生資料、B 消費資料，透過非 import 手段傳遞）

Produce a list of inferred edges. Each edge:
```json
{
  "source": "module_a.py",
  "target": "module_b.py",
  "confidence": 0.85,
  "reason": "module_a orchestrates module_b for AST parsing; caller/callee relationship"
}
```

Rules:
- Only create edges between modules that appear in `vizcode_l0()` output (no external libraries)
- `confidence` range: 0.5–1.0 (below 0.5 is noise, omit it)
- `reason` max 160 characters, in the same language as the user
- Aim for 1–3 meaningful inferred edges per module pair, not exhaustive coverage
- **不要**重複已被 L0/L1 捕捉到的靜態 import 邊

### Phase 4 — Write Semantic Cache

Serialize the `inferred_edges` list to a temp JSON string, then write:

```bash
echo '<inferred_edges_json>' | python "<VIZCODE_ROOT>/semantic_enricher.py" write "<PROJECT_PATH>"
```

(On Windows PowerShell, use `Write-Output` or a temp file if `echo` has quote issues.)

Alternative approach using a temp file:
1. Write the JSON array to a temporary file (e.g., `/tmp/edges.json` or `%TEMP%\edges.json`)
2. Run: `python "<VIZCODE_ROOT>/semantic_enricher.py" write "<PROJECT_PATH>" < <temp_file>`
3. Delete the temp file

### Phase 5 — Report

Count:
- Static edges: number of import/call edges in scan_cache
- Inferred edges: number written to semantic_cache

Report: "掃描完成 — 靜態邊 N 條，推斷邊 N 條。semantic_cache.json 已更新。"

---

## Default Mode (no flag)

Run all phases of `--ai` mode, then additionally:

```bash
python "<VIZCODE_ROOT>/vizcode.py" "<PROJECT_PATH>"
```

Report: "分析完成，瀏覽器已開啟 http://localhost:7777。語意快取已更新。"

---

## Cache Shortcut Logic

```
semantic_cache.json exists AND cache is valid (check command outputs "valid")
  → skip Phase 3 & 4
  → report: "語意快取有效，跳過語意分析"
```

---

## Notes

- Do NOT read `scan_cache.json` or `semantic_cache.json` raw files in future conversations — use the MCP tools instead (`vizcode_query`, `vizcode_path`, `vizcode_explain`)
- The MCP server is registered in `.claude/settings.json`; it starts automatically when Claude Code connects to it
- If `mcp_server.py` is not yet registered, inform the user and point them to Step E in the setup guide

## Context Shortcut（節省 token）

**核心原則：AST 能算的不問 LLM。遵循 L0 → L1 → L2 由上而下策略。**

| 層級 | 工具 | 何時用 | ~Token |
|------|------|--------|--------|
| L0 | `vizcode_l0()` | **第一步**：全局模組分群 + 跨模組依賴 | ~200 |
| L1 | `vizcode_l1(module)` | 鎖定模組後展開檔案依賴圖 | ~150/模組 |
| L2 | `vizcode_l2(file)` | 鎖定檔案後取得函式呼叫圖 | ~300-1200 |

| 其他需求 | 建議做法 |
|----------|---------|
| 找哪個模組負責 X | `vizcode_query(question)` |
| 追蹤 A→B 呼叫鏈 | `vizcode_path(source, target)` |
| 快速摘要某模組 | `vizcode_explain(symbol)` |
| 整體健康報告 | `vizcode_report()` |

**禁止**直接讀取 `scan_cache.json` 或 `semantic_cache.json` 原始檔案。
