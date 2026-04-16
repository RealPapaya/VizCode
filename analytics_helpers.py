"""
analytics_helpers.py — Pure-Python graph analytics for VIZCODE.

All functions receive the DATA dict returned by build_graph().
Zero external dependencies (stdlib only).
"""

import os
from collections import defaultdict, Counter

# ─── C1: Hotspot Nodes ───────────────────────────────────────────────────────

def hotspot_nodes(data: dict, top_n: int = 10) -> list:
    """
    Return top_n symbols by in-degree (number of times called by other symbols).

    Filters out:
    - symbols whose name matches the basename of their file (file-hub pseudo-nodes)
    - symbols with in_degree <= 1 (isolated, not representative)

    Returns:
        [{"label": "build_graph", "file": "analyze_viz.py", "degree": 84}, ...]
    """
    symbol_index = data.get('symbol_index', {})
    symbol_edges = data.get('symbol_edges', [])

    in_degree: dict = defaultdict(int)
    for edge in symbol_edges:
        tgt = edge.get('to')
        if tgt:
            in_degree[tgt] += 1

    results = []
    for sid, deg in in_degree.items():
        if sid not in symbol_index:
            continue
        sym      = symbol_index[sid]
        name     = sym.get('name', '')
        filepath = sym.get('file', '')
        base_no_ext = os.path.splitext(os.path.basename(filepath))[0]
        if name == base_no_ext or name == os.path.basename(filepath):
            continue
        if deg <= 1:
            continue
        results.append({'label': name, 'file': filepath, 'degree': deg})

    results.sort(key=lambda x: x['degree'], reverse=True)
    return results[:top_n]


# ─── C2: Surprising Connections ──────────────────────────────────────────────

def _score_edge(src: dict, tgt: dict, edge_type: str,
                src_deg: int, tgt_deg: int) -> tuple:
    """
    Compute surprise score and reason string for one file-to-file edge.
    Returns (score: int, reason: str).
    """
    src_path = src.get('path', '').replace('\\', '/')
    tgt_path = tgt.get('path', '').replace('\\', '/')
    src_top  = src_path.split('/')[0]
    tgt_top  = tgt_path.split('/')[0]
    src_ext  = src.get('ext', '')
    tgt_ext  = tgt.get('ext', '')

    score   = 0
    reasons = []

    if src_top and tgt_top and src_top != tgt_top:
        score += 2
        reasons.append('cross-directory')

    if src_ext and tgt_ext and src_ext != tgt_ext:
        score += 2
        reasons.append('cross-language')

    if 'inferred' in edge_type:
        score += 1
        reasons.append('inferred edge')

    if src_deg > 0 and tgt_deg > 0:
        high = max(src_deg, tgt_deg)
        low  = min(src_deg, tgt_deg)
        if low > 0 and high / low >= 10:
            score += 1
            reasons.append('peripheral→hub')

    return score, ' + '.join(reasons)


def surprising_connections(data: dict, top_n: int = 5) -> list:
    """
    Return top_n file-to-file edges that cross surprising boundaries.

    Scoring rules (no external deps):
    - cross_dir_bonus   +2  different top-level directory
    - cross_lang_bonus  +2  different file extension
    - inferred_bonus    +1  edge type contains 'inferred'
    - peripheral_bonus  +1  degree ratio >= 10x between endpoints

    Returns:
        [{"source": "A", "target": "B", "score": 5, "reason": "..."}, ...]
    """
    files_by_module      = data.get('files_by_module', {})
    file_edges_by_module = data.get('file_edges_by_module', {})

    # Build id → file-dict mapping
    id_to_file: dict = {}
    for file_list in files_by_module.values():
        for f in file_list:
            id_to_file[f['id']] = f

    # Compute degree per file id
    file_degree: dict = defaultdict(int)
    for edge_list in file_edges_by_module.values():
        for edge in edge_list:
            file_degree[edge['s']] += 1
            file_degree[edge['t']] += 1

    scored = []
    seen: set = set()
    for edge_list in file_edges_by_module.values():
        for edge in edge_list:
            src_id = edge['s']
            tgt_id = edge['t']
            key = (min(src_id, tgt_id), max(src_id, tgt_id))
            if key in seen:
                continue
            seen.add(key)

            src = id_to_file.get(src_id)
            tgt = id_to_file.get(tgt_id)
            if not src or not tgt:
                continue

            score, reason = _score_edge(
                src, tgt, edge.get('type', ''),
                file_degree.get(src_id, 0),
                file_degree.get(tgt_id, 0),
            )
            if score > 0:
                scored.append({
                    'source': src.get('path', ''),
                    'target': tgt.get('path', ''),
                    'score':  score,
                    'reason': reason,
                })

    scored.sort(key=lambda x: x['score'], reverse=True)
    return scored[:top_n]


# ─── C4: Generate Report ─────────────────────────────────────────────────────

def _report_overview(stats: dict) -> list:
    lines = ['## Scan Overview\n']
    lines.append(f"- Files: {stats.get('files', 0)}")
    lines.append(f"- Modules: {stats.get('modules', 0)}")
    lines.append(f"- Functions: {stats.get('functions', 0)}")
    lines.append(f"- Calls: {stats.get('calls', 0)}")
    lang_dist = stats.get('language_distribution', {})
    if lang_dist:
        lines.append('\n**Language Distribution:**')
        for lang, count in sorted(lang_dist.items(), key=lambda x: -x[1]):
            lines.append(f'- {lang}: {count} files')
    return lines


def _report_communities(community_stats: list) -> list:
    lines = ['\n## Community Structure\n']
    if not community_stats:
        lines.append('No communities detected.')
        return lines
    lines.append('| ID | Nodes | Label |')
    lines.append('|----|-------|-------|')
    for c in sorted(community_stats, key=lambda x: -x['size']):
        lines.append(f"| {c['id']} | {c['size']} | {c['label']} |")
    return lines


def _report_hotspots(hotspots: list) -> list:
    lines = ['\n## Core Nodes (top 10 by in-degree)\n']
    if not hotspots:
        lines.append('No hotspot nodes detected.')
        return lines
    for i, h in enumerate(hotspots, 1):
        lines.append(f"{i}. `{h['label']}` in `{h['file']}` — {h['degree']} calls")
    return lines


def _report_connections(connections: list) -> list:
    lines = ['\n## Surprising Connections (top 5)\n']
    if not connections:
        lines.append('No surprising connections detected.')
        return lines
    for c in connections:
        lines.append(
            f"- `{c['source']}` → `{c['target']}`"
            f"  (score: {c['score']}) — {c['reason']}"
        )
    return lines


def _report_health(stats: dict) -> list:
    lines = ['\n## Health Metrics\n']
    lines.append(f"- Circular dependencies: {stats.get('circular_dependencies', 0)}")
    lines.append(f"- Isolated files: {stats.get('isolated_files', 0)}")
    lines.append(f"- Uncalled functions: {stats.get('uncalled_functions', 0)}")
    lines.append(f"- Unimported files: {stats.get('unimported_files', 0)}")
    lines.append(f"- Avg function length: {stats.get('avg_func_length', 0)} lines")

    # ── Circular dependency chains ────────────────────────────────────────────
    top_cycles = stats.get('top_circular_deps', [])
    if top_cycles:
        lines.append('\n**Circular Dependency Chains:**')
        for cycle in top_cycles[:5]:
            lines.append('- ' + ' → '.join(str(f) for f in cycle))

    # ── Longest functions ─────────────────────────────────────────────────────
    longest = stats.get('longest_functions', [])
    if longest:
        lines.append('\n**Longest Functions (complexity candidates):**')
        for fn in longest[:10]:
            fname  = fn.get('name', '?')
            ffile  = os.path.basename(fn.get('file', '?'))
            flines = fn.get('lines', 0)
            lines.append(f'- `{fname}()` in `{ffile}` — {flines} lines')

    # ── God files (most imported) ─────────────────────────────────────────────
    top_imported = stats.get('top_imported_files', [])
    if top_imported:
        lines.append('\n**Most Imported Files (high coupling risk):**')
        for entry in top_imported[:5]:
            fpath = entry.get('file', '?')
            count = entry.get('count', 0)
            lines.append(f'- `{os.path.basename(fpath)}` — imported by {count} files')

    return lines


def _report_l0_l1(data: dict) -> list:
    """Generate L0 (module overview) + L1 (per-module file list) sections."""
    modules           = data.get('modules', [])
    module_edges      = data.get('module_edges', [])
    files_by_module   = data.get('files_by_module', {})
    file_edges_by_mod = data.get('file_edges_by_module', {})

    if not modules:
        return []

    # ── id lookup maps ────────────────────────────────────────────────────────
    id_to_mod: dict = {m['id']: m.get('label', str(m['id'])) for m in modules}

    mod_deps: dict = {m.get('label', str(m['id'])): [] for m in modules}
    for e in module_edges:
        src = id_to_mod.get(e.get('s', ''), '')
        tgt = id_to_mod.get(e.get('t', ''), '')
        if src and tgt and src in mod_deps:
            mod_deps[src].append(tgt)

    mod_func_counts: dict = {
        label: sum(f.get('func_count', 0) for f in files)
        for label, files in files_by_module.items()
    }

    # ── L0 ───────────────────────────────────────────────────────────────────
    lines = ['\n## L0 — Module Overview\n']
    lines.append('| Module | Files | Functions | Imports |')
    lines.append('|--------|-------|-----------|---------|')
    for m in sorted(modules, key=lambda x: -len(files_by_module.get(x.get('label', ''), []))):
        label   = m.get('label', str(m['id']))
        n_files = len(files_by_module.get(label, []))
        n_funcs = mod_func_counts.get(label, 0)
        deps    = ', '.join(f'`{d}`' for d in mod_deps.get(label, [])) or '—'
        lines.append(f'| `{label}` | {n_files} | {n_funcs} | {deps} |')

    # ── Entry points: code files with no inbound import edges ────────────────
    all_tgt_ids: set = set()
    for edge_list in file_edges_by_mod.values():
        for e in edge_list:
            all_tgt_ids.add(e.get('t'))
    entry_files: list = []
    for label, files in files_by_module.items():
        for f in files:
            # Only include files with actual functions (not data/config files)
            if f.get('id') not in all_tgt_ids and f.get('func_count', 0) > 0:
                entry_files.append(f.get('label', f.get('path', '?')))
    if entry_files:
        lines.append('\n**Entry Points (not imported by anyone):**')
        for ef in sorted(entry_files)[:10]:
            lines.append(f'- `{ef}`')
        if len(entry_files) > 10:
            lines.append(f'- …+{len(entry_files) - 10} more')

    lines.append('\n> 用 `vizcode_l1(module)` 取得模組內檔案依賴；`vizcode_l2(file)` 取得函式呼叫圖。\n')

    # ── L1 ───────────────────────────────────────────────────────────────────
    lines.append('\n## L1 — File Map\n')
    for m in sorted(modules, key=lambda x: x.get('label', '')):
        label = m.get('label', str(m['id']))
        files = files_by_module.get(label, [])
        if not files:
            continue

        lines.append(f'### `{label}` — {len(files)} files\n')
        lines.append('| File | Type | Funcs | Size |')
        lines.append('|------|------|-------|------|')

        fid_to_label: dict = {f['id']: f.get('label', f.get('path', '?'))
                              for f in files if 'id' in f}

        for f in sorted(files, key=lambda x: x.get('label', '')):
            flabel   = f.get('label', f.get('path', '?'))
            ftype    = f.get('file_type', f.get('ext', '?'))
            n_funcs  = f.get('func_count', 0)
            size_kb  = f.get('size', 0) // 1024
            size_str = f'{size_kb}KB' if size_kb > 0 else '<1KB'
            lines.append(f'| `{flabel}` | {ftype} | {n_funcs} | {size_str} |')

        edges = file_edges_by_mod.get(label, [])
        if edges:
            lines.append('')
            shown: set = set()
            for e in edges:
                src_l = fid_to_label.get(e.get('s', ''), '')
                tgt_l = fid_to_label.get(e.get('t', ''), '')
                if src_l and tgt_l:
                    key = (src_l, tgt_l)
                    if key not in shown:
                        shown.add(key)
            if shown:
                lines.append('Import edges:')
                for src_l, tgt_l in sorted(shown)[:15]:
                    lines.append(f'- `{src_l}` → `{tgt_l}`')
                if len(shown) > 15:
                    lines.append(f'- …+{len(shown) - 15} more')

        lines.append('')

    return lines


def _report_module_tree(data: dict) -> list:
    """Generate a module dependency table from module_edges and modules."""
    modules      = data.get('modules', [])
    module_edges = data.get('module_edges', [])

    lines = ['\n## Module Dependency Tree\n']
    if not modules:
        lines.append('No modules detected.')
        return lines

    # id → label map
    id_to_label: dict = {m['id']: m.get('label', str(m['id'])) for m in modules}

    # label → set of labels it imports
    imports_map: dict = {}
    for m in modules:
        imports_map[m.get('label', str(m['id']))] = []
    for edge in module_edges:
        src_label = id_to_label.get(edge.get('s', ''), '')
        tgt_label = id_to_label.get(edge.get('t', ''), '')
        if src_label and tgt_label and src_label in imports_map:
            imports_map[src_label].append(tgt_label)

    # file count per module label
    files_by_module = data.get('files_by_module', {})
    file_count: dict = {label: len(files_by_module.get(label, []))
                        for label in imports_map}

    lines.append('| Module | Files | Imports |')
    lines.append('|--------|-------|---------|')
    for m in sorted(modules, key=lambda x: -file_count.get(x.get('label', ''), 0)):
        label   = m.get('label', str(m['id']))
        n_files = file_count.get(label, 0)
        deps    = ', '.join(imports_map.get(label, [])) or '—'
        lines.append(f'| `{label}` | {n_files} | {deps} |')
    return lines


def generate_report(data: dict, output_path: str) -> None:
    """
    Write a Markdown codebase report to output_path.

    Sections: scan overview, community structure, core nodes top 10,
    surprising connections top 5, health metrics, module dependency tree.
    """
    stats           = data.get('stats', {})
    community_stats = data.get('community_stats', [])

    hotspots    = hotspot_nodes(data, top_n=10)
    connections = surprising_connections(data, top_n=5)

    lines = ['# VizCode Report\n']
    lines += _report_overview(stats)
    lines += _report_l0_l1(data)
    lines += _report_communities(community_stats)
    lines += _report_hotspots(hotspots)
    lines += _report_connections(connections)
    lines += _report_health(stats)

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(lines) + '\n')
