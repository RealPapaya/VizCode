#!/usr/bin/env python3
"""
parsers/html_parser.py - VIZCODE HTML Parser

HTML has no functions; it is an include/reference architecture. We extract:

  imports             - local file refs from <script src>, <link href>,
                        <a href>, <iframe src> (external URLs / anchors skipped)
  funcdefs            - always [] (HTML defines no callable symbols)
  funccalls           - always []
  func_calls_by_func  - always []
  symbol_defs         - elements carrying an `id` attribute (kind 'element')

Comments are `<!-- ... -->`. We mask them (preserving offsets) before scanning so
commented-out tags produce no edges. Attribute values are never masked.

Precision-first: a ref becomes an edge only when it looks like a local path. We
skip http(s)://, protocol-relative //, data:, mailto:, tel:, javascript:, and
pure in-page anchors (#...), and strip ?query/#fragment from kept paths.
"""

import re

HTML_EXTENSIONS = {'.html', '.htm', '.xhtml'}

RE_HTML_COMMENT = re.compile(r'<!--.*?-->', re.DOTALL)

RE_SCRIPT_SRC = re.compile(
    r'<script\b[^>]*?\bsrc\s*=\s*["\']([^"\']+)["\']', re.IGNORECASE)
RE_LINK_HREF = re.compile(
    r'<link\b[^>]*?\bhref\s*=\s*["\']([^"\']+)["\']', re.IGNORECASE)
RE_A_HREF = re.compile(
    r'<a\b[^>]*?\bhref\s*=\s*["\']([^"\']+)["\']', re.IGNORECASE)
RE_IFRAME_SRC = re.compile(
    r'<iframe\b[^>]*?\bsrc\s*=\s*["\']([^"\']+)["\']', re.IGNORECASE)

# <tag ... id="name" ...>  → (tag, id)
RE_ELEM_ID = re.compile(
    r'<([A-Za-z][\w-]*)\b[^>]*?\bid\s*=\s*["\']([^"\']+)["\']', re.IGNORECASE)

_SKIP_PREFIXES = (
    'http://', 'https://', '//', 'data:', '#',
    'mailto:', 'tel:', 'javascript:',
)


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _mask_comments(src: str) -> str:
    """Blank <!-- --> comments, preserving newlines and offsets."""
    def repl(m):
        return ''.join('\n' if c == '\n' else ' ' for c in m.group(0))
    return RE_HTML_COMMENT.sub(repl, src)


def _local_path(url: str):
    """Return a cleaned local path, or None if the ref is not a local file."""
    u = url.strip()
    if not u:
        return None
    low = u.lower()
    for p in _SKIP_PREFIXES:
        if low.startswith(p):
            return None
    u = u.split('#', 1)[0].split('?', 1)[0].strip()
    return u or None


def scan_html(src: str, ext: str = '.html') -> tuple:
    """HTML file analysis. Returns the standard 6-tuple."""
    clean = _mask_comments(src)

    imports = []
    for rx in (RE_SCRIPT_SRC, RE_LINK_HREF, RE_A_HREF, RE_IFRAME_SRC):
        for m in rx.finditer(clean):
            ref = _local_path(m.group(1))
            if ref:
                imports.append(ref)
    imports = list(dict.fromkeys(imports))

    symbol_defs = []
    seen_ids = set()
    for m in RE_ELEM_ID.finditer(clean):
        tag = m.group(1).lower()
        name = m.group(2).strip()
        if not name or name in seen_ids:
            continue
        seen_ids.add(name)
        symbol_defs.append({
            'kind': 'element',
            'name': name,
            'line': _line_no(src, m.start()),
            'end_line': _line_no(src, m.start()),
            'bases': [tag],
            'parent': None,
            'is_public': True,
            'doc': None,
            'complexity': 1,
        })

    extra = {'imports': imports, 'lang': 'html'}
    return imports, [], [], extra, [], symbol_defs
