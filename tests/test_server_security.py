"""Regression tests for the server-side path-traversal guards.

Covers two holes found in the 2026-07-30 health check:
  * /chat-history accepted an unsanitised session id (read AND write),
  * npm tarballs were extracted with no member validation.
"""

import gzip
import importlib.util
import io
import sys
import tarfile
from pathlib import Path

import pytest

# fetcher/server live in src/server/, which conftest does not put on sys.path.
_SERVER_DIR = Path(__file__).parent.parent / 'src' / 'server'
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

import fetcher

# `src/` is on sys.path too, so the bare name `server` is ambiguous: it resolves
# to src/server/ (namespace package) or src/server/server.py depending on which
# test imported first. Load the file directly under an unambiguous name.
_spec = importlib.util.spec_from_file_location('viz_server', _SERVER_DIR / 'server.py')
server = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(server)


# ─── session id whitelist ─────────────────────────────────────────────────────

@pytest.mark.parametrize('session_id', [
    'session_20260730_221346',
    'session_1',
    'abc-DEF_123',
])
def test_safe_session_id_accepts_frontend_ids(session_id):
    assert server._safe_session_id(session_id) == session_id


@pytest.mark.parametrize('session_id', [
    '../../../tsconfig',
    '..\\..\\..\\tsconfig',
    'a/b',
    '/etc/passwd',
    'C:\\Windows\\win',
    '..',
    '',
    'x' * 121,
])
def test_safe_session_id_rejects_traversal(session_id):
    assert server._safe_session_id(session_id) == ''


# ─── npm tarball extraction ───────────────────────────────────────────────────

def _tar_gz_with(name: str, *, link_to: str = None) -> bytes:
    """Build a one-entry .tar.gz whose member is named `name`."""
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode='w') as tf:
        if link_to:
            info = tarfile.TarInfo(name)
            info.type = tarfile.SYMTYPE
            info.linkname = link_to
            tf.addfile(info)
        else:
            payload = b'pwned'
            info = tarfile.TarInfo(name)
            info.size = len(payload)
            tf.addfile(info, io.BytesIO(payload))
    return gzip.compress(raw.getvalue())


def _serve(monkeypatch, blob: bytes):
    class _Resp:
        def read(self):
            return blob

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

    monkeypatch.setattr(fetcher, 'urlopen', lambda *a, **kw: _Resp())


@pytest.mark.parametrize('member', [
    '../../pwned.json',
    'package/../../pwned.json',
])
def test_npm_tarball_rejects_escaping_member(monkeypatch, tmp_path, member):
    _serve(monkeypatch, _tar_gz_with(member))
    with pytest.raises(RuntimeError, match='Unsafe path in tarball'):
        fetcher._download_npm_tarball('https://registry.npmjs.org/x', str(tmp_path))
    assert not (tmp_path.parent.parent / 'pwned.json').exists()


def test_npm_tarball_rejects_symlink_member(monkeypatch, tmp_path):
    _serve(monkeypatch, _tar_gz_with('package/link', link_to='/etc/passwd'))
    with pytest.raises(RuntimeError, match='Link entry not allowed'):
        fetcher._download_npm_tarball('https://registry.npmjs.org/x', str(tmp_path))


def test_npm_tarball_extracts_normal_package(monkeypatch, tmp_path):
    _serve(monkeypatch, _tar_gz_with('package/index.js'))
    root = fetcher._download_npm_tarball('https://registry.npmjs.org/x', str(tmp_path))
    assert root == str(tmp_path / 'package')
    assert (tmp_path / 'package' / 'index.js').read_bytes() == b'pwned'
