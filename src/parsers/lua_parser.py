#!/usr/bin/env python3
"""
parsers/lua_parser.py - VIZCODE Lua Language Parser

Extracts:
  imports             - `require "a.b.c"` → last `.` segment (matches c.lua)
  funcdefs            - function declarations (global, local, table, method)
  funccalls           - call expressions
  func_calls_by_func  - per-function call lists (body-scoped via `end` matching)
  symbol_defs         - structured symbol table (function / method)

Lua blocks close with `end` (or `until` for `repeat`), not braces, so bodies are
delimited by keyword-depth scanning. Comments are `--` line and `--[[ ]]` (and
long-bracket `--[==[ ]==]`); long strings use the matching `[[ ]]` form.
"""

import re

LUA_EXTENSIONS = {'.lua'}

LUA_KEYWORDS = {
    'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function',
    'goto', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then',
    'true', 'until', 'while', 'require', 'pairs', 'ipairs', 'print', 'type',
    'tostring', 'tonumber', 'pcall', 'xpcall', 'error', 'assert', 'setmetatable',
    'getmetatable', 'rawget', 'rawset', 'select', 'next', 'unpack',
}

RE_LUA_REQUIRE = re.compile(
    r'''\brequire\s*(?:\(\s*)?['"]([^'"]+)['"]''')
# function foo / function a.b.c / function a:b
RE_LUA_FUNC = re.compile(
    r'^[ \t]*(local\s+)?function\s+([A-Za-z_][\w.:]*)\s*\(', re.MULTILINE)
# foo = function(...)  /  local foo = function(...)  /  M.foo = function(...)
RE_LUA_ASSIGN_FUNC = re.compile(
    r'^[ \t]*(local\s+)?([A-Za-z_][\w.]*)\s*=\s*function\s*\(', re.MULTILINE)
RE_LUA_CALL = re.compile(r'\b([A-Za-z_]\w*)\s*[\(\{"\']')
RE_WORD = re.compile(r'\b[A-Za-z_]\w*\b')

_BLOCK_OPEN = {'function', 'if', 'for', 'while'}
_RE_LUA_BRANCH_KW = re.compile(r'\b(?:if|elseif|for|while|and|or)\b')


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _long_bracket_level(src: str, i: int):
    """If src[i:] opens a long bracket `[==[`, return (level, content_start)."""
    if src[i] != '[':
        return None
    j = i + 1
    eqs = 0
    while j < len(src) and src[j] == '=':
        eqs += 1
        j += 1
    if j < len(src) and src[j] == '[':
        return eqs, j + 1
    return None


def _mask_lua(src: str, mask_strings: bool = True) -> str:
    """Blank Lua comments and string literals, preserving offsets. Comments and
    long-bracket spans are always masked; simple quoted strings are kept when
    mask_strings is False so `require "mod"` paths survive."""
    out = list(src)
    i = 0
    n = len(src)

    def blank(start: int, end: int) -> None:
        for k in range(start, min(end, n)):
            if out[k] != '\n':
                out[k] = ' '

    def find_long_close(start: int, level: int) -> int:
        close = ']' + '=' * level + ']'
        idx = src.find(close, start)
        return idx + len(close) if idx != -1 else n

    while i < n:
        c = src[i]

        if c == '-' and src[i:i + 2] == '--':
            lb = _long_bracket_level(src, i + 2)
            if lb is not None:
                level, content_start = lb
                end = find_long_close(content_start, level)
                blank(i, end)
                i = end
                continue
            start = i
            i += 2
            while i < n and src[i] != '\n':
                i += 1
            blank(start, i)
            continue

        if c == '[':
            lb = _long_bracket_level(src, i)
            if lb is not None:
                level, content_start = lb
                end = find_long_close(content_start, level)
                blank(i, end)
                i = end
                continue

        if c in ('"', "'"):
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
            continue

        i += 1

    return ''.join(out)


def _block_end(clean: str, after_idx: int):
    """Given that a block opened just before after_idx (depth already 1), scan
    keyword tokens and return the index just past the matching `end`/`until`."""
    depth = 1
    for m in RE_WORD.finditer(clean, after_idx):
        w = m.group(0)
        if w in _BLOCK_OPEN or w == 'repeat':
            depth += 1
        elif w == 'end' or w == 'until':
            depth -= 1
            if depth == 0:
                return m.end()
    return len(clean)


def _extract_calls(text: str) -> list:
    calls = []
    seen = set()
    for m in RE_LUA_CALL.finditer(text):
        name = m.group(1)
        if name in LUA_KEYWORDS or len(name) < 2 or name in seen:
            continue
        seen.add(name)
        calls.append(name)
    return calls


def _complexity(body: str) -> int:
    if not body:
        return 1
    return 1 + len(_RE_LUA_BRANCH_KW.findall(body))


def _split_table_name(dotted: str):
    """`a.b:c` → (name='c', parent='a.b'); `foo` → ('foo', None)."""
    sep = max(dotted.rfind('.'), dotted.rfind(':'))
    if sep == -1:
        return dotted, None, False
    is_method = dotted[sep] == ':'
    return dotted[sep + 1:], dotted[:sep], is_method


def scan_lua(src: str) -> tuple:
    """
    Lua file analysis.

    Returns: (imports, funcdefs, all_calls, extra_dict, func_calls_by_func, symbol_defs)
    """
    clean = _mask_lua(src)
    code = _mask_lua(src, mask_strings=False)  # quotes kept for require paths

    imports = []
    for m in RE_LUA_REQUIRE.finditer(code):
        mod = m.group(1).strip()
        seg = re.split(r'[./\\]', mod)[-1]
        if seg:
            imports.append(seg)
    imports = list(dict.fromkeys(imports))

    funcdefs = []
    func_calls_by_func = []
    symbol_defs = []
    seen = set()

    def add_func(is_local: bool, dotted: str, decl_start: int, paren_end: int):
        name, parent, is_method = _split_table_name(dotted)
        if not name or name in LUA_KEYWORDS:
            return
        key = (parent, name)
        if key in seen:
            return
        seen.add(key)
        line_no = _line_no(src, decl_start)
        end_idx = _block_end(clean, paren_end)
        end_line = _line_no(src, end_idx)
        body = clean[paren_end:end_idx]
        is_private = is_local
        funcdefs.append({
            'label': name,
            'is_efiapi': False,
            'is_static': is_private,
        })
        func_calls_by_func.append(_extract_calls(body))
        symbol_defs.append({
            'kind': 'method' if is_method else 'function',
            'name': name,
            'line': line_no,
            'end_line': end_line,
            'bases': [],
            'parent': parent,
            'is_public': not is_private,
            'doc': None,
            'complexity': _complexity(body),
        })

    for m in RE_LUA_FUNC.finditer(clean):
        add_func(bool(m.group(1)), m.group(2), m.start(2), m.end())
    for m in RE_LUA_ASSIGN_FUNC.finditer(clean):
        add_func(bool(m.group(1)), m.group(2), m.start(2), m.end())

    all_calls = _extract_calls(clean)

    extra = {'imports': imports, 'lang': 'lua'}

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs
