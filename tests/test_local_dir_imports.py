"""The .vizcode writers must work when imported as top-level modules.

conftest and the server both put src/core on sys.path and do `import analyze_viz`,
so these modules have no parent package and `from .local_dir import ...` raises
ImportError. Three writers used the relative form and silently did nothing:
result.json was never written (homepage "reopen scan" stayed empty),
scan_cache.json and health_history.json went stale. Each test below fails with
the relative-only import restored.
"""

import pytest

import analyze_viz
import local_dir
import parse_memo
import qa_cache
import result_store
import security_scanner
import semantic_enricher


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


# ─── a failed write must not be silent ────────────────────────────────────────
# These writers all swallow their exception on purpose (persistence is
# best-effort and must never abort a scan) — but swallowing it *quietly* is what
# let the relative-import bug above run unnoticed for six weeks.

def _explode(*_a, **_kw):
    raise OSError('disk on fire')


@pytest.mark.parametrize('module,call', [
    (local_dir,          lambda p: local_dir.ensure_local_dir(p)),
    (qa_cache,           lambda p: qa_cache._flush({}, p)),
    (semantic_enricher,  lambda p: semantic_enricher._flush_raw({}, p)),
])
def test_write_failure_is_reported(monkeypatch, capsys, tmp_path, module, call):
    monkeypatch.setattr('pathlib.Path.write_text', _explode)
    monkeypatch.setattr('pathlib.Path.mkdir', _explode)

    call(tmp_path)          # must not raise — persistence stays best-effort

    assert '[WARN]' in capsys.readouterr().err


def test_security_history_write_failure_is_reported(monkeypatch, capsys, tmp_path):
    monkeypatch.setattr('pathlib.Path.write_text', _explode)

    security_scanner.append_history(tmp_path, {})

    assert '[WARN]' in capsys.readouterr().err
