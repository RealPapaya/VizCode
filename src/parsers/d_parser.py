#!/usr/bin/env python3
"""
parsers/d_parser.py - VIZCODE D Language Parser

Extracts:
  imports             - leaf names of `import a.b.c;` (and selective imports)
  funcdefs            - C-style function/method definitions with a body
  funccalls           - call expressions (declaration names excluded)
  func_calls_by_func  - per-function call lists (body-scoped via brace matching)
  symbol_defs         - class / struct / interface / union / enum / template
                        + functions (methods parented to their aggregate)

D resolves symbols at compile/link time; file dependencies come from `import`
declarations. `module a.b;` names the module. Bodies are brace blocks `{ }`;
only definitions WITH a body are captured (precision over prototype recall).

Syntax verified against the D language specification (Lexical):
  `//` line, `/* */` (NON-nesting), `/+ +/` (NESTED) comments; strings `"..."`,
  wysiwyg `` `...` `` and `r"..."` (no escapes), char `'c'`.
"""

import re

D_EXTENSIONS = {'.d'}

D_KEYWORDS = {
    'abstract', 'alias', 'align', 'asm', 'assert', 'auto', 'body', 'bool',
    'break', 'byte', 'case', 'cast', 'catch', 'cdouble', 'cent', 'cfloat',
    'char', 'class', 'const', 'continue', 'creal', 'dchar', 'debug', 'default',
    'delegate', 'delete', 'deprecated', 'do', 'double', 'else', 'enum',
    'export', 'extern', 'false', 'final', 'finally', 'float', 'for', 'foreach',
    'foreach_reverse', 'function', 'goto', 'idouble', 'if', 'ifloat',
    'immutable', 'import', 'in', 'inout', 'int', 'interface', 'invariant',
    'ireal', 'is', 'lazy', 'long', 'macro', 'mixin', 'module', 'new', 'nothrow',
    'null', 'out', 'override', 'package', 'pragma', 'private', 'protected',
    'public', 'pure', 'real', 'ref', 'return', 'scope', 'shared', 'short',
    'static', 'struct', 'super', 'switch', 'synchronized', 'template', 'this',
    'throw', 'true', 'try', 'typeid', 'typeof', 'ubyte', 'ucent', 'uint',
    'ulong', 'union', 'unittest', 'ushort', 'version', 'void', 'wchar', 'while',
    'with', 'sizeof',
}

_D_MOD = (
    r'(?:public|private|protected|package|export|static|final|abstract|'
    r'deprecated|nothrow|pure|ref|auto|const|immutable|inout|shared|scope|'
    r'override|synchronized|extern(?:\s*\([^)]*\))?|align(?:\s*\([^)]*\))?|'
    r'@[\w.]+(?:\s*\([^)]*\))?)'
)

RE_D_MODULE = re.compile(r'^\s*module\s+([\w.]+)\s*;', re.MULTILINE)
RE_D_IMPORT = re.compile(
    r'^[ \t]*(?:public\s+|static\s+)?import\s+([^;]+);', re.MULTILINE)
RE_D_TYPE = re.compile(
    r'^[ \t]*(?:' + _D_MOD + r'\s+)*'
    r'(?P<kind>class|struct|interface|union|enum)\s+(?P<name>[A-Za-z_]\w*)'
    r'(?P<rest>[^{;]*)',
    re.MULTILINE)
RE_D_TEMPLATE = re.compile(
    r'^[ \t]*(?:' + _D_MOD + r'\s+)*template\s+(?P<name>[A-Za-z_]\w*)',
    re.MULTILINE)
RE_D_FUNC = re.compile(
    r'^[ \t]*(?:' + _D_MOD + r'\s+)*'
    r'(?:[A-Za-z_][\w.!]*(?:\([^)]*\))?[\s*\[\]]+)+'   # return type token(s)
    r'(?P<name>[A-Za-z_]\w*)\s*'
    r'(?:\([^)]*\)\s*)?'                                # optional template params
    r'\([^;{}]*\)\s*'                                   # runtime params
    r'(?:(?:const|nothrow|pure|immutable|inout|shared|return|scope|@[\w.]+)\s*)*'
    r'\{',
    re.MULTILINE)
RE_D_CALL = re.compile(r'\b([A-Za-z_]\w*)\s*\(')
_RE_D_BRANCH_KW = re.compile(r'\b(?:if|while|for|foreach|switch|case|catch)\b')


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _mask_d(src: str, mask_literals: bool = False) -> str:
    """Mask comments (always) and literals (optional), preserving offsets.
    Handles //, non-nesting /* */, NESTED /+ +/, "...", `...`, r"...", 'c'."""
    out = list(src)
    i, n = 0, len(src)

    def blank(a, b):
        for j in range(a, min(b, n)):
            if out[j] != '\n':
                out[j] = ' '

    def prev_is_ident(idx):
        return idx > 0 and (src[idx - 1].isalnum() or src[idx - 1] == '_')

    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ''
        if c == '/' and nxt == '/':
            start = i
            while i < n and src[i] != '\n':
                i += 1
            blank(start, i)
            continue
        if c == '/' and nxt == '*':
            start = i
            i += 2
            while i + 1 < n and not (src[i] == '*' and src[i + 1] == '/'):
                i += 1
            i = i + 2 if i + 1 < n else n
            blank(start, i)
            continue
        if c == '/' and nxt == '+':                  # nested /+ +/
            start = i
            i += 2
            depth = 1
            while i + 1 < n and depth > 0:
                if src[i] == '/' and src[i + 1] == '+':
                    depth += 1
                    i += 2
                    continue
                if src[i] == '+' and src[i + 1] == '/':
                    depth -= 1
                    i += 2
                    continue
                i += 1
            if depth > 0:
                i = n
            blank(start, i)
            continue
        if c == 'r' and nxt == '"' and not prev_is_ident(i):   # r"..." wysiwyg
            start = i
            i += 2
            while i < n and src[i] != '"':
                i += 1
            i += 1 if i < n else 0
            if mask_literals:
                blank(start, i)
            continue
        if c == '`':                                  # `...` wysiwyg
            start = i
            i += 1
            while i < n and src[i] != '`':
                i += 1
            i += 1 if i < n else 0
            if mask_literals:
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
            if mask_literals:
                blank(start, i)
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
                blank(start, i)
            continue
        i += 1
    return ''.join(out)


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


def _enclosing(ranges, idx):
    best, best_span = None, None
    for start, end, name in ranges:
        if start <= idx < end:
            span = end - start
            if best_span is None or span < best_span:
                best_span, best = span, name
    return best


def _is_private(clean: str, decl_start: int) -> bool:
    line_start = clean.rfind('\n', 0, decl_start) + 1
    prefix = clean[line_start:decl_start]
    return bool(re.search(r'\b(?:private|protected|package)\b', prefix))


def _parse_bases(rest: str) -> list:
    m = re.search(r':\s*(.+)', rest)
    if not m:
        return []
    bases = []
    for part in m.group(1).split(','):
        name = part.strip().split('!')[0].strip().split('.')[-1]
        if name and name not in D_KEYWORDS:
            bases.append(name)
    return list(dict.fromkeys(bases))


def _extract_calls(text: str, base: int = 0, skip_starts=None) -> list:
    skip_starts = skip_starts or set()
    calls = []
    for m in RE_D_CALL.finditer(text):
        name = m.group(1)
        if (base + m.start(1)) in skip_starts:
            continue
        if name in D_KEYWORDS or len(name) < 2:
            continue
        calls.append(name)
    return calls


def _complexity(body: str) -> int:
    if not body:
        return 1
    count = 1 + len(_RE_D_BRANCH_KW.findall(body))
    count += body.count('&&') + body.count('||')
    return count


def _parse_imports(import_src: str) -> list:
    refs = []
    for m in RE_D_IMPORT.finditer(import_src):
        body = m.group(1)
        # `import a.b : sym;` -> keep module path before ':'
        body = body.split(':', 1)[0]
        for chunk in body.split(','):
            tok = chunk.strip()
            if '=' in tok:                       # `alias = a.b.c`
                tok = tok.split('=', 1)[1].strip()
            seg = tok.split('.')[-1].strip()
            if seg and seg not in D_KEYWORDS and len(seg) >= 2:
                refs.append(seg)
    return list(dict.fromkeys(refs))


def scan_d(src: str, ext: str = '.d') -> tuple:
    """D file analysis. Returns the standard VIZCODE 6-tuple."""
    import_src = _mask_d(src, mask_literals=False)
    clean = _mask_d(src, mask_literals=True)

    imports = _parse_imports(import_src)
    mod = RE_D_MODULE.search(import_src)
    package = mod.group(1) if mod else ''

    symbol_defs = []
    ranges = []
    seen = set()
    decl_name_starts = set()

    def add_type(kind, name, start, end_idx, bases, priv):
        if name in seen:
            return
        seen.add(name)
        decl_name_starts.add(start)
        ranges.append((start, end_idx, name))
        symbol_defs.append({
            'kind': 'struct' if kind == 'union' else kind, 'name': name,
            'line': _line_no(src, start),
            'end_line': _line_no(src, max(start, end_idx - 1)),
            'bases': bases, 'parent': None, 'is_public': not priv, 'doc': None,
        })

    for m in RE_D_TYPE.finditer(clean):
        name = m.group('name')
        if name in D_KEYWORDS or len(name) < 2:
            continue
        start = m.start('name')
        open_idx = clean.find('{', m.end())
        end_idx = _brace_range(clean, open_idx) if open_idx != -1 else m.end()
        add_type(m.group('kind'), name, start, end_idx,
                 _parse_bases(m.group('rest')), _is_private(clean, start))

    for m in RE_D_TEMPLATE.finditer(clean):
        name = m.group('name')
        if name in D_KEYWORDS or len(name) < 2:
            continue
        start = m.start('name')
        open_idx = clean.find('{', m.end())
        end_idx = _brace_range(clean, open_idx) if open_idx != -1 else m.end()
        add_type('template', name, start, end_idx, [], _is_private(clean, start))

    funcdefs = []
    func_calls_by_func = []
    method_symbols = []
    seen_fn = set()
    for m in RE_D_FUNC.finditer(clean):
        name = m.group('name')
        if name in D_KEYWORDS or len(name) < 2:
            continue
        start = m.start('name')
        key = (name, _line_no(src, start))
        if key in seen_fn:
            continue
        seen_fn.add(key)
        decl_name_starts.add(start)
        open_idx = clean.rfind('{', start, m.end())
        end_idx = _brace_range(clean, open_idx)
        body = clean[open_idx + 1:end_idx - 1]
        end_line = _line_no(src, end_idx - 1)
        parent = _enclosing(ranges, start)
        funcdefs.append({'label': name, 'is_efiapi': False,
                         'is_static': False})
        func_calls_by_func.append(
            _extract_calls(body, base=open_idx + 1, skip_starts=decl_name_starts))
        method_symbols.append({
            'kind': 'method' if parent else 'function', 'name': name,
            'line': _line_no(src, start), 'end_line': end_line, 'bases': [],
            'parent': parent, 'is_public': not _is_private(clean, start),
            'doc': None, 'complexity': _complexity(body),
        })

    symbol_defs += method_symbols
    all_calls = _extract_calls(clean, skip_starts=decl_name_starts)
    extra = {'imports': imports, 'lang': 'd'}
    if package:
        extra['package'] = package

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs
