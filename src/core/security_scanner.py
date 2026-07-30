#!/usr/bin/env python3
"""
core/security_scanner.py — VIZCODE regex-based security scanner.

Pure-function module: callers load rules once, pre-compile them, then call
scan_file(src, ext, rel, rules) per file. Zero external dependencies.

Rules live in src/core/security_rules/*.json. Secret-detection rules apply
a three-stage filter — keyword substring pre-check → regex → Shannon entropy
plus allowlist — to keep false positives low.

Per-scan history is appended to <project>/.vizcode/security_history.json
so the dashboard widget can render a trend sparkline across runs.
"""

import json
import math
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Tuple

# ─── Constants ───────────────────────────────────────────────────────────────

SEC_SCHEMA_REV    = 1
_HISTORY_FILENAME = "security_history.json"
_HISTORY_CAP      = 50

EXT_TO_LANG = {
    '.py':         'python',     '.pyw':  'python',     '.pyi':  'python',
    '.js':         'javascript', '.mjs':  'javascript', '.cjs':  'javascript',
    '.jsx':        'javascript',
    '.ts':         'typescript', '.tsx':  'typescript',
    '.go':         'go',
    '.java':       'java',
    '.cs':         'csharp',
    '.php':        'php',
    '.rb':         'ruby',
    '.html':       'html',       '.htm':  'html',
    '.vb':         'vba',        '.vba':  'vba',        '.bas':  'vba',
    '.cls':        'vba',        '.frm':  'vba',
    '.yml':        'yaml',       '.yaml': 'yaml',
    '.tf':         'terraform',  '.tfvars': 'terraform',
    '.dockerfile': 'dockerfile',
}

# Filename-based detection for files without a meaningful extension (Dockerfile).
# Matched on lower-cased basename after the extension lookup misses.
_FILENAME_TO_LANG = {
    'dockerfile':    'dockerfile',
    'containerfile': 'dockerfile',
}

SEVERITY_RANK = {'high': 3, 'medium': 2, 'low': 1}

# Per-issue score penalty before capping at 10.
_SCORE_PENALTY = {'high': 2.0, 'medium': 0.5, 'low': 0.1}

# Path segments that mark a file as test/fixture code.
_TEST_PATH_MARKERS = {'test', 'tests', 'spec', 'specs', '__tests__', 'fixtures', 'mocks'}

# Skip these suffixes outright.
_SKIP_SUFFIX           = ('.min.js', '.min.css', '.map', '.lock')
_MINIFIED_AVG_LINE_LEN = 500
_MAX_SCAN_BYTES        = 200_000  # ~200KB cap; minified bundles are still skipped above


# ─── Rule loading ─────────────────────────────────────────────────────────────

def load_rules(rules_dir: Path) -> List[dict]:
    """Load all ``*.json`` rule files in *rules_dir*; return the merged rule list.

    Each file should have shape ``{"schema_rev": 1, "rules": [...]}``.
    Files that fail to parse or have a mismatched schema_rev are skipped
    silently — security scanning must never abort an analysis.
    """
    rules: List[dict] = []
    if not rules_dir.is_dir():
        return rules
    for fp in sorted(rules_dir.glob('*.json')):
        try:
            # utf-8-sig tolerates an optional BOM (e.g. files re-saved by PowerShell).
            data = json.loads(fp.read_text(encoding='utf-8-sig'))
        except Exception:
            continue
        if not isinstance(data, dict):
            continue
        if data.get('schema_rev') != SEC_SCHEMA_REV:
            continue
        for r in data.get('rules', []) or []:
            if isinstance(r, dict) and r.get('id') and (r.get('pattern') or r.get('custom_handler')):
                rules.append(r)
    return rules


def compile_rules(rules: List[dict]) -> List[dict]:
    """Pre-compile regexes and bake derived fields.

    Returns a new list of dicts (originals are left untouched). Rules whose
    pattern fails to compile are dropped silently.
    """
    compiled: List[dict] = []
    for r in rules:
        try:
            entry = dict(r)
            entry['applies_to_set']        = set(r.get('applies_to', ['*']) or ['*'])
            pat                            = r.get('pattern')
            entry['_re']                   = re.compile(pat) if pat else None
            entry['_kws_lower']            = [str(k).lower() for k in (r.get('keywords')               or [])]
            entry['_deny_kws']             = [str(k).lower() for k in (r.get('deny_substrings_in_line') or [])]
            entry['_allow']                = [str(s).lower() for s in (r.get('allowlist_substrings')   or [])]
            entry['count_min']             = int(r.get('count_min')              or 0)
            entry['entropy_min']           = float(r.get('entropy_min')          or 0.0)
            entry['entropy_capture_group'] = int(r.get('entropy_capture_group')  or 0)
            entry['skip_in_tests']         = bool(r.get('skip_in_tests'))
            entry['custom_handler']        = r.get('custom_handler')
            compiled.append(entry)
        except re.error:
            continue
        except Exception:
            continue
    return compiled


# ─── Per-file scan ────────────────────────────────────────────────────────────

def scan_file(src: str, ext: str, rel: str, compiled_rules: List[dict]) -> List[dict]:
    """Scan a single file's text content; return list of issue dicts.

    Issue schema::

        {rule_id, severity, title, file, path, line, desc,
         code, recommendation}

    Silent-fail per rule: a rule that throws will not abort the whole scan.
    """
    if not src or not compiled_rules:
        return []
    if _should_skip(rel, src):
        return []

    lang     = _detect_lang(rel, ext)
    is_test  = _is_test_file(rel)
    lines    = src.split('\n')
    src_low  = src.lower()
    issues: List[dict] = []

    for rule in compiled_rules:
        try:
            applies = rule['applies_to_set']
            if '*' not in applies and lang not in applies:
                continue
            if rule['skip_in_tests'] and is_test:
                continue
            # Keyword pre-filter — cheap substring check before the regex pass.
            if rule['_kws_lower'] and not any(k in src_low for k in rule['_kws_lower']):
                continue

            handler = rule.get('custom_handler')
            if handler:
                hits = _RULE_HANDLERS.get(handler, _noop_handler)(src, lines)
            else:
                hits = _regex_scan(src, lines, rule)
            if not hits:
                continue

            # Count-threshold rules: only fire if N+ occurrences in this file.
            if rule['count_min'] and len(hits) < rule['count_min']:
                continue

            sev = rule.get('severity', 'low')
            if is_test:
                sev = _downgrade(sev)
                if sev == 'low':
                    # Drop noisy low-severity findings from test files entirely.
                    continue

            file_name = rel.rsplit('/', 1)[-1]
            if rule['count_min']:
                # Emit a single summary issue rather than N duplicates.
                issues.append({
                    'rule_id':        rule['id'],
                    'severity':       sev,
                    'title':          rule.get('name', rule['id']),
                    'file':           file_name,
                    'path':           rel,
                    'line':           None,
                    'desc':           f"{len(hits)} occurrences. " + rule.get('recommendation', ''),
                    'code':           '',
                    'recommendation': rule.get('recommendation', ''),
                })
                continue

            for hit in hits:
                issues.append({
                    'rule_id':        rule['id'],
                    'severity':       sev,
                    'title':          rule.get('name', rule['id']),
                    'file':           file_name,
                    'path':           rel,
                    'line':           hit.get('line'),
                    'desc':           rule.get('recommendation', ''),
                    'code':           hit.get('code', ''),
                    'recommendation': rule.get('recommendation', ''),
                })
        except Exception:
            continue

    return issues


def _regex_scan(src: str, lines: List[str], rule: dict) -> List[dict]:
    rx = rule['_re']
    if rx is None:
        return []
    hits: List[dict] = []
    for m in rx.finditer(src):
        full = m.group(0)
        # Line-level deny: skip if the line containing the match has any deny keyword.
        if rule['_deny_kws']:
            line_start = src.rfind('\n', 0, m.start()) + 1
            line_end   = src.find('\n', m.end())
            if line_end == -1:
                line_end = len(src)
            line_low = src[line_start:line_end].lower()
            if any(k in line_low for k in rule['_deny_kws']):
                continue
        # Allowlist + entropy filter (applied to capture group when configured).
        try:
            captured = m.group(rule['entropy_capture_group']) if rule['entropy_capture_group'] else full
        except (IndexError, re.error):
            captured = full
        captured_low = captured.lower()
        if rule['_allow'] and any(s in captured_low for s in rule['_allow']):
            continue
        if rule['entropy_min'] and shannon_entropy(captured) < rule['entropy_min']:
            continue
        line_no = src.count('\n', 0, m.start()) + 1
        code    = lines[line_no - 1].strip()[:80] if 0 < line_no <= len(lines) else ''
        hits.append({'line': line_no, 'code': code})
    return hits


def _should_skip(rel: str, src: str) -> bool:
    rl = rel.lower().replace('\\', '/')
    if any(rl.endswith(s) for s in _SKIP_SUFFIX):
        return True
    # Terraform state always contains real credentials post-apply — never report.
    if rl.endswith('.tfstate') or rl.endswith('.tfstate.backup'):
        return True
    if '/node_modules/' in rl or '/.vizcode/' in rl or '/vendor/' in rl or '/__pycache__/' in rl:
        return True
    if '/security_rules/' in rl:
        return True
    if len(src) > _MAX_SCAN_BYTES:
        return True
    # Crude minification heuristic.
    head     = src.split('\n', 50)
    sample_n = min(50, len(head))
    if sample_n >= 5:
        avg = sum(len(line) for line in head[:sample_n]) / sample_n
        if avg > _MINIFIED_AVG_LINE_LEN:
            return True
    return False


def _detect_lang(rel: str, ext: str) -> str:
    """Map *rel*/(ext) to a language tag understood by ``applies_to`` filters.

    Extension lookup wins first. Falls back to filename-based detection for
    files without a useful extension (Dockerfile, Containerfile, *.dockerfile).
    Unknown files become ``'text'`` and only match ``applies_to: ['*']`` rules.
    """
    ext_low = (ext or '').lower()
    lang    = EXT_TO_LANG.get(ext_low)
    if lang:
        return lang
    base = rel.replace('\\', '/').rsplit('/', 1)[-1].lower()
    if base in _FILENAME_TO_LANG:
        return _FILENAME_TO_LANG[base]
    if base.endswith('.dockerfile'):
        return 'dockerfile'
    return 'text'


def _is_test_file(rel: str) -> bool:
    rl    = rel.lower().replace('\\', '/')
    parts = rl.split('/')
    name  = parts[-1] if parts else rl
    if any(p in _TEST_PATH_MARKERS for p in parts[:-1]):
        return True
    if 'test' in name or '.spec.' in name or '_spec.' in name:
        return True
    return False


def _downgrade(sev: str) -> str:
    if sev == 'high':
        return 'medium'
    if sev == 'medium':
        return 'low'
    return 'low'


# ─── Custom rule handlers ─────────────────────────────────────────────────────

def _python_requests_no_timeout(src: str, lines: List[str]) -> List[dict]:
    """Flag ``requests.get/post/...()`` calls that have no ``timeout=`` arg.

    Balances parentheses to capture the full call so multi-line invocations
    are checked correctly. Emits one hit per call.
    """
    hits: List[dict] = []
    rx = re.compile(r'\brequests\.(?:get|post|put|delete|patch|head|options|request)\s*\(')
    n  = len(src)
    for m in rx.finditer(src):
        i     = m.end()
        depth = 1
        end   = i
        while end < n and depth > 0:
            ch = src[end]
            if ch == '(':
                depth += 1
            elif ch == ')':
                depth -= 1
                if depth == 0:
                    break
            end += 1
        body = src[i:end]
        if 'timeout' in body:
            continue
        line_no = src.count('\n', 0, m.start()) + 1
        code    = lines[line_no - 1].strip()[:80] if 0 < line_no <= len(lines) else ''
        hits.append({'line': line_no, 'code': code})
    return hits


def _python_xml_unsafe_parse(src: str, lines: List[str]) -> List[dict]:
    """Flag stdlib/lxml XML parsing calls when ``defusedxml`` is absent.

    XXE & billion-laughs attacks ride on ``xml.etree`` / ``xml.sax`` /
    ``xml.dom.minidom`` / ``lxml.etree``. If the file already pulls in
    ``defusedxml`` we assume the author swapped to a safe parser elsewhere
    and skip the report.
    """
    if 'defusedxml' in src:
        return []
    hits: List[dict] = []
    rx = re.compile(
        r'\b(?:'
        r'xml\.etree\.ElementTree\.(?:parse|fromstring|XML|iterparse)'
        r'|ElementTree\.(?:parse|fromstring|XML|iterparse)'
        r'|xml\.sax\.(?:parse|parseString|make_parser)'
        r'|xml\.dom\.minidom\.parse(?:String)?'
        r'|xml\.dom\.pulldom\.parse(?:String)?'
        r'|lxml\.etree\.(?:parse|fromstring|XML)'
        r')\s*\('
    )
    for m in rx.finditer(src):
        line_no = src.count('\n', 0, m.start()) + 1
        code    = lines[line_no - 1].strip()[:80] if 0 < line_no <= len(lines) else ''
        hits.append({'line': line_no, 'code': code})
    return hits


def _js_string_timer_call(src: str, lines: List[str]) -> List[dict]:
    """Flag ``setTimeout``/``setInterval`` invoked with a string-literal body.

    Passing a string to a timer routes through the same machinery as ``eval``.
    A function-reference or arrow callback is the safe form.
    """
    hits: List[dict] = []
    rx = re.compile(r'\b(?:setTimeout|setInterval)\s*\(\s*[\'"`]')
    for m in rx.finditer(src):
        line_no = src.count('\n', 0, m.start()) + 1
        code    = lines[line_no - 1].strip()[:80] if 0 < line_no <= len(lines) else ''
        hits.append({'line': line_no, 'code': code})
    return hits


def _dockerfile_missing_user(src: str, lines: List[str]) -> List[dict]:
    """Flag Dockerfiles whose effective user is root.

    Emits at most one hit per file: either ``(no USER directive)`` at line 1
    or the offending ``USER root`` / ``USER 0`` line.
    """
    user_hits: List[Tuple[int, str]] = []
    for i, ln in enumerate(lines, 1):
        stripped = ln.lstrip()
        if not stripped or stripped.startswith('#'):
            continue
        m = re.match(r'USER\s+(\S+)', stripped, re.IGNORECASE)
        if m:
            user_hits.append((i, m.group(1)))
    if not user_hits:
        # Only flag if the file actually looks like a Dockerfile body.
        if re.search(r'(?m)^\s*FROM\s+\S+', src, re.IGNORECASE):
            return [{'line': 1, 'code': '(no USER directive — container runs as root)'}]
        return []
    last_line, last_user = user_hits[-1]
    if last_user.lower() in ('root', '0', '0:0'):
        code = lines[last_line - 1].strip()[:80]
        return [{'line': last_line, 'code': code}]
    return []


def _dockerfile_apt_no_cleanup(src: str, lines: List[str]) -> List[dict]:
    """Flag ``apt-get install`` RUN blocks that leave package lists behind.

    A clean RUN block either purges ``/var/lib/apt/lists`` afterwards or uses
    ``--no-install-recommends``; everything else bloats image size and ships
    stale package metadata.
    """
    hits: List[dict] = []
    n = len(lines)
    i = 0
    while i < n:
        ln = lines[i].rstrip()
        stripped = ln.lstrip()
        if re.match(r'RUN\s', stripped, re.IGNORECASE):
            start_line = i + 1
            buf        = [stripped]
            while buf[-1].rstrip().endswith('\\') and i + 1 < n:
                i += 1
                buf.append(lines[i].rstrip())
            combined = ' '.join(seg.rstrip('\\').strip() for seg in buf).lower()
            if 'apt-get install' in combined or re.search(r'\bapt install\b', combined):
                if ('rm -rf /var/lib/apt/lists' not in combined
                        and '--no-install-recommends' not in combined):
                    code = lines[start_line - 1].strip()[:80]
                    hits.append({'line': start_line, 'code': code})
        i += 1
    return hits


def _iam_policy_action_wildcard(src: str, lines: List[str]) -> List[dict]:
    """Flag IAM-style policies that allow ``Action: '*'`` on ``Resource: '*'``.

    Works for both JSON (AWS / GCP) and YAML (k8s ClusterRole, CFN/SAM)
    without parsing the structure. We only emit hits when both wildcards
    coexist in the same file — either alone is too noisy to surface.
    """
    rx_action   = re.compile(r'''["']?Action["']?\s*[:=]\s*\[?\s*["']\*["']''')
    rx_resource = re.compile(r'''["']?Resource["']?\s*[:=]\s*\[?\s*["']\*["']''')
    rx_verbs    = re.compile(r'''["']?verbs["']?\s*:\s*\[\s*["']\*["']''')
    has_resource = bool(rx_resource.search(src))
    has_verbs    = bool(rx_verbs.search(src))
    action_hits  = list(rx_action.finditer(src))
    if not action_hits and not has_verbs:
        return []
    if action_hits and not has_resource:
        return []
    hits: List[dict] = []
    for m in (action_hits or list(rx_verbs.finditer(src))):
        line_no = src.count('\n', 0, m.start()) + 1
        code    = lines[line_no - 1].strip()[:80] if 0 < line_no <= len(lines) else ''
        hits.append({'line': line_no, 'code': code})
    return hits


def _noop_handler(src: str, lines: List[str]) -> List[dict]:
    return []


_RULE_HANDLERS = {
    'python_requests_no_timeout': _python_requests_no_timeout,
    'python_xml_unsafe_parse':    _python_xml_unsafe_parse,
    'js_string_timer_call':       _js_string_timer_call,
    'dockerfile_missing_user':    _dockerfile_missing_user,
    'dockerfile_apt_no_cleanup':  _dockerfile_apt_no_cleanup,
    'iam_policy_action_wildcard': _iam_policy_action_wildcard,
}


# ─── Aggregation ──────────────────────────────────────────────────────────────

def aggregate(file_security: dict) -> dict:
    """Aggregate per-file issues into the dashboard payload.

    Output schema::

        {score, total, counts: {high, medium, low},
         top_issues: [...],  by_severity: {high: [...], ...},
         by_rule: [{rule_id, title, severity, count, files}]}
    """
    counts: dict   = {'high': 0, 'medium': 0, 'low': 0}
    by_rule: dict  = {}
    by_sev:  dict  = {'high': [], 'medium': [], 'low': []}
    all_issues: List[dict] = []

    for rel, issues in (file_security or {}).items():
        for issue in issues or []:
            sev = issue.get('severity', 'low')
            if sev not in counts:
                sev = 'low'
            counts[sev] += 1
            by_sev[sev].append(issue)
            all_issues.append(issue)
            rid  = issue.get('rule_id', '?')
            slot = by_rule.setdefault(rid, {
                'rule_id':  rid,
                'title':    issue.get('title', rid),
                'severity': sev,
                'count':    0,
                'files':    [],
            })
            slot['count'] += 1
            if rel not in slot['files']:
                slot['files'].append(rel)

    penalty = sum(counts[k] * _SCORE_PENALTY[k] for k in counts)
    score   = round(10.0 - min(10.0, penalty), 1)

    all_issues.sort(key=lambda it: (
        -SEVERITY_RANK.get(it.get('severity', 'low'), 0),
        it.get('path', ''),
        it.get('line') or 0,
    ))

    return {
        'score':       score,
        'total':       sum(counts.values()),
        'counts':      counts,
        'top_issues':  all_issues[:12],
        'by_severity': {k: by_sev[k][:50] for k in by_sev},
        'by_rule':     sorted(
            by_rule.values(),
            key=lambda r: (-SEVERITY_RANK.get(r['severity'], 0), -r['count'], r['rule_id']),
        ),
    }


# ─── History persistence ──────────────────────────────────────────────────────

def append_history(project_root: Path, snapshot: dict) -> List[dict]:
    """Append a snapshot to ``.vizcode/security_history.json``; return the full history.

    Caps to the most recent _HISTORY_CAP entries. A failed write warns on stderr
    but never raises — the in-memory return is still correct so the widget can
    render the current run.
    """
    path                  = project_root / '.vizcode' / _HISTORY_FILENAME
    history: List[dict]   = []
    if path.is_file():
        try:
            data = json.loads(path.read_text(encoding='utf-8'))
            if isinstance(data, dict) and data.get('schema_rev') == SEC_SCHEMA_REV:
                ent = data.get('entries')
                if isinstance(ent, list):
                    history = ent
        except Exception:
            history = []

    ts    = datetime.now(timezone.utc).isoformat(timespec='seconds')
    entry = {
        'ts':     ts,
        'date':   ts[:10],
        'score':  snapshot.get('score', 10.0),
        'total':  snapshot.get('total', 0),
        'counts': snapshot.get('counts', {'high': 0, 'medium': 0, 'low': 0}),
    }
    history.append(entry)
    history = history[-_HISTORY_CAP:]

    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({'schema_rev': SEC_SCHEMA_REV, 'entries': history},
                       ensure_ascii=False, separators=(',', ':')),
            encoding='utf-8',
        )
    except Exception as e:
        print(f'[WARN] Security history write failed ({path}): {e}', file=sys.stderr)

    return history


# ─── Helpers ──────────────────────────────────────────────────────────────────

def shannon_entropy(s: str) -> float:
    """Shannon entropy in bits-per-character — used to gate generic-secret rules."""
    if not s:
        return 0.0
    freqs: dict = {}
    for ch in s:
        freqs[ch] = freqs.get(ch, 0) + 1
    n = float(len(s))
    return -sum((c / n) * math.log2(c / n) for c in freqs.values())
