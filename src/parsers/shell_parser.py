#!/usr/bin/env python3
"""
parsers/shell_parser.py - VIZCODE Shell (sh/bash/zsh) Language Parser

Extracts:
  imports             - `source file` / `. file` → file stem
  funcdefs            - `name() { }` and `function name { }`
  funccalls           - invocations of *locally defined* functions only
  func_calls_by_func  - per-function call lists (body-scoped via brace matching)
  symbol_defs         - structured symbol table (function)

Calls are resolved against the set of functions defined in the file. Shell
commands are bare words with no call syntax, so resolving against local
definitions keeps intra-file edges precise and avoids treating every external
command as an edge.
"""

import re

SHELL_EXTENSIONS = {'.sh', '.bash', '.zsh'}

# Shell builtins / keywords — never reported as a function or call.
SHELL_KEYWORDS = {
    'if', 'then', 'elif', 'else', 'fi', 'for', 'while', 'until', 'do', 'done',
    'case', 'esac', 'in', 'function', 'select', 'time', 'return', 'break',
    'continue', 'exit', 'local', 'export', 'readonly', 'declare', 'typeset',
    'echo', 'printf', 'read', 'cd', 'source', 'eval', 'exec', 'set', 'unset',
    'shift', 'test', 'true', 'false', 'trap', 'wait', 'kill',
}

# name() {  /  function name  /  function name()
RE_SH_FUNC = re.compile(
    r'^[ \t]*(?:function\s+([A-Za-z_][\w\-.:]*)\s*(?:\(\s*\))?'
    r'|([A-Za-z_][\w\-.:]*)\s*\(\s*\))\s*\{',
    re.MULTILINE,
)
RE_SH_SOURCE = re.compile(
    r'''^[ \t]*(?:source|\.)\s+["']?([^\s"'#;]+)["']?''', re.MULTILINE)
RE_SH_HEREDOC = re.compile(r'<<[-]?\s*(["\']?)([A-Za-z_]\w*)\1')

_RE_SH_BRANCH_KW = re.compile(r'\b(?:if|elif|for|while|until|case)\b')
_COMMENT_PRECEDERS = set(' \t\n;&|(){}')


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _mask_shell(src: str, mask_strings: bool = True) -> str:
    """Blank shell comments and (optionally) string literals, preserving offsets.
    Comments and here-docs are always masked; quoted strings are kept when
    mask_strings is False so quoted `source` paths survive. `#` is a comment only
    at the start of a word; backtick/`$(...)` substitutions are left intact."""
    out = list(src)
    i = 0
    n = len(src)

    def blank(start: int, end: int) -> None:
        for j in range(start, min(end, n)):
            if out[j] != '\n':
                out[j] = ' '

    while i < n:
        c = src[i]
        prev = src[i - 1] if i > 0 else '\n'

        if c == '#' and prev in _COMMENT_PRECEDERS:
            start = i
            i += 1
            while i < n and src[i] != '\n':
                i += 1
            blank(start, i)
            continue

        if c == "'":
            start = i
            i += 1
            while i < n and src[i] != "'":  # single quotes: no escapes
                i += 1
            i = i + 1 if i < n else n
            if mask_strings:
                blank(start, i)
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
                i += 1
            if mask_strings:
                blank(start, i)
            continue

        if c == '<' and src[i:i + 2] == '<<':
            m = RE_SH_HEREDOC.match(src, i)
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
                continue

        i += 1

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


def _complexity(body: str) -> int:
    if not body:
        return 1
    count = 1 + len(_RE_SH_BRANCH_KW.findall(body))
    count += body.count('&&') + body.count('||')
    return count


def scan_shell(src: str) -> tuple:
    """
    Shell file analysis.

    Returns: (imports, funcdefs, all_calls, extra_dict, func_calls_by_func, symbol_defs)
    """
    clean = _mask_shell(src)
    code = _mask_shell(src, mask_strings=False)  # quotes kept for source paths

    imports = []
    for m in RE_SH_SOURCE.finditer(code):
        path = m.group(1).strip()
        if path:
            imports.append(path)
    imports = list(dict.fromkeys(imports))

    # First pass: collect function names + their brace spans.
    defs = []  # (name, decl_start, open_idx)
    func_names = set()
    for m in RE_SH_FUNC.finditer(clean):
        name = m.group(1) or m.group(2)
        if not name or name in SHELL_KEYWORDS or name in func_names:
            continue
        func_names.add(name)
        defs.append((name, m.start(), clean.find('{', m.start())))

    def calls_in(body: str, self_name: str) -> list:
        found = []
        for name in func_names:
            if name == self_name:
                continue
            if re.search(r'(?<![\w.-])' + re.escape(name) + r'(?![\w.-])', body):
                found.append(name)
        return sorted(found)

    funcdefs = []
    func_calls_by_func = []
    symbol_defs = []
    for name, decl_start, open_idx in defs:
        close_idx = _brace_close(clean, open_idx)
        line_no = _line_no(src, decl_start)
        end_line = _line_no(src, close_idx) if close_idx != -1 else line_no
        body = _brace_body(clean, open_idx)
        is_private = name.startswith('_')

        funcdefs.append({
            'label': name,
            'is_efiapi': False,
            'is_static': is_private,
        })
        func_calls_by_func.append(calls_in(body, name))
        symbol_defs.append({
            'kind': 'function',
            'name': name,
            'line': line_no,
            'end_line': end_line,
            'bases': [],
            'parent': None,
            'is_public': not is_private,
            'doc': None,
            'complexity': _complexity(body),
        })

    # File-level calls: union of resolved intra-file function invocations.
    all_calls = sorted({c for sub in func_calls_by_func for c in sub})

    extra = {'imports': imports, 'lang': 'shell'}

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs
