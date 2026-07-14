#!/usr/bin/env python3
"""
core/harness_scan.py — VizCode AI Harness Scan

Scores a repository 0–10 on AI-harness maturity across six dimensions.
All signals are file-existence checks and bounded content probes (stdlib only,
no network, each file read capped at 128 KB). Points accumulate per dimension
and are clamped to 10 before weighting.

Dimensions and weights:
    instructions       20%  Context-engineering artifacts (CLAUDE.md, AGENTS.md, …)
    harness_config     15%  Harness config dirs and tool configs (.claude/, .mcp.json, …)
    loop_engineering   20%  Verifiable feedback loops (tests/, CI workflows, lint)
    memory_learning    15%  Self-learning artifacts (LESSONS.md, CHANGELOG, ADRs)
    delegation         15%  Multi-agent structural artifacts (.claude/agents/*.md)
    safety_governance  15%  Guardrails, permissions, secrets hygiene

Level thresholds (composite score):
    0–2   none_adhoc
    2–4   basic
    4–6   structured
    6–8   engineered
    8–10  self_improving  (also requires memory_learning >= 6)
"""

import glob
import json
import os
import re
from pathlib import Path

_MAX_READ = 128 * 1024   # 128 KB cap per bounded read

WEIGHTS = {
    'instructions':      0.20,
    'harness_config':    0.15,
    'loop_engineering':  0.20,
    'memory_learning':   0.15,
    'delegation':        0.15,
    'safety_governance': 0.15,
}

_DIMS = list(WEIGHTS)


# ─── Low-level helpers ────────────────────────────────────────────────────────

def _read(path: str) -> str:
    """Read up to _MAX_READ bytes; return '' on any error."""
    try:
        with open(path, 'rb') as fh:
            return fh.read(_MAX_READ).decode('utf-8', errors='ignore')
    except Exception:
        return ''


def _lc(text: str) -> int:
    return len(text.splitlines())


def _rel(root: str, full: str) -> str:
    """Repo-relative posix path."""
    try:
        return Path(full).relative_to(root).as_posix()
    except ValueError:
        return Path(full).name


def _ef(path_rel: str, signal: str, pts: float) -> dict:
    return {'path': path_rel, 'signal': signal, 'points': pts}


def _jp(root: str, *parts: str) -> str:
    return os.path.join(root, *parts)


def _isf(root: str, *parts: str) -> str:
    p = _jp(root, *parts)
    return p if os.path.isfile(p) else ''


def _isd(root: str, *parts: str) -> str:
    p = _jp(root, *parts)
    return p if os.path.isdir(p) else ''


def _find(root: str, *parts: str) -> list:
    return glob.glob(_jp(root, *parts))


# ─── Per-dimension probes ─────────────────────────────────────────────────────

def _probe_instructions(root: str) -> tuple:
    ev, miss = [], []
    raw = 0.0

    _PRINCIPAL = [
        ('CLAUDE.md',                       8.0, 'CLAUDE.md instruction file'),
        ('AGENTS.md',                       6.0, 'AGENTS.md instruction file'),
        ('GEMINI.md',                       3.0, 'GEMINI.md instruction file'),
        ('.github/copilot-instructions.md', 3.0, 'copilot-instructions.md'),
    ]
    found = []  # (rel, line_count)
    for rel, pts, sig in _PRINCIPAL:
        p = _isf(root, *rel.split('/'))
        if p:
            lc = _lc(_read(p))
            ev.append(_ef(rel, sig, pts))
            raw += pts
            found.append((rel, lc))

    if found:
        # Content-size bonus: any instruction file > 50 lines has real content
        for rel, lc in found:
            if lc > 50:
                ev.append(_ef(rel, f'{lc}-line instruction content', 2.0))
                raw += 2.0
                break

        # Thin-index bonus: >=2 instruction files AND any <=150 lines
        if len(found) >= 2 and any(0 < lc <= 150 for _, lc in found):
            thin = next(r for r, lc in found if 0 < lc <= 150)
            ev.append(_ef(thin, 'thin-index instruction file (<=150 lines)', 2.0))
            raw += 2.0

        if any(lc > 400 for _, lc in found):
            miss.append('instruction file >400 lines — split into thin index + referenced files')
    else:
        miss.append('no principal instruction file (CLAUDE.md, AGENTS.md, GEMINI.md)')

    # IDE/agent rule files
    for rel, pts, sig in [
        ('.cursorrules',    2.0, '.cursorrules'),
        ('.cursor/rules',   2.0, '.cursor/rules'),
        ('.windsurf/rules', 2.0, '.windsurf/rules'),
    ]:
        if os.path.exists(_jp(root, *rel.split('/'))):
            ev.append(_ef(rel, sig, pts))
            raw += pts

    return ev, miss, min(raw, 10.0)


def _probe_harness_config(root: str) -> tuple:
    ev, miss = [], []
    raw = 0.0

    for rel, pts, sig in [
        ('.claude/settings.json',       4.0, '.claude/settings.json'),
        ('.claude/settings.local.json', 2.0, '.claude/settings.local.json'),
        ('.mcp.json',                   4.0, '.mcp.json MCP config'),
    ]:
        if _isf(root, *rel.split('/')):
            ev.append(_ef(rel, sig, pts))
            raw += pts

    for rel, pts, sig in [
        ('.claude/hooks',    2.0, '.claude/hooks/'),
        ('.claude/commands', 2.0, '.claude/commands/'),
        ('.claude/skills',   2.0, '.claude/skills/'),
        ('.claude/agents',   3.0, '.claude/agents/'),
        ('.gemini',          2.0, '.gemini/'),
        ('.cursor',          2.0, '.cursor/'),
        ('.windsurf',        2.0, '.windsurf/'),
    ]:
        if _isd(root, *rel.split('/')):
            ev.append(_ef(rel + '/', sig, pts))
            raw += pts

    if raw == 0.0:
        miss.append('no harness config (.claude/, .mcp.json, .cursor/, .gemini/)')
    if not _isf(root, '.mcp.json') and not _isf(root, '.claude', 'mcp.json'):
        miss.append('no MCP tool config (.mcp.json)')

    return ev, miss, min(raw, 10.0)


_TEST_RE = re.compile(
    r'pytest|npm\s+run\s+test|npm\s+test|go\s+test|cargo\s+test|jest\b|vitest\b', re.I
)


def _probe_loop_engineering(root: str, instr_rels: list) -> tuple:
    ev, miss = [], []
    raw = 0.0

    td = _isd(root, 'tests')
    if td:
        ev.append(_ef('tests/', 'tests/ directory', 2.0))
        raw += 2.0
        tf = _find(root, 'tests', 'test_*.py') + _find(root, 'tests', '*_test.py')
        if tf:
            ev.append(_ef('tests/', f'{len(tf)} test file(s)', 3.0))
            raw += 3.0
        else:
            miss.append('tests/ exists but no test_*.py files found')
    else:
        miss.append('no tests/ directory')

    wf = _find(root, '.github', 'workflows', '*.yml') + _find(root, '.github', 'workflows', '*.yaml')
    if wf:
        ev.append(_ef('.github/workflows/' + os.path.basename(wf[0]), 'CI workflow', 4.0))
        raw += 4.0
    else:
        miss.append('no CI workflow (.github/workflows/*.yml)')

    for rel, pts, sig in [
        ('pyproject.toml',   1.5, 'pyproject.toml'),
        ('ruff.toml',        1.0, 'ruff.toml'),
        ('.eslintrc.json',   1.0, '.eslintrc.json'),
        ('.eslintrc.js',     1.0, '.eslintrc.js'),
        ('eslint.config.js', 1.0, 'eslint.config.js'),
        ('Makefile',         1.0, 'Makefile'),
        ('package.json',     0.5, 'package.json'),
    ]:
        if _isf(root, rel):
            ev.append(_ef(rel, sig, pts))
            raw += pts

    # Bonus: instruction file mentions a test command
    for rel in instr_rels:
        if _TEST_RE.search(_read(_jp(root, *rel.split('/')))):
            ev.append(_ef(rel, 'instruction file states test command', 2.0))
            raw += 2.0
            break

    return ev, miss, min(raw, 10.0)


_SLUG_RE = re.compile(r'##\s+\S+-\S+\s+\(\d{4}-\d{2}-\d{2}\)')


def _probe_memory_learning(root: str) -> tuple:
    ev, miss = [], []
    raw = 0.0

    lp = _isf(root, 'LESSONS.md')
    if lp:
        ev.append(_ef('LESSONS.md', 'LESSONS.md', 5.0))
        raw += 5.0
        if _SLUG_RE.search(_read(lp)):
            ev.append(_ef('LESSONS.md', 'dated-slug lesson entries', 4.0))
            raw += 4.0
        else:
            miss.append('LESSONS.md lacks dated-slug format (## slug (YYYY-MM-DD))')
    else:
        miss.append('no LESSONS.md')

    for pat in ('memory*.md', 'MEMORY*.md'):
        hits = _find(root, pat)
        if hits:
            ev.append(_ef(_rel(root, hits[0]), 'memory file', 2.0))
            raw += 2.0
            break

    hits = _find(root, '.claude', 'memory', '*.md')
    if hits:
        ev.append(_ef('.claude/memory/', '.claude/memory/ learning files', 2.0))
        raw += 2.0

    for rel in ('CHANGELOG.md', 'CHANGELOG'):
        if _isf(root, rel):
            ev.append(_ef(rel, rel, 3.0))
            raw += 3.0
            break

    for d in ('docs/adr', 'docs/decisions', 'ADR', 'adr'):
        if _isd(root, *d.split('/')):
            ev.append(_ef(d + '/', 'ADR/decision docs', 2.0))
            raw += 2.0
            break

    if raw == 0.0:
        miss.append('no memory/learning artifacts (LESSONS.md, CHANGELOG, ADRs)')

    return ev, miss, min(raw, 10.0)


_DELEG_RE = re.compile(r'\b(subagent|dispatch|delegate|orchestrat)\w*\b', re.I)


def _probe_delegation(root: str, instr_rels: list) -> tuple:
    ev, miss = [], []
    raw = 0.0

    # Structural artifacts carry most points (R6)
    agent_mds = _find(root, '.claude', 'agents', '*.md')
    for amd in agent_mds[:2]:  # cap at 2 × 3 pts = 6 max
        ev.append(_ef(_rel(root, amd), 'subagent definition file', 3.0))
        raw += 3.0

    for wdir in ('workflow', 'workflows', 'agents'):
        if _isd(root, wdir):
            defs = (_find(root, wdir, '*.md') +
                    _find(root, wdir, '*.yaml') +
                    _find(root, wdir, '*.yml'))
            if defs:
                ev.append(_ef(wdir + '/', f'{len(defs)} workflow definition(s)', 3.0))
                raw += 3.0
                break

    for pat in ('dispatch*.md', '*dispatch*.md', '*subagent*.md'):
        hits = _find(root, pat) + _find(root, '.claude', pat)
        if hits:
            ev.append(_ef(_rel(root, hits[0]), 'dispatch/subagent file', 2.0))
            raw += 2.0
            break

    # Keyword prose in instruction files — capped at 1.0 pt total (R6)
    prose = 0.0
    for rel in instr_rels:
        if prose >= 1.0:
            break
        m = _DELEG_RE.findall(_read(_jp(root, *rel.split('/'))))
        if m:
            add = min(0.5, 1.0 - prose)
            ev.append(_ef(rel, f'delegation keywords ({len(m)} match(es))', add))
            raw += add
            prose += add

    if raw < 1.0:
        miss.append('no delegation artifacts (.claude/agents/*.md, workflow definitions)')

    return ev, miss, min(raw, 10.0)


_SAFE_RE = re.compile(
    r'\b(do\s+not\s+touch|never\s+touch|do\s+not\s+edit|prohibit|never\s+commit)\b', re.I
)


