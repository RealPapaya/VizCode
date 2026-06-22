"""
tests/test_analyzer.py — Validate build_graph() output contract.

Tests run against the real testproject/ directory (multi-language smoke test).
"""
import shutil
import subprocess

import pytest
import analyze_viz
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


def _init_git_repo(path):
    if not shutil.which('git'):
        pytest.skip('git CLI is required for git ignore tests')
    subprocess.run(
        ['git', 'init'],
        cwd=path,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        check=True,
    )


def _write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding='utf-8')


def _all_dashboard_paths(graph):
    paths = set()
    for files in graph.get('files_by_module', {}).values():
        paths.update(f['path'] for f in files)
    for files in graph.get('other_files_by_module', {}).values():
        paths.update(f['path'] for f in files)
    return paths


def _file_edge_paths(graph):
    id_to_path = {}
    for files in graph.get('files_by_module', {}).values():
        for item in files:
            id_to_path[item['id']] = item['path']
    edges = []
    for module_edges in graph.get('file_edges_by_module', {}).values():
        for edge in module_edges:
            edges.append((id_to_path.get(edge['s']), id_to_path.get(edge['t']), edge))
    return edges


def _symbol_edge_name_pairs(graph, edge_type):
    sym_idx = graph.get('symbol_index') or {}
    pairs = set()
    for edge in graph.get('symbol_edges') or []:
        if edge.get('type') != edge_type:
            continue
        src = sym_idx.get(edge.get('from'), {})
        tgt = sym_idx.get(edge.get('to'), {})
        pairs.add((src.get('name'), tgt.get('name')))
    return pairs


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

    def test_c_cpp_and_csharp_use_dedicated_parsers(self):
        assert analyze_viz._get_parser_fn('.c').__name__ == 'scan_c_cpp'
        assert analyze_viz._get_parser_fn('.cpp').__name__ == 'scan_c_cpp'
        assert analyze_viz._get_parser_fn('.h').__name__ == 'scan_c_cpp'
        assert analyze_viz._get_parser_fn('.cs').__name__ == 'scan_csharp'
        assert analyze_viz._get_parser_fn('.inf').__name__ == 'scan_uefi'
        assert analyze_viz._get_parser_fn('.asl').__name__ == 'scan_acpi'
        assert analyze_viz._get_parser_fn('.nasm').__name__ == 'scan_asm'

    def test_parser_edge_hints_enrich_l1_edges(self, tmp_path, monkeypatch):
        src = tmp_path / 'src.py'
        target = tmp_path / 'target.css'
        src.write_text('SRC\n', encoding='utf-8')
        target.write_text('body {}\n', encoding='utf-8')

        def fake_parse(file_bytes, ext):
            if file_bytes.decode('utf-8', errors='replace').startswith('SRC'):
                return (
                    [], [], [],
                    {
                        'edge_hints': [{
                            'type': 'asset_ref',
                            'target': 'target.css',
                            'subtype': 'stylesheet',
                            'via': 'href',
                            'line': 1,
                            'confidence': 1.0,
                        }]
                    },
                    [], [],
                )
            return [], [], [], {}, [], []

        monkeypatch.setattr(analyze_viz, '_compute_parse_result', fake_parse)
        graph = build_graph(str(tmp_path), skip_health_snapshot=True)
        root_edges = graph['file_edges_by_module'].get('_root', [])

        assert any(
            e['type'] == 'asset_ref'
            and e.get('subtype') == 'stylesheet'
            and e.get('via') == 'href'
            and e.get('origin') == 'parser'
            for e in root_edges
        )

    def test_html_css_yaml_json_edge_hints_resolve_to_typed_l1_edges(self, tmp_path):
        _write(tmp_path / 'index.html', '''\
<script src="./app.js"></script>
<link rel="stylesheet" href="./site.css">
<a href="./doc.html">Doc</a>
''')
        _write(tmp_path / 'app.js', 'function run() {}\n')
        _write(tmp_path / 'site.css', '@import "./base.css";\n')
        _write(tmp_path / 'base.css', 'body { color: black; }\n')
        _write(tmp_path / 'doc.html', '<main id="doc"></main>\n')
        _write(tmp_path / 'schema.yaml', '$ref: ./defs.json#/Thing\nfile: ./settings.yaml\n')
        _write(tmp_path / 'defs.json', '{}\n')
        _write(tmp_path / 'settings.yaml', 'enabled: true\n')
        _write(tmp_path / 'tsconfig.json', '''{
  "extends": "./base.json",
  "references": [{"path": "./tsconfig.app.json"}],
  "$ref": "./schema.json#/defs/Thing"
}''')
        _write(tmp_path / 'base.json', '{}\n')
        _write(tmp_path / 'tsconfig.app.json', '{}\n')
        _write(tmp_path / 'schema.json', '{}\n')

        graph = build_graph(str(tmp_path), skip_health_snapshot=True)
        edges = _file_edge_paths(graph)

        assert any(
            src == 'index.html' and tgt == 'app.js'
            and edge['type'] == 'asset_ref'
            and edge.get('subtype') == 'script'
            and edge.get('via') == 'src'
            and edge.get('origin') == 'parser'
            and edge.get('line') == 1
            for src, tgt, edge in edges
        )
        assert not any(
            src == 'index.html' and tgt == 'app.js'
            and edge['type'] == 'import'
            and edge.get('origin') != 'parser'
            for src, tgt, edge in edges
        )
        assert any(
            src == 'index.html' and tgt == 'site.css'
            and edge['type'] == 'asset_ref'
            and edge.get('subtype') == 'stylesheet'
            for src, tgt, edge in edges
        )
        assert any(
            src == 'index.html' and tgt == 'doc.html'
            and edge['type'] == 'import'
            and edge.get('subtype') == 'document'
            for src, tgt, edge in edges
        )
        assert any(
            src == 'site.css' and tgt == 'base.css'
            and edge['type'] == 'asset_ref'
            and edge.get('subtype') == 'stylesheet'
            for src, tgt, edge in edges
        )
        assert any(
            src == 'schema.yaml' and tgt == 'defs.json'
            and edge['type'] == 'schema_ref'
            and edge.get('via') == '$ref'
            for src, tgt, edge in edges
        )
        assert any(
            src == 'tsconfig.json' and tgt == 'base.json'
            and edge['type'] == 'config_ref'
            and edge.get('via') == 'extends'
            for src, tgt, edge in edges
        )

    def test_shell_schema_edge_hints_resolve_to_l1_edges(self, tmp_path):
        _write(tmp_path / 'build.ps1', '''\
Import-Module Pester
Import-Module ./LocalModule.psm1
. ./shared.ps1
using module './Types.psm1'
''')
        _write(tmp_path / 'LocalModule.psm1', 'function Invoke-Local {}\n')
        _write(tmp_path / 'shared.ps1', 'function Invoke-Shared {}\n')
        _write(tmp_path / 'Types.psm1', 'class Widget {}\n')
        _write(tmp_path / 'schema.graphql', '#import "user.graphql"\ntype Query { user: User }\n')
        _write(tmp_path / 'user.graphql', 'type User { id: ID! }\n')
        _write(tmp_path / 'widget.proto', 'syntax = "proto3";\nimport "types.proto";\nmessage Widget {}\n')
        _write(tmp_path / 'types.proto', 'syntax = "proto3";\nmessage Types {}\n')

        graph = build_graph(str(tmp_path), skip_health_snapshot=True)
        edges = _file_edge_paths(graph)

        assert any(
            src == 'build.ps1' and tgt == 'shared.ps1'
            and edge['type'] == 'include'
            and edge.get('via') == 'dot-source'
            and edge.get('origin') == 'parser'
            for src, tgt, edge in edges
        )
        assert any(
            src == 'build.ps1' and tgt == 'LocalModule.psm1'
            and edge['type'] == 'import'
            and edge.get('via') == 'Import-Module'
            for src, tgt, edge in edges
        )
        assert any(
            src == 'schema.graphql' and tgt == 'user.graphql'
            and edge['type'] == 'import'
            and edge.get('subtype') == 'schema'
            for src, tgt, edge in edges
        )
        assert any(
            src == 'widget.proto' and tgt == 'types.proto'
            and edge['type'] == 'import'
            and edge.get('subtype') == 'proto'
            for src, tgt, edge in edges
        )

    def test_testproject_parser_enrichment_fixtures_create_expected_edges(self, graph):
        file_edges = _file_edge_paths(graph)

        assert any(
            src == 'proto/schema_enrichment_probe.graphql'
            and tgt == 'proto/schema_probe_fragments.graphql'
            and edge['type'] == 'import'
            and edge.get('subtype') == 'schema'
            and edge.get('via') == '#import'
            for src, tgt, edge in file_edges
        )

        type_usage = _symbol_edge_name_pairs(graph, 'type_usage')
        implements = _symbol_edge_name_pairs(graph, 'implements')

        assert ('SchemaProbeJob', 'SchemaProbeNode') in implements

        expected_type_usage = {
            ('SchemaProbeNode', 'SchemaProbeUser'),
            ('SchemaProbeJobFilter', 'SchemaProbeUser'),
            ('SchemaProbeJob', 'SchemaProbeUser'),
            ('SchemaProbeJob', 'SchemaProbeJobResult'),
            ('result', 'SchemaProbeJobFilter'),
            ('result', 'SchemaProbeJobResult'),
            ('ProbeTaskDetail', 'ProbeActor'),
            ('ProbeTaskRequest', 'ProbeTaskDetail'),
            ('ProbeTaskRequest', 'ProbeActor'),
            ('ResolveProbeTask', 'ProbeTaskRequest'),
            ('ResolveProbeTask', 'ProbeTaskResponse'),
            ('probe_jobs', 'probe_owners'),
            ('probe_audit', 'probe_jobs'),
            ('probe_job_summary', 'probe_jobs'),
            ('probe_job_summary', 'probe_owners'),
            ('probe_touch_jobs', 'probe_jobs'),
            ('probe_touch_jobs', 'probe_audit'),
        }
        missing = expected_type_usage - type_usage
        assert not missing, f'Missing parser enrichment type_usage edges: {missing}'


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
            'record', 'module', 'trait', 'type', 'abstract',
            'impl', 'object', 'message', 'service', 'table', 'view',
            'input', 'scalar', 'fragment', 'key', 'keyframes',
            'protocol', 'mixin',
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
            'call', 'inheritance', 'implements', 'type_usage', 'import',
            'override', 'include', 'member',
            'mixin_include', 'mixin_extend', 'mixin_prepend',
            'behaviour_impl', 'protocol_impl',
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


class TestGitIgnoreFiltering:
    def test_git_ignored_files_are_excluded_from_dashboard_inputs(self, tmp_path):
        _init_git_repo(tmp_path)
        _write(tmp_path / '.gitignore', 'ignored.py\nignored.js\nignored.css\n')
        _write(tmp_path / 'kept.py', 'def kept():\n    return 1\n')
        _write(tmp_path / 'ignored.py', 'eval("1 + 1")\n')
        _write(tmp_path / 'ignored.js', 'console.log("ignored")\n')
        _write(tmp_path / 'ignored.css', '.ignored { color: red; }\n')
        # .dat is neither a scanned source ext nor skipped -> a "visible other file"
        # (.txt is now a scanned doc, so it would count as a source file here).
        _write(tmp_path / 'notes.dat', 'visible other file\n')

        graph = build_graph(str(tmp_path))
        paths = _all_dashboard_paths(graph)

        assert 'kept.py' in paths
        assert 'notes.dat' in paths
        assert 'ignored.py' not in paths
        assert 'ignored.js' not in paths
        assert 'ignored.css' not in paths
        assert graph['stats']['ignore_filter_enabled'] is True
        assert graph['stats']['ignore_filter_mode'] == 'git'
        assert graph['stats']['ignored_files'] == 3
        assert graph['stats']['files'] == 1
        security = graph['stats'].get('security_findings', {})
        issue_paths = {
            issue.get('path') or issue.get('file')
            for issue in security.get('top_issues', [])
        }
        assert 'ignored.py' not in issue_paths

    def test_git_ignore_nested_patterns_and_negation_match_git(self, tmp_path):
        _init_git_repo(tmp_path)
        _write(tmp_path / '.gitignore', 'nested/ignored_root.py\n')
        _write(tmp_path / 'nested' / '.gitignore', '*.js\n!keep.js\n')
        _write(tmp_path / 'nested' / 'keep.py', 'def keep_py():\n    return 1\n')
        _write(tmp_path / 'nested' / 'ignored_root.py', 'def ignored_root():\n    return 1\n')
        _write(tmp_path / 'nested' / 'drop.js', 'console.log("drop")\n')
        _write(tmp_path / 'nested' / 'keep.js', 'console.log("keep")\n')

        graph = build_graph(str(tmp_path))
        paths = _all_dashboard_paths(graph)

        assert 'nested/keep.py' in paths
        assert 'nested/keep.js' in paths
        assert 'nested/ignored_root.py' not in paths
        assert 'nested/drop.js' not in paths
        assert graph['stats']['ignored_files'] == 2

    def test_tracked_files_matching_gitignore_are_still_analyzed(self, tmp_path):
        _init_git_repo(tmp_path)
        _write(tmp_path / '.gitignore', '*.py\n')
        _write(tmp_path / 'tracked.py', 'def tracked():\n    return 1\n')
        subprocess.run(
            ['git', 'add', '-f', '.gitignore', 'tracked.py'],
            cwd=tmp_path,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )

        graph = build_graph(str(tmp_path))

        assert 'tracked.py' in _all_dashboard_paths(graph)
        assert graph['stats']['files'] == 1

    def test_parent_ignored_analysis_root_does_not_hide_project(self, tmp_path):
        _init_git_repo(tmp_path)
        _write(tmp_path / '.gitignore', 'sample/\n')
        _write(tmp_path / 'sample' / 'main.py', 'def main():\n    return 1\n')

        graph = build_graph(str(tmp_path / 'sample'))

        assert 'main.py' in _all_dashboard_paths(graph)
        assert graph['stats']['files'] == 1
        assert graph['stats']['ignore_filter_enabled'] is False

    def test_non_git_directory_uses_fallback_filter(self, tmp_path):
        _write(tmp_path / '.gitignore', 'ignored.py\n')
        _write(tmp_path / 'kept.py', 'def kept():\n    return 1\n')
        _write(tmp_path / 'ignored.py', 'def ignored_but_visible_without_git():\n    return 1\n')

        graph = build_graph(str(tmp_path))
        paths = _all_dashboard_paths(graph)

        assert 'ignored.py' in paths
        assert graph['stats']['ignore_filter_enabled'] is False
        assert graph['stats']['ignore_filter_mode'] == 'fallback'
        assert graph['stats']['ignored_files'] == 0

    def test_git_cli_failure_falls_back_without_aborting(self, tmp_path, monkeypatch):
        _write(tmp_path / '.gitignore', 'ignored.py\n')
        _write(tmp_path / 'ignored.py', 'def visible_when_git_fails():\n    return 1\n')

        def fail_run(*args, **kwargs):
            raise FileNotFoundError('git unavailable')

        monkeypatch.setattr(analyze_viz.subprocess, 'run', fail_run)
        graph = build_graph(str(tmp_path))

        assert 'ignored.py' in _all_dashboard_paths(graph)
        assert graph['stats']['ignore_filter_enabled'] is False
        assert graph['stats']['ignore_filter_mode'] == 'fallback'
