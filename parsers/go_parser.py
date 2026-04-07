#!/usr/bin/env python3
"""
parsers/go_parser.py — VIZCODE Go Language Parser

Extracts:
  imports        → package paths from 'import' statements
  funcdefs       → function declarations (top-level, methods, closures)
  funccalls      → all call expressions
  func_calls_by_func → per-function call lists (body-scoped via brace matching)
  symbol_defs    → structured symbol table [{kind, name, line, end_line, bases, parent, doc}, ...]

Go naming convention:
  UpperCase = exported (public)
  lowerCase = unexported (private, shown as 'static' in UI)
"""

import re

# ─── Go keywords / builtins to ignore ─────────────────────────────────────────
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

# ─── Regex patterns ───────────────────────────────────────────────────────────
# Single-line import:  import "fmt"
RE_GO_IMPORT_SINGLE = re.compile(r'^import\s+"([^"]+)"', re.MULTILINE)
# Grouped import:  import (\n  "fmt"\n  "os"\n)
RE_GO_IMPORT_BLOCK  = re.compile(r'import\s*\((.*?)\)', re.DOTALL)
RE_GO_QUOTED        = re.compile(r'"([^"]+)"')

# Function declaration:
#   func FuncName(          — package-level function
#   func (r *Receiver) Method(   — method on a type
RE_GO_FUNCDEF = re.compile(
    r'^func\s+(?:\([^)]*\)\s+)?(\w+)\s*(?:\[[^\]]*\])?\s*\(',
    re.MULTILINE
)

# Call sites
RE_GO_CALL = re.compile(r'\b([A-Za-z_]\w*)\s*\(')

# Struct / interface declarations
RE_GO_STRUCT    = re.compile(r'^type\s+(\w+)\s+struct\s*\{', re.MULTILINE)
RE_GO_INTERFACE = re.compile(r'^type\s+(\w+)\s+interface\s*\{', re.MULTILINE)
# Type alias:  type Foo = Bar
RE_GO_TYPE_ALIAS = re.compile(r'^type\s+(\w+)\s*=\s*(\w[\w.]*)', re.MULTILINE)
# New type:  type Foo Bar  (not struct/interface/func)
RE_GO_TYPE_NEW = re.compile(r'^type\s+(\w+)\s+(\w[\w.]*)\s*$', re.MULTILINE)
# Method with receiver: func (r *Receiver) Method(
RE_GO_METHOD = re.compile(
    r'^func\s+\(\w+\s*(\*?)(\w+)\)\s+(\w+)\s*(?:\[[^\]]*\])?\s*\(',
    re.MULTILINE
)

# Strip // and /* */ comments
RE_GO_LINE_CMT  = re.compile(r'//[^\n]*')
RE_GO_BLOCK_CMT = re.compile(r'/\*.*?\*/', re.DOTALL)


def _strip_comments(src: str) -> str:
    src = RE_GO_BLOCK_CMT.sub(' ', src)
    src = RE_GO_LINE_CMT.sub('', src)
    return src


def _extract_doc_comments(src: str) -> dict:
    """Build map: line_number → doc comment for Go doc comments.

    Go doc comments are consecutive // lines immediately preceding a
    declaration (func, type, var, const).
    """
    doc_map = {}
    lines = src.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if line.startswith('//'):
            # Collect consecutive comment lines
            doc_lines = []
            start = i
            while i < len(lines) and lines[i].strip().startswith('//'):
                doc_lines.append(lines[i].strip()[2:].strip())
                i += 1
            # If the next line is a declaration, map it
            if i < len(lines):
                next_line = lines[i].strip()
                if next_line.startswith(('func ', 'type ', 'var ', 'const ')):
                    doc_map[i + 1] = '\n'.join(doc_lines)  # 1-based line
        else:
            i += 1
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


def _extract_calls(text: str) -> list:
    return [
        m.group(1) for m in RE_GO_CALL.finditer(text)
        if m.group(1) not in GO_KEYWORDS and len(m.group(1)) >= 2
    ]


def _extract_struct_embedding(clean: str, struct_start: int) -> list:
    """Extract embedded types from a struct body (for composition tracking)."""
    open_idx = clean.find('{', struct_start)
    if open_idx == -1:
        return []
    body = _brace_body(clean, open_idx)
    bases = []
    for line in body.splitlines():
        line = line.strip()
        if not line or line.startswith('//'):
            continue
        # Embedded type: just a type name on its own line (no field name)
        # e.g. "sync.Mutex" or "*BaseType" or "io.Reader"
        parts = line.split()
        if len(parts) == 1:
            # Single token: could be embedded type
            name = parts[0].lstrip('*')
            if name.split('.')[-1][0:1].isupper():
                bases.append(name)
    return bases


def _parse_symbol_defs(src: str, clean: str, doc_map: dict) -> list:
    """Extract struct, interface, type alias, and function symbols from Go source."""
    symbols = []

    # ── Structs ──────────────────────────────────────────────────────────────
    for m in RE_GO_STRUCT.finditer(clean):
        name = m.group(1)
        line_no = src[:m.start()].count('\n') + 1
        open_idx = clean.find('{', m.end() - 1)
        end_line = _brace_end_line(clean, open_idx, line_no) if open_idx != -1 else line_no
        bases = _extract_struct_embedding(clean, m.start())
        symbols.append({
            'kind':      'struct',
            'name':      name,
            'line':      line_no,
            'end_line':  end_line,
            'bases':     bases,
            'parent':    None,
            'is_public': name[0].isupper(),
            'doc':       doc_map.get(line_no, None),
        })

    # ── Interfaces ───────────────────────────────────────────────────────────
    for m in RE_GO_INTERFACE.finditer(clean):
        name = m.group(1)
        line_no = src[:m.start()].count('\n') + 1
        open_idx = clean.find('{', m.end() - 1)
        end_line = _brace_end_line(clean, open_idx, line_no) if open_idx != -1 else line_no
        symbols.append({
            'kind':      'interface',
            'name':      name,
            'line':      line_no,
            'end_line':  end_line,
            'bases':     [],
            'parent':    None,
            'is_public': name[0].isupper(),
            'doc':       doc_map.get(line_no, None),
        })

    # ── Type aliases ─────────────────────────────────────────────────────────
    seen_names = {s['name'] for s in symbols}
    for m in RE_GO_TYPE_ALIAS.finditer(clean):
        name = m.group(1)
        if name in seen_names:
            continue
        target = m.group(2)
        line_no = src[:m.start()].count('\n') + 1
        symbols.append({
            'kind':      'typedef',
            'name':      name,
            'line':      line_no,
            'end_line':  line_no,
            'bases':     [target],
            'parent':    None,
            'is_public': name[0].isupper(),
            'doc':       doc_map.get(line_no, None),
        })
        seen_names.add(name)

    # ── New types (type Foo Bar) ─────────────────────────────────────────────
    for m in RE_GO_TYPE_NEW.finditer(clean):
        name = m.group(1)
        if name in seen_names:
            continue
        target = m.group(2)
        if target in ('struct', 'interface', 'func', 'map', 'chan'):
            continue
        line_no = src[:m.start()].count('\n') + 1
        symbols.append({
            'kind':      'typedef',
            'name':      name,
            'line':      line_no,
            'end_line':  line_no,
            'bases':     [target],
            'parent':    None,
            'is_public': name[0].isupper(),
            'doc':       doc_map.get(line_no, None),
        })
        seen_names.add(name)

    # ── Methods with receivers ───────────────────────────────────────────────
    for m in RE_GO_METHOD.finditer(clean):
        is_ptr = m.group(1) == '*'
        receiver = m.group(2)
        mname = m.group(3)
        if mname in GO_KEYWORDS:
            continue
        line_no = src[:m.start()].count('\n') + 1
        open_idx = clean.find('{', m.end())
        end_line = _brace_end_line(clean, open_idx, line_no) if open_idx != -1 else line_no
        symbols.append({
            'kind':      'method',
            'name':      mname,
            'line':      line_no,
            'end_line':  end_line,
            'bases':     [],
            'parent':    receiver,
            'is_public': mname[0].isupper(),
            'doc':       doc_map.get(line_no, None),
        })

    # ── Package-level functions (non-method) ─────────────────────────────────
    for m in RE_GO_FUNCDEF.finditer(clean):
        name = m.group(1)
        if name in GO_KEYWORDS:
            continue
        line_no = src[:m.start()].count('\n') + 1
        open_idx = clean.find('{', m.end())
        end_line = _brace_end_line(clean, open_idx, line_no) if open_idx != -1 else line_no
        symbols.append({
            'kind':      'function',
            'name':      name,
            'line':      line_no,
            'end_line':  end_line,
            'bases':     [],
            'parent':    None,
            'is_public': name[0].isupper(),
            'doc':       doc_map.get(line_no, None),
        })

    return symbols


def scan_go(src: str) -> tuple:
    """
    Go file analysis.

    Returns: (imports, funcdefs, all_calls, extra_dict, func_calls_by_func, symbol_defs)
    """
    clean = _strip_comments(src)
    doc_map = _extract_doc_comments(src)
    imports = _parse_imports(clean)

    funcdefs = []
    func_calls_by_func = []
    seen = set()

    for m in RE_GO_FUNCDEF.finditer(clean):
        name = m.group(1)
        if not name or name in GO_KEYWORDS or name in seen:
            continue
        seen.add(name)

        is_private = name[0].islower()

        funcdefs.append({
            'label':     name,
            'is_efiapi': False,
            'is_static': is_private,
        })

        open_idx = clean.find('{', m.end())
        body = _brace_body(clean, open_idx) if open_idx != -1 else ''
        func_calls_by_func.append(_extract_calls(body))

    all_calls = _extract_calls(clean)
    symbol_defs = _parse_symbol_defs(src, clean, doc_map)

    # Collect docstrings into extra
    docstrings = {}
    for sym in symbol_defs:
        if sym.get('doc'):
            key = f"{sym['parent']}.{sym['name']}" if sym['parent'] else sym['name']
            docstrings[key] = sym['doc']

    extra = {
        'imports': imports,
        'lang':    'go',
        'package': _parse_package(src),
    }
    if docstrings:
        extra['docstrings'] = docstrings

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs


def _parse_package(src: str) -> str:
    """Extract 'package xxx' declaration."""
    m = re.search(r'^package\s+(\w+)', src, re.MULTILINE)
    return m.group(1) if m else ''
