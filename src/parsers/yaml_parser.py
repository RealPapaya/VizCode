#!/usr/bin/env python3
"""
parsers/yaml_parser.py - VIZCODE YAML Parser

YAML is data/config; it has no functions. We extract:

  imports             - local file refs from `$ref:`, `!include`/`!import`,
                        and `extends`-style `file:` keys
  funcdefs            - always []
  funccalls           - always []
  func_calls_by_func  - always []
  symbol_defs         - top-level mapping keys (kind 'key')

Comments are `#` (only when at line start or preceded by whitespace, and not
inside a quoted scalar). We blank them before scanning.

Precision-first: a ref becomes an edge only when it clearly names a local file
(contains `/` or ends in .yaml/.yml/.json) and is not a URL. JSON-pointer
fragments (`$ref: '#/...'`) resolve to no file and are skipped. Package names,
GitHub Actions `uses:` refs, and other non-file values are intentionally ignored.
"""

import re

YAML_EXTENSIONS = {'.yaml', '.yml'}

RE_YAML_REF = re.compile(r'\$ref\s*:\s*["\']?([^"\'\s]+)')
RE_YAML_INCLUDE = re.compile(r'!(?:include|import)\b\s*["\']?([^"\'\s]+)')
RE_YAML_FILE = re.compile(
    r'^[ \t]*file\s*:\s*["\']?([^"\'\s]+)', re.MULTILINE)
# Top-level key at column 0: `key:` (unquoted), excludes list items / comments.
RE_YAML_TOP_KEY = re.compile(
    r'^([A-Za-z_][\w\-]*)\s*:(?:\s|$)', re.MULTILINE)


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _mask_comments(src: str) -> str:
    """Blank `#` line comments, preserving offsets. A `#` is a comment only at
    line start or when preceded by whitespace, and never inside a quoted scalar."""
    out = list(src)
    n = len(src)
    i = 0
    in_squote = in_dquote = False
    prev_ws = True  # start-of-line counts as preceded by whitespace
    while i < n:
        c = src[i]
        if c == '\n':
            in_squote = in_dquote = False
            prev_ws = True
            i += 1
            continue
        if in_squote:
            if c == "'":
                in_squote = False
            prev_ws = False
        elif in_dquote:
            if c == '"':
                in_dquote = False
            prev_ws = False
        elif c == "'":
            in_squote = True
            prev_ws = False
        elif c == '"':
            in_dquote = True
            prev_ws = False
        elif c == '#' and prev_ws:
            while i < n and src[i] != '\n':
                out[i] = ' '
                i += 1
            continue
        else:
            prev_ws = c in ' \t'
        i += 1
    return ''.join(out)


def _yaml_local(val: str):
    """Return a cleaned local-file ref, or None if not a local file path."""
    v = val.strip().strip('"\'')
    if not v:
        return None
    v = v.split('#', 1)[0].strip()  # drop JSON-pointer fragment
    if not v:
        return None
    low = v.lower()
    if low.startswith(('http://', 'https://', '//')):
        return None
    if '/' in v or low.endswith(('.yaml', '.yml', '.json')):
        return v
    return None


def scan_yaml(src: str, ext: str = '.yaml') -> tuple:
    """YAML file analysis. Returns the standard 6-tuple."""
    clean = _mask_comments(src)

    imports = []
    for rx in (RE_YAML_REF, RE_YAML_INCLUDE, RE_YAML_FILE):
        for m in rx.finditer(clean):
            ref = _yaml_local(m.group(1))
            if ref:
                imports.append(ref)
    imports = list(dict.fromkeys(imports))

    symbol_defs = []
    seen = set()
    for m in RE_YAML_TOP_KEY.finditer(clean):
        name = m.group(1)
        if name in seen:
            continue
        seen.add(name)
        symbol_defs.append({
            'kind': 'key',
            'name': name,
            'line': _line_no(src, m.start()),
            'end_line': _line_no(src, m.start()),
            'bases': [],
            'parent': None,
            'is_public': True,
            'doc': None,
            'complexity': 1,
        })

    extra = {'imports': imports, 'lang': 'yaml'}
    return imports, [], [], extra, [], symbol_defs
