#!/usr/bin/env python3
"""
parsers/r_parser.py - VIZCODE R Language Parser

Extracts:
  imports             - library()/require()/requireNamespace()/source() targets
  funcdefs            - `name <- function(...)` / `name = function(...)` definitions
  funccalls           - call expressions
  func_calls_by_func  - per-function call lists (body-scoped via brace matching)
  symbol_defs         - function defs + S4/R5/R6 class registrations

R has no module system; dependencies are package loads (`library`/`require`) and
sourced files (`source("file.R")`). Functions are first-class values bound by
`<-` / `<<-` / `=`. Bodies are brace blocks `{ }`; a one-line `function(x) expr`
body degrades to its declaration line.

Syntax verified against the R Language Definition (Lexical analysis):
  line comment `#` only; strings `"..."`, `'...'`, backtick `` `non-syntactic` ``,
  and R 4.0 raw strings `r"(...)"` / `r"[...]"` / `r"{...}"` with optional dashes.
  Identifiers may contain `.` (e.g. read.csv).
"""

import re

R_EXTENSIONS = {'.r', '.R'}

R_KEYWORDS = {
    'if', 'else', 'for', 'while', 'repeat', 'function', 'return', 'break',
    'next', 'in', 'TRUE', 'FALSE', 'NULL', 'NA', 'Inf', 'NaN', 'NA_integer_',
    'NA_real_', 'NA_character_', 'library', 'require', 'requireNamespace',
    'loadNamespace', 'source', 'print', 'cat', 'paste', 'paste0', 'c', 'list',
    'vector', 'invisible', 'stop', 'warning', 'message', 'is', 'function',
}

RE_R_LIB = re.compile(
    r'\b(?:library|require|requireNamespace|loadNamespace)\s*\(\s*'
    r'["\']?([A-Za-z.][\w.]*)["\']?')
RE_R_SOURCE = re.compile(r'''\bsource\s*\(\s*['"]([^'"]+)['"]''')
# name <- function( / name <<- function( / name = function(
RE_R_FUNC = re.compile(
    r'^[ \t]*([A-Za-z.][\w.]*)\s*(?:<<?-|=)\s*function\s*\(', re.MULTILINE)
# setClass("Name") / setRefClass("Name")
RE_R_SETCLASS = re.compile(
    r'''\bset(?:Class|RefClass)\s*\(\s*['"]([A-Za-z.][\w.]*)['"]''')
# Name <- R6Class("Name", ...) — capture the bound name
RE_R_R6 = re.compile(
    r'^[ \t]*([A-Za-z.][\w.]*)\s*(?:<<?-|=)\s*R6Class\s*\(', re.MULTILINE)
RE_R_CALL = re.compile(r'\b([A-Za-z.][\w.]*)\s*\(')
_RE_R_BRANCH_KW = re.compile(r'\b(?:if|for|while|repeat)\b')


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _mask_r(src: str, mask_strings: bool = True) -> str:
    """Blank R comments and string literals, preserving offsets/newlines.
    Comments are always blanked; quoted strings kept when mask_strings is
    False so `source("file.R")` paths survive."""
    out = list(src)
    n = len(src)
    i = 0

    def blank(a, b):
        for k in range(a, min(b, n)):
            if out[k] != '\n':
                out[k] = ' '

    _MIRROR = {'(': ')', '[': ']', '{': '}'}

    while i < n:
        c = src[i]
        # Raw string: r"(...)" / R'[...]' with optional dashes
        if c in 'rR' and i + 1 < n and src[i + 1] in '"\'':
            q = src[i + 1]
            j = i + 2
            dashes = 0
            while j < n and src[j] == '-':
                dashes += 1
                j += 1
            if j < n and src[j] in _MIRROR:
                close = q + '-' * dashes + _MIRROR[src[j]]
                # search for mirror-close: <mirror><dashes><quote>
                close_seq = _MIRROR[src[j]] + '-' * dashes + q
                end = src.find(close_seq, j + 1)
                end = (end + len(close_seq)) if end != -1 else n
                if mask_strings:
                    blank(i, end)
                i = end
                continue
        if c == '#':
            start = i
            while i < n and src[i] != '\n':
                i += 1
            blank(start, i)
            continue
        if c in '"\'`':
            quote = c
            start = i
            i += 1
            while i < n:
                if src[i] == '\\' and quote != '`':
                    i += 2
                    continue
                if src[i] == quote:
                    i += 1
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
    for m in RE_R_CALL.finditer(text):
        name = m.group(1)
        if m.start(1) in skip_starts:
            continue
        if name in R_KEYWORDS or len(name) < 2:
            continue
        calls.append(name)
    return calls


def _complexity(body: str) -> int:
    if not body:
        return 1
    count = 1 + len(_RE_R_BRANCH_KW.findall(body))
    count += body.count('&&') + body.count('||')
    return count


def scan_r(src: str, ext: str = '.r') -> tuple:
    """R file analysis. Returns the standard VIZCODE 6-tuple."""
    clean = _mask_r(src, mask_strings=True)
    code = _mask_r(src, mask_strings=False)  # quotes kept for source() paths

    def _real_kw(pos: int) -> bool:
        # The keyword char survives masking only when it is real code, not
        # text inside a string literal (strings are blanked in `clean`).
        return pos < len(clean) and not clean[pos].isspace()

    imports = []
    for m in RE_R_LIB.finditer(code):
        if not _real_kw(m.start()):
            continue
        pkg = m.group(1).strip()
        if pkg and pkg not in R_KEYWORDS:
            imports.append(pkg)
    for m in RE_R_SOURCE.finditer(code):
        if not _real_kw(m.start()):
            continue
        stem = re.split(r'[./\\]', m.group(1).strip())
        stem = [s for s in stem if s]
        # drop trailing extension token (R/r) when present
        if len(stem) >= 2 and stem[-1].lower() == 'r':
            ref = stem[-2]
        else:
            ref = stem[-1] if stem else ''
        if ref:
            imports.append(ref)
    imports = list(dict.fromkeys(imports))

    symbol_defs = []
    funcdefs = []
    func_calls_by_func = []
    decl_name_starts = set()
    seen = set()

    # Class registrations (S4 / R5 / R6) — symbols only. setClass takes a
    # quoted name, so scan `code` (strings kept) but guard the keyword.
    for m in RE_R_SETCLASS.finditer(code):
        if not _real_kw(m.start()):
            continue
        name = m.group(1)
        if name in seen:
            continue
        seen.add(name)
        line_no = _line_no(src, m.start(1))
        symbol_defs.append({
            'kind': 'class', 'name': name, 'line': line_no,
            'end_line': line_no, 'bases': [], 'parent': None,
            'is_public': True, 'doc': None,
        })
    for m in RE_R_R6.finditer(clean):
        name = m.group(1)
        if name in seen:
            continue
        seen.add(name)
        decl_name_starts.add(m.start(1))
        line_no = _line_no(src, m.start(1))
        symbol_defs.append({
            'kind': 'class', 'name': name, 'line': line_no,
            'end_line': line_no, 'bases': [], 'parent': None,
            'is_public': True, 'doc': None,
        })

    for m in RE_R_FUNC.finditer(clean):
        name = m.group(1)
        if name in R_KEYWORDS or len(name) < 2:
            continue
        start = m.start(1)
        line_no = _line_no(src, start)
        key = (name, line_no)
        if key in seen:
            continue
        seen.add(key)
        decl_name_starts.add(start)
        brace_idx = clean.find('{', m.end())
        nl_idx = clean.find('\n', m.end())
        if brace_idx != -1 and (nl_idx == -1 or brace_idx <= nl_idx + 1):
            end = _brace_range(clean, brace_idx)
            body = clean[brace_idx + 1:end - 1]
            end_line = _line_no(src, end - 1)
        else:
            body = clean[m.end():nl_idx] if nl_idx != -1 else clean[m.end():]
            end_line = line_no
        is_private = name.startswith('.')
        funcdefs.append({'label': name, 'is_efiapi': False,
                         'is_static': is_private})
        func_calls_by_func.append(_extract_calls(body))
        symbol_defs.append({
            'kind': 'function', 'name': name, 'line': line_no,
            'end_line': end_line, 'bases': [], 'parent': None,
            'is_public': not is_private, 'doc': None,
            'complexity': _complexity(body),
        })

    all_calls = _extract_calls(clean, decl_name_starts)
    extra = {'imports': imports, 'lang': 'r'}

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs
