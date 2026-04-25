#!/usr/bin/env python3
"""
parsers/python_parser.py — VIZCODE Python Language Parser

Uses Python's stdlib `ast` module for 100% accurate extraction.
Falls back to regex when ast.parse() fails (e.g. template files).

Extracts:
  imports        → module names from 'import X' / 'from X import Y'
  funcdefs       → function definitions (top-level & class methods)
  funccalls      → all call expressions
  func_calls_by_func → per-function call lists (indexed parallel to funcdefs)
  symbol_defs    → structured symbol table [{kind, name, line, end_line, bases, parent, doc}, ...]
"""

import ast
import re

# ─── Python keywords / builtins to ignore in call extraction ─────────────────
PY_KEYWORDS = {
    'if', 'else', 'elif', 'while', 'for', 'try', 'except', 'with',
    'class', 'return', 'import', 'from', 'def', 'pass', 'break',
    'continue', 'raise', 'yield', 'lambda', 'True', 'False', 'None',
    'self', 'cls', 'super', 'async', 'await', 'global', 'nonlocal',
    # builtins
    'print', 'len', 'range', 'enumerate', 'zip', 'map', 'filter',
    'type', 'isinstance', 'issubclass', 'hasattr', 'getattr', 'setattr',
    'delattr', 'dir', 'vars', 'repr', 'str', 'int', 'float', 'bool',
    'list', 'dict', 'set', 'tuple', 'sorted', 'reversed', 'iter',
    'next', 'open', 'input', 'format', 'id', 'hash', 'abs', 'min',
    'max', 'sum', 'round', 'any', 'all', 'staticmethod', 'classmethod',
    'property', 'object', 'NotImplemented',
}


# ─── AST-based analyzer ─────────────────────────────────────────────────────

class _PyAnalyzer(ast.NodeVisitor):
    """Walk the AST to extract imports, defs, calls, and symbols."""

    def __init__(self):
        self.imports = []
        self.funcdefs = []
        self.all_calls = []
        self.func_calls_by_func = []
        self.symbol_defs = []
        self._scope_stack = []          # [(kind, name), ...] — 'class' or 'func'
        self._current_func_calls = None # list when inside a function, None otherwise
        self._seen_imports = set()

    # ── Imports ──────────────────────────────────────────────────────────────

    def visit_Import(self, node):
        for alias in node.names:
            top = alias.name.split('.')[0]
            if top and top not in self._seen_imports:
                self._seen_imports.add(top)
                self.imports.append(top)
        self.generic_visit(node)

    def visit_ImportFrom(self, node):
        if node.module:
            top = node.module.split('.')[0]
            if top and top not in self._seen_imports:
                self._seen_imports.add(top)
                self.imports.append(top)
        self.generic_visit(node)

    # ── Classes ──────────────────────────────────────────────────────────────

    def visit_ClassDef(self, node):
        bases = []
        for b in node.bases:
            if isinstance(b, ast.Name) and b.id != 'object':
                bases.append(b.id)
            elif isinstance(b, ast.Attribute):
                bases.append(b.attr)
        parent = self._current_class()
        doc = ast.get_docstring(node)

        self.symbol_defs.append({
            'kind':      'class',
            'name':      node.name,
            'line':      node.lineno,
            'end_line':  getattr(node, 'end_lineno', node.lineno),
            'bases':     bases,
            'parent':    parent,
            'is_public': not node.name.startswith('_'),
            'doc':       doc,
        })

        self._scope_stack.append(('class', node.name))
        self.generic_visit(node)
        self._scope_stack.pop()

    # ── Functions / Methods ──────────────────────────────────────────────────

    def visit_FunctionDef(self, node):
        self._handle_funcdef(node)

    def visit_AsyncFunctionDef(self, node):
        self._handle_funcdef(node)

    def _handle_funcdef(self, node):
        parent_class = self._current_class()
        kind = 'method' if parent_class else 'function'

        # Nested functions (not class methods) are private
        is_nested = not parent_class and len(self._scope_stack) > 0
        is_private = node.name.startswith('_') or is_nested

        doc = ast.get_docstring(node)

        # Extract decorator names
        decorators = []
        for d in node.decorator_list:
            if isinstance(d, ast.Name):
                decorators.append(d.id)
            elif isinstance(d, ast.Attribute):
                decorators.append(d.attr)
            elif isinstance(d, ast.Call):
                if isinstance(d.func, ast.Name):
                    decorators.append(d.func.id)
                elif isinstance(d.func, ast.Attribute):
                    decorators.append(d.func.attr)

        # Reconstruct a readable signature using ast.unparse (Python 3.9+).
        # Falls back to empty string on older interpreters or unparse failure —
        # the consumer treats empty signature as "not available" and hides the row.
        signature = ''
        if hasattr(ast, 'unparse'):
            try:
                args_src = ast.unparse(node.args)
                ret_src = ' -> ' + ast.unparse(node.returns) if node.returns is not None else ''
                signature = f'({args_src}){ret_src}'
            except Exception:
                signature = ''

        self.funcdefs.append({
            'label':     node.name,
            'is_efiapi': False,
            'is_static': is_private,
        })

        self.symbol_defs.append({
            'kind':       kind,
            'name':       node.name,
            'line':       node.lineno,
            'end_line':   getattr(node, 'end_lineno', node.lineno),
            'bases':      [],
            'parent':     parent_class,
            'is_public':  not node.name.startswith('_'),
            'doc':        doc,
            'decorators': decorators,
            'signature':  signature,
        })

        # Track calls inside this function body
        prev_calls = self._current_func_calls
        self._current_func_calls = []

        self._scope_stack.append(('func', node.name))
        self.generic_visit(node)
        self._scope_stack.pop()

        self.func_calls_by_func.append(self._current_func_calls)
        self._current_func_calls = prev_calls

    # ── Calls ────────────────────────────────────────────────────────────────

    def visit_Call(self, node):
        name = None
        if isinstance(node.func, ast.Name):
            name = node.func.id
        elif isinstance(node.func, ast.Attribute):
            name = node.func.attr

        if name and len(name) >= 2 and name not in PY_KEYWORDS:
            self.all_calls.append(name)
            if self._current_func_calls is not None:
                self._current_func_calls.append(name)

        self.generic_visit(node)

    # ── Helpers ──────────────────────────────────────────────────────────────

    def _current_class(self):
        """Return the name of the nearest enclosing class, or None."""
        for kind, name in reversed(self._scope_stack):
            if kind == 'class':
                return name
        return None


def _scan_python_ast(src: str) -> tuple:
    """Parse Python source with the ast module."""
    tree = ast.parse(src)
    analyzer = _PyAnalyzer()
    analyzer.visit(tree)

    extra = {
        'imports': analyzer.imports,
        'lang':    'python',
    }
    # Collect docstrings into extra for frontend access
    docstrings = {}
    mod_doc = ast.get_docstring(tree)
    if mod_doc:
        docstrings['__module__'] = mod_doc
    for sym in analyzer.symbol_defs:
        if sym.get('doc'):
            key = f"{sym['parent']}.{sym['name']}" if sym['parent'] else sym['name']
            docstrings[key] = sym['doc']
    if docstrings:
        extra['docstrings'] = docstrings

    return (
        analyzer.imports,
        analyzer.funcdefs,
        list(set(analyzer.all_calls)),
        extra,
        analyzer.func_calls_by_func,
        analyzer.symbol_defs,
    )


# ─── Regex fallback (for SyntaxError files) ──────────────────────────────────

RE_PY_IMPORT_FROM = re.compile(
    r'^[ \t]*from\s+([\w.]+)\s+import\s+', re.MULTILINE)
RE_PY_IMPORT = re.compile(
    r'^[ \t]*import\s+([\w., \t]+)', re.MULTILINE)
RE_PY_FUNCDEF = re.compile(
    r'^([ \t]*)(?:async[ \t]+)?def[ \t]+(\w+)[ \t]*\(', re.MULTILINE)
RE_PY_CLASSDEF = re.compile(
    r'^([ \t]*)class[ \t]+(\w+)[ \t]*(?:\(([^)]*)\))?[ \t]*:', re.MULTILINE)
RE_PY_CALL = re.compile(r'\b([A-Za-z_]\w*)\s*\(')


def _parse_imports_regex(src: str) -> list:
    modules = []
    for m in RE_PY_IMPORT_FROM.finditer(src):
        top = m.group(1).split('.')[0]
        if top:
            modules.append(top)
    for m in RE_PY_IMPORT.finditer(src):
        for raw in m.group(1).split(','):
            token = raw.strip().split(' ')[0].split('.')[0]
            if token:
                modules.append(token)
    return list(set(modules))


def _extract_calls_regex(text: str) -> list:
    return [
        m.group(1) for m in RE_PY_CALL.finditer(text)
        if m.group(1) not in PY_KEYWORDS and len(m.group(1)) >= 2
    ]


def _parse_symbol_defs_regex(src: str) -> list:
    lines = src.splitlines()
    n = len(lines)
    items = []

    for m in RE_PY_CLASSDEF.finditer(src):
        indent = len(m.group(1).expandtabs(4))
        name = m.group(2)
        bases_str = m.group(3) or ''
        line_no = src[:m.start()].count('\n')
        items.append((line_no, indent, 'class', name, bases_str))

    for m in RE_PY_FUNCDEF.finditer(src):
        indent = len(m.group(1).expandtabs(4))
        name = m.group(2)
        line_no = src[:m.start()].count('\n')
        items.append((line_no, indent, 'def', name, ''))

    items.sort(key=lambda x: x[0])
    symbols = []

    for i, (line_no, indent, kind, name, bases_str) in enumerate(items):
        end_line = n - 1
        for j in range(i + 1, len(items)):
            nxt_line, nxt_indent, *_ = items[j]
            if nxt_indent <= indent:
                end_line = nxt_line - 1
                break
        parent = None
        for j in range(i - 1, -1, -1):
            p_line, p_indent, p_kind, p_name, _ = items[j]
            if p_indent < indent and p_kind == 'class':
                parent = p_name
                break
        bases = []
        if bases_str.strip():
            for b in bases_str.split(','):
                b = b.strip().split('(')[0].split('[')[0]
                if b and b not in ('object', ''):
                    bases.append(b)
        if kind == 'class':
            sym_kind = 'class'
        elif parent:
            sym_kind = 'method'
        else:
            sym_kind = 'function'
        is_private = name.startswith('_') or (sym_kind == 'function' and indent > 0)
        symbols.append({
            'kind': sym_kind, 'name': name,
            'line': line_no + 1, 'end_line': end_line + 1,
            'bases': bases, 'parent': parent,
            'is_public': not is_private,
        })

    return symbols


def _scan_python_regex(src: str) -> tuple:
    """Regex-based fallback for files that fail ast.parse()."""
    imports = _parse_imports_regex(src)
    lines = src.splitlines()
    n = len(lines)

    funcdefs = []
    func_calls_by_func = []

    def_positions = []
    for m in RE_PY_FUNCDEF.finditer(src):
        indent = len(m.group(1).expandtabs(4))
        name = m.group(2)
        line_no = src[:m.start()].count('\n')
        def_positions.append((line_no, indent, name))

    for pos_i, (line_no, indent, name) in enumerate(def_positions):
        is_private = (indent > 0) or name.startswith('_')
        funcdefs.append({
            'label': name, 'is_efiapi': False, 'is_static': is_private,
        })
        body_lines = []
        j = line_no + 1
        next_boundary = n
        if pos_i + 1 < len(def_positions):
            next_line, next_indent, _ = def_positions[pos_i + 1]
            if next_indent <= indent:
                next_boundary = next_line
        while j < min(next_boundary, n):
            ln = lines[j]
            stripped = ln.strip()
            if stripped == '' or stripped.startswith('#'):
                j += 1
                continue
            ln_indent = len(ln.expandtabs(4)) - len(ln.expandtabs(4).lstrip())
            if ln_indent <= indent and stripped:
                break
            body_lines.append(ln)
            j += 1
        calls = _extract_calls_regex('\n'.join(body_lines))
        func_calls_by_func.append(calls)

    all_calls = _extract_calls_regex(src)
    symbol_defs = _parse_symbol_defs_regex(src)

    extra = {'imports': imports, 'lang': 'python'}
    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs


# ─── Public entry point ─────────────────────────────────────────────────────

def scan_python(src: str) -> tuple:
    """
    Full Python file analysis.

    Returns a 6- or 7-tuple:
      (imports, funcdefs, all_calls, extra_dict, func_calls_by_func, symbol_defs)
      (imports, funcdefs, all_calls, extra_dict, func_calls_by_func, symbol_defs, parse_diag)

    parse_diag: {'file_error': str | None} — when present and truthy, ast.parse
    failed and the regex fallback was used; every symbol from this file should
    be flagged as unreliable. Optional; absent on clean files.
    """
    try:
        return _scan_python_ast(src)
    except SyntaxError as err:
        result = _scan_python_regex(src)
        diag = {'file_error': f'SyntaxError: {err.msg} (line {err.lineno})' if err.msg else 'SyntaxError'}
        return (*result, diag)
    except Exception as err:
        result = _scan_python_regex(src)
        diag = {'file_error': f'Parse failed: {type(err).__name__}: {err}'}
        return (*result, diag)
