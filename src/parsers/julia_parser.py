#!/usr/bin/env python3
"""
parsers/julia_parser.py - VIZCODE Julia Language Parser

Extracts:
  imports             - `using`/`import` modules, `include("x.jl")` → stem
  funcdefs            - `function name`, short-form `f(x) = ...`, `macro name`
  funccalls           - call expressions
  func_calls_by_func  - per-function call lists (body-scoped via `end` matching)
  symbol_defs         - struct / abstract type / module / method / macro

Julia blocks close with `end`. Two tricky `end` overloads are handled before
depth scanning (verified against the Julia manual):
  * `a[end]` — `end` as a last-index expression (suppressed inside `[ ]`);
  * `[f(x) for x in xs if p(x)]` — comprehension `for`/`if` (suppressed inside
    `[ ]` / generator `( )`).
Comments are `#` line and nested `#= =#`; literals are `"..."`, triple-quoted
strings, `'c'`, and `raw"..."` (masked by the generic string scan).
"""

import re

JULIA_EXTENSIONS = {'.jl'}

JULIA_KEYWORDS = {
    'function', 'macro', 'struct', 'mutable', 'abstract', 'primitive', 'type',
    'module', 'baremodule', 'begin', 'let', 'do', 'quote', 'try', 'catch',
    'finally', 'if', 'elseif', 'else', 'for', 'while', 'end', 'return', 'using',
    'import', 'include', 'export', 'const', 'global', 'local', 'in', 'isa',
    'where', 'true', 'false', 'nothing', 'missing', 'and', 'or', 'println',
    'print', 'new', 'throw', 'error', 'break', 'continue',
}

RE_JL_USING = re.compile(r'^[ \t]*(?:using|import)\s+([^\n#]+)', re.MULTILINE)
RE_JL_INCLUDE = re.compile(r'''\binclude\s*\(\s*['"]([^'"]+)['"]''')
RE_JL_FUNC = re.compile(r'\bfunction\s+([A-Za-z_][\w.!]*)')
RE_JL_SHORT = re.compile(
    r'^[ \t]*([A-Za-z_][\w!]*)\s*\(([^()]*)\)\s*(?:::[^=\n]+)?=(?!=)',
    re.MULTILINE)
RE_JL_MACRO = re.compile(r'\bmacro\s+([A-Za-z_]\w*)')
RE_JL_STRUCT = re.compile(
    r'^[ \t]*(?:mutable\s+)?struct\s+([A-Za-z_]\w*)([^\n]*)', re.MULTILINE)
RE_JL_ABSTRACT = re.compile(
    r'^[ \t]*(?:abstract|primitive)\s+type\s+([A-Za-z_]\w*)([^\n]*)',
    re.MULTILINE)
RE_JL_MODULE = re.compile(r'^[ \t]*(?:bare)?module\s+([A-Za-z_]\w*)', re.MULTILINE)
RE_JL_CALL = re.compile(r'\b([A-Za-z_]\w*[!]?)\s*\(')
RE_TOKEN = re.compile(r'[A-Za-z_]\w*|[\[\]()]')
_RE_JL_BRANCH_KW = re.compile(r'\b(?:if|elseif|while|for|catch|&&|\|\|)\b')

_OPEN_KW = {'function', 'macro', 'if', 'for', 'while', 'begin', 'let', 'do',
            'quote', 'try', 'struct', 'module', 'baremodule', 'abstract',
            'primitive'}


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _leaf_mod(token: str) -> str:
    token = token.strip().split(':')[0].strip()
    parts = [p for p in re.split(r'\.', token) if p]
    return parts[-1] if parts else ''


def _mask_julia(src: str, mask_strings: bool = True) -> str:
    out = list(src)
    n = len(src)

    def blank(start: int, end: int) -> None:
        for j in range(start, min(end, n)):
            if out[j] != '\n':
                out[j] = ' '

    i = 0
    while i < n:
        c = src[i]
        if c == '#' and src[i:i + 2] == '#=':
            start = i
            i += 2
            depth = 1
            while i < n and depth > 0:
                if src[i:i + 2] == '#=':
                    depth += 1
                    i += 2
                    continue
                if src[i:i + 2] == '=#':
                    depth -= 1
                    i += 2
                    continue
                i += 1
            blank(start, i)
            continue
        if c == '#':
            start = i
            while i < n and src[i] != '\n':
                i += 1
            blank(start, i)
            continue
        if c == '"' and src[i:i + 3] == '"""':
            start = i
            i += 3
            while i < n and src[i:i + 3] != '"""':
                i += 1
            i = i + 3 if i < n else n
            if mask_strings:
                blank(start, i)
            continue
        if c in ('"', "'"):
            quote = c
            start = i
            i += 1
            while i < n:
                if src[i] == '\\':
                    i += 2
                    continue
                if src[i] == quote or src[i] == '\n':
                    i += 1 if src[i] == quote else 0
                    break
                i += 1
            if mask_strings:
                blank(start, i)
            continue
        i += 1

    return ''.join(out)


def _block_end(clean: str, after_idx: int) -> int:
    depth = 1
    paren = 0
    bracket = 0
    pos = after_idx
    for m in RE_TOKEN.finditer(clean, after_idx):
        tok = m.group(0)
        if tok == '(':
            paren += 1
            continue
        if tok == ')':
            paren = max(0, paren - 1)
            continue
        if tok == '[':
            bracket += 1
            continue
        if tok == ']':
            bracket = max(0, bracket - 1)
            continue
        if paren > 0 or bracket > 0:
            continue   # comprehension / generator / index context
        if tok == 'end':
            depth -= 1
            if depth == 0:
                return m.end()
        elif tok == 'mutable' or tok == 'type':
            continue   # part of `mutable struct` / `abstract type`
        elif tok in _OPEN_KW:
            depth += 1
    return len(clean)


def _extract_calls(text: str) -> list:
    calls = []
    seen = set()
    for m in RE_JL_CALL.finditer(text):
        name = m.group(1)
        if name in JULIA_KEYWORDS or len(name) < 2 or name in seen:
            continue
        seen.add(name)
        calls.append(name)
    return calls


def _complexity(body: str) -> int:
    if not body:
        return 1
    return 1 + len(_RE_JL_BRANCH_KW.findall(body))


def _bases(rest: str) -> list:
    m = re.search(r'<:\s*([A-Za-z_][\w.]*)', rest)
    return [m.group(1).split('.')[-1]] if m else []


def _enclosing(ranges: list, idx: int):
    best = None
    best_span = None
    for start, end, name in ranges:
        if start <= idx < end:
            span = end - start
            if best_span is None or span < best_span:
                best_span = span
                best = name
    return best


def scan_julia(src: str, ext: str = '.jl') -> tuple:
    """Julia file analysis. Returns the standard VIZCODE 6-tuple."""
    clean = _mask_julia(src, mask_strings=True)
    import_src = _mask_julia(src, mask_strings=False)

    imports = []
    for m in RE_JL_USING.finditer(clean):
        for part in m.group(1).split(','):
            leaf = _leaf_mod(part)
            if leaf and leaf not in JULIA_KEYWORDS:
                imports.append(leaf)
    for m in RE_JL_INCLUDE.finditer(import_src):
        if m.start() < len(clean) and clean[m.start()] == ' ':
            continue
        base = re.split(r'[\\/]', m.group(1).strip())[-1]
        stem = re.sub(r'\.jl$', '', base)
        if stem:
            imports.append(stem)
    imports = list(dict.fromkeys(imports))

    symbol_defs = []
    type_ranges = []

    def add_type(kind, name, start, rest):
        end_idx = _block_end(clean, start + len(name))
        symbol_defs.append({
            'kind': kind, 'name': name, 'line': _line_no(src, start),
            'end_line': _line_no(src, max(start, end_idx - 1)),
            'bases': _bases(rest or ''), 'parent': None,
            'is_public': True, 'doc': None,
        })
        type_ranges.append((start, end_idx, name))

    for m in RE_JL_STRUCT.finditer(clean):
        add_type('struct', m.group(1), m.start(1), m.group(2))
    for m in RE_JL_ABSTRACT.finditer(clean):
        add_type('abstract', m.group(1), m.start(1), m.group(2))
    for m in RE_JL_MODULE.finditer(clean):
        add_type('module', m.group(1), m.start(1), '')

    funcdefs = []
    func_calls_by_func = []
    method_symbols = []
    seen = set()

    def add_func(name, decl_start, body_start, kind, degrade=False):
        leaf = name.split('.')[-1]
        if not leaf or leaf in JULIA_KEYWORDS:
            return
        line_no = _line_no(src, decl_start)
        key = (leaf, line_no)
        if key in seen:
            return
        seen.add(key)
        if degrade:
            end_idx = clean.find('\n', body_start)
            end_idx = len(clean) if end_idx == -1 else end_idx
        else:
            end_idx = _block_end(clean, body_start)
        body = clean[body_start:end_idx]
        parent = _enclosing(type_ranges, decl_start)
        funcdefs.append({'label': leaf, 'is_efiapi': False, 'is_static': False})
        func_calls_by_func.append(_extract_calls(body))
        method_symbols.append({
            'kind': kind if not parent else 'method',
            'name': leaf, 'line': line_no,
            'end_line': _line_no(src, max(decl_start, end_idx - 1)),
            'bases': [], 'parent': parent,
            'is_public': not leaf.startswith('_'), 'doc': None,
            'complexity': _complexity(body),
        })

    for m in RE_JL_FUNC.finditer(clean):
        add_func(m.group(1), m.start(1), m.end(), 'function')
    for m in RE_JL_MACRO.finditer(clean):
        add_func(m.group(1), m.start(1), m.end(), 'macro')
    for m in RE_JL_SHORT.finditer(clean):
        add_func(m.group(1), m.start(1), m.end(), 'function', degrade=True)

    symbol_defs = symbol_defs + method_symbols
    all_calls = _extract_calls(clean)

    extra = {'imports': imports, 'lang': 'julia'}

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs
