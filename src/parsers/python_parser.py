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
import io
import re
import token
import tokenize

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

_PY_CONFIG_EXTS = {'.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env'}
_PY_ASSET_EXTS = {
    '.css', '.scss', '.sass', '.less', '.styl',
    '.svg', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
    '.txt', '.md', '.html', '.htm', '.xml', '.csv',
}


# ─── Cyclomatic branch counter (Python AST) ──────────────────────────────────

class _BranchCounter(ast.NodeVisitor):
    """Count cyclomatic branches inside a function body.

    Starts at 1 (the entry path) and adds for each independent decision:
    `if` / `elif`, ternary `IfExp`, `for`, `while`, comprehension `if` clauses,
    `BoolOp` operands beyond the first (`and` / `or` chains), `match_case`,
    and `except` handlers. Nested function and class definitions are skipped —
    they get their own complexity computed separately.
    """

    def __init__(self):
        self.count = 1

    def visit_If(self, node):
        self.count += 1
        self.generic_visit(node)

    def visit_IfExp(self, node):
        self.count += 1
        self.generic_visit(node)

    def visit_For(self, node):
        self.count += 1
        self.generic_visit(node)

    def visit_AsyncFor(self, node):
        self.count += 1
        self.generic_visit(node)

    def visit_While(self, node):
        self.count += 1
        self.generic_visit(node)

    def visit_ExceptHandler(self, node):
        self.count += 1
        self.generic_visit(node)

    def visit_BoolOp(self, node):
        if isinstance(node.op, (ast.And, ast.Or)):
            self.count += max(0, len(node.values) - 1)
        self.generic_visit(node)

    def visit_comprehension(self, node):
        self.count += len(node.ifs)
        self.generic_visit(node)

    def visit_match_case(self, node):
        self.count += 1
        self.generic_visit(node)

    # ── Boundaries: don't recurse into nested defs ──────────────────────────
    def visit_FunctionDef(self, node):
        return

    def visit_AsyncFunctionDef(self, node):
        return

    def visit_ClassDef(self, node):
        return


def _compute_complexity(node) -> int:
    """Run :class:`_BranchCounter` over a function-def AST node's body."""
    bc = _BranchCounter()
    try:
        for stmt in node.body:
            bc.visit(stmt)
    except Exception:
        return 1
    return bc.count


# ─── L3 type_usage support: project-type references in annotations ───────────
# typing constructs and capitalized stdlib generics that are NOT user types —
# never become `type_usage` edges. (Lowercase builtins like str/int are already
# excluded by the Capitalized filter.)
PY_TYPE_BUILTINS = frozenset({
    'List', 'Dict', 'Set', 'FrozenSet', 'Tuple', 'Optional', 'Union', 'Any',
    'Callable', 'Iterable', 'Iterator', 'Sequence', 'Mapping', 'MutableMapping',
    'MutableSequence', 'MutableSet', 'Type', 'Awaitable', 'Coroutine', 'Generator',
    'AsyncGenerator', 'AsyncIterable', 'AsyncIterator', 'ClassVar', 'Final',
    'Literal', 'Annotated', 'Protocol', 'TypeVar', 'Generic', 'NoReturn', 'None',
    'Ellipsis', 'Text', 'AnyStr', 'ByteString', 'Hashable', 'Sized', 'Collection',
    'Container', 'Deque', 'DefaultDict', 'OrderedDict', 'Counter', 'ChainMap',
    'Self', 'Never', 'Concatenate', 'ParamSpec', 'TypeAlias', 'Path', 'Pattern',
    'Match', 'IO', 'TextIO', 'BinaryIO',
})


