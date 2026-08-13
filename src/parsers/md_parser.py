#!/usr/bin/env python3
"""
parsers/md_parser.py — VizCode Markdown / reST / plain-text parser

Extracts:
  imports            - local file refs from [text](path), ![](), wikilinks,
                       reference-style links, reST :doc: and .. include::
  funcdefs           - always []
  funccalls          - always []
  func_calls_by_func - always []
  symbol_defs        - headings (kind='heading'; markdown/rst only, not .txt)

Edge hints carry the link target, kind, line, and confidence=1.0.

Precision guards:
  - Code blocks (fenced ``` or indented) and inline `code` spans are masked
    before scanning so embedded link syntax is never treated as a real ref.
  - External URLs (http/https/mailto) and in-page anchors (#...) are skipped.
  - wikilinks: [[Page|alias]] and [[Page#section]] → strip alias/anchor,
    append .md extension.
  - Reference-style link definitions: [ref]: path
  - reST :doc:`label <target>` and .. include:: / .. literalinclude::
"""

import re

MARKDOWN_EXTENSIONS = {'.md', '.markdown', '.mdown', '.mkd', '.rst', '.txt'}

# ── Regex patterns ────────────────────────────────────────────────────────────

# Fenced code block: ```...``` or ~~~...~~~
_RE_FENCED = re.compile(r'(`{3,}|~{3,}).*?\1', re.DOTALL)
# Indented code block: 4-space or tab-indented lines
_RE_INDENTED = re.compile(r'(?m)^(?: {4}|\t)[^\n]*')
# Inline code: `...`
_RE_INLINE_CODE = re.compile(r'`[^`\n]+`')

# Inline image and link: ![alt](path) or [text](path)
_RE_INLINE_LINK = re.compile(r'!?\[[^\]]*\]\(([^)]+)\)')
# Wikilink: [[Page]] or [[Page|alias]] or [[Page#section]]
_RE_WIKILINK = re.compile(r'\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]')
# Reference-style link definition: [ref]: path
_RE_REF_DEF = re.compile(r'(?m)^\[[^\]]+\]:\s*(\S+)')

# reST :doc:`label <target>` or :doc:`target`
_RE_RST_DOC = re.compile(r':doc:`(?:[^`<]+<)?([^`>]+)>?`')
# reST .. include:: path or .. literalinclude:: path
_RE_RST_INCLUDE = re.compile(r'(?m)^\.\.\s+(?:literal)?include::\s*(\S+)')

# ATX heading: # Title (markdown / rst, not plain .txt)
_RE_HEADING = re.compile(r'(?m)^(#{1,6})\s+(.*)')


# ── Helpers ───────────────────────────────────────────────────────────────────

def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _mask_code(src: str) -> str:
    """Return src with code blocks and inline code replaced by spaces,
    preserving byte offsets so _line_no() still works."""
    result = list(src)

    def blank(m):
        for i in range(m.start(), m.end()):
            if result[i] != '\n':
                result[i] = ' '

    for rx in (_RE_FENCED, _RE_INDENTED, _RE_INLINE_CODE):
        for m in rx.finditer(src):
            blank(m)
    return ''.join(result)


def _is_external(path: str) -> bool:
    low = path.lower()
    return low.startswith(('http://', 'https://', 'mailto:', 'ftp://'))


def _is_anchor(path: str) -> bool:
    return path.startswith('#')


def _clean_link(path: str) -> str | None:
    """Strip title attribute and fragment; return None if external or anchor."""
    # Inline links may carry a title: (path "title") → take first token
    path = path.split()[0]
    # Strip fragment
    path = path.split('#')[0]
    if not path:
        return None
    if _is_external(path) or _is_anchor(path):
        return None
    return path


def _hint(target: str, via: str, line: int) -> dict:
    return {
        'type': 'doc_ref',
        'target': target,
        'subtype': 'markdown',
        'via': via,
        'line': line,
        'confidence': 1.0,
    }


# ── Public entry point ────────────────────────────────────────────────────────

def scan_markdown(src: str, ext: str = '.md') -> tuple:
    """Markdown / reST / plain-text analysis.  Returns the standard 6-tuple."""
    clean = _mask_code(src)

    imports = []
    edge_hints = []
    seen_targets: set[str] = set()

    def _add(target: str, via: str, line: int) -> None:
        imports.append(target)
        key = (target, via, line)
        if key not in seen_targets:
            seen_targets.add(key)
            edge_hints.append(_hint(target, via, line))

    # ── Inline links and images ───────────────────────────────────────────────
    for m in _RE_INLINE_LINK.finditer(clean):
        ref = _clean_link(m.group(1))
        if ref:
            _add(ref, 'link', _line_no(src, m.start()))

    # ── Wikilinks ─────────────────────────────────────────────────────────────
    for m in _RE_WIKILINK.finditer(clean):
        page = m.group(1).strip()
        if page:
            target = page if '.' in page else page + '.md'
            _add(target, 'wikilink', _line_no(src, m.start()))

    # ── Reference-style link definitions ─────────────────────────────────────
    for m in _RE_REF_DEF.finditer(clean):
        ref = _clean_link(m.group(1))
        if ref:
            _add(ref, 'ref_def', _line_no(src, m.start()))

    # ── reST-specific refs (only when extension warrants it) ─────────────────
    # Scan the original src here: :doc:`...` uses backticks that _mask_code
    # would blank as inline code, making the pattern unmatchable.
    if ext in ('.rst', '.txt'):
        for m in _RE_RST_DOC.finditer(src):
            page = m.group(1).strip()
            if page:
                target = page if '.' in page else page + '.rst'
                _add(target, ':doc:', _line_no(src, m.start()))
        for m in _RE_RST_INCLUDE.finditer(src):
            ref = _clean_link(m.group(1))
            if ref:
                _add(ref, '.. include::', _line_no(src, m.start()))

    imports = list(dict.fromkeys(imports))

    # ── Symbol defs: headings (markdown/rst only — not plain .txt) ───────────
    symbol_defs = []
    if ext not in ('.txt',):
        for m in _RE_HEADING.finditer(src):
            level = len(m.group(1))
            name = m.group(2).strip()
            line = _line_no(src, m.start())
            symbol_defs.append({
                'kind': 'heading',
                'name': name,
                'line': line,
                'end_line': line,
                'bases': [],
                'parent': None,
                'is_public': True,
                'doc': None,
                'complexity': level,
            })

    extra = {'imports': imports, 'lang': 'markdown'}
    if edge_hints:
        extra['edge_hints'] = edge_hints
    return imports, [], [], extra, [], symbol_defs
