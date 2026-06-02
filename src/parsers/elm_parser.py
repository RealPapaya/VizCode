#!/usr/bin/env python3
"""
parsers/elm_parser.py - VIZCODE Elm Language Parser

Extracts:
  imports             - `import M [as N] [exposing (..)]` → module leaf
  funcdefs            - `name : ...` signatures, `name .. = ..` equations, `port`
  funccalls           - call expressions of the form `name (`
  func_calls_by_func  - per-definition call lists (indentation block)
  symbol_defs         - type / type alias / port / function

Elm is indentation-based; top-level definitions sit at column 0. Verified
against the Elm syntax reference:
  * `--` line comments and NESTED `{- -}` block comments;
  * type annotations use a single `:` (not Haskell's `::`);
  * `"..."` and triple-quoted string literals are masked before scanning.
"""

import re

ELM_EXTENSIONS = {'.elm'}

ELM_KEYWORDS = {
    'module', 'import', 'as', 'exposing', 'where', 'let', 'in', 'case', 'of',
    'if', 'then', 'else', 'type', 'alias', 'port', 'true', 'false', 'and',
    'or', 'not', 'toString', 'always', 'identity',
}

ELM_TYPE_BUILTINS = {
    'String', 'Char', 'Bool', 'Int', 'Float', 'Never', 'Maybe', 'Result',
    'List', 'Array', 'Dict', 'Set', 'Cmd', 'Sub', 'Html', 'Json', 'Decoder',
    'Encoder',
}

_SYMBOL = set("!#$%&*+./<=>?@\\^|-~:")

RE_ELM_IMPORT = re.compile(r'^[ \t]*import\s+([\w.]+)', re.MULTILINE)
RE_ELM_SIG = re.compile(r"^([a-z_][\w']*)\s*:(?!:)", re.MULTILINE)
RE_ELM_EQ = re.compile(r"^([a-z_][\w']*)\b[^\n=]*=(?!=)", re.MULTILINE)
RE_ELM_TYPE = re.compile(
    r'^type(\s+alias)?\s+([A-Z][\w\']*)', re.MULTILINE)
RE_ELM_PORT = re.compile(r"^port\s+([a-z_][\w']*)\s*:", re.MULTILINE)
RE_ELM_CALL = re.compile(r"\b([a-z_][\w']*)\s*\(")
_RE_ELM_BRANCH_KW = re.compile(r'\b(?:if|case|then)\b|\|')


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _mask_elm(src: str) -> str:
    out = list(src)
    n = len(src)

    def blank(start: int, end: int) -> None:
        for j in range(start, min(end, n)):
            if out[j] != '\n':
                out[j] = ' '

    i = 0
    while i < n:
        c = src[i]
        if c == '{' and src[i + 1:i + 2] == '-':
            start = i
            i += 2
            depth = 1
            while i < n and depth > 0:
                if src[i:i + 2] == '{-':
                    depth += 1
                    i += 2
                    continue
                if src[i:i + 2] == '-}':
                    depth -= 1
                    i += 2
                    continue
                i += 1
            blank(start, i)
            continue
        if c == '-' and src[i + 1:i + 2] == '-':
            j = i
            while j < n and src[j] == '-':
                j += 1
            if j >= n or src[j] not in _SYMBOL:
                start = i
                i = j
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


def _extract_calls(text: str) -> list:
    calls = []
    seen = set()
    for m in RE_ELM_CALL.finditer(text):
        name = m.group(1)
        if name in ELM_KEYWORDS or len(name) < 2 or name in seen:
            continue
        seen.add(name)
        calls.append(name)
    return calls


def _complexity(body: str) -> int:
    if not body:
        return 1
    return 1 + len(_RE_ELM_BRANCH_KW.findall(body))


def _normalize_signature(src: str, start: int) -> str:
    line_end = src.find('\n', start)
    if line_end == -1:
        line_end = len(src)
    return re.sub(r'\s+', ' ', src[start:line_end]).strip()


def _filter_type_refs(text: str, exclude=None) -> list:
    exclude = set(exclude or [])
    refs = []
    for name in re.findall(r'\b[A-Z][A-Za-z0-9_]*\b', text or ''):
        if (name in ELM_KEYWORDS or name in ELM_TYPE_BUILTINS or name in exclude
                or len(name) < 3):
            continue
        refs.append(name)
    return list(dict.fromkeys(refs))


def scan_elm(src: str, ext: str = '.elm') -> tuple:
    """Elm file analysis. Returns the standard VIZCODE 6-tuple."""
    clean = _mask_elm(src)

    imports = []
    for m in RE_ELM_IMPORT.finditer(clean):
        leaf = m.group(1).split('.')[-1]
        if leaf:
            imports.append(leaf)
    imports = list(dict.fromkeys(imports))

    symbol_defs = []
    seen = set()
    signatures = {}

    for m in RE_ELM_SIG.finditer(clean):
        signatures[m.group(1)] = _normalize_signature(src, m.start(1))
    for m in RE_ELM_PORT.finditer(clean):
        signatures[m.group(1)] = _normalize_signature(src, m.start())

    for m in RE_ELM_TYPE.finditer(clean):
        name = m.group(2)
        start = m.start(2)
        line_end = clean.find('\n', m.start())
        line = clean[m.start():line_end if line_end != -1 else len(clean)]
        symbol_defs.append({
            'kind': 'type',
            'name': name, 'line': _line_no(src, start),
            'end_line': _block_end_line(clean, start), 'bases': [],
            'parent': None, 'is_public': True, 'doc': None,
            'type_refs': _filter_type_refs(line, exclude={name}),
        })

    funcdefs = []
    func_calls_by_func = []

    def add_func(name, start, kind):
        if name in ELM_KEYWORDS or name in seen:
            return
        seen.add(name)
        line_no = _line_no(src, start)
        end_line = _block_end_line(clean, start)
        body = _block_text(clean, start, end_line)
        signature = signatures.get(name, _normalize_signature(src, start))
        funcdefs.append({'label': name, 'is_efiapi': False, 'is_static': False})
        func_calls_by_func.append(_extract_calls(body))
        symbol_defs.append({
            'kind': kind, 'name': name, 'line': line_no, 'end_line': end_line,
            'bases': [], 'parent': None, 'is_public': True, 'doc': None,
            'complexity': _complexity(body),
            'signature': signature,
            'type_refs': _filter_type_refs(signature),
        })

    for m in RE_ELM_PORT.finditer(clean):
        add_func(m.group(1), m.start(1), 'port')
    for m in RE_ELM_SIG.finditer(clean):
        add_func(m.group(1), m.start(1), 'function')
    for m in RE_ELM_EQ.finditer(clean):
        add_func(m.group(1), m.start(1), 'function')

    all_calls = _extract_calls(clean)

    extra = {'imports': imports, 'lang': 'elm'}

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs
