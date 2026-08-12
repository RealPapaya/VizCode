"""
tests/test_parse_memo_prune.py — scan_cache.json must not accumulate ghosts.

The memo only ever grew: a deleted or renamed file kept its parse result
forever. Every consumer that reads scan_cache.json instead of re-walking the
tree (mcp_server, vizbridge, the L0/L1/health tools) then reports symbols from
files that no longer exist. VizCode scanning itself carried 75 such entries out
of 358 — the .js files deleted in the TypeScript migration were still ranked as
the heaviest files in the repo.
"""
from pathlib import Path

import parse_memo


def _memo_with(*rel_paths):
    memo = parse_memo.open_memo(Path('/nonexistent-root'))
    for rel in rel_paths:
        parse_memo.record_entry(memo, rel, 'sha', 'psha',
                                ([], [], [], {}, [], []))
    return memo


def test_prune_drops_entries_whose_file_is_gone(tmp_path):
    (tmp_path / 'kept.py').write_text('x = 1', encoding='utf-8')
    memo = _memo_with('kept.py', 'deleted.py', 'sub/also_deleted.py')

    removed = parse_memo.prune_deleted(memo, tmp_path)

    assert removed == 2
    assert set(memo['entries']) == {'kept.py'}


def test_prune_keeps_everything_that_still_exists(tmp_path):
    (tmp_path / 'a.py').write_text('x = 1', encoding='utf-8')
    (tmp_path / 'sub').mkdir()
    (tmp_path / 'sub' / 'b.py').write_text('y = 2', encoding='utf-8')
    memo = _memo_with('a.py', 'sub/b.py')

    assert parse_memo.prune_deleted(memo, tmp_path) == 0
    assert set(memo['entries']) == {'a.py', 'sub/b.py'}


def test_prune_survives_a_malformed_memo():
    assert parse_memo.prune_deleted({}, Path('.')) == 0
    assert parse_memo.prune_deleted({'entries': None}, Path('.')) == 0


def test_scan_writes_a_cache_without_ghosts(tmp_path):
    """End-to-end: delete a scanned file, rescan, the entry is gone."""
    from analyze_viz import build_graph

    (tmp_path / 'a.py').write_text('def a():\n    return 1\n', encoding='utf-8')
    (tmp_path / 'b.py').write_text('def b():\n    return 2\n', encoding='utf-8')
    build_graph(str(tmp_path), skip_health_snapshot=True)
    assert 'b.py' in parse_memo.open_memo(tmp_path)['entries']

    (tmp_path / 'b.py').unlink()
    build_graph(str(tmp_path), skip_health_snapshot=True)

    entries = parse_memo.open_memo(tmp_path)['entries']
    assert 'a.py' in entries
    assert 'b.py' not in entries
