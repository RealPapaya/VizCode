"""
parsers/asm_parser.py — Assembly parser

Handles assembly source across dialects:
  Assembly             .asm .s .S .nasm   (NASM/Intel · GNU as/AT&T · MASM · CPP-.S)

Entry point:
  scan_asm(src, ext) → 6-tuple
  (refs, funcdefs, funccalls, extra_dict, func_calls_by_func, symbol_defs)
"""

import re

RE_INCLUDE = re.compile(r'#\s*include\s+["<]([^">]+)[">]')

RE_ASM_INC_NASM = re.compile(r'^\s*%include\s+["\']([^"\']+)["\']', re.MULTILINE)
RE_ASM_INC_GAS  = re.compile(r'^\s*\.include\s+["\']([^"\']+)["\']', re.MULTILINE)
RE_ASM_INC_MASM = re.compile(r'^\s*INCLUDE\s+(\S+)', re.MULTILINE | re.IGNORECASE)
RE_ASM_LABEL    = re.compile(r'^([A-Za-z_][\w$@.]*)\s*:', re.MULTILINE)
RE_ASM_PROC     = re.compile(r'^([A-Za-z_]\w*)\s+PROC\b', re.MULTILINE | re.IGNORECASE)
RE_ASM_TYPEFN   = re.compile(r'\.type\s+([A-Za-z_][\w$.]*)\s*,\s*[@%]function', re.IGNORECASE)
RE_ASM_CALL     = re.compile(r'\b(?:call|callq|bl|blx)\s+([A-Za-z_][\w$@.]*)', re.IGNORECASE)
# Directives / mnemonics that can appear in `name:` position but are not symbols.
_ASM_SKIP = {
    'section', 'global', 'extern', 'public', 'proc', 'endp', 'ends', 'end',
    'byte', 'word', 'dword', 'qword', 'align', 'times', 'struc', 'endstruc',
    'macro', 'endm', 'equ', 'db', 'dw', 'dd', 'dq', 'dt',
    'resb', 'resw', 'resd', 'resq',
}

ASM_EXTENSIONS = {'.asm', '.s', '.S', '.nasm'}


def _strip_asm_comments(src: str) -> str:
    """Mask assembly comments while preserving line numbers.

    Handles `;` (NASM/MASM) and C-style `//` / `/* */`. Lines beginning with `#`
    are kept so the C preprocessor `#include` in .S files survives.
    """
    src = re.sub(r'/\*.*?\*/', lambda m: '\n' * m.group(0).count('\n'),
                 src, flags=re.DOTALL)
    out = []
    for line in src.split('\n'):
        line = re.sub(r'//.*$', '', line)
        line = re.sub(r';.*$', '', line)
        out.append(line)
    return '\n'.join(out)


def scan_asm(src: str, ext: str = ''):
    """Parse assembly (NASM/Intel, GNU as/AT&T, MASM, CPP-preprocessed .S).

    Includes become file refs; top-level labels / PROC become funcdefs + symbol
    defs; `call`/`bl` targets become per-function calls. Local labels (leading
    `.`) and names shorter than 3 chars are skipped to avoid false symbols.
    """
    clean = _strip_asm_comments(src)

    refs = (RE_ASM_INC_NASM.findall(clean) + RE_ASM_INC_GAS.findall(clean)
            + RE_INCLUDE.findall(clean) + RE_ASM_INC_MASM.findall(clean))
    refs = [r.strip('"\'<>') for r in refs if r and r.strip('"\'<>')]

    # Collect definition sites (offset, name), de-duplicated, in source order.
    defs, seen = [], set()
    for rx in (RE_ASM_LABEL, RE_ASM_PROC):
        for m in rx.finditer(clean):
            name = m.group(1)
            if len(name) < 3 or name.lower() in _ASM_SKIP or name in seen:
                continue
            seen.add(name)
            defs.append((m.start(), name))
    defs.sort()

    bounds = [off for off, _ in defs] + [len(clean)]
    funcdefs, func_calls_by_func, symbol_defs = [], [], []
    for i, (off, name) in enumerate(defs):
        body = clean[off:bounds[i + 1]]
        calls = [c for c in RE_ASM_CALL.findall(body) if len(c) >= 2]
        funcdefs.append({'label': name, 'is_efiapi': False, 'is_static': False})
        func_calls_by_func.append(calls)
        line_no = clean[:off].count('\n') + 1
        symbol_defs.append({
            'kind': 'function', 'name': name, 'line': line_no, 'end_line': line_no,
            'bases': [], 'parent': None, 'is_public': True,
        })

    funccalls = list(dict.fromkeys(
        c for c in RE_ASM_CALL.findall(clean) if len(c) >= 2
    ))
    return refs, funcdefs, funccalls, None, func_calls_by_func, symbol_defs
