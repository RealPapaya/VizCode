#!/usr/bin/env python3
"""
parsers/kotlin_parser.py - VIZCODE Kotlin Language Parser

Extracts:
  imports             - referenced leaf names from `import` statements
  funcdefs            - `fun` declarations (top-level, member, extension)
  funccalls           - call expressions
  func_calls_by_func  - per-function call lists (body-scoped via brace matching)
  symbol_defs         - class / interface / object / enum / annotation / fun

Kotlin visibility:
  default / public / internal -> is_public True
  private / protected         -> is_public False
  members of object/companion -> is_static True (shown as 'static' in UI)

Syntax verified against the Kotlin language specification (kotlinlang.org/spec,
Lexical structure): line `//`, nested block `/* */` comments; escaped string
`"..."`, raw/multiline string `\"\"\" ... \"\"\"` (no escapes), char `'x'`.
"""

import re


# File extensions handled by this parser (consumed by analyze_viz dispatch).
KOTLIN_EXTENSIONS = {'.kt', '.kts'}


KOTLIN_KEYWORDS = {
    'as', 'break', 'class', 'continue', 'do', 'else', 'false', 'for', 'fun',
    'if', 'in', 'interface', 'is', 'null', 'object', 'package', 'return',
    'super', 'this', 'throw', 'true', 'try', 'typealias', 'typeof', 'val',
    'var', 'when', 'while', 'by', 'catch', 'constructor', 'delegate',
    'dynamic', 'field', 'file', 'finally', 'get', 'import', 'init', 'param',
    'property', 'receiver', 'set', 'setparam', 'where', 'actual', 'abstract',
    'annotation', 'companion', 'const', 'crossinline', 'data', 'enum',
    'expect', 'external', 'final', 'infix', 'inline', 'inner', 'internal',
    'lateinit', 'noinline', 'open', 'operator', 'out', 'override', 'private',
    'protected', 'public', 'reified', 'sealed', 'suspend', 'tailrec',
    'vararg', 'Int', 'Long', 'Short', 'Byte', 'Double', 'Float', 'Boolean',
    'Char', 'String', 'Unit', 'Any', 'Nothing', 'Array', 'List', 'Map', 'Set',
}

_KT_MODIFIERS = (
    r'(?:public|private|protected|internal|abstract|final|open|sealed|data|'
    r'enum|annotation|inner|value|inline|external|expect|actual|companion|'
    r'const|lateinit|override|suspend|operator|infix|tailrec|vararg|'
    r'crossinline|noinline|reified)'
)

RE_KT_PACKAGE = re.compile(r'^\s*package\s+([\w.]+)', re.MULTILINE)
RE_KT_IMPORT = re.compile(
    r'^\s*import\s+(?P<path>[\w.]+)(?P<wild>\.\*)?(?:\s+as\s+(?P<alias>\w+))?',
    re.MULTILINE,
)

RE_KT_TYPE = re.compile(
    r'(?:^|[\s;{}])'
    r'(?:' + _KT_MODIFIERS + r'\s+)*'
    r'(?P<kind>class|interface|object)\s+'
    r'(?P<name>[A-Za-z_]\w*)'
    r'(?:\s*<[^>{]*>)?'
    r'(?P<rest>[^{;=]*)'
    r'[{;=]',
    re.MULTILINE,
)

# fun [<T>] [Receiver.]name(
RE_KT_FUN = re.compile(
    r'\bfun\s+(?:<[^>{}()]*>\s*)?'
    r'(?:[A-Za-z_][\w.<>?]*\.\s*)?'
    r'(?P<name>[A-Za-z_]\w*)\s*\(',
)

RE_KT_CALL = re.compile(r'\b([A-Za-z_]\w*)\s*\(')

_RE_KT_BRANCH_KW = re.compile(r'\b(?:if|for|while|when|catch)\b')


def _mask_kotlin_source(src: str, mask_literals: bool = False) -> str:
    """Mask comments (and optionally literals) while preserving offsets/newlines.

    Handles nested block comments and raw triple-quoted strings (no escapes).
    Comment markers inside string literals are not treated as comments.
    """
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

        # Raw / multiline string: """ ... """ (no escapes)
        if c == '"' and src[i + 1:i + 3] == '""':
            start = i
            i += 3
            while i < n and src[i:i + 3] != '"""':
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

        if c == "'":
            start = i
            i += 1
            while i < n:
                if src[i] == '\\':
                    i += 2
                    continue
                if src[i] == "'" or src[i] == '\n':
                    i += 1 if src[i] == "'" else 0
                    break
                i += 1
            if mask_literals:
                blank_span(start, i)
            continue

        i += 1

    return ''.join(out)


def _strip_comments(src: str) -> str:
    return _mask_kotlin_source(src, mask_literals=False)


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


def _is_private(clean: str, decl_start: int) -> bool:
    """Look back over the declaration's modifiers for private/protected."""
    line_start = clean.rfind('\n', 0, decl_start) + 1
    prefix = clean[line_start:decl_start]
    return bool(re.search(r'\b(?:private|protected)\b', prefix))


def _parse_package(src: str) -> str:
    m = RE_KT_PACKAGE.search(src)
    return m.group(1) if m else ''


def _parse_imports(src: str) -> list:
    refs = []
    for m in RE_KT_IMPORT.finditer(src):
        segs = m.group('path').split('.')
        if not segs:
            continue
        # Wildcard import refers to the package leaf; normal import to the class.
        ref = segs[-1]
        if ref and ref != '*':
            refs.append(ref)
    return list(dict.fromkeys(refs))


def _split_bases(rest: str) -> list:
    """Pull supertype names from a ` : A(), B, C` supertype clause."""
    rest = rest.strip()
    if not rest.startswith(':'):
        return []
    clause = rest[1:]
    clause = re.sub(r'<[^>]*>', '', clause)
    clause = re.sub(r'\([^)]*\)', '', clause)
    clause = clause.split(' where ')[0]
    bases = []
    for part in clause.split(','):
        name = part.strip().split('.')[-1].strip()
        if name and name not in KOTLIN_KEYWORDS:
            bases.append(name)
    return list(dict.fromkeys(bases))


def _extract_calls(text: str, skip_starts=None) -> list:
    skip_starts = skip_starts or set()
    calls = []
    for m in RE_KT_CALL.finditer(text):
        name = m.group(1)
        if m.start(1) in skip_starts:
            continue
        if name in KOTLIN_KEYWORDS or len(name) < 2:
            continue
        calls.append(name)
    return calls


def _count_complexity(body: str) -> int:
    if not body:
        return 1
    count = 1
    count += len(_RE_KT_BRANCH_KW.findall(body))
    count += body.count('&&')
    count += body.count('||')
    count += body.count('?:')
    return count


def _scan_doc_comments(src: str) -> dict:
    """Map the line *after* a KDoc/block comment -> cleaned doc text."""
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
    for m in RE_KT_TYPE.finditer(clean):
        kind = m.group('kind')
        name = m.group('name')
        if name in KOTLIN_KEYWORDS:
            continue
        line_no = _line_no(src, m.start('name'))
        open_idx = clean.find('{', m.end() - 1)
        if open_idx == -1 or (clean[m.end() - 1] in ';='):
            end_idx = m.end()
        else:
            end_idx = _brace_range(clean, open_idx)
        end_line = _line_no(src, max(m.start('name'), end_idx - 1))
        full = m.group(0)
        is_object = kind == 'object' or 'companion' in full
        symbols.append({
            'kind': 'object' if is_object else kind,
            'name': name,
            'line': line_no,
            'end_line': end_line,
            'bases': _split_bases(m.group('rest')),
            'parent': None,
            'is_public': not _is_private(clean, m.start('name')),
            'doc': None,
            '_is_object': is_object,
        })
        ranges.append((m.start('name'), end_idx, name, is_object))
    return symbols, ranges


def _enclosing(ranges: list, idx: int):
    best = None
    best_span = None
    for start, end, name, is_obj in ranges:
        if start <= idx < end:
            span = end - start
            if best_span is None or span < best_span:
                best_span = span
                best = (name, is_obj)
    return best


def scan_kotlin(src: str, ext: str = '.kt') -> tuple:
    """Kotlin file analysis. Returns the standard VIZCODE 6-tuple."""
    import_src = _strip_comments(src)
    clean = _mask_kotlin_source(src, mask_literals=True)
    docs = _scan_doc_comments(src)

    imports = _parse_imports(import_src)
    type_symbols, type_ranges = _parse_types(src, clean)
    for s in type_symbols:
        s.pop('_is_object', None)
        s['doc'] = docs.get(s['line'])

    funcdefs = []
    func_calls_by_func = []
    method_symbols = []
    decl_name_starts = set()
    seen = set()

    for m in RE_KT_FUN.finditer(clean):
        name = m.group('name')
        if name in KOTLIN_KEYWORDS:
            continue
        start = m.start('name')
        line_no = _line_no(src, start)
        key = (name, line_no)
        if key in seen:
            continue
        seen.add(key)
        decl_name_starts.add(start)

        open_idx = clean.find('{', m.end() - 1)
        # An expression-bodied fun (`fun f() = expr`) has no brace before ';'/EOL.
        eq_idx = clean.find('=', m.end() - 1)
        nl_idx = clean.find('\n', m.end() - 1)
        has_body = open_idx != -1 and (eq_idx == -1 or open_idx < eq_idx) \
            and (nl_idx == -1 or open_idx < nl_idx + 1)
        if has_body:
            end = _brace_range(clean, open_idx)
            body = clean[open_idx + 1:end - 1]
            end_line = _line_no(src, end - 1)
        else:
            body = ''
            end_line = line_no
        calls = _extract_calls(body)

        enc = _enclosing(type_ranges, start)
        parent = enc[0] if enc else None
        is_static = bool(enc and enc[1])
        is_public = not _is_private(clean, start)

        funcdefs.append({
            'label': name,
            'is_efiapi': False,
            'is_static': is_static,
        })
        func_calls_by_func.append(calls)
        method_symbols.append({
            'kind': 'method' if parent else 'function',
            'name': name,
            'line': line_no,
            'end_line': end_line,
            'bases': [],
            'parent': parent,
            'is_public': is_public,
            'doc': docs.get(line_no),
            'complexity': _count_complexity(body),
        })

    for start, _e, _n, _o in type_ranges:
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
        'lang': 'kotlin',
        'package': _parse_package(import_src),
    }
    if docstrings:
        extra['docstrings'] = docstrings

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs
