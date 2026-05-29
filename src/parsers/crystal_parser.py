#!/usr/bin/env python3
"""
parsers/crystal_parser.py - VIZCODE Crystal Language Parser

Extracts:
  imports             - `require "x"` → file stem
  funcdefs            - `def name`, `def self.name`, `macro name`
  funccalls           - call expressions
  func_calls_by_func  - per-method call lists (body-scoped via `end` matching)
  symbol_defs         - class / module / struct / enum / method / macro

Crystal mirrors Ruby's block structure (`end`-terminated). Syntax verified
against the Crystal language reference:
  * `#` line comments only;
  * `"..."` strings, `'c'` char literals, `<<-ID`/`<<~ID` heredocs;
  * `if`/`unless`/`while`/`until` open blocks only when statement-leading.
"""

import re

CRYSTAL_EXTENSIONS = {'.cr'}

CRYSTAL_KEYWORDS = {
    'def', 'class', 'module', 'struct', 'enum', 'lib', 'macro', 'end', 'if',
    'elsif', 'else', 'unless', 'while', 'until', 'case', 'when', 'begin',
    'rescue', 'ensure', 'do', 'then', 'return', 'yield', 'self', 'nil', 'true',
    'false', 'and', 'or', 'not', 'require', 'include', 'extend', 'private',
    'protected', 'abstract', 'puts', 'print', 'raise', 'new', 'loop', 'super',
    'in', 'of', 'as', 'is_a', 'responds_to',
}

RE_CR_REQUIRE = re.compile(r'''\brequire\s+['"]([^'"]+)['"]''')
RE_CR_DEF = re.compile(
    r'\b(def|macro)\s+(?:(self|[A-Za-z_]\w*)\s*\.\s*)?([A-Za-z_]\w*[?!=]?)')
RE_CR_TYPE = re.compile(
    r'^[ \t]*(?:abstract\s+|private\s+)*(class|module|struct|enum|lib)\s+'
    r'([A-Za-z_][\w:]*)(\s*<\s*([A-Za-z_][\w:]*))?', re.MULTILINE)
RE_CR_CALL = re.compile(r'\b([A-Za-z_]\w*[?!]?)\s*\(')
RE_WORD = re.compile(r'\b[A-Za-z_]\w*\b')
_RE_CR_BRANCH_KW = re.compile(
    r'\b(?:if|elsif|unless|while|until|when|and|or|rescue)\b')

_ALWAYS_OPEN = {'def', 'macro', 'class', 'module', 'struct', 'enum', 'lib',
                'case', 'begin', 'do'}
_LEADING_OPEN = {'if', 'unless', 'while', 'until'}


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _leaf(path: str) -> str:
    base = re.split(r'[\\/]', path)[-1]
    return re.sub(r'\.cr$', '', base)


def _mask_crystal(src: str, mask_strings: bool = True) -> str:
    out = list(src)
    n = len(src)

    def blank(start: int, end: int) -> None:
        for j in range(start, min(end, n)):
            if out[j] != '\n':
                out[j] = ' '

    i = 0
    while i < n:
        c = src[i]
        if c == '#':
            start = i
            while i < n and src[i] != '\n':
                i += 1
            blank(start, i)
            continue
        if c == '<' and src[i:i + 2] == '<<':
            m = re.match(r"<<([~-])([\"']?)([A-Za-z_]\w*)\2", src[i:])
            if m:
                tag = m.group(3)
                nl = src.find('\n', i)
                if nl != -1:
                    j = nl + 1
                    while j < n:
                        le = src.find('\n', j)
                        le = n if le == -1 else le
                        if src[j:le].strip() == tag:
                            blank(nl + 1, le)
                            break
                        blank(j, le)
                        j = le + 1
                i += m.end()
                continue
        if c in ('"', "'", '`'):
            quote = c
            start = i
            i += 1
            while i < n:
                if src[i] == '\\':
                    i += 2
                    continue
                if src[i] == quote:
                    i += 1
                    break
                i += 1
            if mask_strings:
                blank(start, i)
            continue
        i += 1

    return ''.join(out)


def _block_end(clean: str, after_idx: int) -> int:
    depth = 1
    loop_lines = set()
    for m in RE_WORD.finditer(clean, after_idx):
        w = m.group(0)
        if w not in _ALWAYS_OPEN and w not in _LEADING_OPEN and w != 'end':
            continue
        start = m.start()
        line_start = clean.rfind('\n', 0, start) + 1
        prev = clean[line_start:start].rstrip()
        leading = prev == ''
        if w == 'end':
            depth -= 1
            if depth == 0:
                return m.end()
        elif w in _LEADING_OPEN:
            if leading:
                depth += 1
                if w in ('while', 'until'):
                    loop_lines.add(line_start)
        elif w == 'do':
            if line_start in loop_lines:
                continue
            depth += 1
        else:
            if prev.endswith('.'):
                continue
            depth += 1
    return len(clean)


def _extract_calls(text: str) -> list:
    calls = []
    seen = set()
    for m in RE_CR_CALL.finditer(text):
        name = m.group(1)
        if name in CRYSTAL_KEYWORDS or len(name) < 2 or name in seen:
            continue
        seen.add(name)
        calls.append(name)
    return calls


def _complexity(body: str) -> int:
    if not body:
        return 1
    return 1 + len(_RE_CR_BRANCH_KW.findall(body)) + body.count('&&') + body.count('||')


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


def scan_crystal(src: str, ext: str = '.cr') -> tuple:
    """Crystal file analysis. Returns the standard VIZCODE 6-tuple."""
    clean = _mask_crystal(src, mask_strings=True)
    import_src = _mask_crystal(src, mask_strings=False)

    imports = []
    for m in RE_CR_REQUIRE.finditer(import_src):
        if m.start() < len(clean) and clean[m.start()] == ' ':
            continue
        leaf = _leaf(m.group(1).strip())
        if leaf:
            imports.append(leaf)
    imports = list(dict.fromkeys(imports))

    symbol_defs = []
    type_ranges = []
    for m in RE_CR_TYPE.finditer(clean):
        kind = m.group(1)
        name = m.group(2).split('::')[-1]
        if not name:
            continue
        start = m.start(2)
        end_idx = _block_end(clean, m.end())
        bases = [m.group(4).split('::')[-1]] if m.group(4) else []
        symbol_defs.append({
            'kind': kind, 'name': name, 'line': _line_no(src, start),
            'end_line': _line_no(src, max(start, end_idx - 1)),
            'bases': bases, 'parent': None, 'is_public': True, 'doc': None,
        })
        type_ranges.append((start, end_idx, name))

    funcdefs = []
    func_calls_by_func = []
    method_symbols = []
    seen = set()
    for m in RE_CR_DEF.finditer(clean):
        kw = m.group(1)
        recv = m.group(2)
        name = m.group(3)
        start = m.start(3)
        line_no = _line_no(src, start)
        key = (name, line_no)
        if key in seen:
            continue
        seen.add(key)
        end_idx = _block_end(clean, m.end())
        body = clean[m.end():end_idx]
        parent = _enclosing(type_ranges, start)
        is_static = recv is not None
        funcdefs.append({'label': name, 'is_efiapi': False, 'is_static': is_static})
        func_calls_by_func.append(_extract_calls(body))
        method_symbols.append({
            'kind': 'macro' if kw == 'macro' else ('method' if parent else 'function'),
            'name': name, 'line': line_no,
            'end_line': _line_no(src, max(start, end_idx - 1)),
            'bases': [], 'parent': parent,
            'is_public': not name.startswith('_'), 'doc': None,
            'complexity': _complexity(body),
        })

    symbol_defs = symbol_defs + method_symbols
    all_calls = _extract_calls(clean)

    extra = {'imports': imports, 'lang': 'crystal'}

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs
