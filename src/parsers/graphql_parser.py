#!/usr/bin/env python3
"""
parsers/graphql_parser.py - VIZCODE GraphQL SDL Parser

Extracts:
  imports             - leaf names of `#import "fragment.graphql"` (Apollo conv.)
  funcdefs            - fields that take arguments `field(args): Type` (resolvers)
  funccalls           - (none; GraphQL SDL has no call graph)
  func_calls_by_func  - parallel to funcdefs (always empty)
  symbol_defs         - type / input / interface / enum / union / scalar / fragment
                        + argument-bearing fields as methods

GraphQL has no native module system; the `#import` directive is an Apollo tooling
convention that lives inside a `#` comment, so it is parsed from raw source before
comment masking. Definitions use brace bodies `{ }`; union/scalar (no braces)
degrade to the declaration line.

Syntax verified against the GraphQL spec (June 2018):
  `#` line comments; string descriptions (single-quoted and triple-quoted block
  strings). `implements A & B` for interfaces, `union U = A | B` for members.
"""

import re

GRAPHQL_EXTENSIONS = {'.graphql', '.gql'}

GQL_KEYWORDS = {
    'type', 'input', 'interface', 'enum', 'union', 'scalar', 'schema',
    'extend', 'implements', 'fragment', 'on', 'query', 'mutation',
    'subscription', 'directive', 'true', 'false', 'null', 'repeatable',
    'Int', 'Float', 'String', 'Boolean', 'ID',
}

# #import "fragment.graphql"  — Apollo convention (canonical: no space after #),
# parsed from RAW source. A spaced `# import ...` is a normal comment, not this.
RE_GQL_IMPORT = re.compile(r'''^\s*#import\s+["']([^"']+)["']''', re.MULTILINE)
RE_GQL_TYPE = re.compile(
    r'(?:^|\s)(?:extend\s+)?'
    r'(?P<kind>type|input|interface|enum|union|scalar|fragment)\s+'
    r'(?P<name>[A-Za-z_]\w*)(?P<rest>[^{]*?)(?:\{|$)',
    re.MULTILINE)
# field with arguments: name(args): Type   — argument-bearing field = resolver
RE_GQL_FIELD = re.compile(r'^[ \t]*(?P<name>[A-Za-z_]\w*)\s*\(', re.MULTILINE)


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _mask_gql(src: str) -> str:
    """Blank `#` comments and string/block-string descriptions, keeping offsets."""
    out = list(src)
    i, n = 0, len(src)

    def blank(a, b):
        for j in range(a, min(b, n)):
            if out[j] != '\n':
                out[j] = ' '

    while i < n:
        c = src[i]
        if c == '#':
            start = i
            while i < n and src[i] != '\n':
                i += 1
            blank(start, i)
            continue
        if c == '"' and src[i + 1:i + 3] == '""':
            start = i
            i += 3
            while i < n and src[i:i + 3] != '"""':
                i += 1
            i = i + 3 if i < n else n
            blank(start, i)
            continue
        if c == '"':
            start = i
            i += 1
            while i < n:
                if src[i] == '\\':
                    i += 2
                    continue
                if src[i] == '"' or src[i] == '\n':
                    i += 1 if src[i] == '"' else 0
                    break
                i += 1
            blank(start, i)
            continue
        i += 1
    return ''.join(out)


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


def _enclosing(ranges, idx):
    best, best_span = None, None
    for start, end, name in ranges:
        if start <= idx < end:
            span = end - start
            if best_span is None or span < best_span:
                best_span, best = span, name
    return best


def _parse_bases(kind: str, rest: str) -> list:
    bases = []
    if kind == 'union':
        m = re.search(r'=\s*(.+)', rest)
        if m:
            for part in m.group(1).split('|'):
                name = part.strip()
                if name and name not in GQL_KEYWORDS:
                    bases.append(name)
    else:
        m = re.search(r'\bimplements\b(.+)', rest)
        if m:
            for part in re.split(r'[&,]', m.group(1)):
                name = part.strip()
                if name and name not in GQL_KEYWORDS:
                    bases.append(name)
    return list(dict.fromkeys(bases))


def _parse_imports(raw: str) -> list:
    refs = []
    for m in RE_GQL_IMPORT.finditer(raw):
        base = re.split(r'[/\\]', m.group(1))[-1]
        for ext in ('.graphql', '.gql'):
            if base.endswith(ext):
                base = base[:-len(ext)]
                break
        if base and len(base) >= 2:
            refs.append(base)
    return list(dict.fromkeys(refs))


def scan_graphql(src: str, ext: str = '.graphql') -> tuple:
    """GraphQL SDL analysis. Returns the standard VIZCODE 6-tuple."""
    imports = _parse_imports(src)        # imports live in `#import` comments
    clean = _mask_gql(src)

    symbol_defs = []
    ranges = []
    seen = set()

    for m in RE_GQL_TYPE.finditer(clean):
        kind = m.group('kind')
        name = m.group('name')
        if name in GQL_KEYWORDS or len(name) < 2 or name in seen:
            continue
        seen.add(name)
        start = m.start('name')
        has_brace = clean[m.end() - 1:m.end()] == '{'
        if has_brace:
            end_idx = _brace_range(clean, m.end() - 1)
        else:
            end_idx = m.end()
        ranges.append((start, end_idx, name))
        symbol_defs.append({
            'kind': kind, 'name': name,
            'line': _line_no(src, start),
            'end_line': _line_no(src, max(start, end_idx - 1)),
            'bases': _parse_bases(kind, m.group('rest')),
            'parent': None, 'is_public': True, 'doc': None,
        })

    funcdefs = []
    func_calls_by_func = []
    seen_field = set()
    for m in RE_GQL_FIELD.finditer(clean):
        name = m.group('name')
        if name in GQL_KEYWORDS or len(name) < 2:
            continue
        start = m.start('name')
        parent = _enclosing(ranges, start)
        if parent is None:
            continue  # a `name(` outside any type body is not a field
        key = (name, parent)
        if key in seen_field:
            continue
        seen_field.add(key)
        funcdefs.append({'label': name, 'is_efiapi': False, 'is_static': False})
        func_calls_by_func.append([])
        symbol_defs.append({
            'kind': 'method', 'name': name, 'line': _line_no(src, start),
            'end_line': _line_no(src, start), 'bases': [], 'parent': parent,
            'is_public': True, 'doc': None, 'complexity': 1,
        })

    extra = {'imports': imports, 'lang': 'graphql'}
    return imports, funcdefs, [], extra, func_calls_by_func, symbol_defs
