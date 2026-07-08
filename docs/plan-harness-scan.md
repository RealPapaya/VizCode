# PLAN — VizCode "AI Harness Scan" dashboard feature
<!-- 中文摘要：功能計畫：掃描任何 codebase 判斷其 AI harness 成熟度
     （instructions / harness / loop / memory / delegation / safety 六維），產出
     0–10 分數、等級、雷達圖與逐項證據。依 institution planning-playbook.md 的
     P1–P7 流程產出；section 標題即對應階段。 -->

Status: REVIEWED (T5 cross-family done, findings resolved) — awaiting user approval to implement.
Target repo: `D:\Google AI\VizCode` (plan authored 2026-07-07, line refs verified then).
Method: produced by the P1–P7 loop in
`C:\Users\Morris\.agents\institution\planning-playbook.md` — section headers name the phase.
Once implemented, this kept plan becomes the pattern anchor for the next feature of the same shape (P7).

---

## P1. Frame

**Goal.** When a user imports a codebase, VizCode detects whether it has an AI
harness architecture and grades it: a 0–10 composite score, a maturity level,
a 6-axis radar chart, and per-dimension evidence — so the user sees at a glance
how "agent-ready" a repo is and what is missing.

**Why.** Morris runs a multi-harness agent institution; the natural next
VizCode capability is measuring exactly that discipline in any repo it scans.

**In scope (v1).** Static detection from files already on disk; 6-dimension
rubric; score + level + breakdown + evidence + radar widget on the Dashboard;
en/zh i18n; unit tests with calibration fixtures.

**Out of scope (v1).** LLM-based content-quality judgment, network calls,
history/trends, MCP tool exposure, detail-panel drilldown (all listed in P5).

**Assumptions.**
- [assumption] "AI harness" means agent-facing repo artifacts: instruction
  files (CLAUDE.md/AGENTS.md/…), harness config dirs (.claude/.cursor/…),
  MCP config, lessons/memory files, subagent definitions, CI/test loops.
- [assumption] Scoring must work offline with Python stdlib only — VizCode's
  backend has a zero-dependency policy (its README/CLAUDE.md: "Python stdlib
  backend").
- [assumption] A harness-kit-style repo scoring very high is correct behavior,
  not gaming.

## P2. Recon — pattern anchor

Rule stack loaded: institution core-rules + coding-rules; VizCode `AGENTS.md`
(session protocol, style anchors, do-not-touch list) and `LESSONS.md`
(gitignored-fixture trap; skipped-analyzer-suite trap — see Risks).

**Primary anchor: Code Health** — same shape (multi-signal weighted score with
breakdown, rendered as a dashboard widget). Wiring chain, end to end:

| Link | Where (verified) |
|---|---|
| Pure scoring module (weights + formulas in one file) | `src/core/code_health.py` (whole file, 113 lines) |
| Pipeline import | `src/core/analyze_viz.py:150` |
| Injection: compute + write to stats, inside a try/except "quality-metric pass" | `src/core/analyze_viz.py:2840-2852` → `stats.code_health_score/_breakdown/_weights` |
| Frontend contract | `static/types/data.d.ts:143` (optional field on `Stats`, long tail allowed by index signature `:149`) |
| Widget registration API | `static/features/Dashboard_view/widgets/widget_code_health.ts:67-71` — `_dashRegisterWidget({id, labelKey, descriptionKey, defaultSize, render})` |
| Widget enable list (shared file, 1-line injection) | `static/features/Dashboard_view/dashboard_layout.ts:25` `_DASH_OPTIONAL_IDS` |
| Widget-id → labelKey map (shared, 1 line) | `static/features/Dashboard_view/dashboard_utils.ts:424` |
| i18n keys, en + zh blocks | `static/core/i18n.ts:358` (en) / `:981` (zh) |
| Pure-SVG chart idiom (no new deps) | gauge in `widget_code_health.ts:5-23` |

**Secondary anchor: Security findings** — for evidence-list payloads and
graceful degradation: aggregation wrapped in try/except so failure only warns
(`analyze_viz.py:2854-2864`), widget `widget_security.ts:258`.

**Binding constraints found (VizCode AGENTS.md).** New backend logic in its own
`src/core/` module; shared files get registration lines only; `build/` never
hand-edited; frontend style anchor `static/features/graph/graph_core.ts`;
after any `static/*.ts` edit run `npm run check` + `npm run build`.

## P3. Contract (defined before any internals)

```python
stats['harness_scan'] = {
    'score':     6.8,             # float 0-10, weighted composite
    'level':     'engineered',    # none_adhoc | basic | structured | engineered | self_improving
    'breakdown': {dim: float},    # each 0-10, keys = the 6 dims below
    'weights':   {dim: float},    # sums to 1.0, copied from module constant
    'evidence':  {dim: [ {'path': 'AGENTS.md', 'signal': 'instruction index file', 'points': 2.0} ]},
    'missing':   {dim: ['no CI workflow found', ...]},   # top unmet signals, feeds recommendations
    'scanned':   ['<root>', '.claude/', '.github/', ...] # locations checked (explainability)
}
```

TypeScript mirror: `HarnessScan` interface + `harness_scan?: HarnessScan;` on
`Stats`. Degradation: field is optional; widget reads
`stats.harness_scan || null` and renders an empty-state card; BOTH the import
and the compute call sit inside the new try/except (a module-top import would
abort analyze_viz before any guarded pass runs — R4), so scan never breaks.
`path` values are repo-relative posix paths (same as the rest of the pipeline).

## P4. Rubric (evaluative feature → rubric rules apply)

All signals are file-existence checks plus bounded content probes (regex over
instruction/config files, each read capped at 128 KB). Stdlib only. Weights and
signal tables live ONLY in `src/core/harness_scan.py`.

| Dim (weight) | What it measures | Example signals (each = evidence row with points) |
|---|---|---|
| `instructions` (0.20) | Context engineering | CLAUDE.md / AGENTS.md / GEMINI.md / .github/copilot-instructions.md / .cursor rules / .windsurf rules exist; thin-index bonus (≤150 lines + points elsewhere); monolith penalty (>400 lines); referenced paths actually exist |
| `harness_config` (0.15) | Harness engineering | .claude/settings*.json, hooks, commands/, skills/, agents/ dirs; .mcp.json or MCP config; .gemini/ .cursor/ .windsurf/ config dirs |
| `loop_engineering` (0.20) | Verifiable feedback loops an agent can close | tests dir with test files; CI workflows (.github/workflows/*.yml); lint/format config (ruff/eslint/prettier/pyproject tool sections); build script; BONUS: instruction files state the test/build commands |
| `memory_learning` (0.15) | Self-learning / compounding | LESSONS.md or lessons*.md; memory*.md; CHANGELOG.md; ADR/decision docs; lesson-format discipline (regex for dated/slugged entries) |
| `delegation` (0.15) | Multi-agent engineering | STRUCTURAL artifacts carry the points: .claude/agents/*.md, workflow/subagent definition files, delegation sections that name concrete commands. Keyword prose (`subagent|delegate|dispatch|model tier`) is capped at a small fraction of the dim — provider names are low-value aliases, not evidence (R6: prose is gameable and provider-specific vocab under-scores non-Anthropic repos) |
| `safety_governance` (0.15) | Guardrails | allow/deny permissions in .claude/settings; "do not touch" lists in instructions; review-gate language; secrets hygiene (.gitignore covers .env/keys; no committed key files) |

Per-dim: points accumulate per matched signal, clamped to 10.
Composite = Σ dim×weight. Levels: 0–2 `none_adhoc`, 2–4 `basic`,
4–6 `structured`, 6–8 `engineered`, 8–10 `self_improving`
(self_improving additionally REQUIRES memory_learning ≥ 6 — a repo cannot be
"self-improving" without a working lessons loop, whatever its total).

**Calibration targets (fixed before coding; encoded as tests).**
- Empty/bare repo (tmp fixture): score < 1.0, level `none_adhoc`.
- Repo with a single 500-line CLAUDE.md and nothing else: 2.0–3.5, `basic`.
- VizCode itself: ≥ 6.0 (`engineered`) — thin-index AGENTS.md, LESSONS.md,
  tests + npm check, .mcp.json, multiple harness dirs.
- `testproject/` fixture: < 1.0.
If a calibration target misses, tune weights/points in `harness_scan.py` only.

## P5. Beyond the prompt — options list (user picks; diff = approved subset)

| Option | v1 / defer | Cost note |
|---|---|---|
| 6-dim rubric + radar + gauge + level badge + evidence + missing-signals list | **v1** | core ask |
| en + zh i18n for all labels | **v1** | ~16 keys |
| Per-dimension recommendations (anchor: `_dashHealthRecommendation`) | **v1** (static strings) | ~20 lines |
| Detail-panel drilldown (anchor: `dashboard_detail_panel.ts:450` security branch) | defer | shared-file branch, +~80 lines |
| Score history/trend (anchor: `health_backfill.py`) | defer | new snapshot file |
| MCP tool `vizcode_harness` so agents can self-assess a repo | defer | mcp_server.py + budget wiring |
| LLM content-quality sub-score via existing AI bridge | defer | non-deterministic, needs keys |
| Per-harness coverage matrix (Claude/Codex/Cursor/Windsurf columns) | defer | UI-heavy |
| Reviewer alternative (R7): drop radar in v1, compact score card + detail panel only | not chosen | simpler, but the radar is the explicit user ask |
| Put widget in `_DASH_DEFAULT_LAYOUT` (visible on first load) | user choice | changes every user's default dashboard (R2) |

## P6. File-touch table and step → verify plan

| # | File | New/Edit | Size of change |
|---|---|---|---|
| 1 | `src/core/harness_scan.py` | NEW | ~220 lines (signals table, probe helpers, `compute_harness_scan(root) -> dict`) |
| 2 | `tests/test_harness_scan.py` | NEW | ~130 lines (tmp_path fixtures = calibration targets) |
| 3 | `src/core/analyze_viz.py` | EDIT (shared) | 1 import line + ~8-line try/except block after `analyze_viz.py:2864` |
| 4 | `static/types/data.d.ts` | EDIT (shared) | +1 optional Stats field + `HarnessScan` interface (~18 lines, types only) |
| 5 | `static/features/Dashboard_view/widgets/widget_harness_scan.ts` | NEW | ~190 lines (radar = pure SVG polygon, gauge idiom reused) |
| 6 | `static/features/Dashboard_view/dashboard_layout.ts` | EDIT (shared) | +1 id in `_DASH_OPTIONAL_IDS` (line 25) |
| 7 | `static/features/Dashboard_view/dashboard_utils.ts` | EDIT (shared) | +1 map line near `:424` |
| 8 | `static/core/i18n.ts` | EDIT (shared) | +~16 keys ×2 locale blocks (near `:358` en, `:981` zh) |
| 9 | `src/core/html_builder.py` | EDIT (shared) | +1 entry in the hardcoded dashboard `js_assets` script list (`:609-645`) — found by T5 review (R1) |

Shared files receive ONLY the line counts stated (coding-rules §4). All logic
lives in files 1 and 5.

Steps (R#-tags mark review-driven changes, see P7):
```
1. Write harness_scan.py + test_harness_scan.py (calibration fixtures first,
   TDD on the rubric)
   → verify: python -m pytest tests/test_harness_scan.py -v  — all pass, 0 skipped
2. Inject into analyze_viz.py quality-metric pass; the import goes INSIDE the
   guarded block, not at module top (R4)
   → verify: python src/vizcode.py testproject --scan-only ; then confirm
     .vizcode/result.json stats.harness_scan has score/level/breakdown/evidence
     (R3: stats live in result.json, NOT scan_cache.json), and score < 1.0
3. Extend data.d.ts
   → verify: npm run check  — clean
4. Widget + layout id + utils map + i18n keys + html_builder js_assets entry (R1)
   → verify: npm run check ; npm run build ; confirm widget_harness_scan.js is
     listed in html_builder.py js_assets AND present in build/ ; launch on
     VizCode itself: Dashboard → + Add Widget → harness_scan → radar renders
     (R2: widget is optional, it does NOT appear on first load), en↔zh toggle
     renders both label sets
5. Regression: python -m pytest tests/  — no NEW failures/skips vs baseline
   (pre-existing 20 skips are a known trap: VizCode LESSONS.md
   "pytest-green-hides-skipped-analyzer-suite"; do not let them mask step 1)
6. Calibration on real repos: scan VizCode (expect ≥6.0 engineered) and
   testproject (expect <1.0) ; record both numbers in the PR/report
7. Independent verification (R5, dispatch.md §5): a fresh-context agent that did
   not write the code re-runs steps 2/4/6 checks and answers per criterion;
   implementer never self-certifies
```

**Risks / mitigations.**
- Monorepos with per-package harness files → v1 probes root + well-known dirs
  only; `scanned` list makes the boundary visible; deeper walk is a defer item.
- i18n drift between en/zh blocks → step 4 verify toggles both locales.
- Evidence paths on Windows → emit posix-style relative paths like the rest of
  the pipeline.
- Gitignored harness dirs (LESSONS.md trap #gitignored-fixture-dirs) →
  harness_scan probes the filesystem directly, NOT the pruned scan graph, so
  ignored-but-present harness files still count.

## P7. Review log (cross-family T5 — required: 9 files > 3-file trigger)

Reviewer: Codex CLI `gpt-5.4` (reasoning high), 2026-07-07, adversarial T5
brief, repo access. Verdict: **fix-then-ship**. All findings resolved below.

| # | Finding (reviewer: Codex, with `path:line`) | Severity | Resolution |
|---|---|---|---|
| R1 | Hidden coupling: `html_builder.py:609-645` hardcodes the dashboard script list; the new widget compiles but never loads without a `js_assets` entry | blocker | FIXED — file #9 added to touch table; step 4 verifies the entry + built file |
| R2 | Widget is optional-only (`dashboard_layout.ts:14-25`), so "dashboard shows radar" on first load was an impossible verify | blocker | FIXED — step 4 verify is now "+ Add Widget → harness_scan → renders". Changing `_DASH_DEFAULT_LAYOUT` would affect every user's default view — left as a user decision (P5 spirit) |
| R3 | Step 2 asserted the wrong artifact: assembled stats land in `.vizcode/result.json` (`vizcode.py:1419-1425`, `result_store.py:5-16`), not `scan_cache.json` | major | FIXED — step 2 verify now targets `result.json` |
| R4 | "Own try/except so scan never breaks" was half-true: a module-top `from harness_scan import …` failure aborts before the guarded pass | major | FIXED — import moved inside the guarded block (P3 + step 2) |
| R5 | Verify plan had no independent verifier, violating the repo's done-gate (AGENTS.md #4, dispatch.md §5) | major | FIXED — step 7 added: fresh-context agent re-runs the checks |
| R6 | `delegation` dim overfit to Anthropic/Morris vocabulary; prose keywords are gameable and under-score Codex/Hermes-style repos | major | FIXED — P4 reweighted: structural artifacts carry the points, keyword prose capped |
| R7 | v1 UI scope heavier than needed: compact card + detail panel already exist; custom radar/evidence card is avoidable complexity | minor | PARTIALLY ACCEPTED — radar stays in v1 because it is the user's explicit ask (雷達圖); evidence/missing lists render compactly (top 3 + count), full lists deferred to the detail-panel option in P5. Reviewer's simpler-card alternative recorded in P5 as a user choice |

Implementation starts only after the user approves this revised plan.

## P8. Implementation log (dispatch execution, 2026-07-08)

Executed as commander-dispatch (planning-playbook.md P8): the planning session
wrote no code. Two disjoint-file work packages ran in parallel, then a separate
fresh-context verifier ruled on every acceptance criterion.

| Package | Agent | Files owned | Outcome |
|---|---|---|---|
| A backend | sonnet implementer | `src/core/harness_scan.py` (NEW ~270 lines), `tests/test_harness_scan.py` (NEW 133 lines / 20 tests), `src/core/analyze_viz.py` (8-line guarded injection, import inside try per R4) | done — all 20 new tests pass |
| B frontend | sonnet implementer | `widget_harness_scan.ts` (NEW 208 lines, pure-SVG radar), `data.d.ts` (+HarnessScan), `dashboard_layout.ts` (+1 optional id, R2), `dashboard_utils.ts` (+1 map line), `i18n.ts` (+15 en / +15 zh keys), `html_builder.py` (+1 js_assets line, R1) | done — `npm run check` and `npm run build` clean |
| C verify | haiku fresh-context verifier (wrote nothing) | re-ran steps 2/4/6 checks + calibration | ALL acceptance criteria PASS |

Verification evidence (verifier C, not implementer claims):
- `stats.harness_scan` present in `.vizcode/result.json` with the exact P3
  contract fields (R3 target confirmed).
- `widget_harness_scan.js` listed in `html_builder.py` js_assets AND present in
  `build/` (R1 closed); widget renders via + Add Widget, absent from first-load
  default layout (R2 as designed); en↔zh both render.
- Full-suite regression failures were ruled PRE-EXISTING by reading the error
  text, grepping it for harness_scan identifiers (none), and checking the
  working tree — not by trusting the implementers.

Observed calibration vs P4 targets:
| Input | Target band | Observed | Level |
|---|---|---|---|
| VizCode repo itself | ≥ 6.0 | 8.0 | self_improving |
| testproject | < 1.0 | 0.1 | none_adhoc |
| empty dir | ~0 | 0.15 | none_adhoc |
| single CLAUDE.md | low-basic | 2.15 | basic |

Open note: VizCode's `delegation` dimension scored 1.0 — plausible (repo has no
`.claude/agents/` structural artifacts, and R6 capped keyword prose), but worth
a look if the dimension stays near-zero on other genuinely delegating repos.

## P8.1 Follow-up: detail-view UX rework (2026-07-08, user-reported)

Defect (user screenshot of DETAIL mode): radar tiny with 7.5px hand-abbreviated
labels; dimension names ellipsis-truncated to 2 chars; evidence a wall of
identical inline-styled rows capped at top-3; nothing clickable — while every
sibling widget's detail navigates on click.

Root cause: P2 anchor failure — the original plan anchored the DATA wiring
(registration, i18n, js_assets) but not the INTERACTION idioms of sibling
detail views (`widget_code_health.ts` renderDetail, `data-clickable`,
`_dashGoToGraphFile`, `.dash-report-section-title`, detail-size chart options).

Fix (dispatch: haiku recon → sonnet implementer → haiku fresh verifier, 8/8
acceptance PASS): radar gets `opts.detail` (240 viewBox, full i18n two-line
labels; grid abbreviations now derived from i18n so zh works); hero row with
weakest-dimension diagnostic card (code_health idiom); dimension rows clickable
→ smooth-scroll + highlight of that dimension's evidence group; detail lists
ALL evidence, rows clickable via `_dashGoToGraphFile` when the path is in the
graph (guarded, tooltip otherwise); gaps visually distinct (warn dot +
`.dash-sev-pill`); +3 i18n keys en/zh; +185-line additive `.dash-harness-*`
CSS block. Files: widget_harness_scan.ts, i18n.ts, dashboard_detail_panels.css
(+ committed build outputs). 20 backend tests still pass — backend untouched.

Recorded: VizCode LESSONS.md `widget-detail-must-anchor-sibling-interaction-idioms`;
universal rule added to planning-playbook.md P2 (interaction-layer anchoring),
P6 (UI parity verify step), and anti-patterns.

Minor known gap: `_dashHarnessEmptyCard` empty-state text predates this fix and
is still hardcoded English (not in the reworked detail scope).
