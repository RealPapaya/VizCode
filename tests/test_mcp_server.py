"""Tests for the MCP server's output budgeting and symbol index.

Both are consumed by every tool call (vizbridge.ToolRegistry reads the budgets,
vizcode_context/trace read the index), and neither had coverage.
"""

import importlib.util
import sys
from pathlib import Path

import pytest

_SERVER_DIR = Path(__file__).parent.parent / 'src' / 'server'
if str(_SERVER_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVER_DIR))

# Same namespace-package ambiguity as src/server/server.py — load by path.
_spec = importlib.util.spec_from_file_location('viz_mcp', _SERVER_DIR / 'mcp_server.py')
mcp = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mcp)


# ─── output budgets ───────────────────────────────────────────────────────────

@pytest.mark.parametrize('n_files,expected_l2', [
    # pinned against a literal, not a re-implementation of the comprehension
    (0, 6_000), (1, 6_000), (1499, 6_000),   # small/medium keep the base caps
    (1500, 9_000), (5999, 9_000),
    (6000, 12_000), (100_000, 12_000),
])
def test_budget_scales_with_repo_size(n_files, expected_l2):
    assert mcp._budget_for_filecount(n_files)['vizcode_l2'] == expected_l2


def test_budget_covers_every_tool_the_registry_dispatches():
    # Names come from the tool list, not from _BASE_TOOL_BUDGETS, so a tool added
    # without a budget entry is caught instead of passing by construction.
    budgets = mcp._budget_for_filecount(10)
    dispatched = {n for n in dir(mcp) if n.startswith('_tool_')}

    missing = {f"vizcode_{n[len('_tool_'):]}" for n in dispatched} - set(budgets)
    assert not missing, f'tools with no output budget: {sorted(missing)}'


@pytest.mark.parametrize('budget', [0, -1])
def test_budget_clamp_is_a_noop_without_a_budget(budget):
    assert mcp._budget_clamp('x' * 10_000, budget) == 'x' * 10_000


def test_budget_clamp_leaves_short_text_alone():
    assert mcp._budget_clamp('short', 100) == 'short'


def test_budget_clamp_truncates_and_says_so():
    out = mcp._budget_clamp('y' * 500, 100)

    assert out.startswith('y' * 100)
    assert 'output truncated to 100 chars' in out


# ─── import normalisation ─────────────────────────────────────────────────────

@pytest.mark.parametrize('imp,expected', [
    ('os', 'os'),                                  # python/go parsers
    ({'target': 'analyze_viz'}, 'analyze_viz'),    # dict form
    (['dependency', 'axios', 0], 'axios'),         # package.json parser
    ({}, ''),
])
def test_imp_name_handles_every_parser_shape(imp, expected):
    assert mcp._imp_name(imp) == expected


# ─── symbol index ─────────────────────────────────────────────────────────────

def _sym(name, kind='function', line=1):
    return {'name': name, 'kind': kind, 'line': line, 'is_public': True}


@pytest.fixture
def index():
    """app.py imports util.py twice over; both call helper() defined in util.py."""
    modules = {
        'util.py': {
            'symdefs': [_sym('helper')],
            'funcdefs': [{'label': 'helper'}],
            'func_calls_by_func': [[]],
            'imports': [],
        },
        'app.py': {
            'symdefs': [_sym('main')],
            'funcdefs': [{'label': 'main'}],
            'func_calls_by_func': [['helper', 'helper', 'nonexistent']],
            'imports': ['util'],
        },
        'cli.py': {
            'symdefs': [_sym('run')],
            'funcdefs': [{'label': 'run'}],
            'func_calls_by_func': [['helper']],
            'imports': ['util'],
        },
    }
    return mcp._build_symbol_index(modules, {'util': 'util.py', 'app': 'app.py', 'cli': 'cli.py'})


def test_defs_resolve_a_name_to_its_defining_file(index):
    assert [d['file'] for d in index['defs']['helper']] == ['util.py']
    assert index['defs']['helper'][0]['stable_id'] == 'util.py::helper'


def test_file_indegree_counts_inbound_imports(index):
    assert index['file_indeg'] == {'util.py': 2, 'app.py': 0, 'cli.py': 0}
    assert index['file_score']['util.py'] == 1.0
    assert index['file_score']['app.py'] == 0.0


def test_repeated_calls_within_one_function_count_once(index):
    # app.main calls helper twice; cli.run calls it once -> two distinct callers.
    assert index['sym_indeg'][('util.py', 'helper')] == 2
    assert index['callers'][('util.py', 'helper')] == {('app.py', 'main'), ('cli.py', 'run')}


def test_calls_to_undefined_names_are_dropped(index):
    # 'nonexistent' resolves nowhere, so it must not appear as a callee.
    assert index['callees'][('app.py', 'main')] == {('util.py', 'helper')}


def test_importers_and_imports_are_symmetric(index):
    assert set(index['file_importers']['util.py']) == {'app.py', 'cli.py'}
    assert index['file_imports']['app.py'] == ['util.py']


def test_empty_scan_cache_does_not_explode():
    out = mcp._build_symbol_index({}, {})

    assert out['defs'] == {}
    assert out['file_indeg'] == {}
    assert out['file_score'] == {}
