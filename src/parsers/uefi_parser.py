"""
parsers/uefi_parser.py — UEFI / EDK II spec-backed parser

Handles EDK II build-system and UEFI HII file types:
  EDK II build system  .inf .dec .dsc .fdf
  UEFI HII             .vfr .uni

Vendor-specific formats (.sdl/.sd/.cif/.hfr, .mak) are NOT
handled here — they are covered best-effort by common_parser's cross-vendor regex.

Entry point:
  scan_uefi(src, ext) → 6-tuple
  (refs, funcdefs, funccalls, extra_dict, func_calls_by_func, symbol_defs)
"""

import re
from collections import defaultdict

RE_INCLUDE = re.compile(r'#\s*include\s+["<]([^">]+)[">]')

# VFR (UEFI HII IFR)
_RE_STR_TOKEN   = re.compile(r'\bSTRING_TOKEN\s*\(\s*(\w+)\s*\)', re.IGNORECASE)
_RE_VFR_FORMSET = re.compile(
    r'\bformset\s+guid\s*=\s*\{([^}]+)\}\s*,\s*title\s*=\s*STRING_TOKEN\s*\(\s*(\w+)\s*\)',
    re.IGNORECASE | re.DOTALL
)
_RE_VFR_FORM    = re.compile(
    r'\bform\s+formid\s*=\s*(\d+)\s*,\s*title\s*=\s*STRING_TOKEN\s*\(\s*(\w+)\s*\)',
    re.IGNORECASE
)
# Standard UEFI HII interactive question key: `key = <number>`.
# (Vendor-specific callback macros are intentionally excluded — handled
#  best-effort by common_parser, not by this spec-pure VFR path.)
_RE_VFR_CB      = re.compile(r'\bkey\s*=\s*(0x[0-9A-Fa-f]+|\d+)\b', re.IGNORECASE)
_RE_VFR_LABEL   = re.compile(r'\blabel\s+(0x[0-9A-Fa-f]+|\w+)', re.IGNORECASE)


# ─── INF/DEC/DSC/FDF ini-style section helpers ────────────────────────────────

def _parse_ini_sections(src: str) -> dict:
    """Parse [Section] key=val style files into a dict of lists."""
    sections = defaultdict(list)
    current  = None
    for line in src.splitlines():
        line = line.strip()
        line = re.sub(r'\s*#.*$', '', line)
        if not line:
            continue
        m = re.match(r'^\[([^\]]+)\]', line)
        if m:
            current = m.group(1).strip().lower()
            continue
        if current is not None:
            sections[current].append(line)
    return dict(sections)


def _section_family(secs: dict, name: str) -> list:
    """Collect all lines belonging to a section *family*.

    EDK II sections carry optional .Arch and .Arch.ModuleType suffixes
    (e.g. [Sources], [Sources.IA32], [LibraryClasses.X64.DXE_DRIVER]).
    _parse_ini_sections lowercases headers, so match `name` exactly or as a
    dotted prefix to avoid silently dropping architecture-specific entries.
    """
    name = name.lower()
    out = []
    for key, lines in secs.items():
        if key == name or key.startswith(name + '.'):
            out.extend(lines)
    return out


def _section_files(lines: list) -> list:
    """Extract bare filenames/paths from section lines."""
    result = []
    for ln in lines:
        ln = re.sub(r'\$\([^)]+\)', '', ln).strip()
        if ln and not ln.startswith('#'):
            token = re.split(r'[\s|]', ln)[0]
            if token:
                result.append(token)
    return result


# ─── EDK2 parsers ──────────────────────────────────────────────────────────────

def scan_inf(src: str) -> dict:
    """
    Parse EDK2 INF module description.
    Returns: sources, packages, libraries, guids, protocols, ppis, depex, meta
    """
    secs = _parse_ini_sections(src)
    meta = {}
    for ln in _section_family(secs, 'defines'):
        if '=' in ln:
            k, _, v = ln.partition('=')
            meta[k.strip()] = v.strip()
    sources   = _section_files(_section_family(secs, 'sources'))
    packages  = _section_files(_section_family(secs, 'packages'))
    libraries = _section_files(_section_family(secs, 'libraryclasses'))
    guids     = _section_files(_section_family(secs, 'guids'))
    protocols = _section_files(_section_family(secs, 'protocols'))
    ppis      = _section_files(_section_family(secs, 'ppis'))
    depex     = ' '.join(_section_family(secs, 'depex')).strip()
    return {
        'sources': sources, 'packages': packages,
        'libraries': libraries, 'guids': guids,
        'protocols': protocols, 'ppis': ppis,
        'depex': depex, 'meta': meta,
    }


def scan_dec(src: str) -> dict:
    """Parse EDK2 DEC package declaration.

    Returns: guids, protocols, ppis, libraries, includes, meta.
    Guid/Protocol/Ppi C-names feed analyze_viz's guid_name_to_dec index so
    [Guids]/[Ppis]/[Protocols] references in INF files resolve to this DEC.
    """
    secs = _parse_ini_sections(src)
    meta = {}
    for ln in _section_family(secs, 'defines'):
        if '=' in ln:
            k, _, v = ln.partition('=')
            meta[k.strip()] = v.strip()
    return {
        'guids':     _section_files(_section_family(secs, 'guids')),
        'protocols': _section_files(_section_family(secs, 'protocols')),
        'ppis':      _section_files(_section_family(secs, 'ppis')),
        'libraries': _section_files(_section_family(secs, 'libraryclasses')),
        'includes':  _section_files(_section_family(secs, 'includes')),
        'meta':      meta,
    }


def scan_dsc(src: str) -> dict:
    """Parse EDK2 DSC platform description.

    Returns: components (.inf module paths), libraries (.inf instance paths
    from [LibraryClasses] LibClassName|Path.inf mappings), includes (!include
    targets).
    """
    secs = _parse_ini_sections(src)

    components = []
    for key, lines in secs.items():
        if not (key == 'components' or key.startswith('components.')):
            continue
        depth = 0  # brace nesting of override sub-blocks: Module.inf { ... }
        for ln in lines:
            opens, closes = ln.count('{'), ln.count('}')
            if depth > 0:  # inside an override sub-block — skip its entries
                depth += opens - closes
                continue
            base = re.sub(r'\$\([^)]+\)', '', ln.split('{')[0]).strip()
            if base and not base.startswith('#') and base.lower().endswith('.inf'):
                components.append(base)
            depth += opens - closes

    libraries = []
    for ln in _section_family(secs, 'libraryclasses'):
        # DSC mapping form:  LibraryClassName|Path/To/Instance.inf
        if '|' in ln:
            inst = re.sub(r'\$\([^)]+\)', '', ln.split('|', 1)[1]).strip()
            if inst.lower().endswith('.inf'):
                libraries.append(inst)

    includes = [
        re.sub(r'\$\([^)]+\)', '', m.group(1)).strip()
        for m in re.finditer(r'^\s*!include\s+(\S+)', src, re.MULTILINE | re.IGNORECASE)
    ]
    includes = [i for i in includes if i]

    return {'components': components, 'libraries': libraries, 'includes': includes}


def scan_fdf(src: str) -> dict:
    """Parse EDK2 FDF flash descriptor.

    Returns:
      infs     — module .inf paths from `INF [Options] Path.inf` statements
                 (options such as VERSION=/USE=/RULE_OVERRIDE=/UI= are skipped)
      files    — leaf file references from FILE / SECTION = FileName statements
      includes — `!include` fragment targets
    """
    infs, files = [], []
    for raw in src.splitlines():
        ln = re.sub(r'\s*#.*$', '', raw).strip()
        if not ln:
            continue
        head = ln.split(None, 1)[0].upper()
        if head == 'INF':
            # Path is the token ending in .inf (after any KEY = value options).
            for tok in re.findall(r'(\S+\.inf)\b', ln, re.IGNORECASE):
                tok = re.sub(r'\$\([^)]+\)', '', tok).strip()
                if tok:
                    infs.append(tok)
        elif head == 'FILE':
            # Simple form: FILE Type GUID [Options] FileName.
            # A $() macro in a leaf path denotes a build artifact → skip it.
            m = re.search(r'(\S+\.\w+)\s*$', ln.split('{')[0])
            if m and '$(' not in m.group(1):
                files.append(m.group(1).strip())
        elif head == 'SECTION':
            # SECTION <TYPE> = FileName   (skip macro/build paths + quoted strings)
            m = re.search(r'=\s*([^"\s]+\.\w+)\s*$', ln)
            if m and '$(' not in m.group(1):
                files.append(m.group(1).strip())

    includes = [
        re.sub(r'\$\([^)]+\)', '', m.group(1)).strip()
        for m in re.finditer(r'^\s*!include\s+(\S+)', src, re.MULTILINE | re.IGNORECASE)
    ]
    includes = [i for i in includes if i]

    return {'infs': infs, 'files': files, 'includes': includes}


# ─── HII parsers (UEFI spec only) ─────────────────────────────────────────────

def scan_vfr(src: str) -> dict:
    """Parse UEFI standard VFR (Visual/Internal Forms Representation).

    Covers only what the UEFI HII specification defines: #include of headers /
    .uni string packages, formset/form declarations, STRING_TOKEN references,
    interactive `key = <n>` and `label` opcodes. Vendor IFR extensions are out
    of scope (handled best-effort by common_parser).
    """
    includes     = RE_INCLUDE.findall(src)
    uni_includes = [f for f in includes if f.lower().endswith('.uni')]
    str_refs     = list(set(_RE_STR_TOKEN.findall(src)))
    formsets     = [
        {'guid': m.group(1).strip(), 'title_token': m.group(2)}
        for m in _RE_VFR_FORMSET.finditer(src)
    ]
    forms        = [
        {'formid': m.group(1), 'title_token': m.group(2)}
        for m in _RE_VFR_FORM.finditer(src)
    ]
    cb_keys      = _RE_VFR_CB.findall(src)
    labels       = _RE_VFR_LABEL.findall(src)
    return {
        'includes': includes, 'uni_includes': uni_includes,
        'str_refs': str_refs, 'formsets': formsets, 'forms': forms,
        'cb_keys': cb_keys, 'labels': labels,
    }


def scan_uni(src: str) -> dict:
    """
    Parse UEFI UNI Unicode String Package.
    Returns: string_names, languages, lang_defs, token_count, includes
    """
    src = src.lstrip('﻿')
    RE_STR_DECL = re.compile(r'^#string\s+(\w+)',    re.MULTILINE | re.IGNORECASE)
    RE_LANG     = re.compile(r'^#language\s+(\S+)',  re.MULTILINE | re.IGNORECASE)
    RE_LANGDEF  = re.compile(r'^#langdef\s+(\S+)\s+"([^"]*)"', re.MULTILINE | re.IGNORECASE)
    RE_UNI_INC  = re.compile(r'^#include\s+"([^"]+)"', re.MULTILINE | re.IGNORECASE)
    string_names = list(set(RE_STR_DECL.findall(src)))
    languages    = list(set(RE_LANG.findall(src)))
    lang_defs    = [(m.group(1), m.group(2)) for m in RE_LANGDEF.finditer(src)]
    includes     = RE_UNI_INC.findall(src)
    return {
        'string_names': string_names, 'languages': languages,
        'lang_defs': lang_defs, 'token_count': len(string_names),
        'includes': includes,
    }


# ─── Main entry point ──────────────────────────────────────────────────────────

UEFI_EXTENSIONS = {'.inf', '.dec', '.dsc', '.fdf', '.vfr', '.uni'}


def scan_uefi(src: str, ext: str):
    """
    UEFI / EDK II parser entry point.

    Returns the standard 6-tuple:
        (refs, funcdefs, funccalls, extra_dict, func_calls_by_func, symbol_defs)
    """
    ext = ext.lower()

    if ext == '.inf':
        data = scan_inf(src)
        refs = data['sources'] + data['packages'] + data['libraries']
        return refs, [], [], data, [], []

    if ext == '.dec':
        data = scan_dec(src)
        return [], [], [], data, [], []

    if ext == '.dsc':
        data = scan_dsc(src)
        refs = data['components'] + data['libraries'] + data['includes']
        return refs, [], [], data, [], []

    if ext == '.fdf':
        data = scan_fdf(src)
        refs = data['infs'] + data['files'] + data['includes']
        return refs, [], [], data, [], []

    if ext == '.vfr':
        data = scan_vfr(src)
        return data['includes'], [], [], data, [], []

    if ext == '.uni':
        data = scan_uni(src)
        return data['includes'], [], [], data, [], []

    return [], [], [], None, [], []
