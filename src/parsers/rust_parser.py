#!/usr/bin/env python3
"""
parsers/rust_parser.py - VIZCODE Rust Language Parser

Extracts:
  imports             - referenced names from `use`, `mod`, `extern crate`
  funcdefs            - `fn` items (free functions and impl methods)
  funccalls           - call and macro-invocation expressions
  func_calls_by_func  - per-function call lists (body-scoped via brace matching)
  symbol_defs         - struct / enum / trait / union / type / impl-method / mod / fn

Rust visibility:
  `pub` items   -> is_public True
  private items -> is_static True (shown as 'static' in UI)

Syntax verified against The Rust Reference (Lexical structure / Comments /
Tokens): line `//`, doc `///` `//!`, block `/* */` comments that DO nest;
string, raw string `r#"..."#`, byte `b"..."`, raw byte `br#"..."#`, C string
`c"..."`, char, and byte literals; and the lifetime (`'a`) vs char-literal
(`'a'`) disambiguation.
"""

import re


# File extensions handled by this parser (consumed by analyze_viz dispatch).
RUST_EXTENSIONS = {'.rs'}


# Rust keywords / primitives / common control words to skip as call targets.
RUST_KEYWORDS = {
    'as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn',
    'else', 'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl', 'in', 'let',
    'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return', 'self',
    'Self', 'static', 'struct', 'super', 'trait', 'true', 'type', 'union',
    'unsafe', 'use', 'where', 'while', 'macro', 'box', 'try', 'yield',
    'bool', 'char', 'str', 'u8', 'u16', 'u32', 'u64', 'u128', 'usize',
    'i8', 'i16', 'i32', 'i64', 'i128', 'isize', 'f32', 'f64',
}

# Built-in macros that would create noisy edges; user macros are kept.
RUST_BUILTIN_MACROS = {
    'println', 'print', 'eprintln', 'eprint', 'format', 'write', 'writeln',
    'vec', 'panic', 'assert', 'assert_eq', 'assert_ne', 'debug_assert',
    'debug_assert_eq', 'debug_assert_ne', 'unreachable', 'unimplemented',
    'todo', 'dbg', 'matches', 'include_str', 'include_bytes', 'concat',
    'stringify', 'env', 'cfg', 'line', 'column', 'file', 'format_args',
}

RE_RUST_FN = re.compile(r'\bfn\s+(?P<name>[A-Za-z_]\w*)\s*(?:<[^>{}();]*>)?\s*\(')
RE_RUST_USE = re.compile(r'\buse\s+([^;]+);')
RE_RUST_MOD_FILE = re.compile(r'^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;', re.MULTILINE)
RE_RUST_MOD_INLINE = re.compile(r'^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*\{', re.MULTILINE)
RE_RUST_EXTERN_CRATE = re.compile(r'\bextern\s+crate\s+(\w+)')

RE_RUST_STRUCT = re.compile(r'\bstruct\s+(\w+)')
RE_RUST_ENUM = re.compile(r'\benum\s+(\w+)')
RE_RUST_UNION = re.compile(r'\bunion\s+(\w+)')
RE_RUST_TRAIT = re.compile(r'\btrait\s+(\w+)(?P<rest>[^{;]*)[{;]')
RE_RUST_TYPE_ALIAS = re.compile(r'\btype\s+(\w+)\s*(?:<[^>]*>)?\s*=\s*([^;]+);')
RE_RUST_IMPL = re.compile(
    r'\bimpl\b(?:\s*<[^>{]*>)?\s*'
    r'(?:(?P<trait>[\w:]+)(?:<[^>{]*>)?\s+for\s+)?'
    r'(?P<type>[\w:]+)'
)

RE_RUST_CALL = re.compile(r'\b([A-Za-z_]\w*)\s*\(')
RE_RUST_MACRO = re.compile(r'\b([a-z_]\w*)\s*!(?!=)')
RE_RUST_INCLUDE_MACRO = re.compile(r'\b(include_str|include_bytes|include)\s*!\s*\(')
RE_RUST_REF_CALL = re.compile(r'\b(?:[A-Za-z_]\w*::)*(?P<call>[A-Za-z_]\w*)\s*\(')

_RE_RUST_BRANCH_KW = re.compile(r'\b(?:if|while|for|loop|match)\b')
_RE_RUST_IDENT = re.compile(r'[A-Za-z_]\w*')

RUST_TYPE_BUILTINS = frozenset({
    'Self', 'Box', 'Vec', 'String', 'str', 'Option', 'Result', 'HashMap',
    'BTreeMap', 'HashSet', 'BTreeSet', 'Cow', 'Arc', 'Rc', 'RefCell',
    'Cell', 'Pin', 'PhantomData', 'Error', 'Duration', 'Path', 'PathBuf',
    'OsStr', 'OsString',
})


def _ident_char(ch: str) -> bool:
    return ch.isalnum() or ch == '_'


def _mask_rust_source(src: str, mask_literals: bool = False) -> str:
    """Mask comments (and optionally literals) while preserving offsets/newlines.

    Handles nested block comments, raw strings with matching `#` counts, byte/C
    string prefixes, and distinguishes lifetimes (`'a`) from char literals
    (`'a'`) so neither corrupts the masked output.
    """
    out = list(src)
    i = 0
    n = len(src)

    def blank_span(start: int, end: int) -> None:
        for j in range(start, min(end, n)):
            if out[j] != '\n':
                out[j] = ' '

    def scan_quoted(start_quote: int) -> int:
        """Scan a normal (escaped) string/char from its opening quote."""
        q = src[start_quote]
        j = start_quote + 1
        while j < n:
            if src[j] == '\\':
                j += 2
                continue
            if src[j] == q:
                return j + 1
            j += 1
        return n

    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ''
        prev = src[i - 1] if i > 0 else ''

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

        # Raw / byte / C string prefixes at a token boundary.
        if c in ('r', 'b', 'c') and not _ident_char(prev):
            j = i
            if src[j] in ('b', 'c'):
                j += 1
            is_raw = j < n and src[j] == 'r'
            if is_raw:
                j += 1
                hashes = 0
                while j < n and src[j] == '#':
                    hashes += 1
                    j += 1
                if j < n and src[j] == '"':
                    close = '"' + '#' * hashes
                    end_idx = src.find(close, j + 1)
                    end = end_idx + len(close) if end_idx != -1 else n
                    if mask_literals:
                        blank_span(i, end)
                    i = end
                    continue
            # Non-raw byte/C string: b"..." or c"..."
            if c in ('b', 'c') and nxt == '"':
                end = scan_quoted(i + 1)
                if mask_literals:
                    blank_span(i, end)
                i = end
                continue
            # Byte char: b'x'
            if c == 'b' and nxt == "'":
                end = scan_quoted(i + 1)
                if mask_literals:
                    blank_span(i, end)
                i = end
                continue

        if c == '"':
            end = scan_quoted(i)
            if mask_literals:
                blank_span(i, end)
            i = end
            continue

        if c == "'":
            # Lifetime vs char literal.
            if nxt == '\\':
                end = scan_quoted(i)
                if mask_literals:
                    blank_span(i, end)
                i = end
                continue
            if nxt.isalpha() or nxt == '_':
                j = i + 1
                while j < n and _ident_char(src[j]):
                    j += 1
                if j < n and src[j] == "'" and j == i + 2:
                    if mask_literals:
                        blank_span(i, j + 1)
                    i = j + 1
                    continue
                # lifetime: consume just the quote
                i += 1
                continue
            # other char literal: '!', ' ', etc.
            end = scan_quoted(i)
            if mask_literals:
                blank_span(i, end)
            i = end
            continue

        i += 1

    return ''.join(out)


def _strip_comments(src: str) -> str:
    return _mask_rust_source(src, mask_literals=False)


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


_RUST_CONFIG_EXTS = {'.rs', '.toml', '.json', '.yaml', '.yml'}
_RUST_ASSET_EXTS = {'.html', '.htm', '.css', '.scss', '.sass', '.less', '.svg',
                    '.png', '.jpg', '.jpeg', '.gif', '.csv', '.sql', '.xml',
                    '.txt'}
_RUST_FILE_CALLERS = {'read_to_string', 'read', 'open'}


def _clean_local_path(path: str):
    ref = (path or '').strip().replace('\\', '/')
    if not ref:
        return None
    low = ref.lower()
    if low.startswith(('http://', 'https://', '//', 'data:')):
        return None
    if ref.startswith('$') or any(ch in ref for ch in '*?[]{}'):
        return None
    return ref


def _path_ext(ref: str) -> str:
    last = ref.rstrip('/').rsplit('/', 1)[-1]
    if '.' not in last:
        return ''
    return '.' + last.rsplit('.', 1)[-1].lower()


def _parse_rust_string_literal(src: str, idx: int):
    n = len(src)
    if idx >= n:
        return None, idx
    if src[idx] == '"':
        out = []
        i = idx + 1
        while i < n:
            ch = src[i]
            if ch == '\\':
                if i + 1 < n:
                    out.append(src[i + 1])
                    i += 2
                    continue
                return None, i
            if ch == '"':
                return ''.join(out), i + 1
            out.append(ch)
            i += 1
        return None, n
    if src[idx] == 'r':
        i = idx + 1
        hashes = 0
        while i < n and src[i] == '#':
            hashes += 1
            i += 1
        if i >= n or src[i] != '"':
            return None, idx
        close = '"' + '#' * hashes
        body_start = i + 1
        end = src.find(close, body_start)
        if end == -1:
            return None, n
        return src[body_start:end], end + len(close)
    return None, idx


def _hint(edge_type: str, target: str, subtype: str, via: str, line: int) -> dict:
    return {
        'type': edge_type,
        'target': target,
        'subtype': subtype,
        'via': via,
        'line': line,
        'confidence': 1.0,
    }


def _classify_file_ref(ref: str) -> str | None:
    ext = _path_ext(ref)
    if ext in _RUST_CONFIG_EXTS:
        return 'config_ref'
    if ext in _RUST_ASSET_EXTS:
        return 'asset_ref'
    return None


def _parse_include_edge_hints(src: str) -> list:
    hints = []
    n = len(src)
    for m in RE_RUST_INCLUDE_MACRO.finditer(src):
        i = m.end()
        while i < n and src[i].isspace():
            i += 1
        raw, _end = _parse_rust_string_literal(src, i)
        ref = _clean_local_path(raw or '')
        if not ref:
            continue
        macro = m.group(1)
        line = _line_no(src, m.start())
        if macro == 'include_str':
            hints.append(_hint('asset_ref', ref, 'embedded_text', 'include_str!', line))
        elif macro == 'include_bytes':
            hints.append(_hint('asset_ref', ref, 'embedded_bytes', 'include_bytes!', line))
        elif _path_ext(ref) in _RUST_CONFIG_EXTS:
            hints.append(_hint('config_ref', ref, 'rust_include', 'include!', line))
    deduped = {}
    for hint in hints:
        deduped[(hint['type'], hint['target'], hint['subtype'], hint['via'], hint['line'])] = hint
    return list(deduped.values())


def _parse_file_edge_hints(src: str, masked_full: str) -> list:
    hints = []
    n = len(src)
    for m in RE_RUST_REF_CALL.finditer(src):
        call = m.group('call')
        if call not in _RUST_FILE_CALLERS:
            continue
        cs = m.start('call')
        if masked_full[cs:cs + len(call)] != call:
            continue
        i = m.end()
        while i < n and src[i].isspace():
            i += 1
        raw, _end = _parse_rust_string_literal(src, i)
        ref = _clean_local_path(raw or '')
        if not ref:
            continue
        etype = _classify_file_ref(ref)
        if not etype:
            continue
        hints.append(_hint(etype, ref, 'file_io', call, _line_no(src, m.start())))
    deduped = {}
    for hint in hints:
        deduped[(hint['type'], hint['target'], hint['via'], hint['line'])] = hint
    return list(deduped.values())


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


def _brace_body(src: str, open_idx: int) -> str:
    end = _brace_range(src, open_idx)
    if end <= open_idx:
        return ''
    return src[open_idx + 1:end - 1]


def _body_open_after(src: str, start: int) -> int:
    """Index of the body '{' after a signature, or -1 if the item ends in ';'
    (trait method without body) before any brace."""
    depth_angle = 0
    i = start
    n = len(src)
    while i < n:
        c = src[i]
        if c == '<':
            depth_angle += 1
        elif c == '>':
            if depth_angle > 0:
                depth_angle -= 1
        elif c == '{' and depth_angle == 0:
            return i
        elif c == ';' and depth_angle == 0:
            return -1
        i += 1
    return -1


def _parse_imports(src: str) -> list:
    """Collect referenced leaf names from use/mod/extern-crate statements."""
    refs = []

    for m in RE_RUST_USE.finditer(src):
        refs.extend(_expand_use_tree(m.group(1).strip()))

    for m in RE_RUST_MOD_FILE.finditer(src):
        refs.append(m.group(1))

    for m in RE_RUST_EXTERN_CRATE.finditer(src):
        refs.append(m.group(1))

    out = []
    for r in refs:
        if r and r not in RUST_KEYWORDS and len(r) >= 2:
            out.append(r)
    return list(dict.fromkeys(out))


def _expand_use_tree(tree: str) -> list:
    """Flatten a use-tree into referenced leaf names.

    Handles `a::b::C`, `a::b::{c, d}`, `a::b::*`, and `x as y`.
    """
    tree = tree.strip()
    if not tree:
        return []
    if tree.startswith('pub'):
        tree = re.sub(r'^pub(?:\([^)]*\))?\s+', '', tree)

    brace = tree.find('{')
    if brace != -1 and tree.rstrip().endswith('}'):
        inner = tree[brace + 1:tree.rfind('}')]
        names = []
        for part in _split_top_level(inner):
            names.extend(_expand_use_tree(part.strip()))
        return names

    # Simple path: a::b::leaf [as alias]
    seg = tree.split(' as ')[0].strip()
    parts = [p for p in seg.split('::') if p]
    if not parts:
        return []
    leaf = parts[-1]
    if leaf == '*':
        leaf = parts[-2] if len(parts) >= 2 else ''
    if leaf in ('self', 'crate', 'super'):
        leaf = parts[-2] if len(parts) >= 2 else ''
    return [leaf] if leaf else []


def _split_top_level(text: str) -> list:
    """Split on commas not nested inside braces."""
    parts = []
    depth = 0
    buf = []
    for ch in text:
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
        if ch == ',' and depth == 0:
            parts.append(''.join(buf))
            buf = []
        else:
            buf.append(ch)
    if buf:
        parts.append(''.join(buf))
    return parts


def _is_pub(clean: str, decl_start: int) -> bool:
    """Look back from a declaration keyword for a `pub` visibility modifier."""
    line_start = clean.rfind('\n', 0, decl_start) + 1
    prefix = clean[line_start:decl_start]
    return bool(re.search(r'\bpub\b', prefix))


def _extract_calls(text: str, skip_starts: set | None = None) -> list:
    skip_starts = skip_starts or set()
    calls = []
    for m in RE_RUST_CALL.finditer(text):
        name = m.group(1)
        if m.start(1) in skip_starts:
            continue
        if name in RUST_KEYWORDS or len(name) < 2:
            continue
        calls.append(name)
    for m in RE_RUST_MACRO.finditer(text):
        name = m.group(1)
        if name in RUST_KEYWORDS or name in RUST_BUILTIN_MACROS or len(name) < 2:
            continue
        calls.append(name)
    return calls


def _count_complexity(body: str) -> int:
    if not body:
        return 1
    count = 1
    count += len(_RE_RUST_BRANCH_KW.findall(body))
    count += body.count('&&')
    count += body.count('||')
    return count


def _match_paren(src: str, open_idx: int) -> int:
    if open_idx < 0 or open_idx >= len(src) or src[open_idx] != '(':
        return -1
    depth = 0
    for i in range(open_idx, len(src)):
        if src[i] == '(':
            depth += 1
        elif src[i] == ')':
            depth -= 1
            if depth == 0:
                return i
    return -1


def _item_body_open(src: str, start: int) -> int:
    depth_angle = 0
    depth_paren = 0
    i = start
    while i < len(src):
        c = src[i]
        if c == '<':
            depth_angle += 1
        elif c == '>':
            depth_angle = max(0, depth_angle - 1)
        elif c == '(':
            depth_paren += 1
        elif c == ')':
            depth_paren = max(0, depth_paren - 1)
        elif c == '{' and depth_angle == 0 and depth_paren == 0:
            return i
        elif c == ';' and depth_angle == 0 and depth_paren == 0:
            return -1
        i += 1
    return -1


