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

## no-relative-imports-in-src-core (2026-07-30)
- Trap: `src/core/*.py` are imported as TOP-LEVEL modules (server, CLI and
  conftest all put `src/core` on `sys.path`), so `from .local_dir import x`
  raises `ImportError: attempted relative import with no known parent package`.
  Three writers had it and all failed silently — the caller either wrapped it in
  try/except or returned None: `result_store.save_result`,
  `parse_memo.flush_memo`, `analyze_viz._append_health_snapshot`.
- Cost: `result.json` never written (homepage "reopen previous scan" permanently
  empty); `scan_cache.json` + `health_history.json` frozen for six weeks — parse
  memo dead, Health Trend stale, and vizbridge answering Web AI from a six-week-old
  index. Only signal was one `[WARN] Health-snapshot write failed` on stderr.
- Rule: never write `from .x import y` under `src/`. Use `from x import y`, or the
  two-step form at `analytics_helpers.py:940` if it must also work as a package:
  `try: from x import y` / `except ImportError: from .x import y`.
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
  open can aim simple cross-origin requests at `http://127.0.0.1:7777`.
  `json_resp` used to send `Access-Control-Allow-Origin: *`, letting those pages
  READ the replies: `GET /jobs` (job ids + absolute paths) → `GET /file` → whole
  codebase. Separately `/chat-history` did `os.path.join(chat_dir, session_id +
  '.json')` unsanitised on GET and POST, so `session=../../../x` read/overwrote any
  `.json` on disk, `.vizcode/key/ai_keys.json` included. Verified live: HTTP 200 +
  `ACAO: *` returning the repo's `tsconfig.json`. `/file` (server.py:317) and
  `/open-path` had the `root_norm` guard all along; `/chat-history` was missed.
- Cost: none realised — found and fixed in the 2026-07-30 health check.
- Rule: any endpoint turning a request value into a path MUST use the `root_norm`
  prefix check (server.py:317) or `_safe_session_id`-style whitelisting; a bare
  `os.path.join` on request data is always a bug. Never add
  `Access-Control-Allow-Origin` back — the UI is same-origin (`BASE_URL`).
  `do_GET`/`do_POST` open with `_is_local_request()` (Host + Sec-Fetch-Site +
  Origin) against CSRF and DNS rebinding — keep that first line in new verb
  handlers. Also: `tarfile.extractall` needs the ZIP path's member check
  (fetcher.py:22) — Python 3.11 extracts `../` and symlinks happily.

## best-effort-writes-must-still-say-when-they-fail (2026-07-30)
- Trap: every `.vizcode/` writer swallows its exception with a bare `pass`, because
  persistence must never abort a scan. Correct — but silent. When the relative
  import above started raising, three caches stopped updating and NOTHING said so
  for six weeks: no error, no log, and the scan still reported success.
- Cost: see the entry above — four features quietly degraded.
- Rule: `except: pass` is fine around a cache READ that falls back to a default.
  Around a WRITE it must be `except Exception as e:` +
  `print(f'[WARN] ...: {e}', file=sys.stderr)`. If a user could later ask "why is
  this data stale?", the failure has to be visible somewhere.

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
- Trap: `src/core/analyze_viz.py` wraps ALL parser imports in a single
  `try/except ImportError` block (lines 55–105). Adding an import for a
  parser file that doesn't exist yet (`md_parser.py` in commit `0d91b28`)
  causes `_PARSERS_LOADED = False` for ALL languages — every file gets an
  empty parse result. The scan still completes (files and modules are
  counted), but L2/L3 (functions/symbols) are entirely absent. The WARN
  message `[WARN] Could not load language parsers: No module named '...'`
  is the only visible signal.
- Cost: complete loss of L2/L3 (function + symbol) nodes in the Galaxy /
  graph view; ~321 total nodes on a project that should show far more.
  Silently, because the scan reports success.
- Rule: when adding a new `from parsers.X import` line in analyze_viz.py,
  the corresponding `src/parsers/X.py` file MUST be committed in the same
  change. Before merging, run `python -c "from core.analyze_viz import
  _PARSERS_LOADED; print(_PARSERS_LOADED)"` (from `src/`) and verify it
  prints `True`. Any parser import referencing a non-existent file kills
  ALL parsing silently.

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

## gitignored-fixture-dirs-prune-analyzer-samples (2026-07-05)
- Trap: `build_graph()` prunes gitignored directories before extension filtering.
  A test fixture under an ignored directory name (for example `testproject/proto/`)
  is invisible unless the test project explicitly unignores that directory.
- Cost: analyzer content tests can run against an incomplete sample project and
  fail at edge resolution even though the parser and fixture files are correct.
- Rule: when adding source fixtures under a directory that may be ignored,
  verify `git check-ignore` for the directory path and add a local fixture
  `.gitignore` exception such as `!proto/` and `!proto/**`.

## pytest-green-hides-skipped-tests (2026-07-05, compressed 2026-07-30)
- Trap: a green "N passed, 20 skipped" once hid the ENTIRE analyzer content
  suite being skipped by a stale conftest fixture path. Fixed 2026-07-08.
- Rule: treat any skipped test in this repo as a failure to investigate. The
  suite runs 0 skipped today (325 passed) — keep it that way.
