#!/usr/bin/env python3
"""
parsers/php_parser.py - VIZCODE PHP Language Parser

Extracts:
  imports             - `use Ns\\Class` (last segment) + require/include file stems
  funcdefs            - function and method declarations
  funccalls           - call expressions
  func_calls_by_func  - per-function call lists (body-scoped via brace matching)
  symbol_defs         - structured symbol table (function/method/class/interface/trait/enum)

PHP visibility:
  public is the default; `private`/`protected` mark a member non-public.
  A leading `_` on a name is treated as a private convention for plain functions.

Syntax verified against the PHP manual:
  https://www.php.net/manual/en/language.attributes.php
  https://www.php.net/manual/en/language.types.declarations.php
  https://www.php.net/manual/en/language.oop5.inheritance.php
Unsupported: dynamic include expressions, inferred variable types, and arbitrary
string file paths.
"""

import re

PHP_EXTENSIONS = {'.php'}

# Keywords / builtins that must never be reported as calls or defs.
PHP_KEYWORDS = {
    'if', 'else', 'elseif', 'for', 'foreach', 'while', 'do', 'switch', 'case',
    'default', 'break', 'continue', 'return', 'function', 'class', 'interface',
    'trait', 'enum', 'extends', 'implements', 'use', 'namespace', 'new', 'echo',
    'print', 'require', 'require_once', 'include', 'include_once', 'try', 'catch',
    'finally', 'throw', 'public', 'private', 'protected', 'static', 'final',
    'abstract', 'const', 'var', 'global', 'list', 'array', 'isset', 'unset',
    'empty', 'die', 'exit', 'and', 'or', 'xor', 'as', 'instanceof', 'clone',
    'yield', 'match', 'fn', 'true', 'false', 'null', 'self', 'parent', 'this',
}

# Class-like declaration → kind.
RE_PHP_CLASSLIKE = re.compile(
    r'^[ \t]*(?:(?:abstract|final|readonly)\s+)*'
    r'(class|interface|trait|enum)\s+(\w+)(?P<rest>[^{]*)',
    re.MULTILINE,
)
# function name(  — optional visibility/modifier prefix (captured for is_public).
RE_PHP_FUNC = re.compile(
    r'^[ \t]*((?:(?:public|private|protected|static|final|abstract)\s+)*)'
    r'function\s+(\w+)\s*\(',
    re.MULTILINE,
)
RE_PHP_USE = re.compile(r'^[ \t]*use\s+([\w\\]+)', re.MULTILINE)
RE_PHP_INCLUDE = re.compile(
    r'''\b(?:require|include)(?:_once)?\s*\(?\s*['"]([^'"]+)['"]''')
RE_PHP_NAMESPACE = re.compile(r'^[ \t]*namespace\s+([\w\\]+)', re.MULTILINE)
RE_PHP_CALL = re.compile(r'\b([A-Za-z_]\w*)\s*\(')
RE_PHP_HEREDOC_OPEN = re.compile(r'<<<\s*(["\']?)([A-Za-z_]\w*)\1')

_RE_PHP_BRANCH_KW = re.compile(r'\b(?:if|elseif|for|foreach|while|case|catch)\b')
_PHP_BUILTIN_TYPES = {
    'array', 'bool', 'callable', 'false', 'float', 'int', 'iterable', 'mixed',
    'never', 'null', 'object', 'parent', 'self', 'static', 'string', 'true',
    'void',
}
_PHP_FILE_EXTS = {
    '.php', '.inc', '.json', '.yaml', '.yml', '.toml', '.xml', '.ini', '.conf',
    '.cfg', '.html', '.htm', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif',
    '.svg', '.txt', '.md',
}
_PHP_CONFIG_EXTS = {'.json', '.yaml', '.yml', '.toml', '.xml', '.ini', '.conf', '.cfg'}
RE_PHP_PROPERTY_TYPE = re.compile(
    r'^[ \t]*(?:(?:public|private|protected|static|readonly|var)\s+)+'
    r'(?P<type>[?\\\w|&\s]+)\s+\$[A-Za-z_]\w*',
    re.MULTILINE,
)
RE_PHP_ATTRIBUTE = re.compile(r'#\[\s*([A-Za-z_\\][\w\\]*)')


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _normalize_signature(src: str, start: int, end: int) -> str:
    return ' '.join(src[start:end].strip().split())


def _extract_type_refs(text: str) -> list:
    refs = []
    for raw in re.findall(r'\\?[A-Za-z_]\w*(?:\\[A-Za-z_]\w*)*', text):
        name = raw.strip('\\').split('\\')[-1]
        if not name or name.lower() in PHP_KEYWORDS or name.lower() in _PHP_BUILTIN_TYPES:
            continue
        if len(name) >= 3 and name[0].isupper():
            refs.append(name)
    return list(dict.fromkeys(refs))


def _split_bases(rest: str) -> list:
    bases = []
    for kw in ('extends', 'implements'):
        m = re.search(r'\b' + kw + r'\s+([^({;]+)', rest, re.IGNORECASE)
        if not m:
            continue
        clause = re.split(r'\b(?:extends|implements)\b', m.group(1), flags=re.I)[0]
        for part in clause.split(','):
            refs = _extract_type_refs(part)
            bases.extend(refs[:1])
    return list(dict.fromkeys(bases))


def _decorators_before(src: str, clean: str, decl_start: int) -> list:
    line_start = clean.rfind('\n', 0, decl_start) + 1
    src_lines = src[:line_start].splitlines()
    clean_lines = clean[:line_start].splitlines()
    decorators = []
    i = len(src_lines) - 1
    while i >= 0:
        stripped = clean_lines[i].strip()
        if not stripped:
            i -= 1
            continue
        if not stripped.startswith('#['):
            break
        decorators[:0] = [d.split('\\')[-1] for d in RE_PHP_ATTRIBUTE.findall(src_lines[i])]
        i -= 1
    return list(dict.fromkeys(decorators))


def _path_edge_type(path: str):
    if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:', path) or path.startswith(('/', '\\')):
        return None
    ext = '.' + path.rsplit('.', 1)[-1].lower() if '.' in path.rsplit('/', 1)[-1] else ''
    if ext not in _PHP_FILE_EXTS:
        return None
    if ext in ('.php', '.inc'):
        return 'import'
    return 'config_ref' if ext in _PHP_CONFIG_EXTS else 'asset_ref'


def _include_edge_hints(src: str, code: str) -> list:
    hints = []
    masked = _mask_php(src)
    for m in RE_PHP_INCLUDE.finditer(code):
        if not masked[m.start():m.start(1)].strip():
            continue
        path = m.group(1).strip()
        edge_type = _path_edge_type(path)
        if not edge_type:
            continue
        hints.append({
            'type': edge_type,
            'target': path,
            'subtype': 'include' if edge_type == 'import' else ('config' if edge_type == 'config_ref' else 'asset'),
            'via': m.group(0).split('(', 1)[0].strip(),
            'line': _line_no(src, m.start(1)),
            'confidence': 1.0,
        })
    return hints


def _mask_php(src: str, mask_strings: bool = True) -> str:
    """Blank PHP comments and (optionally) string literals, preserving offsets so
    reported line numbers stay aligned. Comments and heredocs are always masked;
    simple quoted strings are kept when mask_strings is False so import paths can
    be read. `#[` (PHP 8 attribute) is NOT a comment."""
    out = list(src)
    i = 0
    n = len(src)

    def blank(start: int, end: int) -> None:
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
            blank(start, i)
            continue
        if c == '#' and nxt != '[':
            start = i
            i += 1
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
        if c == '<' and src[i:i + 3] == '<<<':
            m = RE_PHP_HEREDOC_OPEN.match(src, i)
            if m:
                label = m.group(2)
                start = i
                # body starts after the opening line
                nl = src.find('\n', m.end())
                if nl == -1:
                    blank(start, n)
                    i = n
                    continue
                j = nl + 1
                close = re.compile(r'^[ \t]*' + re.escape(label) + r'\b')
                while j < n:
                    line_end = src.find('\n', j)
                    if line_end == -1:
                        line_end = n
                    if close.match(src[j:line_end]):
                        # blank through the heredoc body but keep the closer text
                        blank(start, j)
                        i = line_end
                        break
                    j = line_end + 1
                else:
                    blank(start, n)
                    i = n
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
            if mask_strings:
                blank(start, i)
            continue

        i += 1

    return ''.join(out)


def _brace_body(src: str, open_idx: int) -> str:
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


def _brace_range(src: str, open_idx: int):
    """Return (close_idx) for the brace block opened at open_idx, or -1."""
    if open_idx < 0:
        return -1
    depth = 0
    for i in range(open_idx, len(src)):
        c = src[i]
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return i
    return -1


def _extract_calls(text: str) -> list:
    calls = []
    seen = set()
    for m in RE_PHP_CALL.finditer(text):
        name = m.group(1)
        if name in PHP_KEYWORDS or len(name) < 2 or name in seen:
            continue
        seen.add(name)
        calls.append(name)
    return calls


def _complexity(body: str) -> int:
    if not body:
        return 1
    count = 1 + len(_RE_PHP_BRANCH_KW.findall(body))
    count += body.count('&&') + body.count('||') + body.count('?')
    return count


def _norm_use(ref: str) -> str:
    """Last namespace segment of a `use` reference (drops alias/grouping)."""
    ref = ref.strip().strip('\\')
    seg = ref.split('\\')[-1]
    return seg


def scan_php(src: str) -> tuple:
    """
    PHP file analysis.

    Returns: (imports, funcdefs, all_calls, extra_dict, func_calls_by_func, symbol_defs)
    """
    clean = _mask_php(src)
    code = _mask_php(src, mask_strings=False)  # quotes kept for import paths

    # ── imports ──────────────────────────────────────────────────────────────
    imports = []
    for m in RE_PHP_USE.finditer(code):
        seg = _norm_use(m.group(1))
        if seg and seg not in PHP_KEYWORDS:
            imports.append(seg)
    for m in RE_PHP_INCLUDE.finditer(code):
        path = m.group(1).strip()
        if path:
            imports.append(path)
    imports = list(dict.fromkeys(imports))

    namespace = ''
    nm = RE_PHP_NAMESPACE.search(clean)
    if nm:
        namespace = nm.group(1).strip('\\')

    # ── class-like ranges (for method parenting) ─────────────────────────────
    class_ranges = []  # (start_idx, close_idx, name)
    symbol_defs = []
    for m in RE_PHP_CLASSLIKE.finditer(clean):
        kind = m.group(1)
        name = m.group(2)
        rest = m.group('rest') or ''
        line_no = _line_no(src, m.start())
        open_idx = clean.find('{', m.end())
        close_idx = _brace_range(clean, open_idx)
        end_line = _line_no(src, close_idx) if close_idx != -1 else line_no
        if close_idx != -1:
            class_ranges.append((open_idx, close_idx, name))
        body = clean[open_idx + 1:close_idx] if open_idx != -1 and close_idx != -1 else ''
        property_refs = []
        for pm in RE_PHP_PROPERTY_TYPE.finditer(body):
            property_refs.extend(_extract_type_refs(pm.group('type')))
        symbol_defs.append({
            'kind': kind,
            'name': name,
            'line': line_no,
            'end_line': end_line,
            'bases': _split_bases(rest),
            'type_refs': list(dict.fromkeys(_split_bases(rest) + property_refs)),
            'parent': None,
            'is_public': True,
            'doc': None,
            'signature': _normalize_signature(src, m.start(), open_idx if open_idx != -1 else m.end()),
            'decorators': _decorators_before(src, clean, m.start()),
        })

    def parent_of(idx: int):
        for open_idx, close_idx, name in class_ranges:
            if open_idx < idx < close_idx:
                return name
        return None

    # ── functions / methods ──────────────────────────────────────────────────
    funcdefs = []
    func_calls_by_func = []
    for m in RE_PHP_FUNC.finditer(clean):
        modifiers = m.group(1) or ''
        name = m.group(2)
        if name in PHP_KEYWORDS:
            continue
        line_no = _line_no(src, m.start(2))
        open_idx = clean.find('{', m.end())
        close_idx = _brace_range(clean, open_idx)
        end_line = _line_no(src, close_idx) if close_idx != -1 else line_no
        body = _brace_body(clean, open_idx)
        sig_end = open_idx if open_idx != -1 else m.end()
        parent = parent_of(m.start())
        is_private = 'private' in modifiers or 'protected' in modifiers
        if parent is None and name.startswith('_'):
            is_private = True

        funcdefs.append({
            'label': name,
            'is_efiapi': False,
            'is_static': is_private,
        })
        func_calls_by_func.append(_extract_calls(body))
        symbol_defs.append({
            'kind': 'method' if parent else 'function',
            'name': name,
            'line': line_no,
            'end_line': end_line,
            'bases': [],
            'parent': parent,
            'is_public': not is_private,
            'doc': None,
            'complexity': _complexity(body),
            'signature': _normalize_signature(src, m.start(), sig_end),
            'decorators': _decorators_before(src, clean, m.start()),
            'type_refs': _extract_type_refs(src[m.start():sig_end]),
        })

    all_calls = _extract_calls(clean)

    extra = {'imports': imports, 'lang': 'php'}
    hints = _include_edge_hints(src, code)
    if hints:
        extra['edge_hints'] = hints
    if namespace:
        extra['namespace'] = namespace

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs
