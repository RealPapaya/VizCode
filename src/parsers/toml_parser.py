#!/usr/bin/env python3
"""
parsers/toml_parser.py - VIZCODE TOML Parser

TOML is data/config; it has no functions and no file-level dependencies (Cargo
`[dependencies]` etc. name packages, not files, so they are intentionally not
turned into edges). We extract:

  imports             - always [] (no precision-safe file edges exist)
  funcdefs            - always []
  funccalls           - always []
  func_calls_by_func  - always []
  symbol_defs         - tables `[table]` and array-of-tables `[[table]]` (kind 'table')

Comments are `#` (not inside strings). String forms: basic and literal strings,
plus their triple-quoted multiline variants. All are masked (offsets preserved)
before scanning so a `#` or `[` inside a value is never misread.
"""

import re

TOML_EXTENSIONS = {'.toml'}

# Table header at line start: [table] or [[array.table]]
RE_TOML_TABLE = re.compile(r'(?m)^[ \t]*(\[\[?)\s*([^\[\]]+?)\s*(\]\]?)')


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _blank(out: list, start: int, end: int) -> None:
    n = len(out)
    for k in range(start, min(end, n)):
        if out[k] != '\n':
            out[k] = ' '


def _mask(src: str) -> str:
    """Blank comments and string literals, preserving offsets."""
    out = list(src)
    n = len(src)
    i = 0
    while i < n:
        three = src[i:i + 3]
        c = src[i]
        if three == '"""' or three == "'''":
            end = src.find(three, i + 3)
            end = (end + 3) if end != -1 else n
            _blank(out, i, end)
            i = end
            continue
        if c == '"':
            start = i
            i += 1
            while i < n:
                if src[i] == '\\':
                    i += 2
                    continue
                if src[i] == '"':
                    i += 1
                    break
                if src[i] == '\n':
                    break
                i += 1
            _blank(out, start, i)
            continue
        if c == "'":                       # literal string (no escapes)
            start = i
            i += 1
            while i < n and src[i] != "'" and src[i] != '\n':
                i += 1
            if i < n and src[i] == "'":
                i += 1
            _blank(out, start, i)
            continue
        if c == '#':
            while i < n and src[i] != '\n':
                out[i] = ' '
                i += 1
            continue
        i += 1
    return ''.join(out)


def scan_toml(src: str, ext: str = '.toml') -> tuple:
    """TOML file analysis. Returns the standard 6-tuple."""
    clean = _mask(src)

    symbol_defs = []
    seen = set()
    for m in RE_TOML_TABLE.finditer(clean):
        is_array = m.group(1) == '[[' and m.group(3) == ']]'
        name = m.group(2).strip()
        if not name:
            continue
        key = (name, is_array)
        if key in seen:
            continue
        seen.add(key)
        symbol_defs.append({
            'kind': 'table',
            'name': name,
            'line': _line_no(src, m.start()),
            'end_line': _line_no(src, m.start()),
            'bases': ['array'] if is_array else [],
            'parent': None,
            'is_public': True,
            'doc': None,
            'complexity': 1,
        })

    extra = {'imports': [], 'lang': 'toml'}
    return [], [], [], extra, [], symbol_defs
