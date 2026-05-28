#!/usr/bin/env python3
"""
parsers/scala_parser.py - VIZCODE Scala Language Parser

Extracts:
  imports             - referenced leaf names from `import` statements
  funcdefs            - `def` declarations (incl. paren-less `def x: T = ...`)
  funccalls           - call expressions
  func_calls_by_func  - per-function call lists (body-scoped via brace matching)
  symbol_defs         - class / trait / object / enum / def

Scala visibility:
  default / public          -> is_public True
  private[...] / protected   -> is_public False
  members of object          -> is_static True (shown as 'static' in UI)

Syntax verified against the Scala Language Reference (Lexical Syntax):
  line `//`, NESTED block `/* */` comments; escaped string `"..."`,
  raw/multiline `\"\"\" ... \"\"\"` (no escapes), interpolators `s"..."`,
  char `'x'`. Scala-3 optional-brace (indentation) bodies degrade to a
  single-line span (no false parent attribution).
"""

import re


SCALA_EXTENSIONS = {'.scala'}


SCALA_KEYWORDS = {
    'abstract', 'case', 'catch', 'class', 'def', 'do', 'else', 'enum',
    'export', 'extends', 'false', 'final', 'finally', 'for', 'forSome',
    'given', 'if', 'implicit', 'import', 'lazy', 'match', 'new', 'null',
    'object', 'override', 'package', 'private', 'protected', 'return',
    'sealed', 'super', 'then', 'this', 'throw', 'trait', 'try', 'true',
    'type', 'using', 'val', 'var', 'while', 'with', 'yield', 'inline',
    'opaque', 'transparent', 'derives', 'end', 'extension', 'as',
    'Int', 'Long', 'Short', 'Byte', 'Double', 'Float', 'Boolean', 'Char',
    'String', 'Unit', 'Any', 'AnyRef', 'AnyVal', 'Nothing', 'Null',
    'Option', 'Some', 'List', 'Seq', 'Map', 'Set', 'Array',
}

_SCALA_MODIFIERS = (
    r'(?:abstract|final|sealed|implicit|lazy|override|private(?:\[[^\]]*\])?|'
    r'protected(?:\[[^\]]*\])?|inline|opaque|transparent|case)'
)

RE_SCALA_PACKAGE = re.compile(r'^\s*package\s+([\w.]+)', re.MULTILINE)

# import a.b.C  /  import a.b.{C, D => E}  /  import a.b._  /  import a.b.*
RE_SCALA_IMPORT = re.compile(r'^\s*import\s+(?P<body>.+)', re.MULTILINE)

RE_SCALA_TYPE = re.compile(
    r'(?:^|[\s;{}])'
    r'(?:' + _SCALA_MODIFIERS + r'\s+)*'
    r'(?P<kind>class|trait|object|enum)\s+'
    r'(?P<name>[A-Za-z_]\w*)'
    r'(?:\s*\[[^\]]*\])?'                 # type params
    r'(?P<rest>[^{=\n]*)'                 # ctor params + extends/with clause
    r'(?:[={]|$)',
    re.MULTILINE,
)

# def [<T>] name [(...)] [: T] (= | {)
RE_SCALA_DEF = re.compile(
    r'\bdef\s+(?P<name>[A-Za-z_]\w*)',
)

RE_SCALA_CALL = re.compile(r'\b([A-Za-z_]\w*)\s*\(')

_RE_SCALA_BRANCH_KW = re.compile(r'\b(?:if|for|while|match|catch)\b')


def _mask_scala_source(src: str, mask_literals: bool = False) -> str:
    """Mask comments (and optionally literals), preserving offsets/newlines.
    Handles NESTED block comments and raw triple-quoted strings."""
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
    return _mask_scala_source(src, mask_literals=False)


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
    line_start = clean.rfind('\n', 0, decl_start) + 1
    prefix = clean[line_start:decl_start]
    return bool(re.search(r'\b(?:private|protected)\b', prefix))


def _parse_package(src: str) -> str:
    m = RE_SCALA_PACKAGE.search(src)
    return m.group(1) if m else ''


def _parse_imports(src: str) -> list:
    refs = []
    for m in RE_SCALA_IMPORT.finditer(src):
        body = m.group('body').strip()
        if '{' in body:
            # import a.b.{C, D => E}  -> selector names (alias wins)
            sel = body.split('{', 1)[1].split('}')[0]
            for part in sel.split(','):
                name = (part.split('=>')[-1] if '=>' in part else part)
                name = name.strip().split('.')[-1].strip()
                if name and name not in ('_', '*') and name not in SCALA_KEYWORDS:
                    refs.append(name)
        else:
            # import a.b.C  /  import a.b._  /  import a.b.* -> last real segment
            token = body.split()[0]
            parts = [p for p in token.split('.') if p and p not in ('_', '*')]
            if parts:
                refs.append(parts[-1])
    return list(dict.fromkeys(refs))


def _split_bases(rest: str) -> list:
    """Pull supertype names from ` extends A with B with C` (drop ctor args)."""
    m = re.search(r'\bextends\b(.*)', rest)
    if not m:
        return []
    clause = m.group(1)
    clause = re.sub(r'\([^)]*\)', '', clause)
    clause = re.sub(r'\[[^\]]*\]', '', clause)
    bases = []
    for part in re.split(r'\bwith\b|,', clause):
        name = part.strip().split('.')[-1].strip()
        if name and name not in SCALA_KEYWORDS:
            bases.append(name)
    return list(dict.fromkeys(bases))


def _extract_calls(text: str, skip_starts=None) -> list:
    skip_starts = skip_starts or set()
    calls = []
    for m in RE_SCALA_CALL.finditer(text):
        name = m.group(1)
        if m.start(1) in skip_starts:
            continue
        if name in SCALA_KEYWORDS or len(name) < 2:
            continue
        calls.append(name)
    return calls


def _count_complexity(body: str) -> int:
    if not body:
        return 1
    count = 1
    count += len(_RE_SCALA_BRANCH_KW.findall(body))
    count += body.count('&&')
    count += body.count('||')
    count += body.count('=>')
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
    for m in RE_SCALA_TYPE.finditer(clean):
        kind = m.group('kind')
        name = m.group('name')
        if name in SCALA_KEYWORDS:
            continue
        line_no = _line_no(src, m.start('name'))
        open_idx = clean.find('{', m.end() - 1)
        # Only treat the brace as this type's body if it is reasonably close
        # (same or next few lines), else Scala-3 braceless body — degrade.
        if open_idx != -1 and clean[m.end() - 1:open_idx].count('\n') <= 1:
            end_idx = _brace_range(clean, open_idx)
        else:
            end_idx = m.end()
        end_line = _line_no(src, max(m.start('name'), end_idx - 1))
        is_object = kind == 'object'
        symbols.append({
            'kind': kind,
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


def scan_scala(src: str, ext: str = '.scala') -> tuple:
    """Scala file analysis. Returns the standard VIZCODE 6-tuple."""
    import_src = _strip_comments(src)
    clean = _mask_scala_source(src, mask_literals=True)
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

    for m in RE_SCALA_DEF.finditer(clean):
        name = m.group('name')
        if name in SCALA_KEYWORDS:
            continue
        start = m.start('name')
        line_no = _line_no(src, start)
        key = (name, line_no)
        if key in seen:
            continue
        seen.add(key)
        decl_name_starts.add(start)

        # Locate body: nearest of '{' or '=' after the signature.
        brace_idx = clean.find('{', m.end())
        eq_idx = clean.find('=', m.end())
        nl_idx = clean.find('\n', m.end())
        has_brace = brace_idx != -1 and (eq_idx == -1 or brace_idx < eq_idx) \
            and (nl_idx == -1 or brace_idx < nl_idx)
        if has_brace:
            end = _brace_range(clean, brace_idx)
            body = clean[brace_idx + 1:end - 1]
            end_line = _line_no(src, end - 1)
        elif eq_idx != -1 and (nl_idx == -1 or eq_idx < nl_idx):
            # Expression body `def f = expr` (best-effort single line).
            end = clean.find('\n', eq_idx)
            end = len(clean) if end == -1 else end
            body = clean[eq_idx + 1:end]
            end_line = line_no
        else:
            body = ''
            end_line = line_no
        calls = _extract_calls(body)

        enc = _enclosing(type_ranges, start)
        parent = enc[0] if enc else None
        is_static = bool(enc and enc[1])

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
            'is_public': not _is_private(clean, start),
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
        'lang': 'scala',
        'package': _parse_package(import_src),
    }
    if docstrings:
        extra['docstrings'] = docstrings

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs
