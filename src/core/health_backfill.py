"""
health_backfill.py — Retroactive health history from git commits.

Workflow:
    1. `get_historical_commits(root, days, mode)` — query git log, return
       one commit per ISO-week ('sample') or one per calendar day ('full').
    2. `analyze_commit_health(root, sha, date)` — spin up a git worktree for
       that commit, run the full analysis pipeline (health score only), tear
       down the worktree, return a health-entry dict.
    3. `run_backfill(root, mode, days, progress)` — orchestrates 1+2, writes
       results to .vizcode/health_history.json, updates a shared `progress`
       dict for the server to poll.

Design constraints:
    * No writes to the analysed worktree — all output goes to the REAL
      project root's .vizcode directory.
    * Already-analysed dates are skipped (idempotent).
    * The shared `progress` dict is updated in-place so the HTTP server
      thread can read it without locks (Python GIL covers simple dict reads).
"""

import datetime
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


# ─── Git helpers ─────────────────────────────────────────────────────────────

def get_historical_commits(root: str, days: int = 90, mode: str = 'sample') -> list:
    """
    Return a list of {sha, date} dicts covering the last `days` calendar days.

    mode='sample'  → one commit per ISO-week  (~days/7  entries, max ~13)
    mode='full'    → one commit per day        (up to `days` entries)

    Commits are returned oldest-first so the chart builds left-to-right.
    """
    since = (datetime.date.today() - datetime.timedelta(days=days)).isoformat()
    try:
        proc = subprocess.run(
            ['git', 'log', '--format=%H|%ad', '--date=short',
             f'--since={since}', '--no-merges', '--first-parent'],
            cwd=root,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            encoding='utf-8', errors='replace',
            timeout=30,
        )
        raw = proc.stdout.strip()
    except Exception:
        return []

    if not raw:
        return []

    # git log is newest-first; first occurrence per bucket = newest of bucket
    all_commits = []
    for line in raw.splitlines():
        parts = line.split('|', 1)
        if len(parts) == 2:
            all_commits.append({'sha': parts[0].strip(), 'date': parts[1].strip()})

    if mode == 'sample':
        by_bucket = {}
        for c in all_commits:
            try:
                d = datetime.date.fromisoformat(c['date'])
                key = f"{d.year}-W{d.isocalendar()[1]:02d}"
            except Exception:
                key = c['date'][:7]
            if key not in by_bucket:
                by_bucket[key] = c
    else:
        by_bucket = {}
        for c in all_commits:
            if c['date'] not in by_bucket:
                by_bucket[c['date']] = c

    return sorted(by_bucket.values(), key=lambda x: x['date'])


# ─── Health history I/O ───────────────────────────────────────────────────────

def _history_path(root: str) -> Path:
    return Path(root) / '.vizcode' / 'health_history.json'


def _load_history(root: str) -> list:
    p = _history_path(root)
    if not p.is_file():
        return []
    try:
        data = json.loads(p.read_text(encoding='utf-8'))
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save_history(root: str, history: list) -> None:
    p = _history_path(root)
    p.parent.mkdir(parents=True, exist_ok=True)
    try:
        p.write_text(
            json.dumps(history, ensure_ascii=False, separators=(',', ':')),
            encoding='utf-8',
        )
    except Exception:
        pass


# ─── Per-commit analysis ──────────────────────────────────────────────────────

def analyze_commit_health(root: str, sha: str, date: str) -> dict | None:
    """
    Create a temporary git worktree for `sha`, run the analysis pipeline
    with snapshot-saving disabled, return a health-entry dict or None on failure.
    """
    tmpdir = tempfile.mkdtemp(prefix='vizcode_bf_')
    worktree_registered = False
    try:
        proc = subprocess.run(
            ['git', 'worktree', 'add', '--detach', tmpdir, sha],
            cwd=root,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            encoding='utf-8', errors='replace',
            timeout=60,
        )
        if proc.returncode != 0:
            return None
        worktree_registered = True

        # Lazily import build_graph to avoid circular imports at module load time.
        core_dir = os.path.dirname(os.path.abspath(__file__))
        if core_dir not in sys.path:
            sys.path.insert(0, core_dir)
        from analyze_viz import build_graph  # noqa: PLC0415

        result = build_graph(tmpdir, skip_health_snapshot=True)
        score     = result['stats'].get('code_health_score')
        breakdown = result['stats'].get('code_health_breakdown', {})
        if score is None:
            return None

        return {
            'ts':         date + 'T00:00:00Z',
            'date':       date,
            'commit':     sha[:8],
            'score':      round(float(score), 2),
            'breakdown':  {k: round(float(v), 2) for k, v in breakdown.items()},
            'backfilled': True,
        }

    except Exception:
        return None

    finally:
        if worktree_registered:
            try:
                subprocess.run(
                    ['git', 'worktree', 'remove', '--force', tmpdir],
                    cwd=root,
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    timeout=20,
                )
            except Exception:
                pass
        shutil.rmtree(tmpdir, ignore_errors=True)


# ─── Orchestrator (runs in a background thread) ───────────────────────────────

def run_backfill(root: str, mode: str, days: int, progress: dict) -> None:
    """
    Drive the backfill loop.  `progress` is a shared dict updated in-place
    so the HTTP server can read status without locks.

    Final shape of `progress`:
        done          int  — commits processed so far
        total         int  — commits to process (excluding already-done)
        skipped       int  — dates already in history
        current_sha   str  — short SHA being processed right now
        current_date  str  — date being processed right now
        new_count     int  — entries successfully added
        error         str|None
        finished      bool
    """
    progress.update({
        'done': 0, 'total': 0, 'skipped': 0,
        'current_sha': '', 'current_date': '',
        'new_count': 0, 'error': None, 'finished': False,
    })

    try:
        commits = get_historical_commits(root, days=days, mode=mode)
        if not commits:
            progress.update({'error': 'No git commits found in range', 'finished': True})
            return

        existing      = _load_history(root)
        existing_dates = {e.get('date') for e in existing}
        pending       = [c for c in commits if c['date'] not in existing_dates]

        progress['total']   = len(pending)
        progress['skipped'] = len(commits) - len(pending)

        if not pending:
            progress.update({'finished': True})
            return

        new_entries = []
        for i, commit in enumerate(pending):
            progress['done']         = i
            progress['current_sha']  = commit['sha'][:8]
            progress['current_date'] = commit['date']

            entry = analyze_commit_health(root, commit['sha'], commit['date'])
            if entry:
                new_entries.append(entry)
            progress['done'] = i + 1

        # Merge: one entry per date, keep the backfilled ones alongside real ones.
        merged = {e['date']: e for e in existing}
        for e in new_entries:
            if e['date'] not in merged:   # don't overwrite a real analysis entry
                merged[e['date']] = e
        history = sorted(merged.values(), key=lambda x: x.get('date', ''))
        history = history[-200:]

        _save_history(root, history)
        progress['new_count'] = len(new_entries)

    except Exception as ex:
        progress['error'] = str(ex)

    finally:
        progress['finished'] = True
