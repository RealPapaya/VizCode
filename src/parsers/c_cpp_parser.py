#!/usr/bin/env python3
"""
parsers/c_cpp_parser.py - VizCode C / C++ parser

Extracts includes, function definitions, call sites, and C/C++ symbols.
The parser is intentionally dependency-free and uses conservative lexical
masking before regex extraction so comments and literals do not create fake
dependencies or calls.
"""

import re


C_CPP_EXTENSIONS = {
    '.c', '.cpp', '.cc', '.cxx',
    '.h', '.hpp', '.hh', '.hxx',
}

C_KEYWORDS = {
    'alignas', 'alignof', 'and', 'and_eq', 'asm', 'auto', 'bitand', 'bitor',
    'bool', 'break', 'case', 'catch', 'char', 'char8_t', 'char16_t',
    'char32_t', 'class', 'compl', 'concept', 'const', 'consteval',
    'constexpr', 'constinit', 'const_cast', 'continue', 'co_await',
    'co_return', 'co_yield', 'decltype', 'default', 'delete', 'do', 'double',
    'dynamic_cast', 'else', 'enum', 'explicit', 'export', 'extern', 'false',
    'float', 'for', 'friend', 'goto', 'if', 'inline', 'int', 'long',
    'mutable', 'namespace', 'new', 'noexcept', 'not', 'not_eq', 'nullptr',
    'operator', 'or', 'or_eq', 'private', 'protected', 'public', 'register',
    'reinterpret_cast', 'requires', 'return', 'short', 'signed', 'sizeof',
    'static', 'static_assert', 'static_cast', 'struct', 'switch', 'template',
    'this', 'thread_local', 'throw', 'true', 'try', 'typedef', 'typeid',
    'typename', 'union', 'unsigned', 'using', 'virtual', 'void', 'volatile',
    'wchar_t', 'while', 'xor', 'xor_eq',
    'EFIAPI', 'EFI_STATUS', 'IN', 'OUT', 'OPTIONAL', 'VOID', 'UINTN', 'INTN',
    'UINT8', 'UINT16', 'UINT32', 'UINT64', 'BOOLEAN', 'TRUE', 'FALSE', 'NULL',
    'printf', 'sprintf', 'snprintf', 'fprintf', 'memset', 'memcpy', 'memcmp',
    'strlen', 'strcmp', 'strncmp', 'malloc', 'calloc', 'realloc', 'free',
}

# ─── L3 type_usage support: builtin / primitive types to exclude ─────────────
# Names here never become `type_usage` edges. Includes C/C++ scalars and the
# common UEFI scalar typedefs. User types (PascalCase / CamelCase) survive.
C_TYPE_BUILTINS = frozenset({
    'int', 'char', 'short', 'long', 'float', 'double', 'void', 'bool',
    'unsigned', 'signed', 'size_t', 'ssize_t', 'intptr_t', 'uintptr_t',
    'int8_t', 'int16_t', 'int32_t', 'int64_t',
    'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'wchar_t',
    # common UEFI scalars
    'UINTN', 'INTN', 'UINT8', 'UINT16', 'UINT32', 'UINT64',
    'INT8', 'INT16', 'INT32', 'INT64', 'BOOLEAN', 'CHAR8', 'CHAR16',
    'VOID', 'EFI_STATUS',
})

# ─── L1 edge_hints: asset/config file references from string literals ─────────
_CONFIG_EXTS = {'.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env'}
_ASSET_EXTS = {'.html', '.htm', '.css', '.scss', '.sass', '.less', '.svg', '.png',
               '.jpg', '.jpeg', '.gif', '.csv', '.sql', '.xml'}

RE_INCLUDE = re.compile(r'^[ \t]*#[ \t]*include[ \t]+[<"]([^>"]+)[>"]')
RE_CALL = re.compile(r'\b([A-Za-z_]\w*)\s*\(')
RE_STATIC = re.compile(r'\bstatic\b')
# Branch keywords / operators counted for cyclomatic complexity.
RE_COMPLEXITY = re.compile(r'\b(?:if|for|while|case)\b|&&|\|\||\?')
# Type-identifier extractor (after stripping pointers/refs/const/templates).
RE_TYPE_IDENT = re.compile(r'[A-Za-z_]\w*')
# fopen("x.json", ...) / std::ifstream("x.csv") style explicit file references.
# Captures the call/marker name and the first quoted string literal argument.
RE_FILE_REF = re.compile(
    r'\b(fopen|freopen|ifstream|ofstream|fstream|open)\s*\(\s*"([^"\n]+)"',
)
RE_TEMPLATE_PREFIX = re.compile(r'^[ \t]*template\s*<[^;{}]*>\s*$', re.MULTILINE)
RE_CLASS = re.compile(
    r'^[ \t]*(?:template\s*<[^;{}]*>\s*)?'
    r'(class|struct|union)\s+([A-Za-z_]\w*)'
    r'(?:\s*:\s*([^{;]+))?\s*(?:\{|;)',
    re.MULTILINE,
)
RE_ENUM = re.compile(
    r'^[ \t]*(?:typedef\s+)?enum(?:\s+class|\s+struct)?\s*([A-Za-z_]\w*)?\s*\{',
    re.MULTILINE,
)
RE_TYPEDEF_COMPOUND = re.compile(
    r'\btypedef\s+(?:struct|union|enum)(?:\s+[A-Za-z_]\w*)?\s*\{[^{}]*\}\s*([A-Za-z_]\w*)\s*;',
    re.DOTALL,
)
RE_FUNCTION = re.compile(
    r'^[ \t]*(?:template\s*<[^;{}]*>\s*)?'
    r'(?P<prefix>(?:(?:extern\s+"C"\s+)?(?:static|inline|constexpr|consteval|virtual|explicit|friend|extern|EFIAPI)\s+)*)'
    r'(?P<ret>[~A-Za-z_][\w:<>~,\s*&\[\]]*?)\s+'
    r'(?P<name>(?:[A-Za-z_]\w*::)*~?[A-Za-z_]\w*)\s*'
    r'\([^;{}()]*\)\s*'
    r'(?:const\s*)?(?:noexcept(?:\s*\([^)]*\))?\s*)?(?:override\s*)?(?:final\s*)?'
    r'(?:->[^{;]+)?\{',
    re.MULTILINE,
)
RE_CONSTRUCTOR = re.compile(
    r'^[ \t]*(?:template\s*<[^;{}]*>\s*)?'
    r'(?P<prefix>(?:(?:explicit|inline|constexpr|consteval)\s+)*)'
    r'(?P<name>(?:[A-Za-z_]\w*::)*~?[A-Za-z_]\w*)\s*'
    r'\([^;{}()]*\)\s*(?::[^{;]*)?\{',
    re.MULTILINE,
)


def _dedupe(values: list) -> list:
    seen = set()
    out = []
    for value in values:
        if value and value not in seen:
            seen.add(value)
            out.append(value)
    return out


def _blank(out: list, start: int, end: int) -> None:
    for idx in range(start, min(end, len(out))):
        if out[idx] not in '\r\n':
            out[idx] = ' '


def _mask_c_cpp_source(src: str) -> str:
    """Mask comments and literals while preserving offsets and newlines."""
    out = list(src)
    i = 0
    n = len(src)

    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ''

        if c == '/' and nxt == '/':
            start = i
            i += 2
            while i < n and src[i] not in '\r\n':
                i += 1
            _blank(out, start, i)
            continue

        if c == '/' and nxt == '*':
            start = i
            i += 2
            while i + 1 < n and not (src[i] == '*' and src[i + 1] == '/'):
                i += 1
            i = i + 2 if i + 1 < n else n
            _blank(out, start, i)
            continue

        raw_start = _raw_string_start(src, i)
        if raw_start is not None:
            start, body_start, delim = raw_start
            end_marker = ')' + delim + '"'
            end = src.find(end_marker, body_start)
            i = end + len(end_marker) if end != -1 else n
            _blank(out, start, i)
            continue

        if c in ('"', "'"):
            start = i
            quote = c
            i += 1
            while i < n:
                if src[i] == '\\':
                    i += 2
                    continue
                ch = src[i]
                i += 1
                if ch == quote:
                    break
            _blank(out, start, i)
            continue

        i += 1

    return ''.join(out)


def _raw_string_start(src: str, i: int):
    """Return (literal_start, body_start, delimiter) for C++ raw strings."""
    j = i
    while j < len(src) and src[j] in 'uULR8':
        j += 1
    prefix = src[i:j]
    if 'R' not in prefix or j >= len(src) or src[j] != '"':
        return None
    paren = src.find('(', j + 1, j + 18)
    if paren == -1:
        return None
    delim = src[j + 1:paren]
    if any(ch in delim for ch in ' ()\\\t\r\n'):
        return None
    return i, paren + 1, delim


def _line_offsets(src: str) -> list:
    offsets = []
    pos = 0
    for line in src.splitlines(keepends=True):
        offsets.append((pos, line))
        pos += len(line)
    if not offsets and src == '':
        return []
    return offsets


def _extract_includes(src: str, masked: str) -> list:
    refs = []
    original_lines = _line_offsets(src)
    masked_lines = masked.splitlines(keepends=True)
    for idx, (_, original) in enumerate(original_lines):
        masked_line = masked_lines[idx] if idx < len(masked_lines) else ''
        if not re.match(r'^[ \t]*#[ \t]*include\b', masked_line):
            continue
        m = RE_INCLUDE.match(original)
        if m:
            refs.append(m.group(1))
    return _dedupe(refs)


def _find_matching_brace(masked: str, open_idx: int) -> int:
    depth = 0
    for idx in range(open_idx, len(masked)):
        ch = masked[idx]
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return idx
    return -1


def _end_line(masked: str, open_idx: int, start_line: int) -> int:
    close_idx = _find_matching_brace(masked, open_idx)
    if close_idx == -1:
        return start_line
    return start_line + masked[open_idx:close_idx + 1].count('\n')


def _base_names(raw: str | None) -> list:
    if not raw:
        return []
    bases = []
    for part in raw.split(','):
        part = re.sub(r'\b(public|private|protected|virtual)\b', ' ', part).strip()
        part = re.sub(r'<.*>', '', part).strip()
        name = part.split('::')[-1].strip()
        if name and name not in C_KEYWORDS:
            bases.append(name)
    return bases


def _simple_name(name: str) -> str:
    return name.split('::')[-1]


def _parent_name(name: str) -> str | None:
    if '::' not in name:
        return None
    parts = name.split('::')
    if len(parts) >= 2:
        return parts[-2].lstrip('~')
    return None


def _call_names(text: str) -> list:
    calls = []
    for m in RE_CALL.finditer(text):
        name = m.group(1)
        line_start = text.rfind('\n', 0, m.start()) + 1
        prefix = text[line_start:m.start()]
        if re.search(r'\b(?:class|struct|union|enum|typedef)\b', prefix):
            continue
        if name not in C_KEYWORDS and len(name) >= 2:
            calls.append(name)
    return calls


def _classify_ref(ref: str):
    """Return 'config_ref' / 'asset_ref' for a known file extension, else None."""
    if not ref or '\n' in ref:
        return None
    base = ref.split('?')[0].split('#')[0].strip()
    dot = base.rfind('.')
    if dot < 0:
        return None
    ext = base[dot:].lower()
    if ext in _CONFIG_EXTS:
        return 'config_ref'
    if ext in _ASSET_EXTS:
        return 'asset_ref'
    return None


def _collect_edge_hints(src: str, masked: str) -> list:
    """Extract very explicit file references from fopen/ifstream string literals.

    Operates over the ORIGINAL source so the literal text survives; the masked
    source is only used to confirm the match isn't inside a comment/string by
    checking the call name token is still present there.
    """
    hints = []
    for m in RE_FILE_REF.finditer(src):
        # Confirm the call site is real code (not commented out): the marker
        # name must still be present at the same offset in the masked source.
        if masked[m.start(1):m.end(1)] != m.group(1):
            continue
        target = m.group(2).strip()
        etype = _classify_ref(target)
        if not etype:
            continue
        line = src[:m.start()].count('\n') + 1
        hints.append({
            'type': etype,
            'target': target,
            'via': m.group(1),
            'line': line,
            'origin': 'parser',
            'confidence': 'high',
        })
    return hints


def _base_type_idents(type_str: str) -> list:
    """Reduce a C/C++ type expression to its base user-type identifiers.

    Strips pointers/refs (`*`, `&`), const/volatile and other type qualifiers,
    and template argument identifiers are pulled out too (e.g. ``std::vector<Foo>``
    yields ``Foo``). Builtins and short/lowercase names are filtered by the
    caller via :func:`_filter_type_refs`.
    """
    if not type_str:
        return []
    out = []
    for ident in RE_TYPE_IDENT.findall(type_str):
        out.append(ident.split('::')[-1] if '::' in ident else ident)
    return out


def _filter_type_refs(names) -> list:
    """Keep only plausible user-defined type names (PascalCase/CamelCase, ≥3)."""
    out = []
    seen = set()
    for name in names:
        if not name or len(name) < 3 or name in seen:
            continue
        if name in C_KEYWORDS or name in C_TYPE_BUILTINS:
            continue
        # Require a leading uppercase letter (PascalCase / CamelCase user types).
        # Excludes lowercase builtins (int, char) and most local identifiers.
        if not name[0].isupper():
            continue
        seen.add(name)
        out.append(name)
    return sorted(out)


def _param_clause(masked: str, name_end: int):
    """Return (clause_text, after_idx) for the (...) parameter list at name_end.

    ``name_end`` is the offset just past the function name. Scans the masked
    source for the matching outer parenthesis. Returns ('', name_end) on failure.
    """
    open_idx = masked.find('(', name_end)
    if open_idx == -1:
        return '', name_end
    depth = 0
    for idx in range(open_idx, len(masked)):
        ch = masked[idx]
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
            if depth == 0:
                return masked[open_idx + 1:idx], idx + 1
    return '', name_end


def _split_params(clause: str) -> list:
    """Split a parameter clause on top-level commas (ignoring template/paren depth)."""
    params = []
    depth = 0
    cur = []
    for ch in clause:
        if ch in '(<[':
            depth += 1
        elif ch in ')>]':
            depth -= 1
        if ch == ',' and depth == 0:
            params.append(''.join(cur))
            cur = []
        else:
            cur.append(ch)
    if ''.join(cur).strip():
        params.append(''.join(cur))
    return params


def _func_signature(ret: str, clause: str) -> str:
    """Build a compact "(params) -> ret" signature string."""
    clause = ' '.join(clause.split())
    sig = f'({clause})'
    ret = ' '.join((ret or '').split()).strip()
    if ret and ret not in ('', '~'):
        sig += f' -> {ret}'
    return sig


def _func_complexity(body: str) -> int:
    """Cyclomatic-style branch count over a (comment-masked) function body."""
    return 1 + len(RE_COMPLEXITY.findall(body))


def _func_type_refs(ret: str, clause: str) -> list:
    """Collect user-type identifiers from a function's return type and params."""
    names = []
    names.extend(_base_type_idents(ret or ''))
    for param in _split_params(clause):
        # Drop a trailing parameter NAME (and default value) — keep only the type
        # portion. Heuristic: the last identifier before '=' / end is the param
        # name when there are >=2 identifiers; everything earlier is the type.
        seg = param.split('=')[0]
        idents = _base_type_idents(seg)
        if len(idents) >= 2:
            idents = idents[:-1]  # strip param name
        names.extend(idents)
    return _filter_type_refs(names)


def _field_type_refs(class_body: str) -> list:
    """Collect user-type identifiers from a class/struct member field declarations.

    Conservative line-oriented scan over the masked class body: a field decl is a
    statement ending in ';' that is not a function (no '(' before the ';') and not
    a nested type definition. The first token(s) form the type, the last the name.
    """
    names = []
    for raw_stmt in class_body.split(';'):
        stmt = raw_stmt.strip()
        if not stmt or '(' in stmt or '{' in stmt or '}' in stmt:
            continue
        # Skip access specifiers / using / typedef lines.
        first = stmt.split()[0] if stmt.split() else ''
        if first in ('public', 'private', 'protected', 'using', 'typedef',
                     'friend', 'return', 'template'):
            continue
        seg = stmt.split('=')[0]
        idents = _base_type_idents(seg)
        if len(idents) >= 2:
            idents = idents[:-1]  # strip the field name token
        names.extend(idents)
    return _filter_type_refs(names)


def _function_matches(masked: str) -> list:
    matches = []
    spans = []
    for pat in (RE_FUNCTION, RE_CONSTRUCTOR):
        for m in pat.finditer(masked):
            name = _simple_name(m.group('name'))
            if name.startswith('~'):
                name = name[1:]
            if name in C_KEYWORDS or len(name) < 2:
                continue
            if any(not (m.end() <= a or m.start() >= b) for a, b in spans):
                continue
            spans.append((m.start(), m.end()))
            matches.append(m)
    matches.sort(key=lambda item: item.start())
    return matches


def _extract_symbols(src: str, masked: str, func_matches: list) -> list:
    symbols = []
    seen = set()

    for m in RE_CLASS.finditer(masked):
        kind, name, bases = m.group(1), m.group(2), m.group(3)
        if name in C_KEYWORDS or name in seen:
            continue
        seen.add(name)
        line = src[:m.start()].count('\n') + 1
        open_idx = masked.find('{', m.end() - 1)
        # Member field types feed type_usage edges (bases stay in 'bases').
        type_refs = []
        if open_idx != -1:
            close_idx = _find_matching_brace(masked, open_idx)
            if close_idx > open_idx:
                type_refs = _field_type_refs(masked[open_idx + 1:close_idx])
        symbols.append({
            'kind': 'class' if kind == 'class' else kind,
            'name': name,
            'line': line,
            'end_line': _end_line(masked, open_idx, line) if open_idx != -1 else line,
            'bases': _base_names(bases),
            'parent': None,
            'is_public': not name.startswith('_'),
            'decorators': [],
            'type_refs': type_refs,
        })

    for m in RE_TYPEDEF_COMPOUND.finditer(masked):
        name = m.group(1)
        if name in C_KEYWORDS or name in seen:
            continue
        seen.add(name)
        line = src[:m.start()].count('\n') + 1
        symbols.append({
            'kind': 'typedef', 'name': name,
            'line': line, 'end_line': line,
            'bases': [], 'parent': None,
            'is_public': not name.startswith('_'),
        })

    for m in RE_ENUM.finditer(masked):
        name = m.group(1)
        if not name or name in C_KEYWORDS or name in seen:
            continue
        seen.add(name)
        line = src[:m.start()].count('\n') + 1
        open_idx = masked.find('{', m.end() - 1)
        symbols.append({
            'kind': 'enum', 'name': name,
            'line': line,
            'end_line': _end_line(masked, open_idx, line) if open_idx != -1 else line,
            'bases': [], 'parent': None,
            'is_public': not name.startswith('_'),
        })

    for m in func_matches:
        full_name = m.group('name')
        name = _simple_name(full_name).lstrip('~')
        parent = _parent_name(full_name)
        line = src[:m.start()].count('\n') + 1
        open_idx = masked.find('{', m.end() - 1)
        prefix = m.groupdict().get('prefix') or ''
        is_static = bool(RE_STATIC.search(prefix))
        ret = m.groupdict().get('ret') or ''
        key = (parent, name, line)
        if key in seen:
            continue
        seen.add(key)
        # Parameter clause + body (masked) drive signature / complexity / type_refs.
        clause, _ = _param_clause(masked, m.end('name'))
        close_idx = _find_matching_brace(masked, open_idx) if open_idx != -1 else -1
        body = masked[open_idx + 1:close_idx] if close_idx > open_idx else ''
        symbols.append({
            'kind': 'method' if parent else 'function',
            'name': name,
            'line': line,
            'end_line': _end_line(masked, open_idx, line) if open_idx != -1 else line,
            'bases': [],
            'parent': parent,
            'is_public': not is_static and not name.startswith('_'),
            'is_static': is_static,
            'decorators': [],
            'signature': _func_signature(ret, clause),
            'complexity': _func_complexity(body),
            'type_refs': _func_type_refs(ret, clause),
        })

    symbols.sort(key=lambda item: (item.get('line', 0), item.get('kind', ''), item.get('name', '')))
    return symbols


def scan_c_cpp(src: str, ext: str = '') -> tuple:
    """Return the standard VizCode 6-tuple for C/C++ source."""
    masked = _mask_c_cpp_source(src)
    imports = _extract_includes(src, masked)
    funcdefs = []
    func_calls_by_func = []
    func_matches = _function_matches(masked)

    for m in func_matches:
        full_name = m.group('name')
        name = _simple_name(full_name).lstrip('~')
        prefix = m.groupdict().get('prefix') or ''
        is_static = bool(RE_STATIC.search(prefix))
        funcdefs.append({
            'label': name,
            'is_efiapi': 'EFIAPI' in prefix,
            'is_static': is_static or name.startswith('_'),
        })
        open_idx = masked.find('{', m.end() - 1)
        close_idx = _find_matching_brace(masked, open_idx) if open_idx != -1 else -1
        body = masked[open_idx + 1:close_idx] if close_idx > open_idx else ''
        func_calls_by_func.append(_call_names(body))

    funccalls = _dedupe(call for calls in func_calls_by_func for call in calls)
    symbol_defs = _extract_symbols(src, masked, func_matches)
    extra = {'lang': 'cpp' if ext.lower() in ('.cpp', '.cc', '.cxx', '.hpp', '.hh', '.hxx') else 'c'}
    edge_hints = _collect_edge_hints(src, masked)
    if edge_hints:
        extra['edge_hints'] = edge_hints
    return imports, funcdefs, funccalls, extra, func_calls_by_func, symbol_defs