def _collect_type_names(node, out: set) -> None:
    """Walk a type-annotation AST node, collecting referenced type identifiers."""
    if node is None:
        return
    if isinstance(node, ast.Name):
        out.add(node.id)
    elif isinstance(node, ast.Attribute):
        out.add(node.attr)
    elif isinstance(node, ast.Subscript):
        _collect_type_names(node.value, out)
        _collect_type_names(node.slice, out)
    elif isinstance(node, getattr(ast, 'Index', ())):  # py<3.9 wrapped subscript
        _collect_type_names(getattr(node, 'value', None), out)
    elif isinstance(node, (ast.Tuple, ast.List)):
        for elt in node.elts:
            _collect_type_names(elt, out)
    elif isinstance(node, ast.BinOp):  # PEP 604 unions: X | Y
        _collect_type_names(node.left, out)
        _collect_type_names(node.right, out)
    elif isinstance(node, ast.Constant) and isinstance(node.value, str):
        # Forward reference string, e.g. "MyClass" or "pkg.MyClass".
        name = node.value.strip().split('[')[0].split('.')[-1]
        if name.isidentifier():
            out.add(name)


def _filter_type_refs(names: set) -> list:
    """Keep only plausible user-defined type names (Capitalized, ≥3 chars)."""
    out = []
    for name in sorted(names):
        if not name or len(name) < 3 or not name[0].isupper():
            continue
        if name in PY_TYPE_BUILTINS:
            continue
        out.append(name)
    return out


# ─── L1 edge_hints: asset/config file references from string literals ────────
_CONFIG_EXTS = {'.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env'}
_ASSET_EXTS = {'.html', '.htm', '.css', '.scss', '.sass', '.less', '.svg', '.png',
               '.jpg', '.jpeg', '.gif', '.csv', '.sql', '.xml'}
# Only these call targets are trusted to carry a file-path first argument. Paired
# with a known extension, this double-gates against false positives; the analyzer
# additionally drops any ref that does not resolve to a project file.
_PY_ASSET_CALLERS = {
    'open', 'Path', 'read_text', 'read_bytes', 'render_template', 'send_file',
    'send_from_directory', 'get_template', 'ParseFiles', 'ParseGlob',
}


def _classify_ref(ref: str) -> str | None:
    """Return 'config_ref' / 'asset_ref' for a known file extension, else None."""
    if not ref or '\n' in ref:
        return None
    base = ref.split('?')[0].split('#')[0].strip()
    dot = base.rfind('.')
    if dot < 0:
        return None
    ext = base[dot:].lower()
    if ext in _CONFIG_EXTS:
        return 'config_ref'
    if ext in _ASSET_EXTS:
        return 'asset_ref'
    return None


# ─── AST-based analyzer ─────────────────────────────────────────────────────

class _PyAnalyzer(ast.NodeVisitor):
    """Walk the AST to extract imports, defs, calls, and symbols."""

    def __init__(self):
        self.imports = []
        self.funcdefs = []
        self.all_calls = []
        self.func_calls_by_func = []
        self.symbol_defs = []
        self.edge_hints = []            # L1 asset/config file references
        self._scope_stack = []          # [(kind, name), ...] — 'class' or 'func'
        self._current_func_calls = None # list when inside a function, None otherwise
        self._seen_imports = set()

    # ── Imports ──────────────────────────────────────────────────────────────

    def visit_Import(self, node):
        for alias in node.names:
            self._add_import(alias.name.split('.')[0])
        self.generic_visit(node)

    def visit_ImportFrom(self, node):
        for dep in _importfrom_dependencies(node.module, node.names, node.level):
            self._add_import(dep)
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

        # Class-level annotated fields contribute type references (e.g. dataclass
        # fields, attrs). Bases stay separate (they drive inheritance edges).
        _type_names = set()
        for stmt in node.body:
            if isinstance(stmt, ast.AnnAssign):
                _collect_type_names(stmt.annotation, _type_names)

        self.symbol_defs.append({
            'kind':      'class',
            'name':      node.name,
            'line':      node.lineno,
            'end_line':  getattr(node, 'end_lineno', node.lineno),
            'bases':     bases,
            'parent':    parent,
            'is_public': not node.name.startswith('_'),
            'doc':       doc,
            'type_refs': _filter_type_refs(_type_names),
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
        parent_class = self._current_class() if self._is_direct_class_member() else None
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

        # Type references from parameter annotations + return annotation.
        _type_names = set()
        _args = node.args
        for arg in (list(getattr(_args, 'posonlyargs', [])) + list(_args.args)
                    + list(_args.kwonlyargs)):
            _collect_type_names(getattr(arg, 'annotation', None), _type_names)
        if _args.vararg:
            _collect_type_names(getattr(_args.vararg, 'annotation', None), _type_names)
        if _args.kwarg:
            _collect_type_names(getattr(_args.kwarg, 'annotation', None), _type_names)
        _collect_type_names(node.returns, _type_names)

        self.funcdefs.append({
            'label':     node.name,
            'is_efiapi': False,
            'is_static': is_private,
        })
        call_index = len(self.func_calls_by_func)
        self.func_calls_by_func.append([])

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
            'complexity': _compute_complexity(node),
            'type_refs':  _filter_type_refs(_type_names),
        })

        # Track calls inside this function body
        prev_calls = self._current_func_calls
        self._current_func_calls = []

        self._scope_stack.append(('func', node.name))
        self.generic_visit(node)
        self._scope_stack.pop()

        self.func_calls_by_func[call_index] = self._current_func_calls
        self._current_func_calls = prev_calls

    # ── Calls ────────────────────────────────────────────────────────────────

    def visit_Call(self, node):
        self._maybe_add_file_hint(node)
        name = None
        if isinstance(node.func, ast.Name):
            name = node.func.id
        elif isinstance(node.func, ast.Attribute):
            name = node.func.attr

        if name and len(name) >= 2 and name not in PY_KEYWORDS:
            self.all_calls.append(name)
            if self._current_func_calls is not None:
                self._current_func_calls.append(name)

        # L1 hint: a trusted I/O call with a string-literal path that has a known
        # asset/config extension. resolve_ref() drops it if it isn't a real file.
        if name in _PY_ASSET_CALLERS and node.args:
            first = node.args[0]
            if isinstance(first, ast.Constant) and isinstance(first.value, str):
                etype = _classify_ref(first.value)
                if etype:
                    self.edge_hints.append({
                        'type': etype,
                        'target': first.value.strip(),
                        'via': name,
                        'line': getattr(node, 'lineno', None),
                        'origin': 'parser',
                        'confidence': 'high',
                    })

        self.generic_visit(node)

    def _maybe_add_file_hint(self, node):
        via = ''
        target = None
        if isinstance(node.func, ast.Name) and node.func.id == 'open' and node.args:
            target = self._literal_str(node.args[0])
            via = 'open'
        elif isinstance(node.func, ast.Attribute) and node.func.attr in ('read_text', 'read_bytes'):
            target = self._path_constructor_literal(node.func.value)
            via = f'Path.{node.func.attr}'
        elif isinstance(node.func, ast.Attribute) and node.func.attr == 'joinpath' and node.args:
            if self._is_importlib_resources_files(node.func.value):
                target = self._literal_str(node.args[0])
                via = 'importlib.resources.files.joinpath'
        hint = self._edge_hint(target, via, getattr(node, 'lineno', 0))
        if hint:
            self.edge_hints.append(hint)

    def _literal_str(self, node):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            return node.value
        return None

    def _path_constructor_literal(self, node):
        if not isinstance(node, ast.Call) or not node.args:
            return None
        func = node.func
        is_path = (
            isinstance(func, ast.Name) and func.id == 'Path'
        ) or (
            isinstance(func, ast.Attribute) and func.attr == 'Path'
        )
        return self._literal_str(node.args[0]) if is_path else None

    def _is_importlib_resources_files(self, node):
        if not isinstance(node, ast.Call):
            return False
        func = node.func
        if not isinstance(func, ast.Attribute) or func.attr != 'files':
            return False
        value = func.value
        if isinstance(value, ast.Name) and value.id == 'resources':
            return True
        return (
            isinstance(value, ast.Attribute)
            and value.attr == 'resources'
            and isinstance(value.value, ast.Name)
            and value.value.id == 'importlib'
        )

    def _edge_hint(self, target, via, line):
        ref = (target or '').strip().replace('\\', '/')
        if not ref or not via:
            return None
        low = ref.lower()
        if low.startswith(('http://', 'https://', '//', 'data:')):
            return None
        if ref.startswith('$') or any(ch in ref for ch in '*?[]{}'):
            return None
        ext = ''
        last = ref.rstrip('/').rsplit('/', 1)[-1]
        if '.' in last:
            ext = '.' + last.rsplit('.', 1)[-1].lower()
        if ext in _PY_CONFIG_EXTS:
            edge_type, subtype = 'config_ref', ext[1:]
        elif ext in _PY_ASSET_EXTS:
            edge_type, subtype = 'asset_ref', ext[1:]
        else:
            return None
        return {
            'type': edge_type,
            'target': ref,
            'subtype': subtype,
            'via': via,
            'line': line,
            'confidence': 1.0,
        }

    # ── Helpers ──────────────────────────────────────────────────────────────

    def _current_class(self):
        """Return the name of the nearest enclosing class, or None."""
        for kind, name in reversed(self._scope_stack):
            if kind == 'class':
                return name
        return None

    def _is_direct_class_member(self):
        """Return True when the next function belongs directly to a class body."""
        return bool(self._scope_stack and self._scope_stack[-1][0] == 'class')

    def _add_import(self, name):
        if name and name != '__future__' and name not in self._seen_imports:
            self._seen_imports.add(name)
            self.imports.append(name)


def _importfrom_dependencies(module: str | None, aliases, level: int = 0) -> list:
    """Return dependency roots for a Python ``from ... import ...`` node."""
    if module == '__future__':
        return []
    if level:
        if module:
            return [module.split('.')[0]]
        deps = []
        for alias in aliases:
            name = getattr(alias, 'name', '')
            if name and name != '*':
                deps.append(name.split('.')[0])
        return deps
    if module:
        return [module.split('.')[0]]
    return []


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
    if analyzer.edge_hints:
        extra['edge_hints'] = analyzer.edge_hints

    return (
        analyzer.imports,
        analyzer.funcdefs,
        _dedupe_preserve_order(analyzer.all_calls),
        extra,
        analyzer.func_calls_by_func,
        analyzer.symbol_defs,
    )


# ─── Regex fallback (for SyntaxError files) ──────────────────────────────────

RE_PY_IMPORT_FROM = re.compile(
    r'^[ \t]*from\s+([.\w]+)\s+import\s+([^\n]+)', re.MULTILINE)
RE_PY_IMPORT = re.compile(
    r'^[ \t]*import\s+([\w., \t]+)', re.MULTILINE)
RE_PY_FUNCDEF = re.compile(
    r'^([ \t]*)(?:async[ \t]+)?def[ \t]+(\w+)[ \t]*\([^#\n]*\)[ \t]*(?:->[^\n:]+)?[ \t]*:',
    re.MULTILINE,
)
RE_PY_CLASSDEF = re.compile(
    r'^([ \t]*)class[ \t]+(\w+)[ \t]*(?:\(([^)]*)\))?[ \t]*:', re.MULTILINE)
RE_PY_CALL = re.compile(r'\b([A-Za-z_]\w*)\s*\(')


def _dedupe_preserve_order(values: list) -> list:
    seen = set()
    out = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            out.append(value)
    return out


def _mask_python_for_regex(src: str) -> str:
    """Mask comments and string-like tokens for the regex fallback.

    The fallback intentionally works on malformed source, so this helper keeps
    original newlines and character offsets intact while blanking comments,
    normal strings, byte strings, and f-string literal tokens.
    """
    lines = [list(line) for line in src.splitlines(keepends=True)]
    if not lines:
        return src

    def blank_span(start, end):
        start_row, start_col = start
        end_row, end_col = end
        start_row -= 1
        end_row -= 1
        if start_row < 0 or start_row >= len(lines):
            return
        end_row = min(end_row, len(lines) - 1)
        for row in range(start_row, end_row + 1):
            col_from = start_col if row == start_row else 0
            col_to = end_col if row == end_row else len(lines[row])
            col_to = min(col_to, len(lines[row]))
            for col in range(col_from, col_to):
                if lines[row][col] not in '\r\n':
                    lines[row][col] = ' '

    reader = io.StringIO(src).readline
    try:
        tokens = tokenize.generate_tokens(reader)
        for tok in tokens:
            tok_name = token.tok_name.get(tok.type, '')
            if tok.type in (tokenize.COMMENT, token.STRING) or tok_name.startswith('FSTRING'):
                blank_span(tok.start, tok.end)
    except tokenize.TokenError as err:
        if len(err.args) > 1 and isinstance(err.args[1], tuple):
            blank_span(err.args[1], (len(lines), len(lines[-1])))
    except Exception:
        return src

    return ''.join(''.join(line) for line in lines)


def _parse_imports_regex(src: str) -> list:
    modules = []
    for m in RE_PY_IMPORT_FROM.finditer(src):
        module = m.group(1)
        aliases = [
            ast.alias(name=raw.strip().split()[0], asname=None)
            for raw in m.group(2).split(',')
            if raw.strip() and raw.strip().split()[0] != '('
        ]
        level = len(module) - len(module.lstrip('.'))
        module_name = module.lstrip('.') or None
        modules.extend(_importfrom_dependencies(module_name, aliases, level))
    for m in RE_PY_IMPORT.finditer(src):
        for raw in m.group(1).split(','):
            name = raw.strip().split()[0].split('.')[0] if raw.strip() else ''
            if name and name != '__future__':
                modules.append(name)
    return _dedupe_preserve_order(modules)


def _extract_calls_regex(text: str) -> list:
    calls = []
    for m in RE_PY_CALL.finditer(text):
        name = m.group(1)
        line_start = text.rfind('\n', 0, m.start()) + 1
        prefix = text[line_start:m.start()]
        if re.search(r'\b(?:async[ \t]+)?def[ \t]+$', prefix):
            continue
        if re.search(r'\bclass[ \t]+$', prefix):
            continue
        if name not in PY_KEYWORDS and len(name) >= 2:
            calls.append(name)
    return calls


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
    masked = _mask_python_for_regex(src)
    imports = _parse_imports_regex(masked)
    lines = masked.splitlines()
    n = len(lines)

    funcdefs = []
    func_calls_by_func = []

    def_positions = []
    for m in RE_PY_FUNCDEF.finditer(masked):
        indent = len(m.group(1).expandtabs(4))
        name = m.group(2)
        line_no = masked[:m.start()].count('\n')
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

    all_calls = _extract_calls_regex(masked)
    symbol_defs = _parse_symbol_defs_regex(masked)

    extra = {'imports': imports, 'lang': 'python'}
    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs


# ─── Public entry point ─────────────────────────────────────────────────────

def scan_python(src: str) -> tuple:
    """
    Full Python file analysis.

    Returns a 6-tuple:
      (imports, funcdefs, all_calls, extra_dict, func_calls_by_func, symbol_defs)
    On parse failure, the regex fallback is used and `extra['file_error']`
    records the diagnostic for callers that normalize parser output.
    """
    try:
        return _scan_python_ast(src)
    except SyntaxError as err:
        result = list(_scan_python_regex(src))
        msg = f'SyntaxError: {err.msg} (line {err.lineno})' if err.msg else 'SyntaxError'
        result[3] = {**(result[3] or {}), 'file_error': msg}
        return tuple(result)
    except Exception as err:
        result = list(_scan_python_regex(src))
        msg = f'Parse failed: {type(err).__name__}: {err}'
        result[3] = {**(result[3] or {}), 'file_error': msg}
        return tuple(result)
