#!/usr/bin/env python3
"""
parsers/go_parser.py - VIZCODE Go Language Parser

Extracts:
  imports             - package paths from 'import' statements
  funcdefs            - function declarations (top-level and methods)
  funccalls           - call expressions
  func_calls_by_func  - per-function call lists (body-scoped via brace matching)
  symbol_defs         - structured symbol table

Go naming convention:
  UpperCase = exported (public)
  lowerCase = unexported (private, shown as 'static' in UI)
"""

import re


# Go keywords / builtins to ignore
GO_KEYWORDS = {
    'if', 'else', 'for', 'range', 'return', 'func', 'var', 'const', 'type',
    'struct', 'interface', 'import', 'package', 'go', 'chan', 'select',
    'case', 'default', 'defer', 'break', 'continue', 'goto', 'fallthrough',
    'switch', 'map', 'make', 'new', 'len', 'cap', 'append', 'copy', 'close',
    'delete', 'panic', 'recover', 'print', 'println', 'true', 'false', 'nil',
    'iota', 'byte', 'rune', 'error', 'string', 'int', 'int8', 'int16',
    'int32', 'int64', 'uint', 'uint8', 'uint16', 'uint32', 'uint64',
    'bool', 'float32', 'float64', 'complex64', 'complex128', 'uintptr',
    'Println', 'Printf', 'Sprintf', 'Errorf', 'Fprintf',
}


# Regex patterns
# Single-line import: import "fmt", import alias "example.com/pkg", import . "math"
RE_GO_IMPORT_SINGLE = re.compile(r'^import\s+(?:[\w.]+\s+)?"([^"]+)"', re.MULTILINE)
# Grouped import: import ( ... )
RE_GO_IMPORT_BLOCK = re.compile(r'import\s*\((.*?)\)', re.DOTALL)
RE_GO_QUOTED = re.compile(r'"([^"]+)"')

# Function declaration:
#   func FuncName(              package-level function
#   func (r *Receiver) Method(  method on a type
RE_GO_FUNCDEF = re.compile(
    r'^func\s+(?:\([^)]*\)\s+)?(\w+)\s*(?:\[[^\]]*\])?\s*\(',
    re.MULTILINE,
)

# Call sites
RE_GO_CALL = re.compile(r'\b([A-Za-z_]\w*)\s*\(')

# Struct / interface declarations
RE_GO_STRUCT = re.compile(r'^type\s+(\w+)\s+struct\s*\{', re.MULTILINE)
RE_GO_INTERFACE = re.compile(r'^type\s+(\w+)\s+interface\s*\{', re.MULTILINE)
# Type alias: type Foo = Bar
RE_GO_TYPE_ALIAS = re.compile(r'^type\s+(\w+)\s*=\s*(\w[\w.]*)', re.MULTILINE)
# New type: type Foo Bar (not struct/interface/func)
RE_GO_TYPE_NEW = re.compile(r'^type\s+(\w+)\s+(\w[\w.]*)\s*$', re.MULTILINE)
# Method with receiver: func (r *Receiver) Method(
RE_GO_METHOD = re.compile(
    r'^func\s+\(\s*(?:\w+\s+)?\*?(?:\w+\.)?(\w+)(?:\[[^\]]+\])?\s*\)\s+'
    r'(\w+)\s*(?:\[[^\]]*\])?\s*\(',
    re.MULTILINE,
)

# Declarations that can receive Go doc comments.
RE_GO_TOP_DECL = re.compile(r'^(?:func|type|var|const)\b', re.MULTILINE)


def _mask_go_source(src: str, mask_literals: bool = False) -> str:
    """Mask Go comments, optionally masking literals, while preserving offsets.

    Go comments are `//` line comments and `/* ... */` block comments. Comment
    starts inside interpreted strings, raw strings, or rune literals are not
    comments. Newlines are preserved so reported symbol line numbers stay
    aligned with the original source.
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
            while i + 1 < n and not (src[i] == '*' and src[i + 1] == '/'):
                i += 1
            i = i + 2 if i + 1 < n else n
            blank_span(start, i)
            continue

        if c == '`':
            start = i
            i += 1
            while i < n and src[i] != '`':
                i += 1
            i = i + 1 if i < n else n
            if mask_literals:
                blank_span(start, i)
            continue

        if c in ('"', "'"):
            quote = c
            start = i
            i += 1
            while i < n:
                if src[i] == '\\':
                    i += 2
                    continue
                if src[i] == quote:
                    i += 1
                    break
                i += 1
            if mask_literals:
                blank_span(start, i)
            continue

        i += 1

    return ''.join(out)


def _strip_comments(src: str) -> str:
    return _mask_go_source(src, mask_literals=False)


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _line_prefix_is_ws(src: str, idx: int) -> bool:
    line_start = src.rfind('\n', 0, idx) + 1
    return src[line_start:idx].strip() == ''


def _line_suffix_is_ws(src: str, idx: int) -> bool:
    line_end = src.find('\n', idx)
    if line_end == -1:
        line_end = len(src)
    return src[idx:line_end].strip() == ''


def _scan_go_comments(src: str) -> list:
    """Return Go comments outside strings/raw strings/runes."""
    comments = []
    i = 0
    n = len(src)

    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ''

        if c == '/' and nxt == '/':
            start = i
            i += 2
            body_start = i
            while i < n and src[i] != '\n':
                i += 1
            comments.append({
                'kind': 'line',
                'start': start,
                'end': i,
                'start_line': _line_no(src, start),
                'end_line': _line_no(src, start),
                'body': src[body_start:i],
            })
            continue

        if c == '/' and nxt == '*':
            start = i
            i += 2
            body_start = i
            while i + 1 < n and not (src[i] == '*' and src[i + 1] == '/'):
                i += 1
            body_end = i
            i = i + 2 if i + 1 < n else n
            comments.append({
                'kind': 'block',
                'start': start,
                'end': i,
                'start_line': _line_no(src, start),
                'end_line': _line_no(src, i),
                'body': src[body_start:body_end],
            })
            continue

        if c == '`':
            i += 1
            while i < n and src[i] != '`':
                i += 1
            i = i + 1 if i < n else n
            continue

        if c in ('"', "'"):
            quote = c
            i += 1
            while i < n:
                if src[i] == '\\':
                    i += 2
                    continue
                if src[i] == quote:
                    i += 1
                    break
                i += 1
            continue

        i += 1

    return comments


def _clean_block_doc(body: str) -> str:
    lines = []
    for line in body.splitlines():
        text = line.strip()
        if text.startswith('*'):
            text = text[1:].lstrip()
        if text:
            lines.append(text)
    return '\n'.join(lines)


def _is_pure_line_comment(src: str, comment: dict) -> bool:
    return (
        comment['kind'] == 'line'
        and _line_prefix_is_ws(src, comment['start'])
        and _line_suffix_is_ws(src, comment['end'])
    )


def _is_pure_block_comment(src: str, comment: dict) -> bool:
    return (
        comment['kind'] == 'block'
        and _line_prefix_is_ws(src, comment['start'])
        and _line_suffix_is_ws(src, comment['end'])
    )


def _extract_doc_comments(src: str, clean: str) -> dict:
    """Build map: declaration line number -> Go doc comment text.

    Go doc comments are immediate `//` groups or `/* ... */` comments before
    top-level declarations. Comments inside strings/raw strings/runes are
    ignored by the scanner.
    """
    doc_map = {}
    comments = _scan_go_comments(src)
    by_end_line = {c['end_line']: c for c in comments}

    for decl in RE_GO_TOP_DECL.finditer(clean):
        decl_line = _line_no(src, decl.start())
        candidate = by_end_line.get(decl_line - 1)
        if not candidate:
            continue

        if candidate['kind'] == 'line' and _is_pure_line_comment(src, candidate):
            group = [candidate]
            line = candidate['start_line'] - 1
            while True:
                prev = by_end_line.get(line)
                if not prev or prev['kind'] != 'line' or not _is_pure_line_comment(src, prev):
                    break
                group.insert(0, prev)
                line = prev['start_line'] - 1
            doc = '\n'.join(c['body'].strip() for c in group).strip()
            if doc:
                doc_map[decl_line] = doc
            continue

        if candidate['kind'] == 'block' and _is_pure_block_comment(src, candidate):
            doc = _clean_block_doc(candidate['body'])
            if doc:
                doc_map[decl_line] = doc

    return doc_map


def _parse_imports(src: str) -> list:
    """Return list of last-segment package names from import paths."""
    paths = []
    for m in RE_GO_IMPORT_SINGLE.finditer(src):
        paths.append(m.group(1))
    for m in RE_GO_IMPORT_BLOCK.finditer(src):
        block = m.group(1)
        for q in RE_GO_QUOTED.finditer(block):
            p = q.group(1).strip()
            if p:
                paths.append(p)

    result = []
    for p in paths:
        seg = p.rstrip('/').split('/')[-1]
        if seg and seg != '.':
            result.append(seg)
    return list(set(result))


def _brace_body(src: str, open_idx: int) -> str:
    """Return text inside the outermost { } starting at open_idx."""
    if open_idx < 0:
        return ''
    depth = 0
    for i in range(open_idx, len(src)):
        c = src[i]
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return src[open_idx + 1:i]
    return ''


def _brace_end_line(src: str, open_idx: int, base_line: int) -> int:
    """Return the end line (1-based) of the brace block."""
    if open_idx < 0:
        return base_line
    depth = 0
    for i in range(open_idx, len(src)):
        c = src[i]
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return base_line + src[open_idx:i + 1].count('\n')
    return base_line


def _func_decl_name_starts(text: str) -> set:
    return {m.start(1) for m in RE_GO_FUNCDEF.finditer(text)}


def _is_method_funcdef(clean: str, match: re.Match) -> bool:
    after_func = match.start() + len('func')
    while after_func < len(clean) and clean[after_func].isspace():
        after_func += 1
    return after_func < len(clean) and clean[after_func] == '('


def _extract_calls(text: str, decl_name_starts: set | None = None) -> list:
    decl_name_starts = decl_name_starts or set()
    calls = []
    for m in RE_GO_CALL.finditer(text):
        name = m.group(1)
        if m.start(1) in decl_name_starts:
            continue
        if name not in GO_KEYWORDS and len(name) >= 2:
            calls.append(name)
    return calls


# Cyclomatic complexity (regex approximation for Go)
_RE_GO_STRINGS = re.compile(
    r'"(?:[^"\\]|\\.)*"'
    r"|'(?:[^'\\]|\\.)*'"
    r'|`[^`]*`',
    re.DOTALL,
)
_RE_GO_BRANCH_KW = re.compile(r'\b(?:if|for|case|select)\b')


def _count_complexity_go(body: str) -> int:
    """Approximate cyclomatic complexity for a Go function body."""
    if not body:
        return 1
    try:
        masked = _RE_GO_STRINGS.sub('""', body)
    except Exception:
        masked = body
    count = 1
    count += len(_RE_GO_BRANCH_KW.findall(masked))
    count += masked.count('&&')
    count += masked.count('||')
    return count


def _extract_struct_embedding(clean: str, struct_start: int) -> list:
    """Extract embedded types from a struct body for composition tracking."""
    open_idx = clean.find('{', struct_start)
    if open_idx == -1:
        return []
    body = _brace_body(clean, open_idx)
    bases = []
    for line in body.splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split()
        if len(parts) == 1:
            name = parts[0].lstrip('*')
            if name.split('.')[-1][0:1].isupper():
                bases.append(name)
    return bases


def _parse_symbol_defs(src: str, clean: str, doc_map: dict) -> list:
    """Extract struct, interface, type alias, and function symbols from Go source."""
    symbols = []

    for m in RE_GO_STRUCT.finditer(clean):
        name = m.group(1)
        line_no = _line_no(src, m.start())
        open_idx = clean.find('{', m.end() - 1)
        end_line = _brace_end_line(clean, open_idx, line_no)
        bases = _extract_struct_embedding(clean, m.start())
        symbols.append({
            'kind': 'struct',
            'name': name,
            'line': line_no,
            'end_line': end_line,
            'bases': bases,
            'parent': None,
            'is_public': name[0].isupper(),
            'doc': doc_map.get(line_no, None),
        })

    for m in RE_GO_INTERFACE.finditer(clean):
        name = m.group(1)
        line_no = _line_no(src, m.start())
        open_idx = clean.find('{', m.end() - 1)
        end_line = _brace_end_line(clean, open_idx, line_no)
        symbols.append({
            'kind': 'interface',
            'name': name,
            'line': line_no,
            'end_line': end_line,
            'bases': [],
            'parent': None,
            'is_public': name[0].isupper(),
            'doc': doc_map.get(line_no, None),
        })

    seen_names = {s['name'] for s in symbols}
    for m in RE_GO_TYPE_ALIAS.finditer(clean):
        name = m.group(1)
        if name in seen_names:
            continue
        target = m.group(2)
        line_no = _line_no(src, m.start())
        symbols.append({
            'kind': 'typedef',
            'name': name,
            'line': line_no,
            'end_line': line_no,
            'bases': [target],
            'parent': None,
            'is_public': name[0].isupper(),
            'doc': doc_map.get(line_no, None),
        })
        seen_names.add(name)

    for m in RE_GO_TYPE_NEW.finditer(clean):
        name = m.group(1)
        if name in seen_names:
            continue
        target = m.group(2)
        if target in ('struct', 'interface', 'func', 'map', 'chan'):
            continue
        line_no = _line_no(src, m.start())
        symbols.append({
            'kind': 'typedef',
            'name': name,
            'line': line_no,
            'end_line': line_no,
            'bases': [target],
            'parent': None,
            'is_public': name[0].isupper(),
            'doc': doc_map.get(line_no, None),
        })
        seen_names.add(name)

    for m in RE_GO_METHOD.finditer(clean):
        receiver = m.group(1)
        mname = m.group(2)
        if mname in GO_KEYWORDS:
            continue
        line_no = _line_no(src, m.start())
        open_idx = clean.find('{', m.end())
        end_line = _brace_end_line(clean, open_idx, line_no)
        mbody = _brace_body(clean, open_idx)
        symbols.append({
            'kind': 'method',
            'name': mname,
            'line': line_no,
            'end_line': end_line,
            'bases': [],
            'parent': receiver,
            'is_public': mname[0].isupper(),
            'doc': doc_map.get(line_no, None),
            'complexity': _count_complexity_go(mbody),
        })

    for m in RE_GO_FUNCDEF.finditer(clean):
        if _is_method_funcdef(clean, m):
            continue
        name = m.group(1)
        if name in GO_KEYWORDS:
            continue
        line_no = _line_no(src, m.start())
        open_idx = clean.find('{', m.end())
        end_line = _brace_end_line(clean, open_idx, line_no)
        fbody = _brace_body(clean, open_idx)
        symbols.append({
            'kind': 'function',
            'name': name,
            'line': line_no,
            'end_line': end_line,
            'bases': [],
            'parent': None,
            'is_public': name[0].isupper(),
            'doc': doc_map.get(line_no, None),
            'complexity': _count_complexity_go(fbody),
        })

    return symbols


def _parse_package(src: str) -> str:
    """Extract package declaration."""
    m = re.search(r'^package\s+(\w+)', _strip_comments(src), re.MULTILINE)
    return m.group(1) if m else ''


def scan_go(src: str) -> tuple:
    """
    Go file analysis.

    Returns: (imports, funcdefs, all_calls, extra_dict, func_calls_by_func, symbol_defs)
    """
    import_src = _strip_comments(src)
    clean = _mask_go_source(src, mask_literals=True)
    doc_map = _extract_doc_comments(src, clean)
    imports = _parse_imports(import_src)

    funcdefs = []
    func_calls_by_func = []
    seen = set()

    for m in RE_GO_FUNCDEF.finditer(clean):
        name = m.group(1)
        if not name or name in GO_KEYWORDS or name in seen:
            continue
        seen.add(name)

        funcdefs.append({
            'label': name,
            'is_efiapi': False,
            'is_static': name[0].islower(),
        })

        open_idx = clean.find('{', m.end())
        body = _brace_body(clean, open_idx)
        func_calls_by_func.append(_extract_calls(body))

    all_calls = _extract_calls(clean, _func_decl_name_starts(clean))
    symbol_defs = _parse_symbol_defs(src, clean, doc_map)

    docstrings = {}
    for sym in symbol_defs:
        if sym.get('doc'):
            key = f"{sym['parent']}.{sym['name']}" if sym['parent'] else sym['name']
            docstrings[key] = sym['doc']

    extra = {
        'imports': imports,
        'lang': 'go',
        'package': _parse_package(src),
    }
    if docstrings:
        extra['docstrings'] = docstrings

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs
