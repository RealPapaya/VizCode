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
- `<PROJECT_PATH>/.vizcode/scan_cache.json`
- `<PROJECT_PATH>/.vizcode/vizcode_report.md`

### Step 2 — Open Browser

Then launch the visualizer:
```bash
python "<VIZCODE_ROOT>/vizcode.py" "<PROJECT_PATH>"
```

Report: "Analysis complete. report.md has been generated. Browser opened at http://localhost:7777"

---

## --ai Mode

### Phase 1 — AST Scan

```bash
python "<VIZCODE_ROOT>/vizcode.py" "<PROJECT_PATH>" --scan-only
```

Wait for completion. The scan writes `<PROJECT_PATH>/.vizcode/scan_cache.json`.

### Phase 2 — Cache Validity Check

Read `<PROJECT_PATH>/.vizcode/scan_cache.json`.

Run:
```bash
python "<VIZCODE_ROOT>/semantic_enricher.py" check "<PROJECT_PATH>" < "<PROJECT_PATH>/.vizcode/scan_cache.json"
```

If the output is `valid`, skip Phase 3–4 and go straight to Phase 5 (the existing semantic cache is up-to-date).

### Phase 3 — Semantic Analysis

**Principle: If AST can compute it, don't ask the LLM. LLM only fills in what AST cannot see.**

#### Step A — Get structure via AST (do not read raw JSON)

Call MCP tools in sequence to obtain structured data:

1. **`vizcode_l0()`** — Get global module clusters + cross-module dependency edges parsed by AST
2. **`vizcode_l1(module)`** — Call for each module to get the file list within the module + import edges

These two steps are sufficient to establish all **statically knowable relationships** (imports, includes, call chains) — no LLM inference needed.

> If you need to drill into function-level call relationships for a specific file, call `vizcode_l2(file)`. For Phase 3, L0+L1 is usually enough.

#### Step B — LLM infers only semantic edges invisible to AST

Based on the structure from Step A, **skip** all module pairs that already have static edges.

Only infer new semantic edges for the following cases:
- **Subprocess / runtime spawn** (e.g., `vizcode.py` launches `server.py` via subprocess)
- **Shared data files** (A writes a cache, B reads it, but neither imports the other)
- **Protocol/interface relationships** (A implements an interface defined by B, but no direct import)
- **Collaborative pipelines** (A produces data, B consumes it, passed through non-import means)

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
- **Do not** duplicate static import edges already captured by L0/L1

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

Report: "Scan complete — N static edges, N inferred edges. semantic_cache.json has been updated."

---

## Default Mode (no flag)

Run all phases of `--ai` mode, then additionally:

```bash
python "<VIZCODE_ROOT>/vizcode.py" "<PROJECT_PATH>"
```

Report: "Analysis complete. Browser opened at http://localhost:7777. Semantic cache updated."

---

## Cache Shortcut Logic

```
semantic_cache.json exists AND cache is valid (check command outputs "valid")
  → skip Phase 3 & 4
  → report: "Semantic cache is valid, skipping semantic analysis"
```

---

## Notes

- Do NOT read `scan_cache.json` or `semantic_cache.json` raw files in future conversations — use the MCP tools instead (`vizcode_query`, `vizcode_path`, `vizcode_explain`)
- The MCP server is registered in `.claude/settings.json`; it starts automatically when Claude Code connects to it
- If `mcp_server.py` is not yet registered, inform the user and point them to Step E in the setup guide

## Context Shortcut (save tokens)

**Core principle: If AST can compute it, don't ask the LLM. Follow the top-down L0 → L1 → L2 strategy.**

| Level | Tool | When to use | ~Tokens |
|-------|------|-------------|---------|
| L0 | `vizcode_l0()` | **First step**: global module clusters + cross-module dependencies | ~200 |
| L1 | `vizcode_l1(module)` | After targeting a module, expand its file dependency graph | ~150/module |
| L2 | `vizcode_l2(file)` | After targeting a file, get its function call graph | ~300–1200 |

| Other needs | Recommended approach |
|-------------|----------------------|
| Find which module is responsible for X | `vizcode_query(question)` |
| Trace A→B call chain | `vizcode_path(source, target)` |
| Quick summary of a module | `vizcode_explain(symbol)` |
| Overall health report | `vizcode_report()` |

**Never** read `scan_cache.json` or `semantic_cache.json` raw files directly.
