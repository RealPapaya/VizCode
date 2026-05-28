#!/usr/bin/env python3
"""
parsers/zig_parser.py - VIZCODE Zig Language Parser

Extracts:
  imports             - targets of `@import("...")` (leaf/stem name)
  funcdefs            - `fn` / `pub fn` / `export fn` / `extern fn` definitions
  funccalls           - call expressions (excluding `@builtin(...)` and decls)
  func_calls_by_func  - per-function call lists (body-scoped via brace matching)
  symbol_defs         - container types `const Name = struct/enum/union/opaque`
                        + functions (methods parented to their container)

Zig modules are values: `const std = @import("std");`. Containers are anonymous
struct/enum/union values bound to a `const`. Bodies are brace blocks `{ }`;
`extern`/prototype fns with no body (terminated by `;`) degrade to one line.

Syntax verified against the Zig language reference:
  `//` line, `///` doc, `//!` top-of-file doc comments (NO block comments);
  strings `"..."`, multiline `\\...` (to end of line), char `'c'`. A `//` inside
  a `\\` multiline-string line is string content, so `\\` lines are masked first.
"""

import re

ZIG_EXTENSIONS = {'.zig'}

ZIG_KEYWORDS = {
    'fn', 'pub', 'const', 'var', 'struct', 'enum', 'union', 'opaque', 'error',
    'if', 'else', 'while', 'for', 'switch', 'return', 'break', 'continue',
    'defer', 'errdefer', 'try', 'catch', 'orelse', 'and', 'or', 'comptime',
    'inline', 'noinline', 'export', 'extern', 'packed', 'align', 'test',
    'usingnamespace', 'async', 'await', 'suspend', 'resume', 'nosuspend',
    'unreachable', 'anytype', 'anyframe', 'void', 'type', 'bool', 'true',
    'false', 'null', 'undefined', 'noreturn', 'callconv', 'linksection',
    'threadlocal', 'volatile', 'allowzero', 'addrspace',
}

RE_ZIG_IMPORT = re.compile(r'@import\s*\(\s*"([^"]*)"\s*\)')
RE_ZIG_FN = re.compile(
    r'^[ \t]*(?:pub\s+)?'
    r'(?:(?:export|extern|inline|noinline)\s+(?:"[^"]*"\s+)?)*'
    r'fn\s+([A-Za-z_]\w*)\s*\(',
    re.MULTILINE)
RE_ZIG_TYPE = re.compile(
    r'^[ \t]*(?:pub\s+)?const\s+([A-Za-z_]\w*)\s*=\s*'
    r'(?:packed\s+|extern\s+)?(struct|enum|union|opaque)\b',
    re.MULTILINE)
RE_ZIG_CALL = re.compile(r'\b([A-Za-z_]\w*)\s*\(')
_RE_ZIG_BRANCH_KW = re.compile(r'\b(?:if|while|for|switch|and|or|orelse|catch)\b')


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _mask_zig(src: str, mask_literals: bool = False) -> str:
    """Mask comments (always) and string/char literals (optional), keeping
    offsets/newlines. `\\...` multiline-string lines are masked before `//`."""
    out = list(src)
    i, n = 0, len(src)

    def blank(a, b):
        for j in range(a, min(b, n)):
            if out[j] != '\n':
                out[j] = ' '

    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ''
        if c == '\\' and nxt == '\\':            # multiline string -> EOL
            start = i
            while i < n and src[i] != '\n':
                i += 1
            if mask_literals:
                blank(start, i)
            continue
        if c == '/' and nxt == '/':              # // ///  //! comment
            start = i
            while i < n and src[i] != '\n':
                i += 1
            blank(start, i)
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
                blank(start, i)
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
                blank(start, i)
            continue
        i += 1
    return ''.join(out)


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


def _enclosing(ranges, idx):
    best, best_span = None, None
    for start, end, name in ranges:
        if start <= idx < end:
            span = end - start
            if best_span is None or span < best_span:
                best_span, best = span, name
    return best


def _is_pub(clean: str, decl_start: int) -> bool:
    line_start = clean.rfind('\n', 0, decl_start) + 1
    return clean[line_start:decl_start].lstrip().startswith('pub')


def _extract_calls(text: str, base: int = 0, skip_starts=None) -> list:
    skip_starts = skip_starts or set()
    calls = []
    for m in RE_ZIG_CALL.finditer(text):
        name = m.group(1)
        if (base + m.start(1)) in skip_starts:
            continue
        # skip @builtin(...) — the '@' sits just before the name
        if m.start(1) > 0 and text[m.start(1) - 1] == '@':
            continue
        if name in ZIG_KEYWORDS or len(name) < 2:
            continue
        calls.append(name)
    return calls


def _complexity(body: str) -> int:
    if not body:
        return 1
    return 1 + len(_RE_ZIG_BRANCH_KW.findall(body))


def scan_zig(src: str, ext: str = '.zig') -> tuple:
    """Zig file analysis. Returns the standard VIZCODE 6-tuple."""
    import_src = _mask_zig(src, mask_literals=False)   # keep strings for @import
    clean = _mask_zig(src, mask_literals=True)

    # An `@import(...)` is real only when its keyword survives literal masking;
    # one sitting inside a `\\` multiline string is blanked in `clean`.
    def _real_kw(pos: int) -> bool:
        return pos < len(clean) and not clean[pos].isspace()

    imports = []
    for m in RE_ZIG_IMPORT.finditer(import_src):
        if not _real_kw(m.start()):
            continue
        path = m.group(1).strip()
        base = re.split(r'[/\\]', path)[-1]
        ref = base[:-4] if base.endswith('.zig') else base
        if ref:
            imports.append(ref)
    imports = list(dict.fromkeys(imports))

    symbol_defs = []
    ranges = []
    seen = set()
    decl_name_starts = set()

    for m in RE_ZIG_TYPE.finditer(clean):
        name, kind = m.group(1), m.group(2)
        if name in ZIG_KEYWORDS or len(name) < 2 or name in seen:
            continue
        seen.add(name)
        start = m.start(1)
        decl_name_starts.add(start)
        open_idx = clean.find('{', m.end())
        end_idx = _brace_range(clean, open_idx) if open_idx != -1 else m.end()
        ranges.append((start, end_idx, name))
        symbol_defs.append({
            'kind': 'struct' if kind in ('struct', 'opaque') else kind,
            'name': name, 'line': _line_no(src, start),
            'end_line': _line_no(src, max(start, end_idx - 1)),
            'bases': [], 'parent': None, 'is_public': _is_pub(clean, start),
            'doc': None,
        })

    funcdefs = []
    func_calls_by_func = []
    method_symbols = []
    seen_fn = set()
    for m in RE_ZIG_FN.finditer(clean):
        name = m.group(1)
        if name in ZIG_KEYWORDS or len(name) < 2:
            continue
        start = m.start(1)
        key = (name, _line_no(src, start))
        if key in seen_fn:
            continue
        seen_fn.add(key)
        decl_name_starts.add(start)
        open_idx = clean.find('{', m.end())
        semi_idx = clean.find(';', m.end())
        line_no = _line_no(src, start)
        if open_idx != -1 and (semi_idx == -1 or open_idx < semi_idx):
            end_idx = _brace_range(clean, open_idx)
            body = clean[open_idx + 1:end_idx - 1]
            end_line = _line_no(src, end_idx - 1)
            calls = _extract_calls(body, base=open_idx + 1,
                                   skip_starts=decl_name_starts)
        else:
            body, end_line, calls = '', line_no, []
        parent = _enclosing(ranges, start)
        funcdefs.append({'label': name, 'is_efiapi': False, 'is_static': False})
        func_calls_by_func.append(calls)
        method_symbols.append({
            'kind': 'method' if parent else 'function', 'name': name,
            'line': line_no, 'end_line': end_line, 'bases': [],
            'parent': parent, 'is_public': _is_pub(clean, start), 'doc': None,
            'complexity': _complexity(body),
        })

    symbol_defs += method_symbols
    all_calls = _extract_calls(clean, skip_starts=decl_name_starts)
    extra = {'imports': imports, 'lang': 'zig'}

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs
