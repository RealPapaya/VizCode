#!/usr/bin/env python3
"""
parsers/groovy_parser.py - VIZCODE Groovy Language Parser

Extracts:
  imports             - referenced class/package leaf names from `import`
  funcdefs            - `def` methods, typed methods, constructors
  funccalls           - call expressions
  func_calls_by_func  - per-method call lists (body-scoped via brace matching)
  symbol_defs         - class / interface / trait / enum / annotation / method

Syntax verified against the Apache Groovy language documentation (Syntax):
  line `//`, block `/* */` (NON-nesting) comments; strings `'...'`, `"..."`
  (GString), triple `'''...'''` / `\"\"\" ... \"\"\"`, char via single-quote.
  Slashy strings `/.../` are not specially masked (rare; harmless unless they
  embed `//` or `/*`).
"""

import re


GROOVY_EXTENSIONS = {'.groovy'}


GROOVY_KEYWORDS = {
    'abstract', 'as', 'assert', 'boolean', 'break', 'byte', 'case', 'catch',
    'char', 'class', 'const', 'continue', 'def', 'default', 'do', 'double',
    'else', 'enum', 'extends', 'false', 'final', 'finally', 'float', 'for',
    'goto', 'if', 'implements', 'import', 'in', 'instanceof', 'int',
    'interface', 'long', 'native', 'new', 'null', 'package', 'private',
    'protected', 'public', 'return', 'short', 'static', 'strictfp', 'super',
    'switch', 'synchronized', 'this', 'throw', 'throws', 'trait', 'transient',
    'true', 'try', 'var', 'void', 'volatile', 'while', 'it',
    'String', 'Object', 'List', 'Map', 'Set', 'Integer', 'Boolean',
}

_GROOVY_MODIFIERS = (
    r'(?:public|private|protected|static|final|abstract|synchronized|'
    r'native|transient|volatile|def)'
)

RE_GROOVY_PACKAGE = re.compile(r'^\s*package\s+([\w.]+)', re.MULTILINE)
RE_GROOVY_IMPORT = re.compile(
    r'^\s*import\s+(?P<static>static\s+)?(?P<path>[\w.]+)(?P<wild>\.\*)?',
    re.MULTILINE,
)

RE_GROOVY_TYPE = re.compile(
    r'(?:^|[\s;{}])'
    r'(?:' + _GROOVY_MODIFIERS + r'\s+)*'
    r'(?P<kind>class|interface|trait|enum|@interface)\s+'
    r'(?P<name>[A-Za-z_]\w*)'
    r'(?:\s*<[^>{]*>)?'
    r'(?P<rest>[^{]*)'
    r'\{',
    re.MULTILINE,
)

# def name(  — Groovy untyped method/closure
RE_GROOVY_DEF = re.compile(
    r'\bdef\s+(?P<name>[A-Za-z_]\w*)\s*\(',
)

# [mods] ReturnType name(params) {   — typed method (Java-style)
RE_GROOVY_METHOD = re.compile(
    r'(?P<mods>(?:' + _GROOVY_MODIFIERS + r'\s+)*)'
    r'(?:<[^>{};]+>\s*)?'
    r'(?P<ret>[\w$][\w$.<>\[\],?\s]*?\s+)'
    r'(?P<name>[\w$]+)\s*'
    r'\((?P<params>[^;{}]*?)\)\s*'
    r'\{',
    re.MULTILINE,
)

# Constructor: [visibility] Capitalized name + ( ... ) { — gated on a known type.
RE_GROOVY_CTOR = re.compile(
    r'^[ \t]*(?:(?:public|private|protected)\s+)?'
    r'(?P<name>[A-Z]\w*)\s*\([^;{}]*\)\s*\{',
    re.MULTILINE,
)

RE_GROOVY_CALL = re.compile(r'\b([A-Za-z_$][\w$]*)\s*\(')

# Tokens that must NOT be treated as a method return type. Primitives and type
# names ARE valid return types, so only control-flow / statement keywords here.
_GROOVY_RET_SKIP = {
    'return', 'new', 'throw', 'assert', 'if', 'else', 'for', 'while', 'do',
    'switch', 'case', 'catch', 'synchronized', 'import', 'package',
}
_RE_GROOVY_BRANCH_KW = re.compile(r'\b(?:if|for|while|case|catch)\b')


def _mask_groovy_source(src: str, mask_literals: bool = False) -> str:
    """Mask comments (and optionally literals), preserving offsets/newlines."""
    out = list(src)
    i = 0
    n = len(src)

    def blank_span(start: int, end: int) -> None:
        for j in range(start, min(end, n)):
            if out[j] != '\n':
                out[j] = ' '

    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ''

        if c == '/' and nxt == '/':
            start = i
            i += 2
            while i < n and src[i] != '\n':
                i += 1
            blank_span(start, i)
            continue

        if c == '/' and nxt == '*':
            start = i
            i += 2
            while i + 1 < n and not (src[i] == '*' and src[i + 1] == '/'):
                i += 1
            i = i + 2 if i + 1 < n else n
            blank_span(start, i)
            continue

        # Triple-quoted strings (both flavours)
        if (c == '"' and src[i + 1:i + 3] == '""') or \
           (c == "'" and src[i + 1:i + 3] == "''"):
            q3 = src[i:i + 3]
            start = i
            i += 3
            while i < n:
                if src[i] == '\\':
                    i += 2
                    continue
                if src[i:i + 3] == q3:
                    i += 3
                    break
                i += 1
            if mask_literals:
                blank_span(start, i)
            continue

        if c == '"' or c == "'":
            q = c
            start = i
            i += 1
            while i < n:
                if src[i] == '\\':
                    i += 2
                    continue
                if src[i] == q or src[i] == '\n':
                    i += 1 if src[i] == q else 0
                    break
                i += 1
            if mask_literals:
                blank_span(start, i)
            continue

        i += 1

    return ''.join(out)


def _strip_comments(src: str) -> str:
    return _mask_groovy_source(src, mask_literals=False)


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


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


def _parse_package(src: str) -> str:
    m = RE_GROOVY_PACKAGE.search(src)
    return m.group(1) if m else ''


def _parse_imports(src: str) -> list:
    refs = []
    for m in RE_GROOVY_IMPORT.finditer(src):
        segs = m.group('path').split('.')
        if not segs:
            continue
        if m.group('static') and not m.group('wild') and len(segs) >= 2:
            ref = segs[-2]
        else:
            ref = segs[-1]
        if ref and ref != '*':
            refs.append(ref)
    return list(dict.fromkeys(refs))


def _split_bases(rest: str) -> list:
    bases = []
    for kw in ('extends', 'implements'):
        m = re.search(kw + r'\s+([\w.,<>\[\]\s]+)', rest)
        if not m:
            continue
        clause = re.sub(r'<[^>]*>', '', m.group(1))
        clause = clause.split('implements')[0] if kw == 'extends' else clause
        for part in clause.split(','):
            name = part.strip().split('.')[-1].strip()
            if name and name not in GROOVY_KEYWORDS:
                bases.append(name)
    return list(dict.fromkeys(bases))


def _extract_calls(text: str, skip_starts=None) -> list:
    skip_starts = skip_starts or set()
    calls = []
    for m in RE_GROOVY_CALL.finditer(text):
        name = m.group(1)
        if m.start(1) in skip_starts:
            continue
        if name in GROOVY_KEYWORDS or len(name) < 2:
            continue
        calls.append(name)
    return calls


def _count_complexity(body: str) -> int:
    if not body:
        return 1
    count = 1
    count += len(_RE_GROOVY_BRANCH_KW.findall(body))
    count += body.count('&&')
    count += body.count('||')
    count += body.count('?')
    return count


def _scan_doc_comments(src: str) -> dict:
    docs = {}
    for m in re.finditer(r'/\*\*(.*?)\*/', src, re.DOTALL):
        lines = []
        for ln in m.group(1).splitlines():
            t = ln.strip()
            if t.startswith('*'):
                t = t[1:].strip()
            if t:
                lines.append(t)
        text = '\n'.join(lines).strip()
        if text:
            docs[_line_no(src, m.end()) + 1] = text
    return docs


def _parse_types(src: str, clean: str):
    symbols = []
    ranges = []
    for m in RE_GROOVY_TYPE.finditer(clean):
        kind_raw = m.group('kind')
        kind = 'annotation' if kind_raw == '@interface' else kind_raw
        name = m.group('name')
        if name in GROOVY_KEYWORDS:
            continue
        line_no = _line_no(src, m.start('name'))
        open_idx = clean.find('{', m.end() - 1)
        end_idx = _brace_range(clean, open_idx) if open_idx != -1 else m.end()
        end_line = _line_no(src, max(m.start('name'), end_idx - 1))
        symbols.append({
            'kind': kind,
            'name': name,
            'line': line_no,
            'end_line': end_line,
            'bases': _split_bases(m.group('rest')),
            'parent': None,
            'is_public': 'private' not in m.group(0) and 'protected' not in m.group(0),
            'doc': None,
        })
        ranges.append((m.start('name'), end_idx, name))
    return symbols, ranges


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


def scan_groovy(src: str, ext: str = '.groovy') -> tuple:
    """Groovy file analysis. Returns the standard VIZCODE 6-tuple."""
    import_src = _strip_comments(src)
    clean = _mask_groovy_source(src, mask_literals=True)
    docs = _scan_doc_comments(src)

    imports = _parse_imports(import_src)
    type_symbols, type_ranges = _parse_types(src, clean)
    type_names = {s['name'] for s in type_symbols}
    for s in type_symbols:
        s['doc'] = docs.get(s['line'])

    funcdefs = []
    func_calls_by_func = []
    method_symbols = []
    decl_name_starts = set()
    seen = set()

    def add_method(name, start_idx, mods, body_open, is_ctor=False):
        line_no = _line_no(src, start_idx)
        key = (name, line_no)
        if key in seen:
            return
        seen.add(key)
        decl_name_starts.add(start_idx)
        is_static = 'static' in mods
        is_public = 'private' not in mods and 'protected' not in mods
        if body_open != -1:
            end = _brace_range(clean, body_open)
            body = clean[body_open + 1:end - 1]
            end_line = _line_no(src, end - 1)
        else:
            body = ''
            end_line = line_no
        calls = _extract_calls(body)
        funcdefs.append({'label': name, 'is_efiapi': False, 'is_static': is_static})
        func_calls_by_func.append(calls)
        method_symbols.append({
            'kind': 'constructor' if is_ctor else ('method' if _enclosing(type_ranges, start_idx) else 'function'),
            'name': name,
            'line': line_no,
            'end_line': end_line,
            'bases': [],
            'parent': _enclosing(type_ranges, start_idx),
            'is_public': is_public,
            'doc': docs.get(line_no),
            'complexity': _count_complexity(body),
        })

    for m in RE_GROOVY_DEF.finditer(clean):
        name = m.group('name')
        if name in GROOVY_KEYWORDS:
            continue
        body_open = clean.find('{', m.end() - 1)
        nl = clean.find('\n', m.end() - 1)
        if body_open != -1 and (nl == -1 or body_open < nl + 1):
            add_method(name, m.start('name'), m.group(0), body_open)

    for m in RE_GROOVY_METHOD.finditer(clean):
        name = m.group('name')
        if name in GROOVY_KEYWORDS:
            continue
        ret_first = m.group('ret').split()[0].split('<')[0]
        if ret_first in _GROOVY_RET_SKIP:
            continue
        add_method(name, m.start('name'), m.group('mods'), m.end() - 1)

    for m in RE_GROOVY_CTOR.finditer(clean):
        name = m.group('name')
        if name not in type_names:
            continue
        add_method(name, m.start('name'), m.group(0), m.end() - 1, is_ctor=True)

    for start, _e, _n in type_ranges:
        decl_name_starts.add(start)

    symbol_defs = type_symbols + method_symbols
    all_calls = _extract_calls(clean, decl_name_starts)

    docstrings = {}
    for sym in symbol_defs:
        if sym.get('doc'):
            key = f"{sym['parent']}.{sym['name']}" if sym['parent'] else sym['name']
            docstrings[key] = sym['doc']

    extra = {
        'imports': imports,
        'lang': 'groovy',
        'package': _parse_package(import_src),
    }
    if docstrings:
        extra['docstrings'] = docstrings

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs
