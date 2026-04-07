// ── Symbol View — CodeViz-style, embedded in #graph-wrap ─────────────────
// Phase 1+2: Symbol Index + basic symbol graph (Cytoscape dagre LR).
// Phase 3: Compound class card nodes (PUBLIC/PRIVATE sections) + TrailLayouter.
// Phase 6: Section expand/collapse toggle on group header nodes.
// Phase 7: Edge type filter pills in toolbar.
// Phase 8: Back/Forward navigation with future stack + layout animation.
//
// Entry points (called from viz.js):
//   symViewOpen(fileRel)   — open the primary symbol in a file
//   symViewActivate(symId) — navigate to a specific symbol
//   symViewClose()         — hide, restore #cy

'use strict';

const _sym = {
    active: null,   // current center symbol id (or '__overview__' sentinel)
    history: [],     // back stack  [symId | '__overview__', ...]
    future: [],     // forward stack [symId | '__overview__', ...]
    cy: null,   // Cytoscape instance inside #sym-cy
    jobId: null,
    ready: false,
    mode: 'overview',  // 'overview' | 'centric'
    overviewFile: null,        // file path shown in overview mode
    collapsed: new Set(),  // nodeIds whose class card is collapsed
    hiddenEdgeTypes: new Set(),  // edge type keys that are currently hidden
    _legendSnapshot: null,       // saved graph-legend state before sym-view takes over
};

const _SYM_ZOOM_SETTINGS = window.GRAPH_ZOOM_SETTINGS || {
    minZoom: 0.04,
    maxZoom: 5,
    wheelSensitivity: 0.12,
};

// ── Sizing constants — exact values from CodeViz GraphViewStyle.cpp ──────
// BIG_NODE (class card): left=right=top=bottom=10, spacingA=5, spacingY=8
// ACCESS section:        left=right=10, top=40, bottom=10, spacingY=8
// SMALL_NODE (pill):     left=right=5, top=bottom=3, cornerRadius=8
// charHeight at font-size 14 ≈ 18px; toggle size = charHeight = 18
const _SYM_CHAR_H = 17;   // charHeight (titleFs+4)
const _SYM_CARD_PAD = 13;   // BIG_NODE: left=right=top=bottom
const _SYM_CARD_SPC_A = 12;   // BIG_NODE: spacingA (title → first ACCESS)
const _SYM_CARD_SPC_Y = 4;    // BIG_NODE: spacingY between ACCESS sections
const _SYM_SEC_TOP = 33;   // ACCESS: top (header area height)
const _SYM_SEC_BOT = 11;   // ACCESS: bottom
const _SYM_SEC_SPC_Y = 7;    // ACCESS: spacingY between pills
const _SYM_PILL_H = 22;   // SMALL_NODE height
const _SYM_PILL_RAD = 14;   // SMALL_NODE cornerRadius
const _SYM_TOGGLE_SIZE = 20;   // ExpandToggle size

// ── Section group colors ───────────────────────────────────────────────────────
const _SYM_PRIV_BG = 'rgba(96,165,250,0.12)';   // blue tint for PRIVATE pill bg
const _SYM_PRIV_BORDER = '#60a5fa';                   // blue border for PRIVATE pills
const _SYM_PRIV_TEXT = '#60a5fa';                   // blue text for PRIVATE pills

// ── Edge colors (CodeViz-style: call=warm amber, type-related=blue) ──────
const _SYM_EDGE_COLORS = {
    call: '#d97706',
    inheritance: '#60a5fa',
    import: '#34d399',
    member: '#c084fc',
    override: '#f472b6',
    type_usage: '#60a5fa',
    include: '#94a3b8',
};
// CodeViz semantic color — warm amber for active member / call edges
const _SYM_WARM = '#d97706';
const _SYM_WARM_BG = 'rgba(217,119,6,0.18)';

// ── Legend helpers ────────────────────────────────────────────────────────────

function _symSaveLegend() {
    if (_sym._legendSnapshot) return;  // already saved
    const leg = document.getElementById('graph-legend');
    _sym._legendSnapshot = {
        existed: !!leg,
        html: leg ? leg.innerHTML : '',
        className: leg ? leg.className : '',
        opacity: leg ? leg.style.opacity : '',
        pointerEvents: leg ? leg.style.pointerEvents : '',
    };
}

function _symRestoreLegend() {
    const snap = _sym._legendSnapshot;
    if (!snap) return;
    const leg = document.getElementById('graph-legend');
    if (!snap.existed) {
        if (leg) leg.remove();
    } else if (leg) {
        leg.innerHTML = snap.html;
        leg.className = snap.className;
        leg.style.opacity = snap.opacity;
        leg.style.pointerEvents = snap.pointerEvents;
    }
    _sym._legendSnapshot = null;
}

function _symUpdateLegend(usedTypes) {
    // usedTypes: Set of edge type strings present in the current graph
    const wrap = document.getElementById('graph-wrap');
    if (!wrap) return;
    _symSaveLegend();

    let leg = document.getElementById('graph-legend');
    if (!leg) {
        leg = document.createElement('div');
        leg.id = 'graph-legend';
        wrap.appendChild(leg);
    }
    leg.className = _sym._legendSnapshot && _sym._legendSnapshot.className
        ? _sym._legendSnapshot.className
        : 'legend-collapsed';
    leg.style.opacity = '';
    leg.style.pointerEvents = '';

    const legendLabel = (typeof T === 'function' ? T('legendLabel') : 'Legend');
    const edgeLabel = (typeof T === 'function' ? T('edgeTypes') : 'Edge Types');

    const filterOrder = ['call', 'inheritance', 'import', 'type_usage', 'include', 'override', 'member'];
    const activeTypes = filterOrder.filter(t => usedTypes.has(t));

    leg.innerHTML = `
<div class="legend-title" onclick="this.parentElement.classList.toggle('legend-collapsed')">
  <span>\u2B21</span> ${legendLabel} <span class="legend-toggle">\u25BE</span>
</div>
<div class="legend-body">
  <div class="legend-section-label">${edgeLabel}</div>
  ${activeTypes.map(t => {
        const color = _SYM_EDGE_COLORS[t] || '#94a3b8';
        return `<div class="legend-row sym-legend-filter-row" data-type="${t}" title="Click to toggle ${t} edges">
  <svg width="34" height="10" style="vertical-align:middle;margin-right:4px;flex-shrink:0">
    <line x1="0" y1="5" x2="28" y2="5" stroke="${color}" stroke-width="2"/>
    <polygon points="24,2 30,5 24,8" fill="${color}"/>
  </svg>
  <span class="legend-label" style="color:${color}">${t}</span>
</div>`;
    }).join('')}
</div>`;

    // Bind click handlers for filter toggle on each row
    leg.querySelectorAll('.sym-legend-filter-row').forEach(row => {
        const type = row.dataset.type;
        if (_sym.hiddenEdgeTypes.has(type)) row.classList.add('sym-legend-row-off');
        row.addEventListener('click', () => {
            if (_sym.hiddenEdgeTypes.has(type)) {
                _sym.hiddenEdgeTypes.delete(type);
                row.classList.remove('sym-legend-row-off');
            } else {
                _sym.hiddenEdgeTypes.add(type);
                row.classList.add('sym-legend-row-off');
            }
            _symApplyEdgeFilters();
        });
    });
}

// ── Cytoscape stylesheet (dynamic — reads CSS variables at render time) ──────

function _symBuildCyStyle() {
    const cs = getComputedStyle(document.documentElement);
    const v = k => cs.getPropertyValue(k).trim();
    const bg = v('--bg') || '#050a0f';
    const panel = v('--panel') || '#090e14';
    const panel2 = v('--panel2') || '#0d1520';
    const border = v('--border') || '#1a2535';
    const text = v('--text') || '#e2e8f0';
    const muted = v('--muted') || '#64748b';
    const accent = v('--accent') || '#dfa745';
    // Read theme font from body so all Cytoscape labels follow the active theme
    const themeFontUI = getComputedStyle(document.body).fontFamily || "'Segoe UI', system-ui, sans-serif";
    const themeFontCode = v('--code-font') || "'JetBrains Mono', monospace";

    return [
        // ── Compound class card (CodeViz: cornerRadius=20 expanded, 10 collapsed) ────
        {
            selector: 'node[?isClassCard]',
            style: {
                'shape': 'roundrectangle',
                'corner-radius': 20,
                'background-color': panel2,
                'border-color': border,
                'border-width': 1,
                'label': '',
                'width': 'data(cardWidth)',
                'height': 'data(cardHeight)',
                'compound-sizing-wrt-labels': 'exclude',
                'padding': '0px',
            },
        },
        {
            selector: 'node[isCenter][?isClassCard]',
            style: { 'border-color': border, 'border-width': 2 },
        },
        {
            selector: 'node[?isClassCard][?isCollapsed]',
            style: { 'corner-radius': 10 },
        },
        // ── Class name header — left-aligned title ────
        {
            selector: 'node[?isClassHdr]',
            style: {
                'shape': 'rectangle',
                'background-opacity': 0,
                'border-width': 0,
                'label': 'data(label)',
                'text-valign': 'center',
                'text-halign': 'left',
                'text-margin-x': 6,
                'color': text,
                'font-size': 14,
                'font-weight': 700,
                'font-family': themeFontUI,
                'text-wrap': 'none',
                'width': 'data(pillWidth)',
                'height': _SYM_CHAR_H,
            },
        },
        // ── Toggle badge (CodeViz: circular, top-right of card) ────
        {
            selector: 'node[?isToggle]',
            style: {
                'shape': 'ellipse',
                'width': _SYM_CHAR_H,
                'height': _SYM_CHAR_H,
                'background-color': border,
                'border-width': 0,
                'label': 'data(label)',
                'font-size': 11,
                'font-weight': 700,
                'color': text,
                'text-valign': 'center',
                'text-halign': 'center',
                'overlay-opacity': 0,
            },
        },
        // ── ACCESS section compound — fixed width+height from data, no auto-sizing ────
        {
            selector: 'node[?isSection]',
            style: {
                'shape': 'rectangle',
                'background-opacity': 0,
                'border-width': 0,
                'label': '',
                'width': 'data(sectionW)',
                'height': 'data(sectionH)',
                'compound-sizing-wrt-labels': 'exclude',
                'padding': '0px',
                'overlay-opacity': 0,
                'events': 'no',
            },
        },
        // ── Section title node (inside section compound, top-left) ────
        {
            selector: 'node[?isSectionHdr]',
            style: {
                'shape': 'rectangle',
                'background-opacity': 0,
                'border-width': 0,
                'label': 'data(label)',
                'text-valign': 'center',
                'text-halign': 'left',
                'text-margin-x': 4,
                'color': muted,
                'font-size': 12,
                'font-weight': 700,
                'font-family': themeFontUI,
                'width': 'data(pillWidth)',
                'height': _SYM_SEC_TOP,
                'events': 'no',
                'overlay-opacity': 0,
            },
        },
        // ── Member badge nodes ────
        {
            selector: 'node[?isMember]',
            style: {
                'shape': 'roundrectangle',
                'corner-radius': _SYM_PILL_RAD,
                'background-color': panel2,
                'border-color': border,
                'border-width': 1,
                'label': 'data(label)',
                'text-valign': 'center',
                'text-halign': 'center',
                'color': '#000000',
                'font-size': 12,
                'font-weight': 400,
                'font-family': themeFontCode,
                'width': 'data(pillWidth)',
                'height': _SYM_PILL_H,
                'padding': '0px 5px',
                'text-overflow-wrap': 'none',
                'text-wrap': 'none',
            },
        },
        // ── Hover member: white border ────
        {
            selector: 'node.sym-hover-member',
            style: {
                'border-color': text,
                'border-width': 1.5,
            },
        },
        {
            selector: 'node[?isMember][?isPublic]',
            style: {
                'background-color': _SYM_WARM,
                'border-color': _SYM_WARM,
                'color': '#000000',
            },
        },
        {
            selector: 'node[?isMember][!isPublic]',
            style: {
                'background-color': '#60a5fa',
                'border-color': '#60a5fa',
                'color': '#000000',
            },
        },
        // ── Active (clicked) member: white thick border, original background ────
        {
            selector: 'node.sym-active-member[?isMember]',
            style: {
                'border-color': text,
                'border-width': 3,
            },
        },
        // ── Plain symbol nodes ────
        {
            selector: 'node[!isClassCard][!isGroup][!isMember][!isSection][!isClassHdr]',
            style: {
                'label': 'data(label)',
                'text-valign': 'center',
                'text-halign': 'center',
                'color': text,
                'background-color': panel,
                'border-color': border,
                'border-width': 1.5,
                'font-size': 11,
                'font-family': themeFontUI,
                'padding': '10px',
                'width': 'label',
                'height': 'label',
                'text-wrap': 'wrap',
                'text-max-width': 140,
                'shape': 'roundrectangle',
            },
        },
        {
            selector: 'node[isCenter][!isClassCard][!isClassHdr][!isSection]',
            style: { 'border-color': accent, 'border-width': 2, 'color': accent },
        },
        { selector: 'node[kind="class"][!isClassCard][!isMember][!isClassHdr]', style: { 'border-color': '#60a5fa' } },
        { selector: 'node[kind="struct"][!isClassCard][!isMember][!isClassHdr]', style: { 'border-color': '#fbbf24' } },
        { selector: 'node[kind="interface"][!isClassCard][!isMember][!isClassHdr]', style: { 'border-color': '#34d399', 'border-style': 'dashed' } },
        { selector: 'node[kind="enum"][!isMember][!isClassHdr]', style: { 'shape': 'diamond', 'border-color': '#fb923c' } },
        { selector: 'node[kind="typedef"][!isMember][!isClassHdr]', style: { 'border-color': '#e879f9', 'border-style': 'dashed' } },
        { selector: 'node[kind="function"][!isMember][!isClassHdr]', style: { 'shape': 'ellipse', 'border-color': '#34d399' } },
        { selector: 'node[kind="method"][!isMember][!isClassHdr]', style: { 'shape': 'ellipse', 'border-color': '#a78bfa' } },
        // Member badges override kind-based shape (must come after kind selectors)
        { selector: 'node[?isMember]', style: { 'shape': 'roundrectangle', 'corner-radius': _SYM_PILL_RAD } },
        // ── Edges (CodeViz color scheme) ────
        {
            selector: 'edge',
            style: {
                'width': 'data(lineWidth)',
                'line-color': border,
                'target-arrow-color': border,
                'target-arrow-shape': 'triangle',
                'curve-style': 'bezier',
                'label': 'data(label)',
                'font-size': 9,
                'font-family': themeFontUI,
                'color': muted,
                'text-background-color': bg,
                'text-background-opacity': 0.8,
                'text-background-padding': '2px',
            },
        },
        {
            selector: 'edge[edgeType="call"]',
            style: { 'line-color': _SYM_EDGE_COLORS.call, 'target-arrow-color': _SYM_EDGE_COLORS.call },
        },
        {
            selector: 'edge[edgeType="inheritance"]',
            style: {
                'line-color': _SYM_EDGE_COLORS.inheritance,
                'target-arrow-color': _SYM_EDGE_COLORS.inheritance,
                'target-arrow-shape': 'triangle-backcurve',
            },
        },
        {
            selector: 'edge[edgeType="import"]',
            style: { 'line-color': _SYM_EDGE_COLORS.import, 'target-arrow-color': _SYM_EDGE_COLORS.import, 'line-style': 'dashed' },
        },
        {
            selector: 'edge[edgeType="override"]',
            style: { 'line-color': _SYM_EDGE_COLORS.override, 'target-arrow-color': _SYM_EDGE_COLORS.override, 'line-style': 'dotted' },
        },
        {
            selector: 'edge[edgeType="type_usage"]',
            style: { 'line-color': _SYM_EDGE_COLORS.type_usage, 'target-arrow-color': _SYM_EDGE_COLORS.type_usage, 'line-style': 'dashed' },
        },
        // ── Bundled edges (count > 1) ────
        {
            selector: 'edge[?isBundled]',
            style: { 'opacity': 0.95, 'text-opacity': 1 },
        },
        { selector: 'node:selected', style: { 'border-color': text, 'border-width': 2 } },
        { selector: 'edge:selected', style: { 'overlay-color': _SYM_WARM, 'overlay-opacity': 0.2, 'overlay-padding': 4 } },
        // Non-interactive structural nodes: suppress pointer events and hover overlay
        { selector: 'node[?isSection]', style: { 'events': 'no', 'overlay-opacity': 0 } },
        { selector: 'node[?isClassCard]', style: { 'overlay-opacity': 0 } },
        { selector: 'node[?isClassHdr][isCenter]', style: { 'events': 'no', 'overlay-opacity': 0 } },
    ];
}

// ── Entry Points ──────────────────────────────────────────────────────────────

function symViewOpen(fileRel) {
    if (!window.DATA || !DATA.symbol_index) return;
    _sym.jobId = window.JOB_ID || null;

    const allSymbols = Object.values(DATA.symbol_index);
    const inFile = allSymbols.filter(s => s.file === fileRel);
    if (!inFile.length) return;

    _sym.history = [];
    _sym.future = [];
    _sym.active = '__overview__';   // sentinel: Symbol View is open
    _sym.overviewFile = fileRel;
    _sym.mode = 'overview';

    _symShow();                    // initialise panel DOM (no-op if already ready)
    _symShowOverview(fileRel);     // render symbol list
    _symUpdateStructBtn(true);
    // Ensure code panel is open so the ◫ toggle button is visible
    if (window.codeState) codeState.userClosed = false;
    if (window.openCodePanel && window.codeState && !codeState.isOpen) openCodePanel();
    if (window.cpEnableMultiSnipBtn) cpEnableMultiSnipBtn();
}

function symViewActivate(symId, _fromHistory) {
    // Entering centric graph from overview: push sentinel to history
    if (_sym.active === '__overview__') {
        if (!_fromHistory) {
            _sym.history.push('__overview__');
            _sym.future = [];
        }
        _sym.active = null;   // clear sentinel so the if-below doesn't fire
    }

    if (_sym.active && _sym.active !== symId) {
        _sym.history.push(_sym.active);
        if (!_fromHistory) _sym.future = [];   // new navigation clears forward stack
        _sym.collapsed.clear();  // reset section collapsed state on navigation
    }
    _sym.active = symId;
    _sym.jobId = window.JOB_ID || _sym.jobId || null;
    _symShow();
    _symFetchAndRender(symId);
}

function symViewClose() {
    const panel = document.getElementById('sym-view');
    if (panel) panel.classList.remove('active');
    const cyEl = document.getElementById('cy');
    if (cyEl) cyEl.style.display = '';
    if (_sym.cy) { _sym.cy.destroy(); _sym.cy = null; }
    _sym.active = null;
    _sym.history = [];
    _sym.future = [];
    _sym.mode = 'overview';
    _sym.overviewFile = null;
    _sym.collapsed.clear();
    _symUpdateStructBtn(false);
    if (window.cpDisableMultiSnipBtn) cpDisableMultiSnipBtn();
    // Restore layout-switcher and original legend
    const ls = document.getElementById('layout-switcher');
    if (ls) { ls.style.opacity = ''; ls.style.pointerEvents = ''; }
    _symRestoreLegend();
    if (window.refreshGraphZoomControls) window.refreshGraphZoomControls();
}

// ── Panel setup ───────────────────────────────────────────────────────────────

function _symShow() {
    const cyEl = document.getElementById('cy');
    if (cyEl) cyEl.style.display = 'none';
    const fv = document.getElementById('func-view');
    if (fv) fv.classList.remove('active');
    // Hide layout-switcher (not applicable in symbol view)
    const ls = document.getElementById('layout-switcher');
    if (ls) { ls.style.opacity = '0'; ls.style.pointerEvents = 'none'; }

    const panel = document.getElementById('sym-view');
    if (!panel) return;

    if (!_sym.ready) {
        panel.innerHTML = `
            <div id="sym-toolbar">
                <div id="sym-toolbar-left">
                    <button id="sym-back-btn" onclick="_symBack()" data-tip="Back" disabled>&#x21A9;</button>
                    <button id="sym-fwd-btn"  onclick="_symForward()" data-tip="Forward" disabled>&#x21AA;</button>
                    <button id="sym-overview-btn" onclick="_symGoOverview()" data-tip="Back to Overview" style="display:none">&#x2302; Overview</button>
                    <span id="sym-breadcrumb"></span>
                </div>
                <div id="sym-search-wrapper">
                    <input id="sym-search-input" type="text" placeholder="Search symbols\u2026"
                           autocomplete="off" spellcheck="false">
                    <div id="sym-search-results"></div>
                </div>
                <button id="sym-close-btn" onclick="symViewClose()" data-tip="Close">&#x2715;</button>
            </div>
            <div id="sym-body">
                <div id="sym-cy"></div>
            </div>
            <div id="sym-edge-tooltip" class="sym-edge-tooltip"></div>
        `;
        const si = panel.querySelector('#sym-search-input');
        si.addEventListener('input', _symDebounce(e => _symSearch(e.target.value), 300));
        si.addEventListener('keydown', e => {
            if (e.key !== 'Escape') return;
            document.getElementById('sym-search-results').innerHTML = '';
            si.value = '';
            si.blur();
        });
        _sym.ready = true;
    }
    panel.classList.add('active');
    _symUpdateBack();
    if (window.refreshGraphZoomControls) window.refreshGraphZoomControls();
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function _symFetchAndRender(symId) {
    const jid = _sym.jobId || '';
    const url = `/symbol-graph?job=${encodeURIComponent(jid)}&sym=${encodeURIComponent(symId)}`;
    try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        _symRender(data);
    } catch (e) {
        console.error('[sym-view] Fetch error:', e);
    }
}

// ── Graph rendering ───────────────────────────────────────────────────────────

function _symRender(data) {
    const { center } = data;
    if (!center) return;

    // Switch UI to centric mode: show Cytoscape canvas, hide overview list
    _sym.mode = 'centric';
    const symCyEl = document.getElementById('sym-cy');
    const symOvEl = document.getElementById('sym-overview');
    const ovBtn = document.getElementById('sym-overview-btn');
    if (symCyEl) symCyEl.style.display = '';
    if (symOvEl) symOvEl.style.display = 'none';
    if (ovBtn && _sym.overviewFile) ovBtn.style.display = '';

    _symHideEdgeTooltip();
    _symCloseSnippets();

    const bc = document.getElementById('sym-breadcrumb');
    if (bc) bc.textContent = `${center.kind}: ${center.name}`;

    const elements = _symBuildCompoundElements(data);
    const positions = _symComputeLayout(data, elements);

    if (_sym.cy) { _sym.cy.destroy(); _sym.cy = null; }
    const container = document.getElementById('sym-cy');
    if (!container) return;

    _sym.cy = cytoscape({
        container,
        elements,
        style: _symBuildCyStyle(),
        layout: { name: 'preset', positions: node => positions[node.id()] || { x: 0, y: 0 } },
        userZoomingEnabled: true,
        userPanningEnabled: true,
        boxSelectionEnabled: false,
        minZoom: _SYM_ZOOM_SETTINGS.minZoom,
        maxZoom: _SYM_ZOOM_SETTINGS.maxZoom,
        wheelSensitivity: _SYM_ZOOM_SETTINGS.wheelSensitivity,
    });
    if (window.refreshGraphZoomControls) _sym.cy.on('zoom pan', window.refreshGraphZoomControls);

    _sym.cy.nodes().ungrabify();   // nodes are not draggable (CodeViz behaviour)

    _sym.cy.on('tap', 'node', e => _symOnNodeTap(e, data));
    _sym.cy.on('tap', 'edge', e => _symOnEdgeTap(e));
    _sym.cy.on('tap', e => { if (e.target === _sym.cy) _symHideEdgeTooltip(); });
    // Pill hover: white border on mouseover, restore on mouseout
    _sym.cy.on('mouseover', 'node', e => {
        if (e.target.data('isMember')) e.target.addClass('sym-hover-member');
    });
    _sym.cy.on('mouseout', 'node', e => {
        if (e.target.data('isMember')) e.target.removeClass('sym-hover-member');
    });

    // Phase 8: animated fit-to-view
    _sym.cy.fit(undefined, 60);
    _sym.cy.animate({ fit: { eles: _sym.cy.elements(), padding: 60 } }, { duration: 280, easing: 'ease-out-cubic' });

    // Phase 7: re-apply edge filters after each render
    _symApplyEdgeFilters();

    // Toggle badges are now Cytoscape nodes (no HTML overlay needed)

    // Highlight active member (when navigated to a method, backend promotes to parent class)
    const amid = data.active_member_id;
    if (amid && _sym.cy.getElementById(amid).length) {
        _sym.cy.getElementById(amid).addClass('sym-active-member');
    }

    if (center.file && window.loadFileInPanel) loadFileInPanel(center.file, center.name);
    _symUpdateBack();

    // Update legend to show only edge types present in this graph
    const usedTypes = new Set(
        [...(data.incoming || []), ...(data.outgoing || [])].map(i => i.edge_type).filter(Boolean)
    );
    _symUpdateLegend(usedTypes);
    if (window.refreshGraphZoomControls) window.refreshGraphZoomControls();
}

// ── Element building (compound nodes) ────────────────────────────────────────

function _symBuildCompoundElements(data) {
    const { center, incoming = [], outgoing = [], neighbor_parents = {} } = data;
    const nodes = [];
    const edges = [];
    const seen = new Set();   // tracks top-level node IDs added

    // ── Build center compound card ───────────────────────────────────────────
    nodes.push(..._symNodesForSym(center, 'center', true, null));
    seen.add(center.id);

    // ── Collect all edge-referenced neighbor member IDs (for selective display)
    const edgeMemberIds = new Set(
        [...incoming, ...outgoing].map(i => i.sym && i.sym.id).filter(Boolean)
    );

    // ── Group neighbors by parent class ──────────────────────────────────────
    // Neighbors that belong to a parent class → render as compound card
    // Neighbors without a parent class → render as plain node
    const nbrByParent = {};  // parentId → [items]
    const plainNbrs = [];  // items without parent

    for (const item of [...incoming, ...outgoing]) {
        const s = item.sym;
        if (!s) continue;
        const pid = item.neighbor_parent_id;
        if (pid && neighbor_parents[pid]) {
            if (!nbrByParent[pid]) nbrByParent[pid] = [];
            nbrByParent[pid].push(item);
        } else if (!seen.has(s.id)) {
            plainNbrs.push(item);
        }
    }

    // ── Add neighbor compound cards (grouped by parent class) ────────────────
    for (const [pid, items] of Object.entries(nbrByParent)) {
        if (seen.has(pid)) continue;
        seen.add(pid);
        const parentSym = neighbor_parents[pid];
        if (!parentSym) continue;
        // Only show children that are edge-connected
        nodes.push(..._symNodesForSym(parentSym, pid, false, edgeMemberIds));
    }

    // ── Add plain neighbor nodes ─────────────────────────────────────────────
    for (const item of plainNbrs) {
        const s = item.sym;
        if (!s || seen.has(s.id)) continue;
        seen.add(s.id);
        nodes.push(..._symNodesForSym(s, s.id, false, edgeMemberIds));
    }

    // ── Build edges (member-to-member where possible) ────────────────────────
    // Build a set of all actual node IDs so we can fallback collapsed members
    const nodeIdSet = new Set(nodes.map(n => n.data.id));

    // Resolve a member ID to an existing node — if the member was removed
    // (e.g. card is collapsed), fall back to the card's header node.
    const resolveId = (memberId, cardId) => {
        if (nodeIdSet.has(memberId)) return memberId;
        // Collapsed card: fall back to header
        const hdr = `${cardId}__hdr`;
        if (nodeIdSet.has(hdr)) return hdr;
        return cardId;
    };

    // Map center children IDs to 'center' card ID for resolution
    const centerChildIds = new Set(
        (center.children || []).map(c => c.id)
    );

    const edgeIdSet = new Set();

    for (const item of incoming) {
        if (!item.sym) continue;
        // Source: neighbor member (or its parent card if collapsed)
        const nbrCard = item.neighbor_parent_id || item.sym.id;
        const source = resolveId(item.sym.id, nbrCard);
        // Target: center member (or center card header if collapsed)
        const rawTarget = item.center_member_id || 'center';
        const target = centerChildIds.has(rawTarget)
            ? resolveId(rawTarget, 'center')
            : (nodeIdSet.has(rawTarget) ? rawTarget : 'center__hdr');
        if (!nodeIdSet.has(source) || !nodeIdSet.has(target)) continue;
        const eid = `in_${source}_${target}_${item.edge_type}`;
        if (edgeIdSet.has(eid)) continue;
        edgeIdSet.add(eid);
        const cnt = item.count || 1;
        const lw = cnt > 1 ? Math.min(1.5 + Math.log2(cnt), 6) : 1.5;
        const label = `${item.edge_type}${cnt > 1 ? ' \xd7' + cnt : ''}`;
        edges.push({
            data: {
                id: eid, source, target,
                edgeType: item.edge_type, count: cnt, lineWidth: lw,
                isBundled: cnt > 1 || undefined, label
            }
        });
    }

    for (const item of outgoing) {
        if (!item.sym) continue;
        // Source: center member (or center card header if collapsed)
        const rawSource = item.center_member_id || 'center';
        const source = centerChildIds.has(rawSource)
            ? resolveId(rawSource, 'center')
            : (nodeIdSet.has(rawSource) ? rawSource : 'center__hdr');
        // Target: neighbor member (or its parent card if collapsed)
        const nbrCard = item.neighbor_parent_id || item.sym.id;
        const target = resolveId(item.sym.id, nbrCard);
        if (!nodeIdSet.has(source) || !nodeIdSet.has(target)) continue;
        const eid = `out_${source}_${target}_${item.edge_type}`;
        if (edgeIdSet.has(eid)) continue;
        edgeIdSet.add(eid);
        const cnt = item.count || 1;
        const lw = cnt > 1 ? Math.min(1.5 + Math.log2(cnt), 6) : 1.5;
        const label = `${item.edge_type}${cnt > 1 ? ' \xd7' + cnt : ''}`;
        edges.push({
            data: {
                id: eid, source, target,
                edgeType: item.edge_type, count: cnt, lineWidth: lw,
                isBundled: cnt > 1 || undefined, label
            }
        });
    }

    return { nodes, edges };
}

function _symNodesForSym(sym, nodeId, isCenter, edgeMemberIds) {
    const isCard = ['class', 'struct', 'interface', 'enum'].includes(sym.kind);
    if (!isCard) return [_symMakePlainNode(sym, nodeId, isCenter)];
    const children = (sym.children || []).slice().sort((a, b) => (a.line || 0) - (b.line || 0));
    const vis = isCenter ? children : children.filter(c => edgeMemberIds && edgeMemberIds.has(c.id));
    if (!vis.length) return [_symMakePlainNode(sym, nodeId, isCenter)];
    return _symMakeClassCompound(sym, nodeId, isCenter, vis);
}

function _symMakeClassCompound(sym, nodeId, isCenter, visChildren) {
    const isCollapsed = _sym.collapsed.has(nodeId);

    // pill width: longest member name * char width + padding
    const maxMemberLen = Math.max(...visChildren.map(c => (c.name || '').length), 0);
    const nameLen = (sym.name || '').length;
    const pillW = Math.max(Math.round(maxMemberLen * 7.5 + 20), Math.round(nameLen * 8 + 30), 80);
    // card content width = pillW (sections fill this width)
    // card total width = pillW + toggle + gap on right = pillW + _SYM_CARD_PAD*2 + _SYM_TOGGLE_SIZE
    const cardW = pillW + _SYM_TOGGLE_SIZE + _SYM_CARD_PAD * 2;

    const pub = isCollapsed ? [] : visChildren.filter(c => c.access_level === 'public');
    const priv = isCollapsed ? [] : visChildren.filter(c => c.access_level !== 'public');

    // Pre-compute section heights so card height is exact
    const pubH = pub.length ? _symEstimateSectionH(pub.length) : 0;
    const privH = priv.length ? _symEstimateSectionH(priv.length) : 0;
    const sectionsH = (pubH ? pubH : 0)
        + (pubH && privH ? _SYM_CARD_SPC_Y : 0)
        + (privH ? privH : 0);
    const cardH = _SYM_CARD_PAD + _SYM_CHAR_H + _SYM_CARD_SPC_A
        + (sectionsH > 0 ? sectionsH : 0)
        + _SYM_CARD_PAD;

    // ── BIG_NODE outer card — fixed size ──────────────────────────────────
    const result = [{
        data: {
            id: nodeId, label: '', kind: sym.kind, symId: sym.id,
            isCenter: isCenter || undefined, isClassCard: true,
            memberCount: visChildren.length,
            isCollapsed: isCollapsed || undefined,
            cardWidth: cardW, cardHeight: cardH, pillWidth: pillW,
        }
    }];

    const _kindPrefix = { interface: '«interface» ', struct: '«struct» ', enum: '«enum» ', typedef: '«type» ' };
    result.push({
        data: {
            id: `${nodeId}__hdr`, parent: nodeId,
            isClassHdr: true, isCenter: isCenter || undefined,
            label: (_kindPrefix[sym.kind] || '') + sym.name,
            pillWidth: pillW,
        }
    });
    result.push({
        data: {
            id: `${nodeId}__toggle`, parent: nodeId,
            isToggle: true, label: String(visChildren.length),
        }
    });

    if (isCollapsed) return result;

    // ── ACCESS section compounds — fixed sectionW + sectionH ──────────────
    if (pub.length) {
        const secId = `${nodeId}__pub`;
        result.push({
            data: {
                id: secId, parent: nodeId, isSection: true,
                sectionW: pillW, sectionH: pubH, pillWidth: pillW
            }
        });
        result.push({
            data: {
                id: `${secId}__hdr`, parent: secId,
                isSectionHdr: true, label: '\u2295 PUBLIC', pillWidth: pillW
            }
        });
        pub.forEach(m => result.push(_symMakeMemberNode(m, secId, pillW)));
    }
    if (priv.length) {
        const secId = `${nodeId}__priv`;
        result.push({
            data: {
                id: secId, parent: nodeId, isSection: true,
                sectionW: pillW, sectionH: privH, pillWidth: pillW
            }
        });
        result.push({
            data: {
                id: `${secId}__hdr`, parent: secId,
                isSectionHdr: true, label: '\u2302 PRIVATE', pillWidth: pillW
            }
        });
        priv.forEach(m => result.push(_symMakeMemberNode(m, secId, pillW)));
    }

    return result;
}

function _symMakePlainNode(sym, nodeId, isCenter) {
    return { data: { id: nodeId, label: sym.name, kind: sym.kind, symId: sym.id, isCenter: isCenter || undefined } };
}

function _symMakeMemberNode(member, parentId, pillWidth) {
    const file = member.file ||
        (window.DATA && DATA.symbol_index && DATA.symbol_index[member.id] || {}).file ||
        null;
    return {
        data: {
            id: member.id, parent: parentId, label: member.name, kind: member.kind,
            symId: member.id, line: member.line || 0, end_line: member.end_line || 0,
            file, isMember: true,
            isPublic: member.access_level === 'public' || undefined,
            pillWidth: pillWidth,
        }
    };
}

// ── Layout: TrailLayouter + member positioning ────────────────────────────────

function _symComputeLayout(data, elements) {
    const { center, incoming = [], outgoing = [], neighbor_parents = {} } = data;
    const allSyms = [
        center,
        ...incoming.map(i => i.sym),
        ...outgoing.map(o => o.sym),
        ...Object.values(neighbor_parents),
    ].filter(Boolean);
    const symById = Object.fromEntries(allSyms.map(s => [s.id, s]));

    // Top-level node sizes for TrailLayouter
    const seen = new Set();
    const topNodes = [];
    for (const el of elements.nodes) {
        const id = el.data.id;
        if (el.data.parent || seen.has(id)) continue;
        seen.add(id);
        const sym = symById[el.data.symId] || symById[id];
        const h = el.data.cardHeight || (sym ? _symEstimateCardHeight(el.data.id, elements) : 44);
        const w = el.data.cardWidth || 170;
        topNodes.push({ id, width: w, height: h });
    }

    // Deduplicated top-level edges
    const rawEdges = elements.edges.map(e => ({
        source: _symGetTopLevelId(e.data.source, elements),
        target: _symGetTopLevelId(e.data.target, elements),
    })).filter(e => e.source !== e.target);

    const classPos = (window.TrailLayouter && topNodes.length)
        ? TrailLayouter.layout(topNodes, _symDedupeEdges(rawEdges), { rankDir: 'LR', rankSep: 220, nodeSep: 80 })
        : {};

    // Fallback: if TrailLayouter unavailable, arrange horizontally
    if (!Object.keys(classPos).length) {
        topNodes.forEach((n, i) => { classPos[n.id] = { x: i * 280, y: 0 }; });
    }

    // Compute member + section header positions per class card.
    // NOTE: compound parent positions are NOT included — Cytoscape derives them from children.
    const allPos = {};
    const computed = new Set();

    // For non-compound (plain) nodes, keep TrailLayouter positions
    for (const el of elements.nodes) {
        if (el.data.parent) continue;  // skip children (handled below)
        if (el.data.isClassCard) continue;  // skip compound parents
        if (classPos[el.data.id]) allPos[el.data.id] = classPos[el.data.id];
    }

    // For compound class cards: position all children (classHdr, sectionHdrs, members).
    // We iterate isClassCard nodes directly so classPos[cardId] always resolves.
    for (const el of elements.nodes) {
        if (!el.data.isClassCard) continue;
        const nodeId = el.data.id;
        if (computed.has(nodeId)) continue;
        const cp = classPos[nodeId];
        if (!cp) continue;
        const symId = (nodeId === 'center') ? center.id : (el.data.symId || nodeId);
        const sym = symById[symId];
        if (!sym) continue;
        computed.add(nodeId);
        allPos[nodeId] = cp;   // explicit compound position prevents Cytoscape bbox-drift
        const mp = _symMemberPositions(cp, nodeId, elements);
        Object.assign(allPos, mp);
    }
    return allPos;
}

// CodeViz ACCESS node size.y = top(40) + pills_col + bottom(10)
// pills_col = N * pillH + (N-1) * spacingY
function _symEstimateSectionH(memberCount) {
    const pillsH = memberCount * _SYM_PILL_H + Math.max(memberCount - 1, 0) * _SYM_SEC_SPC_Y;
    return _SYM_SEC_TOP + pillsH + _SYM_SEC_BOT;
}

// CodeViz BIG_NODE size.y = top(10) + charH + spacingA(5) + ACCESS_total + bottom(10)
function _symEstimateCardHeight(nodeId, elements) {
    const isCollapsed = _sym.collapsed.has(nodeId);
    // collapsed: top + charH + spacingA + bottom (no ACCESS sections)
    const base = _SYM_CARD_PAD + _SYM_CHAR_H + _SYM_CARD_SPC_A + _SYM_CARD_PAD;
    if (isCollapsed) return base;

    const sections = elements.nodes.filter(n => n.data.isSection && n.data.parent === nodeId);
    if (!sections.length) return base;

    // top + charH + spacingA + [ACCESS sections with spacingY between] + bottom
    let h = _SYM_CARD_PAD + _SYM_CHAR_H + _SYM_CARD_SPC_A;
    let first = true;
    for (const sec of sections) {
        const mc = elements.nodes.filter(n => n.data.isMember && n.data.parent === sec.data.id).length;
        if (!mc) continue;
        if (!first) h += _SYM_CARD_SPC_Y;
        first = false;
        h += _symEstimateSectionH(mc);
    }
    h += _SYM_CARD_PAD;
    return Math.max(h, 60);
}

function _symMemberPositions(classPos, nodeId, elements) {
    const result = {};
    const totalH = _symEstimateCardHeight(nodeId, elements);
    const cx = classPos.x;

    const cardEl = elements.nodes.find(n => n.data.id === nodeId);
    const pillW = (cardEl && cardEl.data.pillWidth) || 130;
    const cardTop = classPos.y - totalH / 2;

    // Class name header — left-aligned in content area, vertically centered in charH row
    // CodeViz: textOffset.x=10, textOffset.y=8 → title sits at (left+10, top+8)
    // In Cytoscape preset layout we position the node center, so x = cardLeft + cardW/2 - toggle/2
    // Use cx (card center) shifted left to leave room for toggle on right
    const classHdr = elements.nodes.find(n => n.data.id === `${nodeId}__hdr`);
    if (classHdr) {
        result[classHdr.data.id] = {
            x: cx - _SYM_TOGGLE_SIZE / 2,   // shift left by half toggle to balance
            y: cardTop + _SYM_CARD_PAD + _SYM_CHAR_H / 2,
        };
    }

    // Toggle — CodeViz: position.x = left + width - toggle.size.x, position.y = 6
    // In Cytoscape: right edge of card content, y = cardTop + 6 + toggle/2
    const toggle = elements.nodes.find(n => n.data.id === `${nodeId}__toggle`);
    if (toggle) {
        result[toggle.data.id] = {
            x: cx + pillW / 2 + _SYM_CARD_PAD - _SYM_TOGGLE_SIZE / 2,
            y: cardTop + 6 + _SYM_TOGGLE_SIZE / 2,
        };
    }

    if (_sym.collapsed.has(nodeId)) return result;

    // Section compound positions
    // y starts after: top + charH + spacingA
    let y = cardTop + _SYM_CARD_PAD + _SYM_CHAR_H + _SYM_CARD_SPC_A;

    const sectionIds = [`${nodeId}__pub`, `${nodeId}__priv`];
    let firstSec = true;
    for (const secId of sectionIds) {
        const secEl = elements.nodes.find(n => n.data.id === secId);
        if (!secEl) continue;
        const members = elements.nodes
            .filter(n => n.data.isMember && n.data.parent === secId)
            .sort((a, b) => (a.data.line || 0) - (b.data.line || 0));
        if (!members.length) continue;

        if (!firstSec) y += _SYM_CARD_SPC_Y;
        firstSec = false;

        const secH = _symEstimateSectionH(members.length);
        // Section compound center: left-aligned to card content area.
        // cardW = pillW + TOGGLE_SIZE + CARD_PAD*2, so section left edge = card_left + CARD_PAD.
        // Section center x = cx - TOGGLE_SIZE/2  (shifts left to leave toggle gap on right)
        const secX = cx - _SYM_TOGGLE_SIZE / 2;
        result[secId] = { x: secX, y: y + secH / 2 };

        // Section header label node
        const secHdr = elements.nodes.find(n => n.data.id === `${secId}__hdr`);
        if (secHdr) {
            result[secHdr.data.id] = { x: secX, y: y + _SYM_SEC_TOP / 2 };
        }

        // Pills — start at top + spacingTop(inside section padding)
        // CodeViz: ACCESS subNodes start at top(40) offset, with spacingY=8
        let py = y + _SYM_SEC_TOP;
        for (const m of members) {
            result[m.data.id] = { x: secX, y: py + _SYM_PILL_H / 2 };
            py += _SYM_PILL_H + _SYM_SEC_SPC_Y;
        }

        y += secH;
    }

    return result;
}

function _symGetTopLevelId(nodeId, elements) {
    let id = nodeId;
    for (let i = 0; i < 6; i++) {
        const el = elements.nodes.find(n => n.data.id === id);
        if (!el || !el.data.parent) return id;
        id = el.data.parent;
    }
    return id;
}

function _symDedupeEdges(edges) {
    const seen = new Set();
    return edges.filter(e => {
        const key = `${e.source}\u2192${e.target}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

// ── Tap handler ───────────────────────────────────────────────────────────────

function _symOnNodeTap(event, data) {
    const d = event.target.data();
    if (d.isGroup) return;
    _symHideEdgeTooltip();

    if (d.isToggle) {
        const parentId = event.target.data('parent');
        if (_sym.collapsed.has(parentId)) _sym.collapsed.delete(parentId);
        else _sym.collapsed.add(parentId);
        _symFetchAndRender(_sym.active);
        return;
    }
    if (d.isSection || d.isSectionHdr || d.isClassCard) return;

    // Class header of a neighbor card → navigate to that class
    if (d.isClassHdr && !d.isCenter) {
        const parentId = event.target.data('parent');
        if (parentId) {
            // Find the symId of the parent compound node
            const parentNode = _sym.cy.getElementById(parentId);
            const psid = parentNode.data('symId');
            if (psid) { symViewActivate(psid); return; }
        }
        return;
    }
    if (d.isClassHdr) return;  // center class header — no action

    if (d.isMember) {
        _sym.cy.nodes().removeClass('sym-active-member');
        event.target.addClass('sym-active-member');
        const useMulti = window.codeState && codeState.multiSnip;
        if (useMulti) {
            // Multi-snippet mode: show reference snippets in code panel
            if (d.symId) {
                _symShowSnippets(d.symId, d.line);
            } else {
                const file = _symCenterFile();
                if (file && window.loadFileInPanel) loadFileInPanel(file, null);
                if (d.line) setTimeout(() => window.jumpToLine && jumpToLine(d.line), 150);
            }
        } else {
            // File mode: jump directly to the symbol's line in the full file view
            const file = d.file || _symCenterFile();
            if (file && window.loadFileInPanel) loadFileInPanel(file, null);
            if (d.line) setTimeout(() => window.jumpToLine && jumpToLine(d.line), 150);
        }
        return;
    }

    if (d.isCenter) {
        const useMulti = window.codeState && codeState.multiSnip;
        if (useMulti && d.symId) {
            _symShowSnippets(d.symId);
        } else {
            const sym = data.center;
            if (sym.file && window.loadFileInPanel) loadFileInPanel(sym.file, sym.name);
        }
        return;
    }

    if (d.symId) {
        const useMulti = window.codeState && codeState.multiSnip;
        if (useMulti) {
            _symShowSnippets(d.symId);
        } else {
            symViewActivate(d.symId);
        }
    }
}

// ── Edge tooltip (bundled edges) ──────────────────────────────────────────────

function _symOnEdgeTap(e) {
    const d = e.target.data();
    const oe = e.originalEvent;
    if (!oe) return;

    // Show tooltip
    const tooltip = document.getElementById('sym-edge-tooltip');
    if (tooltip) {
        const typeColor = _SYM_EDGE_COLORS[d.edgeType] || '#94a3b8';
        tooltip.innerHTML =
            `<span class="sym-et-type" style="color:${_symEscHtml(typeColor)}">${_symEscHtml(d.edgeType || 'edge')}</span>` +
            (d.count > 1 ? `<span class="sym-et-count">\xd7${d.count}</span>` : '');
        tooltip.style.left = (oe.clientX + 14) + 'px';
        tooltip.style.top = (oe.clientY - 12) + 'px';
        tooltip.classList.add('visible');
    }

    // Navigate code panel: prefer source node's symbol, fall back to target
    if (!_sym.cy || !window.DATA || !DATA.symbol_index) return;
    const tryNavCode = (nodeId) => {
        if (!nodeId) return false;
        const node = _sym.cy.getElementById(nodeId);
        const symId = node && node.data('symId');
        if (!symId) return false;
        const sym = DATA.symbol_index[symId];
        if (!sym || !sym.file) return false;
        if (window.loadFileInPanel) loadFileInPanel(sym.file, null);
        if (sym.line) setTimeout(() => window.jumpToLine && jumpToLine(sym.line), 150);
        return true;
    };
    if (!tryNavCode(d.source)) tryNavCode(d.target);
}

function _symHideEdgeTooltip() {
    const tooltip = document.getElementById('sym-edge-tooltip');
    if (tooltip) tooltip.classList.remove('visible');
}

// ── Snippet panel (Phase 5) — rendered inside the existing #code-panel ────────

async function _symShowSnippets(symId, _fallbackLine) {
    // Render snippets into the existing right-side code panel (#cp-code-wrap)
    // rather than a separate sidebar, so structure mode reuses the normal panel.
    const wrap = document.getElementById('cp-code-wrap');
    const filenameEl = document.getElementById('cp-filename');
    const extBadge = document.getElementById('cp-ext-badge');
    if (!wrap) return;

    // Ensure code panel is visible
    if (window.openCodePanel) openCodePanel();
    if (window.hideFuncBar) hideFuncBar();

    // Hide loading/empty placeholders and show wrap
    const cpLoading = document.getElementById('cp-loading');
    const cpEmpty = document.getElementById('cp-empty');
    if (cpLoading) cpLoading.classList.add('hidden');
    if (cpEmpty) cpEmpty.style.display = 'none';
    wrap.style.display = '';
    wrap.innerHTML = '<div class="sym-snip-loading">Loading\u2026</div>';

    // Sentinel: force next loadFileInPanel call to re-fetch even for same path
    if (window.codeState) codeState.currentFile = '__sym_snippet__';

    const jid = _sym.jobId || '';
    try {
        const resp = await fetch(
            `/symbol-refs?job=${encodeURIComponent(jid)}&sym=${encodeURIComponent(symId)}`
        );
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const sym = data.symbol || {};

        // Update code panel header to reflect the symbol being inspected
        if (filenameEl) filenameEl.textContent = sym.name || 'References';
        if (extBadge) {
            extBadge.textContent = (sym.kind || 'SYM').toUpperCase();
            extBadge.style.background = '';
            extBadge.style.color = '';
        }

        _symRenderSnippets(wrap, data);
    } catch (e) {
        console.error('[sym-view] snippet fetch error:', e);
        wrap.innerHTML = '<div class="sym-snip-loading">Error loading references</div>';
    }
}

function _symCloseSnippets() {
    // No separate panel to close — snippets live in #cp-code-wrap.
    // The next loadFileInPanel call (triggered by navigation) overwrites the content.
    if (_sym.cy) _sym.cy.nodes().removeClass('sym-active-member');
}

function _symRenderSnippets(wrap, data) {
    const defs = data.definitions || [];
    const refs = data.references || [];

    wrap.innerHTML = '';
    const body = document.createElement('div');
    body.className = 'sym-snip-body';

    if (!defs.length && !refs.length) {
        const empty = document.createElement('div');
        empty.className = 'sym-snip-loading';
        empty.textContent = 'No references found';
        body.appendChild(empty);
    } else {
        if (defs.length) _symAppendSnipSection(body, 'Definition', defs, 'definition');
        if (refs.length) _symAppendSnipSection(body, 'References', refs, 'reference');
    }
    wrap.appendChild(body);
}

function _symAppendSnipSection(container, title, items, type) {
    const hdr = document.createElement('div');
    hdr.className = 'sym-snip-sec-hdr';
    hdr.textContent = `${title} (${items.length})`;
    container.appendChild(hdr);
    for (const item of items) container.appendChild(_symMakeSnipItem(item, type));
}

function _symMakeSnipItem(item, type) {
    const wrap = document.createElement('div');
    wrap.className = `sym-snip-item ${type}`;

    const label = document.createElement('div');
    label.className = 'sym-snip-file-label';
    label.textContent = `${item.file}:${item.line}`;
    label.onclick = () => {
        if (window.loadFileInPanel) loadFileInPanel(item.file, null);
        if (item.line) setTimeout(() => window.jumpToLine && jumpToLine(item.line), 150);
    };
    wrap.appendChild(label);

    const pre = document.createElement('div');
    pre.className = 'sym-snip-pre';
    const snippetLines = (item.snippet || '').split('\n');
    const hlOffset = item.highlight != null ? item.highlight : -1;
    snippetLines.forEach((lineText, i) => {
        const row = document.createElement('div');
        row.className = 'sym-snip-line' + (i === hlOffset ? ' hl' : '');
        const lnum = document.createElement('span');
        lnum.className = 'sym-snip-lnum';
        lnum.textContent = (item.start_line || 1) + i;
        const code = document.createElement('span');
        code.className = 'sym-snip-code';
        code.textContent = lineText;
        row.appendChild(lnum);
        row.appendChild(code);
        pre.appendChild(row);
    });
    wrap.appendChild(pre);
    return wrap;
}

// ── Search ────────────────────────────────────────────────────────────────────

async function _symSearch(query) {
    const container = document.getElementById('sym-search-results');
    if (!container) return;
    if (!query || query.length < 2) { container.innerHTML = ''; return; }
    const jid = _sym.jobId || '';
    try {
        const resp = await fetch(`/symbols?job=${encodeURIComponent(jid)}&query=${encodeURIComponent(query)}`);
        const result = await resp.json();
        _symShowSearchResults(result.results || []);
    } catch (e) {
        console.error('[sym-view] Search error:', e);
    }
}

function _symShowSearchResults(results) {
    const container = document.getElementById('sym-search-results');
    if (!container) return;
    container.innerHTML = '';
    if (!results.length) return;
    results.slice(0, 12).forEach(r => {
        const item = document.createElement('div');
        item.className = 'sym-search-item';
        item.innerHTML = `<span class="sym-kind-badge kind-${r.kind}">${_symEscHtml(r.kind)}</span>` +
            `<span>${_symEscHtml(r.name)}</span>`;
        item.onclick = () => {
            container.innerHTML = '';
            const si = document.getElementById('sym-search-input');
            if (si) si.value = '';
            symViewActivate(r.id);
        };
        container.appendChild(item);
    });
}

// ── Navigation (Phase 8) ──────────────────────────────────────────────────────

function _symBack() {
    if (!_sym.history.length) return;
    _sym.future.unshift(_sym.active);
    const prev = _sym.history.pop();
    _sym.active = null;
    if (prev === '__overview__') {
        _sym.active = '__overview__';
        _sym.mode = 'overview';
        if (_sym.cy) { _sym.cy.destroy(); _sym.cy = null; }
        _symShowOverview(_sym.overviewFile);
    } else {
        symViewActivate(prev, true);
    }
}

function _symForward() {
    if (!_sym.future.length) return;
    _sym.history.push(_sym.active);
    const next = _sym.future.shift();
    _sym.active = null;
    if (next === '__overview__') {
        _sym.active = '__overview__';
        _sym.mode = 'overview';
        if (_sym.cy) { _sym.cy.destroy(); _sym.cy = null; }
        _symShowOverview(_sym.overviewFile);
    } else {
        symViewActivate(next, true);
    }
}

function _symUpdateBack() {
    const back = document.getElementById('sym-back-btn');
    const fwd = document.getElementById('sym-fwd-btn');
    if (back) back.disabled = _sym.history.length === 0;
    if (fwd) fwd.disabled = _sym.future.length === 0;
}

function _symGoOverview() {
    if (!_sym.overviewFile) return;
    if (_sym.active && _sym.active !== '__overview__') {
        _sym.history.push(_sym.active);
        _sym.future = [];
    }
    if (_sym.cy) { _sym.cy.destroy(); _sym.cy = null; }
    _sym.active = '__overview__';
    _sym.mode = 'overview';
    _symShowOverview(_sym.overviewFile);
    _symUpdateBack();
}

// ── Edge type filter pills (Phase 7) ─────────────────────────────────────────

// Ordered list of edge types to show in toolbar
const _SYM_FILTER_ORDER = ['call', 'inheritance', 'import', 'type_usage', 'include', 'override', 'member'];

function _symBuildFilterPills() {
    const container = document.getElementById('sym-filter-pills');
    if (!container) return;
    container.innerHTML = '';
    for (const type of _SYM_FILTER_ORDER) {
        const color = _SYM_EDGE_COLORS[type] || '#94a3b8';
        const pill = document.createElement('button');
        pill.className = 'sym-filter-pill';
        pill.dataset.type = type;
        pill.title = `Toggle ${type} edges`;
        pill.innerHTML = `<span class="sym-fp-dot" style="background:${color}"></span>${type}`;
        pill.addEventListener('click', () => _symToggleEdgeFilter(type, pill));
        container.appendChild(pill);
    }
}

function _symToggleEdgeFilter(type, pill) {
    if (_sym.hiddenEdgeTypes.has(type)) {
        _sym.hiddenEdgeTypes.delete(type);
        pill.classList.remove('sym-fp-off');
    } else {
        _sym.hiddenEdgeTypes.add(type);
        pill.classList.add('sym-fp-off');
    }
    _symApplyEdgeFilters();
}

function _symApplyEdgeFilters() {
    if (!_sym.cy) return;
    _sym.cy.edges().forEach(edge => {
        const type = edge.data('edgeType');
        const hidden = _sym.hiddenEdgeTypes.has(type);
        edge.style('display', hidden ? 'none' : 'element');
    });
}

function _symCenterFile() {
    if (!_sym.active || !window.DATA || !DATA.symbol_index) return null;
    const sym = DATA.symbol_index[_sym.active];
    return sym ? sym.file : null;
}

// ── Overview (CodeViz-style kind-node cards) ──────────────────────────────

// Icon for each symbol kind
const _SYM_OV_ICONS = {
    class: '◈',
    struct: '▣',
    interface: '◇',
    enum: '≡',
    function: 'ƒ',
    method: 'ƒ',
    typedef: 'τ',
    field: '·',
};

function _symShowOverview(fileRel) {
    _sym.mode = 'overview';
    _sym.overviewFile = fileRel;

    // Update breadcrumb to show filename
    const bc = document.getElementById('sym-breadcrumb');
    if (bc) bc.textContent = fileRel ? fileRel.split('/').pop() : '';

    // Hide Cytoscape canvas and Overview button; they belong to centric mode only
    const symCyEl = document.getElementById('sym-cy');
    const ovBtn = document.getElementById('sym-overview-btn');
    if (symCyEl) symCyEl.style.display = 'none';
    if (ovBtn) ovBtn.style.display = 'none';
    if (window.refreshGraphZoomControls) window.refreshGraphZoomControls();

    // Lazily create #sym-overview inside #sym-body
    let ovEl = document.getElementById('sym-overview');
    if (!ovEl) {
        ovEl = document.createElement('div');
        ovEl.id = 'sym-overview';
        const body = document.getElementById('sym-body');
        if (body) body.appendChild(ovEl);
    }
    ovEl.style.display = 'flex';
    ovEl.innerHTML = '';

    // Collect symbols for this file
    const allSyms = Object.values(DATA.symbol_index || {});
    const inFile = allSyms.filter(s => s.file === fileRel);

    if (!inFile.length) {
        const empty = document.createElement('div');
        empty.className = 'sym-ov-empty';
        empty.textContent = 'No symbols found in this file.';
        ovEl.appendChild(empty);
        _symUpdateBack();
        return;
    }

    // Group by kind, sort each group by line number
    const groups = {};
    for (const sym of inFile) {
        const k = sym.kind || 'other';
        if (!groups[k]) groups[k] = [];
        groups[k].push(sym);
    }
    for (const syms of Object.values(groups)) {
        syms.sort((a, b) => (a.line || 0) - (b.line || 0));
    }

    // Card display order (mirrors CodeViz priority)
    const kindOrder = ['class', 'struct', 'interface', 'enum', 'function', 'method', 'typedef', 'field'];
    const orderedKinds = [
        ...kindOrder.filter(k => groups[k]),
        ...Object.keys(groups).filter(k => !kindOrder.includes(k)),
    ];

    const grid = document.createElement('div');
    grid.className = 'sym-ov-grid';
    ovEl.appendChild(grid);

    let activeExpand = null;

    for (const kind of orderedKinds) {
        const syms = groups[kind];

        const card = document.createElement('div');
        card.className = `sym-ov-card ov-kind-${_symEscHtml(kind)}`;

        const countBadge = document.createElement('span');
        countBadge.className = 'sym-ov-count';
        countBadge.textContent = syms.length;
        card.appendChild(countBadge);

        const iconEl = document.createElement('span');
        iconEl.className = 'sym-ov-icon';
        iconEl.textContent = _SYM_OV_ICONS[kind] || '○';
        card.appendChild(iconEl);

        const labelEl = document.createElement('span');
        labelEl.className = 'sym-ov-label';
        labelEl.textContent = kind + (syms.length !== 1 ? 's' : '');
        card.appendChild(labelEl);

        card.onclick = (e) => {
            e.stopPropagation();
            // Close any other open dropdown
            if (activeExpand && activeExpand !== card._expandEl) {
                activeExpand.remove();
                activeExpand = null;
            }
            // Single symbol → multi-snippet or centric graph
            if (syms.length === 1) {
                const s = syms[0];
                const useMulti = window.codeState && codeState.multiSnip;
                if (useMulti) {
                    _symShowSnippets(s.id);
                } else {
                    if (s.file && window.loadFileInPanel) {
                        loadFileInPanel(s.file, null);
                        if (s.line) setTimeout(() => window.jumpToLine && jumpToLine(s.line), 150);
                    }
                    symViewActivate(s.id);
                }
                return;
            }
            // Toggle expand dropdown
            if (card._expandEl && card._expandEl.isConnected) {
                card._expandEl.remove();
                card._expandEl = null;
                activeExpand = null;
                return;
            }
            const drop = document.createElement('div');
            drop.className = 'sym-ov-expand';
            for (const sym of syms) {
                const item = document.createElement('div');
                item.className = 'sym-ov-expand-item';
                item.innerHTML =
                    `<span class="sym-ov-expand-name">${_symEscHtml(sym.name)}</span>` +
                    `<span class="sym-ov-expand-line">:${sym.line || '?'}</span>`;
                item.onclick = (ev) => {
                    ev.stopPropagation();
                    const useMulti = window.codeState && codeState.multiSnip;
                    if (useMulti) {
                        _symShowSnippets(sym.id);
                    } else {
                        if (sym.file && window.loadFileInPanel) {
                            loadFileInPanel(sym.file, null);
                            if (sym.line) setTimeout(() => window.jumpToLine && jumpToLine(sym.line), 150);
                        }
                        symViewActivate(sym.id);
                    }
                };
                drop.appendChild(item);
            }
            card.appendChild(drop);
            card._expandEl = drop;
            activeExpand = drop;
        };

        grid.appendChild(card);
    }

    // One-time outside click closes any open dropdown
    const closeExpand = () => {
        if (activeExpand) { activeExpand.remove(); activeExpand = null; }
    };
    ovEl._closeExpand && document.removeEventListener('click', ovEl._closeExpand);
    ovEl._closeExpand = closeExpand;
    document.addEventListener('click', closeExpand, { once: true });

    _symUpdateBack();
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function _symDebounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
}

function _symEscHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── Symbol View button state helpers ──────────────────────────────────────────

// Called by viz.js whenever a file is loaded — enable Structure btn if file has symbols.
window.svUpdateStructureBtn = function (fileRel, _ext) {
    const btn = document.getElementById('struct-toggle-btn');
    if (!btn) return;
    const hasSymbols = !!(window.DATA?.symbol_index &&
        Object.values(window.DATA.symbol_index).some(s => s.file === fileRel));
    btn.disabled = !hasSymbols;
    btn.classList.toggle('active', hasSymbols && !!_sym.active);
    btn.title = hasSymbols ? 'Structure View' : 'Structure View (no symbols for this file)';
};

// Called by viz.js when leaving file context (e.g. drillToModule).
window.svHideStructureBtn = function () {
    const btn = document.getElementById('struct-toggle-btn');
    if (!btn) return;
    btn.disabled = true;
    btn.classList.remove('active');
};

// ── Code ↔ Symbol bi-directional linking ──────────────────────────────────────

// Called by viz.js when user clicks a code line (lineIdx is 0-based).
// Highlights the Cytoscape node whose line range contains lineIdx+1.
window.svHighlightLine = function (lineIdx) {
    const lineNo = lineIdx + 1;  // convert to 1-based

    if (_sym.mode === 'overview') {
        // In overview: highlight the matching card
        const ovEl = document.getElementById('sym-overview');
        if (!ovEl || !window.DATA || !DATA.symbol_index) return;
        const file = _sym.overviewFile;
        if (!file) return;

        // Find the symbol whose line range contains lineNo
        const candidates = Object.values(DATA.symbol_index).filter(s => s.file === file);
        let best = null;
        for (const s of candidates) {
            const start = s.line || 0;
            const end = s.end_line || start;
            if (lineNo >= start && lineNo <= end) {
                if (!best || start > (best.line || 0)) best = s;  // prefer innermost
            }
        }
        if (!best) return;

        // Flash the matching card
        const cards = ovEl.querySelectorAll('.sym-ov-card');
        cards.forEach(c => c.classList.remove('sym-ov-card-active'));
        const kindClass = `ov-kind-${best.kind}`;
        cards.forEach(c => { if (c.classList.contains(kindClass)) c.classList.add('sym-ov-card-active'); });
        return;
    }

    // In centric mode: highlight the node whose line matches
    if (!_sym.cy) return;
    _sym.cy.nodes().removeClass('sym-active-member');
    _sym.cy.nodes().forEach(n => {
        const d = n.data();
        if (!d.line) return;
        const start = d.line;
        const end = d.end_line || start;
        if (lineNo >= start && lineNo <= end) {
            n.addClass('sym-active-member');
        }
    });
};

// Called by viz.js when user clicks on an identifier word in the code panel.
// Navigates to the symbol if found in symbol_index for the current file.
window.svHighlightBadgeByName = function (word) {
    if (!word || !window.DATA || !DATA.symbol_index) return;

    const file = _sym.mode === 'overview'
        ? _sym.overviewFile
        : (_sym.active && _sym.active !== '__overview__' ? (DATA.symbol_index[_sym.active] || {}).file : null);
    if (!file) return;

    // Look for a symbol with this name in the current file first, then globally
    const all = Object.values(DATA.symbol_index);
    const inFile = all.filter(s => s.file === file && s.name === word);
    const match = inFile.length ? inFile[0] : all.find(s => s.name === word);
    if (!match) return;

    // If we're in centric mode and it's a member of the current center, just highlight it
    if (_sym.mode === 'centric' && _sym.cy) {
        const node = _sym.cy.getElementById(match.id);
        if (node && node.length) {
            _sym.cy.nodes().removeClass('sym-active-member');
            node.addClass('sym-active-member');
            _sym.cy.animate({ center: { eles: node }, zoom: _sym.cy.zoom() }, { duration: 180 });
            return;
        }
    }

    // Otherwise navigate to the symbol (works in both overview and centric mode)
    if (match.file && window.loadFileInPanel) {
        loadFileInPanel(match.file, null);
        if (match.line) setTimeout(() => window.jumpToLine && jumpToLine(match.line), 150);
    }
    symViewActivate(match.id);
};

// Expose _sym.active so viz.js's `window._sv && window._sv.active` check works.
// viz.js uses this to detect whether Structure View is open (mutual exclusion with Call Graph).
window._sv = _sym;

// Called by viz.js when Multi-snippet mode is toggled ON: immediately show snippets
// for the current center symbol (centric mode) or do nothing (overview mode).
window.symShowCurrentSnippets = function () {
    if (_sym.mode === 'centric' && _sym.active && _sym.active !== '__overview__') {
        _symShowSnippets(_sym.active);
    }
};

// Alias used by viz.js to close the Structure/Symbol view (e.g. when switching to Call Graph).
window.svHideSvView = symViewClose;

// Called by viz.js structure button click handler as legacy fallback.
window.svToggleStructView = function () {
    const fileRel = window.codeState?.currentFile;
    if (fileRel) symViewOpen(fileRel);
};

// Update Structure button active state — called internally after open/close.
function _symUpdateStructBtn(isOpen) {
    const btn = document.getElementById('struct-toggle-btn');
    if (!btn) return;
    btn.classList.toggle('active', isOpen);
    // Sync Call Graph button active state only (do NOT change its disabled/enabled state).
    const graphBtn = document.getElementById('graph-toggle-btn');
    if (graphBtn) {
        const isL2 = !!(window.state && window.state.level >= 2);
        graphBtn.classList.toggle('active', isL2 && !isOpen);
    }
}
