#!/usr/bin/env python3
"""
parsers/csharp_parser.py - VizCode C# parser

Dependency-free C# parser focused on imports/usings, type symbols, methods,
constructors, and call relationships. It uses lexical masking so comments and
string-like literals do not create fake parser results.
"""

import re


CSHARP_EXTENSIONS = {'.cs'}

CSHARP_KEYWORDS = {
    'abstract', 'as', 'base', 'bool', 'break', 'byte', 'case', 'catch',
    'char', 'checked', 'class', 'const', 'continue', 'decimal', 'default',
    'delegate', 'do', 'double', 'else', 'enum', 'event', 'explicit',
    'extern', 'false', 'finally', 'fixed', 'float', 'for', 'foreach',
    'goto', 'if', 'implicit', 'in', 'int', 'interface', 'internal', 'is',
    'lock', 'long', 'namespace', 'new', 'null', 'object', 'operator', 'out',
    'override', 'params', 'private', 'protected', 'public', 'readonly',
    'record', 'ref', 'return', 'sbyte', 'sealed', 'short', 'sizeof',
    'stackalloc', 'static', 'string', 'struct', 'switch', 'this', 'throw',
    'true', 'try', 'typeof', 'uint', 'ulong', 'unchecked', 'unsafe',
    'ushort', 'using', 'virtual', 'void', 'volatile', 'while', 'async',
    'await', 'var', 'dynamic', 'partial', 'file', 'required', 'init',
    'get', 'set', 'add', 'remove', 'value', 'nameof',
    'Console', 'Math', 'String', 'Task', 'List', 'Dictionary',
}

CSHARP_INVALID_RETURN_WORDS = {
    'await', 'return', 'throw', 'if', 'for', 'foreach', 'while', 'switch',
    'catch', 'using', 'lock', 'new',
}

RE_USING = re.compile(
    r'^[ \t]*(?:global[ \t]+)?using[ \t]+(?:static[ \t]+)?'
    r'(?:(?:[A-Za-z_]\w*)[ \t]*=[ \t]*)?([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)[ \t]*;',
    re.MULTILINE,
)
RE_NAMESPACE = re.compile(r'^[ \t]*namespace[ \t]+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)[ \t]*(?:[;{])', re.MULTILINE)
RE_TYPE = re.compile(
    r'^[ \t]*(?:(?:public|private|protected|internal|file|static|abstract|sealed|partial|unsafe|new)\s+)*'
    r'(?:(record)\s+)?(class|struct|interface|enum|record)\s+([A-Za-z_]\w*)'
    r'(?:\s*<[^;{}]*>)?(?:\s*\([^;{}]*\))?(?:\s*:\s*([^{;]+))?\s*(?:\{|;)',
    re.MULTILINE,
)
RE_METHOD = re.compile(
    r'^[ \t]*(?:(?:public|private|protected|internal|static|virtual|override|sealed|abstract|extern|async|unsafe|new|partial|readonly)\s+)*'
    r'(?:ref\s+(?:readonly\s+)?)?'
    r'(?P<ret>[A-Za-z_]\w*(?:[.<>,?\[\]\s]*[A-Za-z_]\w*)*|void)\s+'
    r'(?P<name>(?:[A-Za-z_]\w*\.)?[A-Za-z_]\w*)\s*'
    r'(?:<[^;{}()]*>)?\([^;{}()]*\)\s*'
    r'(?:where\s+[^{;=]+)?(?P<body>\{|=>|;)',
    re.MULTILINE,
)
RE_CONSTRUCTOR = re.compile(
    r'^[ \t]*(?:(?:public|private|protected|internal|static|extern|unsafe)\s+)*'
    r'(?P<name>[A-Za-z_]\w*)\s*\([^;{}()]*\)\s*(?::\s*(?:base|this)\s*\([^)]*\)\s*)?(?P<body>\{|=>|;)',
    re.MULTILINE,
)
RE_PROPERTY = re.compile(
    r'^[ \t]*(?:(?:public|private|protected|internal|static|virtual|override|sealed|abstract|readonly|required|new)\s+)*'
    r'[A-Za-z_]\w*(?:[.<>,?\[\]\s]*[A-Za-z_]\w*)*\s+([A-Za-z_]\w*)\s*\{[ \t]*(?:get|set|init)\b',
    re.MULTILINE,
)
RE_CALL = re.compile(r'\b([A-Za-z_]\w*)\s*\(')


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


def _mask_csharp_source(src: str) -> str:
    """Mask comments and C# string/char literals preserving offsets."""
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

        raw = _raw_string_start(src, i)
        if raw is not None:
            start, quote_idx, quote_count = raw
            delim = '"' * quote_count
            body_start = quote_idx + quote_count
            end = src.find(delim, body_start)
            i = end + quote_count if end != -1 else n
            _blank(out, start, i)
            continue

        string_start = _regular_or_verbatim_string_start(src, i)
        if string_start is not None:
            start, quote_idx, verbatim = string_start
            i = quote_idx + 1
            while i < n:
                if verbatim:
                    if src[i] == '"' and i + 1 < n and src[i + 1] == '"':
                        i += 2
                        continue
                    if src[i] == '"':
                        i += 1
                        break
                    i += 1
                    continue
                if src[i] == '\\':
                    i += 2
                    continue
                ch = src[i]
                i += 1
                if ch == '"':
                    break
            _blank(out, start, i)
            continue

        if c == "'":
            start = i
            i += 1
            while i < n:
                if src[i] == '\\':
                    i += 2
                    continue
                ch = src[i]
                i += 1
                if ch == "'":
                    break
            _blank(out, start, i)
            continue

        i += 1

    return ''.join(out)


def _raw_string_start(src: str, i: int):
    j = i
    while j < len(src) and src[j] == '$':
        j += 1
    if src[j:j + 3] != '"""':
        return None
    k = j
    while k < len(src) and src[k] == '"':
        k += 1
    return i, j, k - j


def _regular_or_verbatim_string_start(src: str, i: int):
    prefixes = ('$@"', '@$"', '@"', '$"', '"')
    for prefix in prefixes:
        if src.startswith(prefix, i):
            quote_idx = i + len(prefix) - 1
            return i, quote_idx, '@' in prefix
    return None


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


def _end_line(masked: str, open_idx: int, line: int) -> int:
    close_idx = _find_matching_brace(masked, open_idx)
    if close_idx == -1:
        return line
    return line + masked[open_idx:close_idx + 1].count('\n')


def _ref_name(path: str) -> str:
    return path.split('.')[-1]


def _base_names(raw: str | None) -> list:
    if not raw:
        return []
    bases = []
    for part in raw.split(','):
        part = re.sub(r'<.*>', '', part).strip()
        name = part.split('.')[-1].strip()
        if name and name not in CSHARP_KEYWORDS:
            bases.append(name)
    return bases


def _type_ranges(src: str, masked: str) -> list:
    ranges = []
    for m in RE_TYPE.finditer(masked):
        name = m.group(3)
        kind = 'record' if m.group(1) or m.group(2) == 'record' else m.group(2)
        line = src[:m.start()].count('\n') + 1
        open_idx = masked.find('{', m.end() - 1)
        close_idx = _find_matching_brace(masked, open_idx) if open_idx != -1 else m.end()
        ranges.append({
            'kind': kind,
            'name': name,
            'start': m.start(),
            'open': open_idx,
            'end': close_idx if close_idx != -1 else m.end(),
            'line': line,
            'bases': _base_names(m.group(4)),
        })
    return ranges


def _nearest_type(type_ranges: list, pos: int):
    containing = [t for t in type_ranges if t['start'] <= pos <= t['end']]
    if not containing:
        return None
    return max(containing, key=lambda t: t['start'])


def _call_names(text: str) -> list:
    calls = []
    for m in RE_CALL.finditer(text):
        name = m.group(1)
        line_start = text.rfind('\n', 0, m.start()) + 1
        prefix = text[line_start:m.start()]
        if re.search(r'\b(?:class|struct|interface|enum|record|delegate|event|namespace)\b', prefix):
            continue
        if name not in CSHARP_KEYWORDS and len(name) >= 2:
            calls.append(name)
    return calls


def _member_matches(masked: str, type_ranges: list) -> list:
    prop_names = {m.group(1) for m in RE_PROPERTY.finditer(masked)}
    matches = []
    spans = []
    for pat in (RE_METHOD, RE_CONSTRUCTOR):
        for m in pat.finditer(masked):
            name = m.group('name').split('.')[-1]
            if name in CSHARP_KEYWORDS or name in prop_names or len(name) < 2:
                continue
            if pat is RE_METHOD and (m.group('ret') or '').strip() in CSHARP_INVALID_RETURN_WORDS:
                continue
            nearest = _nearest_type(type_ranges, m.start())
            if pat is RE_CONSTRUCTOR and nearest and nearest['start'] == m.start():
                continue
            if pat is RE_CONSTRUCTOR and (not nearest or nearest['name'] != name):
                continue
            if pat is RE_METHOD and nearest and nearest['name'] == name:
                continue
            if any(not (m.end() <= a or m.start() >= b) for a, b in spans):
                continue
            spans.append((m.start(), m.end()))
            matches.append(m)
    matches.sort(key=lambda item: item.start())
    return matches


def _symbol_defs(src: str, masked: str, type_ranges: list, member_matches: list) -> list:
    symbols = []
    for t in type_ranges:
        symbols.append({
            'kind': t['kind'],
            'name': t['name'],
            'line': t['line'],
            'end_line': _end_line(masked, t['open'], t['line']) if t['open'] != -1 else t['line'],
            'bases': t['bases'],
            'parent': None,
            'is_public': not t['name'].startswith('_'),
        })

    seen = set()
    for m in member_matches:
        name = m.group('name').split('.')[-1]
        t = _nearest_type(type_ranges, m.start())
        parent = t['name'] if t else None
        line = src[:m.start()].count('\n') + 1
        body_token = m.group('body')
        open_idx = masked.find('{', m.end() - 1) if body_token == '{' else -1
        key = (parent, name, line)
        if key in seen:
            continue
        seen.add(key)
        symbols.append({
            'kind': 'method' if parent else 'function',
            'name': name,
            'line': line,
            'end_line': _end_line(masked, open_idx, line) if open_idx != -1 else line,
            'bases': [],
            'parent': parent,
            'is_public': not name.startswith('_'),
        })
    symbols.sort(key=lambda item: (item.get('line', 0), item.get('kind', ''), item.get('name', '')))
    return symbols


def scan_csharp(src: str, ext: str = '.cs') -> tuple:
    """Return the standard VizCode 6-tuple for C# source."""
    masked = _mask_csharp_source(src)
    imports = _dedupe(_ref_name(m.group(1)) for m in RE_USING.finditer(masked))
    type_ranges = _type_ranges(src, masked)
    member_matches = _member_matches(masked, type_ranges)

    funcdefs = []
    func_calls_by_func = []
    for m in member_matches:
        name = m.group('name').split('.')[-1]
        header = masked[m.start():m.end()]
        funcdefs.append({
            'label': name,
            'is_efiapi': False,
            'is_static': bool(re.search(r'\b(private|static)\b', header)),
        })
        if m.group('body') != '{':
            func_calls_by_func.append([])
            continue
        open_idx = masked.find('{', m.end() - 1)
        close_idx = _find_matching_brace(masked, open_idx)
        body = masked[open_idx + 1:close_idx] if close_idx > open_idx else ''
        func_calls_by_func.append(_call_names(body))

    call_source = list(masked)
    for m in member_matches:
        end = masked.find('{', m.end() - 1)
        if end == -1:
            end = m.end()
        else:
            end += 1
        _blank(call_source, m.start(), end)
    funccalls = _dedupe(_call_names(''.join(call_source)))
    symbols = _symbol_defs(src, masked, type_ranges, member_matches)
    extra = {'lang': 'csharp', 'namespaces': _dedupe(m.group(1) for m in RE_NAMESPACE.finditer(masked))}
    return imports, funcdefs, funccalls, extra, func_calls_by_func, symbols
