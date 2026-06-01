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

# Decorator lines:  @Component  /  @Injectable()  /  @Input  (one per line)
RE_JS_DECORATOR = re.compile(r'^\s*@([A-Za-z_$][\w$]*)', re.MULTILINE)

# Relative import/require with an explicit file extension:
#   import x from './a.css'  |  require('./a.json')  |  import './styles.scss'
RE_JS_IMPORT_PATH = re.compile(
    r"""(?:^|;|\})\s*import\s+(?:[^'"]*from\s+)?['"](\.[^'"]+)['"]""",
    re.MULTILINE
)
RE_JS_REQUIRE_PATH = re.compile(r"""\brequire\s*\(\s*['"](\.[^'"]+)['"]\s*\)""")
# templateUrl: './x.html'  (Angular component metadata)
RE_JS_TEMPLATEURL = re.compile(
    r"""\btemplateUrl\s*:\s*['"]([^'"]+)['"]"""
)

# Global-namespace assignment (export):  window.X = ...  /  globalThis.X = ...
# Single `=` only (negative lookahead rejects ==, ===).
RE_JS_GLOBAL_DEF = re.compile(
    r'\b(?:window|globalThis)\.([A-Za-z_$][\w$]*)\s*=(?!=)'
)
# Global-namespace member access (use):  window.X  /  globalThis.X
RE_JS_GLOBAL_USE = re.compile(
    r'\b(?:window|globalThis)\.([A-Za-z_$][\w$]*)'
)

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


def _parse_globals(clean: str) -> tuple:
    """Return (global_defs, global_uses) for window./globalThis. names.

    Used to link files in non-ESM (global <script>) codebases where modules
    share a global namespace instead of import/require.
    """
    defs = {m.group(1) for m in RE_JS_GLOBAL_DEF.finditer(clean)}
    uses = {m.group(1) for m in RE_JS_GLOBAL_USE.finditer(clean)}
    return sorted(defs), sorted(uses)


# ─── Cyclomatic complexity (regex approximation for JS/TS) ───────────────────
_RE_JS_STRINGS = re.compile(
    r'"(?:[^"\\]|\\.)*"'
    r"|'(?:[^'\\]|\\.)*'"
    r'|`(?:[^`\\]|\\.)*`',
    re.DOTALL
)
_RE_JS_BRANCH_KW = re.compile(r'\b(?:if|for|while|case|catch)\b')


def _count_complexity_js(body: str) -> int:
    """Approximate cyclomatic complexity for a JS/TS function body.

    Adds +1 per branch keyword (``if`` / ``for`` / ``while`` / ``case`` /
    ``catch``), per short-circuit operator (``&&`` / ``||``), and per
    ternary ``?``. String literals are masked first; ``?.`` and ``??``
    are neutralised so they don't false-positive on the ternary count.

    Approximate by design — JS has no real AST in this project. Documented
    as inexact in the dashboard.
    """
    if not body:
        return 1
    try:
        masked = _RE_JS_STRINGS.sub('""', body)
    except Exception:
        masked = body
    masked = masked.replace('?.', ' ').replace('??', ' ')
    count = 1
    count += len(_RE_JS_BRANCH_KW.findall(masked))
    count += masked.count('&&')
    count += masked.count('||')
    count += masked.count('?')
    return count


# ─── L3 type_usage support: project-type references in TS annotations ────────
# TS/stdlib generic & utility types that are NOT user types — never become
# `type_usage` edges. Lowercase primitives (string/number/boolean/...) are
# already excluded by the PascalCase filter.
TS_TYPE_BUILTINS = frozenset({
    'Array', 'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Record', 'Partial',
    'Readonly', 'Required', 'Pick', 'Omit', 'Exclude', 'Extract', 'ReturnType',
    'Parameters', 'Awaited', 'Date', 'RegExp', 'Error', 'Object', 'Function',
    'Boolean', 'Number', 'String', 'Symbol', 'BigInt', 'ReadonlyArray',
    'Iterable', 'Iterator', 'Generator',
})

# Identifier tokens inside a type annotation. We only keep PascalCase names.
_RE_TS_TYPE_IDENT = re.compile(r'[A-Za-z_$][\w$]*')


def _collect_ts_type_names(annotation: str, out: set) -> None:
    """Collect candidate type identifiers from a TS type-annotation string."""
    if not annotation:
        return
    for m in _RE_TS_TYPE_IDENT.finditer(annotation):
        out.add(m.group(0))


def _filter_ts_type_refs(names: set) -> list:
    """Keep only plausible user-defined TS type names (PascalCase, >=3 chars)."""
    out = []
    for name in sorted(names):
        if not name or len(name) < 3 or not name[0].isupper():
            continue
        if name in TS_TYPE_BUILTINS:
            continue
        out.append(name)
    return out


# ─── L1 edge_hints: asset/config file references ─────────────────────────────
_CONFIG_EXTS = {'.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.env'}
_ASSET_EXTS = {'.html', '.htm', '.css', '.scss', '.sass', '.less', '.svg', '.png',
               '.jpg', '.jpeg', '.gif', '.csv', '.sql', '.xml'}


def _classify_ref(ref: str):
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


def _collect_edge_hints(src: str, clean: str) -> list:
    """Asset/config refs from relative import/require paths + Angular templateUrl.

    Only quoted string literals with a known extension qualify; resolve_ref()
    in the analyzer additionally drops anything that is not a real project file.
    """
    hints = []
    seen = set()

    def _add(target, via, pos):
        etype = _classify_ref(target)
        if not etype:
            return
        key = (target, via)
        if key in seen:
            return
        seen.add(key)
        hints.append({
            'type': etype,
            'target': target.strip(),
            'via': via,
            'line': src[:pos].count('\n') + 1,
            'origin': 'parser',
            'confidence': 'high',
        })

    for m in RE_JS_IMPORT_PATH.finditer(clean):
        _add(m.group(1), 'import', m.start())
    for m in RE_JS_REQUIRE_PATH.finditer(clean):
        _add(m.group(1), 'require', m.start())
    for m in RE_JS_TEMPLATEURL.finditer(clean):
        _add(m.group(1), 'templateUrl', m.start())

    return hints


def _decorators_above(src: str, decl_pos: int) -> list:
    """Collect '@Decorator' names on the lines immediately above ``decl_pos``.

    Scans upward over contiguous decorator lines (skipping blank lines), so a
    class/method preceded by ``@Component``/``@Input`` etc. carries them.
    """
    line_start = src.rfind('\n', 0, decl_pos) + 1
    decorators = []
    cur = line_start
    pending = ''   # accumulated continuation lines of a multiline decorator call
    bal = 0        # paren/brace balance of the pending block
    while cur > 0:
        prev_end = cur - 1                      # index of the '\n' before this line
        prev_start = src.rfind('\n', 0, prev_end) + 1
        line = src[prev_start:prev_end]
        stripped = line.strip()
        if stripped == '' and bal == 0:
            cur = prev_start
            continue
        bal += stripped.count(')') + stripped.count('}')
        bal -= stripped.count('(') + stripped.count('{')
        m = RE_JS_DECORATOR.match(line)
        if m and bal == 0:
            decorators.append(m.group(1))
            pending = ''
            cur = prev_start
            continue
        if bal > 0:
            # Inside a multiline decorator call body — keep walking up.
            cur = prev_start
            continue
        break
    decorators.reverse()
    return decorators


def _signature_from_method_match(match_text: str, ts_mode: bool) -> str:
    """Build a signature from a full RE_JS_METHOD match (name(...)[: Ret] {)."""
    paren = match_text.find('(')
    if paren == -1:
        return ''
    depth = 0
    end = -1
    for i in range(paren, len(match_text)):
        c = match_text[i]
        if c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
            if depth == 0:
                end = i
                break
    if end == -1:
        return ''
    params = ' '.join(match_text[paren + 1:end].split())
    sig = f'({params})'
    if ts_mode:
        rm = re.match(r'\s*:\s*([^{;=\n]+)', match_text[end + 1:])
        if rm:
            ret = rm.group(1).strip().rstrip(' =>').strip()
            if ret:
                sig += f' -> {ret}'
    return sig


def _signature_from_decl(clean: str, decl_end: int, ts_mode: bool) -> str:
    """Build a "(params) -> ret" signature starting at the '(' after decl_end.

    Reads the balanced parameter list; for TS, appends the ': ReturnType' that
    follows the closing ')' (up to the body '{' or end of statement).
    """
    paren = clean.find('(', decl_end - 1)
    if paren == -1:
        return ''
    depth = 0
    end = -1
    for i in range(paren, len(clean)):
        c = clean[i]
        if c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
            if depth == 0:
                end = i
                break
    if end == -1:
        return ''
    params = ' '.join(clean[paren + 1:end].split())
    sig = f'({params})'
    if ts_mode:
        # Capture an explicit return-type annotation: ') : Ret {' or ') : Ret;'.
        rest = clean[end + 1:]
        rm = re.match(r'\s*:\s*([^{;=\n]+)', rest)
        if rm:
            ret = rm.group(1).strip().rstrip(' =>').strip()
            if ret:
                sig += f' -> {ret}'
    return sig


def _parse_symbol_defs(src: str, clean: str, doc_map: dict, ts_mode: bool) -> list:
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
            'kind':       'class',
            'name':       name,
            'line':       line_no,
            'end_line':   end_line,
            'bases':      bases,
            'parent':     None,
            'is_public':  not name.startswith('_'),
            'doc':        doc_map.get(line_no, None),
            'decorators': _decorators_above(clean, m.start(1)),
        })
        # Methods inside the class body
        body = _brace_body(clean, open_idx) if open_idx != -1 else ''
        body_start_line = line_no
        for mm in RE_JS_METHOD.finditer(body):
            mname = mm.group(1)
            if mname in JS_KEYWORDS:
                continue
            mline = body_start_line + body[:mm.start()].count('\n')
            # Method end_line + body for complexity
            method_brace = body.find('{', mm.end() - 1)
            m_end = _brace_end_line(body, method_brace, mline) if method_brace != -1 else mline
            method_body = _brace_body(body, method_brace) if method_brace != -1 else ''
            sig = _signature_from_method_match(mm.group(0), ts_mode)
            mtype_refs = []
            if ts_mode:
                _names = set()
                _collect_ts_type_names(sig, _names)
                mtype_refs = _filter_ts_type_refs(_names)
            # Decorator position is the absolute offset of this method in src.
            m_abs = open_idx + 1 + mm.start() if open_idx != -1 else mm.start()
            symbols.append({
                'kind':       'method',
                'name':       mname,
                'line':       mline,
                'end_line':   m_end,
                'bases':      [],
                'parent':     name,
                'is_public':  not mname.startswith('_') and not mname.startswith('#'),
                'doc':        doc_map.get(mline, None),
                'complexity': _count_complexity_js(method_body),
                'decorators': _decorators_above(clean, m_abs),
                'signature':  sig,
                'type_refs':  mtype_refs,
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
        fbody = _brace_body(clean, open_idx) if open_idx != -1 else ''
        sig = _signature_from_decl(clean, m.end(), ts_mode)
        ftype_refs = []
        if ts_mode:
            _names = set()
            _collect_ts_type_names(sig, _names)
            ftype_refs = _filter_ts_type_refs(_names)
        symbols.append({
            'kind':       'function',
            'name':       fname,
            'line':       line_no,
            'end_line':   end_line,
            'bases':      [],
            'parent':     None,
            'is_public':  not fname.startswith('_'),
            'doc':        doc_map.get(line_no, None),
            'complexity': _count_complexity_js(fbody),
            'decorators': _decorators_above(clean, m.start(1)),
            'signature':  sig,
            'type_refs':  ftype_refs,
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
            fbody = _brace_body(clean, open_idx) if open_idx != -1 else ''
            # Signature: find the '(' that opens this expression's param list.
            sig = _signature_from_decl(clean, m.start(), ts_mode)
            ftype_refs = []
            if ts_mode:
                _names = set()
                _collect_ts_type_names(sig, _names)
                ftype_refs = _filter_ts_type_refs(_names)
            symbols.append({
                'kind':       'function',
                'name':       fname,
                'line':       line_no,
                'end_line':   end_line,
                'bases':      [],
                'parent':     None,
                'is_public':  not fname.startswith('_'),
                'doc':        doc_map.get(line_no, None),
                'complexity': _count_complexity_js(fbody),
                'decorators': _decorators_above(clean, m.start()),
                'signature':  sig,
                'type_refs':  ftype_refs,
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
        # Property type annotations inside the interface body feed type_refs.
        itype_refs = []
        if ts_mode and open_idx != -1:
            ibody = _brace_body(clean, open_idx)
            _names = set()
            for pm in re.finditer(r':\s*([^;,\n{}]+)', ibody):
                _collect_ts_type_names(pm.group(1), _names)
            itype_refs = _filter_ts_type_refs(_names)
        symbols.append({
            'kind':      'interface',
            'name':      name,
            'line':      line_no,
            'end_line':  end_line,
            'bases':     bases,
            'parent':    None,
            'is_public': not name.startswith('_'),
            'doc':       doc_map.get(line_no, None),
            'type_refs': itype_refs,
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
            'kind':       'function',
            'name':       name,
            'line':       line_no,
            'end_line':   line_no,
            'bases':      [],
            'parent':     None,
            'is_public':  True,
            'doc':        doc_map.get(line_no, None),
            'complexity': 1,  # declare-only — no body to count
        })
        seen_names.add(name)

    return symbols


def scan_js(src: str, _ts_mode: bool = False) -> tuple:
    """
    JavaScript file analysis.

    ``_ts_mode`` (set by :func:`scan_ts`) enables TypeScript-only enrichment:
    return-type signatures and ``type_refs`` from ``: TypeName`` annotations.

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
    symbol_defs = _parse_symbol_defs(src, clean, doc_map, _ts_mode)

    # Collect docstrings into extra
    docstrings = {}
    for sym in symbol_defs:
        if sym.get('doc'):
            key = f"{sym['parent']}.{sym['name']}" if sym['parent'] else sym['name']
            docstrings[key] = sym['doc']

    extra = {'imports': imports, 'lang': 'javascript'}
    if docstrings:
        extra['docstrings'] = docstrings

    global_defs, global_uses = _parse_globals(clean)
    if global_defs:
        extra['global_defs'] = global_defs
    if global_uses:
        extra['global_uses'] = global_uses

    edge_hints = _collect_edge_hints(src, clean)
    if edge_hints:
        extra['edge_hints'] = edge_hints

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs


def scan_ts(src: str) -> tuple:
    """TypeScript — delegate to JS scanner (TS is a superset)."""
    imports, funcdefs, calls, extra, fcbf, sym_defs = scan_js(src, _ts_mode=True)
    extra['lang'] = 'typescript'
    return imports, funcdefs, calls, extra, fcbf, sym_defs
