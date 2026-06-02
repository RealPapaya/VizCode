#!/usr/bin/env python3
"""
parsers/objc_parser.py - VIZCODE Objective-C / Objective-C++ Parser

Extracts:
  imports             - header/module leaf names from #import / @import / #include
  funcdefs            - ObjC methods (- / +), C functions
  funccalls           - C-style call expressions
  func_calls_by_func  - per-function call lists (body-scoped via brace matching)
  symbol_defs         - @interface / @implementation / @protocol / struct / method

Precision note: ObjC message sends `[recv selector:arg]` are intentionally NOT
turned into call edges (high false-positive risk, no reliable target). Only
C-function call syntax `name(...)` contributes to funccalls.

Syntax verified against Apple Objective-C references:
  https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/ProgrammingWithObjectiveC/DefiningClasses/DefiningClasses.html
  https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/ObjectiveC/Chapters/ocProtocols.html
Line `//`, block `/* */` (NON-nesting) comments; strings `"..."` / `@"..."`,
char `'x'`. Method selectors built from `keyword:` segments.
Unsupported: Objective-C message sends as call edges, dynamic selectors, and
arbitrary string file paths.
"""

import re


OBJC_EXTENSIONS = {'.m', '.mm'}


OBJC_KEYWORDS = {
    'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break',
    'continue', 'return', 'goto', 'sizeof', 'typedef', 'struct', 'union',
    'enum', 'static', 'extern', 'const', 'volatile', 'inline', 'register',
    'void', 'int', 'char', 'short', 'long', 'float', 'double', 'signed',
    'unsigned', 'self', 'super', 'nil', 'Nil', 'YES', 'NO', 'id', 'BOOL',
    'instancetype', 'IBAction', 'IBOutlet', 'in', 'out', 'inout', 'bycopy',
    'byref', 'oneway', 'class', 'namespace', 'template', 'public', 'private',
    'protected', 'using', 'new', 'delete', 'nullptr', 'auto',
}
OBJC_BUILTIN_TYPES = {
    'NSObject', 'NSString', 'NSArray', 'NSDictionary', 'NSData', 'NSNumber',
    'NSError', 'NSURL', 'UIImage', 'UIView', 'UIViewController', 'Class',
    'SEL', 'NSUInteger', 'NSInteger', 'CGFloat', 'Protocol',
}

RE_OBJC_IMPORT = re.compile(
    r'^\s*(?:#\s*(?:import|include)\s+["<](?P<hdr>[^">]+)[">]'
    r'|@import\s+(?P<mod>[\w.]+))',
    re.MULTILINE,
)

# @interface Name [: Super] [(Category)] [<Proto,...>]
RE_OBJC_INTERFACE = re.compile(
    r'@interface\s+(?P<name>[A-Za-z_]\w*)'
    r'(?:\s*\(\s*(?P<cat>\w*)\s*\))?'
    r'(?:\s*:\s*(?P<super>[A-Za-z_]\w*))?'
    r'(?:\s*<(?P<protos>[^>]*)>)?',
)
RE_OBJC_IMPL = re.compile(r'@implementation\s+(?P<name>[A-Za-z_]\w*)')
RE_OBJC_PROTOCOL = re.compile(
    r'@protocol\s+(?P<name>[A-Za-z_]\w*)(?:\s*<(?P<protos>[^>]*)>)?')

# C / C++ aggregate types
RE_OBJC_STRUCT = re.compile(
    r'(?:^|[\s;{}])(?:typedef\s+)?(?P<kind>struct|union|enum|class)\s+'
    r'(?P<name>[A-Za-z_]\w*)\s*(?:[:{])',
    re.MULTILINE,
)

# ObjC method: -/+ (retType) selector ...  ( { | ; )
RE_OBJC_METHOD = re.compile(
    r'^[ \t]*(?P<kind>[-+])\s*\(\s*[^)]*\)\s*'
    r'(?P<rest>[A-Za-z_][^{;]*?)\s*(?P<term>[{;])',
    re.MULTILINE,
)

# C function definition: RetType name(params) {
RE_OBJC_CFUNC = re.compile(
    r'^[ \t]*(?:(?:static|inline|extern|__attribute__\s*\(\([^)]*\)\))\s+)*'
    r'(?:[A-Za-z_][\w<>:*]*[\s*]+)+'
    r'(?P<name>[A-Za-z_]\w*)\s*'
    r'\((?P<params>[^;{}]*)\)\s*\{',
    re.MULTILINE,
)

RE_OBJC_CALL = re.compile(r'\b([A-Za-z_]\w*)\s*\(')

_RE_OBJC_BRANCH_KW = re.compile(r'\b(?:if|for|while|switch|case)\b')
_OBJC_FILE_EXTS = {
    '.json', '.yaml', '.yml', '.plist', '.xml', '.conf', '.cfg', '.strings',
    '.html', '.htm', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg',
    '.txt', '.md',
}
_OBJC_CONFIG_EXTS = {'.json', '.yaml', '.yml', '.plist', '.xml', '.conf', '.cfg', '.strings'}
RE_OBJC_FILE_REF = re.compile(
    r'\b(?:contentsOfFile|stringWithContentsOfFile|dataWithContentsOfFile|'
    r'imageNamed)\s*:\s*@?"(?P<path>[^"]+)"'
)
RE_OBJC_PROPERTY_TYPE = re.compile(
    r'@property\b[^\n;]*\)\s*(?P<type>[A-Za-z_]\w*(?:\s*<[^>]+>)?)\s*[*\s]+[A-Za-z_]\w*',
    re.MULTILINE,
)


def _mask_objc_source(src: str, mask_literals: bool = False) -> str:
    """Mask comments (and optionally literals); NON-nesting block comments."""
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
    return _mask_objc_source(src, mask_literals=False)


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _normalize_signature(src: str, start: int, end: int) -> str:
    return ' '.join(src[start:end].strip().split())


def _extract_type_refs(text: str) -> list:
    refs = []
    for name in re.findall(r'(?:\b[A-Za-z_]\w*\.)?\b([A-Z][A-Za-z_]\w*)\b', text):
        if name in OBJC_KEYWORDS or name in OBJC_BUILTIN_TYPES or len(name) < 3:
            continue
        refs.append(name)
    return list(dict.fromkeys(refs))


def _decorators_near(src: str, clean: str, decl_start: int) -> list:
    line_start = clean.rfind('\n', 0, decl_start) + 1
    prefix = src[line_start:decl_start]
    decorators = []
    if '__attribute__' in prefix:
        decorators.append('__attribute__')
    decorators.extend(re.findall(r'\b(NS_SWIFT_NAME|API_AVAILABLE|API_DEPRECATED|IBAction|IBOutlet)\b', prefix))
    src_lines = src[:line_start].splitlines()
    clean_lines = clean[:line_start].splitlines()
    i = len(src_lines) - 1
    while i >= 0:
        stripped = clean_lines[i].strip()
        if not stripped:
            i -= 1
            continue
        found = re.findall(r'\b(NS_SWIFT_NAME|API_AVAILABLE|API_DEPRECATED)\b', src_lines[i])
        if not found:
            break
        decorators[:0] = found
        i -= 1
    return list(dict.fromkeys(decorators))


def _path_edge_type(path: str):
    if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', path) or path.startswith(('/', '\\')):
        return None
    ext = '.' + path.rsplit('.', 1)[-1].lower() if '.' in path.rsplit('/', 1)[-1] else ''
    if ext not in _OBJC_FILE_EXTS:
        return None
    return 'config_ref' if ext in _OBJC_CONFIG_EXTS else 'asset_ref'


def _edge_hints(src: str, code: str) -> list:
    hints = []
    masked = _mask_objc_source(src, mask_literals=True)
    for m in RE_OBJC_FILE_REF.finditer(code):
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


def _parse_imports(src: str) -> list:
    refs = []
    for m in RE_OBJC_IMPORT.finditer(src):
        hdr = m.group('hdr')
        mod = m.group('mod')
        if hdr:
            base = hdr.split('/')[-1]
            ref = base[:-2] if base.endswith('.h') else base.rsplit('.', 1)[0]
        else:
            ref = mod.split('.')[-1] if mod else None
        if ref and len(ref) >= 2:
            refs.append(ref)
    return list(dict.fromkeys(refs))


def _selector_name(rest: str) -> str:
    """Build the canonical selector from a method header tail."""
    parts = re.findall(r'(\w+)\s*:', rest)
    if parts:
        return ':'.join(parts) + ':'
    m = re.match(r'\s*([A-Za-z_]\w*)', rest)
    return m.group(1) if m else ''


def _extract_calls(text: str, skip_starts=None) -> list:
    skip_starts = skip_starts or set()
    calls = []
    for m in RE_OBJC_CALL.finditer(text):
        name = m.group(1)
        if m.start(1) in skip_starts:
            continue
        if name in OBJC_KEYWORDS or len(name) < 2:
            continue
        calls.append(name)
    return calls


def _count_complexity(body: str) -> int:
    if not body:
        return 1
    count = 1
    count += len(_RE_OBJC_BRANCH_KW.findall(body))
    count += body.count('&&')
    count += body.count('||')
    count += body.count('?')
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


def _end_at(clean: str, after: int) -> int:
    m = re.search(r'@end', clean[after:])
    return after + m.end() if m else after


def _parse_types(src: str, clean: str):
    """Return (symbols, ranges). A class may yield one symbol (from its
    @interface, which carries bases) plus several ranges (@interface and
    @implementation), so methods in the @implementation get a parent."""
    symbols = []
    ranges = []
    sym_seen = set()

    def add_symbol(kind, name, start, end_idx, bases):
        if name in sym_seen:
            return
        sym_seen.add(name)
        body = clean[start:end_idx]
        prop_refs = []
        for pm in RE_OBJC_PROPERTY_TYPE.finditer(body):
            prop_refs.extend(_extract_type_refs(pm.group('type')))
        symbols.append({
            'kind': kind,
            'name': name,
            'line': _line_no(src, start),
            'end_line': _line_no(src, max(start, end_idx - 1)),
            'bases': bases,
            'type_refs': list(dict.fromkeys(bases + prop_refs)),
            'parent': None,
            'is_public': True,
            'doc': None,
            'signature': _normalize_signature(src, start, min(end_idx, clean.find('\n', start) if clean.find('\n', start) != -1 else end_idx)),
            'decorators': _decorators_near(src, clean, start),
        })

    # @interface first — it carries the superclass / protocol list.
    for m in RE_OBJC_INTERFACE.finditer(clean):
        name = m.group('name')
        bases = []
        if m.group('super'):
            bases.append(m.group('super'))
        if m.group('protos'):
            bases += [p.strip() for p in m.group('protos').split(',') if p.strip()]
        end_idx = _end_at(clean, m.end())
        add_symbol('class', name, m.start('name'), end_idx, bases)
        ranges.append((m.start('name'), end_idx, name))

    # @implementation — register its range for method parenting; only add a
    # symbol if no matching @interface was seen (e.g. interface lives in a .h).
    for m in RE_OBJC_IMPL.finditer(clean):
        name = m.group('name')
        end_idx = _end_at(clean, m.end())
        add_symbol('class', name, m.start('name'), end_idx, [])
        ranges.append((m.start('name'), end_idx, name))

    for m in RE_OBJC_PROTOCOL.finditer(clean):
        name = m.group('name')
        bases = []
        if m.group('protos'):
            bases = [p.strip() for p in m.group('protos').split(',') if p.strip()]
        end_idx = _end_at(clean, m.end())
        add_symbol('protocol', name, m.start('name'), end_idx, bases)
        ranges.append((m.start('name'), end_idx, name))

    for m in RE_OBJC_STRUCT.finditer(clean):
        name = m.group('name')
        if name in OBJC_KEYWORDS:
            continue
        kind = m.group('kind')
        open_idx = clean.find('{', m.end() - 1)
        end_idx = _brace_range(clean, open_idx) if open_idx != -1 else m.end()
        add_symbol('struct' if kind in ('struct', 'union') else kind,
                   name, m.start('name'), end_idx, [])
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


def scan_objc(src: str, ext: str = '.m') -> tuple:
    """Objective-C / Objective-C++ analysis. Returns the VIZCODE 6-tuple."""
    import_src = _strip_comments(src)
    clean = _mask_objc_source(src, mask_literals=True)
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

    def add_method(name, start_idx, body_open, kind):
        if not name:
            return
        line_no = _line_no(src, start_idx)
        key = (name, line_no)
        if key in seen:
            return
        seen.add(key)
        decl_name_starts.add(start_idx)
        if body_open != -1:
            end = _brace_range(clean, body_open)
            body = clean[body_open + 1:end - 1]
            end_line = _line_no(src, end - 1)
        else:
            body = ''
            end_line = line_no
        calls = _extract_calls(body)
        parent = _enclosing(type_ranges, start_idx)
        sig_end = body_open if body_open != -1 else clean.find('\n', start_idx)
        if sig_end == -1:
            sig_end = len(clean)
        funcdefs.append({'label': name, 'is_efiapi': False, 'is_static': kind == 'class_method'})
        func_calls_by_func.append(calls)
        method_symbols.append({
            'kind': 'method' if parent else 'function',
            'name': name,
            'line': line_no,
            'end_line': end_line,
            'bases': [],
            'parent': parent,
            'is_public': True,
            'doc': docs.get(line_no),
            'complexity': _count_complexity(body),
            'signature': _normalize_signature(src, start_idx, sig_end),
            'decorators': _decorators_near(src, clean, start_idx),
            'type_refs': _extract_type_refs(src[start_idx:sig_end]),
        })

    for m in RE_OBJC_METHOD.finditer(clean):
        name = _selector_name(m.group('rest'))
        if not name or name in OBJC_KEYWORDS:
            continue
        body_open = m.end() - 1 if m.group('term') == '{' else -1
        kind = 'class_method' if m.group('kind') == '+' else 'method'
        add_method(name, m.start('rest'), body_open, kind)

    for m in RE_OBJC_CFUNC.finditer(clean):
        name = m.group('name')
        if name in OBJC_KEYWORDS:
            continue
        add_method(name, m.start('name'), m.end() - 1, 'function')

    symbol_defs = type_symbols + method_symbols
    all_calls = _extract_calls(clean, decl_name_starts)

    docstrings = {}
    for sym in symbol_defs:
        if sym.get('doc'):
            key = f"{sym['parent']}.{sym['name']}" if sym['parent'] else sym['name']
            docstrings[key] = sym['doc']

    extra = {'imports': imports, 'lang': 'objc' if ext == '.m' else 'objcpp'}
    hints = _edge_hints(src, import_src)
    if hints:
        extra['edge_hints'] = hints
    if docstrings:
        extra['docstrings'] = docstrings

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs
