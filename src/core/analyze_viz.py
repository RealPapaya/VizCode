#!/usr/bin/env python3
"""
analyze_viz.py V4 — VIZCODE Universal Code Visualizer
Supports: C/C++ (C/H/CPP/HPP), UEFI/BIOS (ASM/INF/DEC/DSC/FDF/SDL/CIF/MAK/VFR/HFR/UNI/ASL)
          Python (.py)
          JavaScript / TypeScript (.js/.mjs/.cjs/.jsx/.ts/.tsx)
          Go (.go)

Pluggable Parser architecture: each language has its own parser in parsers/
Project type is auto-detected and displayed during analysis.

Backward compatible: still importable as analyze_bios (server.py alias).
"""

import os, re, json, sys, argparse, datetime, subprocess
import concurrent.futures
from pathlib import Path
from collections import defaultdict, Counter
from typing import Dict, Optional

def _console_safe(text, stream=None):
    stream = stream or sys.stdout
    enc = getattr(stream, "encoding", None) or "utf-8"
    try:
        return str(text).encode(enc, errors="replace").decode(enc, errors="replace")
    except Exception:
        return str(text)


def _console_print(*args, **kwargs):
    stream = kwargs.pop("file", sys.stdout)
    sep = kwargs.pop("sep", " ")
    end = kwargs.pop("end", "\n")
    flush = kwargs.pop("flush", False)
    text = sep.join(str(arg) for arg in args)
    stream.write(_console_safe(text, stream))
    stream.write(_console_safe(end, stream))
    if flush:
        stream.flush()
# ─── Pluggable parsers ────────────────────────────────────────────────────────
# Layout:  <root>/src/core/analyze_viz.py
#          <root>/src/parsers/            ← language parsers
#          <root>/src/core/detector.py    ← sibling
#          <root>/src/core/parse_memo.py  ← sibling
_CORE_DIR   = Path(__file__).parent                 # .../VizCode/src/core
_SRC_DIR    = _CORE_DIR.parent                      # .../VizCode/src
_ROOT_DIR   = _SRC_DIR.parent                       # .../VizCode
_PARSER_DIR = _SRC_DIR / 'parsers'                  # .../VizCode/src/parsers
# • _SRC_DIR in sys.path  → enables `from parsers.xxx import`
# • _CORE_DIR in sys.path → enables `from detector import`, `import parse_memo`
for _p in (str(_SRC_DIR), str(_CORE_DIR)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

try:
    from parsers.uefi_parser   import scan_uefi, UEFI_EXTENSIONS as _UEFI_EXTENSIONS
    from parsers.acpi_parser   import scan_acpi, ACPI_EXTENSIONS as _ACPI_EXTENSIONS
    from parsers.asm_parser    import scan_asm,  ASM_EXTENSIONS  as _ASM_EXTENSIONS
    from parsers.c_cpp_parser  import scan_c_cpp, C_CPP_EXTENSIONS as _C_CPP_EXTENSIONS
    from parsers.csharp_parser import scan_csharp, CSHARP_EXTENSIONS as _CSHARP_EXTENSIONS
    from parsers.python_parser import scan_python
    from parsers.js_parser     import scan_js, scan_ts, JS_KEYWORDS as _JS_KEYWORDS
    from parsers.go_parser     import scan_go
    from parsers.java_parser   import scan_java, JAVA_EXTENSIONS as _JAVA_EXTENSIONS
    from parsers.rust_parser   import scan_rust, RUST_EXTENSIONS as _RUST_EXTENSIONS
    from parsers.kotlin_parser import scan_kotlin, KOTLIN_EXTENSIONS as _KOTLIN_EXTENSIONS
    from parsers.scala_parser  import scan_scala, SCALA_EXTENSIONS as _SCALA_EXTENSIONS
    from parsers.groovy_parser import scan_groovy, GROOVY_EXTENSIONS as _GROOVY_EXTENSIONS
    from parsers.dart_parser   import scan_dart, DART_EXTENSIONS as _DART_EXTENSIONS
    from parsers.swift_parser  import scan_swift, SWIFT_EXTENSIONS as _SWIFT_EXTENSIONS
    from parsers.objc_parser   import scan_objc, OBJC_EXTENSIONS as _OBJC_EXTENSIONS
    from parsers.php_parser    import scan_php, PHP_EXTENSIONS as _PHP_EXTENSIONS
    from parsers.perl_parser   import scan_perl, PERL_EXTENSIONS as _PERL_EXTENSIONS
    from parsers.lua_parser    import scan_lua, LUA_EXTENSIONS as _LUA_EXTENSIONS
    from parsers.shell_parser  import scan_shell, SHELL_EXTENSIONS as _SHELL_EXTENSIONS
    from parsers.r_parser       import scan_r, R_EXTENSIONS as _R_EXTENSIONS
    from parsers.protobuf_parser import scan_protobuf, PROTOBUF_EXTENSIONS as _PROTOBUF_EXTENSIONS
    from parsers.graphql_parser import scan_graphql, GRAPHQL_EXTENSIONS as _GRAPHQL_EXTENSIONS
    from parsers.zig_parser     import scan_zig, ZIG_EXTENSIONS as _ZIG_EXTENSIONS
    from parsers.d_parser       import scan_d, D_EXTENSIONS as _D_EXTENSIONS
    from parsers.sql_parser     import scan_sql, SQL_EXTENSIONS as _SQL_EXTENSIONS
    from parsers.css_parser      import scan_css, CSS_EXTENSIONS as _CSS_EXTENSIONS
    from parsers.ruby_parser     import scan_ruby, RUBY_EXTENSIONS as _RUBY_EXTENSIONS
    from parsers.crystal_parser  import scan_crystal, CRYSTAL_EXTENSIONS as _CRYSTAL_EXTENSIONS
    from parsers.julia_parser    import scan_julia, JULIA_EXTENSIONS as _JULIA_EXTENSIONS
    from parsers.elixir_parser   import scan_elixir, ELIXIR_EXTENSIONS as _ELIXIR_EXTENSIONS
    from parsers.vbnet_parser    import scan_vbnet, VBNET_EXTENSIONS as _VBNET_EXTENSIONS
    from parsers.clojure_parser  import scan_clojure, CLOJURE_EXTENSIONS as _CLOJURE_EXTENSIONS
    from parsers.erlang_parser   import scan_erlang, ERLANG_EXTENSIONS as _ERLANG_EXTENSIONS
    from parsers.fsharp_parser   import scan_fsharp, FSHARP_EXTENSIONS as _FSHARP_EXTENSIONS
    from parsers.ocaml_parser    import scan_ocaml, OCAML_EXTENSIONS as _OCAML_EXTENSIONS
    from parsers.nim_parser      import scan_nim, NIM_EXTENSIONS as _NIM_EXTENSIONS
    from parsers.haskell_parser  import scan_haskell, HASKELL_EXTENSIONS as _HASKELL_EXTENSIONS
    from parsers.elm_parser      import scan_elm, ELM_EXTENSIONS as _ELM_EXTENSIONS
    from parsers.html_parser     import scan_html, HTML_EXTENSIONS as _HTML_EXTENSIONS
    from parsers.yaml_parser     import scan_yaml, YAML_EXTENSIONS as _YAML_EXTENSIONS
    from parsers.md_parser       import scan_markdown, MARKDOWN_EXTENSIONS as _MARKDOWN_EXTENSIONS
    from parsers.powershell_parser import scan_powershell, POWERSHELL_EXTENSIONS as _POWERSHELL_EXTENSIONS
    from parsers.toml_parser     import scan_toml, TOML_EXTENSIONS as _TOML_EXTENSIONS
    from parsers.json_parser   import scan_json
    from parsers.common_parser import scan_common, count_loc
    from detector              import detect_project_type, fmt_detection_banner
    _PARSERS_LOADED = True
except ImportError as _pe:
    _PARSERS_LOADED = False
    _UEFI_EXTENSIONS = set()
    _ACPI_EXTENSIONS = set()
    _ASM_EXTENSIONS = set()
    _C_CPP_EXTENSIONS = set()
    _CSHARP_EXTENSIONS = set()
    _JAVA_EXTENSIONS = set()
    _RUST_EXTENSIONS = set()
    _KOTLIN_EXTENSIONS = set()
    _SCALA_EXTENSIONS = set()
    _GROOVY_EXTENSIONS = set()
    _DART_EXTENSIONS = set()
    _SWIFT_EXTENSIONS = set()
    _OBJC_EXTENSIONS = set()
    _PHP_EXTENSIONS = set()
    _PERL_EXTENSIONS = set()
    _LUA_EXTENSIONS = set()
    _SHELL_EXTENSIONS = set()
    _R_EXTENSIONS = set()
    _PROTOBUF_EXTENSIONS = set()
    _GRAPHQL_EXTENSIONS = set()
    _ZIG_EXTENSIONS = set()
    _D_EXTENSIONS = set()
    _SQL_EXTENSIONS = set()
    _CSS_EXTENSIONS = set()
    _RUBY_EXTENSIONS = set()
    _CRYSTAL_EXTENSIONS = set()
    _JULIA_EXTENSIONS = set()
    _ELIXIR_EXTENSIONS = set()
    _VBNET_EXTENSIONS = set()
    _CLOJURE_EXTENSIONS = set()
    _ERLANG_EXTENSIONS = set()
    _FSHARP_EXTENSIONS = set()
    _OCAML_EXTENSIONS = set()
    _NIM_EXTENSIONS = set()
    _HASKELL_EXTENSIONS = set()
    _ELM_EXTENSIONS = set()
    _HTML_EXTENSIONS = set()
    _YAML_EXTENSIONS = set()
    _MARKDOWN_EXTENSIONS = set()
    _POWERSHELL_EXTENSIONS = set()
    _TOML_EXTENSIONS = set()
    _console_print(f'[WARN] Could not load language parsers: {_pe}', file=sys.stderr)

import parse_memo
from code_health import compute_code_health
import security_scanner

# ─── Security rules: load + compile once at module import ─────────────────────
# Pure-function module, so the compiled list is safe to share across all
# scan_file() calls during the lifetime of the process.
try:
    _SECURITY_RULES = security_scanner.compile_rules(
        security_scanner.load_rules(_CORE_DIR / 'security_rules')
    )
except Exception as _sec_load_err:
    _SECURITY_RULES = []
    _console_print(f'[WARN] Security rules failed to load: {_sec_load_err}', file=sys.stderr)

# ─── Parser-fingerprint cache (populated lazily in scan_file) ─────────────────
# Maps a parser callable to the SHA-256 of its source file. Built once per
# process; editing a parser source file changes the hash and auto-invalidates
# all cached results for the file types that parser handles.
_parser_fingerprints: dict = {}


def _get_parser_fn(ext: str):
    """Return the parser callable responsible for *ext* (used as part of the
    cache key so that editing a parser auto-invalidates cached entries).
    Returns None when parsers aren't loaded (C-like fallback path)."""
    if not _PARSERS_LOADED:
        return None
    if ext in _C_CPP_EXTENSIONS:
        return scan_c_cpp
    if ext in _UEFI_EXTENSIONS:
        return scan_uefi
    if ext in _ACPI_EXTENSIONS:
        return scan_acpi
    if ext in _ASM_EXTENSIONS:
        return scan_asm
    if ext in _CSHARP_EXTENSIONS:
        return scan_csharp
    if ext == '.py':
        return scan_python
    if ext in ('.js', '.mjs', '.cjs', '.jsx'):
                return scan_js
    if ext in ('.ts', '.tsx'):
        return scan_ts
    if ext == '.go':
        return scan_go
    if ext in _JAVA_EXTENSIONS:
        return scan_java
    if ext in _RUST_EXTENSIONS:
        return scan_rust
    if ext in _KOTLIN_EXTENSIONS:
        return scan_kotlin
    if ext in _SCALA_EXTENSIONS:
        return scan_scala
    if ext in _GROOVY_EXTENSIONS:
        return scan_groovy
    if ext in _DART_EXTENSIONS:
        return scan_dart
    if ext in _SWIFT_EXTENSIONS:
        return scan_swift
    if ext in _OBJC_EXTENSIONS:
        return scan_objc
    if ext in _PHP_EXTENSIONS:
        return scan_php
    if ext in _PERL_EXTENSIONS:
        return scan_perl
    if ext in _LUA_EXTENSIONS:
        return scan_lua
    if ext in _SHELL_EXTENSIONS:
        return scan_shell
    if ext in _R_EXTENSIONS:
        return scan_r
    if ext in _PROTOBUF_EXTENSIONS:
        return scan_protobuf
    if ext in _GRAPHQL_EXTENSIONS:
        return scan_graphql
    if ext in _ZIG_EXTENSIONS:
        return scan_zig
    if ext in _D_EXTENSIONS:
        return scan_d
    if ext in _SQL_EXTENSIONS:
        return scan_sql
    if ext in _CSS_EXTENSIONS:
        return scan_css
    if ext in _RUBY_EXTENSIONS:
        return scan_ruby
    if ext in _CRYSTAL_EXTENSIONS:
        return scan_crystal
    if ext in _JULIA_EXTENSIONS:
        return scan_julia
    if ext in _ELIXIR_EXTENSIONS:
        return scan_elixir
    if ext in _VBNET_EXTENSIONS:
        return scan_vbnet
    if ext in _CLOJURE_EXTENSIONS:
        return scan_clojure
    if ext in _ERLANG_EXTENSIONS:
        return scan_erlang
    if ext in _FSHARP_EXTENSIONS:
        return scan_fsharp
    if ext in _OCAML_EXTENSIONS:
        return scan_ocaml
    if ext in _NIM_EXTENSIONS:
        return scan_nim
    if ext in _HASKELL_EXTENSIONS:
        return scan_haskell
    if ext in _ELM_EXTENSIONS:
        return scan_elm
    if ext in _HTML_EXTENSIONS:
        return scan_html
    if ext in _YAML_EXTENSIONS:
        return scan_yaml
    if ext in _MARKDOWN_EXTENSIONS:
        return scan_markdown
    if ext in _POWERSHELL_EXTENSIONS:
        return scan_powershell
    if ext in _TOML_EXTENSIONS:
        return scan_toml
    if ext == '.json':
        return scan_json
    return scan_common  # generic fallback for all other recognized extensions

# ─── Constants ───────────────────────────────────────────────────────────────
SKIP_DIRS  = {
    # BIOS / build
    'Build', 'build', '.git', '__pycache__', 'Conf', 'DEBUG', 'RELEASE', '.claude',
    # VizCode's own output dirs — never scan generated caches/reports (esp. the
    # report-tree .md files, now that markdown is a scanned ext)
    '.vizcode', '.local',
    # JavaScript / Node
    'node_modules', '.next', '.nuxt', 'dist', 'out', '.output', '.cache',
    'coverage', '.nyc_output', 'storybook-static',
    # Go
    'vendor',
    # Python
    '.venv', 'venv', 'env', '.env', '.tox', '.pytest_cache', '.mypy_cache',
    'site-packages', '__pypackages__',
    # General
    '.idea', '.vscode', '.DS_Store',
}
BUILD_DIRS = {'Build','build','DEBUG','RELEASE'}
SCAN_EXT   = {
    # ── C/C++ / ASM ────────────────────────────────────────────────────────
    '.c','.cpp','.cc','.cxx','.h','.hpp','.hh','.hxx','.asm','.s','.S','.nasm',
    # ── UEFI / EDK2 build system ───────────────────────────────────────────
    '.inf', '.dec', '.dsc', '.fdf',
    # ── Vendor firmware formats handled by common_parser ──────────────────
    '.sdl', '.sd', '.cif', '.mak',
    # ── HII (Human Interface Infrastructure) ───────────────────────────────
    '.vfr',   # UEFI standard HII form language
    '.hfr',   # Extended HII Form Resource
    '.uni',   # Unicode string packages
    # ── ACPI ───────────────────────────────────────────────────────────────
    '.asl',
    # ── Python ─────────────────────────────────────────────────────────────
    '.py',
    # ── JavaScript / TypeScript ─────────────────────────────────────────────
    '.js', '.mjs', '.cjs', '.jsx',
    '.ts', '.tsx',
    # ── Go ─────────────────────────────────────────────────────────────────
    '.go',
    # ── JVM / Mobile ───────────────────────────────────────────────────────
    '.java', '.kt', '.kts', '.scala', '.groovy', '.dart', '.swift', '.m', '.mm',
    # ── .NET ───────────────────────────────────────────────────────────────
    '.cs', '.vb', '.fs', '.fsx',
    # ── Scripting ──────────────────────────────────────────────────────────
    '.rb', '.php', '.pl', '.pm', '.lua',
    '.sh', '.bash', '.zsh',
    '.r', '.R', '.jl',
    # ── Systems ────────────────────────────────────────────────────────────
    '.rs', '.zig', '.d', '.nim', '.cr',
    # ── Functional ─────────────────────────────────────────────────────────
    '.ex', '.exs', '.erl', '.hrl',
        '.clj', '.cljs', '.hs', '.ml', '.mli', '.elm',
    # ── Data / Schema ──────────────────────────────────────────────────────
    '.sql', '.graphql', '.gql', '.proto',
    # ── Web / Styles ───────────────────────────────────────────────────────
    '.css', '.scss', '.sass', '.less', '.styl',
    '.html', '.htm', '.xhtml',
    # ── Config / Data ──────────────────────────────────────────────────────
    '.json', '.yaml', '.yml', '.toml',
    # ── Docs (link/structure extraction only — see md_parser) ──────────────
    '.md', '.markdown', '.mdown', '.mkd', '.rst', '.txt',
    # ── Scripting (Windows) ────────────────────────────────────────────────
    '.ps1', '.psm1', '.psd1',
}
SKIP_EXT   = {'.veb','.lib','.obj','.efi','.rom','.bin','.log','.map'}

# ─── File type semantic categories ───────────────────────────────────────────
FILE_TYPE_MAP = {
    # C / C++ and BIOS assets
    '.c': 'c_source', '.cpp': 'c_source', '.cc': 'c_source', '.cxx': 'c_source',
    '.h': 'header',   '.hpp': 'header', '.hh': 'header', '.hxx': 'header',
    '.asm': 'assembly', '.s': 'assembly', '.S': 'assembly', '.nasm': 'assembly',
    '.inf': 'module_inf',
    '.dec': 'package_dec',
    '.dsc': 'platform_dsc',
    '.fdf': 'flash_desc',
    '.sdl': 'common_file',
    '.sd':  'common_file',
    '.cif': 'common_file',
    '.mak': 'common_file',
    '.vfr': 'hii_vfr',
    '.hfr': 'common_file',
    '.uni': 'hii_string',
    '.asl': 'acpi_asl',
    # Python
    '.py':  'py_source',
    # JavaScript / TypeScript
    '.js':  'js_source', '.mjs': 'js_source', '.cjs': 'js_source',
    '.jsx': 'jsx_source',
    '.ts':  'ts_source',
    '.tsx': 'tsx_source',
    # Go
    '.go':  'go_source',
    # JVM / Mobile
    '.java': 'java_source', '.kt': 'kotlin_source', '.kts': 'kotlin_source',
    '.scala': 'scala_source', '.groovy': 'groovy_source',
    '.dart': 'dart_source', '.swift': 'swift_source',
    '.m': 'objc_source', '.mm': 'objc_source',
    # .NET
    '.cs': 'csharp_source', '.vb': 'vb_source',
    '.fs': 'fsharp_source', '.fsx': 'fsharp_source',
    # Scripting
    '.rb': 'ruby_source', '.php': 'php_source',
    '.pl': 'perl_source', '.pm': 'perl_source',
    '.lua': 'lua_source',
    '.sh': 'shell_source', '.bash': 'shell_source', '.zsh': 'shell_source',
    '.r': 'r_source', '.R': 'r_source', '.jl': 'julia_source',
    # Systems
    '.rs': 'rust_source', '.zig': 'zig_source',
    '.d': 'd_source', '.nim': 'nim_source', '.cr': 'crystal_source',
    # Functional
    '.ex': 'elixir_source', '.exs': 'elixir_source',
    '.erl': 'erlang_source', '.hrl': 'erlang_source',
    '.clj': 'clojure_source', '.cljs': 'clojure_source',
    '.hs': 'haskell_source', '.ml': 'ocaml_source', '.mli': 'ocaml_source',
        '.elm': 'elm_source',
    # Data / Schema
    '.sql': 'sql_source', '.graphql': 'graphql_source', '.gql': 'graphql_source',
    '.proto': 'proto_source',
    # Web / Styles
    '.css': 'css_source', '.scss': 'scss_source', '.sass': 'sass_source',
    '.less': 'less_source', '.styl': 'stylus_source',
    '.html': 'html_source', '.htm': 'html_source', '.xhtml': 'html_source',
    # Config / Data
    '.json': 'json_config',
    '.yaml': 'yaml_source', '.yml': 'yaml_source',
    '.toml': 'toml_source',
    # Docs
    '.md': 'markdown_doc', '.markdown': 'markdown_doc', '.mdown': 'markdown_doc',
    '.mkd': 'markdown_doc', '.rst': 'rst_doc', '.txt': 'text_doc',
    # Scripting (Windows)
    '.ps1': 'powershell_source', '.psm1': 'powershell_source',
    '.psd1': 'powershell_source',
}

# Pure data / documentation / config file types. These legitimately have no
# import relationships, so counting them as "isolated" or "unimported" pollutes
# the architecture-health widgets with non-actionable noise (a README.md or
# package.json being "unimported" is not a problem). They are excluded from the
# isolated / unimported / entry-point metrics — same principle as excluding test
# files from dead-code detection: don't flag things that are working as intended.
_NON_CODE_FILE_TYPES = frozenset({
    'json_config', 'yaml_source', 'toml_source',
    'markdown_doc', 'rst_doc', 'text_doc',
})

# ─── Edge type definitions ───────────────────────────────────────────────────
# 每種 edge type 決定前端的線條樣式
EDGE_TYPES = {
    # ── File-level dependency edges (kind = 'import') ──────────────────────
    'include':       {'label': 'Include',   'color': '#c084fc', 'style': 'solid',  'kind': 'import'},
    'sources':       {'label': 'Sources',   'color': '#ffd700', 'style': 'solid',  'kind': 'import'},
    'package':       {'label': 'Package',   'color': '#00d4ff', 'style': 'dashed', 'kind': 'import'},
    'library':       {'label': 'Library',   'color': '#a78bfa', 'style': 'dashed', 'kind': 'import'},
    'elink':         {'label': 'ELINK',     'color': '#ff6b35', 'style': 'dotted', 'kind': 'import'},
    'cif_own':       {'label': 'owns',      'color': '#34d399', 'style': 'solid',  'kind': 'import'},
    'component':     {'label': 'Component', 'color': '#60a5fa', 'style': 'solid',  'kind': 'import'},
    'depex':         {'label': 'Depex',     'color': '#f472b6', 'style': 'dotted', 'kind': 'import'},
    'guid_ref':      {'label': 'GUID',      'color': '#fb923c', 'style': 'dashed', 'kind': 'import'},
    'str_ref':       {'label': 'Strings',   'color': '#e879f9', 'style': 'dashed', 'kind': 'import'},
    'asl_include':   {'label': 'ASL',       'color': '#818cf8', 'style': 'solid',  'kind': 'import'},
    'callback_ref':  {'label': 'Callback',  'color': '#f87171', 'style': 'dotted', 'kind': 'import'},
    'hii_pkg':       {'label': 'HII-Pkg',   'color': '#94a3b8', 'style': 'solid',  'kind': 'import'},
    # ── Universal import edge (all analysed languages) ─────────────────────
    'import':        {'label': 'Import',    'color': '#10b981', 'style': 'solid',  'kind': 'import'},
    'asset_ref':     {'label': 'Asset',     'color': '#22d3ee', 'style': 'dashed', 'kind': 'import'},
    'config_ref':    {'label': 'Config',    'color': '#f59e0b', 'style': 'dashed', 'kind': 'import'},
    'schema_ref':    {'label': 'Schema',    'color': '#e10098', 'style': 'dashed', 'kind': 'import'},
    'resource_hint': {'label': 'Resource',  'color': '#14b8a6', 'style': 'dotted', 'kind': 'import'},
    # ── Semantic kind edges ─────────────────────────────────────────────────
    'call':          {'label': 'Call',      'color': '#38bdf8', 'style': 'solid',  'kind': 'call'},
    'inherit':       {'label': 'Inherit',   'color': '#818cf8', 'style': 'solid',  'kind': 'inherit'},
    # ── AI-inferred edge (B1, dashed by design) ─────────────────────────────
    'inferred':      {'label': 'Inferred',  'color': '#94a3b8', 'style': 'dashed', 'kind': 'inferred'},
}

# C/C++ parsing lives in parsers/c_cpp_parser.py; BIOS parser handles firmware formats.

MODULE_COLORS = [
    '#00d4ff','#00ff9f','#ff6b35','#ffd700','#a78bfa',
    '#f472b6','#34d399','#fb923c','#60a5fa','#e879f9',
    '#4ade80','#facc15','#f87171','#38bdf8','#c084fc',
]

# ─── Known system / UEFI / C-runtime function categories ─────────────────────
# Maps function name → display category name.
# Used by the frontend to classify "unresolved" calls into meaningful groups
# instead of dumping everything into a single "System/Unknown" blob.
KNOWN_SYS_FUNCS: Dict[str, str] = {
    # ── UEFI Boot Services (gBS->) ────────────────────────────────────────────
    'AllocatePool':                     'UEFI Boot Services',
    'FreePool':                         'UEFI Boot Services',
    'AllocatePages':                    'UEFI Boot Services',
    'FreePages':                        'UEFI Boot Services',
    'InstallProtocolInterface':         'UEFI Boot Services',
    'UninstallProtocolInterface':       'UEFI Boot Services',
    'InstallMultipleProtocolInterfaces':'UEFI Boot Services',
    'UninstallMultipleProtocolInterfaces':'UEFI Boot Services',
    'LocateProtocol':                   'UEFI Boot Services',
    'HandleProtocol':                   'UEFI Boot Services',
    'OpenProtocol':                     'UEFI Boot Services',
    'CloseProtocol':                    'UEFI Boot Services',
    'LocateHandleBuffer':               'UEFI Boot Services',
    'LocateHandle':                     'UEFI Boot Services',
    'CreateEvent':                      'UEFI Boot Services',
    'CreateEventEx':                    'UEFI Boot Services',
    'CloseEvent':                       'UEFI Boot Services',
    'SignalEvent':                      'UEFI Boot Services',
    'WaitForEvent':                     'UEFI Boot Services',
    'CheckEvent':                       'UEFI Boot Services',
    'SetTimer':                         'UEFI Boot Services',
    'RaiseTPL':                         'UEFI Boot Services',
    'RestoreTPL':                       'UEFI Boot Services',
    'ExitBootServices':                 'UEFI Boot Services',
    'GetMemoryMap':                     'UEFI Boot Services',
    'SetWatchdogTimer':                 'UEFI Boot Services',
    'Stall':                            'UEFI Boot Services',
    'ConnectController':                'UEFI Boot Services',
    'DisconnectController':             'UEFI Boot Services',
    'RegisterProtocolNotify':           'UEFI Boot Services',
    'ReinstallProtocolInterface':       'UEFI Boot Services',
    'LoadImage':                        'UEFI Boot Services',
    'StartImage':                       'UEFI Boot Services',
    'Exit':                             'UEFI Boot Services',
    'UnloadImage':                      'UEFI Boot Services',
    'GetNextMonotonicCount':            'UEFI Boot Services',
    'InstallConfigurationTable':        'UEFI Boot Services',
    'ProtocolsPerHandle':               'UEFI Boot Services',
    'OpenProtocolInformation':          'UEFI Boot Services',

    # ── UEFI Runtime Services (gRT->) ─────────────────────────────────────────
    'GetVariable':                      'UEFI Runtime Services',
    'SetVariable':                      'UEFI Runtime Services',
    'GetNextVariableName':              'UEFI Runtime Services',
    'QueryVariableInfo':                'UEFI Runtime Services',
    'GetTime':                          'UEFI Runtime Services',
    'SetTime':                          'UEFI Runtime Services',
    'GetWakeupTime':                    'UEFI Runtime Services',
    'SetWakeupTime':                    'UEFI Runtime Services',
    'SetVirtualAddressMap':             'UEFI Runtime Services',
    'ConvertPointer':                   'UEFI Runtime Services',
    'GetNextHighMonotonicCount':        'UEFI Runtime Services',
    'ResetSystem':                      'UEFI Runtime Services',
    'UpdateCapsule':                    'UEFI Runtime Services',
    'QueryCapsuleCapabilities':         'UEFI Runtime Services',

    # ── EDK2 MemoryLib ────────────────────────────────────────────────────────
    'CopyMem':          'EDK2 MemoryLib',
    'SetMem':           'EDK2 MemoryLib',
    'SetMem8':          'EDK2 MemoryLib',
    'SetMem16':         'EDK2 MemoryLib',
    'SetMem32':         'EDK2 MemoryLib',
    'SetMem64':         'EDK2 MemoryLib',
    'ZeroMem':          'EDK2 MemoryLib',
    'CompareMem':       'EDK2 MemoryLib',
    'ScanMem8':         'EDK2 MemoryLib',
    'ScanMem16':        'EDK2 MemoryLib',
    'ScanMem32':        'EDK2 MemoryLib',
    'ScanMem64':        'EDK2 MemoryLib',
    'CopyMemS':         'EDK2 MemoryLib',
    'SetMemS':          'EDK2 MemoryLib',

    # ── EDK2 BaseLib / String ─────────────────────────────────────────────────
    'StrLen':           'EDK2 BaseLib',
    'StrnLen':          'EDK2 BaseLib',
    'StrSize':          'EDK2 BaseLib',
    'StrCmp':           'EDK2 BaseLib',
    'StrnCmp':          'EDK2 BaseLib',
    'StrCpy':           'EDK2 BaseLib',
    'StrnCpy':          'EDK2 BaseLib',
    'StrCat':           'EDK2 BaseLib',
    'StrnCat':          'EDK2 BaseLib',
    'StrStr':           'EDK2 BaseLib',
    'StrDecimalToUintn':'EDK2 BaseLib',
    'StrDecimalToUint64':'EDK2 BaseLib',
    'StrHexToUintn':    'EDK2 BaseLib',
    'StrHexToUint64':   'EDK2 BaseLib',
    'UnicodeStrToAsciiStr':'EDK2 BaseLib',
    'AsciiStrToUnicodeStr':'EDK2 BaseLib',
    'AsciiStrLen':      'EDK2 BaseLib',
    'AsciiStrnLen':     'EDK2 BaseLib',
    'AsciiStrSize':     'EDK2 BaseLib',
    'AsciiStrCmp':      'EDK2 BaseLib',
    'AsciiStrnCmp':     'EDK2 BaseLib',
    'AsciiStrCpy':      'EDK2 BaseLib',
    'AsciiStrnCpy':     'EDK2 BaseLib',
    'AsciiStrCat':      'EDK2 BaseLib',
    'AsciiStrnCat':     'EDK2 BaseLib',
    'AsciiStrStr':      'EDK2 BaseLib',
    'AsciiStrDecimalToUintn':'EDK2 BaseLib',
    'AsciiStrHexToUintn':'EDK2 BaseLib',
    'UnicodeStrToAsciiStrS':'EDK2 BaseLib',
    'AsciiStrToUnicodeStrS':'EDK2 BaseLib',
    'StrCpyS':          'EDK2 BaseLib',
    'StrnCpyS':         'EDK2 BaseLib',
    'StrCatS':          'EDK2 BaseLib',
    'StrnCatS':         'EDK2 BaseLib',
    'AsciiStrCpyS':     'EDK2 BaseLib',
    'AsciiStrnCpyS':    'EDK2 BaseLib',
    'AsciiStrCatS':     'EDK2 BaseLib',
    'AsciiStrnCatS':    'EDK2 BaseLib',
    'UnicodeSPrint':    'EDK2 BaseLib',
    'UnicodeSPrintAsciiFormat':'EDK2 BaseLib',
    'AsciiSPrint':      'EDK2 BaseLib',
    'AsciiSPrintUnicodeFormat':'EDK2 BaseLib',
    'UnicodeVSPrint':   'EDK2 BaseLib',
    'AsciiVSPrint':     'EDK2 BaseLib',
    'SwapBytes16':      'EDK2 BaseLib',
    'SwapBytes32':      'EDK2 BaseLib',
    'SwapBytes64':      'EDK2 BaseLib',
    'LShiftU64':        'EDK2 BaseLib',
    'RShiftU64':        'EDK2 BaseLib',
    'ARShiftU64':       'EDK2 BaseLib',
    'MultU64x32':       'EDK2 BaseLib',
    'MultU64x64':       'EDK2 BaseLib',
    'DivU64x32':        'EDK2 BaseLib',
    'DivU64x64Remainder':'EDK2 BaseLib',
    'ModU64x32':        'EDK2 BaseLib',
    'GetPowerOfTwo32':  'EDK2 BaseLib',
    'GetPowerOfTwo64':  'EDK2 BaseLib',
    'HighBitSet32':     'EDK2 BaseLib',
    'HighBitSet64':     'EDK2 BaseLib',
    'LowBitSet32':      'EDK2 BaseLib',
    'LowBitSet64':      'EDK2 BaseLib',
    'CalculateCrc32':   'EDK2 BaseLib',

    # ── EDK2 DebugLib ─────────────────────────────────────────────────────────
    'DEBUG':                'EDK2 DebugLib',
    'ASSERT':               'EDK2 DebugLib',
    'ASSERT_EFI_ERROR':     'EDK2 DebugLib',
    'ASSERT_PROTOCOL_ALREADY_INSTALLED': 'EDK2 DebugLib',
    'DebugPrint':           'EDK2 DebugLib',
    'DebugAssert':          'EDK2 DebugLib',
    'DebugClearMemory':     'EDK2 DebugLib',
    'DebugAssertEnabled':   'EDK2 DebugLib',
    'DebugPrintEnabled':    'EDK2 DebugLib',
    'DebugCodeEnabled':     'EDK2 DebugLib',
    'DeadLoop':             'EDK2 DebugLib',

    # ── EDK2 PrintLib ─────────────────────────────────────────────────────────
    'Print':            'EDK2 PrintLib',
    'AsciiPrint':       'EDK2 PrintLib',

    # ── EDK2 MemoryAllocationLib ──────────────────────────────────────────────
    'AllocateZeroPool':         'EDK2 MemAlloc',
    'AllocateCopyPool':         'EDK2 MemAlloc',
    'AllocatePool':             'EDK2 MemAlloc',
    'AllocateRuntimePool':      'EDK2 MemAlloc',
    'AllocateReservedPool':     'EDK2 MemAlloc',
    'AllocateRuntimeZeroPool':  'EDK2 MemAlloc',
    'FreePool':                 'EDK2 MemAlloc',
    'ReallocatePool':           'EDK2 MemAlloc',
    'AllocateAlignedPool':      'EDK2 MemAlloc',
    'AllocateAlignedZeroPool':  'EDK2 MemAlloc',
    'FreeAlignedPool':          'EDK2 MemAlloc',

    # ── EDK2 PeiServicesLib ───────────────────────────────────────────────────
    'PeiServicesInstallPpi':            'PEI Services',
    'PeiServicesReInstallPpi':          'PEI Services',
    'PeiServicesLocatePpi':             'PEI Services',
    'PeiServicesNotifyPpi':             'PEI Services',
    'PeiServicesGetBootMode':           'PEI Services',
    'PeiServicesSetBootMode':           'PEI Services',
    'PeiServicesGetHobList':            'PEI Services',
    'PeiServicesCreateHob':             'PEI Services',
    'PeiServicesFfsFindNextVolume':     'PEI Services',
    'PeiServicesFfsFindNextFile':       'PEI Services',
    'PeiServicesFfsFindSectionData':    'PEI Services',
    'PeiServicesInstallPeiMemory':      'PEI Services',
    'PeiServicesAllocatePages':         'PEI Services',
    'PeiServicesAllocatePool':          'PEI Services',
    'PeiServicesCopyMem':               'PEI Services',
    'PeiServicesSetMem':                'PEI Services',
    'PeiServicesReportStatusCode':      'PEI Services',
    'PeiServicesResetSystem':           'PEI Services',

    # ── EDK2 HobLib ───────────────────────────────────────────────────────────
    'GetHobList':           'EDK2 HobLib',
    'GetNextHob':           'EDK2 HobLib',
    'GetFirstHob':          'EDK2 HobLib',
    'GetNextGuidHob':       'EDK2 HobLib',
    'GetFirstGuidHob':      'EDK2 HobLib',
    'BuildHob':             'EDK2 HobLib',
    'BuildModuleHob':       'EDK2 HobLib',
    'BuildResourceDescriptorHob':'EDK2 HobLib',
    'BuildGuidHob':         'EDK2 HobLib',
    'BuildGuidDataHob':     'EDK2 HobLib',
    'BuildFvHob':           'EDK2 HobLib',
    'BuildCpuHob':          'EDK2 HobLib',
    'BuildMemoryAllocationHob':'EDK2 HobLib',
    'BuildStackHob':        'EDK2 HobLib',
    'BuildBspStoreHob':     'EDK2 HobLib',
    'GetBootModeHob':       'EDK2 HobLib',

    # ── EDK2 UefiLib / DevicePath ─────────────────────────────────────────────
    'EfiCreateEventReadyToBootEx':  'EDK2 UefiLib',
    'EfiNamedEventListen':          'EDK2 UefiLib',
    'EfiNamedEventSignal':          'EDK2 UefiLib',
    'EfiEventEmptyFunction':        'EDK2 UefiLib',
    'GetGlyphWidth':                'EDK2 UefiLib',
    'EfiGetSystemConfigurationTable':'EDK2 UefiLib',
    'EfiLibInstallDriverBinding':   'EDK2 UefiLib',
    'EfiLibInstallAllDriverProtocols2':'EDK2 UefiLib',
    'GetVariable2':                 'EDK2 UefiLib',
    'GetEfiGlobalVariable2':        'EDK2 UefiLib',
    'DevicePathToStr':              'EDK2 UefiLib',
    'DevicePathFromHandle':         'EDK2 DevicePath',
    'AppendDevicePath':             'EDK2 DevicePath',
    'AppendDevicePathNode':         'EDK2 DevicePath',
    'AppendDevicePathInstance':     'EDK2 DevicePath',
    'DuplicateDevicePath':          'EDK2 DevicePath',
    'IsDevicePathEnd':              'EDK2 DevicePath',
    'IsDevicePathEndType':          'EDK2 DevicePath',
    'IsDevicePathEndInstance':      'EDK2 DevicePath',
    'NextDevicePathNode':           'EDK2 DevicePath',
    'DevicePathType':               'EDK2 DevicePath',
    'DevicePathSubType':            'EDK2 DevicePath',
    'DevicePathNodeLength':         'EDK2 DevicePath',
    'SetDevicePathNodeLength':      'EDK2 DevicePath',
    'SetDevicePathEndNode':         'EDK2 DevicePath',
    'GetDevicePathSize':            'EDK2 DevicePath',
    'ConvertDevicePathToText':      'EDK2 DevicePath',

    # ── C Standard Library ────────────────────────────────────────────────────
    'memcpy':   'C Runtime',  'memmove':  'C Runtime',
    'memset':   'C Runtime',  'memcmp':   'C Runtime',
    'memchr':   'C Runtime',  'strlen':   'C Runtime',
    'strcmp':   'C Runtime',  'strncmp':  'C Runtime',
    'strcpy':   'C Runtime',  'strncpy':  'C Runtime',
    'strcat':   'C Runtime',  'strncat':  'C Runtime',
    'strchr':   'C Runtime',  'strrchr':  'C Runtime',
    'strstr':   'C Runtime',  'strtol':   'C Runtime',
    'strtoul':  'C Runtime',  'strtoll':  'C Runtime',
    'strtoull': 'C Runtime',  'strtod':   'C Runtime',
    'atoi':     'C Runtime',  'atol':     'C Runtime',
    'atoll':    'C Runtime',  'atof':     'C Runtime',
    'sprintf':  'C Runtime',  'snprintf': 'C Runtime',
    'sscanf':   'C Runtime',  'printf':   'C Runtime',
    'fprintf':  'C Runtime',  'vprintf':  'C Runtime',
    'vsprintf': 'C Runtime',  'vsnprintf':'C Runtime',
    'malloc':   'C Runtime',  'calloc':   'C Runtime',
    'realloc':  'C Runtime',  'free':     'C Runtime',
    'abs':      'C Runtime',  'labs':     'C Runtime',
    'llabs':    'C Runtime',  'div':      'C Runtime',
    'ldiv':     'C Runtime',  'lldiv':    'C Runtime',
    'rand':     'C Runtime',  'srand':    'C Runtime',
    'qsort':    'C Runtime',  'bsearch':  'C Runtime',

    # ── Firmware SDK ──────────────────────────────────────────────────────────
    'Malloc':        'Firmware SDK',
    'MallocZ':       'Firmware SDK',
    'Free':          'Firmware SDK',
    'MemSet':        'Firmware SDK',
    'MemCpy':        'Firmware SDK',
    'MemCmp':        'Firmware SDK',
    'Strlen':        'Firmware SDK',
    'Strcmp':        'Firmware SDK',
    'Strcpy':        'Firmware SDK',
    'Strcat':        'Firmware SDK',
    'Sprintf':       'Firmware SDK',
    'Swprintf':      'Firmware SDK',
    'TRACE':         'Firmware SDK',
    'PROGRESS_CODE': 'Firmware SDK',
    'ERROR_CODE':    'Firmware SDK',

    # ── IO / CPU / MSR ────────────────────────────────────────────────────────
    'IoRead8':      'CPU/IO Lib',  'IoWrite8':     'CPU/IO Lib',
    'IoRead16':     'CPU/IO Lib',  'IoWrite16':    'CPU/IO Lib',
    'IoRead32':     'CPU/IO Lib',  'IoWrite32':    'CPU/IO Lib',
    'MmioRead8':    'CPU/IO Lib',  'MmioWrite8':   'CPU/IO Lib',
    'MmioRead16':   'CPU/IO Lib',  'MmioWrite16':  'CPU/IO Lib',
    'MmioRead32':   'CPU/IO Lib',  'MmioWrite32':  'CPU/IO Lib',
    'MmioRead64':   'CPU/IO Lib',  'MmioWrite64':  'CPU/IO Lib',
    'MmioAndThenOr8':  'CPU/IO Lib', 'MmioAndThenOr16': 'CPU/IO Lib',
    'MmioAndThenOr32': 'CPU/IO Lib', 'MmioAndThenOr64': 'CPU/IO Lib',
    'MmioOr8':      'CPU/IO Lib',  'MmioOr16':     'CPU/IO Lib',
    'MmioOr32':     'CPU/IO Lib',  'MmioOr64':     'CPU/IO Lib',
    'MmioAnd8':     'CPU/IO Lib',  'MmioAnd16':    'CPU/IO Lib',
    'MmioAnd32':    'CPU/IO Lib',  'MmioAnd64':    'CPU/IO Lib',
    'AsmReadMsr64': 'CPU/IO Lib',  'AsmWriteMsr64':'CPU/IO Lib',
    'AsmReadMsr32': 'CPU/IO Lib',  'AsmWriteMsr32':'CPU/IO Lib',
    'AsmCpuid':     'CPU/IO Lib',  'AsmCpuidEx':   'CPU/IO Lib',
    'AsmReadCr0':   'CPU/IO Lib',  'AsmWriteCr0':  'CPU/IO Lib',
    'AsmReadCr2':   'CPU/IO Lib',  'AsmReadCr3':   'CPU/IO Lib',
    'AsmWriteCr3':  'CPU/IO Lib',  'AsmReadCr4':   'CPU/IO Lib',
    'AsmWriteCr4':  'CPU/IO Lib',  'AsmReadIdtr':  'CPU/IO Lib',
    'AsmWriteIdtr': 'CPU/IO Lib',  'AsmReadGdtr':  'CPU/IO Lib',
    'AsmWriteGdtr': 'CPU/IO Lib',  'AsmDisableInterrupts':'CPU/IO Lib',
    'AsmEnableInterrupts':  'CPU/IO Lib',
    'AsmWbinvd':    'CPU/IO Lib',  'AsmInvd':      'CPU/IO Lib',
    'AsmFlushCacheLine': 'CPU/IO Lib',
    'AsmNop':       'CPU/IO Lib',  'AsmPause':     'CPU/IO Lib',

    # ── UEFI ReportStatusCode ─────────────────────────────────────────────────
    'REPORT_STATUS_CODE':           'Status Code',
    'REPORT_STATUS_CODE_WITH_DEVICE_PATH': 'Status Code',
    'REPORT_STATUS_CODE_WITH_EXTENDED_DATA': 'Status Code',
    'ReportStatusCode':             'Status Code',
    'ReportStatusCodeWithDevicePath': 'Status Code',
    'LibReportStatusCode':          'Status Code',
}

# ─── Parser dispatch wrappers ─────────────────────────────────────────────────

# ─── scan_file ────────────────────────────────────────────────────────────────
def scan_file(filepath: str, root: str, _memo: Optional[dict] = None):
    """
    Returns (includes_or_refs, funcdefs, funccalls, extra_dict, func_calls_by_func, symbol_defs)
    extra_dict varies by file type; None for some firmware/assembly inputs.
    symbol_defs is a list of {kind, name, line, end_line, bases, parent, is_public}.

    _memo: optional in-memory cache dict from parse_memo.open_memo().  When
           provided, results are looked up before parsing and stored afterward.
           Pass None to disable caching (default, backward-compatible).
    """
    fp_path = Path(filepath)
    try:
        file_bytes = fp_path.read_bytes()
    except Exception:
        return [], [], [], None, [], [], None

    ext = fp_path.suffix.lower()

    # ── Cache lookup ──────────────────────────────────────────────────────────
    if _memo is not None:
        try:
            rel = fp_path.relative_to(root).as_posix()
        except ValueError:
            rel = filepath.replace('\\', '/')
        file_sha = parse_memo.digest_bytes(file_bytes)
        parser_fn = _get_parser_fn(ext)
        p_sha = _parser_fingerprints.get(parser_fn)
        if p_sha is None:
            p_sha = parse_memo.parser_fingerprint(parser_fn)
            _parser_fingerprints[parser_fn] = p_sha
        hit = parse_memo.lookup_entry(_memo, rel, file_sha, p_sha)
        if hit is not None:
            return hit
    else:
        rel = file_sha = p_sha = None

    result = _compute_parse_result(file_bytes, ext)

    # ── Cache write ───────────────────────────────────────────────────────────
    if _memo is not None and rel is not None:
        parse_memo.record_entry(_memo, rel, file_sha, p_sha, result)

    return result


def _compute_parse_result(file_bytes: bytes, ext: str) -> tuple:
    """Pure parser+LOC pass on already-read bytes; returns normalized 7-tuple
    with `loc` baked into the extras slot. Shared by serial scan_file() and
    the multiprocessing worker — keeping the dispatch in one place avoids
    drift between paths."""
    try:
        src = file_bytes.decode('utf-8', errors='replace')
    except Exception:
        src = ''

    loc_data = count_loc(src, ext) if _PARSERS_LOADED else {'code': 0, 'comment': 0, 'blank': 0}

    raw = None
    if ext in _C_CPP_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_c_cpp(src, ext)
    elif ext in _UEFI_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_uefi(src, ext)
    elif ext in _ACPI_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_acpi(src, ext)
    elif ext in _ASM_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_asm(src, ext)
    elif ext == '.py' and _PARSERS_LOADED:
        raw = scan_python(src)
    elif ext in ('.js', '.mjs', '.cjs', '.jsx') and _PARSERS_LOADED:
        raw = scan_js(src)
    elif ext in ('.ts', '.tsx') and _PARSERS_LOADED:
        raw = scan_ts(src)
    elif ext == '.go' and _PARSERS_LOADED:
        raw = scan_go(src)
    elif ext in _JAVA_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_java(src, ext)
    elif ext in _RUST_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_rust(src, ext)
    elif ext in _KOTLIN_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_kotlin(src, ext)
    elif ext in _SCALA_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_scala(src, ext)
    elif ext in _GROOVY_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_groovy(src, ext)
    elif ext in _DART_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_dart(src, ext)
    elif ext in _SWIFT_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_swift(src, ext)
    elif ext in _OBJC_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_objc(src, ext)
    elif ext in _CSHARP_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_csharp(src, ext)
    elif ext in _PHP_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_php(src)
    elif ext in _PERL_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_perl(src)
    elif ext in _LUA_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_lua(src)
    elif ext in _SHELL_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_shell(src)
    elif ext in _R_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_r(src, ext)
    elif ext in _PROTOBUF_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_protobuf(src, ext)
    elif ext in _GRAPHQL_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_graphql(src, ext)
    elif ext in _ZIG_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_zig(src, ext)
    elif ext in _D_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_d(src, ext)
    elif ext in _SQL_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_sql(src, ext)
    elif ext in _CSS_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_css(src, ext)
    elif ext in _RUBY_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_ruby(src, ext)
    elif ext in _CRYSTAL_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_crystal(src, ext)
    elif ext in _JULIA_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_julia(src, ext)
    elif ext in _ELIXIR_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_elixir(src, ext)
    elif ext in _VBNET_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_vbnet(src, ext)
    elif ext in _CLOJURE_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_clojure(src, ext)
    elif ext in _ERLANG_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_erlang(src, ext)
    elif ext in _FSHARP_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_fsharp(src, ext)
    elif ext in _OCAML_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_ocaml(src, ext)
    elif ext in _NIM_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_nim(src, ext)
    elif ext in _HASKELL_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_haskell(src, ext)
    elif ext in _ELM_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_elm(src, ext)
    elif ext in _HTML_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_html(src, ext)
    elif ext in _YAML_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_yaml(src, ext)
    elif ext in _MARKDOWN_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_markdown(src, ext)
    elif ext in _POWERSHELL_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_powershell(src, ext)
    elif ext in _TOML_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_toml(src, ext)
    elif ext == '.json' and _PARSERS_LOADED:
        raw = scan_json(src, ext)
    elif _PARSERS_LOADED:
        raw = scan_common(src, ext)

    if raw is not None:
        n = len(raw)
        if n == 5:
            result = (*raw, [], None)
        elif n == 6:
            diag = None
            if isinstance(raw[3], dict) and raw[3].get('file_error'):
                diag = {'file_error': raw[3].get('file_error')}
            result = (*raw, diag)
        elif n == 7:
            result = tuple(raw)
        else:
            padded = list(raw)[:7] + [None] * max(0, 7 - n)
            result = tuple(padded)
    else:
        result = ([], [], [], None, [], [], None)

    _extra = result[3]
    if isinstance(_extra, dict):
        _extra = {**_extra, 'loc': loc_data}
    else:
        _extra = {'loc': loc_data}
    return (result[0], result[1], result[2], _extra) + tuple(result[4:])


def _parse_one_worker(args):
    """ProcessPoolExecutor worker — must be top-level so it pickles. Reads the
    file, hashes it, runs the parser, returns:
        (filepath, result_7tuple, file_sha, parser_sha, ext)
    Cache lookup/writes stay in the parent so the memo dict has a single owner."""
    fp, _root = args
    fp_path = Path(fp)
    ext = fp_path.suffix.lower()
    empty_result = ([], [], [], {'loc': {'code': 0, 'comment': 0, 'blank': 0}}, [], [], None)
    try:
        file_bytes = fp_path.read_bytes()
    except Exception:
        return (fp, empty_result, '', '', ext)
    try:
        file_sha = parse_memo.digest_bytes(file_bytes)
        parser_fn = _get_parser_fn(ext)
        p_sha = parse_memo.parser_fingerprint(parser_fn)
        result = _compute_parse_result(file_bytes, ext)
        return (fp, result, file_sha, p_sha, ext)
    except Exception as e:
        diag_result = ([], [], [], {'loc': {'code': 0, 'comment': 0, 'blank': 0}}, [], [], {'file_error': str(e)})
        return (fp, diag_result, '', '', ext)


# ─── get_module ───────────────────────────────────────────────────────────────
def get_module(rel_path: str) -> str:
    parts = rel_path.replace('\\', '/').split('/')
    return parts[0] if len(parts) > 1 else '_root'


# ─── Quality-metric helpers (consumed by build_graph stats) ──────────────────

class _GitIgnoreFilterError(RuntimeError):
    pass


class _GitIgnoreFilter:
    def __init__(self, root: str, enabled: bool):
        self.root = root
        self.enabled = enabled
        self.mode = 'git' if enabled else 'fallback'

    def ignored(self, rel_paths) -> set:
        if not self.enabled or not rel_paths:
            return set()
        normalized = []
        for p in rel_paths:
            path = str(p).replace('\\', '/')
            if path.startswith('./'):
                path = path[2:]
            if path:
                normalized.append(path)
        if not normalized:
            return set()
        payload = ('\0'.join(normalized) + '\0').encode('utf-8', errors='surrogateescape')
        try:
            proc = subprocess.run(
                ['git', 'check-ignore', '-z', '-v', '--stdin'],
                cwd=self.root,
                input=payload,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=30,
            )
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError) as exc:
            raise _GitIgnoreFilterError(str(exc)) from exc
        if proc.returncode not in (0, 1):
            raise _GitIgnoreFilterError(
                proc.stderr.decode('utf-8', errors='replace') if proc.stderr else 'git check-ignore failed'
            )
        fields = proc.stdout.decode('utf-8', errors='surrogateescape').split('\0')
        ignored = set()
        for i in range(0, len(fields) - 3, 4):
            pattern = fields[i + 2]
            path = fields[i + 3]
            if path and not pattern.startswith('!'):
                ignored.add(path.replace('\\', '/').rstrip('/'))
        return ignored


def _build_git_ignore_filter(root: str) -> _GitIgnoreFilter:
    try:
        proc = subprocess.run(
            ['git', 'rev-parse', '--is-inside-work-tree'],
            cwd=root,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=10,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return _GitIgnoreFilter(root, enabled=False)
    if proc.returncode != 0 or proc.stdout.decode('utf-8', errors='replace').strip() != 'true':
        return _GitIgnoreFilter(root, enabled=False)
    try:
        root_proc = subprocess.run(
            ['git', 'check-ignore', '-q', '.'],
            cwd=root,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=10,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
        return _GitIgnoreFilter(root, enabled=False)
    if root_proc.returncode == 0:
        return _GitIgnoreFilter(root, enabled=False)
    if root_proc.returncode not in (0, 1):
        return _GitIgnoreFilter(root, enabled=False)
    return _GitIgnoreFilter(root, enabled=True)


def _aggregate_loc(file_meta: dict) -> dict:
    """Sum per-file LOC into project totals.

    Returns ``{'total': N, 'code': N, 'comment': N, 'blank': N}``.
    """
    code = comment = blank = 0
    for meta in file_meta.values():
        loc = meta.get('loc') or {}
        code    += int(loc.get('code', 0) or 0)
        comment += int(loc.get('comment', 0) or 0)
        blank   += int(loc.get('blank', 0) or 0)
    return {
        'total':   code + comment + blank,
        'code':    code,
        'comment': comment,
        'blank':   blank,
    }


_FUNC_KINDS = {'function', 'method'}
_COMPLEXITY_BUCKETS = (
    ('1-5', 1, 5),
    ('6-10', 6, 10),
    ('11-15', 11, 15),
    ('16-20', 16, 20),
    ('21+', 21, 10**9),
)


def _aggregate_complexity(symbol_index: dict, top_n: int = 10) -> dict:
    """Histogram + top offenders for the cyclomatic-complexity widget.

    Functions whose parser doesn't report complexity (``None``) are skipped.
    """
    distribution = [{'range': label, 'count': 0} for label, _, _ in _COMPLEXITY_BUCKETS]
    offenders = []
    total = 0
    high_count = 0   # functions with complexity > 15 (used by tech-debt formula)
    sum_cx = 0

    for sym in symbol_index.values():
        if sym.get('kind') not in _FUNC_KINDS:
            continue
        cx = sym.get('complexity')
        if cx is None:
            continue
        cx = int(cx)
        total += 1
        sum_cx += cx
        if cx > 15:
            high_count += 1
        for i, (_label, lo, hi) in enumerate(_COMPLEXITY_BUCKETS):
            if lo <= cx <= hi:
                distribution[i]['count'] += 1
                break
        offenders.append({
            'file':       sym.get('file', ''),
            'name':       sym.get('name', ''),
            'line':       sym.get('line', 0),
            'complexity': cx,
        })

    offenders.sort(key=lambda x: x['complexity'], reverse=True)
    return {
        'distribution':   distribution,
        'top_offenders':  offenders[:top_n],
        'total_funcs':    total,
        'avg':            (sum_cx / total) if total else 0.0,
        'high_count':     high_count,
    }


# Comment / boilerplate prefixes used by the duplication line-filter.
_DUP_COMMENT_PREFIXES = ('#', '//', '--', '/*', '*', ';')


def _compute_duplication(root: str, file_meta: dict, window: int = 6) -> dict:
    """Detect duplicated *window*-line code blocks across the project.

    Each file's lines are normalised (whitespace collapsed, comments and very
    short lines dropped); rolling-hash windows are grouped by hash; any hash
    appearing twice or more is flagged as a duplicate block.

    Returns ``{'percent': float (0-1), 'blocks': list[dict]}`` with at most
    10 sample blocks.
    """
    import hashlib

    file_lines: dict = {}
    total_code_lines = 0
    for rel in file_meta:
        full_path = os.path.join(root, rel)
        try:
            with open(full_path, 'rb') as f:
                raw = f.read()
        except Exception:
            continue
        try:
            text = raw.decode('utf-8', errors='replace')
        except Exception:
            continue

        norm = []
        for line_no, line in enumerate(text.splitlines(), start=1):
            s = line.strip()
            if len(s) < 8:
                continue
            if any(s.startswith(p) for p in _DUP_COMMENT_PREFIXES):
                continue
            norm.append((line_no, ' '.join(s.split())))
        if norm:
            file_lines[rel] = norm
            total_code_lines += len(norm)

    if total_code_lines == 0 or window < 2:
        return {'percent': 0.0, 'blocks': []}

    hash_to_locs: dict = {}
    for rel, lines in file_lines.items():
        if len(lines) < window:
            continue
        for i in range(len(lines) - window + 1):
            chunk = '\n'.join(lines[i + k][1] for k in range(window))
            h = hashlib.md5(chunk.encode('utf-8')).hexdigest()[:16]
            hash_to_locs.setdefault(h, []).append((rel, lines[i][0], lines[i][1]))

    duplicated_lines: set = set()
    blocks = []
    dups = sorted(
        ((h, locs) for h, locs in hash_to_locs.items() if len(locs) >= 2),
        key=lambda x: len(x[1]),
        reverse=True,
    )
    for h, locs in dups:
        for rel, ln, _sample in locs:
            for k in range(window):
                duplicated_lines.add((rel, ln + k))
        if len(blocks) < 10:
            blocks.append({
                'hash':        h,
                'occurrences': [{'file': rel, 'line': ln} for rel, ln, _ in locs[:10]],
                'lines':       window,
                'sample':      locs[0][2][:80],
            })

    return {
        'percent': len(duplicated_lines) / total_code_lines,
        'blocks':  blocks,
    }


# Default tech-debt minute weights — exposed in stats so the dashboard can
# show the formula transparently.
_DEFAULT_TECH_DEBT_WEIGHTS = {
    'circular':    60,   # min per circular-dependency cycle
    'dead':        5,    # min per uncalled function
    'god':         90,   # min per god file (top-tier caller)
    'complexity':  30,   # min per function with complexity > 15
    'duplication': 20,   # min per duplicate block
}


def _compute_tech_debt(circular_count: int,
                       dead_count: int,
                       god_count: int,
                       high_complexity_count: int,
                       duplication_block_count: int) -> dict:
    """Return total minutes/hours plus the per-issue breakdown."""
    w = _DEFAULT_TECH_DEBT_WEIGHTS
    breakdown = {
        'circular':    circular_count * w['circular'],
        'dead':        dead_count * w['dead'],
        'god':         god_count * w['god'],
        'complexity':  high_complexity_count * w['complexity'],
        'duplication': duplication_block_count * w['duplication'],
    }
    minutes = sum(breakdown.values())
    return {
        'minutes':   minutes,
        'hours':     round(minutes / 60.0, 1),
        'breakdown': breakdown,
        'weights':   dict(w),
    }


# ─── build_graph ─────────────────────────────────────────────────────────────
def build_graph(root_dir: str, progress_cb=None, include_build=False, include_dirs=None,
                skip_health_snapshot: bool = False) -> dict:
    stage_flow = [
        ('scan', 'Scan source files'),
        ('detect', 'Detect project type'),
        ('analysis', 'Analyze source files'),
        ('node', 'Build nodes and indexes'),
        ('edge', 'Resolve dependencies and calls'),
        ('finalize', 'Finalize output'),
    ]
    stage_meta = {
        key: {'stage': key, 'stage_label': label, 'stage_index': idx + 1, 'stage_total': len(stage_flow)}
        for idx, (key, label) in enumerate(stage_flow)
    }
    # Stage windows are sized to wall-clock reality on large repos: the single
    # pruned walk (scan) is fast, parsing (analysis) dominates, dependency
    # resolution (edge) is the next-heaviest. Keep scan/detect small so the bar
    # doesn't sit frozen in a phase that only owns a sliver of the runtime.
    stage_ranges = {
        'scan': (0, 6),
        'detect': (6, 9),
        'analysis': (9, 86),
        'node': (86, 91),
        'edge': (91, 99),
        'finalize': (99, 100),
    }

    def _cb(pct, msg, stage=None, **kwargs):
        _console_print(f'[{pct:3d}%] {msg}', end='\r')
        payload = {}
        if stage in stage_meta:
            payload.update(stage_meta[stage])
        payload.update(kwargs)
        if progress_cb:
            progress_cb(pct, msg, **payload)

    def _stage_pct(stage: str, progress: float = 0.0, ease_power: float = 1.0) -> int:
        start, end = stage_ranges[stage]
        progress = max(0.0, min(1.0, float(progress)))
        if ease_power != 1.0:
            progress = progress ** ease_power
        return int(round(start + ((end - start) * progress)))

    root = os.path.abspath(root_dir)

    _cb(0, 'Scanning files...', stage='scan')
    skip_dirs = set(SKIP_DIRS)
    if include_build:
        skip_dirs -= BUILD_DIRS
    if include_dirs:
        skip_dirs -= set(include_dirs)

    def _rel_path(path: str) -> str:
        return os.path.relpath(path, root).replace('\\', '/')

    # Single-pass walk. skip_dirs (node_modules/.git/build/…) and .gitignore'd
    # directories are PRUNED, never descended — previously we did a full unpruned
    # walk just to count them, plus a re-walk of every ignored subtree, which is
    # what made the first slice of the bar eat most of the wall-clock on big
    # repos. The tradeoff: files inside skipped dirs are no longer enumerated, so
    # the "in skipped dirs" count is reported as 0 and total_dirs_skipped counts
    # skipped subtree *roots* rather than every nested folder. Progress is
    # emitted as we go so the bar advances instead of freezing at 0 %.
    def _collect_project_files(ignore_filter: _GitIgnoreFilter):
        visible_paths = []
        ignored_file_count = 0
        dirs_scanned = 0
        skipped_dir_roots = 0
        next_emit = 2000

        for dirpath, dirnames, filenames in os.walk(root):
            kept_dirs = []
            for d in dirnames:
                if d in skip_dirs:
                    skipped_dir_roots += 1
                else:
                    kept_dirs.append(d)
            dirnames[:] = kept_dirs

            if ignore_filter.enabled and dirnames:
                rel_dirs = [f'{_rel_path(os.path.join(dirpath, d))}/' for d in dirnames]
                ignored_dirs = ignore_filter.ignored(rel_dirs)
                if ignored_dirs:
                    kept_dirs = []
                    for dirname in dirnames:
                        rel_dir = _rel_path(os.path.join(dirpath, dirname)).rstrip('/')
                        if rel_dir in ignored_dirs:
                            skipped_dir_roots += 1
                        else:
                            kept_dirs.append(dirname)
                    dirnames[:] = kept_dirs
            dirs_scanned += len(dirnames)

            if ignore_filter.enabled and filenames:
                rel_files = [_rel_path(os.path.join(dirpath, fname)) for fname in filenames]
                ignored_files_here = ignore_filter.ignored(rel_files)
            else:
                ignored_files_here = set()

            for fname in filenames:
                fp = os.path.join(dirpath, fname)
                if ignored_files_here and _rel_path(fp) in ignored_files_here:
                    ignored_file_count += 1
                    continue
                visible_paths.append(fp)

            if len(visible_paths) >= next_emit:
                next_emit += 2000
                # Asymptotic 0→1 ramp: the bar advances with files found but
                # never reaches the top of the scan window before the walk ends.
                frac = len(visible_paths) / (len(visible_paths) + 8000)
                _cb(
                    _stage_pct('scan', frac),
                    f'Scanning files… {len(visible_paths):,} found',
                    stage='scan',
                )

        source_paths = []
        for fp in visible_paths:
            ext = Path(fp).suffix.lower()
            if ext in SCAN_EXT and ext not in SKIP_EXT:
                source_paths.append(fp)
        return visible_paths, source_paths, ignored_file_count, dirs_scanned, skipped_dir_roots

    def _collect_project_files_git():
        """Fast path: enumerate non-ignored files with a SINGLE `git ls-files`.

        The os.walk path above spawns one `git check-ignore` subprocess PER
        directory — thousands of process launches on a big repo (≈40 ms each on
        Windows), which dominated wall-clock. `git ls-files` lets git's C core
        walk the tree and apply .gitignore once, in one subprocess. We still
        apply skip_dirs (node_modules/build/…) on top, since those are VizCode's
        own skips that may not be in .gitignore. Raises _GitIgnoreFilterError on
        any git failure so the caller falls back to the os.walk path.
        """
        try:
            proc = subprocess.run(
                ['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
                cwd=root,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=120,
            )
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError) as exc:
            raise _GitIgnoreFilterError(str(exc)) from exc
        if proc.returncode != 0:
            raise _GitIgnoreFilterError(
                proc.stderr.decode('utf-8', errors='replace') if proc.stderr else 'git ls-files failed'
            )
        rels = proc.stdout.decode('utf-8', errors='surrogateescape').split('\0')

        visible_paths = []
        skipped_by_dir = 0
        dir_set = set()
        total_seen = 0
        next_emit = 2000
        for rel in rels:
            if not rel:
                continue
            total_seen += 1
            parts = rel.split('/')
            # Drop anything whose directory chain hits a skip_dirs name.
            if any(seg in skip_dirs for seg in parts[:-1]):
                skipped_by_dir += 1
                continue
            visible_paths.append(os.path.join(root, *parts))
            if len(parts) > 1:
                dir_set.add('/'.join(parts[:-1]))
            if len(visible_paths) >= next_emit:
                next_emit += 2000
                frac = len(visible_paths) / (len(visible_paths) + 8000)
                _cb(
                    _stage_pct('scan', frac),
                    f'Scanning files… {len(visible_paths):,} found',
                    stage='scan',
                )

        source_paths = []
        for fp in visible_paths:
            ext = Path(fp).suffix.lower()
            if ext in SCAN_EXT and ext not in SKIP_EXT:
                source_paths.append(fp)

        # ignored_files stat = count of .gitignore'd files (matches the old
        # per-file check-ignore semantics). One cheap extra subprocess; cosmetic,
        # so any failure just yields 0.
        ignored_file_count = 0
        try:
            iproc = subprocess.run(
                ['git', 'ls-files', '--others', '--ignored', '--exclude-standard', '-z'],
                cwd=root,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=60,
            )
            if iproc.returncode == 0:
                ignored_file_count = sum(
                    1 for x in iproc.stdout.decode('utf-8', errors='surrogateescape').split('\0') if x
                )
        except (FileNotFoundError, subprocess.TimeoutExpired, OSError):
            pass

        # skipped_dir_roots unknown in the git path → 0 (cosmetic).
        return visible_paths, source_paths, ignored_file_count, len(dir_set), 0

    ignore_filter = _build_git_ignore_filter(root)
    collected = None
    if ignore_filter.enabled:
        # Git repo, root not itself ignored → try the single-subprocess fast path.
        try:
            collected = _collect_project_files_git()
        except _GitIgnoreFilterError:
            collected = None
    if collected is None:
        try:
            collected = _collect_project_files(ignore_filter)
        except _GitIgnoreFilterError:
            ignore_filter = _GitIgnoreFilter(root, enabled=False)
            collected = _collect_project_files(ignore_filter)
    visible_file_paths, all_files, ignored_files, total_dirs_scanned, skipped_dir_roots = collected

    # "Project files" = everything we actually walked (skip/ignored dir contents
    # are intentionally excluded — we no longer descend them). total_dirs_skipped
    # is derived downstream as total_project_dirs - total_dirs_scanned, which
    # equals the skipped subtree-root count.
    total_project_files = len(visible_file_paths)
    total_project_dirs = total_dirs_scanned + skipped_dir_roots

    total = len(all_files)
    _cb(
        _stage_pct('scan', 1.0),
        f'Found {total_project_files} project files ({total} source files)',
        stage='scan',
        total_files=total,
        project_total_files=total_project_files,
        project_processed_files=0,
        source_files_total=total,
    )

    # ── Project type detection ────────────────────────────────────────────────
    _cb(
        _stage_pct('detect', 0.0),
        'Detecting project type...',
        stage='detect',
        total_files=total,
        project_total_files=total_project_files,
        project_processed_files=0,
        source_files_total=total,
    )
    ext_counts: dict = defaultdict(int)
    for fp in all_files:
        ext_counts[Path(fp).suffix.lower()] += 1

    project_type = {'key': 'c_cpp', 'name': 'C / C++', 'emoji': '⚙️', 'badge_color': '#3b82f6', 'accent': '#60a5fa'}
    if _PARSERS_LOADED:
        project_type = detect_project_type(dict(ext_counts))
        banner = fmt_detection_banner(project_type)
        for line in banner:
            _console_print(line)
        _cb(
            _stage_pct('detect', 1.0),
            f'{project_type["emoji"]}  Detected: {project_type["name"]} project',
            stage='detect',
            project_type=project_type,
            total_files=total,
            project_total_files=total_project_files,
            project_processed_files=0,
            source_files_total=total,
        )

    file_meta   = {}  # rel_path → {label, ext, size, module, file_type, bios_meta}
    file_incs   = {}  # rel_path → [ref strings]
    file_defs   = {}  # rel_path → [{label, is_efiapi, is_static}]
    file_calls  = {}  # rel_path → [call names]
    file_extra  = {}  # rel_path → bios_extra dict (for .inf/.sdl/.cif etc.)
    file_symdefs = {} # rel_path → [{kind, name, line, end_line, bases, parent, is_public}]

    file_func_calls = {}

    # ── Open per-file parse cache ─────────────────────────────────────────────
    _memo = parse_memo.open_memo(Path(root))

    # ── Phase 1: read + hash every file IN PARALLEL, then memo-lookup single-
    # threaded so the memo dict keeps a single owner. Reads are I/O-bound and
    # SHA-256 releases the GIL, so a thread pool overlaps the disk waits that
    # previously ran as a serial pre-pass scaling with repo size (and blocked
    # the parse pool from starting). Lookups/writes stay on the main thread. ──
    pending = []           # files needing a parse
    cached_hits = {}       # fp → 7-tuple from memo
    pending_hashes = {}    # fp → (file_sha, p_sha) so we can record_entry later

    def _read_and_hash(fp):
        """Thread worker: read + hash one file. Returns (fp, file_sha), or
        (fp, None) when the read fails. Pure/stateless → thread-safe."""
        try:
            data = Path(fp).read_bytes()
        except Exception:
            return (fp, None)
        return (fp, parse_memo.digest_bytes(data))

    # I/O-bound → oversubscribe relative to cores, capped so we don't open an
    # unbounded number of file handles at once on huge repos.
    _io_workers = min(32, max(4, (os.cpu_count() or 2) * 4))
    with concurrent.futures.ThreadPoolExecutor(max_workers=_io_workers) as _io_pool:
        for i, (fp, file_sha) in enumerate(_io_pool.map(_read_and_hash, all_files)):
            rel = os.path.relpath(fp, root).replace('\\', '/')
            if file_sha is None:
                pending.append(fp)
                pending_hashes[fp] = ('', '')
            else:
                ext = Path(fp).suffix.lower()
                parser_fn = _get_parser_fn(ext)
                p_sha = _parser_fingerprints.get(parser_fn)
                if p_sha is None:
                    p_sha = parse_memo.parser_fingerprint(parser_fn)
                    _parser_fingerprints[parser_fn] = p_sha
                hit = parse_memo.lookup_entry(_memo, rel, file_sha, p_sha)
                if hit is not None:
                    cached_hits[fp] = hit
                else:
                    pending.append(fp)
                    pending_hashes[fp] = (file_sha, p_sha)
            if (i + 1) % 20 == 0 or (i + 1) == total:
                # analyzed_files counts every file checked (hit OR miss) so the
                # TUI gets a steady ramp during lookup. Phase-2 emissions may
                # report smaller numbers (cached + parsed-so-far), but the TUI
                # tracks monotonic-max for real_analyzed so this never regresses.
                checked = i + 1
                pct = _stage_pct('analysis', (checked / total) if total else 1.0, ease_power=0.72)
                _cb(
                    pct,
                    f'{checked}/{total} source files analyzed',
                    stage='analysis',
                    analyzed_files=checked,
                    total_files=total,
                    project_total_files=total_project_files,
                    project_processed_files=checked,
                    source_files_total=total,
                )

    # ── Phase 2: parse pending files (parallel when worth it) ────────────────
    parsed_results = {}    # fp → 7-tuple
    PARSE_PARALLEL_THRESHOLD = 100
    _workers_env = os.environ.get('VIZCODE_PARSE_WORKERS')
    # Parsing is CPU-bound → use all cores but one (headroom for the main
    # process + OS). Previously capped at 8, which idled cores on 16/32-core
    # machines. Override with VIZCODE_PARSE_WORKERS.
    _default_workers = max(1, (os.cpu_count() or 2) - 1)
    try:
        _max_workers = int(_workers_env) if _workers_env else _default_workers
    except ValueError:
        _max_workers = _default_workers
    use_parallel = len(pending) >= PARSE_PARALLEL_THRESHOLD and _max_workers > 1
    cached_count = len(cached_hits)

    def _emit_parse_progress(done_in_phase: int) -> None:
        done_total = cached_count + done_in_phase
        pct = _stage_pct('analysis', (done_total / total) if total else 1.0, ease_power=0.72)
        _cb(
            pct,
            f'{done_total}/{total} source files analyzed',
            stage='analysis',
            analyzed_files=done_total,
            total_files=total,
            project_total_files=total_project_files,
            project_processed_files=done_total,
            source_files_total=total,
        )

    if pending:
        if use_parallel:
            chunksize = max(1, len(pending) // (_max_workers * 4))
            with concurrent.futures.ProcessPoolExecutor(max_workers=_max_workers) as pool:
                for i, out in enumerate(pool.map(
                    _parse_one_worker,
                    ((fp, root) for fp in pending),
                    chunksize=chunksize,
                )):
                    fp, result, file_sha, p_sha, ext_w = out
                    parsed_results[fp] = result
                    if file_sha and p_sha:
                        pending_hashes[fp] = (file_sha, p_sha)
                    if (i + 1) % 20 == 0 or (i + 1) == len(pending):
                        _emit_parse_progress(i + 1)
        else:
            for i, fp in enumerate(pending):
                fp_path = Path(fp)
                ext_s = fp_path.suffix.lower()
                try:
                    file_bytes = fp_path.read_bytes()
                    parsed_results[fp] = _compute_parse_result(file_bytes, ext_s)
                except Exception:
                    parsed_results[fp] = ([], [], [], {'loc': {'code': 0, 'comment': 0, 'blank': 0}}, [], [], None)
                if (i + 1) % 20 == 0 or (i + 1) == len(pending):
                    _emit_parse_progress(i + 1)

    # ── Phase 3: merge into file_* dicts; record new entries into memo ───────
    for fp in all_files:
        rel = os.path.relpath(fp, root).replace('\\', '/')
        if fp in cached_hits:
            _scanned = cached_hits[fp]
        else:
            _scanned = parsed_results.get(fp, ([], [], [], None, [], [], None))
            file_sha, p_sha = pending_hashes.get(fp, ('', ''))
            if file_sha and p_sha:
                try:
                    parse_memo.record_entry(_memo, rel, file_sha, p_sha, _scanned)
                except Exception:
                    pass
        inc, defs, calls, extra, func_calls_by_func, sym_defs = _scanned[:6]
        parse_diag = _scanned[6] if len(_scanned) > 6 else None
        ext = Path(fp).suffix.lower()
        bios_meta = {}
        if extra and 'meta' in extra:
            bios_meta = extra['meta']
        loc_meta = (extra or {}).get('loc') if isinstance(extra, dict) else None
        if not isinstance(loc_meta, dict):
            loc_meta = {'code': 0, 'comment': 0, 'blank': 0}
        file_meta[rel] = {
            'label':     os.path.basename(fp),
            'ext':       ext,
            'size':      os.path.getsize(fp),
            'loc':       loc_meta,
            'module':    get_module(rel),
            'file_type': FILE_TYPE_MAP.get(ext, 'other'),
            'bios_meta': bios_meta,
            'parse_error': (parse_diag or {}).get('file_error') if isinstance(parse_diag, dict) else None,
        }
        # ── Security scan (regex-based; pure stdlib, silent-fail per file) ───
        if _SECURITY_RULES:
            try:
                sec_src = Path(fp).read_text(encoding='utf-8', errors='replace')
                file_meta[rel]['security_issues'] = security_scanner.scan_file(
                    sec_src, ext, rel, _SECURITY_RULES,
                )
            except Exception:
                file_meta[rel]['security_issues'] = []
        file_incs[rel]  = inc
        file_defs[rel]  = defs
        file_calls[rel] = calls
        file_func_calls[rel] = func_calls_by_func
        file_extra[rel]  = extra
        file_symdefs[rel] = sym_defs

    # ── Persist parse cache (only the parser-output layer is stored) ──────────
    try:
        parse_memo.flush_memo(_memo, Path(root))
    except Exception:
        pass  # cache write failures are non-fatal

    # ── Phase X: Collect ALL other (non-source) files for the UI ─────────────────
    # Other files are not analysed for deps but shown in UI for full codebase picture.
    _cb(
        _stage_pct('node', 0.0),
        'Scanning other files...',
        stage='node',
        analyzed_files=total,
        total_files=total,
        project_total_files=total_project_files,
        project_processed_files=total,
        source_files_total=total,
    )
    other_files_all: dict = {}
    _oth_idx = len(file_meta)

    other_files_seen = 0
    other_scan_total = max(total_project_files - total, 1)

    for _fp in visible_file_paths:
        _rel = os.path.relpath(_fp, root).replace('\\', '/')
        if _rel in file_meta:
            continue
        _fn = os.path.basename(_fp)
        _ext = Path(_fn).suffix.lower()
        try:
            _sz = os.path.getsize(_fp)
        except OSError:
            _sz = 0
        _ft = 'binary' if _ext in SKIP_EXT else 'other'
        other_files_all[_rel] = {
            'id':        _oth_idx,
            'label':     _fn,
            'path':      _rel,
            'ext':       _ext,
            'size':      _sz,
            'module':    get_module(_rel),
            'file_type': _ft,
        }
        _oth_idx += 1
        other_files_seen += 1
        if other_files_seen % 100 == 0:
            _cb(
                _stage_pct('node', other_files_seen / other_scan_total, ease_power=0.9),
                'Scanning other files...',
                stage='node',
                analyzed_files=total,
                total_files=total,
                project_total_files=total_project_files,
                project_processed_files=min(total + other_files_seen, total_project_files),
                source_files_total=total,
            )

    total_other = len(other_files_all)
    total_binary = sum(1 for m in other_files_all.values() if m['file_type'] == 'binary')
    total_visible_files = total + total_other
    total_files_skipped = max(0, total_project_files - total_visible_files)
    total_dirs_skipped = max(0, total_project_dirs - total_dirs_scanned)

    # Group by module
    other_files_by_module: dict = defaultdict(list)
    for _rel, _meta in other_files_all.items():
        other_files_by_module[_meta['module']].append({
            k: _meta[k] for k in ('id','label','path','ext','size','file_type')
        })

    _cb(
        _stage_pct('node', 0.82),
        'Building module index...',
        stage='node',
        analyzed_files=total,
        total_files=total,
        project_total_files=total_project_files,
        project_processed_files=total_visible_files,
        source_files_total=total,
    )

    all_modules = sorted(set(m['module'] for m in file_meta.values()))
    module_color = {}
    fixed = {}
    color_idx = 0
    for mod in all_modules:
        if mod in fixed:
            module_color[mod] = fixed[mod]
        else:
            module_color[mod] = MODULE_COLORS[color_idx % len(MODULE_COLORS)]
            color_idx += 1

    # Build name-to-path index (basename, full rel path, and path stem)
    _cb(
        _stage_pct('node', 0.9),
        'Building file index...',
        stage='node',
        analyzed_files=total,
        total_files=total,
        project_total_files=total_project_files,
        project_processed_files=total_visible_files,
        source_files_total=total,
    )
    label_to_paths  = defaultdict(list)  # basename → [rel_path]
    stem_to_paths   = defaultdict(list)  # stem (no ext) → [rel_path]
    for rel in file_meta:
        label_to_paths[os.path.basename(rel)].append(rel)
        stem = Path(rel).stem.lower()
        stem_to_paths[stem].append(rel)

    rel_to_id = {rel: i for i, rel in enumerate(file_meta)}

    # ── Global-symbol index (non-ESM JS/TS) ─────────────────────────────────
    # Some JS/TS codebases share a single global namespace via ordered <script>
    # tags instead of import/require (e.g. window.X = ...). They emit no import
    # refs, so the import-edge pass below leaves them edgeless. Index each JS/TS
    # file's top-level definitions + window./globalThis. exports so a file that
    # *uses* a global can be linked to the file that *defines* it.
    _JS_EXTS = {'.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx'}
    global_def_index = defaultdict(set)  # global name → set(defining rel paths)
    for rel, meta in file_meta.items():
        if meta['ext'] not in _JS_EXTS:
            continue
        for sym in (file_symdefs.get(rel) or []):
            if sym.get('parent') is None and sym.get('kind') in (
                'function', 'class', 'interface', 'enum', 'namespace'
            ):
                global_def_index[sym['name']].add(rel)
        _fx = file_extra.get(rel)
        if isinstance(_fx, dict):
            for name in _fx.get('global_defs', []):
                global_def_index[name].add(rel)

    # Pre-build CamelCase → snake_case lookup for Ruby/Python convention matching
    _re_camel = re.compile(r'(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])')

    def resolve_ref(ref: str, src_dir: str = '') -> list:
        """Try to resolve a reference string to known rel_paths."""
        if src_dir and ('/' in ref or '\\' in ref or '.' in ref):
            candidate = os.path.normpath(os.path.join(src_dir, ref)).replace('\\', '/')
            if candidate in file_meta:
                return [candidate]
        # 1. Try exact basename first
        base = os.path.basename(ref)
        if base in label_to_paths:
            return label_to_paths[base]
        # 2. Try stem match (case-insensitive)
        stem = Path(ref).stem.lower()
        if stem in stem_to_paths:
            return stem_to_paths[stem]
        # 3. Try relative path from source directory
        if src_dir and ('/' in ref or '\\' in ref or '.' in ref):
            # Try without extension
            cand_stem = Path(candidate).stem.lower()
            if cand_stem in stem_to_paths:
                return stem_to_paths[cand_stem]
        # 4. CamelCase → snake_case fallback (Ruby, Python conventions)
        #    e.g. UserController → user_controller
        if any(c.isupper() for c in stem) and '_' not in stem:
            snake = _re_camel.sub('_', stem).lower()
            if snake != stem and snake in stem_to_paths:
                return stem_to_paths[snake]
        return []

    # ── Phase B: Build GUID name → .dec file index ───────────────────────────
    # .dec files declare: gXxxGuid  =  { ... }   under [Guids]/[Ppis]/[Protocols]
    # We parse these names so .inf [Guids/Ppis] references can link to their .dec
    _cb(
        _stage_pct('node', 0.96),
        'Building GUID index...',
        stage='node',
        analyzed_files=total,
        total_files=total,
        project_total_files=total_project_files,
        project_processed_files=total_visible_files,
        source_files_total=total,
    )
    guid_name_to_dec = defaultdict(list)   # guid_var_name (lower) → [dec_rel_path]

    RE_GUID_DECL = re.compile(r'\b(g[A-Za-z_]\w+Guid|g[A-Za-z_]\w+Ppi|g[A-Za-z_]\w+Protocol)\b')

    for rel, extra in file_extra.items():
        if file_meta[rel]['ext'] != '.dec' or extra is None:
            continue
        src_text = ''
        try:
            src_text = Path(os.path.join(root, rel)).read_text(encoding='utf-8', errors='replace')
        except Exception:
            pass
        for m in RE_GUID_DECL.finditer(src_text):
            name_lower = m.group(1).lower()
            if rel not in guid_name_to_dec[name_lower]:
                guid_name_to_dec[name_lower].append(rel)
        # Also use names from the already-parsed extra data
        for name in extra.get('guids', []) + extra.get('ppis', []) + extra.get('protocols', []):
            name_lower = name.strip().lower()
            if name_lower and rel not in guid_name_to_dec[name_lower]:
                guid_name_to_dec[name_lower].append(rel)

    # Build per-module file lists + typed edges
    files_by_module      = defaultdict(list)
    file_edges_by_module = defaultdict(list)

    for rel, meta in file_meta.items():
        fid  = rel_to_id[rel]
        mod  = meta['module']
        files_by_module[mod].append({
            'id':         fid,
            'label':      meta['label'],
            'path':       rel,
            'ext':        meta['ext'],
            'size':       meta['size'],
            'loc':        meta.get('loc') or {'code': 0, 'comment': 0, 'blank': 0},
            'func_count': len(file_defs.get(rel, [])),
            'file_type':  meta['file_type'],
            'bios_meta':  meta['bios_meta'],
        })

    _cb(
        _stage_pct('edge', 0.15),
        'Resolving file edges...',
        stage='edge',
        analyzed_files=total,
        total_files=total,
        project_total_files=total_project_files,
        project_processed_files=total_visible_files,
        source_files_total=total,
        module_count=len(all_modules),
        other_files=len(other_files_all),
    )
    module_edge_counts = defaultdict(int)
    seen_file_edges    = set()

    def add_edge(src_rel, tgt_rel, edge_type, via=None, subtype=None,
                 origin=None, confidence=None, line=None):
        src_id  = rel_to_id[src_rel]
        tgt_id  = rel_to_id[tgt_rel]
        src_mod = file_meta[src_rel]['module']
        tgt_mod = file_meta[tgt_rel]['module']
        if src_id == tgt_id:
            return
        if src_mod != tgt_mod:
            key = (min(src_mod, tgt_mod), max(src_mod, tgt_mod))
            module_edge_counts[key] += 1
        ekey = (src_id, tgt_id, edge_type, subtype or '')
        if ekey not in seen_file_edges:
            seen_file_edges.add(ekey)
            edge = {'s': src_id, 't': tgt_id, 'type': edge_type}
            # `via` = the symbol that links the two files (global-script JS, where
            # there is no import line to highlight — the code panel highlights the
            # symbol-use line instead).
            if via:
                edge['via'] = via
            if subtype:
                edge['subtype'] = subtype
            if origin:
                edge['origin'] = origin
            if confidence is not None:
                edge['confidence'] = confidence
            if line:
                edge['line'] = line
            file_edges_by_module[src_mod].append(edge)

    for src_rel, extra in file_extra.items():
        ext = file_meta[src_rel]['ext']
        src_dir = str(Path(src_rel).parent)

        if ext in ('.c', '.cpp', '.cc', '.cxx', '.h', '.hpp', '.hh', '.hxx'):
            # Standard #include edges
            for inc in file_incs.get(src_rel, []):
                for tgt in resolve_ref(inc, src_dir):
                    add_edge(src_rel, tgt, 'include')

        elif ext == '.asm' or ext in ('.s', '.S', '.nasm'):
            for inc in file_incs.get(src_rel, []):
                for tgt in resolve_ref(inc, src_dir):
                    add_edge(src_rel, tgt, 'include')

        # ── Universal import edges (all analysed languages) ──────────────────
        elif ext in (
            # Python
            '.py',
            # JavaScript / TypeScript
            '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx',
            # Go
            '.go',
            # JVM / Mobile
            '.java', '.kt', '.kts', '.scala', '.groovy',
            '.dart', '.swift', '.m', '.mm',
            # .NET
            '.cs', '.vb', '.fs', '.fsx',
            # Scripting
            '.rb', '.php', '.pl', '.pm', '.lua',
            '.sh', '.bash', '.zsh', '.r', '.R', '.jl',
            # Systems
            '.rs', '.zig', '.d', '.nim', '.cr',
            # Functional
            '.ex', '.exs', '.erl', '.hrl',
            '.clj', '.cljs', '.hs', '.ml', '.mli', '.elm',
            # Data / Schema
            '.sql', '.graphql', '.gql', '.proto',
            # Web / Config / Windows scripting
            '.html', '.htm', '.xhtml', '.yaml', '.yml', '.toml',
            '.ps1', '.psm1', '.psd1',
            # Vendor BIOS formats relocated to common_parser (best-effort)
            '.sdl', '.sd', '.cif', '.hfr', '.mak',
        ):
            hinted_targets = set()
            if isinstance(extra, dict):
                for hint in extra.get('edge_hints') or []:
                    if not isinstance(hint, dict):
                        continue
                    ref = (hint.get('target') or hint.get('ref') or hint.get('path')
                           or hint.get('name') or '')
                    if ref:
                        hinted_targets.update(resolve_ref(str(ref), src_dir))
            for imp in file_incs.get(src_rel, []):
                for tgt in resolve_ref(imp, src_dir):
                    if tgt != src_rel and tgt not in hinted_targets:
                        add_edge(src_rel, tgt, 'import')

            # ── Global-symbol fallback (non-ESM JS/TS) ───────────────────────
            # Only when the file emitted no ESM import/require refs — this
            # targets the global-<script> case and keeps real ESM/npm projects
            # free of spurious global-name edges.
            if ext in _JS_EXTS and not file_incs.get(src_rel):
                uses = set(file_calls.get(src_rel, []))
                _fx = file_extra.get(src_rel)
                if isinstance(_fx, dict):
                    uses.update(_fx.get('global_uses', []))
                for name in sorted(uses):
                    if len(name) < 3 or name in _JS_KEYWORDS:
                        continue
                    definers = global_def_index.get(name)
                    # Unambiguous only: skip generic names defined in many files.
                    if not definers or len(definers) != 1:
                        continue
                    tgt = next(iter(definers))
                    if tgt != src_rel:
                        add_edge(src_rel, tgt, 'import', via=name)

        elif ext == '.inf' and extra:
            # [Sources] → .c files
            for src_f in extra.get('sources', []):
                for tgt in resolve_ref(src_f, src_dir):
                    add_edge(src_rel, tgt, 'sources')
            # [Packages] → .dec files
            for pkg in extra.get('packages', []):
                for tgt in resolve_ref(pkg, src_dir):
                    add_edge(src_rel, tgt, 'package')
            # [LibraryClasses] → other .inf (by stem)
            for lib in extra.get('libraries', []):
                for tgt in resolve_ref(lib, src_dir):
                    if tgt != src_rel:
                        add_edge(src_rel, tgt, 'library')
            # [Guids/Ppis/Protocols] → .dec that declares them (Phase B)
            all_symbols = extra.get('guids', []) + extra.get('ppis', []) + extra.get('protocols', [])
            seen_dec = set()
            for sym in all_symbols:
                sym_lower = sym.strip().lower()
                for dec_rel in guid_name_to_dec.get(sym_lower, []):
                    if dec_rel not in seen_dec and dec_rel != src_rel:
                        seen_dec.add(dec_rel)
                        add_edge(src_rel, dec_rel, 'guid_ref')

        elif ext == '.dsc' and extra:
            for comp in extra.get('components', []):
                for tgt in resolve_ref(comp, src_dir):
                    add_edge(src_rel, tgt, 'component')
            # [LibraryClasses] LibName|Instance.inf → library instance .inf
            for lib in extra.get('libraries', []):
                for tgt in resolve_ref(lib, src_dir):
                    if tgt != src_rel:
                        add_edge(src_rel, tgt, 'library')
            # !include other .dsc/.inc fragments
            for inc in extra.get('includes', []):
                for tgt in resolve_ref(inc, src_dir):
                    if tgt != src_rel:
                        add_edge(src_rel, tgt, 'component')

        elif ext == '.fdf' and extra:
            for inf_f in extra.get('infs', []):
                for tgt in resolve_ref(inf_f, src_dir):
                    add_edge(src_rel, tgt, 'component')
            for f in extra.get('files', []) + extra.get('includes', []):
                for tgt in resolve_ref(f, src_dir):
                    if tgt != src_rel:
                        add_edge(src_rel, tgt, 'component')

        # VFR → UNI string-package (str_ref) + header #include edges.
        # (Reachable now that '.vfr' was removed from the generic #include `if`.)
        elif ext == '.vfr' and extra:
            for uni_f in extra.get('uni_includes', []):
                for tgt in resolve_ref(uni_f, src_dir):
                    add_edge(src_rel, tgt, 'str_ref')
            for inc in extra.get('includes', []):
                if Path(inc).suffix.lower() != '.uni':  # .uni handled above
                    for tgt in resolve_ref(inc, src_dir):
                        add_edge(src_rel, tgt, 'include')

        # UNI → UNI #include edges (string-package composition).
        elif ext == '.uni' and extra:
            for inc in extra.get('includes', []):
                for tgt in resolve_ref(inc, src_dir):
                    if tgt != src_rel:
                        add_edge(src_rel, tgt, 'include')

        # ASL → Include edges (reachable now that '.asl' left the generic `if`).
        elif ext == '.asl' and extra:
            for inc in extra.get('includes', []):
                for tgt in resolve_ref(inc, src_dir):
                    add_edge(src_rel, tgt, 'asl_include')

        # Optional parser-provided file-edge hints. Precise parsers can enrich
        # L1 without changing the parser 6-tuple contract.
        if isinstance(extra, dict):
            for hint in extra.get('edge_hints') or []:
                if not isinstance(hint, dict):
                    continue
                edge_type = hint.get('type') or hint.get('edge_type') or 'import'
                if edge_type not in EDGE_TYPES:
                    edge_type = 'import'
                ref = (hint.get('target') or hint.get('ref') or hint.get('path')
                       or hint.get('name') or '')
                if not ref:
                    continue
                for tgt in resolve_ref(str(ref), src_dir):
                    if tgt == src_rel:
                        continue
                    add_edge(
                        src_rel,
                        tgt,
                        edge_type,
                        via=hint.get('via'),
                        subtype=hint.get('subtype'),
                        origin=hint.get('origin') or 'parser',
                        confidence=hint.get('confidence'),
                        line=hint.get('line'),
                    )

    _cb(
        _stage_pct('edge', 0.5),
        'Building function index...',
        stage='edge',
        analyzed_files=total,
        total_files=total,
        project_total_files=total_project_files,
        project_processed_files=total_visible_files,
        source_files_total=total,
        module_count=len(all_modules),
        other_files=len(other_files_all),
        file_edge_count=len(seen_file_edges),
    )
    func_name_to_files = defaultdict(list)  # name → [rel_path, ...]
    for rel, defs in file_defs.items():
        for d in defs:
            func_name_to_files[d['label']].append(rel)

    func_name_to_file = {name: files[0] for name, files in func_name_to_files.items()}
    func_name_ambiguous = sorted(name for name, files in func_name_to_files.items() if len(files) > 1)

    funcs_by_file       = {}
    func_edges_by_file  = {}
    func_calls_by_file  = {}

    _cb(
        _stage_pct('edge', 0.72),
        'Resolving call edges...',
        stage='edge',
        analyzed_files=total,
        total_files=total,
        project_total_files=total_project_files,
        project_processed_files=total_visible_files,
        source_files_total=total,
        module_count=len(all_modules),
        other_files=len(other_files_all),
        file_edge_count=len(seen_file_edges),
    )
    for rel, defs in file_defs.items():
        if not defs:
            continue
        fid_map = {d['label']: i for i, d in enumerate(defs)}
        # Docstrings from parser extra_dict
        _docstrings = {}
        _extra = file_extra.get(rel)
        if _extra and isinstance(_extra, dict):
            _docstrings = _extra.get('docstrings', {})
        funcs_by_file[rel] = [
            {
                'id':        i,
                'label':     d['label'],
                'is_public': not d['is_static'],
                'is_efiapi': d['is_efiapi'],
                **({'doc': _docstrings[d['label']][:200]} if d['label'] in _docstrings else {}),
            }
            for i, d in enumerate(defs)
        ]
        calls_by_func = file_func_calls.get(rel, [])
        if len(calls_by_func) < len(defs):
            calls_by_func = calls_by_func + ([[]] * (len(defs) - len(calls_by_func)))
        elif len(calls_by_func) > len(defs):
            calls_by_func = calls_by_func[:len(defs)]
        func_calls_by_file[rel] = calls_by_func

        edges = []
        seen_edge = set()
        for caller_idx, d in enumerate(defs):
            for callee in calls_by_func[caller_idx]:
                callee_idx = fid_map.get(callee)
                if callee_idx is None:
                    continue
                if callee_idx == caller_idx:
                    continue
                key = (caller_idx, callee_idx)
                if key not in seen_edge:
                    seen_edge.add(key)
                    edges.append({'s': caller_idx, 't': callee_idx,
                                  'p': int(d['is_static']), 'type': 'call'})
        func_edges_by_file[rel] = edges

    resolved_func_edges = sum(len(v) for v in func_edges_by_file.values())

    # ── Phase F: Build Symbol Index ───────────────────────────────────────────
    _cb(
        _stage_pct('finalize', 0.12),
        'Building symbol index...',
        stage='finalize',
        analyzed_files=total,
        total_files=total,
        project_total_files=total_project_files,
        project_processed_files=total_project_files,
        source_files_total=total,
    )
    symbol_index: dict = {}
    symbol_edges: list = []
    _sym_name_to_ids: dict = defaultdict(list)
    _file_sym_key: dict = {}

    file_list = sorted(file_meta.keys())
    for f_idx, rel in enumerate(file_list):
        syms = file_symdefs.get(rel, []) or []
        file_parse_error = file_meta[rel].get('parse_error')
        for s_idx, sym in enumerate(syms):
            sid = f'sym_{f_idx}_{s_idx}'
            symbol_index[sid] = {
                'id':        sid,
                'name':      sym['name'],
                'kind':      sym['kind'],
                'file':      rel,
                'line':      sym.get('line', 0),
                'end_line':  sym.get('end_line', 0),
                'bases':     sym.get('bases', []),
                'parent':    sym.get('parent'),
                'is_public': sym.get('is_public', True),
                'module':    file_meta[rel]['module'],
                # Function signature (args + return annotation) — parsers that
                # don't extract this leave it empty, consumers hide the row.
                'signature': sym.get('signature', ''),
                'docstring': sym.get('doc', ''),
                'decorators': sym.get('decorators', []),
                'is_static': sym.get('is_static', False),
                # Cyclomatic complexity for function-shaped kinds. None when
                # the parser doesn't compute it (e.g. BIOS / common fallback).
                'complexity': sym.get('complexity'),
                # Project type names this symbol references (param/return/field
                # annotations). Drives L3 `type_usage` edges. Empty when the
                # parser doesn't extract type references.
                'type_refs': sym.get('type_refs', []),
                'symbol_edge_hints': sym.get('symbol_edge_hints', []),
                # Flag set when the parser had to fall back (e.g. ast.parse failed).
                # Truthy value is a short diagnostic message; falsy → clean symbol.
                'parse_error': file_parse_error,
            }
            _sym_name_to_ids[sym['name']].append(sid)
            _file_sym_key[(rel, sym['name'])] = sid

    # kind mapping for symbol edge types → A2 unified vocabulary
    _SYMBOL_KIND = {
        'inheritance': 'inherit', 'implements': 'inherit', 'override': 'inherit',
        'mixin_include': 'inherit', 'mixin_extend': 'inherit', 'mixin_prepend': 'inherit',
        'behaviour_impl': 'inherit', 'protocol_impl': 'inherit',
        'call': 'call', 'type_usage': 'type_usage', 'member': 'member',
    }

    _SEMANTIC_SYMBOL_EDGE_TYPES = {
        'mixin_include', 'mixin_extend', 'mixin_prepend',
        'behaviour_impl', 'protocol_impl',
    }

    def _resolve_symbol_ref(source_sym: dict, target_name: str):
        target_name = (target_name or '').split('.')[-1].split('::')[-1]
        if not target_name:
            return None
        tgt = _file_sym_key.get((source_sym.get('file'), target_name))
        if not tgt:
            candidates = _sym_name_to_ids.get(target_name, [])
            tgt = candidates[0] if len(candidates) == 1 else None
        return tgt

    semantic_pairs: set = set()
    for sid, sym in symbol_index.items():
        for hint in sym.get('symbol_edge_hints') or []:
            if not isinstance(hint, dict):
                continue
            edge_type = hint.get('type') or hint.get('edge_type')
            if edge_type not in _SEMANTIC_SYMBOL_EDGE_TYPES:
                continue
            tgt = _resolve_symbol_ref(sym, hint.get('target') or hint.get('name') or '')
            if not tgt or tgt == sid:
                continue
            key = (sid, tgt, edge_type)
            if key in semantic_pairs:
                continue
            semantic_pairs.add(key)
            symbol_edges.append({
                'from': sid,
                'to': tgt,
                'type': edge_type,
                'kind': _SYMBOL_KIND[edge_type],
                'via': hint.get('via'),
                'line': hint.get('line'),
                'confidence': hint.get('confidence'),
            })
    semantic_pair_without_type = {(src, tgt) for src, tgt, _typ in semantic_pairs}

    # Inheritance / implements edges
    for sid, sym in symbol_index.items():
        for base_name in sym.get('bases', []):
            tgt = _resolve_symbol_ref(sym, base_name)
            if tgt and tgt != sid:
                tgt_kind = symbol_index[tgt].get('kind', '') if tgt in symbol_index else ''
                edge_type = 'implements' if tgt_kind in ('interface', 'trait', 'protocol', 'mixin') else 'inheritance'
                if edge_type == 'implements' and (sid, tgt) in semantic_pair_without_type:
                    continue
                symbol_edges.append({'from': sid, 'to': tgt, 'type': edge_type, 'kind': _SYMBOL_KIND[edge_type]})

    # Override edges (child method overrides parent class method of same name)
    _class_methods: dict = defaultdict(set)
    for sid, sym in symbol_index.items():
        if sym.get('kind') in ('method', 'function') and sym.get('parent'):
            _class_methods[(sym['file'], sym['parent'])].add(sym['name'])
    for sid, sym in symbol_index.items():
        if sym.get('kind') not in ('method', 'function') or not sym.get('parent'):
            continue
        parent_class_id = _file_sym_key.get((sym['file'], sym['parent']))
        if parent_class_id and symbol_index.get(parent_class_id, {}).get('kind') not in ('class', 'struct', 'interface', 'enum', 'record', 'trait', 'typedef'):
            parent_class_id = None
        if not parent_class_id:
            for candidate_id in _sym_name_to_ids.get(sym['parent'], []):
                c = symbol_index.get(candidate_id, {})
                if c.get('file') == sym['file'] and c.get('kind') in ('class', 'struct', 'interface', 'enum', 'record', 'trait', 'typedef'):
                    parent_class_id = candidate_id
                    break
        if not parent_class_id:
            continue
        parent_sym = symbol_index.get(parent_class_id, {})
        for base_name in parent_sym.get('bases', []):
            base_id = _file_sym_key.get((sym['file'], base_name))
            if not base_id:
                candidates = _sym_name_to_ids.get(base_name, [])
                base_id = candidates[0] if len(candidates) == 1 else None
            if not base_id:
                continue
            base_method_id = _file_sym_key.get((symbol_index[base_id]['file'], sym['name'])) if base_id in symbol_index else None
            if not base_method_id:
                for candidate_id in _sym_name_to_ids.get(sym['name'], []):
                    c = symbol_index.get(candidate_id, {})
                    if c.get('parent') == base_name and c.get('kind') in ('method', 'function'):
                        base_method_id = candidate_id
                        break
            if base_method_id and base_method_id != sid:
                symbol_edges.append({'from': sid, 'to': base_method_id, 'type': 'override', 'kind': 'inherit'})

    # Type-usage edges (a symbol references a project TYPE in its signature/fields).
    # Precision-first: resolve only to type-kind symbols, same-file first, else a
    # single unambiguous project definition. Parsers pre-filter builtins/short names.
    _TYPE_KINDS = {
        'class', 'struct', 'interface', 'enum', 'record', 'trait', 'typedef',
        'type', 'input', 'union', 'scalar', 'message', 'table', 'view',
        'protocol', 'mixin', 'object', 'extension', 'annotation', 'module',
        'abstract',
    }
    _type_name_to_ids: dict = defaultdict(list)
    for _tid, _tsym in symbol_index.items():
        if _tsym.get('kind') in _TYPE_KINDS:
            _type_name_to_ids[_tsym['name']].append(_tid)
    for sid, sym in symbol_index.items():
        seen_type: set = set()
        for type_name in sym.get('type_refs') or []:
            if not type_name or len(type_name) < 3:
                continue
            # Same-file definition first, but only if it is actually a type.
            tgt = _file_sym_key.get((sym['file'], type_name))
            if tgt is not None and symbol_index.get(tgt, {}).get('kind') not in _TYPE_KINDS:
                tgt = None
            if tgt is None:
                candidates = _type_name_to_ids.get(type_name, [])
                if len(candidates) == 1:
                    tgt = candidates[0]
            if tgt and tgt != sid and tgt not in seen_type:
                seen_type.add(tgt)
                symbol_edges.append({'from': sid, 'to': tgt, 'type': 'type_usage', 'kind': 'type_usage'})

    # Call edges (cross-file using func_name lookup)
    for rel, func_list in funcs_by_file.items():
        calls_by_func = file_func_calls.get(rel, [])
        for caller_idx, func in enumerate(func_list):
            caller_id = _file_sym_key.get((rel, func['label']))
            if not caller_id:
                continue
            callee_names = calls_by_func[caller_idx] if caller_idx < len(calls_by_func) else []
            seen_callee: set = set()
            for callee_name in callee_names:
                callee_id = (_file_sym_key.get((rel, callee_name))
                             or (_sym_name_to_ids[callee_name][0]
                                 if _sym_name_to_ids[callee_name] else None))
                if callee_id and callee_id != caller_id and callee_id not in seen_callee:
                    seen_callee.add(callee_id)
                    symbol_edges.append({'from': caller_id, 'to': callee_id, 'type': 'call', 'kind': 'call'})

    # ── Phase G: Community Detection (Louvain) ─────────────────────────────────
    communities: dict = {}
    community_stats: list = []
    graph_modularity: float = 0.0
    try:
        adj: dict = defaultdict(lambda: defaultdict(float))
        total_weight = 0.0
        for e in symbol_edges:
            a, b = e['from'], e['to']
            if a in symbol_index and b in symbol_index and a != b:
                adj[a][b] += 1.0
                adj[b][a] += 1.0
                total_weight += 1.0
        nodes_list = [sid for sid in adj]
        if len(nodes_list) >= 3 and total_weight > 0:
            m2 = total_weight * 2.0
            node_comm = {n: i for i, n in enumerate(nodes_list)}
            node_degree = {n: sum(adj[n].values()) for n in nodes_list}
            comm_inner = defaultdict(float)
            comm_total = defaultdict(float)
            for n in nodes_list:
                c = node_comm[n]
                comm_total[c] = node_degree[n]
                for nb, w in adj[n].items():
                    if node_comm[nb] == c:
                        comm_inner[c] += w
            for _iteration in range(20):
                moved = False
                for n in nodes_list:
                    old_c = node_comm[n]
                    ki = node_degree[n]
                    neighbor_comms: dict = defaultdict(float)
                    for nb, w in adj[n].items():
                        neighbor_comms[node_comm[nb]] += w
                    ki_in_old = neighbor_comms.get(old_c, 0.0)
                    best_gain = 0.0
                    best_c = old_c
                    remove_cost = ki_in_old / m2 - (comm_total[old_c] * ki) / (m2 * m2)
                    for c, ki_in_c in neighbor_comms.items():
                        if c == old_c:
                            continue
                        gain = (ki_in_c / m2 - (comm_total[c] * ki) / (m2 * m2)) - remove_cost
                        if gain > best_gain:
                            best_gain = gain
                            best_c = c
                    if best_c != old_c:
                        comm_inner[old_c] -= 2.0 * ki_in_old
                        comm_total[old_c] -= ki
                        node_comm[n] = best_c
                        comm_inner[best_c] += 2.0 * neighbor_comms[best_c]
                        comm_total[best_c] += ki
                        moved = True
                if not moved:
                    break
            unique_comms = sorted(set(node_comm.values()))
            remap = {old: new for new, old in enumerate(unique_comms)}
            communities = {n: remap[c] for n, c in node_comm.items()}
            comm_members: dict = defaultdict(list)
            for n, c in communities.items():
                comm_members[c].append(n)
            for c_idx, c_id in enumerate(sorted(comm_members.keys())):
                members = comm_members[c_id]
                if len(members) < 3:
                    for n in members:
                        del communities[n]
                    continue
                top = sorted(members, key=lambda n: node_degree.get(n, 0), reverse=True)[:3]
                top_names = [symbol_index[n]['name'] for n in top if n in symbol_index]
                community_stats.append({
                    'id': c_id,
                    'size': len(members),
                    'label': ' / '.join(top_names[:2]) if top_names else f'Community {c_id}',
                })

            # Modularity Q — feeds the cohesion sub-score in code_health.
            if m2 > 0:
                graph_modularity = sum(
                    (comm_inner[c] / m2) - (comm_total[c] / m2) ** 2
                    for c in set(node_comm.values())
                )
    except Exception:
        pass

    # ── C3: Map each file → its dominant community ────────────────────────────
    file_community: dict = {}
    try:
        _votes: dict = defaultdict(list)
        for _sid, _cid in communities.items():
            if _sid in symbol_index:
                _votes[symbol_index[_sid]['file']].append(_cid)
        file_community = {
            _f: Counter(_vs).most_common(1)[0][0]
            for _f, _vs in _votes.items() if _vs
        }
    except Exception:
        pass

    _cb(
        _stage_pct('finalize', 0.72),
        'Assembling output...',
        stage='finalize',
        analyzed_files=total,
        total_files=total,
        project_total_files=total_project_files,
        project_processed_files=total_project_files,
        source_files_total=total,
        module_count=len(all_modules),
        other_files=len(other_files_all),
        file_edge_count=len(seen_file_edges),
        func_edge_count=resolved_func_edges,
        function_count=sum(len(v) for v in file_defs.values()),
    )
    modules = [
        {
            'id':          mod,
            'label':       mod,
            'color':       module_color[mod],
            'file_count':  len(files_by_module[mod]),
            'func_count':  sum(len(file_defs.get(f['path'], []))
                               for f in files_by_module[mod]),
            'other_count': len(other_files_by_module.get(mod, [])),
        }
        for mod in all_modules
    ]
    module_edges = [
        {'s': a, 't': b, 'weight': w, 'kind': 'import'}
        for (a, b), w in module_edge_counts.items()
    ]

    total_funcs = sum(len(v) for v in file_defs.values())
    total_calls = sum(len(v) for v in file_calls.values())

    total_all_files = total_project_files


    # Count by file type for stats
    type_counts = defaultdict(int)
    for meta in file_meta.values():
        type_counts[meta['file_type']] += 1

    file_to_module = {rel: meta['module'] for rel, meta in file_meta.items()}

    # ─── Advanced Health Metrics (Dashboard enhancements) ────────────────────
    # Build ID to path mapping for edge analysis
    id_to_rel = {i: rel for rel, i in rel_to_id.items()}
    
    # Coupling Hotspots: files that are imported the most
    file_import_counts = defaultdict(int)
    for edges_list in file_edges_by_module.values():
        for edge in edges_list:
            tgt_path = id_to_rel.get(edge['t'])
            if tgt_path:
                file_import_counts[tgt_path] += 1
    
    top_imported_files = sorted(
        file_import_counts.items(),
        key=lambda x: x[1],
        reverse=True
    )[:50]
    
    # God File candidates: files calling the most functions
    file_call_counts = defaultdict(int)
    for rel, calls in file_calls.items():
        file_call_counts[rel] = len(calls)
    
    top_caller_files = sorted(
        file_call_counts.items(),
        key=lambda x: x[1],
        reverse=True
    )[:50]
    
    # Dead Code Detection
    #
    # Two correctness guards so the metric is trustworthy rather than noise:
    #   1. Skip test files and dunder methods — their functions are invoked by
    #      the test runner / language runtime, never called by literal name, so
    #      a naive "defined but never called" check flags every one as dead.
    #   2. Resolve a call to EVERY file that defines that name (func_name_to_files),
    #      not just the first (func_name_to_file == files[0]). Otherwise a name
    #      shared across files — extremely common, e.g. the ~40 parsers each
    #      defining similarly-named helpers — marks all but one file's copy dead
    #      even when it is genuinely used via dispatch.
    def _is_test_file(rel_path):
        p = rel_path.replace('\\', '/').lower()
        parts = p.split('/')
        if any(seg in ('test', 'tests', '__tests__', 'spec', 'specs')
               for seg in parts[:-1]):
            return True
        base = parts[-1]
        name = base.rsplit('.', 1)[0]
        if name == 'test' or name.startswith(('test_', 'test-')):
            return True
        if name.endswith(('_test', '_spec', '.test', '.spec')):
            return True
        return '.test.' in base or '.spec.' in base or base == 'conftest.py'

    def _is_implicit_entry(name):
        # Dunder methods (__init__, __repr__, …) are called by the runtime,
        # never by literal name.
        return len(name) > 4 and name.startswith('__') and name.endswith('__')

    all_defined_funcs = set()
    for rel, defs in file_defs.items():
        if _is_test_file(rel):
            continue
        for d in defs:
            if _is_implicit_entry(d['label']):
                continue
            all_defined_funcs.add((rel, d['label']))

    all_called_funcs = set()
    for rel, calls in file_calls.items():
        for call in calls:
            for target_file in func_name_to_files.get(call, ()):
                all_called_funcs.add((target_file, call))

    uncalled_funcs = all_defined_funcs - all_called_funcs
    uncalled_func_count = len(uncalled_funcs)
    dead_code_symbols = [
        {'file': f, 'name': n}
        for f, n in sorted(uncalled_funcs, key=lambda item: (item[0], item[1]))
    ]
    
    # Files never imported.
    # `code_file_paths` drops pure data/doc/config files (see _NON_CODE_FILE_TYPES)
    # so the reachability metrics below describe *code* connectivity only.
    all_file_paths = set(file_meta.keys())
    code_file_paths = {
        f for f in all_file_paths
        if file_meta[f].get('file_type') not in _NON_CODE_FILE_TYPES
    }
    imported_files = set()
    for edges_list in file_edges_by_module.values():
        for edge in edges_list:
            tgt_path = id_to_rel.get(edge['t'])
            if tgt_path:
                imported_files.add(tgt_path)

    unimported_files = {f for f in code_file_paths if f not in imported_files}
    unimported_file_count = len(unimported_files)
    
    # Circular Dependencies Detection (简化版 - Tarjan's algorithm)
    def detect_cycles(graph):
        """Detect strongly connected components using Tarjan's algorithm."""
        index_counter = [0]
        stack = []
        lowlinks = {}
        index = {}
        on_stack = defaultdict(bool)
        sccs = []
        
        def strongconnect(node):
            index[node] = index_counter[0]
            lowlinks[node] = index_counter[0]
            index_counter[0] += 1
            stack.append(node)
            on_stack[node] = True
            
            for successor in graph.get(node, []):
                if successor not in index:
                    strongconnect(successor)
                    lowlinks[node] = min(lowlinks[node], lowlinks[successor])
                elif on_stack[successor]:
                    lowlinks[node] = min(lowlinks[node], index[successor])
            
            if lowlinks[node] == index[node]:
                component = []
                while True:
                    w = stack.pop()
                    on_stack[w] = False
                    component.append(w)
                    if w == node:
                        break
                if len(component) > 1:
                    sccs.append(component)
        
        for node in graph:
            if node not in index:
                strongconnect(node)

        return sccs
    
    # Build file dependency graph (using paths, not IDs)
    file_dep_graph = defaultdict(list)
    for edges_list in file_edges_by_module.values():
        for edge in edges_list:
            src_path = id_to_rel.get(edge['s'])
            tgt_path = id_to_rel.get(edge['t'])
            if src_path and tgt_path:
                file_dep_graph[src_path].append(tgt_path)
    
    circular_deps = detect_cycles(file_dep_graph)
    circular_dep_count = len(circular_deps)
    
    # Get top circular dependency groups by size
    top_circular_deps = sorted(circular_deps, key=len, reverse=True)[:10]

    # For each reported SCC, extract ONE concrete simple cycle — a real import
    # path that loops back on itself — as evidence. An SCC just means every file
    # is mutually reachable; rendering its members as a linear A→B→C chain (the
    # old behaviour) implies an import order that doesn't exist. This gives the
    # dashboard a truthful A→B→…→A cycle to show, while the SCC size still
    # conveys how many files are entangled.
    def _representative_cycle(scc_nodes):
        node_set = set(scc_nodes)
        adj = {n: [m for m in file_dep_graph.get(n, []) if m in node_set]
               for n in scc_nodes}
        start = scc_nodes[0]
        path = [start]
        on_path = {start}
        pos = {start: 0}
        dfs = [(start, iter(adj.get(start, ())))]
        while dfs:
            _node, it = dfs[-1]
            stepped = False
            for nxt in it:
                if nxt in on_path:
                    return path[pos[nxt]:]      # back edge → real simple cycle
                path.append(nxt)
                on_path.add(nxt)
                pos[nxt] = len(path) - 1
                dfs.append((nxt, iter(adj.get(nxt, ()))))
                stepped = True
                break
            if not stepped:
                dfs.pop()
                on_path.discard(path.pop())
                pos.pop(_node, None)
        return list(scc_nodes)                  # fallback (unreachable for a true SCC)

    top_circular_cycles = [_representative_cycle(scc) for scc in top_circular_deps]

    # Entry Points: genuine roots of the import DAG — not imported by anyone,
    # but they DO import other files (so they actively pull code in). This is a
    # strict subset of `unimported_files`; the remainder (no inbound AND no
    # outbound) are the `isolated_files` reported separately, so
    #   unimported_files = entry_points + isolated_files.
    # Previously entry points used the identical formula to unimported files, so
    # the two KPIs always displayed the same number.
    entry_points = [
        f for f in code_file_paths
        if f not in imported_files and f in file_dep_graph
    ]
    entry_point_count = len(entry_points)
    
    # Isolated files (neither import nor are imported)
    files_with_edges = set()
    for edges_list in file_edges_by_module.values():
        for edge in edges_list:
            src_path = id_to_rel.get(edge['s'])
            tgt_path = id_to_rel.get(edge['t'])
            if src_path:
                files_with_edges.add(src_path)
            if tgt_path:
                files_with_edges.add(tgt_path)
    
    isolated_files = {f for f in code_file_paths if f not in files_with_edges}
    isolated_file_count = len(isolated_files)
    
    # Complexity metrics
    all_func_lines = []
    for rel, funcs in funcs_by_file.items():
        for func in funcs:
            if 'end_line' in func and 'line' in func:
                func_length = func['end_line'] - func['line']
                all_func_lines.append((rel, func['label'], func_length))
    
    avg_func_length = sum(l for _, _, l in all_func_lines) / len(all_func_lines) if all_func_lines else 0
    longest_funcs = sorted(all_func_lines, key=lambda x: x[2], reverse=True)[:10]
    
    # Language distribution
    lang_stats = defaultdict(int)
    for meta in file_meta.values():
        ext = meta['ext']
        lang_stats[ext] += 1

    _cb(
        100,
        'Done!',
        stage='finalize',
        analyzed_files=total,
        total_files=total,
        project_total_files=total_all_files,
        project_processed_files=total_all_files,
        source_files_total=total,
        module_count=len(modules),
        other_files=total_other,
        node_count=total_visible_files + total_funcs,
        file_edge_count=len(seen_file_edges),
        func_edge_count=resolved_func_edges,
        edge_count=len(module_edges) + len(seen_file_edges) + resolved_func_edges,
        function_count=total_funcs,
        call_count=total_calls,
        project_type=project_type,
    )
    _console_print()
    _result = {
        'modules':               modules,
        'module_edges':          module_edges,
        'files_by_module':       dict(files_by_module),
        'file_edges_by_module':  dict(file_edges_by_module),
        'other_files_by_module': dict(other_files_by_module),
        'funcs_by_file':         funcs_by_file,
        'func_edges_by_file':    func_edges_by_file,
        'func_calls_by_file':    func_calls_by_file,
        'func_name_to_file':     func_name_to_file,
        'func_name_to_files':    {k: v for k, v in func_name_to_files.items() if len(v) > 1},
        'func_name_ambiguous':   sorted(func_name_ambiguous),
        'file_to_module':        file_to_module,
        'func_known_categories': KNOWN_SYS_FUNCS,
        'edge_types':            EDGE_TYPES,
        'project_type':          project_type,
        'symbol_index':          symbol_index,
        'symbol_edges':          symbol_edges,
        'meta':                  {},
        'communities':           communities,
        'community_stats':       community_stats,
        'file_community':        file_community,
        'stats': {
            # ── Analysed (shown in graph) ──
            'files':              total,          # SCAN_EXT files actually analysed
            'modules':            len(modules),   # top-level dirs = "modules"
            'functions':          total_funcs,
            'calls':              total_calls,
            # ── Visibility breakdown ──
            'other_files':        total_other,    # non-SCAN_EXT, non-skipped files shown as grey nodes
            'binary_files':       total_binary,   # subset of other_files that are binary
            # ── Full codebase counts (matches Windows Properties) ──
            'total_visible_files':total_visible_files,  # analysed + other (no skip dirs)
            'total_all_files':    total_all_files,      # files outside skip/ignored dirs (their contents are not descended)
            'total_dirs':         total_dirs_scanned,   # non-skipped subdirectory count
            'total_dirs_skipped': total_dirs_skipped,   # skipped/ignored subtree roots (not descended into)
            'skipped_files':      total_files_skipped,  # 0 — skip dirs are no longer walked, so their file count is unknown
            'skipped_dir_names':  sorted(skip_dirs),    # which dirs were skipped
            'ignore_filter_enabled': ignore_filter.enabled,
            'ignore_filter_mode':    ignore_filter.mode,
            'ignored_files':         ignored_files,
            'type_counts':        dict(type_counts),
            'root':               root.replace('\\', '/'),
            'project_type':       project_type,
            # ── Health Metrics (Dashboard) ──
            'top_imported_files': [
                {'file': f, 'count': c} for f, c in top_imported_files
            ],
            'top_caller_files': [
                {'file': f, 'count': c} for f, c in top_caller_files
            ],
            'uncalled_functions': uncalled_func_count,
            'dead_code_symbols': dead_code_symbols,
            'unimported_files': unimported_file_count,
            'unimported_file_paths': sorted(unimported_files),
            'circular_dependencies': circular_dep_count,
            'top_circular_deps': [[f for f in cycle] for cycle in top_circular_deps],
            'top_circular_cycles': [list(cycle) for cycle in top_circular_cycles],
            'entry_points': entry_point_count,
            'entry_point_files': sorted(entry_points),
            'isolated_files': isolated_file_count,
            'isolated_file_paths': sorted(isolated_files),
            'avg_func_length': round(avg_func_length, 1),
            'longest_functions': [
                {'file': f, 'name': n, 'lines': l} for f, n, l in longest_funcs
            ],
            'language_distribution': dict(lang_stats),
            # ── C1/C2: Graph Intelligence (analytics_helpers) ──
            'hotspot_nodes':          [],
            'surprising_connections': [],
        }
    }
    try:
        from analytics_helpers import hotspot_nodes, surprising_connections
        _result['stats']['hotspot_nodes']          = hotspot_nodes(_result)
        _result['stats']['surprising_connections'] = surprising_connections(_result)
    except Exception:
        pass

    # ── Quality Metrics (Phase 1 dashboard rewrite) ──────────────────────────
    try:
        loc_totals = _aggregate_loc(file_meta)
        _result['stats']['loc_total']   = loc_totals['total']
        _result['stats']['loc_code']    = loc_totals['code']
        _result['stats']['loc_comment'] = loc_totals['comment']
        _result['stats']['loc_blank']   = loc_totals['blank']

        cx = _aggregate_complexity(symbol_index)
        _result['stats']['complexity_distribution']  = cx['distribution']
        _result['stats']['complexity_top_offenders'] = cx['top_offenders']
        _result['stats']['avg_complexity']           = round(cx['avg'], 1)

        dup = _compute_duplication(root, file_meta)
        _result['stats']['duplication_percent'] = round(dup['percent'] * 100, 1)
        _result['stats']['duplication_blocks']  = dup['blocks']

        # God-file count: files in the top 5% of outgoing-call counts AND
        # with at least 100 outgoing calls. Both conditions are required so
        # the metric stays meaningful across project sizes — a 30-file repo
        # has at most ~2 god files, a 600-file repo at most ~30.
        # The previous len(top_caller_files) approach saturated at 50 on any
        # non-trivial repo and forced the coupling sub-score to clamp to 0.
        _GOD_FILE_CALL_FLOOR = 100
        _GOD_FILE_TOP_RATIO  = 0.05
        _top_callers_list = _result['stats'].get('top_caller_files', [])
        _top_n = max(1, int(round(total * _GOD_FILE_TOP_RATIO)))
        god_count = sum(
            1 for item in _top_callers_list[:_top_n]
            if int(item.get('count', 0)) >= _GOD_FILE_CALL_FLOOR
        )

        debt = _compute_tech_debt(
            circular_count=circular_dep_count,
            dead_count=uncalled_func_count,
            god_count=god_count,
            high_complexity_count=cx['high_count'],
            duplication_block_count=len(dup['blocks']),
        )
        _result['stats']['tech_debt_minutes']   = debt['minutes']
        _result['stats']['tech_debt_hours']     = debt['hours']
        _result['stats']['tech_debt_breakdown'] = debt['breakdown']
        _result['stats']['tech_debt_weights']   = debt['weights']

        health = compute_code_health(
            avg_complexity=cx['avg'],
            circular_deps=circular_dep_count,
            god_files=god_count,
            total_files=total,
            dead_funcs=uncalled_func_count,
            total_funcs=cx['total_funcs'] or total_funcs,
            duplication_percent=dup['percent'],
            graph_modularity=graph_modularity,
        )
        _result['stats']['code_health_score']     = health['score']
        _result['stats']['code_health_breakdown'] = health['breakdown']
        _result['stats']['code_health_weights']   = health['weights']

        # ── Security findings aggregation + per-run history append ───────────
        try:
            _file_sec_view = {
                _rel: _meta.get('security_issues', [])
                for _rel, _meta in file_meta.items()
            }
            _sec_payload = security_scanner.aggregate(_file_sec_view)
            _sec_payload['trend'] = security_scanner.append_history(Path(root), _sec_payload)
            _result['stats']['security_findings'] = _sec_payload
        except Exception as _se:
            _console_print(f'[WARN] Security aggregation failed: {_se}', file=sys.stderr)

        # ── AI Harness Scan ───────────────────────────────────────────────────
        try:
            from harness_scan import compute_harness_scan
            _hs = compute_harness_scan(root)
            _result['stats']['harness_scan'] = _hs
        except Exception as _hse:
            _console_print(f'[WARN] Harness scan failed: {_hse}', file=sys.stderr)

        _result['stats']['has_git_history'] = bool(
            root and os.path.isdir(os.path.join(root, '.git'))
        )
    except Exception as _qm_err:
        _console_print(f'[WARN] Quality-metric pass failed: {_qm_err}', file=sys.stderr)

    # ── Phase 2: Temporal Analysis (git log) ─────────────────────────────────
    if _result['stats'].get('has_git_history'):
        try:
            from git_history import compute_git_history, _compute_hotspot, DEFAULT_WINDOW_DAYS
            window_days = DEFAULT_WINDOW_DAYS
            cfg_path = os.path.join(root, '.vizcode', 'dashboard_config.json')
            if os.path.isfile(cfg_path):
                try:
                    with open(cfg_path, 'r', encoding='utf-8') as _f:
                        _cfg = json.load(_f)
                    cd = _cfg.get('git_window_days')
                    if isinstance(cd, (int, float)) and 7 <= cd <= 3650:
                        window_days = int(cd)
                except Exception:
                    pass
            from git_history import (compute_bus_factor,
                                      compute_branch_analysis)
            gh = compute_git_history(root, since_days=window_days)
            if gh is not None:
                # Git tracks historical paths (including renames). Filter
                # the live dashboard view to files that still exist in the
                # current tree. Cache stays unfiltered for re-use.
                live_files = set(file_meta.keys())
                full_churn = gh.pop('_full_file_churn', gh.get('file_churn', []))
                full_churn = [r for r in full_churn if r['file'] in live_files]
                gh['file_churn'] = full_churn[:50]
                gh['change_coupling'] = [
                    p for p in gh.get('change_coupling', [])
                    if p['file_a'] in live_files and p['file_b'] in live_files
                ]
                for _key in ('files_by_author', 'files_by_week', 'files_by_day'):
                    _groups = gh.get(_key, {}) or {}
                    gh[_key] = {
                        group: [r for r in rows if r.get('file') in live_files]
                        for group, rows in _groups.items()
                    }
                _commit_groups = gh.get('commits_by_day', {}) or {}
                gh['commits_by_day'] = {
                    day: [
                        dict(c, files=[f for f in (c.get('files') or []) if f.get('file') in live_files])
                        for c in rows
                    ]
                    for day, rows in _commit_groups.items()
                }
                gh['hotspot_files'] = _compute_hotspot(
                    full_churn, symbol_index, file_meta,
                )
                # Bus factor — uses already-filtered files_by_author
                gh['bus_factor_files'] = compute_bus_factor(
                    gh.get('files_by_author', {})
                )
                # Branch overview (best-effort; None → widget shows empty state)
                gh['branch_analysis'] = compute_branch_analysis(
                    root,
                    hotspot_files=gh['hotspot_files'],
                    symbol_index=symbol_index,
                )
                _result['stats'].update(gh)
            else:
                # git binary missing or git failed — degrade silently.
                _result['stats']['has_git_history'] = False
        except Exception as _gh_err:
            _console_print(f'[WARN] Git-history pass failed: {_gh_err}', file=sys.stderr)
            _result['stats']['has_git_history'] = False

    # ── Phase 3: Health history snapshot ─────────────────────────────────────
    if not skip_health_snapshot and root and _result['stats'].get('code_health_score') is not None:
        try:
            _append_health_snapshot(root, _result['stats'])
            history = _load_health_history(root)
            _result['stats']['health_history'] = history
        except Exception as _hs_err:
            _console_print(f'[WARN] Health-snapshot write failed: {_hs_err}', file=sys.stderr)

    return _result


def _append_health_snapshot(root: str, stats: dict) -> None:
    """Append a health score snapshot to .vizcode/health_history.json."""
    from .local_dir import ensure_local_dir
    vizcode_dir = str(ensure_local_dir(root))
    path = os.path.join(vizcode_dir, 'health_history.json')

    commit_sha = ''
    try:
        import subprocess
        proc = subprocess.run(
            ['git', 'rev-parse', '--short', 'HEAD'],
            cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            encoding='utf-8', timeout=5,
        )
        if proc.returncode == 0:
            commit_sha = proc.stdout.strip()
    except Exception:
        pass

    entry = {
        'ts':               datetime.datetime.utcnow().isoformat(timespec='seconds') + 'Z',
        'date':             datetime.date.today().isoformat(),
        'commit':           commit_sha,
        'score':            stats.get('code_health_score', 0),
        'breakdown':        stats.get('code_health_breakdown', {}),
        'avg_complexity':   stats.get('complexity_avg', 0),
        'tech_debt_hours':  stats.get('tech_debt_hours', 0),
    }

    history = []
    if os.path.isfile(path):
        try:
            with open(path, 'r', encoding='utf-8') as f:
                history = json.load(f)
            if not isinstance(history, list):
                history = []
        except Exception:
            history = []

    # Keep one live-analysis entry per calendar day, while preserving
    # commit-level backfill entries that may share the same date.
    today = entry['date']
    current_commit = str(entry.get('commit') or '').lower()
    history = [
        h for h in history
        if not (
            (h.get('date') == today and not h.get('backfilled'))
            or (current_commit and str(h.get('commit') or '').lower() == current_commit)
            or (current_commit and str(h.get('commit_full') or '').lower().startswith(current_commit))
        )
    ]
    history.append(entry)
    history = history[-500:]  # keep room for commit-level backfills

    try:
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(history, f, ensure_ascii=False, separators=(',', ':'))
    except Exception:
        pass


def _load_health_history(root: str) -> list:
    """Load health history from .vizcode/health_history.json, newest last."""
    path = os.path.join(root, '.vizcode', 'health_history.json')
    if not os.path.isfile(path):
        return []
    try:
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


# ─── HTML assembly — delegated to html_builder ───────────────────────────────
from html_builder import (  # noqa: E402
    HTML_SKELETON,
    HTML_TEMPLATE,
    build_html,
    inject_data,
    json_for_html_script,
)


# ─── main ─────────────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(description='VIZCODE V4 — Universal Code Visualizer')
    parser.add_argument('root', help='Root directory of codebase (BIOS, Python, JS, Go, ...)')
    parser.add_argument('-o', '--output', default='viz_output.html',
                        help='Output HTML file (default: viz_output.html)')
    parser.add_argument('--include-build', action='store_true',
                        help='Include build output directories (Build/build/DEBUG/RELEASE)')
    parser.add_argument('--include-dir', action='append', default=[],
                        help='Directory name to include even if normally skipped (repeatable)')
    args = parser.parse_args()

    if not os.path.isdir(args.root):
        _console_print(f'Error: "{args.root}" is not a directory', file=sys.stderr)
        sys.exit(1)

    _console_print(f'VIZCODE V4 — analyzing: {args.root}')
    data = build_graph(args.root, include_build=args.include_build,
                       include_dirs=args.include_dir)

    pt = data.get('project_type', {})
    s = data['stats']
    _console_print(f'\nAnalysis complete ({pt.get("emoji","")}{pt.get("name",""):}):')
    _console_print(f'  Modules:   {s["modules"]}')
    _console_print(f'  Files:     {s["files"]}')
    _console_print(f'  Functions: {s["functions"]}')
    _console_print(f'  Calls:     {s["calls"]}')
    if s.get('type_counts'):
        _console_print(f'\n  File types:')
        for ft, cnt in sorted(s['type_counts'].items(), key=lambda x: -x[1]):
            _console_print(f'    {ft:20s} {cnt}')

    try:
        html = build_html(data)
    except FileNotFoundError as e:
        _console_print(f'\nWarning: {e}')
        def _json_default(o):
            if isinstance(o, (set, frozenset)): return sorted(o)
            raise TypeError(f'Not serialisable: {type(o)}')
        json_str = json_for_html_script(
            data,
            ensure_ascii=False,
            separators=(',', ':'),
            default=_json_default,
        )
        pt_json  = json_for_html_script(pt, default=_json_default)
        root_name = Path(data['stats']['root']).name or 'VIZCODE'
        html = HTML_SKELETON\
            .replace('{DATA}', json_str)\
            .replace('{CSS}', '')\
            .replace('{JS}', '')\
            .replace('{root_name}', root_name)\
            .replace('{JOB_ID_JSON}', 'null')\
            .replace('{PT_JSON}', pt_json)

    out = args.output
    Path(out).write_text(html, encoding='utf-8')
    size = Path(out).stat().st_size
    _console_print(f'\nOutput: {out} ({size/1024:.0f} KB)')
    _console_print(f'Open in Chrome: file:///{Path(out).absolute().as_posix()}')

    # Persist under .vizcode/ so the scan can be reopened later (result.json).
    try:
        import result_store
        result_store.save_result(args.root, data)
    except Exception as _pe:
        _console_print(f'Warning: could not persist result: {_pe}')


if __name__ == '__main__':
    main()
