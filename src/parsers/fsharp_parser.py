#!/usr/bin/env python3
"""
parsers/fsharp_parser.py - VIZCODE F# Language Parser

Extracts:
  imports             - `open M` → leaf module segment
  funcdefs            - `let [rec] name ...`, `member x.Name`
  funccalls           - call expressions
  func_calls_by_func  - per-definition call lists (indentation block)
  symbol_defs         - module / namespace / type / function / method

F# is indentation-based, so definition bodies are approximated by an indentation
block (lines more deeply indented than the declaration). Verified against the
F# language reference:
  * `//` line comments and NESTED `(* *)` block comments;
  * `"..."`, triple-quoted, and `@"..."` verbatim strings are masked.
"""

import re

FSHARP_EXTENSIONS = {'.fs', '.fsx'}

FS_KEYWORDS = {
    'let', 'rec', 'member', 'type', 'module', 'namespace', 'open', 'and', 'in',
    'if', 'then', 'else', 'elif', 'match', 'with', 'for', 'while', 'do', 'done',
    'fun', 'function', 'try', 'finally', 'when', 'mutable', 'new', 'static',
    'abstract', 'override', 'inherit', 'interface', 'class', 'struct', 'end',
    'true', 'false', 'null', 'not', 'use', 'yield', 'return', 'begin', 'val',
    'private', 'internal', 'public', 'inline', 'of', 'as', 'failwith', 'printfn',
    'sprintf', 'ignore',
}

FS_TYPE_BUILTINS = {
    'String', 'Char', 'Byte', 'SByte', 'Int16', 'Int32', 'Int64',
    'UInt16', 'UInt32', 'UInt64', 'Single', 'Double', 'Decimal', 'Bool',
    'Unit', 'Object', 'Option', 'ValueOption', 'List', 'Array', 'Seq',
    'Map', 'Set', 'Result', 'Async', 'Task',
}

RE_FS_OPEN = re.compile(r'^[ \t]*open\s+([\w.]+)', re.MULTILINE)
RE_FS_MODULE = re.compile(
    r'^[ \t]*(?:module|namespace)\s+(?:rec\s+)?([\w.]+)', re.MULTILINE)
RE_FS_LET = re.compile(
    r'^[ \t]*let\s+(?:rec\s+)?(?:inline\s+)?(?:mutable\s+)?(?:private\s+|internal\s+)?'
    r'(\w[\w\']*)', re.MULTILINE)
RE_FS_MEMBER = re.compile(
    r'^[ \t]*(?:static\s+|abstract\s+|override\s+|default\s+)*member\s+'
    r'(?:\w[\w\']*\.)?(\w[\w\']*)', re.MULTILINE)
RE_FS_TYPE = re.compile(r'^[ \t]*(?:and\s+)?type\s+(?:private\s+|internal\s+)?'
                        r'(\w[\w\']*)', re.MULTILINE)
RE_FS_CALL = re.compile(r'\b(\w[\w\']*)\s*\(')
_RE_FS_BRANCH_KW = re.compile(r'\b(?:if|elif|match|for|while|when)\b')


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _mask_fsharp(src: str, mask_strings: bool = True) -> str:
    out = list(src)
    n = len(src)

    def blank(start: int, end: int) -> None:
        for j in range(start, min(end, n)):
            if out[j] != '\n':
                out[j] = ' '

    i = 0
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ''
        if c == '/' and nxt == '/':
            start = i
            while i < n and src[i] != '\n':
                i += 1
            blank(start, i)
            continue
        if c == '(' and nxt == '*' and src[i + 2:i + 3] != ')':
            start = i
            i += 2
            depth = 1
            while i < n and depth > 0:
                if src[i:i + 2] == '(*':
                    depth += 1
                    i += 2
                    continue
                if src[i:i + 2] == '*)':
                    depth -= 1
                    i += 2
                    continue
                i += 1
            blank(start, i)
            continue
        if c == '@' and nxt == '"':
            start = i
            i += 2
            while i < n:
                if src[i] == '"':
                    if src[i + 1:i + 2] == '"':
                        i += 2
                        continue
                    i += 1
                    break
                i += 1
            if mask_strings:
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


def _line_end_index(src: str, end_line: int) -> int:
    if end_line <= 1:
        nl = src.find('\n')
        return len(src) if nl == -1 else nl
    pos = -1
    for _ in range(end_line - 1):
        pos = src.find('\n', pos + 1)
        if pos == -1:
            return len(src)
    return pos


def _extract_calls(text: str) -> list:
    calls = []
    seen = set()
    for m in RE_FS_CALL.finditer(text):
        name = m.group(1)
        if name in FS_KEYWORDS or len(name) < 2 or name in seen:
            continue
        seen.add(name)
        calls.append(name)
    return calls


def _complexity(body: str) -> int:
    if not body:
        return 1
    return 1 + len(_RE_FS_BRANCH_KW.findall(body))


def _normalize_signature(src: str, start: int) -> str:
    line_end = src.find('\n', start)
    if line_end == -1:
        line_end = len(src)
    sig = src[start:line_end]
    sig = re.split(r'\s=', sig, 1)[0]
    return re.sub(r'\s+', ' ', sig).strip()


def _filter_type_refs(text: str) -> list:
    refs = []
    for name in re.findall(r'\b[A-Z][A-Za-z0-9_]*\b', text or ''):
        if name in FS_KEYWORDS or name in FS_TYPE_BUILTINS or len(name) < 3:
            continue
        refs.append(name)
    return list(dict.fromkeys(refs))


def _type_bases(text: str) -> list:
    refs = []
    for m in re.finditer(r'\b(?:inherit|interface)\s+([A-Z][A-Za-z0-9_.]*)', text or ''):
        refs.extend(_filter_type_refs(m.group(1).split('.')[-1]))
    return list(dict.fromkeys(refs))


def _enclosing(ranges, idx):
    best = None
    best_span = None
    for start, end, name in ranges:
        if start <= idx < end:
            span = end - start
            if best_span is None or span < best_span:
                best_span = span
                best = name
    return best


def scan_fsharp(src: str, ext: str = '.fs') -> tuple:
    """F# file analysis. Returns the standard VIZCODE 6-tuple."""
    clean = _mask_fsharp(src, mask_strings=True)

    imports = []
    for m in RE_FS_OPEN.finditer(clean):
        leaf = m.group(1).split('.')[-1]
        if leaf:
            imports.append(leaf)
    imports = list(dict.fromkeys(imports))

    symbol_defs = []
    seen = set()
    type_ranges = []

    for m in RE_FS_MODULE.finditer(clean):
        name = m.group(1).split('.')[-1]
        start = m.start(1)
        symbol_defs.append({
            'kind': 'module', 'name': name, 'line': _line_no(src, start),
            'end_line': _block_end_line(clean, start), 'bases': [],
            'parent': None, 'is_public': True, 'doc': None,
        })
    for m in RE_FS_TYPE.finditer(clean):
        name = m.group(1)
        start = m.start(1)
        line_no = _line_no(src, start)
        end_line = _block_end_line(clean, start)
        body = _block_text(clean, start, end_line)
        line_end = clean.find('\n', m.end())
        line = clean[m.start():line_end if line_end != -1 else len(clean)]
        type_text = line + '\n' + body
        kind = 'interface' if re.search(r'\binterface\b', type_text) else 'type'
        bases = _type_bases(type_text)
        type_ranges.append((start, _line_end_index(clean, end_line), name))
        symbol_defs.append({
            'kind': kind, 'name': name, 'line': line_no,
            'end_line': end_line, 'bases': bases,
            'parent': None, 'is_public': True, 'doc': None,
            'type_refs': list(dict.fromkeys(bases + _filter_type_refs(type_text))),
        })

    funcdefs = []
    func_calls_by_func = []
    for regex, kind in ((RE_FS_LET, 'function'), (RE_FS_MEMBER, 'method')):
        for m in regex.finditer(clean):
            name = m.group(1)
            if name in FS_KEYWORDS:
                continue
            start = m.start(1)
            line_no = _line_no(src, start)
            key = (name, line_no)
            if key in seen:
                continue
            seen.add(key)
            end_line = _block_end_line(clean, start)
            body = _block_text(clean, start, end_line)
            signature = _normalize_signature(src, m.start())
            funcdefs.append({'label': name, 'is_efiapi': False,
                             'is_static': kind == 'method' and 'static' in
                             clean[clean.rfind('\n', 0, start) + 1:start]})
            func_calls_by_func.append(_extract_calls(body))
            symbol_defs.append({
                'kind': kind, 'name': name, 'line': line_no,
                'end_line': end_line, 'bases': [], 'parent': _enclosing(type_ranges, start),
                'is_public': True, 'doc': None, 'complexity': _complexity(body),
                'signature': signature,
                'type_refs': _filter_type_refs(signature),
            })

    all_calls = _extract_calls(clean)

    extra = {'imports': imports, 'lang': 'fsharp'}

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs
