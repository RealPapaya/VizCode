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
from typing import Optional


HISTORY_LIMIT = 500


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
            ['git', 'log', '--format=%H|%ad|%aI', '--date=short',
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
        parts = line.split('|', 2)
        if len(parts) >= 2:
            all_commits.append({
                'sha':  parts[0].strip(),
                'date': parts[1].strip(),
                'ts':   parts[2].strip() if len(parts) >= 3 else '',
            })

    if mode in ('commit', 'commits'):
        return sorted(all_commits, key=lambda x: (x.get('ts') or x.get('date') or '', x.get('sha') or ''))

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
    except Exception as e:
        print(f'[WARN] Health history write failed ({p}): {e}', file=sys.stderr)


# ─── Per-commit analysis ──────────────────────────────────────────────────────

def analyze_commit_health(root: str, sha: str, date: str, ts: str = '') -> Optional[dict]:
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
            'ts':         ts or (date + 'T00:00:00Z'),
            'date':       date,
            'commit':     sha[:8],
            'commit_full': sha,
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

        existing = _load_history(root)
        if mode in ('commit', 'commits'):
            existing_full = {
                str(e.get('commit_full') or e.get('sha') or '').lower()
                for e in existing
                if e.get('commit_full') or e.get('sha')
            }
            existing_short = {
                str(e.get('commit') or '')[:8].lower()
                for e in existing
                if e.get('commit')
            }
            pending = [
                c for c in commits
                if str(c.get('sha') or '').lower() not in existing_full
                and str(c.get('sha') or '')[:8].lower() not in existing_short
            ]
        else:
            existing_dates = {e.get('date') for e in existing}
            pending = [c for c in commits if c['date'] not in existing_dates]

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

            entry = analyze_commit_health(root, commit['sha'], commit['date'], commit.get('ts', ''))
            if entry:
                new_entries.append(entry)
            progress['done'] = i + 1

        # Merge: commit-level entries can coexist on the same date; sampled
        # daily entries keep their date key so existing real analyses win.
        def key_for(entry: dict) -> str:
            commit = str(entry.get('commit_full') or '').strip().lower()
            if commit:
                return 'commit:' + commit
            if entry.get('backfilled') and entry.get('commit'):
                return 'commit:' + str(entry.get('commit')).strip().lower()
            return 'date:' + str(entry.get('date') or (entry.get('ts') or '')[:10])

        merged = {}
        for e in existing:
            key = key_for(e)
            if key and key not in merged:
                merged[key] = e
        for e in new_entries:
            key = key_for(e)
            if key and key not in merged:   # don't overwrite existing data
                merged[key] = e
        history = sorted(
            merged.values(),
            key=lambda x: (x.get('date', ''), x.get('ts', ''), x.get('commit', '')),
        )
        history = history[-HISTORY_LIMIT:]

        _save_history(root, history)
        progress['new_count'] = len(new_entries)

    except Exception as ex:
        progress['error'] = str(ex)

    finally:
        progress['finished'] = True
