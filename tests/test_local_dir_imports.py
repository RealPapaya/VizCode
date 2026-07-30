"""The .vizcode writers must work when imported as top-level modules.

conftest and the server both put src/core on sys.path and do `import analyze_viz`,
so these modules have no parent package and `from .local_dir import ...` raises
ImportError. Three writers used the relative form and silently did nothing:
result.json was never written (homepage "reopen scan" stayed empty),
scan_cache.json and health_history.json went stale. Each test below fails with
the relative-only import restored.
"""

import analyze_viz
import parse_memo
import result_store


def test_save_result_writes_result_json(tmp_path):
    out = result_store.save_result(str(tmp_path), {'stats': {'files': 1}, 'modules': []})

    assert out is not None, 'save_result swallowed a failure and returned None'
    assert (tmp_path / '.vizcode' / 'result.json').is_file()
    assert (tmp_path / '.vizcode' / 'result_meta.json').is_file()


def test_flush_memo_writes_scan_cache(tmp_path):
    parse_memo.flush_memo({'entries': {}}, tmp_path)

    assert (tmp_path / '.vizcode' / 'scan_cache.json').is_file()


def test_append_health_snapshot_writes_history(tmp_path):
    analyze_viz._append_health_snapshot(str(tmp_path), {'code_health_score': 7.5})

    assert (tmp_path / '.vizcode' / 'health_history.json').is_file()
