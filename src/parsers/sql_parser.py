#!/usr/bin/env python3
"""
parsers/sql_parser.py - VIZCODE SQL Parser

Extracts:
  imports             - included scripts: psql \\i, sqlite .read, Oracle @file,
                        MySQL SOURCE  (leaf/stem name)
  funcdefs            - CREATE FUNCTION / PROCEDURE / TRIGGER
  funccalls           - call expressions in routine bodies (builtins excluded)
  func_calls_by_func  - per-routine call lists
  symbol_defs         - tables / views / types (symbols) + routines (functions)

SQL is declarative; "dependencies" are included script files. Routine bodies are
dialect-specific: Postgres dollar-quoting `$$ ... $$` / `$tag$ ... $tag$`, or
`BEGIN ... END`, or a single statement. Statement scanning skips dollar-quoted
regions so `;` inside a body does not end the CREATE prematurely.

Syntax verified against SQL standard + PostgreSQL/MySQL/T-SQL references:
  `--` line and `/* */` block comments; strings `'...'` (escape by `''`),
  delimited identifiers `"..."`/`` `...` ``. Keywords are case-insensitive.
  (`#` is NOT treated as a comment to avoid clobbering T-SQL `#temp` names.)
"""

import re

SQL_EXTENSIONS = {'.sql'}

SQL_KEYWORDS = {
    'SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE', 'CREATE', 'DROP',
    'ALTER', 'TABLE', 'INDEX', 'JOIN', 'INNER', 'LEFT', 'RIGHT', 'OUTER',
    'FULL', 'ON', 'AND', 'OR', 'NOT', 'IS', 'NULL', 'AS', 'BY', 'ORDER',
    'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'ALL', 'DISTINCT', 'INTO',
    'VALUES', 'SET', 'BEGIN', 'END', 'RETURNS', 'RETURN', 'DECLARE', 'CURSOR',
    'FETCH', 'EXECUTE', 'EXEC', 'GRANT', 'REVOKE', 'IF', 'ELSE', 'ELSIF',
    'ELSEIF', 'CASE', 'WHEN', 'THEN', 'LOOP', 'WHILE', 'FOR', 'FUNCTION',
    'PROCEDURE', 'TRIGGER', 'VIEW', 'TYPE', 'REPLACE', 'OR_REPLACE', 'LANGUAGE',
    'CALL', 'PERFORM', 'RAISE', 'COMMIT', 'ROLLBACK', 'WITH', 'USING', 'OVER',
    'PARTITION', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'COALESCE', 'CAST',
    'CONVERT', 'NULLIF', 'EXISTS', 'IN', 'LIKE', 'BETWEEN', 'PRIMARY', 'KEY',
    'FOREIGN', 'REFERENCES', 'CONSTRAINT', 'DEFAULT', 'CHECK', 'UNIQUE',
    # type names
    'INT', 'INTEGER', 'BIGINT', 'SMALLINT', 'TINYINT', 'FLOAT', 'DOUBLE',
    'DECIMAL', 'NUMERIC', 'REAL', 'BOOLEAN', 'BOOL', 'DATE', 'TIME',
    'TIMESTAMP', 'VARCHAR', 'CHAR', 'TEXT', 'BLOB', 'CLOB', 'NVARCHAR',
    'NCHAR', 'SERIAL', 'BIGSERIAL', 'UUID', 'JSON', 'JSONB', 'XML', 'BYTEA',
}

RE_SQL_INCLUDE = re.compile(
    r'''^[ \t]*(?:\\i(?:r|nclude)?\s+|\.read\s+|@@?\s*|SOURCE\s+)'''
    r'''['"]?([^\s'";]+)['"]?''',
    re.IGNORECASE | re.MULTILINE)
RE_SQL_FUNC = re.compile(
    r'\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+'
    r'(?:IF\s+NOT\s+EXISTS\s+)?(?P<name>[A-Za-z_][\w.]*)',
    re.IGNORECASE)
RE_SQL_TRIGGER = re.compile(
    r'\bCREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+(?P<name>[A-Za-z_][\w.]*)',
    re.IGNORECASE)
RE_SQL_TABLE = re.compile(
    r'\bCREATE\s+(?:(?:GLOBAL|LOCAL|TEMP|TEMPORARY|UNLOGGED)\s+)*TABLE\s+'
    r'(?:IF\s+NOT\s+EXISTS\s+)?(?P<name>[A-Za-z_][\w.]*)',
    re.IGNORECASE)
RE_SQL_VIEW = re.compile(
    r'\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+'
    r'(?:IF\s+NOT\s+EXISTS\s+)?(?P<name>[A-Za-z_][\w.]*)',
    re.IGNORECASE)
RE_SQL_TYPE = re.compile(
    r'\bCREATE\s+(?:OR\s+REPLACE\s+)?TYPE\s+'
    r'(?:IF\s+NOT\s+EXISTS\s+)?(?P<name>[A-Za-z_][\w.]*)',
    re.IGNORECASE)
