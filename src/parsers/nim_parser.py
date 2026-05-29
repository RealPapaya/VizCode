#!/usr/bin/env python3
"""
parsers/nim_parser.py - VIZCODE Nim Language Parser

Extracts:
  imports             - `import`/`from .. import`/`include` → module leaf
  funcdefs            - proc / func / method / template / macro / iterator / converter
  funccalls           - call expressions
  func_calls_by_func  - per-routine call lists (indentation block)
  symbol_defs         - object / enum / tuple / routine

Nim is indentation-based, so routine bodies are approximated by an indentation
block. Verified against the Nim manual:
  * comments are `#` line, `##` doc, and NESTED `#[ ]#` block;
  * literals are `"..."`, triple-quoted, `r"..."` raw, and `'c'` char;
  * a trailing `*` on a definition name is the export (public) marker.
"""

import re

NIM_EXTENSIONS = {'.nim'}

NIM_KEYWORDS = {
    'proc', 'func', 'method', 'template', 'macro', 'iterator', 'converter',
    'type', 'object', 'enum', 'tuple', 'import', 'from', 'include', 'export',
    'if', 'elif', 'else', 'case', 'of', 'while', 'for', 'block', 'break',
    'continue', 'return', 'yield', 'discard', 'var', 'let', 'const', 'when',
    'try', 'except', 'finally', 'raise', 'and', 'or', 'not', 'in', 'is', 'as',
    'true', 'false', 'nil', 'echo', 'result', 'ref', 'ptr', 'distinct', 'cast',
    'do', 'end', 'static', 'concept', 'mixin', 'bind',
}

RE_NIM_IMPORT = re.compile(
    r'^[ \t]*(?:import|include)[ \t]+([^\n#]+)', re.MULTILINE)
RE_NIM_FROM = re.compile(r'^[ \t]*from[ \t]+([\w./"]+)[ \t]+import', re.MULTILINE)
RE_NIM_ROUTINE = re.compile(
    r'^[ \t]*(proc|func|method|template|macro|iterator|converter)\s+'
    r'`?([A-Za-z_]\w*)`?(\*)?', re.MULTILINE)
RE_NIM_TYPE = re.compile(
    r'^[ \t]+([A-Za-z_]\w*)(\*)?\s*(?:\{\.[^}]*\.\})?\s*(?:\[[^\]]*\])?\s*=\s*'
    r'(?:ref\s+|ptr\s+)?(object|enum|tuple|distinct|concept)\b', re.MULTILINE)
RE_NIM_CALL = re.compile(r'\b([A-Za-z_]\w*)\s*\(')
_RE_NIM_BRANCH_KW = re.compile(r'\b(?:if|elif|case|while|for|when|except|and|or)\b')


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _leaf(token: str) -> str:
    token = token.strip().strip('"').strip('[](){} ')
    base = re.split(r'[\\/]', token)[-1].strip('[](){} ')
    return re.sub(r'\.nim$', '', base)


def _mask_nim(src: str, mask_strings: bool = True) -> str:
    out = list(src)
    n = len(src)

    def blank(start: int, end: int) -> None:
        for j in range(start, min(end, n)):
            if out[j] != '\n':
                out[j] = ' '

    i = 0
    while i < n:
        c = src[i]
        if c == '#' and src[i + 1:i + 2] == '[':
            start = i
            i += 2
            depth = 1
            while i < n and depth > 0:
                if src[i:i + 2] == '#[':
                    depth += 1
                    i += 2
                    continue
                if src[i:i + 2] == ']#':
                    depth -= 1
                    i += 2
                    continue
                i += 1
            blank(start, i)
            continue
        if c == '#':
            start = i
            while i < n and src[i] != '\n':
                i += 1
            blank(start, i)
            continue
        if c == '"' and src[i:i + 3] == '"""':
            start = i
            i += 3
            while i < n and src[i:i + 3] != '"""':
                i += 1
            i = i + 3 if i < n else n
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
                if src[i] == '"' or src[i] == '\n':
                    i += 1 if src[i] == '"' else 0
                    break
                i += 1
            if mask_strings:
                blank(start, i)
            continue
        if c == "'" and i + 2 < n and src[i + 2] == "'":
            blank(i, i + 3)
            i += 3
            continue
        i += 1

    return ''.join(out)


def _block_end_line(clean: str, decl_start: int) -> int:
    lines = clean.split('\n')
    upto = clean[:decl_start].count('\n')
    if upto >= len(lines):
        return upto + 1
    base = len(lines[upto]) - len(lines[upto].lstrip())
    end = upto
    j = upto + 1
    while j < len(lines):
        ln = lines[j]
        if ln.strip() == '':
            j += 1
            continue
        indent = len(ln) - len(ln.lstrip())
        if indent <= base:
            break
        end = j
        j += 1
    return end + 1


def _block_text(clean: str, decl_start: int, end_line: int) -> str:
    start_line = clean[:decl_start].count('\n')
    lines = clean.split('\n')
    return '\n'.join(lines[start_line:end_line])


def _extract_calls(text: str) -> list:
    calls = []
    seen = set()
    for m in RE_NIM_CALL.finditer(text):
        name = m.group(1)
        if name in NIM_KEYWORDS or len(name) < 2 or name in seen:
            continue
        seen.add(name)
        calls.append(name)
    return calls


def _complexity(body: str) -> int:
    if not body:
        return 1
    return 1 + len(_RE_NIM_BRANCH_KW.findall(body))


def scan_nim(src: str, ext: str = '.nim') -> tuple:
    """Nim file analysis. Returns the standard VIZCODE 6-tuple."""
    clean = _mask_nim(src)
    import_src = _mask_nim(src, mask_strings=False)

    imports = []
    for m in RE_NIM_IMPORT.finditer(import_src):
        if m.start() < len(clean) and clean[m.start()] == ' ':
            continue
        for part in re.split(r'[,]', m.group(1)):
            leaf = _leaf(part)
            if leaf and leaf not in NIM_KEYWORDS:
                imports.append(leaf)
    for m in RE_NIM_FROM.finditer(import_src):
        leaf = _leaf(m.group(1))
        if leaf:
            imports.append(leaf)
    imports = list(dict.fromkeys(imports))

    symbol_defs = []
    seen = set()

    for m in RE_NIM_TYPE.finditer(clean):
        name = m.group(1)
        kind = m.group(3)
        start = m.start(1)
        symbol_defs.append({
            'kind': kind, 'name': name, 'line': _line_no(src, start),
            'end_line': _block_end_line(clean, start), 'bases': [],
            'parent': None, 'is_public': bool(m.group(2)), 'doc': None,
        })

    funcdefs = []
    func_calls_by_func = []
    for m in RE_NIM_ROUTINE.finditer(clean):
        kw = m.group(1)
        name = m.group(2)
        start = m.start(2)
        line_no = _line_no(src, start)
        key = (name, line_no)
        if key in seen:
            continue
        seen.add(key)
        end_line = _block_end_line(clean, start)
        body = _block_text(clean, start, end_line)
        is_public = bool(m.group(3))
        funcdefs.append({'label': name, 'is_efiapi': False, 'is_static': False})
        func_calls_by_func.append(_extract_calls(body))
        symbol_defs.append({
            'kind': kw if kw in ('template', 'macro', 'iterator') else 'function',
            'name': name, 'line': line_no, 'end_line': end_line, 'bases': [],
            'parent': None, 'is_public': is_public, 'doc': None,
            'complexity': _complexity(body),
        })

    all_calls = _extract_calls(clean)

    extra = {'imports': imports, 'lang': 'nim'}

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs
