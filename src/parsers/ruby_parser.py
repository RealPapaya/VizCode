#!/usr/bin/env python3
"""
parsers/ruby_parser.py - VIZCODE Ruby Language Parser

Extracts:
  imports             - `require`/`require_relative "x"` → file stem
  funcdefs            - `def name`, `def self.name`, `def Klass.name`
  funccalls           - call expressions
  func_calls_by_func  - per-method call lists (body-scoped via `end` matching)
  symbol_defs         - class / module / method / function

Ruby blocks close with `end`, so bodies are delimited by keyword-depth scanning.
Syntax verified against the Ruby core docs:
  https://docs.ruby-lang.org/en/master/syntax/modules_and_classes_rdoc.html
  https://docs.ruby-lang.org/en/master/syntax/methods_rdoc.html
  https://docs.ruby-lang.org/en/master/syntax/literals_rdoc.html
  https://docs.ruby-lang.org/en/master/File.html
  * comments are `#` line and `=begin`/`=end` block (column-0 only);
  * string forms `"`, `'`, backtick, `%w[]`/`%i[]`/`%q{}`/`%Q{}` percent literals,
    and `<<~`/`<<-`/`<<` heredocs can all contain `end`/`def` lookalikes and are
    masked before structural scanning;
  * `if`/`unless`/`while`/`until`/`for` open a block only when statement-leading
    (so trailing modifiers like `x if y` don't shift `end` matching).
"""

import re

RUBY_EXTENSIONS = {'.rb'}

RUBY_KEYWORDS = {
    'def', 'class', 'module', 'end', 'if', 'elsif', 'else', 'unless', 'while',
    'until', 'for', 'case', 'when', 'begin', 'rescue', 'ensure', 'do', 'then',
    'in', 'return', 'yield', 'self', 'nil', 'true', 'false', 'and', 'or', 'not',
    'require', 'require_relative', 'attr_accessor', 'attr_reader', 'attr_writer',
    'puts', 'print', 'p', 'raise', 'new', 'lambda', 'proc', 'loop', 'super',
    'include', 'extend', 'prepend', 'private', 'public', 'protected',
}

RE_RUBY_REQUIRE = re.compile(
    r'''\b(require(?:_relative)?)\s*\(?\s*['"]([^'"]+)['"]''')
RE_RUBY_FILE_REF = re.compile(
    r'''\b(?:File\.(?:read|open|binread)|YAML\.load_file|JSON\.parse\s*\(?\s*File\.read)\s*\(?\s*['"](?P<path>[^'"]+)['"]''')
RE_RUBY_DEF = re.compile(
    r'\bdef\s+(?:(self|[A-Za-z_]\w*)\s*\.\s*)?([A-Za-z_]\w*[?!=]?)')
RE_RUBY_TYPE = re.compile(
    r'^[ \t]*(class|module)\s+([A-Za-z_][\w:]*)(\s*<\s*([A-Za-z_][\w:]*))?',
    re.MULTILINE)
RE_RUBY_MIXIN = re.compile(
    r'^[ \t]*(include|extend|prepend)\s+([A-Za-z_][\w:]*(?:\s*,\s*[A-Za-z_][\w:]*)*)',
    re.MULTILINE)
RE_RUBY_CALL = re.compile(r'\b([A-Za-z_]\w*[?!]?)\s*[\(]')
RE_WORD = re.compile(r'\b[A-Za-z_]\w*\b')
_RE_RUBY_BRANCH_KW = re.compile(
    r'\b(?:if|elsif|unless|while|until|for|when|and|or|rescue)\b')

_ALWAYS_OPEN = {'def', 'class', 'module', 'case', 'begin', 'do'}
_LEADING_OPEN = {'if', 'unless', 'while', 'until', 'for'}
_RUBY_FILE_EXTS = {
    '.rb', '.json', '.yaml', '.yml', '.toml', '.xml', '.conf', '.cfg',
    '.html', '.htm', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg',
    '.txt', '.md',
}
_RUBY_CONFIG_EXTS = {'.json', '.yaml', '.yml', '.toml', '.xml', '.conf', '.cfg'}


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _leaf(path: str) -> str:
    base = re.split(r'[\\/]', path)[-1]
    return re.sub(r'\.rb$', '', base)


def _normalize_signature(src: str, start: int, end: int) -> str:
    return ' '.join(src[start:end].strip().split())


def _path_edge_type(path: str):
    if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', path) or path.startswith(('/', '\\')):
        return None
    base = re.split(r'[\\/]', path)[-1]
    ext = '.' + base.rsplit('.', 1)[-1].lower() if '.' in base else ''
    if ext not in _RUBY_FILE_EXTS:
        return None
    if ext == '.rb':
        return 'import'
    return 'config_ref' if ext in _RUBY_CONFIG_EXTS else 'asset_ref'


def _edge_hints(src: str, clean: str, import_src: str) -> list:
    hints = []
    for m in RE_RUBY_REQUIRE.finditer(import_src):
        if m.start() < len(clean) and clean[m.start()] == ' ':
            continue
        target = m.group(2).strip()
        edge_type = _path_edge_type(target)
        if not edge_type:
            continue
        hints.append({
            'type': edge_type,
            'target': target,
            'subtype': 'require' if edge_type == 'import' else ('config' if edge_type == 'config_ref' else 'asset'),
            'via': m.group(1),
            'line': _line_no(src, m.start(2)),
            'confidence': 1.0,
        })
    for m in RE_RUBY_FILE_REF.finditer(import_src):
        if m.start() < len(clean) and clean[m.start()] == ' ':
            continue
        target = m.group('path').strip()
        edge_type = _path_edge_type(target)
        if not edge_type or edge_type == 'import':
            continue
        hints.append({
            'type': edge_type,
            'target': target,
            'subtype': 'config' if edge_type == 'config_ref' else 'asset',
            'via': import_src[m.start():m.start('path')].strip(),
            'line': _line_no(src, m.start('path')),
            'confidence': 1.0,
        })
    return list({(h['type'], h['target'], h['via'], h['line']): h for h in hints}.values())


def _mask_ruby(src: str, mask_strings: bool = True) -> str:
    """Blank comments, heredocs and (optionally) strings, preserving offsets."""
    out = list(src)
    n = len(src)
    lines = src.split('\n')

    def blank(start: int, end: int) -> None:
        for j in range(start, min(end, n)):
            if out[j] != '\n':
                out[j] = ' '

    # =begin / =end block comments (column 0).
    i = 0
    in_block = False
    line_starts = []
    pos = 0
    for ln in lines:
        line_starts.append(pos)
        pos += len(ln) + 1
    for li, ln in enumerate(lines):
        st = line_starts[li]
        if not in_block and ln.startswith('=begin'):
            in_block = True
            blank(st, st + len(ln))
            continue
        if in_block:
            blank(st, st + len(ln))
            if ln.startswith('=end'):
                in_block = False
            continue

    i = 0
    while i < n:
        if out[i] == ' ' and src[i] != ' ':
            i += 1   # inside an already-masked =begin/=end region
            continue
        c = src[i]

        if c == '#':
            start = i
            while i < n and src[i] != '\n':
                i += 1
            blank(start, i)
            continue

        # heredoc: <<~ID / <<-ID / <<ID / <<"ID" / <<'ID'
        if c == '<' and src[i:i + 2] == '<<':
            m = re.match(r"<<([~-]?)([\"']?)([A-Za-z_]\w*)\2", src[i:])
            if m and (m.group(1) or m.group(2) or _heredoc_ok(src, i)):
                tag = m.group(3)
                indented = m.group(1) in ('~', '-')
                nl = src.find('\n', i)
                if nl != -1:
                    j = nl + 1
                    while j < n:
                        le = src.find('\n', j)
                        le = n if le == -1 else le
                        line = src[j:le]
                        if (line.strip() if indented else line) == tag:
                            blank(nl + 1, le)   # blank body + terminator text
                            break
                        blank(j, le)
                        j = le + 1
                i += m.end()   # keep the marker line as code; body already masked
                continue

        if c == '%' and i + 1 < n and src[i + 1] in 'wiWIqQrs':
            opener = src[i + 2] if i + 2 < n else ''
            pairs = {'(': ')', '[': ']', '{': '}', '<': '>'}
            if opener in pairs or (opener and not opener.isalnum()):
                close = pairs.get(opener, opener)
                start = i
                i += 3
                depth = 1
                while i < n and depth > 0:
                    if src[i] == '\\':
                        i += 2
                        continue
                    if opener in pairs and src[i] == opener:
                        depth += 1
                    elif src[i] == close:
                        depth -= 1
                    i += 1
                if mask_strings:
                    blank(start, i)
                continue

        if c in ('"', "'", '`'):
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
            if mask_strings:
                blank(start, i)
            continue

        i += 1

    return ''.join(out)


def _heredoc_ok(src: str, i: int) -> bool:
    """Bare `<<ID` is a heredoc only when not an obvious left-shift/comparison.
    Accept when the preceding non-space char is not an identifier/number/paren."""
    j = i - 1
    while j >= 0 and src[j] in ' \t':
        j -= 1
    if j < 0:
        return True
    return src[j] not in ')]}' and not (src[j].isalnum() or src[j] == '_')


