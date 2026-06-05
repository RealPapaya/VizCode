"""Tests for health history backfill selection behavior."""

from types import SimpleNamespace

import health_backfill


def test_get_historical_commits_commit_mode_keeps_every_commit(monkeypatch):
    raw = '\n'.join([
        'newsha|2026-06-02|2026-06-02T10:30:00+00:00',
        'oldsha|2026-06-02|2026-06-02T09:15:00+00:00',
    ])

    def fake_run(cmd, **kwargs):
        assert '--format=%H|%ad|%aI' in cmd
        assert 'capture_output' not in kwargs
        assert kwargs['stdout'] is health_backfill.subprocess.PIPE
        assert kwargs['stderr'] is health_backfill.subprocess.PIPE
        return SimpleNamespace(stdout=raw)

    monkeypatch.setattr(health_backfill.subprocess, 'run', fake_run)

    rows = health_backfill.get_historical_commits('/repo', days=7, mode='commits')

    assert [r['sha'] for r in rows] == ['oldsha', 'newsha']
    assert rows[0]['ts'] == '2026-06-02T09:15:00+00:00'


def test_get_historical_commits_full_mode_still_keeps_one_per_day(monkeypatch):
    raw = '\n'.join([
        'newsha|2026-06-02|2026-06-02T10:30:00+00:00',
        'oldsha|2026-06-02|2026-06-02T09:15:00+00:00',
        'prevsha|2026-06-01|2026-06-01T11:00:00+00:00',
    ])

    def fake_run(cmd, **kwargs):
        return SimpleNamespace(stdout=raw)

    monkeypatch.setattr(health_backfill.subprocess, 'run', fake_run)

    rows = health_backfill.get_historical_commits('/repo', days=7, mode='full')

    assert [r['sha'] for r in rows] == ['prevsha', 'newsha']
