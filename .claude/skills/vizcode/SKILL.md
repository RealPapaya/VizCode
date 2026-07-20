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
python "<VIZCODE_ROOT>/src/core/semantic_enricher.py" check "<PROJECT_PATH>" < "<PROJECT_PATH>/.vizcode/scan_cache.json"
```

> Note: `<VIZCODE_ROOT>` is the directory that contains `src/vizcode.py` (i.e. the repo root), **not** `src/` itself.

If the output is `valid`, skip Phase 3–4 and go straight to Phase 5 (the existing semantic cache is up-to-date).

### Phase 3 — Semantic Analysis

**Principle: If AST can compute it, don't ask the LLM. LLM only fills in what AST cannot see — and even then it _confirms_ local candidates rather than _discovering_ from scratch. Confirming costs a fraction of the tokens of discovery.**

#### Step A — Generate candidate edges locally (zero tokens)

Run the local heuristic detector. It is pure Python (no model in the loop) and finds the cross-file relationships AST import-resolution misses — subprocess spawns, shared-data-file coupling, and cross-file interface/inheritance — already de-duplicated against static import edges:

```bash
python "<VIZCODE_ROOT>/src/core/edge_candidates.py" "<PROJECT_PATH>" > "<PROJECT_PATH>/.vizcode/_tmp_candidates.json"
```

Read `_tmp_candidates.json`. Each entry looks like:
```json
{"source": "launcher.py", "target": "worker.py", "signal": "subprocess",
 "evidence": "subprocess.run(['python', 'worker.py'])", "suggested_confidence": 0.8}
```

If the file is `[]` (no candidates), skip Phase 3–4 entirely and report zero inferred edges.

#### Step B — Confirm each candidate (do not re-discover)

For **each** candidate, make a keep/drop judgment using its `signal` + `evidence`:

- **Keep** it if the evidence shows a genuine runtime/data/contract relationship. Set a final `confidence` (you may keep `suggested_confidence`, or adjust it) and write a one-line `reason` (≤160 chars, same language as the user).
- **Drop** it if the evidence is a coincidence (e.g. a same-named class across unrelated languages, an unrelated filename match).

Only when a candidate's endpoints are ambiguous, call `vizcode_l0()` / `vizcode_l1(module)` to disambiguate — do not pull L0/L1 for every candidate.

Emit the kept candidates as the inferred-edge list. Each edge:
```json
{
  "source": "launcher.py",
  "target": "worker.py",
  "confidence": 0.85,
  "reason": "launcher spawns worker.py via subprocess at runtime",
  "origin": "derived"
}
```

Rules:
- `source`/`target` must be the exact scan_cache keys (project-relative paths) the candidate used — they must match graph/MCP module keys.
- `confidence` range: 0.5–1.0 (below 0.5 is noise, drop it).
- `origin`: set `"derived"` for every edge you kept from the candidate list (it came from a local detector signal + your confirmation = trusted tier `DERIVED`). Set `"inferred"` only for a brand-new edge you added yourself with no candidate behind it.
- Prefer confirming candidates. Only add a brand-new edge the detector missed if it is clearly important (e.g. a collaborative pipeline passed via a queue or env var) — this should be rare, and is the only case that uses `"origin": "inferred"`.
- **Do not** duplicate static import edges; the detector already excludes them.

Then delete the temp file: `rm -f "<PROJECT_PATH>/.vizcode/_tmp_candidates.json"`

### Phase 4 — Write Semantic Cache

Serialize the `inferred_edges` list to a temp JSON string, then write:

```bash
echo '<inferred_edges_json>' | python "<VIZCODE_ROOT>/src/core/semantic_enricher.py" write "<PROJECT_PATH>"
```

(On Windows PowerShell, use `Write-Output` or a temp file if `echo` has quote issues.)

Alternative approach using a temp file (recommended on Windows):
1. Write the JSON array to a temporary file under `<PROJECT_PATH>/.vizcode/_tmp_edges.json`
2. Run: `python "<VIZCODE_ROOT>/src/core/semantic_enricher.py" write "<PROJECT_PATH>" < <temp_file>`
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
- The MCP server is declared in the project's `.mcp.json` (with `enableAllProjectMcpServers: true` set in `.claude/settings.json`); it starts automatically when Claude Code connects to it
- If `src/server/mcp_server.py` is not yet registered, run `python ai/install.py` (which copies `ai/mcp_template.json` into the user's Claude config) and then restart Claude Code

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
