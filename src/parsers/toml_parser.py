#!/usr/bin/env python3
"""
parsers/toml_parser.py - VIZCODE TOML Parser

TOML is data/config; it has no functions and no file-level dependencies (Cargo
`[dependencies]` etc. name packages, not files, so they are intentionally not
turned into edges). We extract:

  imports             - always [] (no precision-safe file edges exist)
  funcdefs            - always []
  funccalls           - always []
  func_calls_by_func  - always []
  symbol_defs         - tables `[table]` and array-of-tables `[[table]]` (kind 'table')

Comments are `#` (not inside strings). String forms: basic and literal strings,
plus their triple-quoted multiline variants. All are masked (offsets preserved)
before scanning so a `#` or `[` inside a value is never misread.
"""

import re

TOML_EXTENSIONS = {'.toml'}

# Table header at line start: [table] or [[array.table]]
RE_TOML_TABLE = re.compile(r'(?m)^[ \t]*(\[\[?)\s*([^\[\]]+?)\s*(\]\]?)')
RE_TOML_SECTION = re.compile(r'^[ \t]*\[\[?\s*([^\[\]]+?)\s*\]\]?[ \t]*(?:#.*)?$')
RE_TOML_STRING = re.compile(r'"([^"\\]*(?:\\.[^"\\]*)*)"|\'([^\']*)\'')
_TOML_CONFIG_KEYS = {
    'file', 'schema', 'schemafile', 'config', 'configfile', 'template',
    'templatefile', 'values', 'valuesfile',
}
_TOML_SCHEMA_KEYS = {'schema', 'schemafile'}


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _clean_local_path(value: str):
    ref = (value or '').strip().replace('\\', '/')
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


def _cargo_manifest_target(ref: str) -> str:
    if _path_ext(ref):
        return ref
    return ref.rstrip('/') + '/Cargo.toml'


def _hint(target: str, subtype: str, via: str, line: int,
          edge_type: str = 'config_ref') -> dict:
    return {
        'type': edge_type,
        'target': target,
        'subtype': subtype,
        'via': via,
        'line': line,
        'confidence': 1.0,
    }


def _extract_strings(value_src: str) -> list:
    values = []
    for m in RE_TOML_STRING.finditer(value_src):
        value = m.group(1) if m.group(1) is not None else m.group(2)
        if value is not None:
            values.append(value)
    return values


def _parse_edge_hints(src: str) -> list:
    hints = []
    section = ''
    offset = 0
    for line_no, line in enumerate(src.splitlines(), start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            offset += len(line) + 1
            continue
        sec = RE_TOML_SECTION.match(line)
        if sec:
            section = sec.group(1).strip()
            offset += len(line) + 1
            continue
        if '=' not in line:
            offset += len(line) + 1
            continue
        key, raw_value = line.split('=', 1)
        key = key.strip()
        values = _extract_strings(raw_value)
        for raw in values:
            ref = _clean_local_path(raw)
            if not ref:
                continue
            if section == 'workspace' and key in ('members', 'exclude'):
                hints.append(_hint(_cargo_manifest_target(ref), 'cargo_workspace', f'workspace.{key}', line_no))
            elif key == 'path' and (
                section.endswith('dependencies')
                or section.endswith('dev-dependencies')
                or section.endswith('build-dependencies')
                or '.dependencies.' in section
            ):
                hints.append(_hint(_cargo_manifest_target(ref), 'cargo_path_dependency', f'{section}.path', line_no))
            elif section == 'package' and key in ('include', 'exclude', 'license-file', 'readme'):
                hints.append(_hint(ref, 'cargo_package', f'package.{key}', line_no))
            elif section.startswith('tool.') and _path_ext(ref):
                hints.append(_hint(ref, 'tool_config', f'{section}.{key}', line_no))
            elif key.lower() in _TOML_CONFIG_KEYS and _path_ext(ref):
                via = f'{section}.{key}' if section else key
                edge_type = 'schema_ref' if key.lower() in _TOML_SCHEMA_KEYS else 'config_ref'
                subtype = 'schema' if edge_type == 'schema_ref' else 'config_value'
                hints.append(_hint(ref, subtype, via, line_no, edge_type))
        offset += len(line) + 1
    deduped = {}
    for hint in hints:
        deduped[(hint['type'], hint['target'], hint['subtype'], hint['via'], hint['line'])] = hint
    return list(deduped.values())


def _blank(out: list, start: int, end: int) -> None:
    n = len(out)
    for k in range(start, min(end, n)):
        if out[k] != '\n':
            out[k] = ' '


def _mask(src: str) -> str:
    """Blank comments and string literals, preserving offsets."""
    out = list(src)
    n = len(src)
    i = 0
    while i < n:
        three = src[i:i + 3]
        c = src[i]
        if three == '"""' or three == "'''":
            end = src.find(three, i + 3)
            end = (end + 3) if end != -1 else n
            _blank(out, i, end)
            i = end
            continue
        if c == '"':
            start = i
            i += 1
            while i < n:
                if src[i] == '\\':
                    i += 2
                    continue
                if src[i] == '"':
                    i += 1
                    break
                if src[i] == '\n':
                    break
                i += 1
            _blank(out, start, i)
            continue
        if c == "'":                       # literal string (no escapes)
            start = i
            i += 1
            while i < n and src[i] != "'" and src[i] != '\n':
                i += 1
            if i < n and src[i] == "'":
                i += 1
            _blank(out, start, i)
            continue
        if c == '#':
            while i < n and src[i] != '\n':
                out[i] = ' '
                i += 1
            continue
        i += 1
    return ''.join(out)


def scan_toml(src: str, ext: str = '.toml') -> tuple:
    """TOML file analysis. Returns the standard 6-tuple."""
    clean = _mask(src)

    symbol_defs = []
    seen = set()
    for m in RE_TOML_TABLE.finditer(clean):
        is_array = m.group(1) == '[[' and m.group(3) == ']]'
        name = m.group(2).strip()
        if not name:
            continue
        key = (name, is_array)
        if key in seen:
            continue
        seen.add(key)
        symbol_defs.append({
            'kind': 'table',
            'name': name,
            'line': _line_no(src, m.start()),
            'end_line': _line_no(src, m.start()),
            'bases': ['array'] if is_array else [],
            'parent': None,
            'is_public': True,
            'doc': None,
            'complexity': 1,
        })

    extra = {'imports': [], 'lang': 'toml'}
    edge_hints = _parse_edge_hints(src)
    if edge_hints:
        extra['edge_hints'] = edge_hints
    return [], [], [], extra, [], symbol_defs
