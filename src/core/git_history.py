#!/usr/bin/env python3
"""
core/git_history.py — VIZCODE Phase 2 Temporal Analysis

Single-pass `git log` parser that produces five temporal views:

    commit_activity_daily -> daily buckets for the contribution heatmap

    file_churn        → top files by recent commits / line additions / deletions
    change_coupling   → file pairs that change together within the window
    hotspot_files     → churn × complexity (top-ranked files needing attention)
    churn_timeline    → weekly buckets of commits / additions / deletions

Output is merged into the analytics dict by analyze_viz.build_graph and
consumed by the Temporal Analysis section in the dashboard.

Constants live at the top of the module so a maintainer can tune the time
window, the per-commit file cap, the coupling threshold, and the hotspot
formula's complexity-fallback in one place. Cache helpers ride along in
this same module.

Silent degradation rules (any of these returns None — caller treats it as
"no temporal data, hide the section"):

    * git binary missing             (FileNotFoundError)
    * git command timeout            (subprocess.TimeoutExpired, 60 s cap)
    * git command non-zero exit      (subprocess.CalledProcessError)
    * any other unexpected exception (Exception)
"""

import json
import os
import subprocess
from collections import Counter, defaultdict
from datetime import datetime, timedelta
from itertools import combinations
from pathlib import Path

# ─── Tunables ────────────────────────────────────────────────────────────────
DEFAULT_WINDOW_DAYS = 180
COMMIT_FILE_LIMIT   = 20      # skip commits touching > N files (refactor noise)
COUPLING_MIN        = 3       # filter pairs below this co-change count
GIT_TIMEOUT_SEC     = 60
SCHEMA_REV          = 5   # bump invalidates caches that lack temporal file groups

# Hotspot scoring tuning. Files without computed complexity get a neutral
# 0.5 multiplier so they're neither boosted nor punished by the score.
HOTSPOT_NEUTRAL_COMPLEXITY = 0.5
HOTSPOT_TOP_N              = 20

# Output slice limits (keep dashboard payload bounded).
TOP_FILE_CHURN     = 50
TOP_COUPLING_PAIRS = 30


# ─── Cache layer ─────────────────────────────────────────────────────────────

def _cache_path(root: str) -> Path:
    return Path(root) / '.vizcode' / 'git_history_cache.json'


def _head_sha(root: str) -> str:
    """Resolve current HEAD SHA, or empty string if anything goes wrong."""
    try:
        proc = subprocess.run(
            ['git', 'rev-parse', 'HEAD'],
            cwd=root,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            encoding='utf-8',
            errors='replace',
            timeout=10, check=True,
        )
        return proc.stdout.strip()
    except Exception:
        return ''


def _load_cache(root: str, window_days: int, head_sha: str) -> dict:
    """Return cached payload dict or None on any cache miss."""
    if not head_sha:
        return None
    path = _cache_path(root)
    if not path.is_file():
        return None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            blob = json.load(f)
    except Exception:
        return None
    if blob.get('schema_rev')  != SCHEMA_REV:    return None
    if blob.get('head_sha')    != head_sha:      return None
    if blob.get('window_days') != window_days:   return None
    return blob.get('payload')


def _save_cache(root: str, window_days: int, head_sha: str, payload: dict) -> None:
    if not head_sha:
        return
    try:
        path = _cache_path(root)
        path.parent.mkdir(parents=True, exist_ok=True)
        blob = {
            'schema_rev':  SCHEMA_REV,
            'head_sha':    head_sha,
            'window_days': window_days,
            'built_at':    datetime.utcnow().isoformat(timespec='seconds') + 'Z',
            'payload':     payload,
        }
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(blob, f, ensure_ascii=False, separators=(',', ':'))
    except Exception:
        pass  # cache write failures are non-fatal


# ─── git log invocation + parser ─────────────────────────────────────────────

def _run_git_log(root: str, since_days: int) -> str:
    """Return raw `git log` text, or empty string on any failure.

    The COMMIT header carries SHA / date / author name so the parser can
    aggregate per-author activity without a second git invocation.
    """
    try:
        proc = subprocess.run(
            ['git', 'log',
             f'--since={since_days} days ago',
             '--pretty=format:COMMIT %H %ad %an',
             '--date=short',
             '--numstat'],
            cwd=root,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            encoding='utf-8',
            errors='replace',
            timeout=GIT_TIMEOUT_SEC, check=True,
        )
        return proc.stdout
    except (FileNotFoundError, subprocess.TimeoutExpired,
            subprocess.CalledProcessError):
        return ''
    except Exception:
        return ''


def _parse_log(text: str) -> list:
    """Parse `git log --numstat` text into a list of commit dicts.

    Each commit dict is ``{'sha': str, 'date': 'YYYY-MM-DD',
    'files': [{'path': str, 'add': int, 'del': int}, ...]}``.
    Binary files (numstat shows '-') are recorded with add=del=0.
    """
    commits = []
    current = None
    for raw in text.splitlines():
        line = raw.rstrip()
        if not line:
            continue
        if line.startswith('COMMIT '):
            # Format: ``COMMIT <sha> <YYYY-MM-DD> <author name with spaces>``.
            # Author name comes last so split with maxsplit=3 keeps it intact.
            parts = line.split(' ', 3)
            if len(parts) >= 3:
                current = {
                    'sha':    parts[1],
                    'date':   parts[2],
                    'author': parts[3] if len(parts) >= 4 else '',
                    'files':  [],
                }
                commits.append(current)
            continue
        if current is None:
            continue
        bits = line.split('\t')
        if len(bits) != 3:
            continue
        adds, dels, path = bits
        try:
            add_n = int(adds) if adds.isdigit() else 0
            del_n = int(dels) if dels.isdigit() else 0
        except ValueError:
            add_n = del_n = 0
        # Normalise path separators for cross-platform comparison.
        current['files'].append({
            'path': path.replace('\\', '/'),
            'add':  add_n,
            'del':  del_n,
        })
    return commits


def _iso_week_start(date_str: str) -> str:
    """Return ISO date of the Monday that starts the week of *date_str*."""
    try:
        d = datetime.strptime(date_str, '%Y-%m-%d').date()
    except ValueError:
        return date_str
    monday = d - timedelta(days=d.weekday())
    return monday.isoformat()


def _window_bounds(window_days: int) -> tuple:
    """Return the UTC calendar bounds represented by the git history window."""
    end = datetime.utcnow().date()
    start = end - timedelta(days=window_days)
    return start.isoformat(), end.isoformat()


# ─── Aggregation passes ──────────────────────────────────────────────────────

def _aggregate_authors(commits: list) -> list:
    """Per-author commit / additions / deletions, ranked by commit count.

    Returns ``[{author, commits, additions, deletions, share}, ...]`` where
    ``share`` is the fraction of total commits in the window. Capped at 20.
    """
    per_commits = Counter()
    per_add     = Counter()
    per_del     = Counter()
    for c in commits:
        author = (c.get('author') or '').strip() or 'Unknown'
        per_commits[author] += 1
        for f in c['files']:
            per_add[author] += f['add']
            per_del[author] += f['del']
    total = len(commits) or 1
    rows = [{
        'author':    a,
        'commits':   per_commits[a],
        'additions': per_add[a],
        'deletions': per_del[a],
        'share':     round(per_commits[a] / total, 3),
    } for a in per_commits]
    rows.sort(key=lambda r: -r['commits'])
    return rows[:20]


def _aggregate_file_churn(commits: list) -> list:
    per_file_commits = Counter()
    per_file_add     = Counter()
    per_file_del     = Counter()
    for c in commits:
        for f in c['files']:
            per_file_commits[f['path']] += 1
            per_file_add[f['path']]     += f['add']
            per_file_del[f['path']]     += f['del']
    rows = [{
        'file':      path,
        'commits':   per_file_commits[path],
        'additions': per_file_add[path],
        'deletions': per_file_del[path],
    } for path in per_file_commits]
    rows.sort(key=lambda r: (-r['commits'], -(r['additions'] + r['deletions'])))
    return rows


def _aggregate_coupling(commits: list, total_commits: int) -> list:
    pair_count = Counter()
    for c in commits:
        files = sorted({f['path'] for f in c['files']})
        if len(files) < 2 or len(files) > COMMIT_FILE_LIMIT:
            continue
        for a, b in combinations(files, 2):
            pair_count[(a, b)] += 1
    rows = []
    denom = max(total_commits, 1)
    for (a, b), n in pair_count.items():
        if n < COUPLING_MIN:
            continue
        rows.append({
            'file_a':     a,
            'file_b':     b,
            'co_changes': n,
            'support':    round(n / denom, 3),
        })
    rows.sort(key=lambda r: -r['co_changes'])
    return rows[:TOP_COUPLING_PAIRS]


def _aggregate_timeline(commits: list) -> list:
    weekly_commits = Counter()
    weekly_add     = Counter()
    weekly_del     = Counter()
    for c in commits:
        wk = _iso_week_start(c['date'])
        weekly_commits[wk] += 1
        for f in c['files']:
            weekly_add[wk] += f['add']
            weekly_del[wk] += f['del']
    weeks = sorted(weekly_commits.keys())
    return [{
        'week_start': wk,
        'commits':    weekly_commits[wk],
        'additions':  weekly_add[wk],
        'deletions':  weekly_del[wk],
    } for wk in weeks]


def _aggregate_per_file_timeline(commits: list, file_paths: set) -> dict:
    """Per-file weekly churn for the supplied paths.

    Returns ``{file_path: [{week_start, commits, additions, deletions}, ...]}``
    sorted by week_start. Files with no commits inside the window are omitted.
    Used by the hotspot drilldown panel — restrict the input set so the
    payload size stays bounded (callers pass top-N churn files only).
    """
    if not file_paths:
        return {}
    weekly = defaultdict(lambda: defaultdict(lambda: {'commits': 0, 'add': 0, 'del': 0}))
    for c in commits:
        wk = _iso_week_start(c['date'])
        seen = set()
        for f in c['files']:
            path = f['path']
            if path not in file_paths:
                continue
            bucket = weekly[path][wk]
            if path not in seen:
                bucket['commits'] += 1
                seen.add(path)
            bucket['add'] += f['add']
            bucket['del'] += f['del']
    out = {}
    for path, weeks in weekly.items():
        rows = [{
            'week_start': wk,
            'commits':    weeks[wk]['commits'],
            'additions':  weeks[wk]['add'],
            'deletions':  weeks[wk]['del'],
        } for wk in sorted(weeks.keys())]
        out[path] = rows
    return out


def _aggregate_daily_activity(commits: list) -> list:
    daily_commits = Counter()
    daily_add     = Counter()
    daily_del     = Counter()
    for c in commits:
        day = c['date']
        daily_commits[day] += 1
        for f in c['files']:
            daily_add[day] += f['add']
            daily_del[day] += f['del']
    days = sorted(daily_commits.keys())
    return [{
        'date':      day,
        'commits':   daily_commits[day],
        'additions': daily_add[day],
        'deletions': daily_del[day],
    } for day in days]


def _aggregate_temporal_file_groups(commits: list) -> dict:
    """Return author/week/day groupings of changed files for dashboard drilldown."""
    authors = defaultdict(Counter)
    weeks   = defaultdict(Counter)
    days    = defaultdict(Counter)
    for c in commits:
        author = (c.get('author') or '').strip() or 'Unknown'
        day = c['date']
        week = _iso_week_start(day)
        for f in c['files']:
            path = f['path']
            authors[author][path] += 1
            weeks[week][path] += 1
            days[day][path] += 1

    def pack(counter_map):
        out = {}
        for key, counts in counter_map.items():
            out[key] = [
                {'file': path, 'count': count}
                for path, count in sorted(counts.items(), key=lambda item: (-item[1], item[0]))
            ]
        return out

    return {
        'files_by_author': pack(authors),
        'files_by_week':   pack(weeks),
        'files_by_day':    pack(days),
    }


# ─── Hotspot scoring (consumes file_churn + symbol_index) ────────────────────

_FUNC_KINDS = {'function', 'method'}


def _file_avg_complexity(symbol_index: dict) -> dict:
    """Return ``{file_path: avg_complexity}`` over function-shaped symbols."""
    sums = defaultdict(float)
    counts = defaultdict(int)
    for sym in symbol_index.values():
        if sym.get('kind') not in _FUNC_KINDS:
            continue
        cx = sym.get('complexity')
        if cx is None:
            continue
        sums[sym['file']]   += float(cx)
        counts[sym['file']] += 1
    return {f: (sums[f] / counts[f]) for f in sums if counts[f] > 0}


def _compute_hotspot(file_churn: list, symbol_index: dict, file_meta: dict) -> list:
    """Rank files by churn × complexity. Returns top 20 with score 0–100."""
    if not file_churn:
        return []
    avg_cx_by_file = _file_avg_complexity(symbol_index)

    max_commits = max((r['commits'] for r in file_churn), default=1) or 1
    max_avg_cx  = max(avg_cx_by_file.values(), default=1.0) or 1.0

    rows = []
    for r in file_churn:
        f = r['file']
        churn_norm = r['commits'] / max_commits
        if f in avg_cx_by_file:
            cx = avg_cx_by_file[f]
            cx_norm = cx / max_avg_cx
        else:
            cx = None
            cx_norm = HOTSPOT_NEUTRAL_COMPLEXITY
        score = round(churn_norm * cx_norm * 100, 1)
        rows.append({
            'file':           f,
            'churn':          r['commits'],
            'avg_complexity': round(cx, 1) if cx is not None else None,
            'score':          score,
        })
    rows.sort(key=lambda r: -r['score'])
    return rows[:HOTSPOT_TOP_N]


# ─── Public entry point ──────────────────────────────────────────────────────

def compute_git_history(root: str,
                        since_days: int = DEFAULT_WINDOW_DAYS) -> dict:
    """Return the full temporal payload, or ``None`` on any failure.

    Caches the result in ``.vizcode/git_history_cache.json`` keyed on
    HEAD SHA + window. Re-running on an unchanged tree returns the cached
    payload immediately without invoking git.
    """
    head = _head_sha(root)
    cached = _load_cache(root, since_days, head)
    if cached is not None:
        return cached

    text = _run_git_log(root, since_days)
    if not text:
        return None

    commits = _parse_log(text)
    if not commits:
        # git ran but the window has no commits — return empty-but-valid shape
        # so the frontend can render the "no commits in window" state.
        return _empty_payload(since_days)

    file_churn      = _aggregate_file_churn(commits)
    change_coupling = _aggregate_coupling(commits, len(commits))
    churn_timeline  = _aggregate_timeline(commits)
    daily_activity  = _aggregate_daily_activity(commits)
    author_activity = _aggregate_authors(commits)
    temporal_file_groups = _aggregate_temporal_file_groups(commits)
    # Per-file weekly timeline for the top churn files. Hotspots are a
    # strict subset of churn, so this is enough for the drilldown panel.
    top_churn_paths = {r['file'] for r in file_churn[:TOP_FILE_CHURN]}
    per_file_timeline = _aggregate_per_file_timeline(commits, top_churn_paths)
    window_start, window_end = _window_bounds(since_days)

    payload = {
        'window_days':      since_days,
        'window_start':     window_start,
        'window_end':       window_end,
        'period_start':     commits[-1]['date'],
        'period_end':       commits[0]['date'],
        'commits_analyzed': len(commits),
        'file_churn':       file_churn[:TOP_FILE_CHURN],
        'change_coupling':  change_coupling,
        # hotspot_files is filled in by the caller using symbol_index +
        # file_meta — we leave the slot here so the cached blob carries it.
        'hotspot_files':    [],
        'churn_timeline':   churn_timeline,
        'commit_activity_daily': daily_activity,
        'author_activity':  author_activity,
        'files_by_author':  temporal_file_groups['files_by_author'],
        'files_by_week':    temporal_file_groups['files_by_week'],
        'files_by_day':     temporal_file_groups['files_by_day'],
        'per_file_churn_timeline': per_file_timeline,
        # Carry the full file_churn (capped) so the caller can recompute
        # hotspot_files without re-running git when only complexity changed.
        '_full_file_churn': file_churn,
    }
    # Save to cache *before* hotspot computation — hotspot depends on
    # the in-memory symbol_index of the current run, not on git.
    _save_cache(root, since_days, head, payload)
    return payload


def _empty_payload(window_days: int) -> dict:
    """Shape returned when git ran but no commits fell inside the window."""
    start, end = _window_bounds(window_days)
    return {
        'window_days':      window_days,
        'window_start':     start,
        'window_end':       end,
        'period_start':     start,
        'period_end':       end,
        'commits_analyzed': 0,
        'file_churn':       [],
        'change_coupling':  [],
        'hotspot_files':    [],
        'churn_timeline':   [],
        'commit_activity_daily': [],
        'author_activity':  [],
        'files_by_author':  {},
        'files_by_week':    {},
        'files_by_day':     {},
        'per_file_churn_timeline': {},
        '_full_file_churn': [],
    }
