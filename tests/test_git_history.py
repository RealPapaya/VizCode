"""Tests for git history subprocess compatibility."""

from types import SimpleNamespace

import git_history


def test_head_sha_uses_legacy_subprocess_capture(monkeypatch):
    def fake_run(cmd, **kwargs):
        assert cmd == ['git', 'rev-parse', 'HEAD']
        assert 'capture_output' not in kwargs
        assert 'text' not in kwargs
        assert kwargs['stdout'] is git_history.subprocess.PIPE
        assert kwargs['stderr'] is git_history.subprocess.PIPE
        assert kwargs['encoding'] == 'utf-8'
        assert kwargs['errors'] == 'replace'
        return SimpleNamespace(stdout='abc123\n')

    monkeypatch.setattr(git_history.subprocess, 'run', fake_run)

    assert git_history._head_sha('/repo') == 'abc123'


def test_run_git_log_uses_legacy_subprocess_capture(monkeypatch):
    raw_log = (
        'COMMIT abc123 2026-05-13 Dev\n'
        '2\t1\tstatic/features/Dashboard_view/dashboard_layout.js\n'
    )

    def fake_run(cmd, **kwargs):
        assert cmd[:2] == ['git', 'log']
        assert '--numstat' in cmd
        assert 'capture_output' not in kwargs
        assert 'text' not in kwargs
        assert kwargs['stdout'] is git_history.subprocess.PIPE
        assert kwargs['stderr'] is git_history.subprocess.PIPE
        assert kwargs['encoding'] == 'utf-8'
        assert kwargs['errors'] == 'replace'
        return SimpleNamespace(stdout=raw_log)

    monkeypatch.setattr(git_history.subprocess, 'run', fake_run)

    assert git_history._run_git_log('/repo', 180) == raw_log
