#!/usr/bin/env python3
"""
parsers/vbnet_parser.py - VIZCODE VB.NET Language Parser

Extracts:
  imports             - `Imports X.Y` → leaf namespace segment
  funcdefs            - Sub / Function / Property
  funccalls           - call expressions
  func_calls_by_func  - per-routine call lists (`End Sub`/`End Function` matching)
  symbol_defs         - Class / Module / Structure / Interface / Enum / routine

VB.NET keywords are case-insensitive. Blocks close with `End <Keyword>`, matched
per-keyword with depth counting (so nested same-kind blocks resolve correctly).
Members without an `End` (Interface members, `MustOverride`, auto-properties,
`Declare`) degrade to the declaration line. Comments are `'` and `REM`; strings
use `"` with `""` as the escape (verified against the VB language reference).
"""

import re

VBNET_EXTENSIONS = {'.vb'}

VB_KEYWORDS = {
    'sub', 'function', 'class', 'module', 'structure', 'interface', 'enum',
    'property', 'end', 'if', 'then', 'else', 'elseif', 'for', 'each', 'while',
    'do', 'loop', 'next', 'select', 'case', 'try', 'catch', 'finally', 'with',
    'using', 'synclock', 'return', 'dim', 'as', 'new', 'imports', 'namespace',
    'public', 'private', 'protected', 'friend', 'shared', 'overrides', 'me',
    'mybase', 'nothing', 'true', 'false', 'and', 'or', 'not', 'andalso',
    'orelse', 'is', 'isnot', 'byval', 'byref', 'optional', 'call',
}

_VB_MODS = (r'(?:public|private|protected|friend|shared|overrides|overridable|'
            r'mustoverride|notoverridable|partial|default|readonly|writeonly|'
            r'shadows|overloads|mustinherit|notinheritable|async|iterator|'
            r'narrowing|widening|static)\s+')

RE_VB_IMPORT = re.compile(r'^[ \t]*Imports\s+(?:\w+\s*=\s*)?([\w.]+)',
                          re.MULTILINE | re.IGNORECASE)
RE_VB_TYPE = re.compile(
    r'^[ \t]*(?:' + _VB_MODS + r')*(Class|Module|Structure|Interface|Enum)\s+'
    r'([A-Za-z_]\w*)', re.MULTILINE | re.IGNORECASE)
RE_VB_ROUTINE = re.compile(
    r'^[ \t]*(?:' + _VB_MODS + r')*(Sub|Function|Property)\s+([A-Za-z_]\w*)',
    re.MULTILINE | re.IGNORECASE)
RE_VB_CALL = re.compile(r'\b([A-Za-z_]\w*)\s*\(')
_RE_VB_BRANCH_KW = re.compile(
    r'\b(?:if|elseif|for|while|case|catch)\b', re.IGNORECASE)


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _mask_vb(src: str) -> str:
    out = list(src)
    n = len(src)

    def blank(start: int, end: int) -> None:
        for j in range(start, min(end, n)):
            if out[j] != '\n':
                out[j] = ' '

    i = 0
    at_line_start = True
    while i < n:
        c = src[i]
        if c == "'":
            start = i
            while i < n and src[i] != '\n':
                i += 1
            blank(start, i)
            at_line_start = True
            continue
        if at_line_start and src[i:i + 3].lower() == 'rem' and \
                (i + 3 >= n or not (src[i + 3].isalnum() or src[i + 3] == '_')):
            start = i
            while i < n and src[i] != '\n':
                i += 1
            blank(start, i)
            continue
        if c == '"':
            start = i
            i += 1
            while i < n:
                if src[i] == '"':
                    if src[i + 1:i + 2] == '"':
                        i += 2
                        continue
                    i += 1
                    break
                if src[i] == '\n':
                    break
                i += 1
            blank(start, i)
            continue
        if c == '\n':
            at_line_start = True
        elif c not in ' \t':
            at_line_start = False
        i += 1

    return ''.join(out)


def _end_of(clean: str, kw: str, after_idx: int) -> int:
    """Index just past the matching `End <kw>` (depth-aware), or -1 if none."""
    opener = re.compile(r'^[ \t]*(?:' + _VB_MODS + r')*' + kw + r'\b',
                        re.MULTILINE | re.IGNORECASE)
    closer = re.compile(r'^[ \t]*End\s+' + kw + r'\b',
                        re.MULTILINE | re.IGNORECASE)
    events = []
    for m in opener.finditer(clean, after_idx):
        events.append((m.start(), 1, m.end()))
    for m in closer.finditer(clean, after_idx):
        events.append((m.start(), -1, m.end()))
    events.sort()
    depth = 1
    for _pos, delta, end in events:
        depth += delta
        if depth == 0:
            return end
    return -1


def _extract_calls(text: str) -> list:
    calls = []
    seen = set()
    for m in RE_VB_CALL.finditer(text):
        name = m.group(1)
        if name.lower() in VB_KEYWORDS or len(name) < 2 or name in seen:
            continue
        seen.add(name)
        calls.append(name)
    return calls


def _complexity(body: str) -> int:
    if not body:
        return 1
    return 1 + len(_RE_VB_BRANCH_KW.findall(body))


def _header_line(clean: str, idx: int) -> str:
    line_start = clean.rfind('\n', 0, idx) + 1
    line_end = clean.find('\n', idx)
    return clean[line_start:line_end if line_end != -1 else len(clean)]


def _enclosing(ranges: list, idx: int):
    best = None
    best_span = None
    for start, end, name, kind in ranges:
        if start <= idx < end:
            span = end - start
            if best_span is None or span < best_span:
                best_span = span
                best = (name, kind)
    return best


def scan_vbnet(src: str, ext: str = '.vb') -> tuple:
    """VB.NET file analysis. Returns the standard VIZCODE 6-tuple."""
    clean = _mask_vb(src)

    imports = []
    for m in RE_VB_IMPORT.finditer(clean):
        leaf = m.group(1).split('.')[-1]
        if leaf:
            imports.append(leaf)
    imports = list(dict.fromkeys(imports))

    symbol_defs = []
    type_ranges = []
    for m in RE_VB_TYPE.finditer(clean):
        kind = m.group(1).lower()
        name = m.group(2)
        start = m.start(2)
        end_idx = _end_of(clean, m.group(1), m.end())
        if end_idx == -1:
            end_line = _line_no(src, start)
            end_idx = m.end()
        else:
            end_line = _line_no(src, max(start, end_idx - 1))
        symbol_defs.append({
            'kind': kind, 'name': name, 'line': _line_no(src, start),
            'end_line': end_line, 'bases': [], 'parent': None,
            'is_public': True, 'doc': None,
        })
        type_ranges.append((start, end_idx, name, kind))

    funcdefs = []
    func_calls_by_func = []
    method_symbols = []
    seen = set()
    for m in RE_VB_ROUTINE.finditer(clean):
        kw = m.group(1)
        name = m.group(2)
        start = m.start(2)
        line_no = _line_no(src, start)
        key = (name, line_no)
        if key in seen:
            continue
        seen.add(key)
        header = _header_line(clean, start)
        enc = _enclosing(type_ranges, start)
        parent_kind = enc[1] if enc else None
        no_body = (parent_kind == 'interface' or kw.lower() == 'property' or
                   re.search(r'\b(?:mustoverride|declare)\b', header, re.I))
        if no_body:
            end_idx = m.end()
            end_line = line_no
        else:
            end_idx = _end_of(clean, kw, m.end())
            if end_idx == -1:
                end_idx = m.end()
                end_line = line_no
            else:
                end_line = _line_no(src, max(start, end_idx - 1))
        body = clean[m.end():end_idx]
        funcdefs.append({
            'label': name, 'is_efiapi': False,
            'is_static': bool(re.search(r'\bshared\b', header, re.I)),
        })
        func_calls_by_func.append(_extract_calls(body))
        method_symbols.append({
            'kind': 'method' if enc else 'function',
            'name': name, 'line': line_no, 'end_line': end_line,
            'bases': [], 'parent': enc[0] if enc else None,
            'is_public': not re.search(r'\b(?:private|protected)\b', header, re.I),
            'doc': None, 'complexity': _complexity(body),
        })

    symbol_defs = symbol_defs + method_symbols
    all_calls = _extract_calls(clean)

    extra = {'imports': imports, 'lang': 'vb'}

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs
