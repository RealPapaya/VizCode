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
GQL_BUILTIN_SCALARS = {'Int', 'Float', 'String', 'Boolean', 'ID'}

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
RE_GQL_FIELD_START = re.compile(
    r'^[ \t]*(?P<name>[A-Za-z_]\w*)\s*(?P<kind>[:(])',
    re.MULTILINE)


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


def _gql_type_refs(type_text: str) -> list:
    refs = []
    for name in re.findall(r'\b[A-Za-z_]\w*\b', type_text or ''):
        if name in GQL_KEYWORDS or name in GQL_BUILTIN_SCALARS or len(name) < 2:
            continue
        refs.append(name)
    return list(dict.fromkeys(refs))


def _matching_paren(src: str, open_idx: int) -> int:
    depth = 0
    for i in range(open_idx, len(src)):
        c = src[i]
        if c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
            if depth == 0:
                return i
    return -1


def _arg_type_refs(args: str) -> list:
    refs = []
    for m in re.finditer(r':\s*([^=,@)\n]+)', args or ''):
        refs.extend(_gql_type_refs(m.group(1)))
    return list(dict.fromkeys(refs))


def _clean_signature(args: str, ret: str) -> str:
    arg_sig = re.sub(r'\s+', ' ', (args or '').strip())
    ret_sig = re.sub(r'\s+', ' ', (ret or '').strip())
    return f'({arg_sig}) -> {ret_sig}' if ret_sig else f'({arg_sig})'


def _parse_field_entries(body: str, body_start: int) -> list:
    entries = []
    for m in RE_GQL_FIELD_START.finditer(body):
        name = m.group('name')
        if name in GQL_KEYWORDS or len(name) < 2:
            continue
        args = ''
        ret = ''
        if m.group('kind') == '(':
            open_idx = m.end('kind') - 1
            close_idx = _matching_paren(body, open_idx)
            if close_idx == -1:
                continue
            args = body[open_idx + 1:close_idx]
            colon = body.find(':', close_idx + 1)
            line_end = body.find('\n', close_idx + 1)
            if line_end == -1:
                line_end = len(body)
            if colon == -1 or colon > line_end:
                continue
            ret = body[colon + 1:line_end]
        else:
            colon = m.end('kind') - 1
            line_end = body.find('\n', colon + 1)
            if line_end == -1:
                line_end = len(body)
            ret = body[colon + 1:line_end]
        ret = re.split(r'[@=]', ret, 1)[0].strip()
        refs = _gql_type_refs(ret) + _arg_type_refs(args)
        entries.append({
            'name': name,
            'args': args,
            'return': ret,
            'type_refs': list(dict.fromkeys(refs)),
            'start': body_start + m.start('name'),
            'has_args': bool(args or m.group('kind') == '('),
        })
    return entries


def _parse_imports(raw: str) -> list:
    refs = []
    for ref, _line in _parse_import_entries(raw):
        refs.append(ref)
    return list(dict.fromkeys(refs))


def _parse_import_entries(raw: str) -> list:
    refs = []
    for m in RE_GQL_IMPORT.finditer(raw):
        base = re.split(r'[/\\]', m.group(1))[-1]
        for ext in ('.graphql', '.gql'):
            if base.endswith(ext):
                base = base[:-len(ext)]
                break
        if base and len(base) >= 2:
            refs.append((base, _line_no(raw, m.start())))
    return refs


def _hint(target: str, line: int) -> dict:
    return {
        'type': 'import',
        'target': target,
        'subtype': 'schema',
        'via': '#import',
        'line': line,
        'confidence': 1.0,
    }


def scan_graphql(src: str, ext: str = '.graphql') -> tuple:
    """GraphQL SDL analysis. Returns the standard VIZCODE 6-tuple."""
    import_entries = _parse_import_entries(src)        # imports live in `#import` comments
    imports = list(dict.fromkeys(ref for ref, _line in import_entries))
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
        body = ''
        body_start = end_idx
        if has_brace:
            body_start = m.end()
            body = clean[body_start:max(body_start, end_idx - 1)]
        field_entries = _parse_field_entries(body, body_start) if kind in ('type', 'input', 'interface') else []
        type_refs = []
        for entry in field_entries:
            type_refs.extend(entry['type_refs'])
        symbol_defs.append({
            'kind': kind, 'name': name,
            'line': _line_no(src, start),
            'end_line': _line_no(src, max(start, end_idx - 1)),
            'bases': _parse_bases(kind, m.group('rest')),
            'parent': None, 'is_public': True, 'doc': None,
            'type_refs': list(dict.fromkeys(type_refs)),
        })

    funcdefs = []
    func_calls_by_func = []
    seen_field = set()
    for start_range, end_range, parent in ranges:
        body_start = clean.find('{', start_range, end_range)
        if body_start == -1:
            continue
        body_start += 1
        body = clean[body_start:max(body_start, end_range - 1)]
        for entry in _parse_field_entries(body, body_start):
            if not entry['has_args']:
                continue
            name = entry['name']
            start = entry['start']
            if _enclosing(ranges, start) != parent:
                continue
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
                'signature': _clean_signature(entry['args'], entry['return']),
                'type_refs': entry['type_refs'],
            })

    extra = {'imports': imports, 'lang': 'graphql'}
    if import_entries:
        extra['edge_hints'] = [_hint(ref, line) for ref, line in import_entries]
    return imports, funcdefs, [], extra, func_calls_by_func, symbol_defs
