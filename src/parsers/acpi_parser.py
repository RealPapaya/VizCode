"""
parsers/acpi_parser.py — ACPI ASL parser

Handles ACPI Source Language:
  ACPI                 .asl

Entry point:
  scan_acpi(src, ext) → 6-tuple
  (refs, funcdefs, funccalls, extra_dict, func_calls_by_func, symbol_defs)
"""

import re

RE_INCLUDE = re.compile(r'#\s*include\s+["<]([^">]+)[">]')


def strip_comments(src: str) -> str:
    """Remove // and /* */ comments while preserving string literals.

    Newlines inside block comments are kept so reported symbol line numbers do
    not shift.
    """
    result, i, n = [], 0, len(src)
    while i < n:
        if src[i:i+2] == '//':
            while i < n and src[i] != '\n':
                i += 1
        elif src[i:i+2] == '/*':
            i += 2
            while i < n and src[i-1:i+1] != '*/':
                if src[i] == '\n':
                    result.append('\n')
                i += 1
            i += 1
        elif src[i] in '"\'':
            q = src[i]; result.append(src[i]); i += 1
            while i < n and src[i] != q:
                if src[i] == '\\': result.append(src[i]); i += 1
                result.append(src[i]); i += 1
            if i < n: result.append(src[i]); i += 1
        else:
            result.append(src[i]); i += 1
    return ''.join(result)


# ACPI named-object declarations → symbol_defs. ASL namestrings may be prefixed
# with a root/parent path (\, ^) and dotted; we display the trailing segment.
_RE_ASL_NAME = r'([\\^]*[A-Za-z_][\w.]*)'
_ASL_SYMBOL_DECLS = [
    (re.compile(r'\bMethod\s*\(\s*' + _RE_ASL_NAME, re.IGNORECASE),          'function'),
    (re.compile(r'\bDevice\s*\(\s*' + _RE_ASL_NAME, re.IGNORECASE),          'class'),
    (re.compile(r'\bScope\s*\(\s*' + _RE_ASL_NAME, re.IGNORECASE),           'module'),
    (re.compile(r'\bOperationRegion\s*\(\s*' + _RE_ASL_NAME, re.IGNORECASE), 'struct'),
]


def scan_asl(src: str) -> dict:
    """
    Parse ACPI ASL source (ACPI spec / iASL).
    Returns: includes, externals, tablename, symbol_defs
    """
    clean = strip_comments(src)  # ASL uses C-style // and /* */ comments
    RE_ASL_INC  = re.compile(r'\bInclude\s*\(\s*"([^"]+)"\s*\)', re.IGNORECASE)
    RE_EXTERNAL = re.compile(r'\bExternal\s*\(\s*\\?(\w[\w.]+)', re.IGNORECASE)
    RE_DEFBLOCK = re.compile(r'\bDefinitionBlock\s*\(\s*"[^"]*"\s*,\s*"([^"]+)"', re.IGNORECASE)
    includes  = RE_ASL_INC.findall(clean) + RE_INCLUDE.findall(clean)
    externals = RE_EXTERNAL.findall(clean)
    tablename = next((m.group(1) for m in RE_DEFBLOCK.finditer(clean)), None)

    symbol_defs = []
    seen = set()
    for rx, kind in _ASL_SYMBOL_DECLS:
        for m in rx.finditer(clean):
            raw_name = m.group(1)
            name = raw_name.lstrip('\\^').split('.')[-1]
            if not name or len(name) < 2:
                continue
            key = (kind, name)
            if key in seen:
                continue
            seen.add(key)
            line_no = clean[:m.start()].count('\n') + 1
            symbol_defs.append({
                'kind': kind, 'name': name, 'line': line_no, 'end_line': line_no,
                'bases': [], 'parent': None, 'is_public': True,
            })
    return {'includes': includes, 'externals': externals,
            'tablename': tablename, 'symbol_defs': symbol_defs}


# ─── Main entry point ──────────────────────────────────────────────────────────

ACPI_EXTENSIONS = {'.asl'}


def scan_acpi(src: str, ext: str):
    """
    ACPI parser entry point.

    Returns the standard 6-tuple:
        (refs, funcdefs, funccalls, extra_dict, func_calls_by_func, symbol_defs)
    """
    if ext.lower() == '.asl':
        data = scan_asl(src)
        return data['includes'], [], [], data, [], data['symbol_defs']
    return [], [], [], None, [], []
