#!/usr/bin/env python3
"""
parsers/perl_parser.py - VIZCODE Perl Language Parser

Extracts:
  imports             - `use`/`require Foo::Bar` → last `::` segment (matches Bar.pm)
  funcdefs            - `sub name` declarations
  funccalls           - call / sub-invocation names
  func_calls_by_func  - per-sub call lists (body-scoped via brace matching)
  symbol_defs         - structured symbol table (function = sub, module = package)

Comment/literal handling masks `#` line comments (but not `$#array`), POD
blocks (`=word ... =cut`), `__END__`/`__DATA__` data sections, here-docs, and
quote-like operators so markers inside them are not mistaken for code.
"""

import re

PERL_EXTENSIONS = {'.pl', '.pm'}

# Pragmas / non-module `use` targets that are not file dependencies.
PERL_PRAGMAS = {
    'strict', 'warnings', 'utf8', 'lib', 'vars', 'constant', 'feature',
    'integer', 'bytes', 'overload', 'autodie', 'v5', 'POSIX',
}
# Names that take their real dependency from a quoted argument.
PERL_INHERIT = {'base', 'parent'}

PERL_KEYWORDS = {
    'if', 'elsif', 'else', 'unless', 'while', 'until', 'for', 'foreach', 'do',
    'sub', 'my', 'our', 'local', 'use', 'no', 'require', 'package', 'return',
    'last', 'next', 'redo', 'and', 'or', 'not', 'eq', 'ne', 'lt', 'gt', 'le',
    'ge', 'cmp', 'qw', 'q', 'qq', 'qr', 'm', 's', 'tr', 'y', 'print', 'printf',
    'say', 'die', 'warn', 'defined', 'ref', 'bless', 'wantarray', 'shift',
    'unshift', 'push', 'pop', 'keys', 'values', 'each', 'exists', 'delete',
    'scalar', 'chomp', 'chop', 'split', 'join', 'map', 'grep', 'sort', 'reverse',
}

RE_PERL_USE = re.compile(r'^[ \t]*(?:use|require|no)\s+([\w:]+)', re.MULTILINE)
RE_PERL_USE_INHERIT = re.compile(
    r'''^[ \t]*use\s+(?:base|parent)\b[^;]*?['"]([\w:]+)['"]''', re.MULTILINE)
RE_PERL_SUB = re.compile(r'^[ \t]*sub\s+(\w+)', re.MULTILINE)
RE_PERL_PACKAGE = re.compile(r'^[ \t]*package\s+([\w:]+)', re.MULTILINE)
RE_PERL_CALL = re.compile(r'(?:\b|&)([A-Za-z_]\w*)\s*\(')
RE_PERL_HEREDOC = re.compile(r'<<[~]?\s*(["\']?)([A-Za-z_]\w*)\1')

_RE_PERL_BRANCH_KW = re.compile(r'\b(?:if|elsif|unless|while|until|for|foreach)\b')


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _mask_perl(src: str, mask_strings: bool = True) -> str:
    """Blank Perl comments, POD, data sections, here-docs and (optionally)
    simple quoted strings, preserving offsets (newlines kept). Quoted strings
    are kept when mask_strings is False so `use parent '...'` args survive."""
    out = list(src)
    i = 0
    n = len(src)

    def blank(start: int, end: int) -> None:
        for j in range(start, min(end, n)):
            if out[j] != '\n':
                out[j] = ' '

    at_line_start = True
    while i < n:
        c = src[i]

        # POD: a line beginning with '=' + letter, until '=cut'.
        if at_line_start and c == '=' and i + 1 < n and src[i + 1].isalpha():
            start = i
            while i < n:
                line_end = src.find('\n', i)
                if line_end == -1:
                    line_end = n
                if src[i:line_end].startswith('=cut'):
                    i = line_end
                    break
                i = line_end + 1
            blank(start, i)
            at_line_start = True
            continue

        # __END__ / __DATA__ : rest of file is data.
        if at_line_start and (src.startswith('__END__', i) or src.startswith('__DATA__', i)):
            blank(i, n)
            i = n
            continue

        if c == '#':
            prev = src[i - 1] if i > 0 else ''
            if prev not in ('$', '{'):  # not $#array / ${#...}
                start = i
                i += 1
                while i < n and src[i] != '\n':
                    i += 1
                blank(start, i)
                at_line_start = False
                continue

        if c in ('"', "'", '`'):
            quote = c
            start = i
            i += 1
            while i < n:
                if src[i] == '\\':
                    i += 2
                    continue
                if src[i] == quote:
                    i += 1
                    break
                i += 1
            if mask_strings:
                blank(start, i)
            at_line_start = False
            continue

        # here-doc: blank the body lines after the current line.
        if c == '<' and src[i:i + 2] == '<<':
            m = RE_PERL_HEREDOC.match(src, i)
            if m:
                label = m.group(2)
                nl = src.find('\n', m.end())
                if nl != -1:
                    j = nl + 1
                    close = re.compile(r'^[ \t]*' + re.escape(label) + r'\s*$')
                    while j < n:
                        line_end = src.find('\n', j)
                        if line_end == -1:
                            line_end = n
                        if close.match(src[j:line_end]):
                            blank(nl + 1, j)
                            break
                        j = line_end + 1
                    else:
                        blank(nl + 1, n)
                i = m.end()
                at_line_start = False
                continue

        i += 1
        at_line_start = (c == '\n')

    return ''.join(out)


def _brace_body(src: str, open_idx: int) -> str:
    if open_idx < 0:
        return ''
    depth = 0
    for i in range(open_idx, len(src)):
        ch = src[i]
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return src[open_idx + 1:i]
    return ''


def _brace_close(src: str, open_idx: int) -> int:
    if open_idx < 0:
        return -1
    depth = 0
    for i in range(open_idx, len(src)):
        ch = src[i]
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return i
    return -1


def _extract_calls(text: str) -> list:
    calls = []
    seen = set()
    for m in RE_PERL_CALL.finditer(text):
        name = m.group(1)
        if name in PERL_KEYWORDS or len(name) < 2 or name in seen:
            continue
        seen.add(name)
        calls.append(name)
    return calls


def _complexity(body: str) -> int:
    if not body:
        return 1
    count = 1 + len(_RE_PERL_BRANCH_KW.findall(body))
    count += body.count('&&') + body.count('||') + body.count('//') + body.count('?')
    return count


def _last_seg(ref: str) -> str:
    return ref.strip().split('::')[-1]


def scan_perl(src: str) -> tuple:
    """
    Perl file analysis.

    Returns: (imports, funcdefs, all_calls, extra_dict, func_calls_by_func, symbol_defs)
    """
    clean = _mask_perl(src)
    code = _mask_perl(src, mask_strings=False)  # quotes kept for base/parent args

    # ── imports ──────────────────────────────────────────────────────────────
    imports = []
    for m in RE_PERL_USE.finditer(code):
        mod = m.group(1).strip()
        head = mod.split('::')[0]
        if head in PERL_PRAGMAS or head in PERL_INHERIT:
            continue
        seg = _last_seg(mod)
        if seg and seg not in PERL_KEYWORDS:
            imports.append(seg)
    for m in RE_PERL_USE_INHERIT.finditer(code):
        seg = _last_seg(m.group(1))
        if seg:
            imports.append(seg)
    imports = list(dict.fromkeys(imports))

    # ── packages (namespaces) ────────────────────────────────────────────────
    packages = []  # (start_idx, name)
    symbol_defs = []
    for m in RE_PERL_PACKAGE.finditer(clean):
        name = m.group(1)
        start = m.start()
        packages.append((start, name))
        symbol_defs.append({
            'kind': 'module',
            'name': name,
            'line': _line_no(src, start),
            'end_line': _line_no(src, start),
            'bases': [],
            'parent': None,
            'is_public': True,
            'doc': None,
        })
    main_package = packages[0][1] if packages else ''

    def package_of(idx: int):
        current = None
        for start, name in packages:
            if start <= idx:
                current = name
            else:
                break
        return current

    # ── subs ─────────────────────────────────────────────────────────────────
    funcdefs = []
    func_calls_by_func = []
    seen = set()
    for m in RE_PERL_SUB.finditer(clean):
        name = m.group(1)
        if name in seen:
            continue
        seen.add(name)
        line_no = _line_no(src, m.start(1))
        open_idx = clean.find('{', m.end())
        close_idx = _brace_close(clean, open_idx)
        end_line = _line_no(src, close_idx) if close_idx != -1 else line_no
        body = _brace_body(clean, open_idx)
        is_private = name.startswith('_')

        funcdefs.append({
            'label': name,
            'is_efiapi': False,
            'is_static': is_private,
        })
        func_calls_by_func.append(_extract_calls(body))
        symbol_defs.append({
            'kind': 'function',
            'name': name,
            'line': line_no,
            'end_line': end_line,
            'bases': [],
            'parent': package_of(m.start()),
            'is_public': not is_private,
            'doc': None,
            'complexity': _complexity(body),
        })

    all_calls = _extract_calls(clean)

    extra = {'imports': imports, 'lang': 'perl'}
    if main_package:
        extra['package'] = main_package

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs
