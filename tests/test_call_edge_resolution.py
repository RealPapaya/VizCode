"""
tests/test_call_edge_resolution.py — symbol call-edge resolution quality.

Parsers record call expressions by bare name (no receiver), so `re.finditer()`,
`map.get()` and `set.add()` reach the resolver as 'finditer' / 'get' / 'add'.
Resolving those by name alone attached every builtin call in a repo to whatever
project symbol shared the name — a single `get()` in one file collected 323
inbound edges and dominated hotspots, communities and MCP centrality ranking.
"""
import analyze_viz
from analyze_viz import build_graph


def _write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8')


def _call_edges(data):
    """{(from_name, to_name, to_file)} for every call edge."""
    si = data['symbol_index']
    out = set()
    for e in data['symbol_edges']:
        if e.get('type') != 'call':
            continue
        src, tgt = si.get(e['from'], {}), si.get(e['to'], {})
        out.add((src.get('name'), tgt.get('name'), tgt.get('file')))
    return out


def test_builtin_method_names_do_not_resolve_to_project_symbols(tmp_path):
    """`self.cache.get(...)` must not become a call edge to a local `get()`."""
    _write(tmp_path / 'store.py', '''\
import re

def get(key):
    return key

def add(item):
    return item

def lookup(cache, text):
    a = cache.get("k")
    b = cache.get("k2")
    c = re.finditer(r"x", text)
    d = set().add(1)
    return a, b, c, d
''')
    edges = _call_edges(build_graph(str(tmp_path), skip_health_snapshot=True))
    assert not [e for e in edges if e[0] == 'lookup'], (
        f'builtin method calls leaked into call edges: {edges}'
    )


def test_real_project_call_still_resolves(tmp_path):
    """The filter must not swallow ordinary same-file calls."""
    _write(tmp_path / 'app.py', '''\
def helper(value):
    return value * 2

def main():
    return helper(21)
''')
    edges = _call_edges(build_graph(str(tmp_path), skip_health_snapshot=True))
    assert ('main', 'helper', 'app.py') in edges


def test_ambiguous_cross_file_name_is_not_resolved_to_an_arbitrary_file(tmp_path):
    """Two files defining `render()` → a third file's `render()` call resolves
    to neither, instead of silently picking whichever was indexed first."""
    _write(tmp_path / 'a.py', 'def render(x):\n    return x\n')
    _write(tmp_path / 'b.py', 'def render(x):\n    return x\n')
    _write(tmp_path / 'c.py', 'def draw():\n    return render(1)\n')
    edges = _call_edges(build_graph(str(tmp_path), skip_health_snapshot=True))
    assert not [e for e in edges if e[0] == 'draw' and e[1] == 'render'], (
        f'ambiguous name resolved to an arbitrary definition: {edges}'
    )


def test_unique_cross_file_name_still_resolves(tmp_path):
    """One definition repo-wide → the cross-file edge is kept."""
    _write(tmp_path / 'a.py', 'def render_unique(x):\n    return x\n')
    _write(tmp_path / 'c.py', 'def draw():\n    return render_unique(1)\n')
    edges = _call_edges(build_graph(str(tmp_path), skip_health_snapshot=True))
    assert ('draw', 'render_unique', 'a.py') in edges


def test_builtin_call_names_covers_the_observed_offenders():
    """Names that manufactured fake hotspots when VizCode scanned itself."""
    for name in ('get', 'add', 'finditer', 'clear', 'read', 'now', 'start'):
        assert name in analyze_viz._BUILTIN_CALL_NAMES
    # Generic verbs a project is likely to own stay resolvable.
    for name in ('run', 'parse', 'send', 'emit', 'render', 'build'):
        assert name not in analyze_viz._BUILTIN_CALL_NAMES