RE_SQL_CALL = re.compile(r'\b([A-Za-z_]\w*)\s*\(')
RE_SQL_DOLLAR = re.compile(r'\$\w*\$')
_RE_SQL_BRANCH_KW = re.compile(r'\b(?:IF|CASE|LOOP|WHILE|FOR|WHEN)\b', re.I)


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _mask_sql(src: str) -> str:
    """Blank comments and string/identifier literals, preserving offsets.
    Dollar-quoted bodies are left intact (handled by statement scanning)."""
    out = list(src)
    i, n = 0, len(src)

    def blank(a, b):
        for j in range(a, min(b, n)):
            if out[j] != '\n':
                out[j] = ' '

    while i < n:
        c = src[i]
        nxt = src[i + 1] if i + 1 < n else ''
        if c == '-' and nxt == '-':
            start = i
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
        if c in '"`':                              # delimited identifier
            quote = c
            start = i
            i += 1
            while i < n:
                if src[i] == quote:
                    if src[i + 1:i + 2] == quote:   # "" / `` escape
                        i += 2
                        continue
                    i += 1
                    break
                i += 1
            blank(start, i)
            continue
        if c == "'":
            start = i
            i += 1
            while i < n:
                if src[i] == "'":
                    if src[i + 1:i + 2] == "'":      # '' escape
                        i += 2
                        continue
                    i += 1
                    break
                i += 1
            blank(start, i)
            continue
        i += 1
    return ''.join(out)


def _dollar_spans(s: str):
    """Return [(start,end)] of $tag$ ... $tag$ dollar-quoted regions."""
    spans = []
    i = 0
    while True:
        m = RE_SQL_DOLLAR.search(s, i)
        if not m:
            break
        tag = m.group(0)
        close = s.find(tag, m.end())
        if close == -1:
            spans.append((m.start(), len(s)))
            break
        end = close + len(tag)
        spans.append((m.start(), end))
        i = end
    return spans


def _stmt_end(clean: str, pos: int, spans) -> int:
    """Index just after the `;` that ends the statement starting at *pos*,
    skipping dollar-quoted regions. Falls back to end of string."""
    i = pos
    n = len(clean)
    while i < n:
        for a, b in spans:
            if a <= i < b:
                i = b
                break
        else:
            if clean[i] == ';':
                return i + 1
            i += 1
            continue
    return n


def _in_span(spans, idx) -> bool:
    return any(a <= idx < b for a, b in spans)


def _extract_calls(text: str) -> list:
    calls = []
    seen = set()
    for m in RE_SQL_CALL.finditer(text):
        name = m.group(1)
        if name.upper() in SQL_KEYWORDS or len(name) < 2 or name in seen:
            continue
        seen.add(name)
        calls.append(name)
    return calls


def _complexity(body: str) -> int:
    if not body:
        return 1
    return 1 + len(_RE_SQL_BRANCH_KW.findall(body))


def _leaf(qualified: str) -> str:
    return qualified.split('.')[-1].strip('"`[]')


def scan_sql(src: str, ext: str = '.sql') -> tuple:
    """SQL file analysis. Returns the standard VIZCODE 6-tuple."""
    clean = _mask_sql(src)
    spans = _dollar_spans(clean)

    imports = []
    for m in RE_SQL_INCLUDE.finditer(clean):
        if _in_span(spans, m.start()):
            continue
        base = re.split(r'[/\\]', m.group(1))[-1]
        ref = re.sub(r'\.(?:sql|psql|ddl)$', '', base, flags=re.IGNORECASE)
        if ref and len(ref) >= 2:
            imports.append(ref)
    imports = list(dict.fromkeys(imports))

    symbol_defs = []
    funcdefs = []
    func_calls_by_func = []
    seen = set()
    decl_name_starts = set()

    def add_type_symbol(kind, regex):
        for m in regex.finditer(clean):
            if _in_span(spans, m.start()):
                continue
            name = _leaf(m.group('name'))
            if not name or name.upper() in SQL_KEYWORDS or len(name) < 2:
                continue
            if name in seen:
                continue
            seen.add(name)
            start = m.start('name')
            decl_name_starts.add(start)
            end_idx = _stmt_end(clean, m.end(), spans)
            symbol_defs.append({
                'kind': kind, 'name': name, 'line': _line_no(src, start),
                'end_line': _line_no(src, max(start, end_idx - 1)),
                'bases': [], 'parent': None, 'is_public': True, 'doc': None,
            })

    add_type_symbol('table', RE_SQL_TABLE)
    add_type_symbol('view', RE_SQL_VIEW)
    add_type_symbol('type', RE_SQL_TYPE)

    def add_routine(regex):
        for m in regex.finditer(clean):
            if _in_span(spans, m.start()):
                continue
            name = _leaf(m.group('name'))
            if not name or name.upper() in SQL_KEYWORDS or len(name) < 2:
                continue
            if name in seen:
                continue
            seen.add(name)
            start = m.start('name')
            decl_name_starts.add(start)
            end_idx = _stmt_end(clean, m.end(), spans)
            body = clean[m.end():end_idx]
            funcdefs.append({'label': name, 'is_efiapi': False,
                             'is_static': False})
            func_calls_by_func.append(_extract_calls(body))
            symbol_defs.append({
                'kind': 'function', 'name': name, 'line': _line_no(src, start),
                'end_line': _line_no(src, max(start, end_idx - 1)),
                'bases': [], 'parent': None, 'is_public': True, 'doc': None,
                'complexity': _complexity(body),
            })

    add_routine(RE_SQL_FUNC)
    add_routine(RE_SQL_TRIGGER)

    all_calls = _extract_calls(clean)
    extra = {'imports': imports, 'lang': 'sql'}

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs
