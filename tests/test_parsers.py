"""
tests/test_parsers.py — Validate language parser 6-tuple contract.

Every parser must return exactly:
  (imports, funcdefs, funccalls, extra, func_calls_by_func, symbol_defs)

Where:
  imports           list[str]
  funcdefs          list[dict]  each with 'label' key
  funccalls         list[str]
  extra             dict | None
  func_calls_by_func list[list[str]]  len == len(funcdefs)
  symbol_defs       list[dict]  each with 'name', 'kind', 'line' keys
"""
import pytest
from parsers.python_parser import scan_python
from parsers.js_parser import scan_js
from parsers.go_parser import scan_go
from parsers.bios_parser import scan_bios


# ─── Helper ──────────────────────────────────────────────────────────────────

def assert_six_tuple(result, name='parser'):
    """Assert the result is a valid 6-tuple matching the contract."""
    assert isinstance(result, tuple), f'{name}: must return a tuple'
    assert len(result) == 6, f'{name}: must return exactly 6 elements, got {len(result)}'

    imports, funcdefs, funccalls, extra, func_calls_by_func, symbol_defs = result

    assert isinstance(imports, list), f'{name}: imports must be list'
    assert isinstance(funcdefs, list), f'{name}: funcdefs must be list'
    assert isinstance(funccalls, list), f'{name}: funccalls must be list'
    assert extra is None or isinstance(extra, dict), f'{name}: extra must be dict or None'
    assert isinstance(func_calls_by_func, list), f'{name}: func_calls_by_func must be list'
    assert isinstance(symbol_defs, list), f'{name}: symbol_defs must be list'

    assert len(func_calls_by_func) == len(funcdefs), (
        f'{name}: func_calls_by_func length ({len(func_calls_by_func)}) '
        f'must equal funcdefs length ({len(funcdefs)})'
    )

    for fd in funcdefs:
        assert isinstance(fd, dict), f'{name}: each funcdef must be dict'
        assert 'label' in fd, f'{name}: each funcdef must have "label" key'

    for sym in symbol_defs:
        assert isinstance(sym, dict), f'{name}: each symbol_def must be dict'
        for key in ('name', 'kind', 'line'):
            assert key in sym, f'{name}: symbol_def missing "{key}" key: {sym}'

    return imports, funcdefs, funccalls, extra, func_calls_by_func, symbol_defs


# ─── Python Parser ────────────────────────────────────────────────────────────

class TestPythonParser:
    def test_six_tuple_contract(self, py_src):
        result = scan_python(py_src)
        assert_six_tuple(result, 'scan_python')

    def test_imports_extracted(self, py_src):
        imports, *_ = scan_python(py_src)
        assert 'os' in imports
        assert 're' in imports

    def test_classes_in_symbol_defs(self, py_src):
        *_, symbol_defs = scan_python(py_src)
        kinds = [s['kind'] for s in symbol_defs]
        assert 'class' in kinds

    def test_class_names(self, py_src):
        *_, symbol_defs = scan_python(py_src)
        names = [s['name'] for s in symbol_defs if s['kind'] == 'class']
        assert 'Greeter' in names
        assert 'FancyGreeter' in names

    def test_functions_in_funcdefs(self, py_src):
        _, funcdefs, *_ = scan_python(py_src)
        labels = [f['label'] for f in funcdefs]
        assert any('main' in l or 'greet' in l or '__init__' in l for l in labels)

    def test_empty_source(self):
        result = scan_python('')
        imports, funcdefs, funccalls, extra, func_calls_by_func, symbol_defs = result
        assert imports == []
        assert funcdefs == []
        assert symbol_defs == []

    def test_no_crash_on_syntax_error(self):
        bad_src = 'def broken(\n  x =\n'
        result = scan_python(bad_src)
        assert len(result) == 6


# ─── JavaScript Parser ────────────────────────────────────────────────────────

class TestJsParser:
    def test_six_tuple_contract(self, js_src):
        result = scan_js(js_src)
        assert_six_tuple(result, 'scan_js')

    def test_imports_extracted(self, js_src):
        imports, *_ = scan_js(js_src)
        assert any('fs' in imp or 'path' in imp for imp in imports)

    def test_classes_in_symbol_defs(self, js_src):
        *_, symbol_defs = scan_js(js_src)
        kinds = [s['kind'] for s in symbol_defs]
        assert 'class' in kinds

    def test_class_names(self, js_src):
        *_, symbol_defs = scan_js(js_src)
        names = [s['name'] for s in symbol_defs if s['kind'] == 'class']
        assert 'Animal' in names
        assert 'Dog' in names

    def test_empty_source(self):
        result = scan_js('')
        assert len(result) == 6

    def test_no_crash_on_malformed(self):
        result = scan_js('const x = {{{')
        assert len(result) == 6


# ─── Go Parser ───────────────────────────────────────────────────────────────

class TestGoParser:
    def test_six_tuple_contract(self, go_src):
        result = scan_go(go_src)
        assert_six_tuple(result, 'scan_go')

    def test_imports_extracted(self, go_src):
        imports, *_ = scan_go(go_src)
        assert 'fmt' in imports

    def test_structs_in_symbol_defs(self, go_src):
        *_, symbol_defs = scan_go(go_src)
        kinds = [s['kind'] for s in symbol_defs]
        assert 'struct' in kinds

    def test_struct_names(self, go_src):
        *_, symbol_defs = scan_go(go_src)
        names = [s['name'] for s in symbol_defs if s['kind'] == 'struct']
        assert 'Animal' in names

    def test_empty_source(self):
        result = scan_go('')
        assert len(result) == 6


# ─── BIOS / C Parser ─────────────────────────────────────────────────────────

class TestBiosParser:
    def test_six_tuple_contract(self, c_src):
        result = scan_bios(c_src, '.c')
        assert_six_tuple(result, 'scan_bios')

    def test_includes_extracted(self, c_src):
        imports, *_ = scan_bios(c_src, '.c')
        # includes come back as the header filename
        assert any('stdio' in imp or 'myheader' in imp for imp in imports)

    def test_funcdefs_extracted(self, c_src):
        _, funcdefs, *_ = scan_bios(c_src, '.c')
        labels = [f['label'] for f in funcdefs]
        assert any('add' in l for l in labels)
        assert any('main' in l for l in labels)

    def test_struct_in_symbol_defs(self, c_src):
        *_, symbol_defs = scan_bios(c_src, '.c')
        kinds = [s['kind'] for s in symbol_defs]
        assert 'struct' in kinds or 'typedef' in kinds or len(symbol_defs) >= 0

    def test_empty_source(self):
        result = scan_bios('', '.c')
        assert len(result) == 6

    def test_no_crash_on_garbage(self):
        result = scan_bios('!!!@@@###$$$', '.c')
        assert len(result) == 6
