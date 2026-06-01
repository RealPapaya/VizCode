"""Tests for L3 symbol-report and MCP enrichment helpers."""

from analytics_helpers import generate_report_tree
from server.mcp_server import _tool_l3


def test_generate_report_tree_writes_l3_symbol_report(tmp_path):
    data = {
        'modules': [{'id': '_root', 'label': '_root'}],
        'module_edges': [],
        'files_by_module': {
            '_root': [{
                'id': 0,
                'path': 'app.py',
                'label': 'app.py',
                'ext': '.py',
                'file_type': 'py_source',
                'func_count': 1,
                'size': 10,
            }]
        },
        'file_edges_by_module': {'_root': []},
        'symbol_index': {
            'sym_0': {
                'id': 'sym_0',
                'name': 'Service',
                'kind': 'class',
                'file': 'app.py',
                'line': 1,
                'end_line': 5,
                'bases': [],
                'parent': None,
            },
            'sym_1': {
                'id': 'sym_1',
                'name': 'run',
                'kind': 'method',
                'file': 'app.py',
                'line': 2,
                'end_line': 4,
                'parent': 'Service',
                'signature': '(self) -> None',
            },
        },
        'symbol_edges': [{'from': 'sym_1', 'to': 'sym_0', 'type': 'type_usage'}],
        'stats': {'files': 1, 'modules': 1, 'functions': 1, 'calls': 0},
        'project_type': {},
    }

    generate_report_tree(data, str(tmp_path), scan_entries={})

    l3 = tmp_path / 'L3' / 'app.md'
    assert l3.exists()
    text = l3.read_text(encoding='utf-8')
    assert '# app.py (L3)' in text
    assert '`type_usage`: 1' in text
    assert '`run`' in text


def test_mcp_l3_reports_symbols_and_relationships():
    modules = {
        'app.py': {
            'funcdefs': [{'label': 'run'}],
            'func_calls_by_func': [['helper']],
            'symdefs': [
                {
                    'kind': 'class',
                    'name': 'Service',
                    'line': 1,
                    'end_line': 6,
                    'bases': ['BaseService'],
                    'parent': None,
                    'is_public': True,
                },
                {
                    'kind': 'method',
                    'name': 'run',
                    'line': 2,
                    'end_line': 4,
                    'parent': 'Service',
                    'signature': '(self)',
                    'is_public': True,
                },
                {
                    'kind': 'function',
                    'name': 'helper',
                    'line': 8,
                    'end_line': 9,
                    'parent': None,
                    'is_public': False,
                },
            ],
            'extras': {'docstrings': {'run': 'Run the service.'}},
        }
    }

    text = _tool_l3('app.py', modules)

    assert '=== app.py (L3) ===' in text
    assert '+class Service(BaseService)' in text
    assert '+method run (self)' in text
    assert 'Service --inheritance/implements--> BaseService' in text
    assert 'run --call--> helper' in text
