#!/usr/bin/env python3
"""
parsers/erlang_parser.py - VIZCODE Erlang Language Parser

Extracts:
  imports             - `-include`/`-include_lib` files, `-import`/`-behaviour`
  funcdefs            - top-level function clauses `name(Args) -> ...`
  funccalls           - call expressions (local and `mod:func`)
  func_calls_by_func  - per-function call lists (clause `.` terminator)
  symbol_defs         - module / function

Erlang functions are sequences of clauses separated by `;` and terminated by a
top-level `.`. Verified against the Erlang reference manual:
  * `%` line comments; `"..."` strings; `'quoted atoms'`; `$c` char literals
    are masked before scanning;
  * a `.` terminates a form only at bracket depth 0 and when followed by
    whitespace/EOF (so floats `3.14` and record access `R#r.f` are not split).
"""

import re

ERLANG_EXTENSIONS = {'.erl', '.hrl'}

ERLANG_KEYWORDS = {
    'after', 'and', 'andalso', 'band', 'begin', 'bnot', 'bor', 'bsl', 'bsr',
    'bxor', 'case', 'catch', 'cond', 'div', 'end', 'fun', 'if', 'let', 'not',
    'of', 'or', 'orelse', 'receive', 'rem', 'try', 'when', 'xor', 'maybe',
}

RE_ERL_INCLUDE = re.compile(
    r'''-\s*include(?:_lib)?\s*\(\s*["']([^"']+)["']''')
RE_ERL_IMPORT = re.compile(r'-\s*import\s*\(\s*([a-z][\w@]*)')
RE_ERL_BEHAVIOUR = re.compile(r'-\s*behaviou?r\s*\(\s*([a-z][\w@]*)')
RE_ERL_CALLBACK = re.compile(r'-\s*callback\s+([a-z][\w@]*)\s*\((.*?)\)\s*->\s*([^.\n]+)', re.DOTALL)
RE_ERL_MODULE = re.compile(r'-\s*module\s*\(\s*([a-z][\w@]*)')
RE_ERL_EXPORT = re.compile(r'-\s*export\s*\(\s*\[([^\]]*)\]')
RE_ERL_HEAD = re.compile(r'^([a-z][\w@]*)\s*\(', re.MULTILINE)
RE_ERL_CALL = re.compile(r'\b([a-z][\w@]*)\s*\(')
RE_ERL_QCALL = re.compile(r'\b[a-z][\w@]*\s*:\s*([a-z][\w@]*)\s*\(')
_RE_ERL_BRANCH_KW = re.compile(r'\b(?:if|case|catch|when|receive|andalso|orelse)\b')


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _leaf(path: str) -> str:
    base = re.split(r'[\\/]', path)[-1]
    return re.sub(r'\.(hrl|erl)$', '', base)


def _mask_erlang(src: str, mask_strings: bool = True) -> str:
    out = list(src)
    n = len(src)

    def blank(start: int, end: int) -> None:
        for j in range(start, min(end, n)):
            if out[j] != '\n':
                out[j] = ' '

    i = 0
    while i < n:
        c = src[i]
        if c == '%':
            start = i
            while i < n and src[i] != '\n':
                i += 1
            blank(start, i)
            continue
        if c == '$':   # char literal: $a or $\n
            start = i
            i += 1
            if i < n and src[i] == '\\':
                i += 2
            elif i < n:
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
            if mask_strings or quote == "'":
                blank(start, i)
            continue
        i += 1

    return ''.join(out)


def _clause_end(clean: str, pos: int) -> int:
    """Index just past the top-level `.` terminating the form starting at pos."""
    depth = 0
    n = len(clean)
    i = pos
    while i < n:
        c = clean[i]
        if c in '([{':
            depth += 1
        elif c in ')]}':
            depth -= 1
        elif c == '.' and depth <= 0:
            nxt = clean[i + 1] if i + 1 < n else '\n'
            if nxt in ' \t\r\n' or nxt == '%':
                return i + 1
        i += 1
    return n


def _extract_calls(text: str, skip_heads=None) -> list:
    skip_heads = skip_heads or set()
    calls = []
    seen = set()
    for m in RE_ERL_QCALL.finditer(text):
        name = m.group(1)
        if name not in ERLANG_KEYWORDS and len(name) >= 2 and name not in seen:
            seen.add(name)
            calls.append(name)
    for m in RE_ERL_CALL.finditer(text):
        name = m.group(1)
        if m.start(1) in skip_heads:
            continue
        if name in ERLANG_KEYWORDS or len(name) < 2 or name in seen:
            continue
        seen.add(name)
        calls.append(name)
    return calls


def _complexity(body: str) -> int:
    if not body:
        return 1
    return 1 + len(_RE_ERL_BRANCH_KW.findall(body)) + body.count(';')


def _normalize_signature(src: str, start: int, end: int) -> str:
    return ' '.join(src[start:end].strip().split())


def scan_erlang(src: str, ext: str = '.erl') -> tuple:
    """Erlang file analysis. Returns the standard VIZCODE 6-tuple."""
    clean = _mask_erlang(src, mask_strings=True)
    import_src = _mask_erlang(src, mask_strings=False)

    imports = []
    for m in RE_ERL_INCLUDE.finditer(import_src):
        if m.start() < len(clean) and clean[m.start()] == ' ':
            continue
        leaf = _leaf(m.group(1).strip())
        if leaf:
            imports.append(leaf)
    for m in RE_ERL_IMPORT.finditer(clean):
        imports.append(m.group(1))
    for m in RE_ERL_BEHAVIOUR.finditer(clean):
        imports.append(m.group(1))
    imports = list(dict.fromkeys(imports))

    exported = set()
    for m in RE_ERL_EXPORT.finditer(clean):
        for part in m.group(1).split(','):
            nm = part.split('/')[0].strip()
            if nm:
                exported.add(nm)

    behaviours = []
    behaviour_edge_hints = []
    for m in RE_ERL_BEHAVIOUR.finditer(clean):
        name = m.group(1)
        if name not in behaviours:
            behaviours.append(name)
            behaviour_edge_hints.append({
                'type': 'behaviour_impl',
                'target': name,
                'via': '-behaviour',
                'line': _line_no(src, m.start()),
                'confidence': 1.0,
            })

    symbol_defs = []
    mm = RE_ERL_MODULE.search(clean)
    module_name = mm.group(1) if mm else None
    if mm:
        symbol_defs.append({
            'kind': 'interface' if RE_ERL_CALLBACK.search(clean) else 'module',
            'name': module_name,
            'line': _line_no(src, mm.start(1)),
            'end_line': _line_no(src, len(src) - 1),
            'bases': behaviours, 'parent': None, 'is_public': True,
            'doc': None,
            'symbol_edge_hints': behaviour_edge_hints,
        })

    funcdefs = []
    func_calls_by_func = []
    seen = set()
    claimed_until = 0
    heads = sorted(RE_ERL_HEAD.finditer(clean), key=lambda m: m.start())
    for m in heads:
        start = m.start(1)
        if start < claimed_until:
            continue   # a later clause of the current function
        name = m.group(1)
        if name in ERLANG_KEYWORDS:
            continue
        end_idx = _clause_end(clean, m.end())
        claimed_until = end_idx
        line_no = _line_no(src, start)
        if name in seen:
            continue
        seen.add(name)
        body = clean[m.end():end_idx]
        funcdefs.append({'label': name, 'is_efiapi': False, 'is_static': False})
        func_calls_by_func.append(_extract_calls(body, {start}))
        arrow_idx = clean.find('->', m.end(), end_idx)
        sig_end = arrow_idx + 2 if arrow_idx != -1 else m.end()
        symbol_defs.append({
            'kind': 'function', 'name': name, 'line': line_no,
            'end_line': _line_no(src, max(start, end_idx - 1)),
            'bases': [], 'parent': module_name,
            'is_public': name in exported, 'doc': None,
            'complexity': _complexity(body),
            'signature': _normalize_signature(src, m.start(), sig_end),
        })

    all_calls = _extract_calls(clean)

    extra = {'imports': imports, 'lang': 'erlang'}
    if module_name:
        extra['package'] = module_name

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs
