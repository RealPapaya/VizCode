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

RE_TAG = re.compile(r'<(?P<tag>[A-Za-z][\w-]*)\b(?P<attrs>[^>]*)>', re.IGNORECASE)
RE_ATTR = re.compile(r'\b([\w:-]+)\s*=\s*["\']([^"\']+)["\']', re.IGNORECASE)

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


def _hint(edge_type: str, target: str, subtype: str, via: str, line: int) -> dict:
    return {
        'type': edge_type,
        'target': target,
        'subtype': subtype,
        'via': via,
        'line': line,
        'confidence': 1.0,
    }


def _srcset_paths(value: str) -> list:
    refs = []
    for item in (value or '').split(','):
        ref = item.strip().split(None, 1)[0]
        local = _local_path(ref)
        if local:
            refs.append(local)
    return refs


def scan_html(src: str, ext: str = '.html') -> tuple:
    """HTML file analysis. Returns the standard 6-tuple."""
    clean = _mask_comments(src)

    imports = []
    edge_hints = []
    hint_seen = set()
    asset_tags = {
        'img': ('src', 'image'),
        'source': ('src', 'media'),
        'video': ('src', 'media'),
        'audio': ('src', 'media'),
        'embed': ('src', 'embed'),
        'object': ('data', 'embed'),
        'track': ('src', 'track'),
    }
    for m in RE_TAG.finditer(clean):
        tag = m.group('tag').lower()
        attrs = {k.lower(): v for k, v in RE_ATTR.findall(m.group('attrs'))}
        line = _line_no(src, m.start())
        if tag == 'script':
            ref = _local_path(attrs.get('src', ''))
            if ref:
                imports.append(ref)
                edge_hints.append(_hint('asset_ref', ref, 'script', 'src', line))
        elif tag == 'link':
            ref = _local_path(attrs.get('href', ''))
            if ref:
                imports.append(ref)
                rel = attrs.get('rel', '').lower()
                if 'stylesheet' in rel:
                    subtype = 'stylesheet'
                    edge_type = 'asset_ref'
                elif any(token in rel for token in ('icon', 'manifest', 'preload', 'modulepreload')):
                    subtype = 'link'
                    edge_type = 'asset_ref'
                else:
                    subtype = 'link'
                    edge_type = 'import'
                edge_hints.append(_hint(edge_type, ref, subtype, 'href', line))
        elif tag == 'a':
            ref = _local_path(attrs.get('href', ''))
            if ref:
                imports.append(ref)
                edge_hints.append(_hint('import', ref, 'document', 'href', line))
        elif tag == 'iframe':
            ref = _local_path(attrs.get('src', ''))
            if ref:
                imports.append(ref)
                edge_hints.append(_hint('asset_ref', ref, 'iframe', 'src', line))
        elif tag in asset_tags:
            via, subtype = asset_tags[tag]
            ref = _local_path(attrs.get(via, ''))
            if ref:
                edge_hints.append(_hint('asset_ref', ref, subtype, via, line))
            if tag in ('img', 'source') and attrs.get('srcset'):
                for srcset_ref in _srcset_paths(attrs.get('srcset', '')):
                    edge_hints.append(_hint('asset_ref', srcset_ref, subtype, 'srcset', line))
            if tag == 'video':
                poster = _local_path(attrs.get('poster', ''))
                if poster:
                    edge_hints.append(_hint('asset_ref', poster, 'poster', 'poster', line))
    imports = list(dict.fromkeys(imports))
    deduped_hints = []
    for hint in edge_hints:
        key = (hint['type'], hint['target'], hint['subtype'], hint['via'], hint['line'])
        if key in hint_seen:
            continue
        hint_seen.add(key)
        deduped_hints.append(hint)

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
    if deduped_hints:
        extra['edge_hints'] = deduped_hints
    return imports, [], [], extra, [], symbol_defs
