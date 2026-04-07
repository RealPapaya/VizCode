"""
tests/test_analyzer.py — Validate build_graph() output contract.

Tests run against the real testproject/ directory (multi-language smoke test).
"""
import pytest
from analyze_viz import build_graph

# ─── Required top-level keys in build_graph output ───────────────────────────

REQUIRED_KEYS = {
    'modules',
    'module_edges',
    'files_by_module',
    'file_edges_by_module',
    'funcs_by_file',
    'func_edges_by_file',
    'symbol_index',
    'symbol_edges',
    'stats',
    'project_type',
    'edge_types',
}

REQUIRED_STATS_KEYS = {'files', 'modules', 'functions', 'calls'}


# ─── Fixtures ─────────────────────────────────────────────────────────────────

@pytest.fixture(scope='module')
def graph(testproject_path):
    """Run build_graph once for the entire module — it's slow."""
    return build_graph(testproject_path)


# ─── Structural contract ──────────────────────────────────────────────────────

class TestBuildGraphContract:
    def test_returns_dict(self, graph):
        assert isinstance(graph, dict)

    def test_required_keys_present(self, graph):
        missing = REQUIRED_KEYS - set(graph.keys())
        assert not missing, f'Missing keys: {missing}'

    def test_stats_keys(self, graph):
        stats = graph['stats']
        missing = REQUIRED_STATS_KEYS - set(stats.keys())
        assert not missing, f'Missing stats keys: {missing}'

    def test_modules_is_list(self, graph):
        assert isinstance(graph['modules'], list)

    def test_module_edges_is_list(self, graph):
        assert isinstance(graph['module_edges'], list)

    def test_symbol_index_is_dict(self, graph):
        assert isinstance(graph['symbol_index'], dict)

    def test_symbol_edges_is_list(self, graph):
        assert isinstance(graph['symbol_edges'], list)

    def test_files_by_module_is_dict(self, graph):
        assert isinstance(graph['files_by_module'], dict)

    def test_funcs_by_file_is_dict(self, graph):
        assert isinstance(graph['funcs_by_file'], dict)


# ─── Content sanity (testproject has known multi-language files) ───────────────

class TestBuildGraphContent:
    def test_at_least_one_module(self, graph):
        assert len(graph['modules']) >= 1, 'Should detect at least one module'

    def test_at_least_one_file_scanned(self, graph):
        assert graph['stats']['files'] >= 1, 'Should scan at least one file'

    def test_project_type_is_dict(self, graph):
        pt = graph['project_type']
        assert isinstance(pt, dict)
        assert 'components' in pt or 'component_names' in pt

    def test_edge_types_is_dict(self, graph):
        assert isinstance(graph['edge_types'], dict)
        assert len(graph['edge_types']) > 0


# ─── Symbol index structure ───────────────────────────────────────────────────

class TestSymbolIndex:
    def test_each_symbol_has_required_fields(self, graph):
        symbol_index = graph['symbol_index']
        required = {'id', 'name', 'kind', 'file', 'line'}
        for sym_id, sym in list(symbol_index.items())[:50]:  # check first 50
            missing = required - set(sym.keys())
            assert not missing, f'Symbol {sym_id} missing fields: {missing}'

    def test_symbol_kinds_are_known(self, graph):
        known_kinds = {
            'class', 'struct', 'interface', 'enum', 'typedef',
            'function', 'method', 'field', 'enum_constant',
            'global_var', 'macro', 'union', 'namespace',
        }
        for sym in graph['symbol_index'].values():
            assert sym['kind'] in known_kinds, (
                f'Unknown symbol kind: {sym["kind"]!r} for {sym["name"]!r}'
            )


# ─── Symbol edges structure ───────────────────────────────────────────────────

class TestSymbolEdges:
    def test_each_edge_has_required_fields(self, graph):
        required = {'from', 'to', 'type'}
        for edge in graph['symbol_edges'][:100]:  # check first 100
            missing = required - set(edge.keys())
            assert not missing, f'Symbol edge missing fields: {missing}'

    def test_edge_types_are_known(self, graph):
        known_types = {
            'call', 'inheritance', 'type_usage', 'import',
            'override', 'include', 'member',
            'type_argument', 'specialization',
        }
        for edge in graph['symbol_edges'][:100]:
            assert edge['type'] in known_types, (
                f'Unknown edge type: {edge["type"]!r}'
            )


# ─── Module structure ─────────────────────────────────────────────────────────

class TestModules:
    def test_each_module_has_id_and_label(self, graph):
        for mod in graph['modules']:
            assert 'id' in mod, f'Module missing "id": {mod}'
            assert 'label' in mod, f'Module missing "label": {mod}'

    def test_files_by_module_keys_match_module_ids(self, graph):
        mod_ids = {m['id'] for m in graph['modules']}
        for key in graph['files_by_module']:
            assert key in mod_ids, f'files_by_module key {key!r} not in modules'