def _probe_safety_governance(root: str, instr_rels: list) -> tuple:
    ev, miss = [], []
    raw = 0.0

    sp = _isf(root, '.claude', 'settings.json')
    if sp:
        try:
            cfg = json.loads(_read(sp))
        except Exception:
            cfg = {}
        if isinstance(cfg, dict) and ('permissions' in cfg or 'allow' in cfg or 'deny' in cfg):
            ev.append(_ef('.claude/settings.json', 'harness permissions block', 4.0))
            raw += 4.0
        else:
            ev.append(_ef('.claude/settings.json', 'settings file (no permissions block)', 1.0))
            raw += 1.0

    gi = _isf(root, '.gitignore')
    if gi:
        text = _read(gi)
        if re.search(r'(?m)^\.env\b', text) or re.search(r'(?m)^\*\.env\b', text):
            ev.append(_ef('.gitignore', '.gitignore covers .env', 4.0))
            raw += 4.0
        else:
            miss.append('.gitignore does not cover .env')
    else:
        miss.append('no .gitignore')

    for rel in instr_rels:
        if _SAFE_RE.search(_read(_jp(root, *rel.split('/')))):
            ev.append(_ef(rel, 'do-not-touch safety language', 2.0))
            raw += 2.0
            break

    # No .env committed at root — small hygiene point
    if not os.path.isfile(_jp(root, '.env')):
        ev.append(_ef('.', 'no .env committed at repo root', 1.0))
        raw += 1.0

    if raw == 0.0:
        miss.append('no safety/governance signals found')

    return ev, miss, min(raw, 10.0)


# ─── Public API ───────────────────────────────────────────────────────────────

def compute_harness_scan(root) -> dict:
    """Score *root* on AI-harness maturity; never raises.

    Returns the P3 contract dict with keys:
    score, level, breakdown, weights, evidence, missing, scanned.
    """
    if not root:
        return _empty_result()
    root = str(root)
    if not os.path.isdir(root):
        return _empty_result()

    # Instruction file rels — shared across dim probes for content scanning
    instr_rels = [
        r for r in ('CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.github/copilot-instructions.md')
        if os.path.isfile(_jp(root, *r.split('/')))
    ]

    i_ev, i_mis, i_sc = _probe_instructions(root)
    h_ev, h_mis, h_sc = _probe_harness_config(root)
    l_ev, l_mis, l_sc = _probe_loop_engineering(root, instr_rels)
    m_ev, m_mis, m_sc = _probe_memory_learning(root)
    d_ev, d_mis, d_sc = _probe_delegation(root, instr_rels)
    s_ev, s_mis, s_sc = _probe_safety_governance(root, instr_rels)

    breakdown = {
        'instructions':      round(i_sc, 2),
        'harness_config':    round(h_sc, 2),
        'loop_engineering':  round(l_sc, 2),
        'memory_learning':   round(m_sc, 2),
        'delegation':        round(d_sc, 2),
        'safety_governance': round(s_sc, 2),
    }

    score = round(sum(breakdown[k] * WEIGHTS[k] for k in WEIGHTS), 1)

    mem = breakdown['memory_learning']
    if score >= 8.0 and mem >= 6.0:
        level = 'self_improving'
    elif score >= 6.0:
        level = 'engineered'
    elif score >= 4.0:
        level = 'structured'
    elif score >= 2.0:
        level = 'basic'
    else:
        level = 'none_adhoc'

    scanned = ['.']
    for d in ('.claude', '.github', '.cursor', '.windsurf', '.gemini', 'tests', 'workflow', 'docs'):
        if os.path.isdir(_jp(root, d)):
            scanned.append(d + '/')

    return {
        'score':     score,
        'level':     level,
        'breakdown': breakdown,
        'weights':   dict(WEIGHTS),
        'evidence':  {
            'instructions':      i_ev,
            'harness_config':    h_ev,
            'loop_engineering':  l_ev,
            'memory_learning':   m_ev,
            'delegation':        d_ev,
            'safety_governance': s_ev,
        },
        'missing': {
            'instructions':      i_mis,
            'harness_config':    h_mis,
            'loop_engineering':  l_mis,
            'memory_learning':   m_mis,
            'delegation':        d_mis,
            'safety_governance': s_mis,
        },
        'scanned': scanned,
    }


def _empty_result() -> dict:
    return {
        'score':     0.0,
        'level':     'none_adhoc',
        'breakdown': {d: 0.0 for d in _DIMS},
        'weights':   dict(WEIGHTS),
        'evidence':  {d: [] for d in _DIMS},
        'missing':   {d: ['repository not found or inaccessible'] for d in _DIMS},
        'scanned':   [],
    }
