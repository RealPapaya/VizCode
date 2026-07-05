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
