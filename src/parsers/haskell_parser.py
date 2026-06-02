#!/usr/bin/env python3
"""
parsers/haskell_parser.py - VIZCODE Haskell Language Parser

Extracts:
  imports             - `import [qualified] M [as N]` → module leaf
  funcdefs            - top-level `name :: ...` signatures / `name .. = ..` equations
  funccalls           - call expressions of the form `name (`
  func_calls_by_func  - per-definition call lists (indentation block)
  symbol_defs         - data / newtype / type / class / instance / function

Haskell is indentation-based; top-level definitions sit at column 0 and their
bodies are the indented lines that follow. Verified against the Haskell report:
  * `--` line comments are NOT triggered when the dashes are followed by another
    operator symbol (so `-->` stays code), plus NESTED `{- -}` block comments;
  * `"..."` strings and `'c'`/`'\\n'` char literals are masked, while a trailing
    prime in identifiers (`foo'`) is preserved.
"""

import re

HASKELL_EXTENSIONS = {'.hs'}

HS_KEYWORDS = {
    'module', 'import', 'qualified', 'as', 'hiding', 'where', 'let', 'in',
    'do', 'case', 'of', 'if', 'then', 'else', 'data', 'newtype', 'type',
    'class', 'instance', 'deriving', 'default', 'foreign', 'infix', 'infixl',
    'infixr', 'forall', 'family', 'true', 'false', 'otherwise', 'return',
    'mapM', 'mapM_', 'putStrLn', 'print', 'error', 'undefined',
}

HS_TYPE_BUILTINS = {
    'String', 'Char', 'Bool', 'Int', 'Integer', 'Float', 'Double',
    'Ordering', 'Maybe', 'Either', 'List', 'IO', 'Functor', 'Applicative',
    'Monad', 'Show', 'Read', 'Eq', 'Ord', 'Enum', 'Bounded', 'Num',
    'Integral', 'Fractional',
}

_SYMBOL = set("!#$%&*+./<=>?@\\^|-~:")

RE_HS_IMPORT = re.compile(
    r'^[ \t]*import\s+(?:qualified\s+)?([\w.]+)', re.MULTILINE)
RE_HS_SIG = re.compile(r"^([a-z_][\w']*)\s*::", re.MULTILINE)
RE_HS_EQ = re.compile(r"^([a-z_][\w']*)\b[^\n=]*=(?!=)", re.MULTILINE)
RE_HS_TYPE = re.compile(
    r'^(data|newtype|type|class|instance)\b([^\n]*)', re.MULTILINE)
RE_HS_CALL = re.compile(r"\b([a-z_][\w']*)\s*\(")
_RE_HS_BRANCH_KW = re.compile(r'\b(?:if|case|where|guard)\b|\|')


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _mask_haskell(src: str) -> str:
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
        if c == "'":
            m = re.match(r"'(?:\\.|[^'\\])'", src[i:])
            if m:
                blank(i, i + m.end())
                i += m.end()
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


def _type_name(rest: str) -> str:
    rest = re.sub(r'\([^)]*\)\s*=>', '', rest)   # drop context
    rest = re.sub(r'^[^=]*=>', '', rest)
    m = re.search(r'([A-Z][\w\']*)', rest)
    return m.group(1) if m else ''


def _normalize_signature(src: str, start: int) -> str:
    line_end = src.find('\n', start)
    if line_end == -1:
        line_end = len(src)
    return re.sub(r'\s+', ' ', src[start:line_end]).strip()


def _filter_type_refs(text: str, exclude=None) -> list:
    exclude = set(exclude or [])
    refs = []
    for name in re.findall(r"\b[A-Z][A-Za-z0-9_']*\b", text or ''):
        if (name in HS_KEYWORDS or name in HS_TYPE_BUILTINS or name in exclude
                or len(name) < 3):
            continue
        refs.append(name)
    return list(dict.fromkeys(refs))


def _extract_calls(text: str) -> list:
    calls = []
    seen = set()
    for m in RE_HS_CALL.finditer(text):
        name = m.group(1)
        if name in HS_KEYWORDS or len(name) < 2 or name in seen:
            continue
        seen.add(name)
        calls.append(name)
    return calls


def _complexity(body: str) -> int:
    if not body:
        return 1
    return 1 + len(_RE_HS_BRANCH_KW.findall(body))


def scan_haskell(src: str, ext: str = '.hs') -> tuple:
    """Haskell file analysis. Returns the standard VIZCODE 6-tuple."""
    clean = _mask_haskell(src)

    imports = []
    for m in RE_HS_IMPORT.finditer(clean):
        leaf = m.group(1).split('.')[-1]
        if leaf:
            imports.append(leaf)
    imports = list(dict.fromkeys(imports))

    symbol_defs = []
    seen = set()
    signatures = {}

    for m in RE_HS_SIG.finditer(clean):
        signatures[m.group(1)] = _normalize_signature(src, m.start(1))

    for m in RE_HS_TYPE.finditer(clean):
        kw = m.group(1)
        name = _type_name(m.group(2))
        if not name:
            continue
        start = m.start(1)
        kind = 'trait' if kw == 'class' else 'type'
        type_refs = _filter_type_refs(m.group(2), exclude={name})
        symbol_defs.append({
            'kind': kind, 'name': name, 'line': _line_no(src, start),
            'end_line': _block_end_line(clean, start), 'bases': [],
            'parent': None, 'is_public': True, 'doc': None,
            'type_refs': type_refs,
        })

    funcdefs = []
    func_calls_by_func = []
    for m in RE_HS_SIG.finditer(clean):
        name = m.group(1)
        if name in HS_KEYWORDS:
            continue
        start = m.start(1)
        line_no = _line_no(src, start)
        if name in seen:
            continue
        seen.add(name)
        end_line = _block_end_line(clean, start)
        body = _block_text(clean, start, end_line)
        funcdefs.append({'label': name, 'is_efiapi': False, 'is_static': False})
        func_calls_by_func.append(_extract_calls(body))
        signature = signatures.get(name, _normalize_signature(src, start))
        symbol_defs.append({
            'kind': 'function', 'name': name, 'line': line_no,
            'end_line': end_line, 'bases': [], 'parent': None,
            'is_public': True, 'doc': None, 'complexity': _complexity(body),
            'signature': signature,
            'type_refs': _filter_type_refs(signature),
        })
    for m in RE_HS_EQ.finditer(clean):
        name = m.group(1)
        if name in HS_KEYWORDS or name in seen:
            continue
        seen.add(name)
        start = m.start(1)
        line_no = _line_no(src, start)
        end_line = _block_end_line(clean, start)
        body = _block_text(clean, start, end_line)
        funcdefs.append({'label': name, 'is_efiapi': False, 'is_static': False})
        func_calls_by_func.append(_extract_calls(body))
        signature = signatures.get(name, _normalize_signature(src, start))
        symbol_defs.append({
            'kind': 'function', 'name': name, 'line': line_no,
            'end_line': end_line, 'bases': [], 'parent': None,
            'is_public': True, 'doc': None, 'complexity': _complexity(body),
            'signature': signature,
            'type_refs': _filter_type_refs(signature),
        })

    all_calls = _extract_calls(clean)

    extra = {'imports': imports, 'lang': 'haskell'}

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs
