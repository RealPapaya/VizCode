#!/usr/bin/env python3
"""
core/security_scanner.py — VIZCODE regex-based security scanner.

Pure-function module modelled on code_health.py: callers load rules once,
pre-compile them, then call scan_file(src, ext, rel, rules) per file.

Zero external dependencies. Rules live in src/core/security_rules/*.json
in a DevSkim-inspired schema. Secret-detection rules apply a three-stage
filter (keyword substring pre-check → regex → Shannon entropy + allowlist)
to keep false positives low — modelled on Gitleaks.

Per-scan history is appended to <project>/.vizcode/security_history.json
so the dashboard widget can render a trend sparkline across runs.
"""

import json
import math
import re
from datetime import datetime, timezone
from pathlib import Path

# ─── Constants ───────────────────────────────────────────────────────────────

SEC_SCHEMA_REV    = 1
_HISTORY_FILENAME = "security_history.json"
_HISTORY_CAP      = 50

EXT_TO_LANG = {
    '.py':   'python',     '.pyw':  'python',     '.pyi':  'python',
    '.js':   'javascript', '.mjs':  'javascript', '.cjs':  'javascript',
    '.jsx':  'javascript',
    '.ts':   'typescript', '.tsx':  'typescript',
    '.go':   'go',
    '.java': 'java',
    '.cs':   'csharp',
    '.php':  'php',
    '.rb':   'ruby',
    '.html': 'html',       '.htm':  'html',
    '.vb':   'vba',        '.vba':  'vba',        '.bas':  'vba',
    '.cls':  'vba',        '.frm':  'vba',
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

def load_rules(rules_dir: Path) -> list[dict]:
    """Load all ``*.json`` rule files in *rules_dir*; return the merged rule list.

    Each file should have shape ``{"schema_rev": 1, "rules": [...]}``.
    Files that fail to parse or have a mismatched schema_rev are skipped
    silently — security scanning must never abort an analysis.
    """
    rules: list[dict] = []
    if not rules_dir.is_dir():
        return rules
    for fp in sorted(rules_dir.glob('*.json')):
        try:
            data = json.loads(fp.read_text(encoding='utf-8'))
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


def compile_rules(rules: list[dict]) -> list[dict]:
    """Pre-compile regexes and bake derived fields.

    Returns a new list of dicts (originals are left untouched). Rules whose
    pattern fails to compile are dropped silently.
    """
    compiled: list[dict] = []
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

def scan_file(src: str, ext: str, rel: str, compiled_rules: list[dict]) -> list[dict]:
    """Scan a single file's text content; return list of issue dicts.

    Issue schema::

        {rule_id, severity, title, file, path, line, desc,
         code, recommendation, source}

    Silent-fail per rule: a rule that throws will not abort the whole scan.
    """
    if not src or not compiled_rules:
        return []
    if _should_skip(rel, src):
        return []

    lang     = EXT_TO_LANG.get((ext or '').lower(), 'text')
    is_test  = _is_test_file(rel)
    lines    = src.split('\n')
    src_low  = src.lower()
    issues: list[dict] = []

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
                    'source':         rule.get('source', ''),
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
                    'source':         rule.get('source', ''),
                })
        except Exception:
            continue

    return issues


def _regex_scan(src: str, lines: list[str], rule: dict) -> list[dict]:
    rx = rule['_re']
    if rx is None:
        return []
    hits: list[dict] = []
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

def _python_requests_no_timeout(src: str, lines: list[str]) -> list[dict]:
    """Flag ``requests.get/post/...()`` calls that have no ``timeout=`` arg.

    Balances parentheses to capture the full call so multi-line invocations
    are checked correctly. Emits one hit per call.
    """
    hits: list[dict] = []
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


def _noop_handler(src: str, lines: list[str]) -> list[dict]:
    return []


_RULE_HANDLERS = {
    'python_requests_no_timeout': _python_requests_no_timeout,
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
    all_issues: list[dict] = []

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

def append_history(project_root: Path, snapshot: dict) -> list[dict]:
    """Append a snapshot to ``.vizcode/security_history.json``; return the full history.

    Caps to the most recent _HISTORY_CAP entries. Silent-fail on I/O — the
    in-memory return is still correct so the widget can render the current run.
    """
    path                  = project_root / '.vizcode' / _HISTORY_FILENAME
    history: list[dict]   = []
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
    except Exception:
        pass

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
