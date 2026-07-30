"""Regression tests for the server-side path-traversal guards.

Covers two holes found in the 2026-07-30 health check:
  * /chat-history accepted an unsanitised session id (read AND write),
  * npm tarballs were extracted with no member validation.
"""

import gzip
import http.client
import importlib.util
import io
import json
import sys
import tarfile
import threading
from email.message import Message
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import quote

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


# ─── local-only request guard (CSRF + DNS rebinding) ──────────────────────────

def _asks(method='GET', **headers):
    """Run _is_local_request against a request carrying exactly these headers.

    Uses a real email.message.Message because the handler calls get_all() to
    detect duplicate Host headers, which a plain dict cannot express.
    """
    msg = Message()
    for name, value in headers.items():
        msg[name.replace('_', '-')] = value
    return server.Handler._is_local_request(SimpleNamespace(headers=msg, command=method))


@pytest.mark.parametrize('value,expected', [
    ('127.0.0.1:7777', '127.0.0.1'),
    ('localhost', 'localhost'),
    ('localhost.', 'localhost'),                  # trailing-dot FQDN is legal
    ('http://127.0.0.1:7777', '127.0.0.1'),
    ('https://EVIL.com', 'evil.com'),
    ('https://evil.com/path', 'evil.com'),
    ('[::1]:7777', '[::1]'),
    # userinfo: the last colon sits inside it, so naive parsing reads 127.0.0.1
    ('http://127.0.0.1:80@evil.com', ''),
    ('[::1', ''),                                 # unterminated IPv6 literal
])
def test_hostname_of(value, expected):
    assert server._hostname_of(value) == expected


@pytest.mark.parametrize('headers', [
    {},                                                    # CLI / curl / MCP
    {'Sec-Fetch-Site': 'same-origin'},                     # the app's own fetch
    {'Sec-Fetch-Site': 'none'},                            # typed in the URL bar
    {'Host': 'localhost:7777'},
    {'Host': 'localhost.:7777'},
    {'Host': '127.0.0.1:7777', 'Origin': 'http://127.0.0.1:7777'},
])
def test_local_requests_are_allowed(headers):
    assert _asks(**headers) is True


@pytest.mark.parametrize('headers', [
    {'Sec-Fetch-Site': 'cross-site'},                      # a page on the web
    {'Origin': 'https://evil.com'},                        # cross-origin POST
    {'Host': 'evil.com'},                                  # DNS rebinding
    {'Origin': 'null'},                                    # sandboxed iframe
    {'Host': '127.0.0.1:7777', 'Origin': 'http://attacker.test'},
    {'Origin': 'http://127.0.0.1:80@evil.com'},            # userinfo smuggling
])
def test_foreign_requests_are_refused(headers):
    assert _asks(**headers) is False


def test_duplicate_host_headers_are_refused():
    msg = Message()
    msg['Host'] = 'localhost:7777'
    msg['Host'] = 'evil.com'

    assert server.Handler._is_local_request(
        SimpleNamespace(headers=msg, command='GET')) is False


def test_cross_site_link_navigation_is_allowed_but_only_for_get_documents():
    nav = {'Sec_Fetch_Site': 'cross-site', 'Sec_Fetch_Mode': 'navigate',
           'Sec_Fetch_Dest': 'document'}

    assert _asks('GET', **nav) is True
    assert _asks('POST', **nav) is False                   # a form CSRF post
    assert _asks('GET', Sec_Fetch_Site='cross-site', Sec_Fetch_Mode='no-cors',
                 Sec_Fetch_Dest='image') is False          # a pixel/beacon


# ─── end-to-end: the guards must actually be WIRED into the handlers ──────────
# The unit tests above pass even if `_refuse_foreign()` / `_safe_session_id()` are
# never called. These boot the real Handler and go over a socket, so deleting a
# call site fails here.

@pytest.fixture(scope='module')
def live_server():
    from http.server import ThreadingHTTPServer

    httpd = ThreadingHTTPServer(('127.0.0.1', 0), server.Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        yield httpd.server_address[1]
    finally:
        httpd.shutdown()
        httpd.server_close()


def _raw(port, method, path, headers=None, body=None):
    conn = http.client.HTTPConnection('127.0.0.1', port, timeout=15)
    try:
        conn.request(method, path, body=body, headers=dict(headers or {}))
        resp = conn.getresponse()
        resp.read()
        return resp.status
    finally:
        conn.close()


@pytest.mark.parametrize('method,path,headers,expected', [
    # cross-site fetch — refused by _refuse_foreign in do_GET / do_POST
    ('GET',  '/jobs',    {'Sec-Fetch-Site': 'cross-site'},        403),
    ('POST', '/analyze', {'Sec-Fetch-Site': 'cross-site'},        403),
    ('GET',  '/jobs',    {'Origin': 'https://evil.com'},          403),
    ('GET',  '/jobs',    {'Host': 'evil.com'},                    403),
    # legitimate traffic still gets through
    ('GET',  '/jobs',    {},                                      200),
    ('GET',  '/jobs',    {'Sec-Fetch-Site': 'same-origin'},       200),
    ('GET',  '/jobs',    {'Sec-Fetch-Site': 'none'},              200),
    # arriving by clicking a link from another site is a navigation, not an attack
    ('GET',  '/',        {'Sec-Fetch-Site': 'cross-site',
                          'Sec-Fetch-Mode': 'navigate',
                          'Sec-Fetch-Dest': 'document'},          200),
])
def test_guard_is_wired_into_the_handlers(live_server, method, path, headers, expected):
    body = '{}' if method == 'POST' else None
    assert _raw(live_server, method, path, headers, body) == expected


@pytest.mark.parametrize('query,expected', [
    ('?job=x&session=' + quote('../../../tsconfig', safe=''), 400),   # traversal
    ('?job=x&session=' + quote('..\\..\\tsconfig', safe=''),  400),
    ('?job=x&session=session_20260730',                       200),   # normal id
])
def test_chat_history_get_rejects_traversal_over_the_wire(live_server, query, expected):
    assert _raw(live_server, 'GET', '/chat-history' + query) == expected


def test_chat_history_post_rejects_traversal_over_the_wire(live_server):
    body = json.dumps({'job_id': 'x', 'session_id': '../../../pwned', 'history': []})
    status = _raw(live_server, 'POST', '/chat-history',
                  {'Content-Type': 'application/json'}, body)

    assert status == 400


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
    # Windows resolves these as separators too — a bare split('/') let them past.
    '..\\..\\pwned.json',
    'package\\..\\..\\pwned.json',
    'package/..\\..\\pwned.json',
    'D:pwned.json',                     # drive-relative, escapes to another drive
    '/etc/pwned.json',
])
def test_npm_tarball_rejects_escaping_member(monkeypatch, tmp_path, member):
    dest = tmp_path / 'a' / 'b' / 'c'
    dest.mkdir(parents=True)
    _serve(monkeypatch, _tar_gz_with(member))

    with pytest.raises(RuntimeError, match='Unsafe path in tarball'):
        fetcher._download_npm_tarball('https://registry.npmjs.org/x', str(dest))

    # nothing may have been written anywhere outside the destination
    assert list(tmp_path.rglob('pwned.json')) == []


def test_npm_tarball_rejects_symlink_member(monkeypatch, tmp_path):
    _serve(monkeypatch, _tar_gz_with('package/link', link_to='/etc/passwd'))
    with pytest.raises(RuntimeError, match='Link entry not allowed'):
        fetcher._download_npm_tarball('https://registry.npmjs.org/x', str(tmp_path))


def test_npm_tarball_extracts_normal_package(monkeypatch, tmp_path):
    _serve(monkeypatch, _tar_gz_with('package/index.js'))
    root = fetcher._download_npm_tarball('https://registry.npmjs.org/x', str(tmp_path))
    assert root == str(tmp_path / 'package')
    assert (tmp_path / 'package' / 'index.js').read_bytes() == b'pwned'
