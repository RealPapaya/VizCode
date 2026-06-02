#!/usr/bin/env python3
"""
parsers/css_parser.py - VIZCODE CSS-family Stylesheet Parser

Handles .css / .scss / .sass / .less / .styl in one parser (mirrors objc which
serves .m/.mm). Extracts:
  imports             - `@import/@use/@forward "x"` (CSS/SCSS) and `@import/@require`
                        (LESS/Stylus) → file stem (matches the referenced file)
  funcdefs            - SCSS `@mixin`/`@function`, LESS `.mixin()`, Stylus `name()`
  funccalls           - mixin / function call expressions
  func_calls_by_func  - per-definition call lists (brace-scoped; degrades for .sass)
  symbol_defs         - mixin / function / keyframes

Comment syntax verified against the CSS Syntax spec, the Sass docs, the Less
docs and the Stylus docs:
  * `/* */` block comments exist in every dialect.
  * SCSS, LESS and Stylus additionally allow `//` line comments; plain CSS and
    indented `.sass` do NOT (so `//` is masked only for those dialects).
  * `.sass` and `.styl` are indentation-based (no braces) → definition bodies
    degrade to the declaration line rather than guess a brace range.
"""

import re

CSS_EXTENSIONS = {'.css', '.scss', '.sass', '.less', '.styl'}

_LANG_BY_EXT = {
    '.css': 'css', '.scss': 'scss', '.sass': 'sass',
    '.less': 'less', '.styl': 'stylus',
}

# @import / @use / @forward / @require, capturing every quoted target on the rule.
RE_CSS_AT_IMPORT = re.compile(
    r'@(?P<kw>import|use|forward|require)\b(?P<body>[^;{\n]*)', re.IGNORECASE)
RE_CSS_QUOTED = re.compile(r'''['"]([^'"]+)['"]''')
RE_CSS_URL = re.compile(r'''\burl\(\s*(['"]?)(?P<target>[^'")\s]+)\1\s*\)''', re.IGNORECASE)

RE_SCSS_MIXIN = re.compile(r'@mixin\s+([A-Za-z_][\w-]*)', re.IGNORECASE)
RE_SCSS_FUNC = re.compile(r'@function\s+([A-Za-z_][\w-]*)', re.IGNORECASE)
RE_CSS_KEYFRAMES = re.compile(
    r'@(?:-\w+-)?keyframes\s+([A-Za-z_][\w-]*)', re.IGNORECASE)
# LESS parametric mixin: `.name(...) {`  (class selector immediately followed by parens)
RE_LESS_MIXIN = re.compile(r'^[ \t]*\.([A-Za-z_][\w-]*)\s*\(', re.MULTILINE)
# Stylus function / mixin: `name(args)` at start of line (no selector punctuation)
RE_STYLUS_FUNC = re.compile(r'^[ \t]*([A-Za-z_][\w-]*)\s*\(', re.MULTILINE)

RE_CSS_CALL = re.compile(r'\b([A-Za-z_][\w-]*)\s*\(')

_CALL_BUILTINS = {
    'rgb', 'rgba', 'hsl', 'hsla', 'url', 'var', 'calc', 'translate', 'scale',
    'rotate', 'translatex', 'translatey', 'translatez', 'matrix', 'linear-gradient',
    'radial-gradient', 'attr', 'counter', 'cubic-bezier', 'min', 'max', 'clamp',
    'repeat', 'minmax', 'format', 'local', 'if', 'and', 'or', 'not', 'env',
}


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _hint(target: str, via: str, line: int, subtype: str = 'stylesheet') -> dict:
    return {
        'type': 'asset_ref',
        'target': target,
        'subtype': subtype,
        'via': via,
        'line': line,
        'confidence': 1.0,
    }


def _local_asset_ref(target: str):
    ref = target.strip()
    if not ref:
        return None
    low = ref.lower()
    if low.startswith(('http://', 'https://', '//', 'data:', '#')):
        return None
    ref = ref.split('#', 1)[0].split('?', 1)[0].strip()
    if not ref:
        return None
    base = re.split(r'[\\/]', ref)[-1]
    if '.' not in base:
        return None
    return ref


def _mask_css(src: str, lang: str, mask_strings: bool = True) -> str:
    """Blank comments (and optionally strings), preserving offsets/newlines.
    `//` line comments are masked only for scss/less/stylus."""
    out = list(src)
    n = len(src)
    line_comment = lang in ('scss', 'less', 'stylus')

    def blank(start: int, end: int) -> None:
        for j in range(start, min(end, n)):
            if out[j] != '\n':
                out[j] = ' '

    i = 0
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ''

        if c == '/' and nxt == '*':
            start = i
            i += 2
            while i < n and src[i:i + 2] != '*/':
                i += 1
            i = i + 2 if i < n else n
            blank(start, i)
            continue

        if line_comment and c == '/' and nxt == '/':
            start = i
            i += 2
            while i < n and src[i] != '\n':
                i += 1
            blank(start, i)
            continue

        if c in ('"', "'"):
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
            if mask_strings:
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


def _extract_calls(text: str, skip_starts=None) -> list:
    skip_starts = skip_starts or set()
    calls = []
    seen = set()
    for m in RE_CSS_CALL.finditer(text):
        name = m.group(1)
        if m.start(1) in skip_starts:
            continue
        low = name.lower()
        if low in _CALL_BUILTINS or len(name) < 2 or name in seen:
            continue
        seen.add(name)
        calls.append(name)
    return calls


def _body_after(clean: str, src: str, decl_start: int, decl_end: int, braces: bool):
    """Return (body, end_line). For brace dialects find the matching `{...}`
    near the decl; otherwise degrade to the declaration line."""
    if braces:
        brace_idx = clean.find('{', decl_end)
        nl = clean.find('\n', decl_end)
        if brace_idx != -1 and (nl == -1 or brace_idx <= nl + 1):
            # allow the brace to sit on the next line
            if clean[decl_end:brace_idx].count('\n') <= 1:
                end = _brace_range(clean, brace_idx)
                return clean[brace_idx + 1:end - 1], _line_no(src, end - 1)
    return '', _line_no(src, decl_start)


def scan_css(src: str, ext: str = '.css') -> tuple:
    """CSS-family stylesheet analysis. Returns the standard VIZCODE 6-tuple."""
    lang = _LANG_BY_EXT.get(ext.lower(), 'css')
    braces = lang in ('css', 'scss', 'less')   # .sass / .styl are indentation-based
    clean = _mask_css(src, lang, mask_strings=True)
    import_src = _mask_css(src, lang, mask_strings=False)  # keep quoted paths

    imports = []
    edge_hints = []
    for m in RE_CSS_AT_IMPORT.finditer(import_src):
        if m.start() < len(clean) and clean[m.start()] == ' ':
            continue   # the `@import` token lives inside a value string
        via = '@' + m.group('kw').lower()
        line = _line_no(src, m.start())
        for qm in RE_CSS_QUOTED.finditer(m.group('body')):
            target = qm.group(1).strip()
            if not target or target.startswith(('http://', 'https://', '//')):
                continue
            base = re.split(r'[\\/]', target)[-1]
            stem = re.sub(r'\.(css|scss|sass|less|styl)$', '', base, flags=re.I)
            stem = stem.lstrip('_')   # SCSS partials begin with `_`
            if stem:
                imports.append(stem)
                edge_hints.append(_hint(stem, via, line))
    for m in RE_CSS_URL.finditer(import_src):
        if m.start() < len(clean) and clean[m.start()] == ' ':
            continue
        line_start = import_src.rfind('\n', 0, m.start()) + 1
        if '@import' in import_src[line_start:m.start()].lower():
            continue
        target = _local_asset_ref(m.group('target'))
        if target:
            edge_hints.append(_hint(target, 'url', _line_no(src, m.start('target')), 'asset'))
    imports = list(dict.fromkeys(imports))
    edge_hints = list({
        (h['target'], h['via'], h['line']): h for h in edge_hints
    }.values())

    funcdefs = []
    func_calls_by_func = []
    symbol_defs = []
    decl_name_starts = set()
    seen = set()

    def add_def(kind: str, name: str, decl_start: int, decl_end: int,
                is_func: bool):
        key = (kind, name, _line_no(src, decl_start))
        if not name or key in seen:
            return
        seen.add(key)
        decl_name_starts.add(decl_start)
        body, end_line = _body_after(clean, src, decl_start, decl_end, braces)
        line_no = _line_no(src, decl_start)
        if is_func:
            funcdefs.append({'label': name, 'is_efiapi': False, 'is_static': False})
            func_calls_by_func.append(_extract_calls(body))
        symbol_defs.append({
            'kind': kind, 'name': name, 'line': line_no, 'end_line': end_line,
            'bases': [], 'parent': None, 'is_public': True, 'doc': None,
            'complexity': 1,
        })

    if lang in ('scss', 'sass'):
        for m in RE_SCSS_MIXIN.finditer(clean):
            add_def('mixin', m.group(1), m.start(1), m.end(), True)
        for m in RE_SCSS_FUNC.finditer(clean):
            add_def('function', m.group(1), m.start(1), m.end(), True)
    if lang == 'less':
        for m in RE_LESS_MIXIN.finditer(clean):
            add_def('mixin', m.group(1), m.start(1), m.end(), True)
    if lang == 'stylus':
        for m in RE_STYLUS_FUNC.finditer(clean):
            add_def('function', m.group(1), m.start(1), m.end(), True)
    # @keyframes exists in every dialect.
    for m in RE_CSS_KEYFRAMES.finditer(clean):
        add_def('keyframes', m.group(1), m.start(1), m.end(), False)

    all_calls = _extract_calls(clean, decl_name_starts)

    extra = {'imports': imports, 'lang': lang}
    if edge_hints:
        extra['edge_hints'] = edge_hints

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs
