#!/usr/bin/env python3
"""
parsers/ocaml_parser.py - VIZCODE OCaml Language Parser

Extracts:
  imports             - `open M` / `include M` → leaf module segment
  funcdefs            - `let [rec] name`, `and name`, `val name` (in .mli)
  funccalls           - applied names of the form `name (`
  func_calls_by_func  - per-definition call lists (best-effort)
  symbol_defs         - module / type / function / value

OCaml has NO line comment — only NESTED `(* *)` block comments (verified against
the OCaml manual). String forms are `"..."` and `{tag|...|tag}` quoted strings.
OCaml is not indentation-sensitive, so `let`/`type` bodies degrade to the
declaration line; `module M = struct ... end` resolves via `end` matching.
"""

import re

OCAML_EXTENSIONS = {'.ml', '.mli'}

OCAML_KEYWORDS = {
    'let', 'rec', 'and', 'in', 'type', 'module', 'open', 'include', 'struct',
    'sig', 'end', 'begin', 'object', 'val', 'method', 'fun', 'function', 'match',
    'with', 'if', 'then', 'else', 'for', 'while', 'do', 'done', 'try', 'when',
    'of', 'as', 'mutable', 'private', 'virtual', 'class', 'inherit', 'new',
    'true', 'false', 'not', 'lazy', 'assert', 'raise', 'failwith', 'ignore',
    'ref', 'mod', 'land', 'lor', 'lxor', 'functor',
}

OCAML_TYPE_BUILTINS = {
    'int', 'int32', 'int64', 'nativeint', 'float', 'bool', 'char', 'string',
    'bytes', 'unit', 'list', 'array', 'option', 'result', 'seq', 'lazy_t',
    'exn', 'format', 'ref',
}

RE_ML_OPEN = re.compile(r'^[ \t]*(?:open|include)\s+([\w.]+)', re.MULTILINE)
RE_ML_LET = re.compile(
    r'^[ \t]*(?:let|and)\s+(?:rec\s+)?(?:private\s+)?(\w[\w\']*)', re.MULTILINE)
RE_ML_VAL = re.compile(r'^[ \t]*val\s+(\w[\w\']*)', re.MULTILINE)
RE_ML_TYPE = re.compile(r'^[ \t]*(?:and\s+)?type\s+(?:\w[\w\' ,]*\s+)?(\w[\w\']*)\s*=(?P<rest>[^\n]*)',
                        re.MULTILINE)
RE_ML_MODULE = re.compile(r'^[ \t]*module\s+(?:type\s+)?(\w[\w\']*)', re.MULTILINE)
RE_ML_CALL = re.compile(r'\b(\w[\w\']*)\s*\(')
RE_WORD = re.compile(r'\b[A-Za-z_][\w\']*\b')

_OPEN_KW = {'struct', 'sig', 'begin', 'object'}


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _mask_ocaml(src: str, mask_strings: bool = True) -> str:
    out = list(src)
    n = len(src)

    def blank(start: int, end: int) -> None:
        for j in range(start, min(end, n)):
            if out[j] != '\n':
                out[j] = ' '

    i = 0
    while i < n:
        c = src[i]
        if c == '(' and src[i + 1:i + 2] == '*':
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
        if c == '{':   # {tag|...|tag} quoted string
            m = re.match(r'\{([a-z_]*)\|', src[i:])
            if m:
                tag = m.group(1)
                close = '|' + tag + '}'
                end = src.find(close, i + m.end())
                end = (end + len(close)) if end != -1 else n
                if mask_strings:
                    blank(i, end)
                i = end
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
        i += 1

    return ''.join(out)


def _module_end_line(src: str, clean: str, after_idx: int) -> int:
    """If a `struct`/`sig`/`begin`/`object` opens soon after, match its `end`."""
    nl = clean.find('\n', after_idx)
    window = clean[after_idx:nl if nl != -1 else len(clean)]
    if not re.search(r'\b(?:struct|sig|begin|object)\b', window) and \
       not (nl != -1 and re.match(r'\s*(?:struct|sig|begin|object)\b',
                                  clean[nl:nl + 40])):
        return None
    depth = 0
    started = False
    for m in RE_WORD.finditer(clean, after_idx):
        w = m.group(0)
        if w in _OPEN_KW:
            depth += 1
            started = True
        elif w == 'end' and started:
            depth -= 1
            if depth == 0:
                return _line_no(src, max(after_idx, m.end() - 1))
    return None


def _extract_calls(text: str) -> list:
    calls = []
    seen = set()
    for m in RE_ML_CALL.finditer(text):
        name = m.group(1)
        if name in OCAML_KEYWORDS or len(name) < 2 or name in seen:
            continue
        seen.add(name)
        calls.append(name)
    return calls


def _normalize_signature(src: str, start: int) -> str:
    line_end = src.find('\n', start)
    if line_end == -1:
        line_end = len(src)
    sig = src[start:line_end]
    sig = re.split(r'\s=', sig, 1)[0]
    return re.sub(r'\s+', ' ', sig).strip()


def _filter_type_refs(text: str, exclude=None) -> list:
    exclude = set(exclude or [])
    refs = []
    for raw in re.findall(r"\b[A-Za-z_][A-Za-z0-9_']*\b", text or ''):
        name = raw.split('.')[-1]
        if (name in OCAML_KEYWORDS or name in OCAML_TYPE_BUILTINS
                or name in exclude or len(name) < 3):
            continue
        refs.append(name)
    return list(dict.fromkeys(refs))


def scan_ocaml(src: str, ext: str = '.ml') -> tuple:
    """OCaml file analysis. Returns the standard VIZCODE 6-tuple."""
    clean = _mask_ocaml(src, mask_strings=True)

    imports = []
    for m in RE_ML_OPEN.finditer(clean):
        leaf = m.group(1).split('.')[-1]
        if leaf:
            imports.append(leaf)
    imports = list(dict.fromkeys(imports))

    symbol_defs = []
    seen = set()

    for m in RE_ML_MODULE.finditer(clean):
        name = m.group(1)
        if name in OCAML_KEYWORDS:
            continue
        start = m.start(1)
        line_no = _line_no(src, start)
        end_line = _module_end_line(src, clean, m.end()) or line_no
        symbol_defs.append({
            'kind': 'module', 'name': name, 'line': line_no,
            'end_line': end_line, 'bases': [], 'parent': None,
            'is_public': True, 'doc': None,
        })
    for m in RE_ML_TYPE.finditer(clean):
        name = m.group(1)
        if name in OCAML_KEYWORDS:
            continue
        start = m.start(1)
        symbol_defs.append({
            'kind': 'type', 'name': name, 'line': _line_no(src, start),
            'end_line': _line_no(src, start), 'bases': [], 'parent': None,
            'is_public': True, 'doc': None,
            'type_refs': _filter_type_refs(m.group('rest'), exclude={name}),
        })

    funcdefs = []
    func_calls_by_func = []
    for regex in (RE_ML_LET, RE_ML_VAL):
        for m in regex.finditer(clean):
            name = m.group(1)
            if name in OCAML_KEYWORDS:
                continue
            start = m.start(1)
            line_no = _line_no(src, start)
            key = (name, line_no)
            if key in seen:
                continue
            seen.add(key)
            nl = clean.find('\n', m.end())
            body = clean[m.end():nl if nl != -1 else len(clean)]
            signature = _normalize_signature(src, m.start())
            funcdefs.append({'label': name, 'is_efiapi': False, 'is_static': False})
            func_calls_by_func.append(_extract_calls(body))
            symbol_defs.append({
                'kind': 'function', 'name': name, 'line': line_no,
                'end_line': line_no, 'bases': [], 'parent': None,
                'is_public': True, 'doc': None, 'complexity': 1,
                'signature': signature,
                'type_refs': _filter_type_refs(signature),
            })

    all_calls = _extract_calls(clean)

    extra = {'imports': imports, 'lang': 'ocaml'}

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs
