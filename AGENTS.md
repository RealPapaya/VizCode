# Project instructions — VizCode
<!-- 中文摘要：本專案的單一指令正本（Claude/Codex/Hermes 三邊都會讀到這份或被路由到這份）。
     上半部是固定協議（別改），下半部是本專案填空區。 -->

Global rules: read `C:\Users\morris_hsueh\.agents\institution\core-rules.md` first.
Everything below is project-specific and adds to (never overrides) those rules.

## Session protocol (fixed — do not edit)
1. **Before any work**: read `LESSONS.md` in this directory. It contains this
   project's known traps; repeating a documented mistake is the one
   unacceptable failure.
2. **Before writing code**: apply institution `coding-rules.md` — surgical
   minimal diffs (§3), new behavior in new modules (§4), match neighboring
   style (§5), verifiable criteria before code (§6).
3. **Plan review gate** (coding-rules.md §7): a plan touching >3 files, any
   shared/core module, anything hard to reverse — or whose author's confidence
   is not high — gets reviewed by a DIFFERENT model family (templates.md T5)
   BEFORE implementation. The author never green-lights their own plan.
4. **Before claiming done**: institution judgment.md §Done — evidence, verified
   by someone other than the writer (dispatch.md §5).
5. **After any mistake or surprise**: append it to `LESSONS.md` NOW (format
   inside), in the same session. Machine-global lessons also go to
   `C:\Users\morris_hsueh\.agents\institution\lessons.md`.

## Project specifics (fill in; keep each line true or delete it)
- What this project is: local-first code-visualization tool — Python stdlib
  backend (parsers + graph pipeline + HTTP/MCP server) + TypeScript browser
  frontend (D3/Cytoscape graph, Galaxy, Dashboard).
- Build: `npm run build` (esbuild `static/**/*.ts` → committed `build/`; run after ANY static/*.ts edit)
- Test: `python -m pytest tests/` AND `npm run check` (tsc --noEmit, must stay clean) (this is the §6 safety net — keep it current)
- Run locally: `python src/vizcode.py [<path>]` (or `launch.bat`); smoke test: `python src/vizcode.py <path> --scan-only`
- Module convention: new parsers go in `src/parsers/<lang>_parser.py` (same
  6-tuple contract, see CLAUDE.md §1); new frontend features go in
  `static/features/` as standalone modules; shared files
  (`src/core/analyze_viz.py`, `src/core/detector.py`,
  `static/core/viz_constants.ts`, `static/ui/viz_sidebar.ts`) receive only
  registration/dispatch lines.
- Do NOT touch without asking: `build/` (generated — never hand-edit),
  `.vizcode/` (runtime caches), `node_modules/`, the parser 6-tuple contract.
- Style anchors (read these before writing code):
  `src/parsers/go_parser.py` (backend parser style),
  `static/features/graph/graph_core.ts` (frontend feature style).

## Rules for this file
Keep ≤150 lines. Durable knowledge goes to LESSONS.md (traps) or the
institution (universal rules) — not here.

Legacy project docs: CLAUDE.md in this directory (kept as-is — architecture,
layout, parser contract, verification checklist).
