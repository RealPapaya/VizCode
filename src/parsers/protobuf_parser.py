#!/usr/bin/env python3
"""
parsers/protobuf_parser.py - VIZCODE Protocol Buffers Parser

Extracts:
  imports             - leaf names of `import "other.proto";` targets
  funcdefs            - `rpc Name(Req) returns (Resp)` service methods
  funccalls           - (intentionally minimal; proto has no call graph)
  func_calls_by_func  - parallel to funcdefs (rpc option bodies, usually empty)
  symbol_defs         - message / enum / service (+ nested), rpc methods

Protobuf is a schema/IDL: dependencies are explicit file imports; "definitions"
are messages, enums, services, and rpc methods. Bodies are brace blocks `{ }`;
rpc with no option body (`... returns (Resp);`) degrades to its declaration line.

Syntax verified against the protobuf language guide (proto2/proto3):
  line `//`, block `/* */` (NON-nesting) comments; strings `"..."` / `'...'`.
"""

import re

PROTOBUF_EXTENSIONS = {'.proto'}

PROTO_KEYWORDS = {
    'syntax', 'package', 'import', 'public', 'weak', 'option', 'message',
    'enum', 'service', 'rpc', 'returns', 'stream', 'repeated', 'optional',
    'required', 'reserved', 'oneof', 'map', 'extend', 'extensions', 'to',
    'group', 'true', 'false', 'max', 'default',
    'double', 'float', 'int32', 'int64', 'uint32', 'uint64', 'sint32',
    'sint64', 'fixed32', 'fixed64', 'sfixed32', 'sfixed64', 'bool', 'string',
    'bytes',
}

RE_PROTO_IMPORT = re.compile(r'^\s*import\s+(?:public\s+|weak\s+)?"([^"]+)"',
                             re.MULTILINE)
RE_PROTO_PACKAGE = re.compile(r'^\s*package\s+([\w.]+)', re.MULTILINE)
RE_PROTO_TYPE = re.compile(
    r'(?:^|[\s{};])(?P<kind>message|enum|service)\s+(?P<name>[A-Za-z_]\w*)',
    re.MULTILINE)
RE_PROTO_RPC = re.compile(r'^\s*rpc\s+(?P<name>[A-Za-z_]\w*)\s*\(', re.MULTILINE)
RE_PROTO_CALL = re.compile(r'\b([A-Za-z_]\w*)\s*\(')


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _mask_proto(src: str, mask_literals: bool = False) -> str:
    """Mask comments (and optionally string literals), preserving offsets."""
    out = list(src)
    i, n = 0, len(src)

    def blank(a, b):
        for j in range(a, min(b, n)):
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
            blank(start, i)
            continue
        if c == '/' and nxt == '*':
            start = i
            i += 2
            while i + 1 < n and not (src[i] == '*' and src[i + 1] == '/'):
                i += 1
            i = i + 2 if i + 1 < n else n
            blank(start, i)
            continue
        if c in '"\'':
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
            if mask_literals:
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


def _enclosing(ranges, idx, exclude_start=None):
    """Smallest range strictly containing idx (optionally excluding one)."""
    best = None
    best_span = None
    for start, end, name in ranges:
        if start == exclude_start:
            continue
        if start <= idx < end:
            span = end - start
            if best_span is None or span < best_span:
                best_span = span
                best = name
    return best


def _parse_imports(src: str) -> list:
    refs = []
    for m in RE_PROTO_IMPORT.finditer(src):
        path = m.group(1)
        base = re.split(r'[/\\]', path)[-1] if path else ''
        # strip trailing .proto extension, keep the stem
        ref = base[:-6] if base.endswith('.proto') else base
        if ref and len(ref) >= 2:
            refs.append(ref)
    return list(dict.fromkeys(refs))


def scan_protobuf(src: str, ext: str = '.proto') -> tuple:
    """Protobuf file analysis. Returns the standard VIZCODE 6-tuple."""
    import_src = _mask_proto(src, mask_literals=False)
    clean = _mask_proto(src, mask_literals=True)

    imports = _parse_imports(import_src)
    package = (RE_PROTO_PACKAGE.search(import_src) or None)
    package = package.group(1) if package else ''

    symbol_defs = []
    ranges = []
    seen = set()

    for m in RE_PROTO_TYPE.finditer(clean):
        kind = m.group('kind')
        name = m.group('name')
        if name in PROTO_KEYWORDS or len(name) < 2:
            continue
        start = m.start('name')
        if name in seen:
            continue
        seen.add(name)
        open_idx = clean.find('{', m.end())
        end_idx = _brace_range(clean, open_idx) if open_idx != -1 else m.end()
        ranges.append((start, end_idx, name))
        symbol_defs.append({
            'kind': kind, 'name': name,
            'line': _line_no(src, start),
            'end_line': _line_no(src, max(start, end_idx - 1)),
            'bases': [], 'parent': None, 'is_public': True, 'doc': None,
            '_start': start,
        })

    # nested-type parent attribution
    for s in symbol_defs:
        s['parent'] = _enclosing(ranges, s['_start'], exclude_start=s['_start'])
        s.pop('_start', None)

    funcdefs = []
    func_calls_by_func = []
    method_symbols = []
    seen_rpc = set()
    for m in RE_PROTO_RPC.finditer(clean):
        name = m.group('name')
        if name in PROTO_KEYWORDS or len(name) < 2:
            continue
        start = m.start('name')
        key = (name, _line_no(src, start))
        if key in seen_rpc:
            continue
        seen_rpc.add(key)
        parent = _enclosing(ranges, start)
        # rpc option body `{ ... }` is optional
        open_idx = clean.find('{', m.end())
        semi_idx = clean.find(';', m.end())
        line_no = _line_no(src, start)
        if open_idx != -1 and (semi_idx == -1 or open_idx < semi_idx):
            end_idx = _brace_range(clean, open_idx)
            end_line = _line_no(src, end_idx - 1)
        else:
            end_line = line_no
        funcdefs.append({'label': name, 'is_efiapi': False, 'is_static': False})
        func_calls_by_func.append([])
        method_symbols.append({
            'kind': 'method' if parent else 'function', 'name': name,
            'line': line_no, 'end_line': end_line, 'bases': [],
            'parent': parent, 'is_public': True, 'doc': None, 'complexity': 1,
        })

    symbol_defs += method_symbols
    extra = {'imports': imports, 'lang': 'protobuf'}
    if package:
        extra['package'] = package

    return imports, funcdefs, [], extra, func_calls_by_func, symbol_defs
