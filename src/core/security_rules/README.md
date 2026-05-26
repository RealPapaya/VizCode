# VizCode Security Rules

Regex-based security rules consumed by `core/security_scanner.py`.

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
| `applies_to`              | yes      | List of language tags or `"*"`. Tags: `python`, `javascript`, `typescript`, `go`, `java`, `csharp`, `php`, `ruby`, `html`, `vba`, `yaml`, `terraform`, `dockerfile`. |
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
common.json     # cross-language: hardcoded secrets, eval/Function, child_process, weak hash,
                # private key, TLS verify disabled, TODO counts, cloud + dev-tool tokens
                # (AWS / GCP / Azure / Slack / Stripe / SendGrid / Twilio / npm / PyPI /
                #  GitLab / Discord / OpenAI / Anthropic / HuggingFace / age / PuTTY /
                #  DB URLs / JDBC / HTTP basic auth)
web.json        # web/frontend: SQLi, JWT literal, dangerouslySetInnerHTML, innerHTML / outerHTML,
                # document.write, localStorage tokens, Math.random for security, createCipher,
                # string-arg setTimeout, postMessage wildcard, NODE_TLS_REJECT_UNAUTHORIZED,
                # v-html / bypassSecurityTrust, CORS wildcard, jQuery .html, javascript: URLs
python.json     # python-specific: eval/exec, pickle, subprocess shell=True, os.system,
                # __import__, bare except, DEBUG=True, assert in prod, requests-no-timeout,
                # random for security, yaml.load, XML XXE, Flask/Django debug, mktemp,
                # paramiko AutoAddPolicy, ECB cipher, marshal/shelve, ssl.CERT_NONE
go.json         # Go: exec.Command shell -c, math/rand for security, crypto/md5+sha1 imports,
                # ListenAndServe without TLS, unsafe package import
jvm.json        # Java / C#: Runtime.exec, ObjectInputStream/XMLDecoder, ECB/DES Cipher,
                # Class.forName(dynamic), BinaryFormatter/SoapFormatter, SqlCommand concat,
                # Log4Shell ${jndi:} literals
scripting.json  # PHP / Ruby: eval, shell_exec/passthru, unserialize($_GET), dynamic include,
                # Marshal.load, OpenSSL VERIFY_NONE
infra.json      # Dockerfile / k8s yaml / IAM / terraform: USER root, ADD url, :latest tag,
                # --privileged, apt-get no cleanup, k8s privileged/runAsNonRoot/host*,
                # IAM Action=*+Resource=*, terraform 0.0.0.0/0 ingress
html.json       # HTML: target=_blank without noopener, external script without SRI,
                # form action over http://
vba.json        # VBA: SendKeys, Shell, WScript.Shell, Application.Run, On Error Resume Next
```

## Custom handlers

For rules whose logic regex alone can't express (absent argument, multi-line context, cross-statement state),
add a Python function to `security_scanner._RULE_HANDLERS` and reference it via `"custom_handler"`.

Handler signature: `(src: str, lines: list[str]) -> list[{'line': int, 'code': str}]`.

| Handler                       | Used by | Detects                                                                  |
|-------------------------------|---------|--------------------------------------------------------------------------|
| `python_requests_no_timeout`  | VZS039  | `requests.get/post/…()` calls missing `timeout=`                         |
| `python_xml_unsafe_parse`     | VZS073  | stdlib/lxml XML parse without `defusedxml`                               |
| `js_string_timer_call`        | VZS086  | `setTimeout` / `setInterval` whose first arg is a string literal         |
| `dockerfile_missing_user`     | VZS110  | Dockerfile with no `USER` directive or final `USER root` / `USER 0`      |
| `dockerfile_apt_no_cleanup`   | VZS114  | `RUN apt-get install …` block without lists-cleanup / `--no-install-recommends` |
| `iam_policy_action_wildcard`  | VZS117  | IAM policy / k8s RBAC granting `Action: '*'` on `Resource: '*'`          |

## Adding a rule

1. Pick the right file (or create a new `*.json` here).
2. Assign the next unused `VZS***` id (current max is `VZS121`).
3. Always include `keywords` — without them every rule runs a regex pass over every file. With them, ~5% of files actually hit the regex.
4. Use `entropy_capture_group` + `entropy_min` on generic-secret rules to suppress placeholder strings.
5. Add `deny_substrings_in_line` for env-var lookups (`process.env`, `os.environ`, `getenv`) so wrappers don't trip the rule.
6. Add `allowlist_substrings` like `example`, `placeholder`, `your-`, `xxxxxx`, `redacted` for obvious dummies.
7. Test on a fixture file; verify on at least one real repo to gauge false-positive rate.
8. If regex can't express the behaviour (e.g. checking absence of an arg, cross-line context), add a function in `security_scanner._RULE_HANDLERS` and reference it via `"custom_handler"`.
