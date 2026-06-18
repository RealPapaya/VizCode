const CY_STYLE = [
        {
        selector: 'node', style: {
            'background-color': 'data(bg)',
            'border-width': 2, 'border-color': 'data(bc)',
            'label': 'data(label)',
            'color': '#e2e8f0', 'font-size': 11,
            'text-valign': 'center', 'text-halign': 'center',
            'text-justification': 'center',
            'text-wrap': 'wrap', 'text-max-width': 160,
            'min-zoomed-font-size': 4,
            'width': 'data(w)', 'height': 'data(h)',
            'shape': 'data(sh)',
            'overlay-opacity': 0,
        }
    },
    { selector: 'node[lvl=0]', style: { 'font-size': 12, 'font-weight': 'bold' } },
    { selector: 'node[lvl=1]', style: { 'font-size': 10 } },
    { selector: 'node.label-hidden', style: { 'text-opacity': 0 } },
    // Simple (solid circle) mode — label below, no border
    { selector: 'node[simple=1]', style: {
        'border-width': 0,
        'text-valign': 'bottom',
        'text-halign': 'center',
        'text-justification': 'center',
        'text-margin-y': 6,
        'text-max-width': 80,
        'min-zoomed-font-size': 6,
    }},
    { selector: 'node[simple=1]:selected', style: { 'border-width': 2.5, 'border-color': '#dfa745' } },
    { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#dfa745', 'overlay-opacity': 0 } },
    { selector: 'node:active', style: { 'overlay-opacity': 0 } },
    { selector: '.isolate-hidden', style: { 'display': 'none' } },
    // Zoom-invariant selected label badge
    { selector: 'node.selected-label', style: {
        'color': '#ffffff',
        'font-weight': 'bold',
        'text-halign': 'center',
        'text-justification': 'center',
        'min-zoomed-font-size': 0,
        'z-index': 999,
    }},
    // Zoom-invariant neighbor label badge (connected nodes)
    { selector: 'node.neighbor-label', style: {
        'color': '#e2e8f0',
        'text-halign': 'center',
        'text-justification': 'center',
        'min-zoomed-font-size': 0,
        'z-index': 998,
    }},
    // Hover badge for non-highlighted nodes when a selection is pinned
    // Label stays at bottom (default valign), just gains a framed box around it
    { selector: 'node.node-hovered', style: {
        'text-background-color': '#091525',
        'text-background-opacity': 0.92,
        'text-background-padding': '4px',
        'text-background-shape': 'roundrectangle',
        'text-border-color': 'data(bc)',
        'text-border-width': 1,
        'text-border-opacity': 1,
        'color': '#ffffff',
        'font-weight': 'bold',
        'min-zoomed-font-size': 0,
        'z-index': 997,
    }},
    // BIOS file type — highlighted border tint
    { selector: 'node[ft="module_inf"]', style: { 'border-width': 2.5 } },
    { selector: 'node[ft="package_dec"]', style: { 'border-width': 2.5 } },
    { selector: 'node[ft="common_file"]', style: { 'border-width': 2.5 } },
        // Default edge — no CSS transitions (saves per-edge animation timers on large graphs)
    {
        selector: 'edge', style: {
            'width': 'data(w)',
            'line-color': 'data(ec)',
            'line-style': 'data(es)',
            'target-arrow-shape': 'triangle',
            'target-arrow-color': 'data(ec)',
            'curve-style': 'bezier',
            'opacity': 0.75,
            'label': 'data(edgeLabel)',
            'font-size': 9,
            'text-rotation': 'autorotate',
            'text-margin-y': -6,
            'color': '#e5e7eb',
            'text-background-color': '#111827',
            'text-background-opacity': 0.82,
            'text-background-shape': 'round-rectangle',
            'text-background-padding': '2px',
            'text-events': 'no',
        }
    },
    // Perf-lite (very large graphs only — toggled by _applyAdaptivePerfMode):
    // opaque edges are >2× faster to draw with arrows than semitransparent ones, and
    // edge-label text is the single most expensive per-edge cost. Placed BEFORE the
    // state rules below so :selected / .edge-hovered / .faded / .hl-* still win.
    { selector: 'edge.perf-lite', style: { 'opacity': 1, 'label': '' } },
    // Edge selected state — bold highlight without shadow (shadow is expensive on canvas)
    {
        selector: 'edge:selected', style: {
            'overlay-opacity': 0,
            'width': 3.5,
            'opacity': 1,
            'line-color': '#f0b060',
            'target-arrow-color': '#f0b060',
            'source-arrow-color': '#f0b060',
            'z-index': 20,
        }
    },
    // Edge hover state — thicker width on mouseover (opacity:1 lifts faded edges)
    {
        selector: '.edge-hovered', style: {
            'width': 3.0,
            'opacity': 1,
            'z-index': 5,
        }
    },
    { selector: 'edge:active', style: { 'overlay-opacity': 0 } },
    { selector: '.faded', style: { 'opacity': 0.06 } },
    // Other / binary file nodes — visibly distinct: dimmed + dashed border
    {
        selector: 'node[?isExtra]', style: {
            'opacity': 0.50,
            'border-style': 'dashed',
            'border-width': 1.5,
        }
    },
    { selector: '.hl', style: { 'opacity': 1, 'border-width': 2, 'border-color': 'data(bc)', 'outline-color': 'data(bc)', 'outline-width': 1, 'outline-opacity': 1, 'outline-offset': 4 } },
    {
        selector: '.hl-edge-out', style: {
            'opacity': 1, 'width': 3, 'z-index': 10,
        }
    },
    {
        selector: '.hl-edge-in', style: {
            'opacity': 1, 'width': 3, 'z-index': 10,
        }
    },
    { selector: '.hl-node-out', style: { 'border-width': 3, 'opacity': 1 } },
    { selector: '.hl-node-in', style: { 'border-width': 3, 'opacity': 1 } },
    // Highlighted edge hovered — must come after .hl-edge-out/in to win by array order
    {
        selector: 'edge.hl-edge-out.edge-hovered, edge.hl-edge-in.edge-hovered', style: {
            'width': 5.5,
            'z-index': 20,
        }
    },
    // Drill-down group compound container
    {
        selector: 'node[_t="drill_group"]', style: {
            'background-color': '#0b1929',
            'background-opacity': 0.82,
            'border-width': 1.5,
            'border-color': 'data(bc)',
            'border-style': 'dashed',
            'label': 'data(label)',
            'text-valign': 'top',
            'text-halign': 'center',
            'text-margin-y': 4,
            'color': 'data(bc)',
            'font-size': 10,
            'font-weight': 'bold',
            'padding': '18px',
            'shape': 'roundrectangle',
            'compound-sizing-wrt-labels': 'include',
            'min-width': 60,
            'min-height': 40,
            'cursor': 'pointer',
        }
    },
];


