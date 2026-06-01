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

# ─── L3 type_usage support: project-type references in type positions ─────────
# Language builtins + generic containers that must NEVER become `type_usage`
# edges. Lowercase primitives (int/string/...) are listed because C# type
# positions use the lowercase aliases; the Capitalized filter alone would not
# catch them.
CS_TYPE_BUILTINS = frozenset({
    'int', 'string', 'bool', 'object', 'void', 'var', 'dynamic', 'byte',
    'sbyte', 'short', 'ushort', 'uint', 'long', 'ulong', 'float', 'double',
    'decimal', 'char', 'Task', 'List', 'Dictionary', 'IEnumerable', 'IList',
    'ICollection', 'IDictionary', 'Array', 'Nullable', 'Func', 'Action',
    'Tuple', 'Span', 'ValueTask', 'Object', 'String', 'Boolean', 'Int32',
    'Int64',
})

# ─── L1 edge_hints: asset/config file references from string literals ─────────
_CONFIG_EXTS = {'.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env'}
_ASSET_EXTS = {'.html', '.htm', '.css', '.scss', '.sass', '.less', '.svg', '.png',
               '.jpg', '.jpeg', '.gif', '.csv', '.sql', '.xml'}

# Calls whose first string-literal argument is a file path. AddJsonFile is
# forced to config_ref per the C# configuration convention; the rest classify
# by extension. The analyzer's resolve_ref() drops anything that is not a real
# project file, so this is double-gated.
_CS_ASSET_CALLERS = {
    'ReadAllText', 'ReadAllLines', 'ReadAllBytes', 'OpenRead', 'OpenText',
    'ReadAllTextAsync', 'ReadAllLinesAsync', 'AddJsonFile', 'AddXmlFile',
    'AddIniFile',
}
_CS_CONFIG_CALLERS = {'AddJsonFile', 'AddXmlFile', 'AddIniFile'}

# A string literal argument: File.ReadAllText("x.json"), AddJsonFile("a.json").
RE_CS_REF_CALL = re.compile(
    r'\b(?P<call>[A-Za-z_]\w*)\s*\(\s*(?P<q>[@$]*")(?P<path>[^"\r\n]+)"')

# Attribute lists immediately preceding a declaration: [Route("x")], [Test].
RE_CS_ATTR_BLOCK = re.compile(r'\[\s*([^\]\r\n]+?)\s*\]')

# Generic identifier extractor for type strings.
RE_CS_IDENT = re.compile(r'[A-Za-z_]\w*')

# Branch keywords for cyclomatic complexity.
RE_CS_BRANCH_KW = re.compile(r'\b(?:if|for|foreach|while|case)\b')


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


def _filter_type_refs(names) -> list:
    """Keep only plausible user-defined type names (Capitalized, ≥3 chars)."""
    out = []
    for name in sorted(set(names)):
        if not name or len(name) < 3 or not name[0].isupper():
            continue
        if name in CS_TYPE_BUILTINS:
            continue
        out.append(name)
    return out


def _collect_cs_type_names(type_str: str, out: set) -> None:
    """Pull identifiers out of a C# type expression.

    Strips generic args, arrays, nullable '?', and qualified prefixes so that
    'List<Foo>' yields {List, Foo} and 'Ns.Bar[]' yields {Bar}. The caller's
    builtin/Capitalized filter removes List, primitives, etc. Qualified names
    keep only the final segment (the type name).
    """
    if not type_str:
        return
    # Split on '.' boundaries but keep generic/array tokens; the regex below
    # captures every identifier, then we keep names that are not immediately
    # preceded by a '.' qualifier… simpler: tokenize and for dotted runs keep
    # the last identifier of each dotted run as the type, plus generic args.
    # Replace separators that delimit independent identifiers with spaces,
    # but turn '.' into nothing-preserving so we can drop namespace prefixes.
    cleaned = re.sub(r'\?', ' ', type_str)
    cleaned = re.sub(r'[\[\]<>,]', ' ', cleaned)
    for token_run in cleaned.split():
        # token_run may be a dotted path like Ns.Sub.TypeName -> keep last.
        ident = token_run.split('.')[-1]
        if ident.isidentifier():
            out.add(ident)

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
    r'^[ \t]*(?P<mods>(?:(?:public|private|protected|internal|static|virtual|override|sealed|abstract|extern|async|unsafe|new|partial|readonly)\s+)*)'
    r'(?:ref\s+(?:readonly\s+)?)?'
    r'(?P<ret>[A-Za-z_]\w*(?:[.<>,?\[\]\s]*[A-Za-z_]\w*)*|void)\s+'
    r'(?P<name>(?:[A-Za-z_]\w*\.)?[A-Za-z_]\w*)\s*'
    r'(?:<[^;{}()]*>)?\((?P<params>[^;{}()]*)\)\s*'
    r'(?:where\s+[^{;=]+)?(?P<body>\{|=>|;)',
    re.MULTILINE,
)
RE_CONSTRUCTOR = re.compile(
    r'^[ \t]*(?P<mods>(?:(?:public|private|protected|internal|static|extern|unsafe)\s+)*)'
    r'(?P<name>[A-Za-z_]\w*)\s*\((?P<params>[^;{}()]*)\)\s*(?::\s*(?:base|this)\s*\([^)]*\)\s*)?(?P<body>\{|=>|;)',
    re.MULTILINE,
)
RE_PROPERTY = re.compile(
    r'^[ \t]*(?:(?:public|private|protected|internal|static|virtual|override|sealed|abstract|readonly|required|new)\s+)*'
    r'(?P<ptype>[A-Za-z_]\w*(?:[.<>,?\[\]\s]*[A-Za-z_]\w*)*)\s+(?P<pname>[A-Za-z_]\w*)\s*\{[ \t]*(?:get|set|init)\b',
    re.MULTILINE,
)
RE_FIELD = re.compile(
    r'^[ \t]*(?:(?:public|private|protected|internal|static|readonly|const|volatile|new|required)\s+)*'
    r'(?P<ftype>[A-Za-z_]\w*(?:[.<>,?\[\]\s]*[A-Za-z_]\w*)*)\s+[A-Za-z_]\w*\s*(?:=|;)',
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


def _mask_csharp_source(src: str, mask_strings: bool = True) -> str:
    """Mask comments and C# string/char literals, preserving offsets.

    Comments are always removed. With ``mask_strings=False`` the literal CONTENT
    of string/char literals is kept intact (only comments are stripped) — used by
    edge-hint extraction, which needs the literal file paths while still ignoring
    commented-out code. Index advancement is identical in both modes so comment
    markers inside string literals are never mistaken for comments.
    """
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
            if mask_strings:
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
            if mask_strings:
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
            if mask_strings:
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
    prop_names = {m.group('pname') for m in RE_PROPERTY.finditer(masked)}
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


def _decorators_before(masked: str, decl_start: int) -> list:
    """Collect '[Attribute]' names on the lines directly above a declaration.

    Walks upward over contiguous lines that are blank or consist solely of
    attribute blocks (and whitespace). Each '[A, B(args)]' contributes the bare
    attribute names with arguments stripped (e.g. '[Route("/x")]' -> 'Route').
    Stops at the first non-attribute, non-blank line.
    """
    line_start = masked.rfind('\n', 0, decl_start) + 1
    names = []
    cursor = line_start
    while cursor > 0:
        prev_line_start = masked.rfind('\n', 0, cursor - 1) + 1
        line = masked[prev_line_start:cursor - 1] if cursor > 0 else ''
        stripped = line.strip()
        if not stripped:
            cursor = prev_line_start
            continue
        # Line must be entirely attribute blocks to qualify.
        remainder = RE_CS_ATTR_BLOCK.sub('', line).strip()
        if remainder:
            break
        block_names = []
        for m in RE_CS_ATTR_BLOCK.finditer(line):
            for part in m.group(1).split(','):
                bare = part.strip().split('(')[0].strip()
                # Strip 'assembly:'/'return:' style targets.
                if ':' in bare:
                    bare = bare.split(':')[-1].strip()
                if bare and bare.isidentifier() and bare not in CSHARP_KEYWORDS:
                    block_names.append(bare)
        # Prepend so source order is preserved across stacked attribute lines.
        names = block_names + names
        cursor = prev_line_start
    return _dedupe(names)


def _is_static_decl(mods: str) -> bool:
    """True when the modifier run contains the 'static' keyword."""
    return bool(re.search(r'\bstatic\b', mods or ''))


def _param_type_names(params: str, out: set) -> None:
    """Extract referenced type names from a parameter clause.

    Each comma-separated parameter is 'modifiers Type name = default'; we take
    the type token(s) before the parameter name. To stay conservative we feed
    every identifier except the trailing parameter name into the type
    collector, which the builtin/Capitalized filter then prunes.
    """
    if not params or not params.strip():
        return
    for raw in params.split(','):
        part = raw.strip()
        if not part:
            continue
        # Drop default value.
        part = part.split('=')[0].strip()
        # Drop leading parameter modifiers.
        part = re.sub(r'^(?:this\s+|ref\s+|out\s+|in\s+|params\s+|readonly\s+|scoped\s+)+',
                      '', part)
        # The last whitespace-separated token (outside generics) is the param
        # name; everything before it is the type. Use the angle-bracket depth
        # to avoid splitting inside generics.
        depth = 0
        split_at = -1
        for idx, ch in enumerate(part):
            if ch == '<':
                depth += 1
            elif ch == '>':
                depth -= 1
            elif ch == ' ' and depth == 0:
                split_at = idx
        type_str = part[:split_at] if split_at != -1 else part
        _collect_cs_type_names(type_str, out)


def _signature(ret: str, params: str) -> str:
    """Build a compact '(params) -> ret' signature string."""
    param_src = ' '.join((params or '').split())
    sig = f'({param_src})'
    ret_clean = ' '.join((ret or '').split())
    if ret_clean and ret_clean != 'void':
        sig += f' -> {ret_clean}'
    return sig


def _complexity(body: str) -> int:
    """Count decision points in a method body (1 + branch keywords/operators)."""
    if not body:
        return 1
    count = 1
    count += len(RE_CS_BRANCH_KW.findall(body))
    count += body.count('&&')
    count += body.count('||')
    count += body.count('?')
    return count


def _type_member_type_refs(masked: str, t: dict) -> list:
    """Collect type_refs for a type from its property and field declarations."""
    body_start = t['open'] if t['open'] != -1 else t['start']
    body_end = t['end']
    body = masked[body_start:body_end] if body_end > body_start else ''
    names = set()
    for m in RE_PROPERTY.finditer(body):
        _collect_cs_type_names(m.group('ptype'), names)
    for m in RE_FIELD.finditer(body):
        _collect_cs_type_names(m.group('ftype'), names)
    return _filter_type_refs(names)


def _edge_hints(masked_code: str, masked_full: str) -> list:
    """Asset/config file references from trusted call string literals.

    ``masked_code`` keeps string content (so paths survive) but strips comments;
    ``masked_full`` blanks strings too. A candidate is accepted only when its call
    identifier is real code in ``masked_full`` — this rejects call-looking text
    that appears INSIDE a string literal (e.g. "AddJsonFile(\\"x.json\\")").
    """
    hints = []
    for m in RE_CS_REF_CALL.finditer(masked_code):
        call = m.group('call')
        if call not in _CS_ASSET_CALLERS:
            continue
        cs = m.start('call')
        if masked_full[cs:cs + len(call)] != call:
            continue  # call token lies inside a string/comment
        path = m.group('path').strip()
        if call in _CS_CONFIG_CALLERS:
            etype = 'config_ref' if _classify_ref(path) else None
        else:
            etype = _classify_ref(path)
        if not etype:
            continue
        hints.append({
            'type': etype,
            'target': path,
            'via': call,
            'line': masked_code[:m.start()].count('\n') + 1,
            'origin': 'parser',
            'confidence': 'high',
        })
    return hints


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
            'decorators': _decorators_before(masked, t['start']),
            'type_refs': _type_member_type_refs(masked, t),
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

        params = m.groupdict().get('params', '') or ''
        ret = m.groupdict().get('ret', '') or ''
        # Modifier run: take the declaration header from line start to the name,
        # which reliably contains every modifier (the named 'mods' group only
        # retains the final repetition under the '*' quantifier).
        hdr_start = masked.rfind('\n', 0, m.start()) + 1
        mods = masked[hdr_start:m.start('name')]

        # type_refs from parameter types + return type.
        type_names = set()
        _param_type_names(params, type_names)
        if ret and ret != 'void':
            _collect_cs_type_names(ret, type_names)

        # complexity over the method body (only when a brace body exists).
        if open_idx != -1:
            close_idx = _find_matching_brace(masked, open_idx)
            body = masked[open_idx + 1:close_idx] if close_idx > open_idx else ''
            complexity = _complexity(body)
        else:
            complexity = None

        symbols.append({
            'kind': 'method' if parent else 'function',
            'name': name,
            'line': line,
            'end_line': _end_line(masked, open_idx, line) if open_idx != -1 else line,
            'bases': [],
            'parent': parent,
            'is_public': not name.startswith('_'),
            'is_static': _is_static_decl(mods),
            'decorators': _decorators_before(masked, m.start()),
            'signature': _signature(ret, params),
            'complexity': complexity,
            'type_refs': _filter_type_refs(type_names),
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
    # Edge hints need literal string CONTENT (file paths), so use a view where
    # only comments are stripped — commented-out calls still produce no hints.
    # `masked` (strings blanked too) disambiguates call tokens inside strings.
    edge_hints = _edge_hints(_mask_csharp_source(src, mask_strings=False), masked)
    if edge_hints:
        extra['edge_hints'] = edge_hints
    return imports, funcdefs, funccalls, extra, func_calls_by_func, symbols
