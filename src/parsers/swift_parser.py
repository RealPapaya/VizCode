#!/usr/bin/env python3
"""
parsers/swift_parser.py - VIZCODE Swift Language Parser

Extracts:
  imports             - imported module / symbol leaf names
  funcdefs            - func / init / deinit / subscript declarations
  funccalls           - call expressions
  func_calls_by_func  - per-function call lists (body-scoped via brace matching)
  symbol_defs         - class / struct / enum / protocol / actor / extension / func

Swift visibility:
  open / public / internal (default) -> is_public True
  private / fileprivate               -> is_public False
  static / class members              -> is_static True

Syntax verified against The Swift Programming Language:
  https://docs.swift.org/swift-book/documentation/the-swift-programming-language/declarations/
  https://docs.swift.org/swift-book/documentation/the-swift-programming-language/attributes/
Line `//`, NESTED block `/* */` comments; strings `"..."`, multiline
`\"\"\" ... \"\"\"`, raw `#"..."#` (extended delimiters). Swift has NO
single-quote char literal, so `'` is left untouched.
Unsupported: structural/inferred protocol conformance and arbitrary strings.
"""

import re


SWIFT_EXTENSIONS = {'.swift'}


SWIFT_KEYWORDS = {
    'associatedtype', 'class', 'deinit', 'enum', 'extension', 'fileprivate',
    'func', 'import', 'init', 'inout', 'internal', 'let', 'open', 'operator',
    'private', 'protocol', 'public', 'rethrows', 'static', 'struct', 'subscript',
    'typealias', 'var', 'actor', 'break', 'case', 'continue', 'default',
    'defer', 'do', 'else', 'fallthrough', 'for', 'guard', 'if', 'in', 'repeat',
    'return', 'switch', 'where', 'while', 'as', 'catch', 'false', 'is', 'nil',
    'self', 'Self', 'super', 'throw', 'throws', 'true', 'try', 'async', 'await',
    'convenience', 'dynamic', 'final', 'lazy', 'mutating', 'nonmutating',
    'optional', 'override', 'required', 'some', 'any', 'weak', 'unowned',
    'indirect', 'Int', 'Double', 'Float', 'Bool', 'String', 'Character',
    'Array', 'Dictionary', 'Set', 'Optional', 'Void', 'Any', 'AnyObject',
}

RE_SWIFT_IMPORT = re.compile(
    r'^\s*(?:@\w+\s+)?import\s+'
    r'(?:(?:class|struct|enum|protocol|typealias|func|var|let)\s+)?'
    r'(?P<path>[\w.]+)',
    re.MULTILINE,
)

# Anchored to line start so the `class` in `import class Foo.Bar` is not matched
# as a type declaration. Nested (indented) types still match via `^[ \t]*`.
RE_SWIFT_TYPE = re.compile(
    r'^[ \t]*'
    r'(?:(?:public|private|internal|fileprivate|open|final|static|indirect)\s+)*'
    r'(?P<kind>class|struct|enum|protocol|actor|extension)\s+'
    r'(?P<name>[A-Za-z_]\w*)'
    r'(?:\s*<[^>{]*>)?'
    r'(?P<rest>[^{]*)'
    r'\{',
    re.MULTILINE,
)

RE_SWIFT_FUNC = re.compile(
    r'\bfunc\s+(?:<[^>{}()]*>\s*)?(?P<name>[A-Za-z_]\w*)\s*(?:<[^>{}()]*>\s*)?\(',
)
RE_SWIFT_INIT = re.compile(r'\binit\??\s*(?:<[^>{}()]*>\s*)?\(')
RE_SWIFT_DEINIT = re.compile(r'\bdeinit\b')
RE_SWIFT_SUBSCRIPT = re.compile(r'\bsubscript\s*(?:<[^>{}()]*>\s*)?\(')

RE_SWIFT_CALL = re.compile(r'\b([A-Za-z_]\w*)\s*\(')

_RE_SWIFT_BRANCH_KW = re.compile(r'\b(?:if|for|while|switch|catch|guard)\b')
_SWIFT_FILE_EXTS = {
    '.json', '.yaml', '.yml', '.plist', '.xml', '.conf', '.cfg', '.toml',
    '.html', '.htm', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg',
    '.txt', '.md',
}
_SWIFT_CONFIG_EXTS = {'.json', '.yaml', '.yml', '.plist', '.xml', '.conf', '.cfg', '.toml'}
RE_SWIFT_FILE_REF = re.compile(
    r'\b(?:contentsOfFile|fileURLWithPath)\s*:\s*"(?P<path>[^"]+)"'
)

# If the text between a signature and the next '{' contains a closing brace or
# another declaration keyword, the declaration is bodyless (e.g. a protocol
# requirement) and the following '{' belongs to a different scope.
_BODYLESS_GAP = re.compile(
    r'\}|\b(?:func|var|let|class|struct|enum|protocol|extension|actor|'
    r'case|init|deinit|subscript)\b')


def _mask_swift_source(src: str, mask_literals: bool = False) -> str:
    """Mask comments (and optionally literals). NESTED block comments, multiline
    strings, and extended-delimiter raw strings `#"..."#`. No char literals."""
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
            depth = 1
            while i < n and depth > 0:
                if src[i] == '/' and src[i + 1:i + 2] == '*':
                    depth += 1
                    i += 2
                    continue
                if src[i] == '*' and src[i + 1:i + 2] == '/':
                    depth -= 1
                    i += 2
                    continue
                i += 1
            blank_span(start, i)
            continue

        # Raw string with extended delimiters: #..#" ... "#..#
        if c == '#':
            p = i
            while p < n and src[p] == '#':
                p += 1
            pounds = p - i
            if pounds > 0 and p < n and src[p] == '"':
                start = i
                triple = src[p:p + 3] == '"""'
                close = ('"""' if triple else '"') + ('#' * pounds)
                i = p + (3 if triple else 1)
                while i < n and src[i:i + len(close)] != close:
                    i += 1
                i = i + len(close) if i < n else n
                if mask_literals:
                    blank_span(start, i)
                continue

        if c == '"' and src[i + 1:i + 3] == '""':
            start = i
            i += 3
            while i < n and src[i:i + 3] != '"""':
                if src[i] == '\\':
                    i += 2
                    continue
                i += 1
            i = i + 3 if i < n else n
            if mask_literals:
                blank_span(start, i)
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
            if mask_literals:
                blank_span(start, i)
            continue

        i += 1

    return ''.join(out)


def _strip_comments(src: str) -> str:
    return _mask_swift_source(src, mask_literals=False)


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _normalize_signature(src: str, start: int, end: int) -> str:
    return ' '.join(src[start:end].strip().split())


def _extract_type_refs(text: str) -> list:
    refs = []
    for name in re.findall(r'(?:\b[A-Za-z_]\w*\.)?\b([A-Z][A-Za-z_]\w*)\b', text):
        if name not in SWIFT_KEYWORDS and len(name) >= 3:
            refs.append(name)
    return list(dict.fromkeys(refs))


def _decorators_before(src: str, clean: str, decl_start: int) -> list:
    line_start = clean.rfind('\n', 0, decl_start) + 1
    prefix = src[line_start:decl_start]
    decorators = re.findall(r'@([A-Za-z_]\w*)', prefix)
    src_lines = src[:line_start].splitlines()
    clean_lines = clean[:line_start].splitlines()
    i = len(src_lines) - 1
    leading = []
    while i >= 0:
        stripped = clean_lines[i].strip()
        if not stripped:
            i -= 1
            continue
        if not stripped.startswith('@'):
            break
        leading[:0] = re.findall(r'@([A-Za-z_]\w*)', src_lines[i])
        i -= 1
    out = leading + decorators
    if re.search(r'\boverride\b', prefix):
        out.append('override')
    return list(dict.fromkeys(out))


def _path_edge_type(path: str):
    if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', path) or path.startswith(('/', '\\')):
        return None
    ext = '.' + path.rsplit('.', 1)[-1].lower() if '.' in path.rsplit('/', 1)[-1] else ''
    if ext not in _SWIFT_FILE_EXTS:
        return None
    return 'config_ref' if ext in _SWIFT_CONFIG_EXTS else 'asset_ref'


def _edge_hints(src: str, code: str) -> list:
    hints = []
    masked = _mask_swift_source(src, mask_literals=True)
    for m in RE_SWIFT_FILE_REF.finditer(code):
        if not masked[m.start():m.start('path')].strip():
            continue
        path = m.group('path').strip()
        edge_type = _path_edge_type(path)
        if not edge_type:
            continue
        hints.append({
            'type': edge_type,
            'target': path,
            'subtype': 'config' if edge_type == 'config_ref' else 'asset',
            'via': code[m.start():m.start('path')].strip(),
            'line': _line_no(src, m.start('path')),
            'confidence': 1.0,
        })
    return hints


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


def _is_private(clean: str, decl_start: int) -> bool:
    line_start = clean.rfind('\n', 0, decl_start) + 1
    prefix = clean[line_start:decl_start]
    return bool(re.search(r'\b(?:private|fileprivate)\b', prefix))


def _is_static(clean: str, decl_start: int) -> bool:
    line_start = clean.rfind('\n', 0, decl_start) + 1
    prefix = clean[line_start:decl_start]
    return bool(re.search(r'\b(?:static|class)\s', prefix))


def _parse_imports(src: str) -> list:
    refs = []
    for m in RE_SWIFT_IMPORT.finditer(src):
        ref = m.group('path').split('.')[-1]
        if ref and len(ref) >= 2:
            refs.append(ref)
    return list(dict.fromkeys(refs))


def _split_bases(rest: str) -> list:
    rest = rest.strip()
    if not rest.startswith(':'):
        return []
    clause = rest[1:].split(' where ')[0]
    clause = re.sub(r'<[^>]*>', '', clause)
    bases = []
    for part in clause.split(','):
        name = part.strip().split('.')[-1].strip()
        if name and name not in SWIFT_KEYWORDS:
            bases.append(name)
    return list(dict.fromkeys(bases))


def _extract_calls(text: str, skip_starts=None) -> list:
    skip_starts = skip_starts or set()
    calls = []
    for m in RE_SWIFT_CALL.finditer(text):
        name = m.group(1)
        if m.start(1) in skip_starts:
            continue
        if name in SWIFT_KEYWORDS or len(name) < 2:
            continue
        calls.append(name)
    return calls


def _count_complexity(body: str) -> int:
    if not body:
        return 1
    count = 1
    count += len(_RE_SWIFT_BRANCH_KW.findall(body))
    count += body.count('&&')
    count += body.count('||')
    count += body.count('?')
    return count


def _scan_doc_comments(src: str) -> dict:
    docs = {}
    lines = src.splitlines()
    i = 0
    while i < len(lines):
        if lines[i].strip().startswith('///'):
            buf = []
            while i < len(lines) and lines[i].strip().startswith('///'):
                buf.append(lines[i].strip()[3:].strip())
                i += 1
            text = '\n'.join(x for x in buf if x).strip()
            if text and i < len(lines):
                docs[i + 1] = text
        else:
            i += 1
    for m in re.finditer(r'/\*\*(.*?)\*/', src, re.DOTALL):
        buf = []
        for ln in m.group(1).splitlines():
            t = ln.strip()
            if t.startswith('*'):
                t = t[1:].strip()
            if t:
                buf.append(t)
        text = '\n'.join(buf).strip()
        if text:
            docs[_line_no(src, m.end()) + 1] = text
    return docs


def _parse_types(src: str, clean: str):
    symbols = []
    ranges = []
    for m in RE_SWIFT_TYPE.finditer(clean):
        kind = m.group('kind')
        name = m.group('name')
        if name in SWIFT_KEYWORDS:
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
            'type_refs': _extract_type_refs(m.group('rest')),
            'parent': None,
            'is_public': not _is_private(clean, m.start('name')),
            'doc': None,
            'signature': _normalize_signature(src, m.start(), open_idx if open_idx != -1 else m.end()),
            'decorators': _decorators_before(src, clean, m.start()),
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


def scan_swift(src: str, ext: str = '.swift') -> tuple:
    """Swift file analysis. Returns the standard VIZCODE 6-tuple."""
    import_src = _strip_comments(src)
    clean = _mask_swift_source(src, mask_literals=True)
    docs = _scan_doc_comments(src)

    imports = _parse_imports(import_src)
    type_symbols, type_ranges = _parse_types(src, clean)
    for s in type_symbols:
        s['doc'] = docs.get(s['line'])

    funcdefs = []
    func_calls_by_func = []
    method_symbols = []
    decl_name_starts = {r[0] for r in type_ranges}
    seen = set()

    def add_method(name, start_idx, sig_end):
        line_no = _line_no(src, start_idx)
        key = (name, line_no)
        if key in seen:
            return
        seen.add(key)
        decl_name_starts.add(start_idx)
        open_idx = clean.find('{', sig_end)
        # A real body brace is preceded only by the return clause / effect
        # keywords. If a closing '}' or another declaration keyword appears
        # first, this is a bodyless requirement (protocol / abstract decl).
        if open_idx != -1 and not _BODYLESS_GAP.search(clean[sig_end:open_idx]):
            end = _brace_range(clean, open_idx)
            body = clean[open_idx + 1:end - 1]
            end_line = _line_no(src, end - 1)
            signature_end = open_idx
        else:
            body = ''
            end_line = line_no
            signature_end = sig_end
        calls = _extract_calls(body)
        parent = _enclosing(type_ranges, start_idx)
        funcdefs.append({
            'label': name,
            'is_efiapi': False,
            'is_static': _is_static(clean, start_idx),
        })
        func_calls_by_func.append(calls)
        method_symbols.append({
            'kind': 'method' if parent else 'function',
            'name': name,
            'line': line_no,
            'end_line': end_line,
            'bases': [],
            'parent': parent,
            'is_public': not _is_private(clean, start_idx),
            'doc': docs.get(line_no),
            'complexity': _count_complexity(body),
            'signature': _normalize_signature(src, start_idx, signature_end),
            'decorators': _decorators_before(src, clean, start_idx),
            'type_refs': _extract_type_refs(src[start_idx:signature_end]),
        })

    for m in RE_SWIFT_FUNC.finditer(clean):
        name = m.group('name')
        if name in SWIFT_KEYWORDS:
            continue
        add_method(name, m.start('name'), m.end())
    for m in RE_SWIFT_INIT.finditer(clean):
        add_method('init', m.start(), m.end())
    for m in RE_SWIFT_SUBSCRIPT.finditer(clean):
        add_method('subscript', m.start(), m.end())
    for m in RE_SWIFT_DEINIT.finditer(clean):
        add_method('deinit', m.start(), m.end())

    symbol_defs = type_symbols + method_symbols
    all_calls = _extract_calls(clean, decl_name_starts)

    docstrings = {}
    for sym in symbol_defs:
        if sym.get('doc'):
            key = f"{sym['parent']}.{sym['name']}" if sym['parent'] else sym['name']
            docstrings[key] = sym['doc']

    extra = {'imports': imports, 'lang': 'swift'}
    hints = _edge_hints(src, import_src)
    if hints:
        extra['edge_hints'] = hints
    if docstrings:
        extra['docstrings'] = docstrings

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs
