#!/usr/bin/env python3
"""
parsers/common_parser.py — VIZCODE Generic Language Fallback Parser

Handles ANY text-based source file not covered by a dedicated parser.
Extracts imports, function/class definitions, and calls using broad
cross-language regex heuristics.

Supported families (non-exhaustive):
  Java, Kotlin, Scala, Groovy, Dart, Swift, Objective-C
  C#, VB.NET, F#
  Ruby, PHP, Perl, Lua, Shell
  R, Julia
  Rust, Zig, D, Nim, Crystal
  Elixir, Erlang, Clojure, Haskell, OCaml, Elm
  SQL, GraphQL, Protobuf

Returns the standard VIZCODE parser 6-tuple:
  (imports, funcdefs, funccalls, extra_dict, func_calls_by_func, symbol_defs)
"""

import re

# ─── Universal keyword blocklist ──────────────────────────────────────────────
_SKIP_NAMES = {
    # Control flow
    'if', 'else', 'elif', 'elseif', 'unless', 'while', 'for', 'foreach',
    'loop', 'do', 'until', 'repeat', 'when', 'case', 'match', 'switch',
    'break', 'continue', 'return', 'yield', 'throw', 'raise', 'rescue',
    'try', 'catch', 'except', 'finally', 'with',
    # Declarations
    'class', 'struct', 'enum', 'interface', 'trait', 'impl', 'module',
    'namespace', 'package', 'object', 'record', 'extend', 'mixin',
    'def', 'fn', 'fun', 'func', 'function', 'sub', 'method',
    'let', 'var', 'val', 'const', 'final', 'static', 'new', 'mut',
    'import', 'export', 'from', 'use', 'using', 'require', 'include',
    'public', 'private', 'protected', 'internal', 'abstract', 'virtual',
    'override', 'async', 'await', 'extern', 'unsafe', 'ref', 'out', 'in',
    'pub', 'priv', 'mod', 'crate', 'move', 'where', 'dyn',
    # Literals/types
    'true', 'false', 'nil', 'null', 'None', 'True', 'False',
    'self', 'this', 'super', 'base', 'cls',
    'int', 'float', 'bool', 'str', 'string', 'char', 'byte', 'void',
    'uint', 'long', 'ulong', 'short', 'ushort', 'double', 'decimal',
    'String', 'Int', 'Float', 'Double', 'Boolean', 'Object', 'Any',
    # Common builtins
    'print', 'println', 'printf', 'sprintf', 'fprintf', 'echo',
    'len', 'size', 'count', 'push', 'pop', 'append', 'prepend',
    'map', 'filter', 'reduce', 'fold', 'each', 'collect',
    'open', 'close', 'read', 'write', 'send', 'recv',
    'make', 'new', 'delete', 'free', 'alloc', 'malloc',
    'get', 'set', 'add', 'remove', 'insert', 'update',
    'begin', 'end', 'done', 'then',
    # SQL keywords
    'SELECT', 'FROM', 'WHERE', 'INSERT', 'UPDATE', 'DELETE', 'CREATE',
    'DROP', 'ALTER', 'TABLE', 'INDEX', 'JOIN', 'INNER', 'LEFT', 'RIGHT',
    'ON', 'AND', 'OR', 'NOT', 'IS', 'NULL', 'AS', 'BY', 'ORDER',
    'GROUP', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'ALL', 'DISTINCT',
    'INTO', 'VALUES', 'SET', 'BEGIN', 'END', 'RETURNS', 'RETURN',
    'DECLARE', 'CURSOR', 'FETCH', 'EXECUTE', 'EXEC', 'GRANT', 'REVOKE',
    # SQL type names (avoid false positives in CREATE TABLE)
    'INT', 'INTEGER', 'BIGINT', 'SMALLINT', 'TINYINT', 'FLOAT', 'DOUBLE',
    'DECIMAL', 'NUMERIC', 'REAL', 'BOOLEAN', 'DATE', 'TIME', 'TIMESTAMP',
    'VARCHAR', 'CHAR', 'TEXT', 'BLOB', 'CLOB', 'NVARCHAR', 'NCHAR',
    'SERIAL', 'BIGSERIAL', 'UUID', 'JSON', 'JSONB', 'XML', 'BYTEA',
    'ARRAY', 'BINARY', 'VARBINARY', 'BIT', 'MONEY', 'INTERVAL',
}

# ─── Language detection by extension ─────────────────────────────────────────
_EXT_TO_LANG = {
    '.rs': 'rust', '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin',
    '.cs': 'csharp', '.fs': 'fsharp', '.vb': 'vbnet',
    '.scala': 'scala', '.groovy': 'groovy', '.dart': 'dart',
    '.swift': 'swift', '.m': 'objc', '.mm': 'objcpp',
    '.rb': 'ruby', '.php': 'php', '.pl': 'perl', '.pm': 'perl',
    '.lua': 'lua', '.sh': 'shell', '.bash': 'shell', '.zsh': 'shell',
    '.r': 'r', '.R': 'r', '.jl': 'julia',
    '.zig': 'zig', '.d': 'd', '.nim': 'nim', '.cr': 'crystal',
    '.ex': 'elixir', '.exs': 'elixir', '.erl': 'erlang', '.hrl': 'erlang',
    '.clj': 'clojure', '.cljs': 'clojure',
    '.hs': 'haskell', '.ml': 'ocaml', '.mli': 'ocaml',
    '.elm': 'elm', '.sql': 'sql', '.graphql': 'graphql', '.gql': 'graphql',
    '.proto': 'protobuf', '.fsx': 'fsharp',
    # ── CSS / stylesheet family ──────────────────────────────────────────────
    '.css': 'css', '.scss': 'scss', '.sass': 'sass', '.less': 'less',
    '.styl': 'stylus',
}

# ─── Comment stripping ────────────────────────────────────────────────────────

_RE_BLOCK_COMMENT = re.compile(
    r'/\*.*?\*/'
    r'|""".*?"""'
    r"|'''.*?'''"
    r'|--\[\[.*?\]\]',
    re.DOTALL
)

_RE_STR_DQ = re.compile(r'"(?:[^"\\]|\\.)*"')
_RE_STR_SQ = re.compile(r"'(?:[^'\\]|\\.)*'")
_RE_STR_BT = re.compile(r'`[^`]*`')

# Line comment pattern — language-aware sets are used in _strip_comments().
# IMPORTANT: ';' is NOT a universal comment leader!  It is only valid in
# Lisp-family (Clojure), Assembly, and INI.  Applying it globally destroys
# every semicolon-terminated statement in Java, C#, JS, Rust, Go, etc.
_RE_LINE_COMMENT_UNIVERSAL = re.compile(
    r'//.*$'
    r'|#.*$',
    re.MULTILINE
)
_RE_LINE_COMMENT_SQL = re.compile(r'--.*$', re.MULTILINE)
_RE_LINE_COMMENT_LISP = re.compile(r';.*$', re.MULTILINE)


def _strip_comments(src: str, lang: str = 'unknown') -> str:
    """Strip comments with language-aware line-comment patterns.

    - ``//`` and ``#`` are treated as universal (safe for most languages).
    - ``--`` only for SQL, Haskell, Lua, Elm.
    - ``;`` only for Clojure (Lisp-family).
    """
    try:
        src = _RE_BLOCK_COMMENT.sub(' ', src)
        src = _RE_LINE_COMMENT_UNIVERSAL.sub('', src)
        if lang in ('sql', 'haskell', 'lua', 'elm'):
            src = _RE_LINE_COMMENT_SQL.sub('', src)
        if lang in ('clojure',):
            src = _RE_LINE_COMMENT_LISP.sub('', src)
    except Exception:
        pass
    return src


def _mask_strings(src: str) -> str:
    try:
        src = _RE_STR_DQ.sub('""', src)
        src = _RE_STR_SQ.sub("''", src)
        src = _RE_STR_BT.sub('``', src)
    except Exception:
        pass
    return src


# ─── LOC counter ──────────────────────────────────────────────────────────────

_LOC_HASH_EXTS = {
    '.py', '.rb', '.sh', '.bash', '.zsh', '.pl', '.pm', '.r', '.R',
    '.jl', '.ex', '.exs', '.nim', '.cr', '.zig', '.toml', '.yml', '.yaml',
    '.coffee', '.tcl',
}
_LOC_SLASH_EXTS = {
    '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.go', '.rs',
    '.java', '.kt', '.kts', '.scala', '.cs', '.fs', '.fsx',
    '.swift', '.dart', '.groovy', '.c', '.cpp', '.cc', '.cxx',
    '.h', '.hpp', '.hxx', '.m', '.mm', '.d', '.css', '.scss',
    '.sass', '.less', '.styl', '.proto', '.graphql', '.gql',
}
_LOC_DASH_EXTS = {'.sql', '.hs', '.lua', '.elm'}
_LOC_SEMI_EXTS = {'.clj', '.cljs', '.lisp', '.scm', '.el'}


def count_loc(text: str, ext: str = '') -> dict:
    """Classify each line of *text* as code / comment / blank.

    Block comments handled: C-family slash-star and Python triple-quote
    docstrings. Trailing comments don't reclassify a line — only lines whose
    first non-blank token is a comment marker count as comment.

    Returns a dict with three int keys: ``code``, ``comment``, ``blank``.
    """
    if not text:
        return {'code': 0, 'comment': 0, 'blank': 0}

    line_markers = []
    if ext in _LOC_HASH_EXTS:
        line_markers.append('#')
    if ext in _LOC_SLASH_EXTS:
        line_markers.append('//')
    if ext in _LOC_DASH_EXTS:
        line_markers.append('--')
    if ext in _LOC_SEMI_EXTS:
        line_markers.append(';')
    if not line_markers:
        line_markers = ['#', '//']  # safe default for unknown text files

    code = comment = blank = 0
    in_c_block = False        # /* ... */
    in_py_triple = False      # """ ... """ or ''' ... '''
    py_quote = ''

    try:
        for raw in text.splitlines():
            s = raw.strip()

            if in_c_block:
                comment += 1
                if '*/' in s:
                    in_c_block = False
                continue
            if in_py_triple:
                comment += 1
                if py_quote in s:
                    in_py_triple = False
                    py_quote = ''
                continue

            if not s:
                blank += 1
                continue

            if s.startswith('/*'):
                comment += 1
                if '*/' not in s[2:]:
                    in_c_block = True
                continue

            if ext == '.py' and (s.startswith('"""') or s.startswith("'''")):
                quote = s[:3]
                comment += 1
                # Closes on same line if the closing triple-quote appears
                # again after the opening one (and isn't immediately adjacent).
                if quote not in s[3:]:
                    in_py_triple = True
                    py_quote = quote
                continue

            if any(s.startswith(m) for m in line_markers):
                comment += 1
                continue

            code += 1
    except Exception:
        # Silent fail — return whatever we counted so far.
        pass

    return {'code': code, 'comment': comment, 'blank': blank}


# ─── Doc comment extraction ──────────────────────────────────────────────────

_RE_DOC_COMMENT = re.compile(r'/\*\*(.*?)\*/', re.DOTALL)
_RE_RUST_DOC = re.compile(r'^[ \t]*///(.*)$', re.MULTILINE)


def _extract_doc_map(src: str, lang: str) -> dict:
    """Build line_number → doc_text map for supported doc comment styles."""
    doc_map = {}

    if lang == 'rust':
        # Rust: /// doc comments preceding declarations
        lines = src.splitlines()
        i = 0
        while i < len(lines):
            line = lines[i].strip()
            if line.startswith('///'):
                doc_lines = []
                while i < len(lines) and lines[i].strip().startswith('///'):
                    doc_lines.append(lines[i].strip()[3:].strip())
                    i += 1
                if i < len(lines):
                    doc_map[i + 1] = '\n'.join(doc_lines)
            else:
                i += 1
    else:
        # Javadoc / JSDoc style: /** ... */
        for m in _RE_DOC_COMMENT.finditer(src):
            doc_text = m.group(1).strip()
            doc_lines = []
            for ln in doc_text.split('\n'):
                ln = ln.strip()
                if ln.startswith('*'):
                    ln = ln[1:].strip()
                if ln:
                    doc_lines.append(ln)
            clean_doc = '\n'.join(doc_lines)
            if clean_doc:
                end_pos = m.end()
                next_line = src[:end_pos].count('\n') + 1
                for offset in range(4):
                    doc_map[next_line + offset] = clean_doc

    return doc_map


# ─── Import extraction (language-aware) ──────────────────────────────────────
#
# Each entry: (lang_set_or_None, compiled_regex)
#   lang_set=None means "apply to all languages handled by common_parser".
#   When a set is given, the pattern is only tried for those languages.
#
# Patterns are ordered from most specific → least specific.

_LANG_IMPORT_PATTERNS = [
    # ── Rust ──────────────────────────────────────────────────────────────────
    # use crate::module::Item;  /  use std::collections::HashMap;
    # use super::foo;  /  use self::bar;
    ({'rust'}, re.compile(
        r'^[ \t]*(?:pub\s+)?use\s+([\w:]+(?:::\w+)*)',
        re.MULTILINE)),
    # mod foo;  (external module file)
    ({'rust'}, re.compile(
        r'^[ \t]*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;',
        re.MULTILINE)),
    # extern crate foo;  (older Rust)
    ({'rust'}, re.compile(
        r'^[ \t]*extern\s+crate\s+(\w+)',
        re.MULTILINE)),

    # ── Java / Kotlin / Scala / Groovy ────────────────────────────────────────
    # import com.example.MyClass;  /  import static com.example.Foo.bar;
    # Group 1 = 'static' (or None), Group 2 = dotted path
    ({'java', 'kotlin', 'scala', 'groovy'}, re.compile(
        r'^[ \t]*import\s+(static\s+)?([\w.]+)',
        re.MULTILINE)),

    # ── Dart ──────────────────────────────────────────────────────────────────
    # import 'package:flutter/material.dart';
    # import 'dart:async';
    # import '../utils/helper.dart';
    ({'dart'}, re.compile(
        r'''import\s+['"]([^'"]+)['"]''',
        re.MULTILINE)),

    # ── Swift ─────────────────────────────────────────────────────────────────
    # import Foundation  /  import struct Foundation.URL
    ({'swift'}, re.compile(
        r'^[ \t]*import\s+(?:class|struct|enum|protocol|typealias|func|var|let\s+)?(\w[\w.]*)',
        re.MULTILINE)),

    # ── Objective-C ───────────────────────────────────────────────────────────
    # #import "Header.h"  /  #import <Framework/Header.h>
    # @import Module;
    ({'objc', 'objcpp'}, re.compile(
        r'^[ \t]*(?:#\s*import\s+["<]([^">]+)[">]|@import\s+(\w+))',
        re.MULTILINE)),

    # ── C# ────────────────────────────────────────────────────────────────────
    # using System.Collections.Generic;
    # using static System.Math;
    # using MyAlias = Some.Namespace;
    ({'csharp'}, re.compile(
        r'^[ \t]*using\s+(?:static\s+)?(?:\w+\s*=\s*)?([\w.]+)\s*;',
        re.MULTILINE)),

    # ── VB.NET ────────────────────────────────────────────────────────────────
    # Imports System.Collections.Generic
    ({'vbnet'}, re.compile(
        r'^[ \t]*Imports\s+(?:\w+\s*=\s*)?([\w.]+)',
        re.MULTILINE)),

    # ── F# ────────────────────────────────────────────────────────────────────
    # open System.Collections.Generic
    ({'fsharp'}, re.compile(
        r'^[ \t]*open\s+([\w.]+)',
        re.MULTILINE)),

    # ── Ruby ──────────────────────────────────────────────────────────────────
    # require 'module'  /  require_relative './file'
    ({'ruby', 'crystal'}, re.compile(
        r'''(?:require|require_relative)\s+['"]([^'"]+)['"]''',
        re.MULTILINE)),

    # ── PHP ───────────────────────────────────────────────────────────────────
    # use App\Controllers\UserController;
    # require 'file.php';  /  include 'file.php';  /  require_once / include_once
    ({'php'}, re.compile(
        r'^[ \t]*use\s+([\w\\]+)',
        re.MULTILINE)),
    ({'php'}, re.compile(
        r'''(?:require|include|require_once|include_once)\s*\(?['"]([^'"]+)['"]\)?''',
        re.MULTILINE)),

    # ── Perl ──────────────────────────────────────────────────────────────────
    # use Module::Name;  /  use Module::Name qw(func1 func2);
    # require Module::Name;
    ({'perl'}, re.compile(
        r'^[ \t]*(?:use|require)\s+([\w:]+)',
        re.MULTILINE)),

    # ── Lua ───────────────────────────────────────────────────────────────────
    # require("module.name")  /  require "module_name"
    ({'lua'}, re.compile(
        r'''require\s*\(?\s*['"]([^'"]+)['"]\s*\)?''',
        re.MULTILINE)),

    # ── Elixir ────────────────────────────────────────────────────────────────
    # alias Module.SubModule  /  import Module  /  use Module  /  require Module
    ({'elixir'}, re.compile(
        r'^[ \t]*(?:alias|import|use|require)\s+([\w.]+)',
        re.MULTILINE)),

    # ── Erlang ────────────────────────────────────────────────────────────────
    # -include("file.hrl").  /  -include_lib("app/include/file.hrl").
    # -behaviour(gen_server).
    ({'erlang'}, re.compile(
        r'''^-(?:include|include_lib)\s*\(\s*"([^"]+)"\s*\)''',
        re.MULTILINE)),
    ({'erlang'}, re.compile(
        r'''^-(?:behaviour|behavior)\s*\(\s*(\w+)\s*\)''',
        re.MULTILINE)),

    # ── Haskell ───────────────────────────────────────────────────────────────
    # import Module  /  import qualified Module as M
    ({'haskell'}, re.compile(
        r'^import\s+(?:qualified\s+)?([\w.]+)',
        re.MULTILINE)),

    # ── OCaml ─────────────────────────────────────────────────────────────────
    # open Module  /  include Module
    ({'ocaml'}, re.compile(
        r'^[ \t]*(?:open|include)\s+([A-Z]\w*(?:\.\w+)*)',
        re.MULTILINE)),

    # ── Elm ───────────────────────────────────────────────────────────────────
    # import Module exposing (..)
    ({'elm'}, re.compile(
        r'^import\s+([\w.]+)',
        re.MULTILINE)),

    # ── Clojure ───────────────────────────────────────────────────────────────
    # (ns my.ns (:require [other.ns :as o]))
    # (require '[other.ns])
    ({'clojure'}, re.compile(
        r'''\(\s*(?:ns|require|use)\s+['\[:]?\s*([\w.\-]+)''',
        re.MULTILINE)),

    # ── R ─────────────────────────────────────────────────────────────────────
    # library(ggplot2)  /  require(dplyr)  /  source("file.R")
    ({'r'}, re.compile(
        r'''(?:library|require)\s*\(\s*['"]?(\w+)['"]?\s*\)''',
        re.MULTILINE)),
    ({'r'}, re.compile(
        r'''source\s*\(\s*['"]([^'"]+)['"]\s*\)''',
        re.MULTILINE)),

    # ── Julia ─────────────────────────────────────────────────────────────────
    # using Pkg  /  import Pkg  /  using Pkg: func1, func2
    # include("file.jl")
    ({'julia'}, re.compile(
        r'^[ \t]*(?:using|import)\s+([\w.]+)',
        re.MULTILINE)),
    ({'julia'}, re.compile(
        r'''include\s*\(\s*"([^"]+)"\s*\)''',
        re.MULTILINE)),

    # ── Nim ───────────────────────────────────────────────────────────────────
    # import module  /  from module import func  /  include module
    ({'nim'}, re.compile(
        r'^[ \t]*(?:import|from|include)\s+([\w/]+)',
        re.MULTILINE)),

    # ── D ─────────────────────────────────────────────────────────────────────
    # import std.stdio;  /  import my.module : func;
    ({'d'}, re.compile(
        r'^[ \t]*import\s+([\w.]+)',
        re.MULTILINE)),

    # ── Zig ───────────────────────────────────────────────────────────────────
    # const std = @import("std");
    ({'zig'}, re.compile(
        r'''@import\s*\(\s*"([^"]+)"\s*\)''',
        re.MULTILINE)),

    # ── Shell ─────────────────────────────────────────────────────────────────
    # source ./file.sh  /  . ./file.sh
    ({'shell'}, re.compile(
        r'^[ \t]*(?:source|\.)\s+["\']?([^\s"\'#]+)["\']?',
        re.MULTILINE)),

    # ── SQL ───────────────────────────────────────────────────────────────────
    # \i file.sql  (psql)  /  .read file.sql  (sqlite)
    # @file.sql  (Oracle SQL*Plus)
    ({'sql'}, re.compile(
        r'''(?:^\\i\s+|^\.read\s+|^@)['"]?([^\s'"]+)['"]?''',
        re.MULTILINE)),

    # ── GraphQL ───────────────────────────────────────────────────────────────
    # #import "./fragment.graphql"  (Apollo convention)
    ({'graphql'}, re.compile(
        r'''#import\s+["']([^"']+)["']''',
        re.MULTILINE)),

    # ── Protobuf ──────────────────────────────────────────────────────────────
    # import "other.proto";  /  import public "other.proto";
    ({'protobuf'}, re.compile(
        r'''import\s+(?:public\s+)?["']([^"']+)["']''',
        re.MULTILINE)),

    # ── CSS / SCSS / SASS / LESS / Stylus ────────────────────────────────────
    # CSS:    @import "other.css";  /  @import url("other.css");
    # SCSS:   @use "module";  /  @forward "module";  /  @import "partial";
    # LESS:   @import "mixin";
    # Stylus: @import "file"  /  @require "file"
    ({'css', 'scss', 'sass', 'less', 'stylus'}, re.compile(
        r'''@(?:import|use|forward|require)\s+(?:url\s*\(\s*)?['"]([^'"]+)['"]''',
        re.MULTILINE)),

    # ── Universal fallback (applied to unknown languages) ─────────────────────
    # from X import  /  import X
    (None, re.compile(
        r'^[ \t]*(?:from\s+([\w./]+)\s+import|import\s+([\w./,\s]+))',
        re.MULTILINE)),
    # use / using (C# already handled above, this catches remaining)
    (None, re.compile(
        r'^[ \t]*(?:use|using)\s+([\w:\\.]+)',
        re.MULTILINE)),
    # require('module')  /  require "module"
    (None, re.compile(
        r'''require\s*\(?\s*['"]([^'"]+)['"]\s*\)?''',
        re.MULTILINE)),
    # #include / #import (C-family already handled by bios_parser, catch rest)
    (None, re.compile(
        r'^[ \t]*#\s*(?:import|include)\s+["<]([^">]+)[">]',
        re.MULTILINE)),
]


# Match file extensions: dot + 1-6 word chars at end, but only for
# actual extensions (not namespace segments like .asList or .io).
# We only trigger on known source/include file extensions to avoid
# false positives from dotted namespaces like java.util.Arrays.asList.
_KNOWN_FILE_EXTS = re.compile(
    r'\.(rb|py|sh|bash|zsh|jl|r|lua|dart|hrl|erl|ex|exs|ts|js|jsx|tsx'
    r'|php|pl|pm|cr|nim|zig|sql|proto|graphql|gql|elm|hs|ml|mli'
    r'|java|kt|kts|scala|groovy|cs|vb|fs|fsx|swift|m|mm|d|go|rs'
    r'|css|scss|sass|less|styl)$',
    re.IGNORECASE
)


def _extract_imports(src: str, lang: str = 'unknown') -> list:
    """Extract import references, returning a list of name/path strings.

    For namespaced imports (e.g. ``com.example.MyClass``,
    ``App\\Controllers\\UserController``, ``crate::module::Item``),
    the last meaningful segment is returned because ``resolve_ref``
    in analyze_viz.py matches by stem (filename without extension).

    For file-path imports (e.g. ``records.hrl``, ``helpers/auth.rb``),
    the file stem (without extension) is returned so it matches the
    stem-based lookup in ``resolve_ref``.
    """
    seen = set()
    results = []

    for lang_set, pat in _LANG_IMPORT_PATTERNS:
        # Skip patterns that don't apply to this language
        if lang_set is not None and lang not in lang_set:
            continue
        # Universal fallback patterns (lang_set=None) only fire when no
        # language-specific patterns matched anything yet, OR always fire
        # for 'unknown' language.
        if lang_set is None and lang != 'unknown' and results:
            continue
        try:
            for m in pat.finditer(src):
                groups = m.groups()
                # Detect Java-style `import static` marker: when group 0
                # is the 'static' keyword, group 1 holds the dotted path
                # and the last segment is a method/field, not a class —
                # so use the second-to-last segment instead.
                is_static_import = (
                    len(groups) >= 2
                    and groups[0] is not None
                    and groups[0].strip().lower() == 'static'
                )
                raw = next((g for g in groups if g and g.strip().lower() != 'static'), None)
                if not raw:
                    continue
                for part in raw.split(','):
                    part = part.strip()
                    if not part:
                        continue
                    # Take first token (ignore `as Alias`, `qw(...)`, etc.)
                    part = part.split()[0]
                    # If it looks like a file path (has a file extension
                    # like .hrl, .rb, .dart), extract the stem of the
                    # basename so it matches resolve_ref's stem lookup.
                    if _KNOWN_FILE_EXTS.search(part):
                        from pathlib import PurePosixPath
                        ref = PurePosixPath(part.replace('\\', '/')).stem
                    else:
                        # Split by namespace/path separators: . / \ ::
                        segs = [s.strip() for s in re.split(r'[:./\\]+', part)
                                if s.strip() and s.strip() != '*']
                        if not segs:
                            continue
                        # For static imports (Java): last segment = method/field,
                        # second-to-last = class name (what maps to a file).
                        if is_static_import and len(segs) >= 2:
                            ref = segs[-2]
                        else:
                            ref = segs[-1]
                    if ref and len(ref) >= 2 and ref not in seen:
                        seen.add(ref)
                        results.append(ref)
        except Exception:
            continue
    return results


# ─── Function / class definition extraction ───────────────────────────────────

_FUNCDEF_PATTERNS = [
    # def name  — Python, Ruby, Crystal, Elixir
    (re.compile(
        r'^[ \t]*(?:pub[ \t]+)?(?:async[ \t]+)?def[ \t]+([A-Za-z_]\w*)\s*(?:[(\|]|$)',
        re.MULTILINE), 1, False, None),
    # defp name  — Elixir private function
    (re.compile(
        r'^[ \t]*defp[ \t]+([A-Za-z_]\w*)\s*[(\|]',
        re.MULTILINE), 1, False, None),
    # defmacro / defmacrop — Elixir macros
    (re.compile(
        r'^[ \t]*defmacro(?:p)?[ \t]+([A-Za-z_]\w*)\s*[(\|]',
        re.MULTILINE), 1, False, None),
    # fn / pub fn / const fn / async fn / unsafe fn / extern "C" fn — Rust, Zig
    (re.compile(
        r'^[ \t]*(?:pub(?:\([^)]*\))?\s+)?'
        r'(?:(?:const|async|unsafe|default|extern\s*(?:"[^"]*")?)\s+)*'
        r'fn\s+([A-Za-z_]\w*)\s*[(<]',
        re.MULTILINE), 1, False, None),
    # func name(  — Go, Swift (with optional receiver for Go methods)
    (re.compile(
        r'^[ \t]*(?:(?:public|private|internal|open|fileprivate|override|static|'
        r'final|inline|mutating|@\w+)\s+)*'
        r'func[ \t]+([A-Za-z_]\w*)\s*[(<]',
        re.MULTILINE), 1, False, None),
    # fun name( — Kotlin
    (re.compile(
        r'^[ \t]*(?:(?:public|private|protected|internal|open|override|suspend|inline|'
        r'infix|tailrec|operator|abstract|static|final|actual|expect)\s+)*'
        r'fun\s+(?:[\w.<>]+\.\s*)?([A-Za-z_]\w*)\s*[(<]',
        re.MULTILINE), 1, False, None),
    # function name(  — PHP, Lua, JS (generic)
    (re.compile(
        r'^[ \t]*(?:(?:public|private|protected|static|async|abstract|final)\s+)*'
        r'function[ \t]+([A-Za-z_]\w*)\s*\(',
        re.MULTILINE), 1, False, None),
    # sub name  — Perl
    (re.compile(
        r'^[ \t]*sub\s+([A-Za-z_]\w*)\s*(?:\([^)]*\))?\s*\{',
        re.MULTILINE), 1, False, None),
    # Sub / Function — VB.NET
    (re.compile(
        r'^[ \t]*(?:(?:Public|Private|Protected|Friend|Shared|Overrides|'
        r'Overridable|MustOverride|Static)\s+)*'
        r'(?:Sub|Function)[ \t]+([A-Za-z_]\w*)\s*\(',
        re.MULTILINE), 1, False, None),
    # Haskell: name :: Type → only at start of line, lowercase, must not be a keyword
    (re.compile(
        r'^([a-z_]\w*)[ \t]*::[ \t]*(?:[A-Z([\[])',
        re.MULTILINE), 1, False, None),
    # OCaml: let name ...  / let rec name
    (re.compile(
        r'^[ \t]*let\s+(?:rec\s+)?([a-z_]\w*)\s+(?:[a-z_]\w+|\()',
        re.MULTILINE), 1, False, None),
    # Erlang: name(Args) ->
    (re.compile(
        r'^([a-z_]\w*)\s*\([^)]*\)\s*->', re.MULTILINE), 1, False, None),
    # Clojure: (defn name ...) / (defn- name ...)
    (re.compile(
        r'\(\s*defn-?\s+([\w\-!?*+<>=]+)',
        re.MULTILINE), 1, False, None),
    # Nim: proc / method / template / macro / iterator / converter
    (re.compile(
        r'^[ \t]*(?:proc|method|template|macro|iterator|converter|func)\s*'
        r'([A-Za-z_]\w*)\s*[\*]?\s*[\[(]',
        re.MULTILINE), 1, False, None),
    # Julia: function name(  /  name(args) = expr
    (re.compile(
        r'^[ \t]*function\s+([A-Za-z_]\w*)\s*[({(]',
        re.MULTILINE), 1, False, None),
    (re.compile(
        r'^[ \t]*([A-Za-z_]\w*)\s*\([^)]*\)\s*=\s*\S',
        re.MULTILINE), 1, False, None),
    # D: RetType name( — with D-specific modifiers
    (re.compile(
        r'^[ \t]*(?:(?:public|private|protected|package|static|final|abstract|override|'
        r'nothrow|pure|@\w+)\s+)*'
        r'(?:[\w!]+\s+)+([A-Za-z_]\w*)\s*\(',
        re.MULTILINE), 1, False, None),
    # SQL: CREATE FUNCTION / CREATE PROCEDURE / CREATE OR REPLACE FUNCTION
    (re.compile(
        r'CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)\s+(?:[\w.]+\.)?([A-Za-z_]\w*)',
        re.MULTILINE | re.IGNORECASE), 1, False, None),
    # C-family: [modifiers] ReturnType name(  — Java, C#, Dart, Scala
    (re.compile(
        r'^[ \t]*(?:(?:public|private|protected|internal|static|final|abstract|override'
        r'|async|virtual|extern|sealed|unsafe|synchronized|native|strictfp|inline|'
        r'constexpr|explicit|implicit|operator)\s+)+'
        r'(?:[\w<>\[\].,?*&]+\s+)+'
        r'([A-Za-z_]\w*)\s*\(',
        re.MULTILINE), 1, False, None),
    # Constructor-style: access_mod ClassName( for Java/Kotlin/C#/Dart
    # Requires PascalCase AND opening brace nearby to reduce false positives
    (re.compile(
        r'^[ \t]*(?:(?:public|private|protected|internal)\s+)([A-Z][A-Za-z0-9]*)\s*\([^)]*\)\s*(?::[\s\w(),]+)?\s*\{',
        re.MULTILINE), 1, False, None),
    # Fallback: ReturnType name( ... ) {
    (re.compile(
        r'^[ \t]*[\w<>\[\]]+\s+([A-Za-z_]\w*)\s*\(\s*(?:[\w<>@,. \t\[\]*&?]*)?\s*\)\s*(?:throws\s+[\w, ]+\s*)?\{',
        re.MULTILINE), 1, False, None),
    # Shell: name() {
    (re.compile(
        r'^[ \t]*([A-Za-z_]\w*)\s*\(\s*\)\s*\{', re.MULTILINE), 1, False, None),
]

_CLASSDEF_PATTERNS = [
    # class / struct / interface / trait / protocol / enum / record / object
    re.compile(
        r'^[ \t]*(?:(?:public|private|protected|internal|abstract|final|sealed|open|data|'
        r'value|inline|case|implicit|pub|pub\([^)]*\)|unsafe|extern)\s+)*'
        r'(class|struct|interface|trait|protocol|enum|record|object)\s+([A-Za-z_]\w*)',
        re.MULTILINE),
    # Rust: impl X or impl<T> X  /  impl Trait for X
    re.compile(r'^[ \t]*impl(?:<[^>]+>)?\s+(?:\w+\s+for\s+)?([\w:]+)', re.MULTILINE),
    # Rust: trait X  /  trait X: SuperTrait
    re.compile(r'^[ \t]*(?:pub(?:\([^)]*\))?\s+)?(?:unsafe\s+)?trait\s+(\w+)', re.MULTILINE),
    # Elixir: defmodule X  /  Erlang: -module(name).
    re.compile(r'^[ \t]*defmodule\s+([\w.]+)', re.MULTILINE),
    re.compile(r'^-module\s*\(\s*(\w+)\s*\)', re.MULTILINE),
    # Haskell: data X / newtype X / class X where
    re.compile(r'^[ \t]*(?:data|newtype)\s+([A-Z]\w*)', re.MULTILINE),
    re.compile(r'^[ \t]*class\s+(?:\([^)]*\)\s*=>)?\s*([A-Z]\w*)', re.MULTILINE),
    # type X — Go, Rust, Haskell, Swift, Nim
    re.compile(r'^[ \t]*(?:pub\s+)?type\s+([A-Z]\w*)', re.MULTILINE),
    # Kotlin / Scala object
    re.compile(r'^[ \t]*(?:companion\s+)?object\s+([A-Za-z_]\w*)', re.MULTILINE),
    # GraphQL: type / input / union / scalar / extend type
    re.compile(r'^(?:type|input|union|scalar|extend\s+type)\s+([A-Za-z_]\w*)', re.MULTILINE),
    # Proto: message / service / enum
    re.compile(r'^(?:message|service)\s+([A-Za-z_]\w*)', re.MULTILINE),
    # Java/C# record
    re.compile(
        r'^[ \t]*(?:(?:public|private|protected|internal)\s+)?record\s+([A-Za-z_]\w*)',
        re.MULTILINE),
    # Nim: type section entries (Name = object/ref/enum/distinct)
    re.compile(r'^[ \t]+([A-Z]\w*)\s*\*?\s*=\s*(?:object|ref|enum|distinct|concept)',
        re.MULTILINE),
    # Clojure: (defrecord Name ...) / (defprotocol Name ...) / (deftype Name ...)
    re.compile(r'\(\s*(?:defrecord|defprotocol|deftype|definterface)\s+([\w\-]+)', re.MULTILINE),
    # Julia: struct / mutable struct / abstract type
    re.compile(r'^[ \t]*(?:mutable\s+)?struct\s+([A-Za-z_]\w*)', re.MULTILINE),
    re.compile(r'^[ \t]*abstract\s+type\s+([A-Za-z_]\w*)', re.MULTILINE),
    # SQL: CREATE TABLE / CREATE VIEW / CREATE TYPE
    re.compile(
        r'CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|TYPE|MATERIALIZED\s+VIEW)'
        r'\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[\w.]+\.)?([A-Za-z_]\w*)',
        re.MULTILINE | re.IGNORECASE),
    # D: class / struct / interface / enum
    re.compile(
        r'^[ \t]*(?:(?:public|private|protected|package)\s+)?'
        r'(?:class|struct|interface|enum)\s+([A-Za-z_]\w*)',
        re.MULTILINE),
]

# C# property filter: avoid matching "public int Foo { get; set; }" as a function
_RE_CSHARP_PROPERTY = re.compile(
    r'^[ \t]*(?:(?:public|private|protected|internal|static|virtual|override|abstract|sealed)\s+)+'
    r'[\w<>\[\].,?]+\s+(\w+)\s*\{\s*(?:get|set)',
    re.MULTILINE
)

# Java/Kotlin annotation filter: @Override, @Bean, etc.
_RE_ANNOTATION = re.compile(r'^[ \t]*@\w+', re.MULTILINE)


def _extract_funcdefs(clean: str, lang: str) -> list:
    """Return list of {label, is_efiapi, is_static} for all found definitions."""
    seen = set()
    results = []

    # Collect C# properties to exclude from function detection
    csharp_props = set()
    if lang == 'csharp':
        for m in _RE_CSHARP_PROPERTY.finditer(clean):
            csharp_props.add(m.group(1))

    # Class / type definitions first
    for pat in _CLASSDEF_PATTERNS:
        try:
            for m in pat.finditer(clean):
                name = m.group(m.lastindex)
                if not name or name in _SKIP_NAMES or len(name) < 2:
                    continue
                if name not in seen:
                    seen.add(name)
                    results.append({'label': name, 'is_efiapi': False, 'is_static': True})
        except Exception:
            continue

    # Function / method definitions
    for pat, grp, _is_cls, _mod in _FUNCDEF_PATTERNS:
        try:
            for m in pat.finditer(clean):
                name = m.group(grp)
                if not name or name in _SKIP_NAMES or len(name) < 2:
                    continue
                if name.lower() in _SKIP_NAMES:
                    continue
                if name in csharp_props:
                    continue
                if name not in seen:
                    seen.add(name)
                    results.append({'label': name, 'is_efiapi': False, 'is_static': False})
        except Exception:
            continue

    return results


# ─── Kind keyword detection (word-boundary safe) ────────────────────────────

_KIND_KEYWORD_MAP = [
    # Order matters: more specific keywords first
    (re.compile(r'\bdefinterface\b', re.I), 'interface'),
    (re.compile(r'\bdefprotocol\b', re.I), 'trait'),
    (re.compile(r'\bdefrecord\b', re.I), 'record'),
    (re.compile(r'\bdefmodule\b', re.I), 'module'),
    (re.compile(r'\bdeftype\b', re.I), 'type'),
    (re.compile(r'-module\b'), 'module'),
    (re.compile(r'\bmutable\s+struct\b', re.I), 'struct'),
    (re.compile(r'\babstract\s+type\b', re.I), 'abstract'),
    (re.compile(r'\bstruct\b', re.I), 'struct'),
    (re.compile(r'\binterface\b', re.I), 'interface'),
    (re.compile(r'\btrait\b', re.I), 'trait'),
    (re.compile(r'\bprotocol\b', re.I), 'trait'),
    (re.compile(r'\benum\b', re.I), 'enum'),
    (re.compile(r'\bimpl\b'), 'impl'),
    (re.compile(r'\brecord\b', re.I), 'record'),
    (re.compile(r'\bobject\b', re.I), 'object'),
    (re.compile(r'\bnewtype\b'), 'type'),
    (re.compile(r'\bdata\b'), 'type'),
    (re.compile(r'\bmessage\b'), 'message'),
    (re.compile(r'\bservice\b'), 'service'),
    (re.compile(r'\btable\b', re.I), 'table'),
    (re.compile(r'\bview\b', re.I), 'view'),
    (re.compile(r'\bclass\b', re.I), 'class'),
]


def _detect_kind_keyword(full_match: str) -> str:
    """Detect the kind of a class/type definition from its match text."""
    for pat, kind in _KIND_KEYWORD_MAP:
        if pat.search(full_match):
            return kind
    return 'class'


# ─── Symbol definition extraction ────────────────────────────────────────────

def _extract_symbol_defs(clean: str, src: str, lang: str, doc_map: dict) -> list:
    """Build structured symbol list from class/function definitions."""
    symbols = []
    seen = set()

    # ── Classes / types ──────────────────────────────────────────────────────
    for pat in _CLASSDEF_PATTERNS:
        try:
            for m in pat.finditer(clean):
                name = m.group(m.lastindex)
                if not name or name in _SKIP_NAMES or len(name) < 2 or name in seen:
                    continue
                seen.add(name)
                line_no = src[:m.start()].count('\n') + 1
                # Determine kind from keyword in the match text.
                # Use word-boundary search to avoid "service" matching
                # inside "UserService", etc.
                kind = 'class'
                full = m.group(0).strip()
                kw = _detect_kind_keyword(full)
                if kw:
                    kind = kw
                # Compute end_line via brace matching
                open_idx = clean.find('{', m.end())
                end_line = line_no
                if open_idx != -1:
                    end_line = _brace_end_line(clean, open_idx, line_no)
                # Extract bases (from extends/implements/: in the match context)
                bases = _extract_bases_from_context(clean, m.end())
                symbols.append({
                    'kind': kind, 'name': name,
                    'line': line_no, 'end_line': end_line,
                    'bases': bases, 'parent': None,
                    'is_public': not name.startswith('_') and name[0:1].isupper(),
                    'doc': doc_map.get(line_no, None),
                })
        except Exception:
            continue

    # ── Functions ────────────────────────────────────────────────────────────
    for pat, grp, _is_cls, _mod in _FUNCDEF_PATTERNS:
        try:
            for m in pat.finditer(clean):
                name = m.group(grp)
                if not name or name in _SKIP_NAMES or len(name) < 2 or name in seen:
                    continue
                if name.lower() in _SKIP_NAMES:
                    continue
                seen.add(name)
                line_no = src[:m.start()].count('\n') + 1
                open_idx = clean.find('{', m.end())
                end_line = _brace_end_line(clean, open_idx, line_no) if open_idx != -1 else line_no
                symbols.append({
                    'kind': 'function', 'name': name,
                    'line': line_no, 'end_line': end_line,
                    'bases': [], 'parent': None,
                    'is_public': not name.startswith('_') and name[0:1].isupper(),
                    'doc': doc_map.get(line_no, None),
                })
        except Exception:
            continue

    return symbols


def _extract_bases_from_context(clean: str, pos: int) -> list:
    """Try to extract base classes from extends/implements/: after pos."""
    # Look at next ~80 chars for extends/implements patterns
    snippet = clean[pos:pos + 80]
    bases = []
    m = re.match(r'\s*(?:extends|:)\s+([\w,.]+)', snippet)
    if m:
        for b in m.group(1).split(','):
            b = b.strip()
            if b and b not in _SKIP_NAMES:
                bases.append(b)
    m2 = re.search(r'implements\s+([\w,.]+)', snippet)
    if m2:
        for b in m2.group(1).split(','):
            b = b.strip()
            if b and b not in _SKIP_NAMES:
                bases.append(b)
    return bases


def _brace_end_line(clean: str, open_idx: int, base_line: int) -> int:
    """Return the end line (1-based) of the brace block."""
    depth = 0
    for i in range(open_idx, len(clean)):
        c = clean[i]
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
            if depth == 0:
                return base_line + clean[open_idx:i + 1].count('\n')
    return base_line


# ─── Function call extraction ─────────────────────────────────────────────────

_RE_CALL = re.compile(r'\b([A-Za-z_]\w*)\s*\(')


def _extract_calls(masked: str) -> list:
    calls = []
    seen = set()
    try:
        for m in _RE_CALL.finditer(masked):
            name = m.group(1)
            if name in _SKIP_NAMES or len(name) < 2:
                continue
            if name not in seen:
                seen.add(name)
                calls.append(name)
    except Exception:
        pass
    return calls


# ─── Per-function call tracking ───────────────────────────────────────────────

def _build_func_calls_by_func(clean: str, funcdefs: list) -> list:
    if not funcdefs:
        return []
    try:
        result = _brace_based_calls(clean, funcdefs)
        if result is not None:
            return result
    except Exception:
        pass
    return [[] for _ in funcdefs]


def _brace_based_calls(clean: str, funcdefs: list) -> list:
    brace_count = clean.count('{') + clean.count('}')
    if brace_count < len(funcdefs):
        return None

    func_calls_by_func = [[] for _ in funcdefs]

    for idx, fd in enumerate(funcdefs):
        name = fd['label']
        pat = re.compile(r'\b' + re.escape(name) + r'\s*[\(<]')
        m = pat.search(clean)
        if not m:
            continue
        start = m.start()
        brace_pos = clean.find('{', start)
        if brace_pos == -1:
            continue
        depth = 0
        body_start = brace_pos + 1
        body_end = body_start
        for i in range(brace_pos, len(clean)):
            ch = clean[i]
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    body_end = i
                    break
        body = clean[body_start:body_end]
        calls = set()
        for cm in _RE_CALL.finditer(body):
            cname = cm.group(1)
            if cname not in _SKIP_NAMES and len(cname) >= 2:
                calls.add(cname)
        func_calls_by_func[idx] = list(calls)

    return func_calls_by_func


# ─── Main entry point ─────────────────────────────────────────────────────────

def scan_common(src: str, ext: str = '') -> tuple:
    """
    Generic parser entry point. Returns standard VIZCODE 6-tuple:
      (imports, funcdefs, funccalls, extra_dict, func_calls_by_func, symbol_defs)
    """
    try:
        lang = _EXT_TO_LANG.get(ext, 'unknown')
        clean = _strip_comments(src, lang)
        masked = _mask_strings(clean)
        doc_map = _extract_doc_map(src, lang)

        imports            = _extract_imports(src, lang)
        funcdefs           = _extract_funcdefs(masked, lang)
        funccalls          = _extract_calls(masked)
        func_calls_by_func = _build_func_calls_by_func(masked, funcdefs)
        symbol_defs        = _extract_symbol_defs(masked, src, lang, doc_map)

        extra = {'lang': lang}
        # Collect docstrings
        docstrings = {}
        for sym in symbol_defs:
            if sym.get('doc'):
                docstrings[sym['name']] = sym['doc']
        if docstrings:
            extra['docstrings'] = docstrings

        return imports, funcdefs, funccalls, extra, func_calls_by_func, symbol_defs
    except Exception:
        return [], [], [], None, [], []