def _block_end(clean: str, after_idx: int) -> int:
    """Scan from after_idx (depth already 1) to the matching `end`."""
    depth = 1
    loop_lines = set()
    for m in RE_WORD.finditer(clean, after_idx):
        w = m.group(0)
        if w not in _ALWAYS_OPEN and w not in _LEADING_OPEN and w != 'end':
            continue
        start = m.start()
        line_start = clean.rfind('\n', 0, start) + 1
        leading = clean[line_start:start].strip() == ''
        prev = clean[line_start:start].rstrip()
        if w == 'end':
            depth -= 1
            if depth == 0:
                return m.end()
        elif w in _LEADING_OPEN:
            if leading:
                depth += 1
                if w in ('while', 'until', 'for'):
                    loop_lines.add(line_start)
        elif w == 'do':
            if line_start in loop_lines:
                continue   # `while ... do` — the `do` is part of the loop
            depth += 1
        else:  # def/class/module/case/begin
            if prev.endswith('.'):
                continue   # method call like `obj.class`
            depth += 1
    return len(clean)


def _extract_calls(text: str) -> list:
    calls = []
    seen = set()
    for m in RE_RUBY_CALL.finditer(text):
        name = m.group(1)
        if name in RUBY_KEYWORDS or len(name) < 2 or name in seen:
            continue
        seen.add(name)
        calls.append(name)
    return calls


def _complexity(body: str) -> int:
    if not body:
        return 1
    return 1 + len(_RE_RUBY_BRANCH_KW.findall(body)) + body.count('&&') + body.count('||')


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


def _mixin_refs(body: str) -> list:
    refs = []
    for m in RE_RUBY_MIXIN.finditer(body):
        for raw in m.group(2).split(','):
            name = raw.strip().split('::')[-1]
            if name and name not in refs:
                refs.append(name)
    return refs


def scan_ruby(src: str, ext: str = '.rb') -> tuple:
    """Ruby file analysis. Returns the standard VIZCODE 6-tuple."""
    clean = _mask_ruby(src, mask_strings=True)
    import_src = _mask_ruby(src, mask_strings=False)

    imports = []
    for m in RE_RUBY_REQUIRE.finditer(import_src):
        if m.start() < len(clean) and clean[m.start()] == ' ':
            continue   # the `require` token lives inside a string literal
        leaf = _leaf(m.group(2).strip())
        if leaf:
            imports.append(leaf)
    imports = list(dict.fromkeys(imports))

    symbol_defs = []
    type_ranges = []
    for m in RE_RUBY_TYPE.finditer(clean):
        kind = m.group(1)
        name = m.group(2).split('::')[-1]
        if not name:
            continue
        start = m.start(2)
        end_idx = _block_end(clean, m.end())
        bases = [m.group(4).split('::')[-1]] if m.group(4) else []
        for mixin in _mixin_refs(clean[m.end():end_idx]):
            if mixin not in bases:
                bases.append(mixin)
        symbol_defs.append({
            'kind': 'mixin' if kind == 'module' else kind,
            'name': name, 'line': _line_no(src, start),
            'end_line': _line_no(src, max(start, end_idx - 1)),
            'bases': bases, 'parent': None, 'is_public': True, 'doc': None,
            'signature': _normalize_signature(src, m.start(), m.end()),
            'type_refs': [],
        })
        type_ranges.append((start, end_idx, name))

    funcdefs = []
    func_calls_by_func = []
    method_symbols = []
    seen = set()
    for m in RE_RUBY_DEF.finditer(clean):
        recv = m.group(1)
        name = m.group(2)
        start = m.start(2)
        line_no = _line_no(src, start)
        key = (name, line_no)
        if key in seen:
            continue
        seen.add(key)
        end_idx = _block_end(clean, m.end())
        body = clean[m.end():end_idx]
        parent = _enclosing(type_ranges, start)
        is_static = recv is not None
        funcdefs.append({'label': name, 'is_efiapi': False, 'is_static': is_static})
        func_calls_by_func.append(_extract_calls(body))
        method_symbols.append({
            'kind': 'method' if parent else 'function',
            'name': name, 'line': line_no,
            'end_line': _line_no(src, max(start, end_idx - 1)),
            'bases': [], 'parent': parent,
            'is_public': not name.startswith('_'), 'doc': None,
            'complexity': _complexity(body),
            'signature': _normalize_signature(src, m.start(), src.find('\n', m.start()) if src.find('\n', m.start()) != -1 else m.end()),
            'type_refs': [],
        })

    symbol_defs = symbol_defs + method_symbols
    all_calls = _extract_calls(clean)

    extra = {'imports': imports, 'lang': 'ruby'}
    hints = _edge_hints(src, clean, import_src)
    if hints:
        extra['edge_hints'] = hints

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs
