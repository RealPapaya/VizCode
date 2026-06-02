#!/usr/bin/env python3
"""
parsers/elixir_parser.py - VIZCODE Elixir Language Parser

Extracts:
  imports             - `alias`/`import`/`use`/`require` module leaf names
  funcdefs            - `def`/`defp`/`defmacro`/`defmacrop` names
  funccalls           - call expressions
  func_calls_by_func  - per-function call lists (`do`/`end` matching)
  symbol_defs         - module / protocol / function / macro

Elixir blocks open with the `do` keyword (and `fn`) and close with `end`.
Verified against the Elixir docs:
  https://hexdocs.pm/elixir/Kernel.html
  https://hexdocs.pm/elixir/typespecs.html
  https://hexdocs.pm/elixir/File.html
  * the inline keyword form `def f, do: expr` does NOT open a block (`do:`)
    so it degrades to the declaration line;
  * comments are `#`; literals are double-quoted strings, triple-quoted
    heredocs, `'charlist'`, and `~x<delim>...` sigils are all masked first.
"""

import re

ELIXIR_EXTENSIONS = {'.ex', '.exs'}

ELIXIR_KEYWORDS = {
    'def', 'defp', 'defmacro', 'defmacrop', 'defmodule', 'defprotocol',
    'defimpl', 'defstruct', 'defdelegate', 'defguard', 'do', 'end', 'fn', 'if',
    'unless', 'case', 'cond', 'for', 'with', 'when', 'receive', 'try', 'catch',
    'rescue', 'after', 'else', 'quote', 'unquote', 'alias', 'import', 'use',
    'require', 'true', 'false', 'nil', 'and', 'or', 'not', 'in', 'fn',
    'raise', 'throw', 'send', 'spawn',
}
ELIXIR_BUILTIN_TYPES = {
    'Atom', 'BitString', 'Boolean', 'Exception', 'Float', 'Function', 'Integer',
    'List', 'Map', 'Module', 'String', 'Struct', 'Tuple',
}

RE_EX_REQUIRE = re.compile(
    r'^[ \t]*(?:alias|import|use|require)\s+([A-Z][\w.]*)[ \t]*(\{[^}]*\})?',
    re.MULTILINE)
RE_EX_DEF = re.compile(
    r'\b(def|defp|defmacro|defmacrop)\s+([A-Za-z_]\w*[?!]?)')
RE_EX_MODULE = re.compile(
    r'\b(defmodule|defprotocol|defimpl)\s+([A-Z][\w.]*)')
RE_EX_SPEC = re.compile(r'^[ \t]*@spec\s+([A-Za-z_]\w*[?!]?)([^\n]*)', re.MULTILINE)
RE_EX_FILE_REF = re.compile(r'''\bFile\.(?:read!?|stream!?|read_line!?)\s*\(\s*["'](?P<path>[^"']+)["']''')
RE_EX_CALL = re.compile(r'\b([A-Za-z_]\w*[?!]?)\s*\(')
RE_DO = re.compile(r'(?<![:\w])do(?![:\w])')
RE_TOKEN = re.compile(r'(?<![:\w])(?:do|fn|end)(?![:\w])')
_RE_EX_BRANCH_KW = re.compile(r'\b(?:if|unless|case|cond|for|with|when|catch|rescue)\b')
_EX_FILE_EXTS = {
    '.ex', '.exs', '.json', '.yaml', '.yml', '.toml', '.xml', '.conf', '.cfg',
    '.html', '.htm', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg',
    '.txt', '.md',
}
_EX_CONFIG_EXTS = {'.json', '.yaml', '.yml', '.toml', '.xml', '.conf', '.cfg'}


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _mask_elixir(src: str, mask_strings: bool = True) -> str:
    out = list(src)
    n = len(src)

    def blank(start: int, end: int) -> None:
        for j in range(start, min(end, n)):
            if out[j] != '\n':
                out[j] = ' '

    i = 0
    while i < n:
        c = src[i]
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
        if c == '~' and i + 1 < n and src[i + 1].isalpha():
            j = i + 1
            while j < n and src[j].isalpha():
                j += 1
            if j < n:
                opener = src[j]
                pairs = {'(': ')', '[': ']', '{': '}', '<': '>'}
                close = pairs.get(opener, opener)
                start = i
                k = j + 1
                depth = 1
                while k < n and depth > 0:
                    if src[k] == '\\':
                        k += 2
                        continue
                    if opener in pairs and src[k] == opener:
                        depth += 1
                    elif src[k] == close:
                        depth -= 1
                    k += 1
                if mask_strings:
                    blank(start, k)
                i = k
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
            if mask_strings:
                blank(start, i)
            continue
        i += 1

    return ''.join(out)


def _normalize_signature(src: str, start: int, end: int) -> str:
    return ' '.join(src[start:end].strip().split())


def _extract_type_refs(text: str) -> list:
    refs = []
    for raw in re.findall(r'(?:[A-Z]\w*\.)*[A-Z]\w*', text):
        name = raw.split('.')[-1]
        if name in ELIXIR_KEYWORDS or name in ELIXIR_BUILTIN_TYPES or len(name) < 3:
            continue
        refs.append(name)
    return list(dict.fromkeys(refs))


def _path_edge_type(path: str):
    if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', path) or path.startswith(('/', '\\')):
        return None
    base = re.split(r'[\\/]', path)[-1]
    ext = '.' + base.rsplit('.', 1)[-1].lower() if '.' in base else ''
    if ext not in _EX_FILE_EXTS:
        return None
    if ext in ('.ex', '.exs'):
        return 'import'
    return 'config_ref' if ext in _EX_CONFIG_EXTS else 'asset_ref'


def _edge_hints(src: str, clean: str, import_src: str) -> list:
    hints = []
    for m in RE_EX_FILE_REF.finditer(import_src):
        if m.start() < len(clean) and clean[m.start()] == ' ':
            continue
        target = m.group('path').strip()
        edge_type = _path_edge_type(target)
        if not edge_type or edge_type == 'import':
            continue
        hints.append({
            'type': edge_type,
            'target': target,
            'subtype': 'config' if edge_type == 'config_ref' else 'asset',
            'via': import_src[m.start():m.start('path')].strip(),
            'line': _line_no(src, m.start('path')),
            'confidence': 1.0,
        })
    return list({(h['type'], h['target'], h['via'], h['line']): h for h in hints}.values())


def _specs_by_name(clean: str) -> dict:
    specs = {}
    for m in RE_EX_SPEC.finditer(clean):
        name = m.group(1)
        refs = _extract_type_refs(m.group(2))
        if refs:
            specs[name] = refs
    return specs


def _block_end(clean: str, after_idx: int) -> int:
    depth = 1
    for m in RE_TOKEN.finditer(clean, after_idx):
        tok = m.group(0)
        if tok == 'end':
            depth -= 1
            if depth == 0:
                return m.end()
        else:  # do / fn
            depth += 1
    return len(clean)


def _body_span(clean: str, src: str, header_end: int, decl_start: int):
    """Return (body, end_line). Block form (`... do`) → match `end`; inline
    keyword form (`, do: expr`) → degrade to the declaration line."""
    m = RE_DO.search(clean, header_end)
    nl = clean.find('\n', header_end)
    if m and (nl == -1 or m.start() < nl):
        if clean[m.end():m.end() + 1] != ':':
            end_idx = _block_end(clean, m.end())
            return clean[m.end():end_idx], _line_no(src, max(decl_start, end_idx - 1))
    end_idx = nl if nl != -1 else len(clean)
    return clean[header_end:end_idx], _line_no(src, decl_start)


def _extract_calls(text: str) -> list:
    calls = []
    seen = set()
    for m in RE_EX_CALL.finditer(text):
        name = m.group(1)
        if name in ELIXIR_KEYWORDS or len(name) < 2 or name in seen:
            continue
        seen.add(name)
        calls.append(name)
    return calls


def _complexity(body: str) -> int:
    if not body:
        return 1
    return 1 + len(_RE_EX_BRANCH_KW.findall(body)) + body.count('&&') + body.count('||')


def _enclosing(ranges: list, idx: int):
    best = None
    best_span = None
    for start, end, name in ranges:
        if start <= idx < end:
            span = end - start
            if best_span is None or span < best_span:
                best_span = span
                best = name
    return best


def scan_elixir(src: str, ext: str = '.ex') -> tuple:
    """Elixir file analysis. Returns the standard VIZCODE 6-tuple."""
    clean = _mask_elixir(src)
    import_src = _mask_elixir(src, mask_strings=False)
    specs = _specs_by_name(clean)

    imports = []
    for m in RE_EX_REQUIRE.finditer(clean):
        brace = m.group(2)
        base = m.group(1)
        if brace:
            for part in brace.strip('{}').split(','):
                leaf = part.strip().split('.')[-1]
                if leaf:
                    imports.append(leaf)
        else:
            imports.append(base.split('.')[-1])
    imports = list(dict.fromkeys(imports))

    symbol_defs = []
    type_ranges = []
    for m in RE_EX_MODULE.finditer(clean):
        name = m.group(2).split('.')[-1]
        start = m.start(2)
        body, end_line = _body_span(clean, src, m.end(), start)
        do_m = RE_DO.search(clean, m.end())
        nl = clean.find('\n', m.end())
        if do_m and (nl == -1 or do_m.start() < nl) and clean[do_m.end():do_m.end() + 1] != ':':
            end_idx = _block_end(clean, do_m.end())
        else:
            end_idx = m.end()
        symbol_defs.append({
            'kind': 'module' if m.group(1) != 'defprotocol' else 'protocol',
            'name': name, 'line': _line_no(src, start), 'end_line': end_line,
            'bases': [], 'parent': None, 'is_public': True, 'doc': None,
            'signature': _normalize_signature(src, m.start(), src.find('\n', m.start()) if src.find('\n', m.start()) != -1 else m.end()),
            'type_refs': [],
        })
        type_ranges.append((start, end_idx, name))

    funcdefs = []
    func_calls_by_func = []
    method_symbols = []
    seen = set()
    for m in RE_EX_DEF.finditer(clean):
        kw = m.group(1)
        name = m.group(2)
        start = m.start(2)
        line_no = _line_no(src, start)
        key = (name, line_no)
        if key in seen:
            continue
        seen.add(key)
        body, end_line = _body_span(clean, src, m.end(), start)
        parent = _enclosing(type_ranges, start)
        is_private = kw in ('defp', 'defmacrop')
        sig_end = src.find('\n', m.start())
        if sig_end == -1:
            sig_end = m.end()
        funcdefs.append({'label': name, 'is_efiapi': False, 'is_static': False})
        func_calls_by_func.append(_extract_calls(body))
        method_symbols.append({
            'kind': 'macro' if kw in ('defmacro', 'defmacrop') else (
                'method' if parent else 'function'),
            'name': name, 'line': line_no, 'end_line': end_line,
            'bases': [], 'parent': parent, 'is_public': not is_private,
            'doc': None, 'complexity': _complexity(body),
            'signature': _normalize_signature(src, m.start(), sig_end),
            'type_refs': specs.get(name, []),
        })

    symbol_defs = symbol_defs + method_symbols
    all_calls = _extract_calls(clean)

    extra = {'imports': imports, 'lang': 'elixir'}
    hints = _edge_hints(src, clean, import_src)
    if hints:
        extra['edge_hints'] = hints

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs
