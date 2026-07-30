"""Tests for the security scanner: real rules must fire, safe code must not.

The scanner is deliberately silent-failing everywhere (a bad rule must never
abort an analysis), which also means a rule file that stops loading would go
unnoticed — hence the load/compile assertions here.
"""

import json
from pathlib import Path

import pytest

import security_scanner as ss

_RULES_DIR = Path(__file__).parent.parent / 'src' / 'core' / 'security_rules'


@pytest.fixture(scope='module')
def rules():
    compiled = ss.compile_rules(ss.load_rules(_RULES_DIR))
    assert compiled, 'no rules compiled — the shipped rule files stopped loading'
    return compiled


# ─── rule loading ─────────────────────────────────────────────────────────────

def test_every_shipped_rule_file_compiles(rules):
    raw = ss.load_rules(_RULES_DIR)

    # compile_rules drops bad patterns silently; nothing shipped should be dropped
    assert len(rules) == len(raw)


def test_mismatched_schema_rev_is_skipped(tmp_path):
    (tmp_path / 'bad.json').write_text(
        json.dumps({'schema_rev': 999_999, 'rules': [{'id': 'x', 'pattern': 'x'}]}),
        encoding='utf-8')

    assert ss.load_rules(tmp_path) == []


def test_missing_rules_dir_is_not_fatal(tmp_path):
    assert ss.load_rules(tmp_path / 'nope') == []


# ─── detection ────────────────────────────────────────────────────────────────

def _ids(src, ext='.py', rel='a.py', rules=None):
    return {i['rule_id'] for i in ss.scan_file(src, ext, rel, rules)}


def test_flags_shell_injection(rules):
    found = _ids("import os\nos.system('rm -rf ' + user_input)\n", rules=rules)

    assert found, 'os.system with concatenated input was not flagged'


def test_flags_eval_of_user_input(rules):
    found = _ids('result = eval(request.args.get("q"))\n', rules=rules)

    assert found


def test_clean_code_is_quiet(rules):
    src = (
        'from pathlib import Path\n'
        '\n'
        'def read_config(path: Path) -> str:\n'
        '    return path.read_text(encoding="utf-8")\n'
    )

    assert _ids(src, rules=rules) == set()


def test_issue_records_carry_the_reporting_fields(rules):
    issues = ss.scan_file('eval(request.args.get("q"))\n', '.py', 'svc/api.py', rules)

    assert issues
    issue = issues[0]
    for field in ('rule_id', 'severity', 'title', 'line', 'desc', 'recommendation'):
        assert field in issue, f'missing {field}'
    assert issue['line'] == 1
    assert issue['severity'] in ('high', 'medium', 'low')


def test_a_throwing_rule_does_not_abort_the_scan(rules):
    class Exploding:
        def finditer(self, _text):
            raise RuntimeError('bad rule')

    src = 'result = eval(request.args.get("q"))\n'
    expected = _ids(src, rules=rules)
    assert expected, 'fixture no longer triggers any rule'

    broken = [{**rules[0], 'regex': Exploding(), 'id': 'boom'}]
    survived = _ids(src, rules=broken + list(rules))

    # the exploding rule must not swallow the findings of every rule after it
    assert survived == expected


# ─── aggregation ──────────────────────────────────────────────────────────────

def test_aggregate_counts_by_severity():
    file_security = {
        'a.py': [{'rule_id': 'r1', 'severity': 'high',   'title': 'H', 'file': 'a.py', 'line': 1},
                 {'rule_id': 'r2', 'severity': 'low',    'title': 'L', 'file': 'a.py', 'line': 2}],
        'b.py': [{'rule_id': 'r1', 'severity': 'high',   'title': 'H', 'file': 'b.py', 'line': 3}],
    }

    out = ss.aggregate(file_security)

    assert out['total'] == 3
    assert out['counts']['high'] == 2
    assert out['counts']['low'] == 1
    assert 0 <= out['score'] <= 10


def test_aggregate_of_a_clean_project_scores_top():
    out = ss.aggregate({})

    assert out['total'] == 0
    assert out['score'] == 10


# ─── entropy gate ─────────────────────────────────────────────────────────────

def test_shannon_entropy_ranks_random_above_repetitive():
    assert ss.shannon_entropy('') == 0.0
    assert ss.shannon_entropy('aaaaaaaa') == 0.0
    assert ss.shannon_entropy('aB3$xZ9!qW2#') > ss.shannon_entropy('aaaabbbb')
