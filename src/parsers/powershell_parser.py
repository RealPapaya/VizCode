#!/usr/bin/env python3
r"""
parsers/powershell_parser.py - VIZCODE PowerShell Parser

PowerShell is module/include based. We extract:

  imports             - `Import-Module`, dot-source (`. .\x.ps1`), `using module`
  funcdefs            - function / filter / class methods
  funccalls           - calls to user-defined functions (cmdlets filtered out)
  func_calls_by_func  - per-function call lists (brace-scoped)
  symbol_defs         - function / filter / class / enum / method

Comments are `#` (line) and `<# ... #>` (block). String forms that can contain
comment-looking text: `"..."`, `'...'`, and here-strings `@"..."@` / `@'...'@`.
All are masked (offsets preserved) before scanning.

Precision-first: the call graph keeps only names that resolve to a function
*defined in the same file's symbol set*, so the thousands of built-in cmdlets
(`Write-Host`, `Get-ChildItem`, ...) never create edges or graph explosion.
"""

import re

POWERSHELL_EXTENSIONS = {'.ps1', '.psm1', '.psd1'}

RE_PS_FUNC = re.compile(
    r'(?im)^\s*(?:function|filter)\s+'
    r'(?:(?:global|local|script|private):)?([A-Za-z_][\w\-]*)')
RE_PS_CLASS = re.compile(r'(?im)^\s*class\s+([A-Za-z_]\w*)')
RE_PS_ENUM = re.compile(r'(?im)^\s*enum\s+([A-Za-z_]\w*)')

RE_PS_IMPORT_MODULE = re.compile(
    r'(?im)\bImport-Module\b\s+(?:-Name\s+)?["\']?([^"\'\s;|]+)')
RE_PS_DOTSOURCE = re.compile(
    r'(?im)^\s*\.\s+["\']?([^"\'\s;|]*\.ps[md]?1)')
RE_PS_USING_MODULE = re.compile(
    r'(?im)^\s*using\s+module\s+["\']?([^"\'\s;]+)')
RE_PS_CMD_FILE_REF = re.compile(
    r'''(?im)\b(?P<cmd>Get-Content|Import-Csv|Test-Path)\b(?:\s+-(?:Path|LiteralPath)\s+|\s+)["'](?P<path>[^"']+)["']''')
RE_PS_DOTNET_FILE_REF = re.compile(
    r'''(?i)\[(?:System\.)?IO\.File\]::(?P<cmd>ReadAllText|ReadAllLines|OpenRead)\s*\(\s*["'](?P<path>[^"']+)["']''')

# Method inside a class body: modifiers and [type] return may appear in any
# order before the name, then Name(...) {
RE_PS_METHOD = re.compile(
    r'(?im)^\s*(?:(?:static|hidden)\s+)*(?:\[[^\]]+\]\s*)?'
    r'(?:(?:static|hidden)\s+)*([A-Za-z_]\w*)\s*\([^)]*\)\s*\{')

RE_WORD = re.compile(r'\b[A-Za-z_][\w\-]*\b')
RE_PS_BRANCH = re.compile(r'(?i)\b(if|elseif|for|foreach|while|switch|catch)\b')
RE_PS_LOGICAL = re.compile(r'-(?:and|or)\b', re.IGNORECASE)

PS_KEYWORDS = {
    'if', 'elseif', 'else', 'for', 'foreach', 'while', 'do', 'switch', 'try',
    'catch', 'finally', 'function', 'filter', 'class', 'enum', 'return',
    'break', 'continue', 'throw', 'param', 'begin', 'process', 'end', 'in',
    'using', 'static', 'hidden', 'default', 'data', 'dynamicparam', 'exit',
    'trap', 'until',
}
_PS_CONFIG_EXTS = {'.json', '.yaml', '.yml', '.toml', '.xml', '.conf', '.cfg', '.ini', '.psd1'}
_PS_ASSET_EXTS = {
    '.html', '.htm', '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg',
    '.csv', '.txt', '.md',
}


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _path_like_ref(ref: str):
    value = ref.strip().strip('"\'')
    if not value or value.startswith('$'):
        return None
    low = value.lower()
    if (
        value.startswith(('.', '/', '\\'))
        or '/' in value
        or '\\' in value
        or low.endswith(('.ps1', '.psm1', '.psd1'))
    ):
        return value.replace('\\', '/')
    return None


def _path_ext(ref: str) -> str:
    base = ref.rstrip('/').rsplit('/', 1)[-1]
    if '.' not in base:
        return ''
    return '.' + base.rsplit('.', 1)[-1].lower()


def _file_edge_type(ref: str):
    value = ref.strip().strip('"\'')
    if not value or value.startswith('$'):
        return None
    low = value.lower()
    if low.startswith(('http://', 'https://', '//', 'data:')):
        return None
    value = value.replace('\\', '/')
    ext = _path_ext(value)
    if ext in _PS_CONFIG_EXTS:
        return 'config_ref', value
    if ext in _PS_ASSET_EXTS:
        return 'asset_ref', value
    return None


def _hint(edge_type: str, target: str, via: str, line: int) -> dict:
    return {
        'type': edge_type,
        'target': target,
        'subtype': 'powershell',
        'via': via,
        'line': line,
        'confidence': 1.0,
    }


def _blank(out: list, start: int, end: int) -> None:
    n = len(out)
    for k in range(start, min(end, n)):
        if out[k] != '\n':
            out[k] = ' '


def _mask(src: str, mask_strings: bool = True) -> str:
    """Blank comments and string/here-string forms, preserving offsets. Comments
    and here-strings are always masked; simple `"..."`/`'...'` strings are kept
    when mask_strings is False so quoted import/dot-source paths survive."""
    out = list(src)
    n = len(src)
    i = 0
    prev_ws = True
    while i < n:
        two = src[i:i + 2]
        c = src[i]
        if two == '<#':                       # block comment
            end = src.find('#>', i + 2)
            end = (end + 2) if end != -1 else n
            _blank(out, i, end)
            i = end
            prev_ws = True
            continue
        if two == '@"' or two == "@'":         # here-string (always masked)
            closer = '\n"@' if two == '@"' else "\n'@"
            end = src.find(closer, i + 2)
            end = (end + len(closer)) if end != -1 else n
            _blank(out, i, end)
            i = end
            prev_ws = False
            continue
        if c == '"':
            start = i
            i += 1
            while i < n:
                if src[i] == '`':              # backtick escape
                    i += 2
                    continue
                if src[i] == '"':
                    i += 1
                    break
                i += 1
            if mask_strings:
                _blank(out, start, i)
            prev_ws = False
            continue
        if c == "'":
            start = i
            i += 1
            while i < n:
                if src[i] == "'":
                    if i + 1 < n and src[i + 1] == "'":   # '' literal quote
                        i += 2
                        continue
                    i += 1
                    break
                i += 1
            if mask_strings:
                _blank(out, start, i)
            prev_ws = False
            continue
        if c == '#' and prev_ws:               # line comment
            while i < n and src[i] != '\n':
                out[i] = ' '
                i += 1
            prev_ws = True
            continue
        if c == '\n':
            prev_ws = True
        else:
            prev_ws = c in ' \t'
        i += 1
    return ''.join(out)


def _block_end(clean: str, brace_idx: int) -> int:
    """Return index just past the `}` matching the `{` at brace_idx."""
    depth = 0
    n = len(clean)
    i = brace_idx
    while i < n:
        ch = clean[i]
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return n


def _complexity(body: str) -> int:
    return 1 + len(RE_PS_BRANCH.findall(body)) + len(RE_PS_LOGICAL.findall(body))


def _signature(src: str, clean: str, decl_idx: int, body_start: int = -1) -> str:
    end = body_start if body_start != -1 else clean.find('\n', decl_idx)
    if end == -1:
        end = len(clean)
    return ' '.join(src[decl_idx:end].strip().split())


def scan_powershell(src: str, ext: str = '.ps1') -> tuple:
    """PowerShell file analysis. Returns the standard 6-tuple."""
    clean = _mask(src)
    code = _mask(src, mask_strings=False)  # quotes kept for import/dot-source paths

    # ── Imports / includes ───────────────────────────────────────────────────
    imports = []
    edge_hints = []
    for rx, via, edge_type in (
        (RE_PS_IMPORT_MODULE, 'Import-Module', 'import'),
        (RE_PS_DOTSOURCE, 'dot-source', 'include'),
        (RE_PS_USING_MODULE, 'using module', 'import'),
    ):
        for m in rx.finditer(code):
            ref = m.group(1).strip()
            if ref and not ref.startswith('$'):   # skip dynamic ($var) refs
                imports.append(ref)
                target = _path_like_ref(ref)
                if target:
                    edge_hints.append(_hint(edge_type, target, via, _line_no(src, m.start())))
    for rx in (RE_PS_CMD_FILE_REF, RE_PS_DOTNET_FILE_REF):
        for m in rx.finditer(code):
            if m.start() < len(clean) and clean[m.start()] == ' ':
                continue
            typed = _file_edge_type(m.group('path'))
            if typed:
                edge_type, target = typed
                edge_hints.append(_hint(edge_type, target, m.group('cmd'), _line_no(src, m.start('path'))))
    imports = list(dict.fromkeys(imports))
    edge_hints = list({
        (h['type'], h['target'], h['via'], h['line']): h for h in edge_hints
    }.values())

    # ── Collect definitions (functions, filters, class methods) ──────────────
    funcdefs = []
    func_calls_by_func = []
    symbol_defs = []
    defined = {}          # name.lower() → canonical name
    pending = []          # (name, kind, parent, decl_idx, body)
    seen = set()

    def _string_after(idx):
        return clean.find('{', idx)

    # top-level functions / filters
    for m in RE_PS_FUNC.finditer(clean):
        name = m.group(1)
        if not name or name.lower() in PS_KEYWORDS:
            continue
        brace = _string_after(m.end())
        body = clean[brace:_block_end(clean, brace)] if brace != -1 else ''
        key = (None, name.lower())
        if key in seen:
            continue
        seen.add(key)
        defined.setdefault(name.lower(), name)
        pending.append((name, 'function', None, m.start(), body, brace))

    # classes (+ their methods) and enums
    for m in RE_PS_CLASS.finditer(clean):
        cname = m.group(1)
        if cname.lower() in seen:
            pass
        brace = _string_after(m.end())
        cend = _block_end(clean, brace) if brace != -1 else m.end()
        cbody = clean[brace:cend] if brace != -1 else ''
        symbol_defs.append({
            'kind': 'class', 'name': cname,
            'line': _line_no(src, m.start()), 'end_line': _line_no(src, cend),
            'bases': [], 'parent': None, 'is_public': True, 'doc': None,
            'complexity': 1,
        })
        # methods inside the class body
        for mm in RE_PS_METHOD.finditer(cbody):
            mname = mm.group(1)
            if mname.lower() in PS_KEYWORDS or mname == cname:
                continue
            mbrace = cbody.find('{', mm.start())
            mbody = cbody[mbrace:_block_end(cbody, mbrace)] if mbrace != -1 else ''
            key = (cname.lower(), mname.lower())
            if key in seen:
                continue
            seen.add(key)
            defined.setdefault(mname.lower(), mname)
            decl_idx = brace + mm.start()
            pending.append((mname, 'method', cname, decl_idx, mbody, brace + mbrace if mbrace != -1 else -1))

    for m in RE_PS_ENUM.finditer(clean):
        ename = m.group(1)
        brace = _string_after(m.end())
        eend = _block_end(clean, brace) if brace != -1 else m.end()
        symbol_defs.append({
            'kind': 'enum', 'name': ename,
            'line': _line_no(src, m.start()), 'end_line': _line_no(src, eend),
            'bases': [], 'parent': None, 'is_public': True, 'doc': None,
            'complexity': 1,
        })

    # ── Build funcdefs / call graph (only user-defined names become calls) ────
    def _extract_calls(text, exclude=None):
        calls = []
        seen_c = set()
        for w in RE_WORD.findall(text):
            wl = w.lower()
            if wl in defined and wl != exclude and wl not in seen_c:
                seen_c.add(wl)
                calls.append(defined[wl])
        return calls

    for name, kind, parent, decl_idx, body, brace_idx in pending:
        funcdefs.append({'label': name, 'is_efiapi': False, 'is_static': False})
        func_calls_by_func.append(_extract_calls(body, exclude=name.lower()))
        symbol_defs.append({
            'kind': kind, 'name': name,
            'line': _line_no(src, decl_idx),
            'end_line': _line_no(src, decl_idx + len(body)),
            'bases': [], 'parent': parent, 'is_public': True, 'doc': None,
            'complexity': _complexity(body),
            'signature': _signature(src, clean, decl_idx, brace_idx),
        })

    all_calls = _extract_calls(clean)

    extra = {'imports': imports, 'lang': 'powershell'}
    if edge_hints:
        extra['edge_hints'] = edge_hints
    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs
