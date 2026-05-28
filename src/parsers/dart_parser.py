#!/usr/bin/env python3
"""
parsers/dart_parser.py - VIZCODE Dart Language Parser

Extracts:
  imports             - leaf names from import/export/part directives
  funcdefs            - functions, methods (typed or untyped), named/factory
                        constructors, getters/setters
  funccalls           - call expressions
  func_calls_by_func  - per-function call lists (body-scoped via brace matching)
  symbol_defs         - class / mixin / enum / extension / typedef / function

Syntax verified against the Dart Language Specification & dart.dev language tour:
  line `//`, doc `///`, NESTED block `/* */` comments; strings `'...'` / `"..."`,
  triple `'''...'''` / `\"\"\" ... \"\"\"`, raw `r'...'`, interpolation `$x`/`${...}`.
"""

import re


DART_EXTENSIONS = {'.dart'}


DART_KEYWORDS = {
    'abstract', 'as', 'assert', 'async', 'await', 'base', 'break', 'case',
    'catch', 'class', 'const', 'continue', 'covariant', 'default', 'deferred',
    'do', 'dynamic', 'else', 'enum', 'export', 'extends', 'extension',
    'external', 'factory', 'false', 'final', 'finally', 'for', 'Function',
    'get', 'hide', 'if', 'implements', 'import', 'in', 'interface', 'is',
    'late', 'library', 'mixin', 'new', 'null', 'on', 'operator', 'part',
    'required', 'rethrow', 'return', 'sealed', 'set', 'show', 'static',
    'super', 'switch', 'sync', 'this', 'throw', 'true', 'try', 'typedef',
    'var', 'void', 'when', 'while', 'with', 'yield',
    'int', 'double', 'bool', 'String', 'List', 'Map', 'Set', 'num', 'Object',
    'Future', 'Stream', 'Iterable', 'Widget', 'BuildContext',
}

RE_DART_IMPORT = re.compile(
    r'''^\s*(?:import|export|part)\s+['"](?P<path>[^'"]+)['"]''',
    re.MULTILINE,
)

RE_DART_CLASS = re.compile(
    r'(?:^|[\s;{}])'
    r'(?:(?:abstract|base|interface|final|sealed|mixin)\s+)*'
    r'(?P<kind>class|mixin|enum)\s+'
    r'(?P<name>[A-Za-z_]\w*)'
    r'(?:\s*<[^>{]*>)?'
    r'(?P<rest>[^{]*)'
    r'\{',
    re.MULTILINE,
)

# extension [Name] on Target {
RE_DART_EXTENSION = re.compile(
    r'(?:^|[\s;{}])extension\s+(?:(?P<name>[A-Za-z_]\w*)\s+)?on\s+'
    r'(?P<target>[A-Za-z_][\w<>,?. ]*?)\s*\{',
    re.MULTILINE,
)

# typedef Name = ...  /  typedef Ret Name(...)
RE_DART_TYPEDEF = re.compile(
    r'^\s*typedef\s+(?:[\w<>,?\[\]. ]+\s+)?(?P<name>[A-Za-z_]\w*)\s*[=(<]',
    re.MULTILINE,
)

# factory ClassName[.named](
RE_DART_FACTORY = re.compile(
    r'\bfactory\s+(?P<cls>[A-Z]\w*)(?:\.(?P<named>[A-Za-z_]\w*))?\s*\(',
)

# Named constructor: ClassName.named( ... ) [: init] ( { | => | ; )
RE_DART_NAMED_CTOR = re.compile(
    r'(?:^|[\s;{}])(?P<cls>[A-Z]\w*)\.(?P<named>[A-Za-z_]\w*)\s*'
    r'\([^{}]*\)\s*(?::[^{};]*)?(?P<term>[{;]|=>)',
    re.MULTILINE,
)

# get / set accessors (word-boundaried so `get` inside `Widget` is not matched)
RE_DART_GETSET = re.compile(
    r'(?:[\w<>,?\[\]. ]+\s+)?\b(?P<acc>get|set)\b\s+(?P<name>[A-Za-z_]\w*)\s*'
    r'(?:\([^;{}]*\))?\s*(?:\{|=>)',
    re.MULTILINE,
)

# General function/method:  [Type ] name(params) [async[*]|sync*] ({ | =>)
RE_DART_FUNC = re.compile(
    r'(?P<ret>(?:[\w$<>,?\[\]. ]+\s+)?)'
    r'(?P<name>[A-Za-z_]\w*)\s*'
    r'\((?P<params>[^;{}]*)\)\s*'
    r'(?:(?:async|sync)\s*\*?\s*)?'
    r'(?P<tail>\{|=>)',
    re.MULTILINE,
)

RE_DART_CALL = re.compile(r'\b([A-Za-z_$]\w*)\s*\(')

_RE_DART_BRANCH_KW = re.compile(r'\b(?:if|for|while|case|catch)\b')


def _mask_dart_source(src: str, mask_literals: bool = False) -> str:
    """Mask comments (and optionally literals); NESTED block comments + triples."""
    out = list(src)
    i = 0
    n = len(src)

    def blank_span(start: int, end: int) -> None:
        for j in range(start, min(end, n)):
            if out[j] != '\n':
                out[j] = ' '

    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ''

        if c == '/' and nxt == '/':
            start = i
            i += 2
            while i < n and src[i] != '\n':
                i += 1
            blank_span(start, i)
            continue

        if c == '/' and nxt == '*':
            start = i
            i += 2
            depth = 1
            while i < n and depth > 0:
                if src[i] == '/' and src[i + 1:i + 2] == '*':
                    depth += 1
                    i += 2
                    continue
                if src[i] == '*' and src[i + 1:i + 2] == '/':
                    depth -= 1
                    i += 2
                    continue
                i += 1
            blank_span(start, i)
            continue

        if (c == '"' and src[i + 1:i + 3] == '""') or \
           (c == "'" and src[i + 1:i + 3] == "''"):
            q3 = src[i:i + 3]
            start = i
            i += 3
            while i < n:
                if src[i] == '\\':
                    i += 2
                    continue
                if src[i:i + 3] == q3:
                    i += 3
                    break
                i += 1
            if mask_literals:
                blank_span(start, i)
            continue

        if c == '"' or c == "'":
            q = c
            start = i
            i += 1
            while i < n:
                if src[i] == '\\':
                    i += 2
                    continue
                if src[i] == q or src[i] == '\n':
                    i += 1 if src[i] == q else 0
                    break
                i += 1
            if mask_literals:
                blank_span(start, i)
            continue

        i += 1

    return ''.join(out)


def _strip_comments(src: str) -> str:
    return _mask_dart_source(src, mask_literals=False)


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _brace_range(src: str, open_idx: int) -> int:
    if open_idx < 0 or open_idx >= len(src) or src[open_idx] != '{':
        return open_idx
    depth = 0
    for i in range(open_idx, len(src)):
        c = src[i]
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return i + 1
    return len(src)


def _nearest_body(clean: str, pos: int) -> int:
    """Return the index of the body-opening '{' only if it is the next
    terminator after *pos* (vs. ';' for declarations or '=>' for arrow bodies)."""
    cands = [x for x in (clean.find('{', pos), clean.find(';', pos),
                         clean.find('=>', pos)) if x != -1]
    if not cands:
        return -1
    nearest = min(cands)
    return nearest if clean[nearest] == '{' else -1


def _parse_imports(src: str) -> list:
    refs = []
    for m in RE_DART_IMPORT.finditer(src):
        path = m.group('path')
        # package:flutter/material.dart  /  dart:async  /  ../foo/bar.dart
        tail = path.split('/')[-1].split(':')[-1]
        stem = tail[:-5] if tail.endswith('.dart') else tail
        if stem and len(stem) >= 2:
            refs.append(stem)
    return list(dict.fromkeys(refs))


def _split_bases(rest: str) -> list:
    bases = []
    for kw in ('extends', 'with', 'implements', 'on'):
        m = re.search(r'\b' + kw + r'\s+([\w.,<>\[\]\s]+)', rest)
        if not m:
            continue
        clause = re.sub(r'<[^>]*>', '', m.group(1))
        clause = re.split(r'\b(?:with|implements|on)\b', clause)[0]
        for part in clause.split(','):
            name = part.strip().split('.')[-1].strip()
            if name and name not in DART_KEYWORDS:
                bases.append(name)
    return list(dict.fromkeys(bases))


def _extract_calls(text: str, skip_starts=None) -> list:
    skip_starts = skip_starts or set()
    calls = []
    for m in RE_DART_CALL.finditer(text):
        name = m.group(1)
        if m.start(1) in skip_starts:
            continue
        if name in DART_KEYWORDS or len(name) < 2:
            continue
        calls.append(name)
    return calls


def _count_complexity(body: str) -> int:
    if not body:
        return 1
    count = 1
    count += len(_RE_DART_BRANCH_KW.findall(body))
    count += body.count('&&')
    count += body.count('||')
    count += body.count('?')
    return count


def _scan_doc_comments(src: str) -> dict:
    """Map declaration line -> contiguous `///` doc block above it."""
    docs = {}
    lines = src.splitlines()
    i = 0
    while i < len(lines):
        if lines[i].strip().startswith('///'):
            buf = []
            while i < len(lines) and lines[i].strip().startswith('///'):
                buf.append(lines[i].strip()[3:].strip())
                i += 1
            text = '\n'.join(x for x in buf if x).strip()
            if text and i < len(lines):
                docs[i + 1] = text
        else:
            i += 1
    return docs


def _parse_types(src: str, clean: str):
    symbols = []
    ranges = []

    def add(kind, name, start, end_idx, rest):
        line_no = _line_no(src, start)
        end_line = _line_no(src, max(start, end_idx - 1))
        symbols.append({
            'kind': kind,
            'name': name,
            'line': line_no,
            'end_line': end_line,
            'bases': _split_bases(rest),
            'parent': None,
            'is_public': not name.startswith('_'),
            'doc': None,
        })
        ranges.append((start, end_idx, name))

    for m in RE_DART_CLASS.finditer(clean):
        name = m.group('name')
        if name in DART_KEYWORDS:
            continue
        open_idx = clean.find('{', m.end() - 1)
        end_idx = _brace_range(clean, open_idx) if open_idx != -1 else m.end()
        add(m.group('kind'), name, m.start('name'), end_idx, m.group('rest'))

    for m in RE_DART_EXTENSION.finditer(clean):
        name = m.group('name') or m.group('target').split('<')[0].strip()
        if not name or name in DART_KEYWORDS:
            continue
        open_idx = clean.find('{', m.end() - 1)
        end_idx = _brace_range(clean, open_idx) if open_idx != -1 else m.end()
        add('extension', name, m.start(), end_idx, '')

    for m in RE_DART_TYPEDEF.finditer(clean):
        name = m.group('name')
        if name in DART_KEYWORDS:
            continue
        add('typedef', name, m.start('name'), m.end(), '')

    return symbols, ranges


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


def scan_dart(src: str, ext: str = '.dart') -> tuple:
    """Dart file analysis. Returns the standard VIZCODE 6-tuple."""
    import_src = _strip_comments(src)
    clean = _mask_dart_source(src, mask_literals=True)
    docs = _scan_doc_comments(src)

    imports = _parse_imports(import_src)
    type_symbols, type_ranges = _parse_types(src, clean)
    type_starts = {r[0] for r in type_ranges}
    for s in type_symbols:
        s['doc'] = docs.get(s['line'])

    funcdefs = []
    func_calls_by_func = []
    method_symbols = []
    decl_name_starts = set(type_starts)
    seen = set()

    def add_method(name, start_idx, body_open, kind=None):
        line_no = _line_no(src, start_idx)
        key = (name, line_no)
        if key in seen:
            return
        seen.add(key)
        decl_name_starts.add(start_idx)
        if body_open != -1:
            end = _brace_range(clean, body_open)
            body = clean[body_open + 1:end - 1]
            end_line = _line_no(src, end - 1)
        else:
            body = ''
            end_line = line_no
        calls = _extract_calls(body)
        parent = _enclosing(type_ranges, start_idx)
        funcdefs.append({'label': name, 'is_efiapi': False, 'is_static': False})
        func_calls_by_func.append(calls)
        method_symbols.append({
            'kind': kind or ('method' if parent else 'function'),
            'name': name,
            'line': line_no,
            'end_line': end_line,
            'bases': [],
            'parent': parent,
            'is_public': not name.startswith('_'),
            'doc': docs.get(line_no),
            'complexity': _count_complexity(body),
        })

    # Factory + named constructors first (more specific).
    for m in RE_DART_FACTORY.finditer(clean):
        nm = m.group('named') or m.group('cls')
        add_method(nm, m.start(), _nearest_body(clean, m.end() - 1), kind='constructor')

    for m in RE_DART_NAMED_CTOR.finditer(clean):
        if m.start('cls') in decl_name_starts:
            continue
        body_open = m.end() - 1 if m.group('term') == '{' else -1
        add_method(m.group('named'), m.start('named'), body_open, kind='constructor')

    for m in RE_DART_GETSET.finditer(clean):
        name = m.group('name')
        if name in DART_KEYWORDS:
            continue
        body_open = m.end() - 1 if clean[m.end() - 1] == '{' else -1
        add_method(name, m.start('name'), body_open, kind='accessor')

    for m in RE_DART_FUNC.finditer(clean):
        name = m.group('name')
        if name in DART_KEYWORDS:
            continue
        ret = m.group('ret').strip()
        # If a return type/keyword precedes, drop control-flow false positives.
        if ret and ret.split()[-1] in DART_KEYWORDS and ret.split()[-1] not in (
                'void', 'Function'):
            # e.g. `return foo()` — `return` as pseudo-ret -> skip
            if ret.split()[-1] in ('return', 'await', 'yield', 'throw'):
                continue
        body_open = m.end() - 1 if m.group('tail') == '{' else -1
        add_method(name, m.start('name'), body_open)

    symbol_defs = type_symbols + method_symbols
    all_calls = _extract_calls(clean, decl_name_starts)

    docstrings = {}
    for sym in symbol_defs:
        if sym.get('doc'):
            key = f"{sym['parent']}.{sym['name']}" if sym['parent'] else sym['name']
            docstrings[key] = sym['doc']

    extra = {'imports': imports, 'lang': 'dart'}
    if docstrings:
        extra['docstrings'] = docstrings

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs
