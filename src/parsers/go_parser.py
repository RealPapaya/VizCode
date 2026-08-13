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


# ─── L3 type_usage support: project-type references ──────────────────────────
# Go predeclared types + the universe identifiers that must never become a
# `type_usage` edge. Most are lowercase and already excluded by the Capitalized
# filter, but they're listed for clarity / safety.
GO_TYPE_BUILTINS = frozenset({
    'error', 'string', 'bool', 'byte', 'rune', 'any',
    'int', 'int8', 'int16', 'int32', 'int64',
    'uint', 'uint8', 'uint16', 'uint32', 'uint64', 'uintptr',
    'float32', 'float64', 'complex64', 'complex128',
})


def _base_type_ident(token: str) -> str:
    """Reduce a Go type token to its base identifier.

    Strips leading '[]', 'map[...]', '*', 'chan ', '...', '<-chan' / 'chan<-',
    array sizes '[N]', and parentheses; for 'pkg.Type' keeps the final
    identifier. Returns '' if no plain identifier remains.
    """
    t = token.strip()
    if not t:
        return ''
    # Drop func types / channels-of-func and other composites we can't reduce.
    # Iteratively peel known prefixes.
    changed = True
    while changed and t:
        changed = False
        t = t.strip()
        if t.startswith('...'):
            t = t[3:]
            changed = True
            continue
        if t.startswith('*'):
            t = t[1:]
            changed = True
            continue
        if t.startswith('[]'):
            t = t[2:]
            changed = True
            continue
        if t.startswith('<-chan'):
            t = t[6:]
            changed = True
            continue
        if t.startswith('chan<-'):
            t = t[6:]
            changed = True
            continue
        if t.startswith('chan ') or t.startswith('chan\t'):
            t = t[4:]
            changed = True
            continue
        # Fixed-size or empty array prefix: [N]Type or [...]Type
        if t.startswith('['):
            close = t.find(']')
            if close != -1:
                t = t[close + 1:]
                changed = True
                continue
        # map[K]V -> value type V (key types are usually builtins/strings)
        if t.startswith('map['):
            close = t.find(']')
            if close != -1:
                t = t[close + 1:]
                changed = True
                continue
    t = t.strip()
    # Take the leading identifier only (stop at any non-identifier char other
    # than '.'); then keep the final dotted segment for 'pkg.Type'.
    m = re.match(r'([A-Za-z_][\w.]*)', t)
    if not m:
        return ''
    ident = m.group(1)
    return ident.split('.')[-1]


def _add_type_ref(out: set, token: str) -> None:
    base = _base_type_ident(token)
    if base:
        out.add(base)


def _filter_type_refs(names: set) -> list:
    """Keep only plausible user-defined Go type names (exported, ≥3 chars)."""
    out = []
    for name in sorted(names):
        if not name or len(name) < 3 or not name[0].isupper():
            continue
        if name in GO_TYPE_BUILTINS:
            continue
        out.append(name)
    return out

# Call sites
RE_GO_CALL = re.compile(r'\b([A-Za-z_]\w*)\s*\(')


# ─── L1 edge_hints: asset/config file references ─────────────────────────────
_CONFIG_EXTS = {'.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env'}
_ASSET_EXTS = {'.html', '.htm', '.css', '.scss', '.sass', '.less', '.svg', '.png',
               '.jpg', '.jpeg', '.gif', '.csv', '.sql', '.xml'}
# Trusted call targets whose first string-literal argument is a file path. The
# matched name is the final identifier of a (possibly qualified) call, e.g.
# os.Open -> 'Open'. Paired with a known extension this double-gates against
# false positives; the analyzer additionally drops refs that aren't real files.
_GO_ASSET_CALLERS = {
    'Open', 'ReadFile', 'ParseFiles', 'ParseGlob',
}
# The body of a //go:embed line comment (the scanner strips the leading '//').
RE_GO_EMBED = re.compile(r'^go:embed[ \t]+(.+?)[ \t]*$')
# os.Open / os.ReadFile / ioutil.ReadFile / template.ParseFiles("x") with a
# string literal first argument. Captures the call's final identifier + literal.
RE_GO_ASSET_CALL = re.compile(
    r'\b([A-Za-z_]\w*)\s*\(\s*"((?:[^"\\]|\\.)*)"',
)


def _classify_ref(ref: str) -> str | None:
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


def _extract_edge_hints(src: str, clean: str) -> list:
    """Collect L1 asset/config edge hints from embeds + trusted I/O calls.

    `src` is the original source (used for //go:embed directives, which live in
    comments that `clean` has masked). `clean` has comments + literals masked,
    so trusted I/O calls are matched against the comment-masked-but-literal-kept
    source instead.
    """
    hints = []

    # //go:embed directives — scan real line comments (the scanner already
    # excludes comment-like sequences inside strings/raw strings/runes). A
    # directive comment has no space between '//' and 'go:embed'; embed targets
    # may be multiple space-separated globs/paths.
    for comment in _scan_go_comments(src):
        if comment['kind'] != 'line':
            continue
        em = RE_GO_EMBED.match(comment['body'])
        if not em:
            continue
        line = comment['start_line']
        for tok in em.group(1).split():
            tok = tok.strip().strip('"')
            if not tok:
                continue
            etype = _classify_ref(tok)
            if etype:
                hints.append({
                    'type': etype,
                    'target': tok,
                    'via': '//go:embed',
                    'line': line,
                    'origin': 'parser',
                    'confidence': 'high',
                })

    # Trusted I/O calls with a string-literal path. Use source with comments
    # masked but string literals INTACT so we can read the path.
    lit_src = _strip_comments(src)
    for m in RE_GO_ASSET_CALL.finditer(lit_src):
        name = m.group(1)
        if name not in _GO_ASSET_CALLERS:
            continue
        path = m.group(2)
        etype = _classify_ref(path)
        if etype:
            hints.append({
                'type': etype,
                'target': path.strip(),
                'via': name,
                'line': _line_no(lit_src, m.start()),
                'origin': 'parser',
                'confidence': 'high',
            })

    return hints

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


def _match_paren(src: str, open_idx: int) -> int:
    """Return index of the ')' matching the '(' at open_idx, or -1."""
    if open_idx < 0 or open_idx >= len(src) or src[open_idx] != '(':
        return -1
    depth = 0
    for i in range(open_idx, len(src)):
        c = src[i]
        if c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
            if depth == 0:
                return i
    return -1


def _split_top_level(text: str, sep: str = ',') -> list:
    """Split on `sep` ignoring separators nested in (), [], {}."""
    parts = []
    depth = 0
    cur = []
    for c in text:
        if c in '([{':
            depth += 1
            cur.append(c)
        elif c in ')]}':
            depth -= 1
            cur.append(c)
        elif c == sep and depth == 0:
            parts.append(''.join(cur))
            cur = []
        else:
            cur.append(c)
    if cur:
        parts.append(''.join(cur))
    return parts


def _extract_func_signature(clean: str, paren_open_idx: int):
    """Parse a Go func/method param + result clause.

    `paren_open_idx` points at the '(' opening the parameter list. Returns
    (signature_str, type_refs_set). Signature is '(params) -> result' style with
    whitespace collapsed; result is omitted when there is none.
    """
    type_names = set()
    params_close = _match_paren(clean, paren_open_idx)
    if params_close < 0:
        return '', type_names
    params_src = clean[paren_open_idx + 1:params_close]

    # Result clause: everything between the params ')' and the function body '{'
    # (or a newline / end for declarations without a body).
    rest = clean[params_close + 1:]
    brace = rest.find('{')
    nl = rest.find('\n')
    cut_candidates = [x for x in (brace, nl) if x != -1]
    cut = min(cut_candidates) if cut_candidates else len(rest)
    result_src = rest[:cut].strip()

    # Collect type refs from each param. Go params look like:
    #   name Type | name1, name2 Type | Type (unnamed) | name ...Type
    for part in _split_top_level(params_src):
        part = part.strip()
        if not part:
            continue
        toks = part.split()
        # The type is the trailing token(s); for 'a, b Type' the names share one
        # type. Simplest robust heuristic: feed every token through the base-type
        # reducer — only exported identifiers survive the later filter, names are
        # lowercase and dropped.
        for tok in toks:
            _add_type_ref(type_names, tok)

    # Result clause: may be a single type, or a parenthesized list.
    if result_src:
        rsrc = result_src
        if rsrc.startswith('('):
            rclose = _match_paren(rsrc, 0)
            if rclose != -1:
                rsrc = rsrc[1:rclose]
        for part in _split_top_level(rsrc):
            for tok in part.split():
                _add_type_ref(type_names, tok)

    # Build a compact signature string.
    sig_params = ' '.join(params_src.split())
    signature = f'({sig_params})'
    if result_src:
        signature += ' -> ' + ' '.join(result_src.split())
    return signature, type_names


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


def _extract_struct_field_types(clean: str, struct_start: int) -> set:
    r"""Collect referenced type names from a struct's named field declarations.

    Fields look like `Name Type` / `Name1, Name2 Type` / `Name Type \`tag\``.
    Embedded fields (a single token) are handled separately as bases and skipped
    here. Returns the raw base-identifier set (filtered later).
    """
    type_names = set()
    open_idx = clean.find('{', struct_start)
    if open_idx == -1:
        return type_names
    body = _brace_body(clean, open_idx)
    for line in body.splitlines():
        line = line.strip()
        if not line:
            continue
        # Drop a struct tag (backtick-delimited) if present.
        bt = line.find('`')
        if bt != -1:
            line = line[:bt].strip()
        if not line:
            continue
        parts = line.split(None, 1)
        if len(parts) < 2:
            continue  # embedded field -> handled as a base
        # parts[1] is the type expression (possibly preceded by more field names
        # for the `A, B Type` form — strip a trailing comma list off the name).
        type_expr = parts[1]
        # If the field-name token list had commas (multiple names), the real type
        # is after the last name; re-split on whitespace and take the final group.
        if ',' in parts[0] or parts[1].lstrip().startswith(','):
            toks = line.replace(',', ' ').split()
            type_expr = toks[-1] if toks else type_expr
        _add_type_ref(type_names, type_expr)
    return type_names


def _parse_symbol_defs(src: str, clean: str, doc_map: dict) -> list:
    """Extract struct, interface, type alias, and function symbols from Go source."""
    symbols = []

    for m in RE_GO_STRUCT.finditer(clean):
        name = m.group(1)
        line_no = _line_no(src, m.start())
        open_idx = clean.find('{', m.end() - 1)
        end_line = _brace_end_line(clean, open_idx, line_no)
        bases = _extract_struct_embedding(clean, m.start())
        field_types = _extract_struct_field_types(clean, m.start())
        symbols.append({
            'kind': 'struct',
            'name': name,
            'line': line_no,
            'end_line': end_line,
            'bases': bases,
            'parent': None,
            'is_public': name[0].isupper(),
            'doc': doc_map.get(line_no, None),
            'decorators': [],
            'type_refs': _filter_type_refs(field_types),
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
        signature, type_names = _extract_func_signature(clean, m.end() - 1)
        symbols.append({
            'kind': 'method',
            'name': mname,
            'line': line_no,
            'end_line': end_line,
            'bases': [],
            'parent': receiver,
            'is_public': mname[0].isupper(),
            'doc': doc_map.get(line_no, None),
            'decorators': [],
            'signature': signature,
            'complexity': _count_complexity_go(mbody),
            'type_refs': _filter_type_refs(type_names),
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
        signature, type_names = _extract_func_signature(clean, m.end() - 1)
        symbols.append({
            'kind': 'function',
            'name': name,
            'line': line_no,
            'end_line': end_line,
            'bases': [],
            'parent': None,
            'is_public': name[0].isupper(),
            'doc': doc_map.get(line_no, None),
            'decorators': [],
            'signature': signature,
            'complexity': _count_complexity_go(fbody),
            'type_refs': _filter_type_refs(type_names),
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

    edge_hints = _extract_edge_hints(src, clean)
    if edge_hints:
        extra['edge_hints'] = edge_hints

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs
