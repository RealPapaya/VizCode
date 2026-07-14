"""
tests/test_harness_scan.py — calibration and contract tests for harness_scan.

Calibration targets (defined in plan P4 before coding):
  (a) bare/empty repo              → score < 1.0,  level none_adhoc
  (b) only a 500-line CLAUDE.md    → 2.0 <= score <= 3.5, level basic
  (c) rich fixture (see below)     → score >= 6.0, level engineered or self_improving
  (d) structural invariants        → weights sum 1.0, correct keys, posix paths
"""

import json
import sys
from pathlib import Path

import pytest

# Ensure src/core is importable even when run directly (conftest.py also does this)
_ROOT = Path(__file__).parent.parent
for _p in (str(_ROOT / 'src' / 'core'), str(_ROOT / 'src'), str(_ROOT)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from harness_scan import WEIGHTS, compute_harness_scan  # noqa: E402

DIMS = list(WEIGHTS)


# ─── Smoke: must never raise ──────────────────────────────────────────────────

class TestSmoke:
    def test_nonexistent_dir(self, tmp_path):
        result = compute_harness_scan(str(tmp_path / 'nonexistent'))
        assert isinstance(result, dict)
        assert result['score'] == 0.0

    def test_none_arg(self):
        result = compute_harness_scan(None)
        assert isinstance(result, dict)
        assert result['score'] == 0.0

    def test_empty_string(self):
        result = compute_harness_scan('')
        assert isinstance(result, dict)
        assert result['score'] == 0.0

    def test_empty_dir(self, tmp_path):
        result = compute_harness_scan(str(tmp_path))
        assert isinstance(result, dict)  # must not raise


# ─── Contract shape invariants (d) ───────────────────────────────────────────

class TestContract:
    def test_all_seven_keys(self, tmp_path):
        r = compute_harness_scan(str(tmp_path))
        assert set(r.keys()) == {'score', 'level', 'breakdown', 'weights',
                                  'evidence', 'missing', 'scanned'}

    def test_weights_sum_to_1(self):
        assert abs(sum(WEIGHTS.values()) - 1.0) < 1e-9

    def test_breakdown_has_six_dims(self, tmp_path):
        r = compute_harness_scan(str(tmp_path))
        assert set(r['breakdown'].keys()) == set(DIMS)

    def test_evidence_has_six_dims(self, tmp_path):
        r = compute_harness_scan(str(tmp_path))
        assert set(r['evidence'].keys()) == set(DIMS)

    def test_missing_has_six_dims(self, tmp_path):
        r = compute_harness_scan(str(tmp_path))
        assert set(r['missing'].keys()) == set(DIMS)

    def test_evidence_paths_are_posix(self, tmp_path):
        """Every evidence path must be repo-relative posix: no backslash, not absolute."""
        # Create a few files so some dimensions have evidence
        (tmp_path / 'CLAUDE.md').write_text('# Instructions\n' + 'x\n' * 60)
        (tmp_path / '.mcp.json').write_text('{"mcpServers": {}}')
        (tmp_path / 'LESSONS.md').write_text(
            '## fix-foo (2026-01-01)\n- Trap: x\n- Cost: y\n- Rule: z\n'
        )
        r = compute_harness_scan(str(tmp_path))
        for dim, ev_list in r['evidence'].items():
            for ev in ev_list:
                path = ev['path']
                assert isinstance(path, str), f"[{dim}] path is not str: {path!r}"
                assert '\\' not in path, f"[{dim}] backslash in path: {path!r}"
                assert not Path(path).is_absolute(), f"[{dim}] absolute path: {path!r}"

    def test_score_in_range(self, tmp_path):
        r = compute_harness_scan(str(tmp_path))
        assert 0.0 <= r['score'] <= 10.0

    def test_level_is_valid_string(self, tmp_path):
        r = compute_harness_scan(str(tmp_path))
        assert r['level'] in ('none_adhoc', 'basic', 'structured', 'engineered', 'self_improving')


# ─── Calibration (a): empty repo ─────────────────────────────────────────────

class TestCalibrationA:
    def test_score_below_1(self, tmp_path):
        r = compute_harness_scan(str(tmp_path))
        assert r['score'] < 1.0, f"empty repo score too high: {r['score']}"

    def test_level_none_adhoc(self, tmp_path):
        r = compute_harness_scan(str(tmp_path))
        assert r['level'] == 'none_adhoc'


# ─── Calibration (b): single 500-line CLAUDE.md ───────────────────────────────

class TestCalibrationB:
    @pytest.fixture
    def single_claude(self, tmp_path):
        (tmp_path / 'CLAUDE.md').write_text('# Instructions\n' + 'Generic line.\n' * 499)
        return tmp_path

    def test_score_in_basic_range(self, single_claude):
        r = compute_harness_scan(str(single_claude))
        assert 2.0 <= r['score'] <= 3.5, (
            f"score out of range: {r['score']}\nbreakdown: {r['breakdown']}"
        )

    def test_level_is_basic(self, single_claude):
        r = compute_harness_scan(str(single_claude))
        assert r['level'] == 'basic', (
            f"expected basic, got {r['level']} (score={r['score']})"
        )


# ─── Calibration (c): rich fixture ───────────────────────────────────────────

@pytest.fixture
def rich_fixture(tmp_path):
    """Fixture encoding the plan's 'rich' calibration scenario."""
    # Thin CLAUDE.md index (<=150 lines)
    (tmp_path / 'CLAUDE.md').write_text(
        '# Project\nRead AGENTS.md for rules.\nDo not touch build/.\n' + 'x\n' * 80
    )
    # AGENTS.md — instruction file that mentions pytest
    (tmp_path / 'AGENTS.md').write_text(
        '# Agent rules\nRun pytest to test the project.\n' + 'x\n' * 80
    )
    # LESSONS.md with dated-slug entries
    (tmp_path / 'LESSONS.md').write_text(
        '## fix-import-path (2026-07-01)\n'
        '- Trap: path issue\n- Cost: 1h\n- Rule: use absolute paths\n\n'
        '## add-test-coverage (2026-06-15)\n'
        '- Trap: missing tests\n- Cost: 0.5h\n- Rule: write tests first\n'
    )
    # tests/ with test files
    td = tmp_path / 'tests'
    td.mkdir()
    (td / 'test_core.py').write_text('def test_dummy(): pass\n')
    (td / 'test_utils.py').write_text('def test_util(): pass\n')
    # .github/workflows/ci.yml
    wf = tmp_path / '.github' / 'workflows'
    wf.mkdir(parents=True)
    (wf / 'ci.yml').write_text(
        'name: CI\non: [push]\njobs:\n  test:\n    runs-on: ubuntu-latest\n'
    )
    # .claude/settings.json with permissions block
    cd = tmp_path / '.claude'
    cd.mkdir()
    (cd / 'settings.json').write_text(
        json.dumps({'permissions': {'allow': ['Bash', 'Read'], 'deny': []}})
    )
    # .claude/agents/reviewer.md — structural delegation artifact
    ad = cd / 'agents'
    ad.mkdir()
    (ad / 'reviewer.md').write_text('# Reviewer Agent\nRun: python review.py\n')
    # .mcp.json
    (tmp_path / '.mcp.json').write_text('{"mcpServers": {}}')
    # .gitignore covering .env
    (tmp_path / '.gitignore').write_text('.env\n*.pyc\n__pycache__/\nbuild/\n')
    return tmp_path


class TestCalibrationC:
    def test_score_at_least_6(self, rich_fixture):
        r = compute_harness_scan(str(rich_fixture))
        assert r['score'] >= 6.0, (
            f"rich fixture score too low: {r['score']}\nbreakdown: {r['breakdown']}"
        )

    def test_level_engineered_or_self_improving(self, rich_fixture):
        r = compute_harness_scan(str(rich_fixture))
        assert r['level'] in ('engineered', 'self_improving'), (
            f"unexpected level: {r['level']} (score={r['score']})"
        )

    def test_memory_dimension_high(self, rich_fixture):
        """LESSONS.md with dated slugs should score well in memory_learning."""
        r = compute_harness_scan(str(rich_fixture))
        assert r['breakdown']['memory_learning'] >= 6.0, (
            f"memory_learning too low: {r['breakdown']['memory_learning']}"
        )

    def test_self_improving_needs_memory(self, rich_fixture):
        """If level is self_improving, memory_learning must be >= 6."""
        r = compute_harness_scan(str(rich_fixture))
        if r['level'] == 'self_improving':
            assert r['breakdown']['memory_learning'] >= 6.0
