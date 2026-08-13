# Project Lessons — read before working, write when burned
<!-- 中文摘要：本專案的教訓帳本。每個 session 開工前必讀；踩雷當場追加。
     這是「複利」的載體：同一個錯，第二次犯就是制度失敗。 -->

Append new lessons at the TOP (newest first) in this exact format:

```markdown
## <kebab-case-slug> (YYYY-MM-DD)
- Trap: <what goes wrong, 1-2 lines>
- Cost: <what it broke / time lost>
- Rule: <literal instruction that prevents it — a weak model must be able to follow it>
```

Housekeeping: when this file exceeds ~150 lines, merge duplicates and delete
entries obsoleted by code changes (verify obsolescence before deleting).
Machine-global lessons (tooling, OS, harness quirks — not specific to this
repo) go to `C:\Users\Morris\.agents\institution\lessons.md` instead, with one
pointer line here.

---

## bare-call-names-manufacture-fake-hotspots (2026-08-12)
- Trap: parsers record call expressions by BARE NAME — the receiver is dropped —
  so `re.finditer()`, `map.get()` and `set.add()` reach the resolver as
  'finditer' / 'get' / 'add'. Phase F resolved those against same-name project
  symbols, and for cross-file misses took `_sym_name_to_ids[name][0]` — an
  ARBITRARY first candidate, unlike `_resolve_symbol_ref` which has always
  required a unique match.
- Cost: on VizCode's own scan a single `get()` in viz_chat.ts collected 323
  inbound edges, `add()` in dart_parser.py 244, `finditer()` in a test file 177.
  The whole "Core Nodes (most-called)" section, the Louvain communities and the
  MCP centrality ranking that `vizcode_context` uses to pick "most relevant
  symbols" were ranking builtin method names. 17% of call edges were fictional.
- Rule: never resolve a call name from `_BUILTIN_CALL_NAMES` (analyze_viz.py), and
  never take `candidates[0]` — cross-file resolution requires exactly one
  definition, the same policy every other edge type already uses. When adding a
  language whose builtins differ, extend `_BUILTIN_CALL_NAMES`, don't bypass it.
  Regression test: tests/test_call_edge_resolution.py.

## scan-cache-only-ever-grew (2026-08-12)
- Trap: `parse_memo` recorded entries and never removed them, so a deleted or
  renamed file kept its parse result forever. Everything that reads
  `scan_cache.json` instead of re-walking the tree — mcp_server, vizbridge, all
  the L0/L1/health tools — kept answering from files that no longer exist.
  Separately, `mcp_server._serve` loaded the cache ONCE at startup, so a rescan
  never reached a running MCP client until it was restarted.
- Cost: VizCode's own cache carried 75 ghosts out of 358 entries — the `.js`
  files deleted in the TypeScript migration were still reported as the heaviest
  files in the repo, and `vizcode_health` contradicted the freshly generated
  INDEX.md. Undetectable from the scan, which reported success every time.
- Rule: `prune_deleted()` runs before every `flush_memo()`; the test is whether
  the file EXISTS, never "was it in this scan" (a `--include-dir` or
  no-`--include-build` run must not evict what it did not visit). Any long-lived
  process holding derived indexes must re-stat its source (`_cache_stamp`) per
  request. Regression tests: tests/test_parse_memo_prune.py,
  tests/test_mcp_reload.py.

## silent-writes-under-src-core (2026-07-30, merged 2026-08-12)
- Trap: two halves of one incident. (a) `src/core/*.py` are imported as TOP-LEVEL
  modules (server, CLI and conftest all put `src/core` on `sys.path`), so
  `from .local_dir import x` raises ImportError — three writers had it. (b) every
  `.vizcode/` writer swallowed the exception with a bare `pass`, so nothing said so.
- Cost: `result.json` never written and `scan_cache.json` + `health_history.json`
  frozen for six weeks — Web AI answering from a six-week-old index — with the
  scan still reporting success.
- Rule: never write `from .x import y` under `src/` (use `from x import y`, or the
  two-step try/except form at `analytics_helpers.py`). `except: pass` is fine
  around a cache READ that falls back to a default; around a WRITE it must be
  `except Exception as e:` + `print(f'[WARN] …: {e}', file=sys.stderr)`.
  Regression test: tests/test_local_dir_imports.py.

## dasht-returns-the-key-so-or-fallbacks-never-fire (2026-07-30)
- Trap: `_dashT(key)` (dashboard_utils.ts) returns the KEY ITSELF when undefined,
  so `_dashT('dashFoo') || 'Foo'` never falls back — `'dashFoo'` is truthy and the
  raw key renders. `dashOthers` shipped that way in four chart call sites.
- Cost: chart legends read "dashOthers" instead of "Others", in both languages.
- Rule: `_dashT` is not optional-chaining. Every key MUST exist in BOTH the `en`
  and `zh-tw` tables in `static/core/i18n.ts`; the `||` is decoration, not a
  safety net. Add to both tables in the same change and re-check key-count parity.

## local-server-is-reachable-from-any-web-page (2026-07-30)
- Trap: binding 127.0.0.1 does NOT make the server private — any page the user has
  open can aim simple cross-origin requests at it. `json_resp` used to send
  `Access-Control-Allow-Origin: *`, letting those pages READ the replies:
  `GET /jobs` (job ids + absolute paths) → `GET /file` → whole codebase.
  Separately `/chat-history` did `os.path.join(chat_dir, session_id + '.json')`
  unsanitised on GET and POST, so `session=../../../x` read/overwrote any `.json`
  on disk, `.vizcode/key/ai_keys.json` included. `/file` and `/open-path` had the
  `root_norm` guard all along; `/chat-history` was missed.
- Cost: none realised — found and fixed in the 2026-07-30 health check.
- Rule: any endpoint turning a request value into a path MUST use the `root_norm`
  prefix check (server.py) or `_safe_session_id`-style whitelisting. Never add
  `Access-Control-Allow-Origin` back — the UI is same-origin (`BASE_URL`).
  `do_GET`/`do_POST` open with `_is_local_request()` — keep that first line in new
  verb handlers, and test the WIRING, not just the helper (a unit test on the
  helper passes with the call site deleted).

## evicting-a-payload-needs-a-proven-rebuild-path (2026-07-31)
- Trap: freeing a cached payload is only safe if EVERY reader can rebuild it.
  Evicting `job['search_index']` looked fine (`/search` has a disk-walk fallback)
  but that fallback had been dead since the `src/` refactor (NameError), and
  `/symbol-refs` has no fallback at all — it silently returned zero references.
- Cost: caught by adversarial review before push.
- Rule: before evicting anything from `JOBS`, grep every reader of the key and
  prove each fallback by RUNNING it. `html` qualifies (/result re-renders from
  `data`); `search_index` does not, and stays resident.

## import-server-is-ambiguous-in-tests (2026-07-30)
- Trap: conftest puts both `src/` and `src/core/` on sys.path, and `src/server/`
  has no `__init__.py`, so the bare name `server` resolves to EITHER the namespace
  package or `src/server/server.py` depending on which test imported first. A test
  passed standalone and failed in the full suite with
  `AttributeError: module 'server' has no attribute ...`.
- Cost: ~15 min chasing a phantom regression during the same health check.
- Rule: to test `src/server/server.py` (or `mcp_server.py`), load it by path under
  a distinct name — `importlib.util.spec_from_file_location('viz_server', ...)` —
  never `import server`. Pattern: tests/test_server_security.py. (`fetcher`,
  `job_manager` have no collision and import normally.)

## parser-import-block-all-or-nothing-failure (2026-07-08)
- Trap: `src/core/analyze_viz.py` wraps ALL parser imports in ONE
  `try/except ImportError` block, so importing a parser file that doesn't exist
  yet sets `_PARSERS_LOADED = False` for every language — every file gets an
  empty parse result. The scan still reports success; only
  `[WARN] Could not load language parsers: …` on stderr hints at it.
- Cost: total loss of L2/L3 (function + symbol) nodes across graph and Galaxy.
- Rule: a new `from parsers.X import` line and `src/parsers/X.py` ship in the
  SAME change. Before merging run, from `src/`:
  `python -c "from core.analyze_viz import _PARSERS_LOADED; print(_PARSERS_LOADED)"`
  and verify it prints `True`.

## widget-detail-must-anchor-sibling-interaction-idioms (2026-07-08)
- Trap: a new widget whose detail view is wired correctly (data, i18n, assets)
  but built from its own inline styles reads as alien and unusable next to
  siblings — tiny fixed chart, labels truncated to 2 chars, no click-through —
  while every sibling detail offers `_dashGoToGraphFile` navigation,
  `data-clickable` hover, `.dash-report-section-title` headers, detail-sized charts.
- Cost: full user-reported rework of widget_harness_scan.ts detail mode one
  day after shipping.
- Rule: before writing any widget's renderDetail, read the best sibling's
  renderDetail (widget_code_health.ts is the current anchor) and reuse its
  vocabulary: detail-size chart option, full i18n labels + title attr,
  `.dash-report-section-title` sections, `data-clickable` + `data-tip` on rows,
  file paths clickable via `_dashGoToGraphFile` when the path is in the graph.
  Verify step must include "detail view side-by-side with a sibling: same
  component vocabulary, no truncated labels, affordances match".

## dashboard-widget-needs-html-builder-asset-entry (2026-07-07)
- Trap: a new Dashboard widget registered via `_dashRegisterWidget` and compiled
  into `build/` still never loads — `src/core/html_builder.py:609-645` hardcodes
  the dashboard `js_assets` script list, and the widget's .js must be added there.
- Cost: none yet — caught pre-implementation by Codex T5 cross-review of the
  harness-scan plan; would have been a silent widget-never-renders bug.
- Rule: when adding any `static/features/Dashboard_view/widgets/*.ts`, also add
  its built `.js` to the `js_assets` list in `html_builder.py` and verify the
  script tag appears in the served page.

## gitignored-dirs-bite-twice-analyzer-and-git (2026-07-05, extended 2026-08-13)
- Trap A (analyzer): `build_graph()` prunes gitignored directories before
  extension filtering. A fixture under an ignored directory name (for example
  `testproject/proto/`) is invisible unless explicitly unignored.
- Trap B (git tracking): an UNANCHORED directory pattern matches at every depth.
  A bare `parsers/` meant for a root output dir also matched `src/parsers/`, so
  `src/parsers/md_parser.py` was never committed — while its 45 already-tracked
  siblings kept working, because gitignore does NOT apply to tracked files.
  The rule was therefore asymptomatic for months and only bites NEW files.
- Cost: A — analyzer content tests run against an incomplete sample and fail at
  edge resolution though parser and fixtures are correct. B — `tests/test_md_parser.py`
  was tracked while the parser it imports was not; any fresh clone breaks.
- Rule:
  1. Anchor directory patterns you mean to be root-only: write `/parsers/`, not
     `parsers/`. An unanchored pattern is a claim about EVERY directory of that name.
  2. After adding any ignore rule, run
     `git status --ignored --porcelain | grep '^!!'` and confirm nothing under
     `src/`, `ai/`, `static/`, or `tests/` is listed. `git check-ignore <file>`
     alone is not enough — it stays silent for already-tracked files.
  3. For source fixtures under a possibly-ignored directory, add a local fixture
     `.gitignore` exception such as `!proto/` and `!proto/**`.

## pytest-green-hides-skipped-tests (2026-07-05, compressed 2026-07-30)
- Trap: a green "N passed, 20 skipped" once hid the ENTIRE analyzer content
  suite being skipped by a stale conftest fixture path. Fixed 2026-07-08.
- Rule: treat any skipped test in this repo as a failure to investigate. The
  suite runs 0 skipped today (365 passed, verified 2026-08-13) — keep it that way.
