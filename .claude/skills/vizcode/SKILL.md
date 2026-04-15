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

Execute:
```bash
python "<VIZCODE_ROOT>/vizcode.py" "<PROJECT_PATH>"
```

Report: "分析完成，瀏覽器已開啟 http://localhost:7777"

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

Read `<PROJECT_PATH>/.local/scan_cache.json`.

The `entries` field is a dict: `{ "filename" → { "payload": { "imports", "funcdefs", "funccalls" }, ... } }`.

For each module in `entries`:
- What is this module's primary responsibility?
- Which other modules does it have a **semantic** relationship with (beyond static imports)?
- Why? What is the nature of that relationship?

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
- Only create edges between modules that appear in `entries` (no external libraries)
- `confidence` range: 0.5–1.0 (below 0.5 is noise, omit it)
- `reason` max 160 characters, in the same language as the user
- Aim for 1–3 meaningful inferred edges per module pair, not exhaustive coverage

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
