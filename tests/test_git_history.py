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


def test_aggregate_commits_by_day_keeps_commit_file_details():
    commits = [{
        'sha': 'abcdef1234567890',
        'date': '2026-06-01',
        'author': 'Dev One',
        'files': [
            {'path': 'src/app.py', 'add': 10, 'del': 2},
            {'path': 'static/app.css', 'add': 3, 'del': 0},
        ],
    }]

    grouped = git_history._aggregate_commits_by_day(commits)

    row = grouped['2026-06-01'][0]
    assert row['short_sha'] == 'abcdef12'
    assert row['author'] == 'Dev One'
    assert row['additions'] == 13
    assert row['deletions'] == 2
    assert row['file_count'] == 2
    assert row['files'] == [
        {'file': 'src/app.py', 'additions': 10, 'deletions': 2},
        {'file': 'static/app.css', 'additions': 3, 'deletions': 0},
    ]


def test_aggregate_commits_by_day_caps_large_file_lists(monkeypatch):
    monkeypatch.setattr(git_history, 'COMMIT_DETAIL_FILE_LIMIT', 2)
    commits = [{
        'sha': 'abcdef1234567890',
        'date': '2026-06-01',
        'author': 'Dev One',
        'files': [
            {'path': 'a.py', 'add': 1, 'del': 0},
            {'path': 'b.py', 'add': 2, 'del': 0},
            {'path': 'c.py', 'add': 3, 'del': 0},
        ],
    }]

    grouped = git_history._aggregate_commits_by_day(commits)

    row = grouped['2026-06-01'][0]
    assert row['file_count'] == 3
    assert len(row['files']) == 2
    assert row['files_capped'] is True
