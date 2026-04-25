#!/usr/bin/env python3
"""
parsers/js_parser.py — VIZCODE JavaScript & TypeScript Parser

Extracts:
  imports        → module specifiers from ES6 import / CommonJS require
  funcdefs       → named function declarations, arrow functions, class methods
  funccalls      → all call expressions
  func_calls_by_func → per-function call lists (body-scoped via brace matching)
  symbol_defs    → structured symbol table [{kind, name, line, end_line, bases, parent, doc}, ...]
"""

import re

# ─── JS/TS keywords to ignore ─────────────────────────────────────────────────
JS_KEYWORDS = {
    'if', 'else', 'while', 'for', 'do', 'switch', 'case', 'return',
    'typeof', 'instanceof', 'new', 'delete', 'void', 'in', 'of',
    'class', 'extends', 'import', 'export', 'from', 'const', 'let',
    'var', 'function', 'async', 'await', 'try', 'catch', 'finally',
    'throw', 'undefined', 'null', 'true', 'false', 'this', 'super',
    'yield', 'default', 'break', 'continue', 'debugger', 'with',
    # Common globals
    'console', 'process', 'require', 'module', 'exports', 'window',
    'document', 'Math', 'JSON', 'Array', 'Object', 'String', 'Number',
    'Boolean', 'Promise', 'Error', 'Set', 'Map', 'Symbol', 'BigInt',
    'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval',
    'fetch', 'describe', 'it', 'test', 'expect', 'beforeEach', 'afterEach',
}

# ─── Regex patterns ───────────────────────────────────────────────────────────

# ES6:  import X from 'module'  /  import { X } from 'module'
RE_JS_IMPORT = re.compile(
    r"""(?:^|;|\})\s*import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]""",
    re.MULTILINE
)
# CommonJS: require('module')
RE_JS_REQUIRE = re.compile(r"""\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)""")

# Named function declarations:  function myFunc(  /  async function* myFunc(
RE_JS_FUNC_DECL = re.compile(
    r'(?:^|\s)(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(\w+)\s*\(',
    re.MULTILINE
)
# Arrow / function-expression assignments:
#   const myFunc = (...) =>  /  const myFunc = async (...) =>
RE_JS_ARROW = re.compile(
    r'(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[\w]+)\s*=>',
    re.MULTILINE
)
RE_JS_FUNC_EXPR = re.compile(
    r'(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?function\s*\*?\s*\(',
    re.MULTILINE
)
# Class method:  methodName( ... ) {  (indented, not a keyword)
# Covers: async, static, get/set, generator (*), private (#)
RE_JS_METHOD = re.compile(
    r'^\s{2,}(?:async\s+)?(?:static\s+)?(?:\*\s*)?(?:get\s+|set\s+)?(?:#)?(\w+)\s*\([^)]*\)\s*(?:\:\s*[\w<>|&,\[\]\s.]*\s*)?\{',
    re.MULTILINE
)

# Call sites
RE_JS_CALL = re.compile(r'\b([A-Za-z_$][\w$]*)\s*\(')

# Class declarations
RE_JS_CLASS = re.compile(
    r'(?:^|\s)(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(\w+)'
    r'(?:\s+extends\s+([\w.]+))?(?:\s+implements\s+([\w,\s.]+))?\s*\{',
    re.MULTILINE
)

# TypeScript interface declarations
RE_TS_INTERFACE = re.compile(
    r'(?:^|\s)(?:export\s+)?interface\s+(\w+)'
    r'(?:\s+extends\s+([\w,\s.]+))?\s*\{',
    re.MULTILINE
)

# TypeScript enum declarations
RE_TS_ENUM = re.compile(
    r'(?:^|\s)(?:export\s+)?(?:const\s+)?enum\s+(\w+)\s*\{',
    re.MULTILINE
)

# TypeScript type alias
RE_TS_TYPE = re.compile(
    r'(?:^|\s)(?:export\s+)?type\s+(\w+)\s*(?:<[^>]*>)?\s*=',
    re.MULTILINE
)

# TypeScript namespace / module
RE_TS_NAMESPACE = re.compile(
    r'(?:^|\s)(?:export\s+)?(?:declare\s+)?(?:namespace|module)\s+(\w+)\s*\{',
    re.MULTILINE
)

# declare function
RE_TS_DECLARE_FUNC = re.compile(
    r'(?:^|\s)(?:export\s+)?declare\s+function\s+(\w+)\s*[(<]',
    re.MULTILINE
)

# JSDoc comment: /** ... */ immediately before a declaration
RE_JSDOC = re.compile(r'/\*\*(.*?)\*/', re.DOTALL)

# Strip // and /* */ comments
RE_LINE_COMMENT  = re.compile(r'//[^\n]*')
RE_BLOCK_COMMENT = re.compile(r'/\*.*?\*/', re.DOTALL)


def _strip_comments(src: str) -> str:
    src = RE_BLOCK_COMMENT.sub(' ', src)
    src = RE_LINE_COMMENT.sub('', src)
    return src


def _extract_jsdoc_map(src: str) -> dict:
    """Build a map from line_number → JSDoc text for lines with a JSDoc above."""
    doc_map = {}
    for m in RE_JSDOC.finditer(src):
        doc_text = m.group(1).strip()
        # Clean up JSDoc: remove leading * from each line
        lines = []
        for ln in doc_text.split('\n'):
            ln = ln.strip()
            if ln.startswith('*'):
                ln = ln[1:].strip()
            if ln:
                lines.append(ln)
        clean_doc = '\n'.join(lines)
        if not clean_doc:
            continue
        # Find the line number right after the JSDoc ends
        end_pos = m.end()
        next_line = src[:end_pos].count('\n') + 1
        # Map a few lines after the JSDoc end to handle blank lines
        for offset in range(4):
            doc_map[next_line + offset] = clean_doc
    return doc_map


def _parse_imports(src: str) -> list:
    refs = []
    for m in RE_JS_IMPORT.finditer(src):
        spec = m.group(1)
        if spec.startswith('.'):
            part = spec.rstrip('/').split('/')[-1]
            part = part.rsplit('.', 1)[0] if '.' in part else part
        else:
            part = spec.split('/')[0] if not spec.startswith('@') else '/'.join(spec.split('/')[:2])
        if part:
            refs.append(part)
    for m in RE_JS_REQUIRE.finditer(src):
        spec = m.group(1)
        if spec.startswith('.'):
            part = spec.rstrip('/').split('/')[-1].rsplit('.', 1)[0]
        else:
            part = spec.split('/')[0]
        if part:
            refs.append(part)
    return list(set(refs))


def _brace_body(src: str, open_idx: int) -> str:
    """Return the text inside the outermost { } starting at open_idx."""
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
    """Return the end line number (1-based) of the brace block."""
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
        m.group(1) for m in RE_JS_CALL.finditer(text)
        if m.group(1) not in JS_KEYWORDS and len(m.group(1)) >= 2
    ]


def _parse_symbol_defs(src: str, clean: str, doc_map: dict) -> list:
    """Extract class + method + interface + enum + type symbols from JS/TS source."""
    symbols = []

    # ── Classes ──────────────────────────────────────────────────────────────
    for m in RE_JS_CLASS.finditer(clean):
        name = m.group(1)
        extends = m.group(2)
        implements_raw = m.group(3) or ''
        line_no = src[:m.start()].count('\n') + 1
        bases = []
        if extends:
            bases.append(extends.strip())
        for iface in implements_raw.split(','):
            iface = iface.strip()
            if iface:
                bases.append(iface)
        # Calculate end_line via brace matching
        open_idx = clean.find('{', m.end() - 1)
        end_line = _brace_end_line(clean, open_idx, line_no) if open_idx != -1 else line_no
        symbols.append({
            'kind':      'class',
            'name':      name,
            'line':      line_no,
            'end_line':  end_line,
            'bases':     bases,
            'parent':    None,
            'is_public': not name.startswith('_'),
            'doc':       doc_map.get(line_no, None),
        })
        # Methods inside the class body
        body = _brace_body(clean, open_idx) if open_idx != -1 else ''
        body_start_line = line_no
        for mm in RE_JS_METHOD.finditer(body):
            mname = mm.group(1)
            if mname in JS_KEYWORDS:
                continue
            mline = body_start_line + body[:mm.start()].count('\n')
            # Method end_line
            method_brace = body.find('{', mm.end() - 1)
            m_end = _brace_end_line(body, method_brace, mline) if method_brace != -1 else mline
            symbols.append({
                'kind':      'method',
                'name':      mname,
                'line':      mline,
                'end_line':  m_end,
                'bases':     [],
                'parent':    name,
                'is_public': not mname.startswith('_') and not mname.startswith('#'),
                'doc':       doc_map.get(mline, None),
            })

    # ── Top-level functions ──────────────────────────────────────────────────
    seen_names = {s['name'] for s in symbols}
    for m in RE_JS_FUNC_DECL.finditer(clean):
        fname = m.group(1)
        if fname in JS_KEYWORDS or fname in seen_names:
            continue
        line_no = src[:m.start()].count('\n') + 1
        open_idx = clean.find('{', m.end())
        end_line = _brace_end_line(clean, open_idx, line_no) if open_idx != -1 else line_no
        symbols.append({
            'kind':      'function',
            'name':      fname,
            'line':      line_no,
            'end_line':  end_line,
            'bases':     [],
            'parent':    None,
            'is_public': not fname.startswith('_'),
            'doc':       doc_map.get(line_no, None),
        })
        seen_names.add(fname)

    # ── Arrow / function expressions ─────────────────────────────────────────
    for pat in (RE_JS_ARROW, RE_JS_FUNC_EXPR):
        for m in pat.finditer(clean):
            fname = m.group(1)
            if fname in JS_KEYWORDS or fname in seen_names or len(fname) < 2:
                continue
            line_no = src[:m.start()].count('\n') + 1
            open_idx = clean.find('{', m.end())
            end_line = _brace_end_line(clean, open_idx, line_no) if open_idx != -1 else line_no
            symbols.append({
                'kind':      'function',
                'name':      fname,
                'line':      line_no,
                'end_line':  end_line,
                'bases':     [],
                'parent':    None,
                'is_public': not fname.startswith('_'),
                'doc':       doc_map.get(line_no, None),
            })
            seen_names.add(fname)

    # ── TypeScript interfaces ────────────────────────────────────────────────
    for m in RE_TS_INTERFACE.finditer(clean):
        name = m.group(1)
        if name in JS_KEYWORDS or name in seen_names:
            continue
        extends_raw = m.group(2) or ''
        bases = [b.strip() for b in extends_raw.split(',') if b.strip()]
        line_no = src[:m.start()].count('\n') + 1
        open_idx = clean.find('{', m.end() - 1)
        end_line = _brace_end_line(clean, open_idx, line_no) if open_idx != -1 else line_no
        symbols.append({
            'kind':      'interface',
            'name':      name,
            'line':      line_no,
            'end_line':  end_line,
            'bases':     bases,
            'parent':    None,
            'is_public': not name.startswith('_'),
            'doc':       doc_map.get(line_no, None),
        })
        seen_names.add(name)

    # ── TypeScript enums ─────────────────────────────────────────────────────
    for m in RE_TS_ENUM.finditer(clean):
        name = m.group(1)
        if name in JS_KEYWORDS or name in seen_names:
            continue
        line_no = src[:m.start()].count('\n') + 1
        open_idx = clean.find('{', m.end() - 1)
        end_line = _brace_end_line(clean, open_idx, line_no) if open_idx != -1 else line_no
        symbols.append({
            'kind':      'enum',
            'name':      name,
            'line':      line_no,
            'end_line':  end_line,
            'bases':     [],
            'parent':    None,
            'is_public': not name.startswith('_'),
            'doc':       doc_map.get(line_no, None),
        })
        seen_names.add(name)

    # ── TypeScript type aliases ──────────────────────────────────────────────
    for m in RE_TS_TYPE.finditer(clean):
        name = m.group(1)
        if name in JS_KEYWORDS or name in seen_names:
            continue
        line_no = src[:m.start()].count('\n') + 1
        symbols.append({
            'kind':      'typedef',
            'name':      name,
            'line':      line_no,
            'end_line':  line_no,
            'bases':     [],
            'parent':    None,
            'is_public': not name.startswith('_'),
            'doc':       doc_map.get(line_no, None),
        })
        seen_names.add(name)

    # ── TypeScript namespace ─────────────────────────────────────────────────
    for m in RE_TS_NAMESPACE.finditer(clean):
        name = m.group(1)
        if name in JS_KEYWORDS or name in seen_names:
            continue
        line_no = src[:m.start()].count('\n') + 1
        open_idx = clean.find('{', m.end() - 1)
        end_line = _brace_end_line(clean, open_idx, line_no) if open_idx != -1 else line_no
        symbols.append({
            'kind':      'namespace',
            'name':      name,
            'line':      line_no,
            'end_line':  end_line,
            'bases':     [],
            'parent':    None,
            'is_public': True,
            'doc':       doc_map.get(line_no, None),
        })
        seen_names.add(name)

    # ── declare function ─────────────────────────────────────────────────────
    for m in RE_TS_DECLARE_FUNC.finditer(clean):
        name = m.group(1)
        if name in JS_KEYWORDS or name in seen_names:
            continue
        line_no = src[:m.start()].count('\n') + 1
        symbols.append({
            'kind':      'function',
            'name':      name,
            'line':      line_no,
            'end_line':  line_no,
            'bases':     [],
            'parent':    None,
            'is_public': True,
            'doc':       doc_map.get(line_no, None),
        })
        seen_names.add(name)

    return symbols


def scan_js(src: str) -> tuple:
    """
    JavaScript file analysis.

    Returns: (imports, funcdefs, all_calls, extra_dict, func_calls_by_func, symbol_defs)
    """
    clean = _strip_comments(src)
    doc_map = _extract_jsdoc_map(src)
    imports = _parse_imports(clean)

    funcdefs = []
    func_calls_by_func = []

    # Collect (match_obj, name, is_private) for all function patterns
    candidates = []

    for m in RE_JS_FUNC_DECL.finditer(clean):
        name = m.group(1)
        if name and name not in JS_KEYWORDS:
            candidates.append((m, name, name.startswith('_')))

    for m in RE_JS_ARROW.finditer(clean):
        name = m.group(1)
        if name and name not in JS_KEYWORDS and len(name) >= 2:
            candidates.append((m, name, name.startswith('_')))

    for m in RE_JS_FUNC_EXPR.finditer(clean):
        name = m.group(1)
        if name and name not in JS_KEYWORDS and len(name) >= 2:
            candidates.append((m, name, name.startswith('_')))

    for m in RE_JS_METHOD.finditer(clean):
        name = m.group(1)
        if name and name not in JS_KEYWORDS and name not in ('constructor', 'render'):
            candidates.append((m, name, name.startswith('_') or name.startswith('#')))

    # declare function
    for m in RE_TS_DECLARE_FUNC.finditer(clean):
        name = m.group(1)
        if name and name not in JS_KEYWORDS:
            candidates.append((m, name, False))

    # De-duplicate by name, keep first occurrence
    seen = set()
    for m, name, is_priv in candidates:
        if name in seen:
            continue
        seen.add(name)
        funcdefs.append({
            'label':     name,
            'is_efiapi': False,
            'is_static': is_priv,
        })
        # Try to extract body via brace matching
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

    extra = {'imports': imports, 'lang': 'javascript'}
    if docstrings:
        extra['docstrings'] = docstrings

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs


def scan_ts(src: str) -> tuple:
    """TypeScript — delegate to JS scanner (TS is a superset)."""
    imports, funcdefs, calls, extra, fcbf, sym_defs = scan_js(src)
    extra['lang'] = 'typescript'
    return imports, funcdefs, calls, extra, fcbf, sym_defs
