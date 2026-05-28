#!/usr/bin/env python3
"""
parsers/java_parser.py - VIZCODE Java Language Parser

Extracts:
  imports             - referenced class/package names from 'import' statements
  funcdefs            - method and constructor declarations
  funccalls           - call expressions
  func_calls_by_func  - per-method call lists (body-scoped via brace matching)
  symbol_defs         - structured symbol table (class/interface/enum/record/method)

Java naming / visibility:
  public methods -> is_public True
  static methods -> is_static True (shown as 'static' in UI)

Syntax verified against the Java Language Specification (JLS SE21, chapter 3,
Lexical Structure): line `//` and block `/* */` comments (block comments do NOT
nest), string literals, char literals, and text blocks `\"\"\" ... \"\"\"`.
"""

import re


# File extensions handled by this parser (consumed by analyze_viz dispatch).
JAVA_EXTENSIONS = {'.java'}


# Java reserved words / builtins that must never be treated as call targets.
JAVA_KEYWORDS = {
    'abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'char',
    'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum',
    'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements',
    'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new',
    'package', 'private', 'protected', 'public', 'return', 'short', 'static',
    'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws',
    'transient', 'try', 'void', 'volatile', 'while', 'var', 'record', 'yield',
    'true', 'false', 'null',
}

# Modifiers that may precede a method or type declaration.
_JAVA_MODIFIERS = (
    r'(?:public|private|protected|static|final|abstract|synchronized|'
    r'native|default|strictfp|transient|volatile)'
)

# Tokens that must NOT appear as a method's return type. Primitives (int, void,
# ...) are valid return types so they are intentionally excluded here. A leading
# modifier here means we matched a constructor (no return type) — let the
# constructor pass handle it instead.
_JAVA_RET_SKIP = {
    'return', 'new', 'throw', 'throws', 'else', 'assert', 'yield', 'case',
    'do', 'try', 'finally', 'catch', 'for', 'while', 'if', 'switch',
    'synchronized', 'instanceof', 'package', 'import', 'super', 'this',
    'break', 'continue', 'goto', 'extends', 'implements', 'enum', 'class',
    'interface', 'record', 'const', 'public', 'private', 'protected', 'static',
    'final', 'abstract', 'native', 'default', 'strictfp', 'transient',
    'volatile',
}

# Method declaration: requires an explicit return type before the name, which
# keeps control-flow constructs (if/while/for) and plain calls out.
RE_JAVA_METHOD = re.compile(
    r'(?P<mods>(?:' + _JAVA_MODIFIERS + r'\s+)*)'
    r'(?:<[^>{};]+>\s*)?'
    r'(?P<ret>[\w$][\w$.<>\[\],?\s]*?\s+)'
    r'(?P<name>[\w$]+)\s*'
    r'\((?P<params>[^;{}]*?)\)\s*'
    r'(?:throws\s[\w$.,\s]+?)?'
    r'(?P<term>[{;])',
    re.MULTILINE,
)

# Constructor: visibility modifier + Capitalized name + '(' + body. Gated on the
# name actually being a type defined in the file.
RE_JAVA_CTOR = re.compile(
    r'(?:public|private|protected)\s+'
    r'(?P<name>[A-Z][\w$]*)\s*'
    r'\([^;{}]*\)\s*'
    r'(?:throws\s[\w$.,\s]+?)?'
    r'\{',
    re.MULTILINE,
)

RE_JAVA_PACKAGE = re.compile(r'^\s*package\s+([\w.]+)\s*;', re.MULTILINE)
RE_JAVA_IMPORT = re.compile(
    r'^\s*import\s+(?P<static>static\s+)?(?P<path>[\w.]+)(?P<wild>\.\*)?\s*;',
    re.MULTILINE,
)

# Type declarations. The leading boundary avoids matching 'class' inside words.
RE_JAVA_TYPE = re.compile(
    r'(?:^|[\s;{}])'
    r'(?:' + _JAVA_MODIFIERS + r'\s+)*'
    r'(?P<kind>class|interface|enum|record|@interface)\s+'
    r'(?P<name>[\w$]+)'
    r'(?:\s*<[^>{]*>)?'                       # generic params
    r'(?:\s*\([^)]*\))?'                      # record header
    r'(?P<rest>[^{;]*)'                       # extends/implements clause
    r'[{;]',
    re.MULTILINE,
)

RE_JAVA_CALL = re.compile(r'\b([A-Za-z_$][\w$]*)\s*\(')

# Identifiers that look like calls but are statements / operators.
_JAVA_CALL_SKIP = JAVA_KEYWORDS | {'value', 'get', 'set'}

_RE_JAVA_STRINGS = re.compile(r'"(?:[^"\\]|\\.)*"', re.DOTALL)
_RE_JAVA_BRANCH_KW = re.compile(r'\b(?:if|for|while|case|catch)\b')


def _mask_java_source(src: str, mask_literals: bool = False) -> str:
    """Mask comments (and optionally string/char/text-block literals) while
    preserving character offsets and newlines, so reported line numbers stay
    aligned. Comment markers inside literals are not treated as comments."""
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

        # Text block: """ ... """
        if c == '"' and src[i + 1:i + 3] == '""':
            start = i
            i += 3
            while i < n:
                if src[i] == '\\':
                    i += 2
                    continue
                if src[i] == '"' and src[i + 1:i + 3] == '""':
                    i += 3
                    break
                i += 1
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
    return _mask_java_source(src, mask_literals=False)


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _brace_range(src: str, open_idx: int) -> int:
    """Return index just past the matching '}' for the '{' at open_idx."""
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


def _brace_body(src: str, open_idx: int) -> str:
    end = _brace_range(src, open_idx)
    if end <= open_idx:
        return ''
    return src[open_idx + 1:end - 1]


def _parse_package(src: str) -> str:
    m = RE_JAVA_PACKAGE.search(src)
    return m.group(1) if m else ''


def _parse_imports(src: str) -> list:
    """Return referenced class/package leaf names from import statements.

    Normal/wildcard imports -> the class (or package leaf) name.
    Static imports          -> the owning class name (segment before member).
    """
    refs = []
    for m in RE_JAVA_IMPORT.finditer(src):
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
    """Pull type names out of an 'extends A implements B, C' tail."""
    bases = []
    for kw in ('extends', 'implements'):
        m = re.search(kw + r'\s+([\w$.,<>\[\]\s]+)', rest)
        if not m:
            continue
        clause = re.sub(r'<[^>]*>', '', m.group(1))
        clause = clause.split('implements')[0] if kw == 'extends' else clause
        for part in clause.split(','):
            name = part.strip().split('.')[-1].strip()
            if name and name not in JAVA_KEYWORDS:
                bases.append(name)
    return list(dict.fromkeys(bases))


def _extract_calls(text: str, skip_starts: set | None = None) -> list:
    skip_starts = skip_starts or set()
    calls = []
    for m in RE_JAVA_CALL.finditer(text):
        name = m.group(1)
        if m.start(1) in skip_starts:
            continue
        if name in _JAVA_CALL_SKIP or len(name) < 2:
            continue
        calls.append(name)
    return calls


def _count_complexity(body: str) -> int:
    if not body:
        return 1
    try:
        masked = _RE_JAVA_STRINGS.sub('""', body)
    except Exception:
        masked = body
    count = 1
    count += len(_RE_JAVA_BRANCH_KW.findall(masked))
    count += masked.count('&&')
    count += masked.count('||')
    count += masked.count('?')
    return count


def _scan_block_comments(src: str) -> dict:
    """Map a declaration's preceding-line number -> javadoc/line-comment text.

    Returns {end_line_of_comment: doc_text} for block comments and contiguous
    line-comment groups, so a decl can look up the comment ending right above it.
    """
    docs = {}
    i = 0
    n = len(src)
    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ''
        if c == '/' and nxt == '*':
            start = i
            i += 2
            body_start = i
            while i + 1 < n and not (src[i] == '*' and src[i + 1] == '/'):
                i += 1
            body = src[body_start:i]
            i = i + 2 if i + 1 < n else n
            text = _clean_doc(body)
            if text:
                docs[_line_no(src, i)] = text
            continue
        if c == '/' and nxt == '/':
            while i < n and src[i] != '\n':
                i += 1
            continue
        if c == '"' or c == "'":
            q = c
            triple = q == '"' and src[i + 1:i + 3] == '""'
            i += 3 if triple else 1
            while i < n:
                if src[i] == '\\':
                    i += 2
                    continue
                if triple and src[i] == '"' and src[i + 1:i + 3] == '""':
                    i += 3
                    break
                if not triple and src[i] == q:
                    i += 1
                    break
                i += 1
            continue
        i += 1
    return docs


def _clean_doc(body: str) -> str:
    lines = []
    for line in body.splitlines():
        text = line.strip()
        if text.startswith('*'):
            text = text[1:].lstrip()
        if text:
            lines.append(text)
    return '\n'.join(lines).strip()


def _parse_types(src: str, clean: str):
    """Return (symbols, ranges) for type declarations.

    ranges = list of (start_idx, end_idx, name) used to assign method parents.
    """
    symbols = []
    ranges = []
    for m in RE_JAVA_TYPE.finditer(clean):
        kind_raw = m.group('kind')
        kind = 'annotation' if kind_raw == '@interface' else kind_raw
        name = m.group('name')
        line_no = _line_no(src, m.start('name'))
        open_idx = clean.find('{', m.end() - 1)
        if open_idx == -1:
            end_idx = m.end()
        else:
            end_idx = _brace_range(clean, open_idx)
        end_line = _line_no(src, max(m.start('name'), end_idx - 1))
        symbols.append({
            'kind': kind,
            'name': name,
            'line': line_no,
            'end_line': end_line,
            'bases': _split_bases(m.group('rest')),
            'parent': None,
            'is_public': 'public' in m.group(0),
            'doc': None,
        })
        ranges.append((m.start('name'), end_idx, name))
    return symbols, ranges


def _enclosing_type(ranges: list, idx: int) -> str | None:
    best = None
    best_span = None
    for start, end, name in ranges:
        if start <= idx < end:
            span = end - start
            if best_span is None or span < best_span:
                best_span = span
                best = name
    return best


def scan_java(src: str, ext: str = '.java') -> tuple:
    """Java file analysis.

    Returns: (imports, funcdefs, all_calls, extra_dict, func_calls_by_func, symbol_defs)
    """
    import_src = _strip_comments(src)
    clean = _mask_java_source(src, mask_literals=True)
    docs = _scan_block_comments(src)

    imports = _parse_imports(import_src)
    type_symbols, type_ranges = _parse_types(src, clean)
    type_names = {s['name'] for s in type_symbols}

    # Attach docs to type symbols.
    for s in type_symbols:
        s['doc'] = docs.get(s['line'] - 1) or docs.get(s['line'])

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
        is_public = 'public' in mods
        if body_open != -1:
            body = _brace_body(clean, body_open)
            end_line = _line_no(src, _brace_range(clean, body_open) - 1)
        else:
            body = ''
            end_line = line_no
        calls = _extract_calls(body)
        funcdefs.append({
            'label': name,
            'is_efiapi': False,
            'is_static': is_static,
        })
        func_calls_by_func.append(calls)
        method_symbols.append({
            'kind': 'constructor' if is_ctor else 'method',
            'name': name,
            'line': line_no,
            'end_line': end_line,
            'bases': [],
            'parent': _enclosing_type(type_ranges, start_idx),
            'is_public': is_public,
            'doc': docs.get(line_no - 1),
            'complexity': _count_complexity(body),
        })

    for m in RE_JAVA_METHOD.finditer(clean):
        name = m.group('name')
        if name in JAVA_KEYWORDS:
            continue
        ret_first = m.group('ret').split()[0].split('<')[0]
        if ret_first in _JAVA_RET_SKIP:
            continue
        body_open = m.end() - 1 if m.group('term') == '{' else -1
        add_method(name, m.start('name'), m.group('mods'), body_open)

    for m in RE_JAVA_CTOR.finditer(clean):
        name = m.group('name')
        if name not in type_names:
            continue
        body_open = m.end() - 1
        add_method(name, m.start('name'), m.group(0), body_open, is_ctor=True)

    for start, _end, _name in type_ranges:
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
        'lang': 'java',
        'package': _parse_package(import_src),
    }
    if docstrings:
        extra['docstrings'] = docstrings

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs
