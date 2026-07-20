Global rules: read C:\Users\morris_hsueh\.agents\institution\core-rules.md first.
Session protocol + project commands: read AGENTS.md in this directory.

# CLAUDE.md

**VizCode** — local-first code-visualization tool: Python stdlib backend + TypeScript browser frontend.
Three pillars: **Parsing** (py) · **AI** (Web / MCP / CLI) · **Graph** (Galaxy / L0–L3 / Dashboard).

```bash
python src/vizcode.py [<path>] [--scan-only | --chat | --ai "question"]   # or launch.bat
```

> **Frontend is TypeScript.** Source is `static/**/*.ts`; the app runs the committed
> `build/` bundle (esbuild) so end-users stay zero-install — no Node at runtime. Edit `.ts`,
> never `build/*.js`. Type-check with `npm run check` (tsc), rebuild with `npm run build`.
> `tsconfig.json` is non-strict (`strict: false`, `noImplicitAny` off); the backend→frontend
> JSON contract lives in `static/types/data.d.ts`, CDN globals + the `window.*` surface in
> `static/types/globals.d.ts`. The migration is complete — **no `@ts-nocheck` remains**, so
> keep new code type-clean. Loosen pragmatically (`opts: any = {}`, `e.target as HTMLElement`)
> rather than over-typing dynamic renderers.

## Collaboration Rules

- Clarify scope (feature boundaries, target files, backward compatibility) before acting.
- Work within the **current repo structure** — there is no legacy root-level `server.py` / `analyze_viz.py`.

## Layout

```text
src/
  vizcode.py        # CLI / TUI entry point
  core/             # analyze_viz (graph pipeline) · html_builder · detector · parse_memo ·
                    # semantic_enricher · analytics_helpers · code_health · git_history ·
                    # health_backfill · qa_cache
  parsers/          # one parser per language, same 6-tuple contract:
                    #   dedicated: python, js, go, c_cpp, csharp + ~35 long-tail
                    #              (java, rust, kotlin, ruby, php, sql, css, html, yaml, …)
                    #   firmware (spec-backed): uefi, acpi, asm
                    #   common_parser (regex fallback) · json_parser
  server/           # server (HTTP+API) · job_manager · fetcher · mcp_server
ai/
  vizbridge.py      # Web AI: provider routing + tool-use loop
  chat_cli.py · chat_modes.py · ui_tools.py · install.py
  providers/        # anthropic · openai · gemini · grok · ollama · custom
static/              # TypeScript source (edit here); served as build/ at runtime
  viz.ts            # SPA bootstrap (D3 + Cytoscape main view) · launcher.html
  core/ ui/ styles/ # i18n/state/constants · layout/sidebar/toolbar/code_panel · css
  features/         # graph/ · galaxy_view/ · Dashboard_view/ · symbol_view/ · viz_chat/search/help
  types/            # data.d.ts (window.DATA JSON contract) · globals.d.ts (CDN globals, window.*)
  file_viewers/ · icon/
build/               # committed esbuild output (the .js the browser actually loads) — generated, don't hand-edit
package.json · tsconfig.json · build.mjs   # frontend toolchain (npm run check / build)
```

Flow: `vizcode.py → server.py → analyze_viz.py → static/*.ts → build/*.js → vizbridge.py (AI/SSE)`

## 1. Parsing (`src/core/` + `src/parsers/`)

`analyze_viz.py` scans files → calls parsers → builds modules / edges / stats.

Parser contract (6-tuple — do not change):

```python
(imports_or_refs, funcdefs, funccalls, extra_dict, func_calls_by_func, symbol_defs)
```

- Keep the `analyze_viz.py` contract intact; don't change one parser in isolation.
- **Adding a language** touches: `src/parsers/<lang>_parser.py` · `src/core/analyze_viz.py`
  (dispatch **+ `SCAN_EXT`**) · `src/core/detector.py` · `static/core/viz_constants.ts` · `static/ui/viz_sidebar.ts`.
- If parser output changes, verify graph / dashboard / MCP / AI still consume it.

## 2. AI (`ai/`)

- **Web AI** — `vizbridge.py` → SSE `/chat-stream` → `static/features/viz_chat.ts`; reads `.vizcode/scan_cache.json` + `semantic_cache.json`.
- **MCP** — `src/server/mcp_server.py`, tools `vizcode_context` (one-shot centrality-ranked subgraph + inline trace — preferred entry point) · `vizcode_trace` (inline dependency trace) · `vizcode_l0/l1/l2/l3/query/path/explain/health/report`; backed by a symbol index (`_build_symbol_index`) and size-adaptive output budgets (`_budget_for_filecount`, consumed by `vizbridge.ToolRegistry`). Data under `.vizcode/` (`scan_cache.json`, `INDEX.md`, `L1/ L2/ L3/`).
- **CLI** — `chat_cli.py` via `--chat` / `--ai`.
- Config: `ai/config.json` · keys in `.vizcode/key/ai_keys.json`.

## 3. Graph

Levels: `L0` modules · `L1` file deps · `L2` function drill-down · `L3` symbol interaction.

| Area | Start here |
|------|-----------|
| Parsing | `src/core/analyze_viz.py`, `src/parsers/*`, `src/core/detector.py` |
| AI | `ai/vizbridge.py`, `ai/chat_cli.py`, `ai/chat_modes.py`, `src/server/mcp_server.py` |
| Server / Jobs | `src/server/server.py`, `job_manager.py`, `fetcher.py` |
| Main graph | `static/viz.ts`, `static/features/graph/*`, `static/ui/viz_*.ts`, `static/core/viz_state.ts`+`viz_constants.ts` |
| Galaxy / Dashboard / Symbol | `static/features/{galaxy_view,Dashboard_view,symbol_view}/*` |

## Verification

```bash
python -m pytest tests/                     # unit tests: parsers, analyzer, enrichment, html_builder, git_history
python src/vizcode.py <path> --scan-only    # smoke test
npm run check                               # frontend type-check (tsc --noEmit) — must stay clean
npm run build                               # rebuild build/ after editing any static/*.ts
```

After changes, check: homepage loads · analysis completes · chat works · graph / galaxy / dashboard render.