def _split_commas_top_level(text: str) -> list:
    parts = []
    buf = []
    depth_angle = depth_paren = depth_bracket = 0
    for ch in text:
        if ch == '<':
            depth_angle += 1
        elif ch == '>':
            depth_angle = max(0, depth_angle - 1)
        elif ch == '(':
            depth_paren += 1
        elif ch == ')':
            depth_paren = max(0, depth_paren - 1)
        elif ch == '[':
            depth_bracket += 1
        elif ch == ']':
            depth_bracket = max(0, depth_bracket - 1)
        if ch == ',' and depth_angle == depth_paren == depth_bracket == 0:
            parts.append(''.join(buf))
            buf = []
        else:
            buf.append(ch)
    if buf:
        parts.append(''.join(buf))
    return parts


def _filter_type_refs(names) -> list:
    out = []
    for name in sorted(set(names)):
        if not name or len(name) < 3 or not name[0].isupper():
            continue
        if name in RUST_TYPE_BUILTINS or name in RUST_KEYWORDS:
            continue
        out.append(name)
    return out


def _collect_type_names(type_src: str, out: set) -> None:
    if not type_src:
        return
    cleaned = re.sub(r"'[A-Za-z_]\w*", ' ', type_src)
    cleaned = re.sub(r'\b(?:mut|ref|dyn|impl|where|for|const|pub)\b', ' ', cleaned)
    for ident in _RE_RUST_IDENT.findall(cleaned):
        if ident in RUST_KEYWORDS:
            continue
        out.add(ident.split('::')[-1])


def _extract_signature(clean: str, paren_open_idx: int):
    type_names = set()
    params_close = _match_paren(clean, paren_open_idx)
    if params_close == -1:
        return '', type_names
    params_src = clean[paren_open_idx + 1:params_close]
    body_open = _body_open_after(clean, params_close)
    semi = clean.find(';', params_close)
    end = body_open if body_open != -1 else semi
    if end == -1:
        end = clean.find('\n', params_close)
    if end == -1:
        end = len(clean)
    result_src = clean[params_close + 1:end].strip()
    result_src = result_src.split('where')[0].strip()
    if result_src.startswith('->'):
        result_type = result_src[2:].strip()
    else:
        result_type = ''

    for part in _split_commas_top_level(params_src):
        part = part.strip()
        if not part or part in ('self', '&self', '&mut self'):
            continue
        part = re.sub(r'#\s*\[[^\]]*\]\s*', '', part)
        if ':' in part:
            _collect_type_names(part.split(':', 1)[1], type_names)
        else:
            _collect_type_names(part, type_names)
    _collect_type_names(result_type, type_names)

    sig = f"({' '.join(params_src.split())})"
    if result_type:
        sig += ' -> ' + ' '.join(result_type.split())
    return sig, type_names


def _decorators_before(masked: str, decl_start: int) -> list:
    line_start = masked.rfind('\n', 0, decl_start) + 1
    names = []
    cursor = line_start
    while cursor > 0:
        prev_line_start = masked.rfind('\n', 0, cursor - 1) + 1
        line = masked[prev_line_start:cursor - 1]
        stripped = line.strip()
        if not stripped:
            cursor = prev_line_start
            continue
        if not (stripped.startswith('#[') and stripped.endswith(']')):
            break
        body = stripped[2:-1].strip()
        name = body.split('(', 1)[0].split('=', 1)[0].strip()
        name = name.split('::')[-1]
        if name and name not in RUST_KEYWORDS:
            names.insert(0, name)
        cursor = prev_line_start
    return list(dict.fromkeys(names))


def _struct_type_refs(clean: str, start: int, open_idx: int) -> list:
    names = set()
    if open_idx != -1:
        body = _brace_body(clean, open_idx)
        for line in body.splitlines():
            line = line.split('//', 1)[0].strip().rstrip(',')
            if not line or line.startswith('#['):
                continue
            if ':' in line:
                _collect_type_names(line.split(':', 1)[1], names)
        return _filter_type_refs(names)
    semi = clean.find(';', start)
    header = clean[start:semi] if semi != -1 else clean[start:]
    paren = header.find('(')
    if paren != -1:
        close = _match_paren(header, paren)
        fields = header[paren + 1:close if close != -1 else len(header)]
        for part in _split_commas_top_level(fields):
            _collect_type_names(part, names)
    return _filter_type_refs(names)


def _enum_type_refs(clean: str, open_idx: int) -> list:
    names = set()
    if open_idx == -1:
        return []
    body = _brace_body(clean, open_idx)
    for line in body.splitlines():
        line = line.strip().rstrip(',')
        if not line or line.startswith('#['):
            continue
        if '(' in line:
            start = line.find('(')
            end = _match_paren(line, start)
            _collect_type_names(line[start + 1:end if end != -1 else len(line)], names)
        elif '{' in line and '}' in line:
            _collect_type_names(line[line.find('{') + 1:line.rfind('}')], names)
    return _filter_type_refs(names)


def _trait_bases(rest: str) -> list:
    rest = rest.strip()
    if not rest.startswith(':'):
        return []
    clause = re.sub(r'<[^>]*>', '', rest[1:])
    clause = clause.split('where')[0]
    bases = []
    for part in re.split(r'[+,]', clause):
        name = part.strip().split('::')[-1].strip()
        if name and name not in RUST_KEYWORDS:
            bases.append(name)
    return list(dict.fromkeys(bases))


def _doc_above(src: str, line_no: int, doc_lines: dict) -> str | None:
    """Collect a contiguous `///` doc block ending just above line_no."""
    group = []
    ln = line_no - 1
    while ln in doc_lines:
        group.insert(0, doc_lines[ln])
        ln -= 1
    return '\n'.join(group).strip() or None if group else None


def _scan_doc_lines(src: str) -> dict:
    """Map line number -> `///` outer doc text on that line."""
    docs = {}
    for idx, line in enumerate(src.splitlines(), start=1):
        s = line.strip()
        if s.startswith('///'):
            docs[idx] = s[3:].strip()
    return docs


def _parse_impl_ranges(src: str, clean: str):
    """Return list of (start, end, type_name, trait_name) for impl blocks."""
    ranges = []
    for m in RE_RUST_IMPL.finditer(clean):
        type_name = m.group('type').split('::')[-1]
        trait_name = (m.group('trait') or '').split('::')[-1]
        open_idx = clean.find('{', m.end())
        if open_idx == -1:
            continue
        end = _brace_range(clean, open_idx)
        ranges.append((m.start(), end, type_name, trait_name))
    return ranges


def _enclosing_impl(ranges: list, idx: int) -> str | None:
    best = None
    best_span = None
    for start, end, name, _trait in ranges:
        if start <= idx < end:
            span = end - start
            if best_span is None or span < best_span:
                best_span = span
                best = name
    return best


def scan_rust(src: str, ext: str = '.rs') -> tuple:
    """Rust file analysis.

    Returns: (imports, funcdefs, all_calls, extra_dict, func_calls_by_func, symbol_defs)
    """
    import_src = _strip_comments(src)
    clean = _mask_rust_source(src, mask_literals=True)
    doc_lines = _scan_doc_lines(src)

    imports = _parse_imports(import_src)
    impl_ranges = _parse_impl_ranges(src, clean)

    symbol_defs = []
    type_name_starts = set()

    def add_type(kind, name, start, end_idx, bases=None, type_refs=None):
        line_no = _line_no(src, start)
        symbol_defs.append({
            'kind': kind,
            'name': name,
            'line': line_no,
            'end_line': _line_no(src, max(start, end_idx - 1)),
            'bases': bases or [],
            'parent': None,
            'is_public': _is_pub(clean, start),
            'doc': _doc_above(src, line_no, doc_lines),
            'decorators': _decorators_before(clean, start),
            'type_refs': type_refs or [],
        })

    for m in RE_RUST_STRUCT.finditer(clean):
        open_idx = _item_body_open(clean, m.end())
        end = _brace_range(clean, open_idx) if open_idx != -1 else m.end()
        add_type('struct', m.group(1), m.start(), end,
                 type_refs=_struct_type_refs(clean, m.start(), open_idx))
        type_name_starts.add(m.start(1))
    for m in RE_RUST_ENUM.finditer(clean):
        open_idx = _item_body_open(clean, m.end())
        end = _brace_range(clean, open_idx) if open_idx != -1 else m.end()
        add_type('enum', m.group(1), m.start(), end,
                 type_refs=_enum_type_refs(clean, open_idx))
        type_name_starts.add(m.start(1))
    for m in RE_RUST_UNION.finditer(clean):
        open_idx = _item_body_open(clean, m.end())
        end = _brace_range(clean, open_idx) if open_idx != -1 else m.end()
        add_type('union', m.group(1), m.start(), end,
                 type_refs=_struct_type_refs(clean, m.start(), open_idx))
        type_name_starts.add(m.start(1))
    for m in RE_RUST_TRAIT.finditer(clean):
        open_idx = clean.find('{', m.end() - 1)
        end = _brace_range(clean, open_idx) if open_idx != -1 else m.end()
        add_type('trait', m.group(1), m.start(), end, _trait_bases(m.group('rest')))
        type_name_starts.add(m.start(1))
    for m in RE_RUST_TYPE_ALIAS.finditer(clean):
        target = m.group(2).strip().split('::')[-1].split('<')[0].strip()
        line_no = _line_no(src, m.start())
        type_name_starts.add(m.start(1))
        alias_type_names = set()
        _collect_type_names(m.group(2), alias_type_names)
        symbol_defs.append({
            'kind': 'typedef',
            'name': m.group(1),
            'line': line_no,
            'end_line': line_no,
            'bases': [target] if target else [],
            'parent': None,
            'is_public': _is_pub(clean, m.start()),
            'doc': _doc_above(src, line_no, doc_lines),
            'decorators': _decorators_before(clean, m.start()),
            'type_refs': _filter_type_refs(alias_type_names),
        })
    for m in RE_RUST_MOD_INLINE.finditer(clean):
        open_idx = clean.find('{', m.end() - 1)
        end = _brace_range(clean, open_idx) if open_idx != -1 else m.end()
        add_type('module', m.group(1), m.start(), end)

    symbol_by_name = {s['name']: s for s in symbol_defs if s.get('kind') in ('struct', 'enum', 'union', 'typedef')}
    for _start, _end, type_name, trait_name in impl_ranges:
        if not trait_name or trait_name in RUST_KEYWORDS:
            continue
        target = symbol_by_name.get(type_name)
        if target and trait_name not in target['bases']:
            target['bases'].append(trait_name)

    # Functions / methods.
    funcdefs = []
    func_calls_by_func = []
    decl_name_starts = set()
    seen = set()

    for m in RE_RUST_FN.finditer(clean):
        name = m.group('name')
        if name in RUST_KEYWORDS:
            continue
        start = m.start('name')
        line_no = _line_no(src, start)
        key = (name, line_no)
        if key in seen:
            continue
        seen.add(key)
        decl_name_starts.add(start)

        body_open = _body_open_after(clean, m.end() - 1)
        if body_open != -1:
            body = clean[body_open + 1:_brace_range(clean, body_open) - 1]
            end_line = _line_no(src, _brace_range(clean, body_open) - 1)
        else:
            body = ''
            end_line = line_no
        calls = _extract_calls(body)
        is_public = _is_pub(clean, start)
        signature, type_names = _extract_signature(clean, m.end() - 1)

        funcdefs.append({
            'label': name,
            'is_efiapi': False,
            'is_static': not is_public,
        })
        func_calls_by_func.append(calls)
        parent = _enclosing_impl(impl_ranges, start)
        symbol_defs.append({
            'kind': 'method' if parent else 'function',
            'name': name,
            'line': line_no,
            'end_line': end_line,
            'bases': [],
            'parent': parent,
            'is_public': is_public,
            'doc': _doc_above(src, line_no, doc_lines),
            'complexity': _count_complexity(body),
            'decorators': _decorators_before(clean, m.start()),
            'signature': signature,
            'type_refs': _filter_type_refs(type_names),
        })

    all_calls = _extract_calls(clean, decl_name_starts | type_name_starts)

    docstrings = {}
    for sym in symbol_defs:
        if sym.get('doc'):
            key = f"{sym['parent']}.{sym['name']}" if sym['parent'] else sym['name']
            docstrings[key] = sym['doc']

    extra = {
        'imports': imports,
        'lang': 'rust',
    }
    if docstrings:
        extra['docstrings'] = docstrings
    edge_hints = _parse_include_edge_hints(import_src)
    edge_hints += _parse_file_edge_hints(import_src, clean)
    if edge_hints:
        extra['edge_hints'] = edge_hints

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs
