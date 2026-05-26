# VizCode Security Rules

Regex-based security rules consumed by `core/security_scanner.py`. The schema
is intentionally a small subset of Microsoft DevSkim's so individual patterns
can be ported across without translation.

All files in this directory matching `*.json` are loaded on startup;
each must follow the wrapper shape:

```json
{ "schema_rev": 1, "rules": [ ... ] }
```

## Rule fields

| Field                     | Required | Notes                                                                 |
|---------------------------|----------|-----------------------------------------------------------------------|
| `id`                      | yes      | Unique short code, e.g. `VZS001`.                                     |
| `name`                    | yes      | Short human title shown in the dashboard widget.                      |
| `applies_to`              | yes      | List of language tags or `"*"`. Tags: `python`, `javascript`, `typescript`, `go`, `java`, `csharp`, `php`, `ruby`, `html`, `vba`. |
| `severity`                | yes      | `"high"` / `"medium"` / `"low"`.                                      |
| `pattern`                 | one of   | Python `re` regex applied to the whole file text.                     |
| `custom_handler`          | one of   | Name of a function in `_RULE_HANDLERS` (for rules regex alone can't express). |
| `keywords`                | no       | Cheap substring pre-filter. The regex/handler only runs if at least one keyword appears in the file. Lower-case match. |
| `deny_substrings_in_line` | no       | If any of these substrings appears on the same line as the match, the hit is suppressed (e.g. `process.env` for hardcoded-secret rules). |
| `allowlist_substrings`    | no       | If any of these substrings appears in the captured value, the hit is suppressed (e.g. `EXAMPLE`, `placeholder`). |
| `entropy_min`             | no       | Minimum Shannon entropy (bits/char) for the captured group. Below this → suppressed. Use for generic-secret rules. |
| `entropy_capture_group`   | no       | Which regex capture group the entropy check applies to. 0 (default) means the full match. |
| `count_min`               | no       | Rule only fires when the file has at least this many matches. Emits a single summary issue. Use for "too many" rules (TODOs, bare excepts). |
| `skip_in_tests`           | no       | When `true`, the rule is skipped for files under `test/`, `__tests__/`, `*.spec.*` etc. |
| `recommendation`          | yes      | One-sentence remediation hint shown in the widget detail.             |
| `source`                  | no       | Attribution / provenance, e.g. `"CodeFlow / Gitleaks"`.               |

## Behaviour for test files

Files whose path contains `test/`, `tests/`, `__tests__/`, `fixtures/`, `mocks/`
or whose name contains `test` / `.spec.` are treated as test fixtures:

* `high`   → downgraded to `medium`
* `medium` → downgraded to `low`
* `low`    → dropped entirely

This means rules like "AWS access key" still surface in test fixtures (as
medium) so leaked-real-key incidents are caught, but stylistic checks
(TODO/FIXME counts) are silenced.

## File layout

```
common.json   # cross-language: hardcoded secrets, eval/Function, child_process, weak hash,
              # private key, AWS / GitHub token, TLS verify disabled, TODO counts
web.json      # web/frontend: SQLi, innerHTML / dangerouslySetInnerHTML, JWT literal
python.json   # python-specific: eval/exec, pickle, subprocess shell=True, os.system,
              # __import__, bare except, DEBUG=True, assert in prod, requests-no-timeout
vba.json      # VBA: SendKeys, Shell, WScript.Shell, Application.Run, On Error Resume Next
go.json       # Go: exec.Command with shell -c
```

## Attribution

Pattern designs draw from:

* **Microsoft DevSkim** (MIT) — schema model, weak-hash / TLS / command-exec patterns.
  https://github.com/microsoft/DevSkim
* **Gitleaks** (MIT) — keyword + entropy two-stage detection, AWS / GitHub / JWT patterns.
  https://github.com/gitleaks/gitleaks
* **Bandit** (Apache 2.0) — Python rule selection (B101-B608) referenced by ID in rule `source`.
  https://github.com/PyCQA/bandit
* **CodeFlow** — baseline rule set (hardcoded secrets, eval, XSS, VBA checks).
  D:/Google AI/codeflow/index.html → `detectSecurity()`

## Adding a rule

1. Pick the right file (or create a new `*.json` here).
2. Assign the next unused `VZS***` id.
3. Always include `keywords` — without them every rule runs a regex pass over every file. With them, ~5% of files actually hit the regex.
4. Test on a fixture file; verify on at least one real repo to gauge false-positive rate.
5. If you need behaviour regex alone can't express (e.g. checking the absence of an arg), add a function in `security_scanner._RULE_HANDLERS` and reference it via `"custom_handler"`.
