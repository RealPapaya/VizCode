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

## widget-detail-must-anchor-sibling-interaction-idioms (2026-07-08)
- Trap: a new widget whose detail view is wired correctly (data, i18n, assets)
  but built from its own inline styles reads as alien and unusable next to
  siblings: tiny fixed-size chart, labels ellipsis-truncated to 2 chars,
  monotonous identical rows, zero click-through — while every sibling detail
  offers `_dashGoToGraphFile` navigation, `data-clickable` hover,
  `.dash-report-section-title` headers, and detail-sized charts.
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

## pytest-green-hides-skipped-analyzer-suite (2026-07-05)
- Trap: `python -m pytest tests/` reports "162 passed, 20 skipped" and looks
  green, but the 20 skips are the ENTIRE analyzer content suite — the
  `testproject_path` fixture (tests/conftest.py:135) points to
  `testproject/testproject`, a nested dir that no longer exists after the
  src/ reorganization (commit 1f92c85). Real path is just `testproject/`.
- Cost: analyzer content regressions would pass CI silently.
- Rule: treat any skipped test in this repo as a failure to investigate; the
  fix (pending user approval) is changing conftest.py:135 to
  `PROJECT_ROOT / 'testproject'`.
