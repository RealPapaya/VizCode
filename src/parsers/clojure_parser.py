#!/usr/bin/env python3
"""
parsers/clojure_parser.py - VIZCODE Clojure / ClojureScript Parser

Extracts:
  imports             - `(ns .. (:require ..))` and `(require '[..])` → ns leaf
  funcdefs            - `defn`/`defn-`/`defmacro`/`defmethod`
  funccalls           - call expressions (leading symbol of each form)
  func_calls_by_func  - per-definition call lists (matched paren scope)
  symbol_defs         - record / type / protocol / interface / var / function

Clojure forms are delimited by balanced parentheses. Verified against the
Clojure reader reference:
  * `;` line comments and the `#_` discard reader macro (which drops the next
    whole form) are both masked, so `#_(defn fake [])` produces no symbol;
  * `"..."` strings, `#"..."` regex literals and `\\c` character literals are
    masked so their brackets never disturb paren matching.
"""

import re

CLOJURE_EXTENSIONS = {'.clj', '.cljs'}

_SYM = r"[A-Za-z_][\w.*+!?<>=/'-]*"
RE_CLJ_NS = re.compile(r'\(ns\s+(' + _SYM + r')')
RE_CLJ_REQUIRE_VEC = re.compile(r'\[\s*(' + _SYM + r')')
RE_CLJ_REQUIRE_SYM = re.compile(r"\(require\s+'?\s*(" + _SYM + r')')
RE_CLJ_DEF = re.compile(
    r'\(\s*(defn-|defn|defmacro|defmethod|defmulti|def|defrecord|defprotocol|'
    r'deftype|definterface)\s+(' + _SYM + r')')
RE_CLJ_CALL = re.compile(r'\(\s*(' + _SYM + r')')

_FUNC_KINDS = {'defn', 'defn-', 'defmacro', 'defmethod', 'defmulti'}
_TYPE_KIND = {'defrecord': 'record', 'deftype': 'type',
              'defprotocol': 'protocol', 'definterface': 'interface'}

CLOJURE_SPECIAL = {
    'def', 'defn', 'defn-', 'defmacro', 'defmethod', 'defmulti', 'defrecord',
    'defprotocol', 'deftype', 'definterface', 'ns', 'require', 'import', 'use',
    'let', 'if', 'when', 'cond', 'do', 'fn', 'loop', 'recur', 'quote', 'var',
    'try', 'catch', 'finally', 'throw', 'new', 'set!', 'and', 'or', 'not',
    'case', 'condp', 'when-let', 'if-let', 'doseq', 'dotimes', 'for', 'map',
    'filter', 'reduce', 'println', 'print', 'str',
}


def _line_no(src: str, idx: int) -> int:
    return src[:idx].count('\n') + 1


def _blank_form(out, src, start, n, blank):
    """Blank one whole form beginning at `start`; return index past it."""
    while start < n and src[start] in ' \t\r\n,':
        start += 1
    if start >= n:
        return start
    pairs = {'(': ')', '[': ']', '{': '}'}
    c = src[start]
    if c == '#' and src[start + 1:start + 2] == '{':
        c = '{'
        open_i = start + 1
    elif c in pairs:
        open_i = start
    else:
        end = start
        while end < n and src[end] not in ' \t\r\n,()[]{}':
            end += 1
        blank(start, end)
        return end
    close = pairs[c]
    depth = 0
    i = open_i
    while i < n:
        if src[i] == c:
            depth += 1
        elif src[i] == close:
            depth -= 1
            if depth == 0:
                i += 1
                break
        i += 1
    blank(start, i)
    return i


def _mask_clj(src: str) -> str:
    out = list(src)
    n = len(src)

    def blank(start: int, end: int) -> None:
        for j in range(start, min(end, n)):
            if out[j] != '\n':
                out[j] = ' '

    i = 0
    while i < n:
        c = src[i]
        if c == ';':
            start = i
            while i < n and src[i] != '\n':
                i += 1
            blank(start, i)
            continue
        if c == '#' and src[i + 1:i + 2] == '_':
            blank(i, i + 2)
            i = _blank_form(out, src, i + 2, n, blank)
            continue
        if c == '#' and src[i + 1:i + 2] == '"':
            start = i
            i += 2
            while i < n:
                if src[i] == '\\':
                    i += 2
                    continue
                if src[i] == '"':
                    i += 1
                    break
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
                if src[i] == '"':
                    i += 1
                    break
                i += 1
            blank(start, i)
            continue
        if c == '\\':
            start = i
            i += 1
            if i < n and (src[i].isalnum() or src[i] == '_'):
                while i < n and (src[i].isalnum() or src[i] == '_'):
                    i += 1
            else:
                i += 1
            blank(start, i)
            continue
        i += 1

    return ''.join(out)


def _match_paren(clean: str, open_idx: int) -> int:
    depth = 0
    for i in range(open_idx, len(clean)):
        c = clean[i]
        if c == '(':
            depth += 1
        elif c == ')':
            depth -= 1
            if depth == 0:
                return i + 1
    return len(clean)


def _extract_calls(text: str) -> list:
    calls = []
    seen = set()
    for m in RE_CLJ_CALL.finditer(text):
        name = m.group(1)
        if name in CLOJURE_SPECIAL or len(name) < 2 or name in seen:
            continue
        seen.add(name)
        calls.append(name)
    return calls


def _complexity(body: str) -> int:
    if not body:
        return 1
    return 1 + len(re.findall(r'\(\s*(?:if|when|cond|condp|case|and|or)\b', body))


def scan_clojure(src: str, ext: str = '.clj') -> tuple:
    """Clojure file analysis. Returns the standard VIZCODE 6-tuple."""
    clean = _mask_clj(src)

    imports = []
    ns_block = None
    nm = RE_CLJ_NS.search(clean)
    if nm:
        ns_end = _match_paren(clean, clean.rfind('(', 0, nm.start() + 1))
        ns_block = clean[nm.start():ns_end]
        for rm in RE_CLJ_REQUIRE_VEC.finditer(ns_block):
            imports.append(rm.group(1).split('.')[-1])
    for rm in RE_CLJ_REQUIRE_SYM.finditer(clean):
        imports.append(rm.group(1).split('.')[-1])
    # standalone `(require '[a.b])` vectors outside ns
    for rm in re.finditer(r"\(require\b([^)]*)\)", clean):
        for vm in RE_CLJ_REQUIRE_VEC.finditer(rm.group(1)):
            imports.append(vm.group(1).split('.')[-1])
    imports = [x for x in dict.fromkeys(imports) if x and x not in CLOJURE_SPECIAL]

    funcdefs = []
    func_calls_by_func = []
    symbol_defs = []
    seen = set()
    for m in RE_CLJ_DEF.finditer(clean):
        form = m.group(1)
        name = m.group(2)
        start = m.start(2)
        line_no = _line_no(src, start)
        key = (name, line_no)
        if key in seen:
            continue
        seen.add(key)
        open_idx = m.start()
        end_idx = _match_paren(clean, open_idx)
        body = clean[m.end():end_idx]
        end_line = _line_no(src, max(start, end_idx - 1))
        is_func = form in _FUNC_KINDS
        is_private = form == 'defn-'
        if is_func:
            funcdefs.append({'label': name, 'is_efiapi': False,
                             'is_static': False})
            func_calls_by_func.append(_extract_calls(body))
        symbol_defs.append({
            'kind': _TYPE_KIND.get(form, 'function' if is_func else 'var'),
            'name': name, 'line': line_no, 'end_line': end_line,
            'bases': [], 'parent': None, 'is_public': not is_private,
            'doc': None, 'complexity': _complexity(body),
        })

    all_calls = _extract_calls(clean)

    extra = {'imports': imports, 'lang': 'clojure'}

    return imports, funcdefs, all_calls, extra, func_calls_by_func, symbol_defs
