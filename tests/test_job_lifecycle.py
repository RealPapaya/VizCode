"""Tests for the analyser hot-reload guard and idle payload eviction.

Both were added after the 2026-07-30 health check found that (a) every analysis
reload()ed the analyser modules even while another analysis was running, and
(b) JOBS never released a finished job's html / search index.
"""

import sys
import time
from pathlib import Path

import pytest

_SERVER_DIR = Path(__file__).parent.parent / 'src' / 'server'
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

import job_manager


@pytest.fixture
def reload_spy(monkeypatch):
    """Record reload() targets instead of really reloading, and reset the counter."""
    calls = []
    monkeypatch.setattr(job_manager.importlib, 'reload', calls.append)
    monkeypatch.setattr(job_manager, '_ANALYSES_IN_FLIGHT', 0)
    return calls


@pytest.fixture
def job(monkeypatch):
    """An isolated JOBS registry holding one finished, still-resident job."""
    monkeypatch.setattr(job_manager, 'JOBS', {})
    entry = job_manager._make_job_dict('/proj')
    entry.update({
        'done': True,
        'data': {'stats': {}},
        'html': '<html>' + 'x' * 1000,
        'search_index': {'a.py': 'source'},
        'viewers': {},
        'viewer_tracking_started': True,
        'last_viewer_gone_at': time.time() - 3600,
    })
    job_manager.JOBS['j1'] = entry
    return entry


# ─── hot-reload guard ─────────────────────────────────────────────────────────

def test_enter_analysis_reloads_when_alone(reload_spy):
    assert job_manager._enter_analysis('mod_a', 'mod_b') is True
    assert reload_spy == ['mod_a', 'mod_b']
    job_manager._leave_analysis()


def test_enter_analysis_skips_reload_while_another_runs(reload_spy):
    job_manager._enter_analysis('mod_a')
    reload_spy.clear()

    assert job_manager._enter_analysis('mod_a') is False
    assert reload_spy == []

    job_manager._leave_analysis()
    job_manager._leave_analysis()


def test_reload_resumes_once_every_analysis_left(reload_spy):
    job_manager._enter_analysis('mod_a')
    job_manager._enter_analysis('mod_a')
    job_manager._leave_analysis()
    job_manager._leave_analysis()
    reload_spy.clear()

    assert job_manager._enter_analysis('mod_a') is True
    assert reload_spy == ['mod_a']
    job_manager._leave_analysis()


def test_leave_analysis_never_goes_negative(reload_spy):
    job_manager._leave_analysis()
    assert job_manager._ANALYSES_IN_FLIGHT == 0
    assert job_manager._enter_analysis('mod_a') is True
    job_manager._leave_analysis()


def test_a_failed_analysis_still_releases_its_slot(monkeypatch, reload_spy):
    """Without the `finally: _leave_analysis()` the counter leaks and hot-reload
    silently stops working for the rest of the process."""
    monkeypatch.setattr(job_manager, 'JOBS', {'j': job_manager._make_job_dict('/proj')})

    def boom():
        raise RuntimeError('pre_fn exploded')

    job_manager._run_analysis_thread('j', '/proj', pre_fn=boom)
    for _ in range(100):                      # the thread is daemonised
        if job_manager.JOBS['j'].get('done'):
            break
        time.sleep(0.02)

    assert job_manager.JOBS['j']['error'] == 'pre_fn exploded'
    assert job_manager._ANALYSES_IN_FLIGHT == 0


# ─── idle payload eviction ────────────────────────────────────────────────────

def test_evicts_the_built_page_when_viewers_gone(job):
    assert job_manager._evict_idle_job_payloads('j1') is True
    assert job['html'] is None
    # `data` is what /result rebuilds the page from — it must survive.
    assert job['data'] == {'stats': {}}


def test_search_index_survives_eviction(job):
    # /symbol-refs has no disk fallback and temp-dir jobs lose their source on
    # the same reap pass, so dropping this silently breaks search + references.
    job_manager._evict_idle_job_payloads('j1')

    assert job['search_index'] == {'a.py': 'source'}


def test_evict_is_idempotent(job):
    job_manager._evict_idle_job_payloads('j1')
    assert job_manager._evict_idle_job_payloads('j1') is False


def test_keeps_payloads_while_a_viewer_is_open(job):
    job['viewers'] = {'v1': time.time()}
    job['last_viewer_gone_at'] = None

    assert job_manager._evict_idle_job_payloads('j1') is False
    assert job['html'] is not None


def test_keeps_payloads_during_the_grace_period(job):
    job['last_viewer_gone_at'] = time.time()

    assert job_manager._evict_idle_job_payloads('j1') is False
    assert job['html'] is not None


def test_keeps_payloads_for_a_job_never_opened_in_a_browser(job):
    job['viewer_tracking_started'] = False

    assert job_manager._evict_idle_job_payloads('j1') is False
    assert job['html'] is not None


def test_keeps_payloads_for_a_running_job(job):
    job['done'] = False

    assert job_manager._evict_idle_job_payloads('j1') is False
    assert job['html'] is not None


def test_leaves_restored_scans_alone(job):
    # Restored scans exist purely so the homepage can reopen them.
    job['restored'] = True

    assert job_manager._evict_idle_job_payloads('j1') is False
    assert job['html'] is not None
