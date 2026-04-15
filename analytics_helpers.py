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
    lines += _report_communities(community_stats)
    lines += _report_hotspots(hotspots)
    lines += _report_connections(connections)
    lines += _report_health(stats)
    lines += _report_module_tree(data)

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as fh:
        fh.write('\n'.join(lines) + '\n')
