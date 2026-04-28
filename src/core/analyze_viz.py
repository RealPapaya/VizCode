#!/usr/bin/env python3
"""
analyze_viz.py V4 — VIZCODE Universal Code Visualizer
Supports: UEFI/BIOS (C/H/ASM/INF/DEC/DSC/FDF/SDL/CIF/MAK/VFR/HFR/UNI/ASL)
          Python (.py)
          JavaScript / TypeScript (.js/.mjs/.cjs/.jsx/.ts/.tsx)
          Go (.go)

Pluggable Parser architecture: each language has its own parser in parsers/
Project type is auto-detected and displayed during analysis.

Backward compatible: still importable as analyze_bios (server.py alias).
"""

import os, re, json, sys, argparse
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
    from parsers.bios_parser   import scan_bios, BIOS_EXTENSIONS as _BIOS_EXTENSIONS
    from parsers.python_parser import scan_python
    from parsers.js_parser     import scan_js, scan_ts
    from parsers.go_parser     import scan_go
    from parsers.json_parser   import scan_json
    from parsers.common_parser import scan_common
    from detector              import detect_project_type, fmt_detection_banner
    _PARSERS_LOADED = True
except ImportError as _pe:
    _PARSERS_LOADED = False
    _BIOS_EXTENSIONS = set()
    _console_print(f'[WARN] Could not load language parsers: {_pe}', file=sys.stderr)

import parse_memo

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
    if ext in _BIOS_EXTENSIONS:
        return scan_bios
    if ext == '.py':
        return scan_python
    if ext in ('.js', '.mjs', '.cjs', '.jsx'):
                return scan_js
    if ext in ('.ts', '.tsx'):
        return scan_ts
    if ext == '.go':
        return scan_go
    if ext == '.json':
        return scan_json
    return scan_common  # generic fallback for all other recognized extensions

# ─── Constants ───────────────────────────────────────────────────────────────
SKIP_DIRS  = {
    # BIOS / build
    'Build', 'build', '.git', '__pycache__', 'Conf', 'DEBUG', 'RELEASE', '.claude',
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
    # ── C/C++ / ASM (BIOS) ─────────────────────────────────────────────────
    '.c','.cpp','.cc','.h','.hpp','.asm','.s','.S','.nasm',
    # ── UEFI / EDK2 build system ───────────────────────────────────────────
    '.inf', '.dec', '.dsc', '.fdf',
    # ── AMI BIOS proprietary ───────────────────────────────────────────────
    '.sdl', '.sd', '.cif', '.mak',
    # ── HII (Human Interface Infrastructure) ───────────────────────────────
    '.vfr',   # UEFI standard HII form language
    '.hfr',   # AMI extended HII Form Resource
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
    # ── Config / Data ──────────────────────────────────────────────────────
    '.json',
}
SKIP_EXT   = {'.veb','.lib','.obj','.efi','.rom','.bin','.log','.map'}

# ─── File type semantic categories ───────────────────────────────────────────
FILE_TYPE_MAP = {
    # BIOS / C
    '.c': 'c_source', '.cpp': 'c_source', '.cc': 'c_source',
    '.h': 'header',   '.hpp': 'header',
    '.asm': 'assembly', '.s': 'assembly', '.S': 'assembly', '.nasm': 'assembly',
    '.inf': 'module_inf',
    '.dec': 'package_dec',
    '.dsc': 'platform_dsc',
    '.fdf': 'flash_desc',
    '.sdl': 'ami_sdl',
    '.sd':  'ami_sd',
    '.cif': 'ami_cif',
    '.mak': 'makefile',
    '.vfr': 'hii_vfr',
    '.hfr': 'hii_hfr',
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
    # Config / Data
    '.json': 'json_config',
}

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
    # ── Semantic kind edges ─────────────────────────────────────────────────
    'call':          {'label': 'Call',      'color': '#38bdf8', 'style': 'solid',  'kind': 'call'},
    'inherit':       {'label': 'Inherit',   'color': '#818cf8', 'style': 'solid',  'kind': 'inherit'},
    # ── AI-inferred edge (B1, dashed by design) ─────────────────────────────
    'inferred':      {'label': 'Inferred',  'color': '#94a3b8', 'style': 'dashed', 'kind': 'inferred'},
}

# C_KEYWORDS now lives in parsers/bios_parser.py

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

    # ── AMI BIOS SDK ──────────────────────────────────────────────────────────
    'Malloc':               'AMI SDK',
    'MallocZ':              'AMI SDK',
    'Free':                 'AMI SDK',
    'MemSet':               'AMI SDK',
    'MemCpy':               'AMI SDK',
    'MemCmp':               'AMI SDK',
    'Strlen':               'AMI SDK',
    'Strcmp':               'AMI SDK',
    'Strcpy':               'AMI SDK',
    'Strcat':               'AMI SDK',
    'Sprintf':              'AMI SDK',
    'Swprintf':             'AMI SDK',
    'AmiInstallProtocol':   'AMI SDK',
    'AmiLocateProtocol':    'AMI SDK',
    'TRACE':                'AMI SDK',
    'PROGRESS_CODE':        'AMI SDK',
    'ERROR_CODE':           'AMI SDK',
    'AmiGetSystemVariable': 'AMI SDK',
    'AmiSetSystemVariable': 'AMI SDK',

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

# ─── All BIOS/UEFI/AMI/C parsers → parsers/bios_parser.py ──────────────────────

# ─── scan_file ────────────────────────────────────────────────────────────────
def scan_file(filepath: str, root: str, _memo: Optional[dict] = None):
    """
    Returns (includes_or_refs, funcdefs, funccalls, bios_extra_dict, func_calls_by_func, symbol_defs)
    bios_extra_dict varies by file type; None for C/H/ASM.
    symbol_defs is a list of {kind, name, line, end_line, bases, parent, is_public} — may be [] for BIOS/C.

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

    try:
        src = file_bytes.decode('utf-8', errors='replace')
    except Exception:
        src = ''

    # ── Parser dispatch (single exit point for cache-write) ──────────────────
    raw = None

    # ── BIOS / UEFI / AMI / C / ASM ──────────────────────────────────────────
    if ext in _BIOS_EXTENSIONS and _PARSERS_LOADED:
        raw = scan_bios(src, ext)

    # ── Python ───────────────────────────────────────────────────────────────
    elif ext == '.py' and _PARSERS_LOADED:
        raw = scan_python(src)

    # ── JavaScript / TypeScript ───────────────────────────────────────────────
    elif ext in ('.js', '.mjs', '.cjs', '.jsx') and _PARSERS_LOADED:
        raw = scan_js(src)

    elif ext in ('.ts', '.tsx') and _PARSERS_LOADED:
        raw = scan_ts(src)

    # ── Go ────────────────────────────────────────────────────────────────────
    elif ext == '.go' and _PARSERS_LOADED:
        raw = scan_go(src)

    # ── JSON ──────────────────────────────────────────────────────────────────
    elif ext == '.json' and _PARSERS_LOADED:
        raw = scan_json(src, ext)

    # ── Common fallback for any remaining recognized extension ────────────────
    elif _PARSERS_LOADED:
        raw = scan_common(src, ext)

    if raw is not None:
        # Pluggable parsers return 5-, 6-, or 7-tuples. Normalise to 7:
        #   (imports, funcdefs, calls, extra, calls_by_func, symbol_defs, parse_diag)
        n = len(raw)
        if n == 5:
            result = (*raw, [], None)
        elif n == 6:
            result = (*raw, None)
        elif n == 7:
            result = tuple(raw)
        else:
            # Defensive: coerce any future shape to 7 by truncating or padding.
            padded = list(raw)[:7] + [None] * max(0, 7 - n)
            result = tuple(padded)
    else:
        # Final safety net: .c, .cpp, .h, .hpp → C-like analysis
        clean = strip_comments(src)
        masked = mask_string_literals(clean)
        includes = RE_INCLUDE.findall(clean)

        funcdefs, funccalls, func_calls_by_func = [], [], []
        for m in RE_FUNCDEF.finditer(clean):
            is_efiapi = bool(m.group(1))
            name = m.group(2)
            if name in C_KEYWORDS or len(name) < 2:
                continue
            line_before = clean[:m.start()].rstrip()
            is_static = bool(RE_STATIC.search(line_before.split('\n')[-1] if '\n' in line_before else line_before))
            funcdefs.append({'label': name, 'is_efiapi': is_efiapi, 'is_static': is_static})

            open_idx = m.end() - 1  # regex ends at '{'
            close_idx = find_matching_brace(masked, open_idx)
            body = masked[open_idx + 1:close_idx] if close_idx > open_idx else ''
            calls = []
            if body:
                for cm in RE_FUNCCALL.finditer(body):
                    cname = cm.group(1)
                    if cname not in C_KEYWORDS and len(cname) >= 2:
                        calls.append(cname)
            func_calls_by_func.append(calls)

        for m in RE_FUNCCALL.finditer(clean):
            name = m.group(1)
            if name not in C_KEYWORDS and len(name) >= 2:
                funccalls.append(name)

        result = (includes, funcdefs, funccalls, None, func_calls_by_func, [], None)

    # ── Cache write ───────────────────────────────────────────────────────────
    if _memo is not None and rel is not None:
        parse_memo.record_entry(_memo, rel, file_sha, p_sha, result)

    return result


# ─── get_module ───────────────────────────────────────────────────────────────
def get_module(rel_path: str) -> str:
    parts = rel_path.replace('\\', '/').split('/')
    return parts[0] if len(parts) > 1 else '_root'


# ─── build_graph ─────────────────────────────────────────────────────────────
def build_graph(root_dir: str, progress_cb=None, include_build=False, include_dirs=None) -> dict:
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
    stage_ranges = {
        'scan': (0, 18),
        'detect': (18, 26),
        'analysis': (26, 84),
        'node': (84, 90),
        'edge': (90, 99),
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
    all_files = []

    _cb(0, 'Scanning files...', stage='scan')
    skip_dirs = set(SKIP_DIRS)
    if include_build:
        skip_dirs -= BUILD_DIRS
    if include_dirs:
        skip_dirs -= set(include_dirs)

    total_project_files = 0
    total_project_dirs = 0
    for _dp, _dns, _fns in os.walk(root):
        total_project_dirs += len(_dns)
        total_project_files += len(_fns)
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in skip_dirs]
        for fname in filenames:
            ext = Path(fname).suffix.lower()
            if ext in SCAN_EXT and ext not in SKIP_EXT:
                all_files.append(os.path.join(dirpath, fname))

    total = len(all_files)
    _cb(
        _stage_pct('scan', 0.7),
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

    for i, fp in enumerate(all_files):
        if (i + 1) % 20 == 0 or (i + 1) == total:
            pct = _stage_pct('analysis', ((i + 1) / total) if total else 1.0, ease_power=0.72)
            _cb(
                pct,
                f'{i + 1}/{total} source files analyzed',
                stage='analysis',
                analyzed_files=i + 1,
                total_files=total,
                project_total_files=total_project_files,
                project_processed_files=i + 1,
                source_files_total=total,
            )
        rel = os.path.relpath(fp, root).replace('\\', '/')
        _scanned = scan_file(fp, root, _memo=_memo)
        # scan_file may return 6- or 7-tuple depending on parser — unpack safely.
        inc, defs, calls, extra, func_calls_by_func, sym_defs = _scanned[:6]
        parse_diag = _scanned[6] if len(_scanned) > 6 else None
        ext = Path(fp).suffix.lower()
        bios_meta = {}
        if extra and 'meta' in extra:
            bios_meta = extra['meta']

        file_meta[rel] = {
            'label':     os.path.basename(fp),
            'ext':       ext,
            'size':      os.path.getsize(fp),
            'module':    get_module(rel),
            'file_type': FILE_TYPE_MAP.get(ext, 'other'),
            'bios_meta': bios_meta,
            'parse_error': (parse_diag or {}).get('file_error') if isinstance(parse_diag, dict) else None,
        }
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

    # ── Phase X: Collect ALL other files + count skipped dirs + total dirs ───────
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

    total_dirs_scanned = 0
    other_files_seen = 0
    other_scan_total = max(total_project_files - total, 1)

    for _dp, _dns, _fns in os.walk(root):
        _dns[:] = [d for d in _dns if d not in skip_dirs]
        total_dirs_scanned += len(_dns)
        for _fn in _fns:
            _fp  = os.path.join(_dp, _fn)
            _rel = os.path.relpath(_fp, root).replace('\\', '/')
            if _rel in file_meta:
                continue
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
    fixed = {'AmiPkg':'#00d4ff','AsusModulePkg':'#00ff9f',
             'AsusProjectPkg':'#ff6b35','AmiChipsetPkg':'#ffd700'}
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

    # Pre-build CamelCase → snake_case lookup for Ruby/Python convention matching
    _re_camel = re.compile(r'(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])')

    def resolve_ref(ref: str, src_dir: str = '') -> list:
        """Try to resolve a reference string to known rel_paths."""
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
            candidate = os.path.normpath(os.path.join(src_dir, ref)).replace('\\', '/')
            if candidate in file_meta:
                return [candidate]
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

    def add_edge(src_rel, tgt_rel, edge_type):
        src_id  = rel_to_id[src_rel]
        tgt_id  = rel_to_id[tgt_rel]
        src_mod = file_meta[src_rel]['module']
        tgt_mod = file_meta[tgt_rel]['module']
        if src_id == tgt_id:
            return
        if src_mod != tgt_mod:
            key = (min(src_mod, tgt_mod), max(src_mod, tgt_mod))
            module_edge_counts[key] += 1
        ekey = (src_id, tgt_id, edge_type)
        if ekey not in seen_file_edges:
            seen_file_edges.add(ekey)
            file_edges_by_module[src_mod].append({'s': src_id, 't': tgt_id, 'type': edge_type})

    for src_rel, extra in file_extra.items():
        ext = file_meta[src_rel]['ext']
        src_dir = str(Path(src_rel).parent)

        if ext in ('.c', '.cpp', '.cc', '.h', '.hpp', '.vfr', '.asl'):
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
        ):
            for imp in file_incs.get(src_rel, []):
                for tgt in resolve_ref(imp, src_dir):
                    if tgt != src_rel:
                        add_edge(src_rel, tgt, 'import')

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

        elif ext == '.fdf' and extra:
            for inf_f in extra.get('infs', []):
                for tgt in resolve_ref(inf_f, src_dir):
                    add_edge(src_rel, tgt, 'component')

        elif ext == '.sdl' and extra:
            # INFComponent → .inf files
            for inf_f in extra.get('inf_components', []):
                for tgt in resolve_ref(inf_f, src_dir):
                    add_edge(src_rel, tgt, 'component')
            # LibraryMapping → .inf by Instance "Pkg.LibClass" → stem is LibClass
            for inst in extra.get('lib_mappings', []):
                stem = inst.split('.')[-1] if '.' in inst else inst
                for tgt in resolve_ref(stem, src_dir):
                    if tgt != src_rel:
                        add_edge(src_rel, tgt, 'library')
            # Phase C: ELINK parent chain — each ELINK parent points to a .sdl that owns it
            for parent in extra.get('elink_parents', []):
                for tgt in resolve_ref(parent, src_dir):
                    if tgt != src_rel:
                        add_edge(src_rel, tgt, 'elink')

        elif ext == '.cif' and extra:
            # [INF] section → .inf files
            for inf_f in extra.get('infs', []):
                for tgt in resolve_ref(inf_f, src_dir):
                    add_edge(src_rel, tgt, 'cif_own')
            # [files] section → any file
            for f in extra.get('files', []):
                for tgt in resolve_ref(f, src_dir):
                    add_edge(src_rel, tgt, 'cif_own')

        # Phase D: VFR → UNI (str_ref) / HFR (include) edges
        elif ext == '.vfr' and extra:
            # .uni string packages → str_ref (this VFR depends on that UNI for string tokens)
            for uni_f in extra.get('uni_includes', []):
                for tgt in resolve_ref(uni_f, src_dir):
                    add_edge(src_rel, tgt, 'str_ref')
            # .hfr sub-forms → include (this VFR includes that HFR form fragment)
            for hfr_f in extra.get('hfr_includes', []):
                for tgt in resolve_ref(hfr_f, src_dir):
                    add_edge(src_rel, tgt, 'include')
            # Other #include (e.g. .h header defines)
            for inc in extra.get('includes', []):
                ext_i = Path(inc).suffix.lower()
                if ext_i not in ('.uni', '.hfr'):  # already handled above
                    for tgt in resolve_ref(inc, src_dir):
                        add_edge(src_rel, tgt, 'include')

        # Phase D: HFR (AMI HII Form Resource) — same pattern as VFR
        elif ext == '.hfr' and extra:
            for uni_f in extra.get('uni_includes', []):
                for tgt in resolve_ref(uni_f, src_dir):
                    add_edge(src_rel, tgt, 'str_ref')
            for hfr_f in extra.get('hfr_includes', []):
                for tgt in resolve_ref(hfr_f, src_dir):
                    add_edge(src_rel, tgt, 'include')
            for inc in extra.get('includes', []):
                ext_i = Path(inc).suffix.lower()
                if ext_i not in ('.uni', '.hfr'):
                    for tgt in resolve_ref(inc, src_dir):
                        add_edge(src_rel, tgt, 'include')

        # Phase C: ASL → Include edges
        elif ext == '.asl' and extra:
            for inc in extra.get('includes', []):
                for tgt in resolve_ref(inc, src_dir):
                    add_edge(src_rel, tgt, 'asl_include')

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
                # Flag set when the parser had to fall back (e.g. ast.parse failed).
                # Truthy value is a short diagnostic message; falsy → clean symbol.
                'parse_error': file_parse_error,
            }
            _sym_name_to_ids[sym['name']].append(sid)
            _file_sym_key[(rel, sym['name'])] = sid

    # kind mapping for symbol edge types → A2 unified vocabulary
    _SYMBOL_KIND = {'inheritance': 'inherit', 'implements': 'inherit', 'override': 'inherit', 'call': 'call'}

    # Inheritance / implements edges
    for sid, sym in symbol_index.items():
        for base_name in sym.get('bases', []):
            tgt = (_file_sym_key.get((sym['file'], base_name))
                   or (_sym_name_to_ids[base_name][0] if _sym_name_to_ids[base_name] else None))
            if tgt and tgt != sid:
                tgt_kind = symbol_index[tgt].get('kind', '') if tgt in symbol_index else ''
                edge_type = 'implements' if tgt_kind == 'interface' else 'inheritance'
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
        if not parent_class_id:
            continue
        parent_sym = symbol_index.get(parent_class_id, {})
        for base_name in parent_sym.get('bases', []):
            base_id = (_file_sym_key.get((sym['file'], base_name))
                       or (_sym_name_to_ids[base_name][0] if _sym_name_to_ids[base_name] else None))
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
    )[:5]
    
    # God File candidates: files calling the most functions
    file_call_counts = defaultdict(int)
    for rel, calls in file_calls.items():
        file_call_counts[rel] = len(calls)
    
    top_caller_files = sorted(
        file_call_counts.items(),
        key=lambda x: x[1],
        reverse=True
    )[:5]
    
    # Dead Code Detection
    all_defined_funcs = set()
    for rel, defs in file_defs.items():
        for d in defs:
            all_defined_funcs.add((rel, d['label']))
    
    all_called_funcs = set()
    for rel, calls in file_calls.items():
        for call in calls:
            if call in func_name_to_file:
                target_file = func_name_to_file[call]
                all_called_funcs.add((target_file, call))

    uncalled_funcs = all_defined_funcs - all_called_funcs
    uncalled_func_count = len(uncalled_funcs)
    
    # Files never imported
    all_file_paths = set(file_meta.keys())
    imported_files = set()
    for edges_list in file_edges_by_module.values():
        for edge in edges_list:
            tgt_path = id_to_rel.get(edge['t'])
            if tgt_path:
                imported_files.add(tgt_path)
    
    unimported_files = all_file_paths - imported_files
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
    top_circular_deps = sorted(circular_deps, key=len, reverse=True)[:3]
    
    # Entry Points (root files - not imported by anyone)
    entry_points = [f for f in all_file_paths if f not in imported_files]
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
    
    isolated_files = all_file_paths - files_with_edges
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
            'total_all_files':    total_all_files,      # includes skipped dirs
            'total_dirs':         total_dirs_scanned,   # non-skipped subdirectory count
            'total_dirs_skipped': total_dirs_skipped,   # dirs completely ignored
            'skipped_files':      total_files_skipped,  # files inside skipped dirs
            'skipped_dir_names':  sorted(skip_dirs),    # which dirs were skipped
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
            'unimported_files': unimported_file_count,
            'circular_dependencies': circular_dep_count,
            'top_circular_deps': [[f for f in cycle] for cycle in top_circular_deps],
            'entry_points': entry_point_count,
            'isolated_files': isolated_file_count,
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
    return _result


# ─── HTML Skeleton (CSS/JS loaded from static/) ───────────────────────────────
HTML_SKELETON = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>VIZCODE — {root_name}</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 64 64%22%3E%3Crect width=%2264%22 height=%2264%22 rx=%2212%22 fill=%22%230b1220%22/%3E%3Ctext x=%2232%22 y=%2242%22 text-anchor=%22middle%22 font-family=%22Arial,sans-serif%22 font-size=%2230%22 font-weight=%22700%22 fill=%22%2360a5fa%22%3EV%3C/text%3E%3C/svg%3E">
<script src="https://cdnjs.cloudflare.com/ajax/libs/cytoscape/3.28.1/cytoscape.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/dagre/0.8.5/dagre.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/cytoscape-dagre@2.5.0/cytoscape-dagre.js"></script>
<script src="https://cdn.jsdelivr.net/npm/layout-base@2.0.1/layout-base.js"></script>
<script src="https://cdn.jsdelivr.net/npm/cose-base@2.2.0/cose-base.js"></script>
<script src="https://cdn.jsdelivr.net/npm/cytoscape-fcose@2.2.0/cytoscape-fcose.js"></script>
<script src="https://cdn.jsdelivr.net/npm/elkjs@0.9.3/lib/elk.bundled.js"></script>
<script src="https://cdn.jsdelivr.net/npm/cytoscape-elk@2.3.0/dist/cytoscape-elk.js"></script>
<script src="https://cdn.jsdelivr.net/npm/webcola@3.4.0/WebCola/cola.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/cytoscape-cola@2.5.1/cytoscape-cola.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/graphology@0.26.0/dist/graphology.umd.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/sigma@3.0.2/dist/sigma.min.js"></script>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Fira+Code:wght@400;500;600&family=Noto+Sans+TC:wght@400;500;700&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/c.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/cpp.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/x86asm.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/xml.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/python.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/javascript.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/typescript.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/go.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/bash.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/json.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/yaml.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/languages/markdown.min.js"></script>
<style>{CSS}</style>
</head>
<body>

<script>window.JOB_ID = {JOB_ID_JSON}; window.PROJECT_TYPE = {PT_JSON};</script>

<div id="topbar">
  <div class="logo">VIZCODE</div>
  <div class="topbar-mode-group">
    <button id="dashboard-btn" class="topbar-mode-btn" type="button" data-i18n-attr="data-tip" data-i18n="dashboardTip" onclick="switchTopbarMode('dashboard')">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="18" y1="20" x2="18" y2="10"></line><line x1="12" y1="20" x2="12" y2="4"></line><line x1="6" y1="20" x2="6" y2="14"></line></svg>
      <span data-i18n="dashboard">Dashboard</span>
    </button>
    <button id="graph-btn" class="topbar-mode-btn active" type="button" data-i18n-attr="data-tip" data-i18n="graphHomeTip" onclick="switchTopbarMode('graph')">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="12" r="2"></circle><circle cx="12" cy="6" r="2"></circle><circle cx="19" cy="12" r="2"></circle><circle cx="12" cy="18" r="2"></circle><line x1="6.8" y1="10.9" x2="10.2" y2="7.1"></line><line x1="13.8" y1="7.1" x2="17.2" y2="10.9"></line><line x1="17.2" y1="13.1" x2="13.8" y2="16.9"></line><line x1="10.2" y1="16.9" x2="6.8" y2="13.1"></line></svg>
      <span data-i18n="graphHome">Graph</span>
    </button>
    <button id="galaxy-btn" class="topbar-mode-btn" type="button" data-i18n-attr="data-tip" data-i18n="galaxyTip" onclick="switchTopbarMode('galaxy')">
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><circle cx="5" cy="6" r="2"/><line x1="6.7" y1="7.3" x2="9.6" y2="10"/><circle cx="19" cy="6" r="2"/><line x1="17.3" y1="7.3" x2="14.4" y2="10"/><circle cx="5" cy="18" r="2"/><line x1="6.7" y1="16.7" x2="9.6" y2="14"/><circle cx="19" cy="18" r="2"/><line x1="17.3" y1="16.7" x2="14.4" y2="14"/></svg>
      <span data-i18n="galaxy">Galaxy</span>
    </button>
  </div>
  <div class="stats-bar">
    <div class="stat"><span data-i18n="topbarFiles">Files</span> <strong id="st-files">0</strong></div>
    <div class="stat"><span data-i18n="topbarModules">Modules</span> <strong id="st-mods">0</strong></div>
    <div class="stat"><span data-i18n="topbarFunctions">Functions</span> <strong id="st-funcs">0</strong></div>
  </div>
  <div style="flex:1"></div>
    <div id="search-wrap">
      <div id="sr-modes">
      <button class="sr-mode active" data-mode="files" id="srm-files" data-i18n-attr="data-tip" data-i18n="searchModeFilesTip" aria-label="Files">
        <svg class="sr-mode-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
          <path fill="currentColor" d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>
        </svg>
      </button>
      <button class="sr-mode" data-mode="code" id="srm-code" data-i18n-attr="data-tip" data-i18n="searchModeCodeTip" aria-label="Code">
        <svg class="sr-mode-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
          <path fill="currentColor" d="M9.5 7.5L6 12l3.5 4.5 1.3-1L8.1 12l2.7-3.5-1.3-1zM14.5 7.5l-1.3 1L15.9 12l-2.7 3.5 1.3 1L18 12l-3.5-4.5z"/>
        </svg>
      </button>
      </div>
    <div id="sr-input-row">
      <span id="sr-icon">⌕</span>
      <input id="search" type="text" data-i18n-attr="placeholder" data-i18n="searchPlaceholderFiles" placeholder="Search files… ( / )" autocomplete="off" spellcheck="false">
      <div id="sr-toggles">
        <button class="sr-toggle" id="srt-case" data-i18n-attr="data-tip" data-i18n="searchMatchCase">Aa</button>
        <button class="sr-toggle" id="srt-word" data-i18n-attr="data-tip" data-i18n="searchMatchWord">ab</button>
        <button class="sr-toggle" id="srt-regex" data-i18n-attr="data-tip" data-i18n="searchRegex">.*</button>
      </div>
      <span id="sr-count"></span>
    </div>
    <div id="sr-panel">
      <div id="sr-filters">
        <div class="sr-filter-row">
          <span class="sr-filter-label" data-i18n="searchIncludeLabel">files to include</span>
          <input class="sr-filter-input" id="sr-include" type="text" data-i18n-attr="placeholder" data-i18n="searchIncludePlaceholder" placeholder="e.g. *.c, *.h" autocomplete="off" spellcheck="false">
        </div>
        <div class="sr-filter-row">
          <span class="sr-filter-label" data-i18n="searchExcludeLabel">files to exclude</span>
          <input class="sr-filter-input" id="sr-exclude" type="text" data-i18n-attr="placeholder" data-i18n="searchExcludePlaceholder" placeholder="e.g. Build/*, *.obj" autocomplete="off" spellcheck="false">
        </div>
      </div>
      <div id="sr-results"></div>
    </div>
  </div>
  <button id="pref-btn" data-i18n-attr="data-tip" data-i18n="settingsButton" style="background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:18px;margin-left:4px;padding:4px;transition:color 0.2s;flex-shrink:0;">⚙</button>
</div>

<div id="breadcrumb">
  <span id="bc-items" style="display:flex;align-items:center;gap:8px;flex:1;min-width:0;overflow:hidden"></span>
  <button id="back-btn" onclick="goBack()" data-i18n="back" disabled>&#8592; Back</button>
  <button id="graph-toggle-btn" data-i18n-attr="data-tip" data-i18n="graphBtnCallGraphTip" disabled>⬡ <span data-i18n="graphBtnCallGraph">Call Graph</span></button>
  <button id="struct-toggle-btn" disabled><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;vertical-align:-2px"><rect x="8" y="3" width="8" height="6" rx="1"></rect><path d="M12 9v4"></path><path d="M5 13h14"></path><path d="M5 13v3"></path><rect x="2" y="16" width="6" height="5" rx="1"></rect><path d="M19 13v3"></path><rect x="16" y="16" width="6" height="5" rx="1"></rect></svg>Structure</button>
  <button id="code-toggle-btn" disabled data-i18n-attr="data-tip" data-i18n="codePanelToggleTip"><span class="code-icon">&#60;&#92;&#62;</span> <span data-i18n="codePanelToggle">Code</span></button>
</div>

<div id="layout">
  <div id="sidebar">
    <div id="sb-header">
      <div id="sb-tabs">
        <button class="sb-tab active" data-tab="explorer">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/></svg>
          <span class="sb-tab-label" data-i18n="explorer">Explorer</span>
        </button>
        <button class="sb-tab" data-tab="filters">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="11" y1="18" x2="13" y2="18"/></svg>
          <span class="sb-tab-label" data-i18n="filters">Filters</span>
        </button>
      </div>
      <button id="sb-collapse-btn" title="Collapse sidebar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="m16 15-3-3 3-3"/></svg></button>
    </div>
    <div id="sb-body-explorer" class="sb-body">
      <div id="sidebar-title" data-collapsible="true" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;"><span data-i18n="fileSystem">File System</span><span class="legend-toggle" style="font-size:13px;transition:transform 0.2s;">▾</span></div>
      <div id="module-list"></div>
    </div>
    <div id="sb-body-filters" class="sb-body" style="display:none">
      <div id="ft-filter"></div>
      <div id="node-legend"></div>
      <div id="edge-filter"></div>
    </div>
    <div id="sb-footer">
      <span id="sb-stat-nodes">&#x2013;</span>
      <span class="sb-stat-sep"> &middot; </span>
      <span id="sb-stat-edges">&#x2013;</span>
    </div>
  </div>
  <div id="sidebar-resizer"></div>
  <div id="graph-wrap">
    <div id="l1-toolbar" class="l2-toolbar hidden">
      <div class="l2-left">
        <div class="l2-title" data-i18n="l1Title">Dependency Map</div>
        <div class="l2-sub" id="l1-mod-label" data-i18n="noModule">No module</div>
      </div>
        <div class="l2-actions">
          <button id="l1-prev" class="l2-btn" disabled>&#x21A9;</button>
          <button id="l1-next" class="l2-btn" disabled>&#x21AA;</button>
          <button id="l1-expand-all-ext" class="l2-btn" style="display:none" data-i18n="searchExpandAll">Expand All</button>
          <button id="l1-collapse-all-ext" class="l2-btn" style="display:none" data-i18n="searchCollapseAll">Collapse All</button>
          <button id="l1-toggle-ext" class="l2-btn" data-i18n="extFilesOn">External Files: On</button>
          <span id="l1-stats" class="l2-stats"></span>
        </div>
    </div>
    <div id="l2-toolbar" class="l2-toolbar hidden">
      <div class="l2-left">
        <div class="l2-title" data-i18n="l2Title">Call Flow</div>
        <div class="l2-sub" id="l2-file-label" data-i18n="noFile">No file</div>
      </div>
        <div class="l2-actions">
          <button id="l2-prev" class="l2-btn">&#x21A9;</button>
          <button id="l2-next" class="l2-btn">&#x21AA;</button>
          <button id="l2-expand-all" class="l2-btn" data-i18n="searchExpandAll">Expand All</button>
          <button id="l2-collapse-all" class="l2-btn" data-i18n="searchCollapseAll">Collapse All</button>
          <button id="l2-toggle-ext-funcs" class="l2-btn" data-i18n="extFuncsOff">External Functions: Off</button>
          <span id="l2-stats" class="l2-stats"></span>
        </div>
    </div>
    <button id="l2-toggle-ext-lines" class="l2-btn" style="position: absolute; bottom: 16px; left: 16px; z-index: 50; display: none; box-shadow: 0 4px 12px rgba(0,0,0,0.5); border: 1px solid var(--border); background: var(--panel2);" data-i18n="extLinesOn">External Lines: On</button>
    <div id="cy"></div>
    <div id="galaxy-container"></div>
    <div id="func-view"></div>
    <div id="sv-view"></div>
    <div id="sym-view"></div>
    <div id="loading"><div class="spinner"></div><span id="loading-msg" data-i18n="loading">Loading...</span><button id="loading-cancel-btn" onclick="cancelRender()" data-i18n="cancelRender">✕ Cancel</button></div>
    <!-- VizBridge Chat Button (inside graph-wrap) -->
    <button id="chat-btn" title="VizCode AI (Alt+C)"></button>
  </div>
  <!-- Resizer handle -->
  <div id="resizer" style="display:none"></div>
  <!-- Code Panel (CodeViz-style) -->
  <div id="code-panel">
    <div id="cp-header">
      <div id="cp-file-bar">
        <span id="cp-ext-badge">.C</span>
        <span id="cp-filename" data-i18n="noFileSelected">No file selected</span>
        <div id="cp-view-toggle" style="display:none">
          <button class="cp-view-btn active" id="cp-view-code" type="button">Code</button>
          <button class="cp-view-btn" id="cp-view-rendered" type="button">Markdown</button>
        </div>
        <button id="cp-multisnip-btn" title="Multi-snippet mode (Structure View only)" style="display:none" onclick="cpToggleMultiSnip()">◫</button>
        <button id="cp-close" data-i18n-attr="data-tip" data-i18n="close">✕</button>
      </div>
      <div id="cp-func-bar">
        <span id="cp-func-name"></span>
        <span id="cp-func-badge" class="cp-func-badge cp-func-public">PUBLIC</span>
        <div id="cp-func-nav">
          <button class="cp-nav-btn" id="cp-prev-func" data-i18n-attr="data-tip" data-i18n="prevFunc">‹</button>
          <button class="cp-nav-btn" id="cp-next-func" data-i18n-attr="data-tip" data-i18n="nextFunc">›</button>
        </div>
      </div>
    </div>
    <div id="cp-body">
      <div id="cp-loading">
        <div class="spinner"></div>
        <span style="font-size:12px;color:var(--muted)" data-i18n="loadingSource">Loading source...</span>
      </div>
      <div id="cp-empty" style="display:none">
        <div class="cp-empty-icon">📁</div>
        <p data-i18n="clickFileToView">Click a file node to view source</p>
        <small data-i18n="clickFileHint">Single-click → preview · Double-click → drill in</small>
      </div>
      <div id="cp-code-wrap" style="display:none"></div>
    </div>
  </div>
</div>

<!-- Old info-panel (hidden, kept for JS compat) -->
<div id="info-panel" style="display:none">
  <div id="info-inner"><div id="info-title"></div><div id="info-sub"></div></div>
</div>

<div id="ctx-menu">
  <div class="ctx-item" id="ctx-copy"><span class="ctx-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></span> <span data-i18n="copyPath">Copy path</span></div>
  <div class="ctx-item" id="ctx-open-code"><span class="ctx-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></span> <span data-i18n="viewSource">View source</span></div>
  <div class="ctx-item" id="ctx-vscode"><span class="ctx-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg></span> <span data-i18n="openInVSCode">Open in VS Code</span></div>
  <div class="ctx-item" id="ctx-reveal-explorer"><span class="ctx-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></svg></span> <span data-i18n="revealInExplorer">Reveal in Explorer</span></div>
  <div class="ctx-sep"></div>
  <div class="ctx-item" id="ctx-pin"><span class="ctx-icon"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg></span> <span data-i18n="pinNode">Pin node</span></div>
</div>
<div id="tooltip"></div>

<!-- VizBridge Chat Panel -->
<div id="chat-panel">
  <div id="chat-header">
    <span id="chat-header-title">VizCode AI</span>
    <div style="display:flex;gap:6px;align-items:center">
      <button id="chat-hist-btn" title="Conversation history" style="background:none;border:none;color:var(--muted);cursor:pointer;padding:2px 5px;border-radius:4px;display:flex;align-items:center" aria-expanded="false"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><circle cx="10" cy="10" r="8"/><polyline points="10 6 10 10 13 12"/></svg></button>
      <button id="chat-new-btn" title="New conversation" style="background:none;border:none;color:var(--muted);cursor:pointer;padding:2px 5px;border-radius:4px;display:flex;align-items:center"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M10 4H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/><path d="M17 3a1.5 1.5 0 0 1 0 2.12L10.06 12H8v-2.06L14.88 3A1.5 1.5 0 0 1 17 3z"/></svg></button>
      <button id="chat-cfg-btn" title="Settings" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:14px;padding:2px 5px;border-radius:4px">⚙</button>
      <button id="chat-close">✕</button>
    </div>
  </div>
  <div id="chat-sessions-panel" aria-label="Conversation history"></div>
  <div id="chat-messages"></div>
  <div id="chat-input-area">
    <div id="chat-depth-picker">
      <input type="range" id="chat-depth-range" min="0" max="2" step="1">
      <span id="chat-depth-info-label"></span>
      <span id="chat-depth-info-desc"></span>
    </div>
    <div id="chat-output-picker"></div>
    <textarea id="chat-input" rows="2" placeholder="Ask about this codebase…"></textarea>
    <div id="chat-input-toolbar">
      <button id="chat-depth-btn" aria-expanded="false" aria-controls="chat-depth-picker"></button>
      <button id="chat-mode-btn" title="切換輸出模式" data-i18n="chatModePickerTitle" data-i18n-attr="title" aria-expanded="false" aria-haspopup="listbox" aria-controls="chat-output-picker"></button>
      <div id="chat-toolbar-spacer"></div>
      <button id="chat-send" title="Send"></button>
    </div>
  </div>
</div>
<div id="chat-config-modal" class="hidden">
  <div id="chat-config-box">
    <h3>AI Chat Setup</h3>
    <p>Choose a provider and enter your credentials to enable VizCode AI.</p>
    <div class="chat-cfg-row">
      <label>Provider</label>
      <select id="chat-cfg-provider">
        <option value="anthropic">Anthropic (Claude)</option>
        <option value="openai">OpenAI / Azure</option>
        <option value="grok">xAI Grok</option>
        <option value="gemini">Google Gemini</option>
        <option value="ollama">Ollama (local)</option>
        <option value="custom">Custom (OpenAI-compatible)</option>
      </select>
    </div>
    <!-- Anthropic fields -->
    <div class="chat-cfg-section" data-provider="anthropic">
      <div class="chat-cfg-row">
        <div class="chat-cfg-label-row">
          <label>API Key</label>
          <button type="button" class="chat-cfg-folder-btn" data-open-key-folder title="Open local key folder" aria-label="Open local key folder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <path d="M3 10h18"/>
            </svg>
          </button>
        </div>
        <div class="chat-cfg-key-meta" id="chat-cfg-anthropic-key-status"></div>
        <input type="password" id="chat-cfg-anthropic-key" placeholder="Leave blank to keep stored key" autocomplete="off" />
      </div>
      <div class="chat-cfg-row">
        <label>Model</label>
        <input type="text" id="chat-cfg-anthropic-model" placeholder="claude-sonnet-4-6" />
      </div>
    </div>
    <!-- OpenAI fields -->
    <div class="chat-cfg-section" data-provider="openai" style="display:none">
      <div class="chat-cfg-row">
        <div class="chat-cfg-label-row">
          <label>API Key</label>
          <button type="button" class="chat-cfg-folder-btn" data-open-key-folder title="Open local key folder" aria-label="Open local key folder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <path d="M3 10h18"/>
            </svg>
          </button>
        </div>
        <div class="chat-cfg-key-meta" id="chat-cfg-openai-key-status"></div>
        <input type="password" id="chat-cfg-openai-key" placeholder="Leave blank to keep stored key" autocomplete="off" />
      </div>
      <div class="chat-cfg-row">
        <label>Model</label>
        <input type="text" id="chat-cfg-openai-model" placeholder="gpt-4o" />
      </div>
      <div class="chat-cfg-row">
        <label>Base URL <span style="font-weight:400;opacity:.6">(Azure / proxy)</span></label>
        <input type="text" id="chat-cfg-openai-base-url" placeholder="https://api.openai.com/v1/chat/completions" />
      </div>
    </div>
    <!-- Grok fields -->
    <div class="chat-cfg-section" data-provider="grok" style="display:none">
      <div class="chat-cfg-row">
        <div class="chat-cfg-label-row">
          <label>API Key</label>
          <button type="button" class="chat-cfg-folder-btn" data-open-key-folder title="Open local key folder" aria-label="Open local key folder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <path d="M3 10h18"/>
            </svg>
          </button>
        </div>
        <div class="chat-cfg-key-meta" id="chat-cfg-grok-key-status"></div>
        <input type="password" id="chat-cfg-grok-key" placeholder="Leave blank to keep stored key" autocomplete="off" />
      </div>
      <div class="chat-cfg-row">
        <label>Model</label>
        <input type="text" id="chat-cfg-grok-model" placeholder="grok-4.20" />
      </div>
    </div>
    <!-- Gemini fields -->
    <div class="chat-cfg-section" data-provider="gemini" style="display:none">
      <div class="chat-cfg-row">
        <div class="chat-cfg-label-row">
          <label>API Key</label>
          <button type="button" class="chat-cfg-folder-btn" data-open-key-folder title="Open local key folder" aria-label="Open local key folder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <path d="M3 10h18"/>
            </svg>
          </button>
        </div>
        <div class="chat-cfg-key-meta" id="chat-cfg-gemini-key-status"></div>
        <input type="password" id="chat-cfg-gemini-key" placeholder="Leave blank to keep stored key" autocomplete="off" />
      </div>
      <div class="chat-cfg-row">
        <label>Model</label>
        <input type="text" id="chat-cfg-gemini-model" placeholder="gemini-2.0-flash" />
      </div>
    </div>
    <!-- Ollama fields -->
    <div class="chat-cfg-section" data-provider="ollama" style="display:none">
      <div class="chat-cfg-row">
        <label>Ollama URL</label>
        <input type="text" id="chat-cfg-ollama-url" placeholder="http://localhost:11434" />
      </div>
      <div class="chat-cfg-row">
        <label>Model</label>
        <input type="text" id="chat-cfg-ollama-model" placeholder="llama3.1" />
      </div>
    </div>
    <!-- Custom (OpenAI-compatible) fields -->
    <div class="chat-cfg-section" data-provider="custom" style="display:none">
      <div class="chat-cfg-row">
        <div class="chat-cfg-label-row">
          <label>API Key</label>
          <button type="button" class="chat-cfg-folder-btn" data-open-key-folder title="Open local key folder" aria-label="Open local key folder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
              <path d="M3 10h18"/>
            </svg>
          </button>
        </div>
        <div class="chat-cfg-key-meta" id="chat-cfg-custom-key-status"></div>
        <input type="password" id="chat-cfg-custom-key" placeholder="Leave blank to keep stored key" autocomplete="off" />
      </div>
      <div class="chat-cfg-row">
        <label>Base URL</label>
        <input type="text" id="chat-cfg-custom-base-url" placeholder="https://openrouter.ai/api/v1" />
      </div>
      <div class="chat-cfg-row">
        <label>Model</label>
        <input type="text" id="chat-cfg-custom-model" placeholder="meta-llama/llama-3.1-8b-instruct:free" />
      </div>
    </div>
    <button id="chat-config-save">Save</button>
    <button id="chat-config-cancel">Cancel</button>
  </div>
</div>

<!-- Data embedded as JSON text — parsed by JSON.parse(), not JS engine (10x faster) -->
<script type="application/json" id="viz-data">{DATA}</script>
<script>(function(){{
  var l=document.getElementById('loading');
  var m=document.getElementById('loading-msg');
  if(l){{l.className='show';}}
  if(m){{m.textContent='⏳ Parsing graph data...';}}
  document.getElementById('cp-loading').classList.add('hidden');
  document.getElementById('cp-empty').style.display='';
}})();</script>
<script>{JS}</script>
</body>
</html>"""

# Keep HTML_TEMPLATE as alias for backward compat (server.py uses it)
HTML_TEMPLATE = HTML_SKELETON


# ─── build_html ───────────────────────────────────────────────────────────────
def build_html(data: dict, job_id: str = None) -> str:
    """Read shared static assets and embed them inline into the HTML skeleton."""
    base = _ROOT_DIR / 'static'
    css_assets = [base / 'viz.css', base / 'themes.css', base / 'symbol_view' / 'symbol_view.css', base / 'viz_chat.css']
    js_assets = [
        base / 'i18n.js',
        base / 'viz_utils.js',
        base / 'viz_state.js',
        base / 'viz_constants.js',
        base / 'viz_preferences.js',
        base / 'viz_code_panel.js',
        base / 'file_viewers' / 'viz_office.js',
        base / 'file_viewers' / 'viz_pdf.js',
        base / 'file_viewers' / 'viz_markdown.js',
        base / 'viz_toolbar.js',
        base / 'viz_sidebar.js',
        base / 'viz_graph.js',
        base / 'viz_search.js',
        base / 'viz_dashboard.js',
        base / 'galaxy' / 'viz_galaxy.js',          # state, constants, UI, Sigma, reducers
        base / 'galaxy' / 'viz_galaxy_physics.js',   # FA2 physics (BH, FA2, Noverlap)
        base / 'galaxy' / 'viz_galaxy_graph.js',     # graph building + initial positions
        base / 'viz_layout.js',
        base / 'viz_chat.js',
        base / 'viz.js',              # boot — must be last of viz_* files
        base / 'symbol_view' / 'sv_core.js',    # state, DOM lifecycle, public API
        base / 'symbol_view' / 'sv_search.js',  # fuzzy search dropdown
        base / 'symbol_view' / 'sv_graph.js',   # SVG renderer + animation
    ]
    missing = [p for p in css_assets + js_assets if not p.exists()]

    if missing:
        missing_str = '\n  '.join(str(p) for p in missing)
        raise FileNotFoundError(f'Missing static files. Expected:\n  {missing_str}')

    css = '\n\n'.join(p.read_text(encoding='utf-8') for p in css_assets)
    js = '\n\n'.join(p.read_text(encoding='utf-8') for p in js_assets)

    def _json_default(o):
        if isinstance(o, (set, frozenset)): return sorted(o)
        raise TypeError(f'Not serialisable: {type(o)}')
    json_str     = json.dumps(data, ensure_ascii=False, separators=(',', ':'), default=_json_default)
    root_name    = Path(data['stats']['root']).name or 'VIZCODE'
    job_id_json  = json.dumps(job_id)   # "null" or '"abc1234"'
    pt           = data.get('project_type', {})
    pt_json      = json.dumps(pt, default=_json_default)

    return HTML_SKELETON.format(
        CSS=css, JS=js,
        DATA=json_str,
        root_name=root_name,
        JOB_ID_JSON=job_id_json,
        PT_JSON=pt_json,
    )


# ─── inject_data (legacy, used by server.py) ─────────────────────────────────
def inject_data(html: str, data: dict) -> str:
    """Legacy helper — now calls build_html() directly."""
    return build_html(data, job_id=None)


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
        json_str = json.dumps(data, ensure_ascii=False, separators=(',', ':'), default=_json_default)
        pt_json  = json.dumps(pt, default=_json_default)
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


if __name__ == '__main__':
    main()
