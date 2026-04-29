// ── Symbol View — self-contained module (core, V3) ─────────────────────
// Owns: _svState, mount/unmount of #sym-view, public entry points, history,
//       legend save/restore. Graph rendering lives in sv_graph.js; search
//       bar in sv_search.js. Loaded before those two so they can read state.
//
// V3 model: a single unified file-level flow graph. `fileRel` identifies
// which file's graph is shown; `focusId` (nullable) marks the in-graph focus
// node whose rich detail pane is expanded. No more overview vs centric modes.

'use strict';

// ── Module state ──────────────────────────────────────────────────────────
const _svState = {
    fileRel:   null,         // current file path rel to project root
    focusId:   null,         // focused symbol id inside fileRel, or null
    history:   [],           // back stack of { fileRel, focusId }
    future:    [],           // forward stack
    jobId:     null,
    ready:     false,        // DOM mounted?
    svg:       null,
    viewport:  null,
    measureHost: null,
    zoom:      { k: 1, x: 0, y: 0 },
    currentGraph: null,      // last rendered file graph model
    currentData:  null,      // raw /symbol-file response for the current file
    baseLayoutSnapshot: null,
    focusLayoutSnapshot: null,
    activeAnimationToken: 0,
    searchOpen: false,
    searchCache: new Map(),
    hiddenEdgeTypes: new Set(),
    hideUnrelated: false,
    edgeJumpCursor: new Map(),
    selectedEdgeId: null,
    metricHighlight: null,          // 'callers' | 'callees' | null — metrics-click edge highlight
    focusCardHeightOverrides: new Map(),
    detailSectionCollapsed: new Set(),   // "signature" | "docstring" | "metrics"
    compoundCollapsed: new Set(),        // class compound ids whose methods are hidden
    _collapseAllOnLoad: true,            // when true, next load collapses all classes by default
    showExternal: false,                 // when false, ghost (external) nodes are hidden
    _legendSnap: null,

    // Back-compat alias — viz_code_panel.js / viz_graph.js / viz_sidebar.js
    // read `window._sv.active` as a truthy "is symbol view open" flag. Keep
    // it in sync via _svSyncActive().
    active: null,
};

function _svSyncActive() {
    _svState.active = _svState.fileRel || null;
}

// ── Kind palette (V3: extended with interface, enum, constant etc.) ───
const _SV_KIND_COLOR = {
    class:     '#9ca3af',   // gray
    struct:    '#9ca3af',
    interface: '#2dd4bf',   // teal — distinct from class
    enum:      '#a855f7',   // purple
    type:      '#9ca3af',
    method:    '#fbbf24',   // yellow
    function:  '#fbbf24',
    field:     '#60a5fa',   // blue
    variable:  '#60a5fa',
    constant:  '#38bdf8',   // sky — distinct from variable
    property:  '#60a5fa',
    default:   '#94a3b8',
};

const _SV_EDGE_COLOR = {
    call:        '#fbbf24',
    inheritance: '#9ca3af',
    implements:  '#2dd4bf',
    override:    '#f472b6',
    import:      '#34d399',
    include:     '#34d399',
    type_usage:  '#60a5fa',
    member:      '#a78bfa',
    default:     '#64748b',
};

const _SV_CARD_KINDS = new Set(['class', 'struct', 'interface', 'enum']);

// Animation duration applies to position tween, focus scale + fade, etc.
// Slightly slower than V3's original pacing to give move/expand/collapse
// animations more easing room near the end.
const _SV_DUR_MS = 780;

function _svKindColor(kind) {
    return _SV_KIND_COLOR[kind] || _SV_KIND_COLOR.default;
}

function _svSymDotColor(sym, isMethod) {
    const kind = sym && sym.kind;
    if (isMethod && (kind === 'method' || kind === 'function')) {
        return sym.is_public === false ? '#e8762a' : '#60a5fa';
    }
    return _svKindColor(kind);
}

function _svEdgeColor(type) {
    return _SV_EDGE_COLOR[type] || _SV_EDGE_COLOR.default;
}

// ── DOM lifecycle ─────────────────────────────────────────────────────────
function _svEnsureDom() {
    if (_svState.ready) return;
    const root = document.getElementById('sym-view');
    if (!root) return;

    root.innerHTML = `
      <div id="sv-toolbar">
        <div class="sv-tb-top">
          <span class="sv-tb-title">Symbol View</span>
          <span id="sv-breadcrumb"></span>
          <button id="sv-close-btn" title="Close Symbol View">&times;</button>
        </div>
        <div class="sv-tb-actions">
                    <button id="sv-back-btn" title="Back" disabled>&larr;</button>
          <button id="sv-fwd-btn"  title="Forward" disabled>&rarr;</button>
          <button id="sv-expand-all-btn" title="Expand all classes">Expand All</button>
          <button id="sv-collapse-all-btn" title="Collapse all classes">Collapse All</button>
          <button id="sv-ext-btn" title="Show/hide external symbols">External Symbol</button>
          <span id="sv-stats" class="sv-tb-stats"></span>
        </div>
      </div>
      <svg id="sv-svg" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="sv-arrow" viewBox="0 0 10 10" refX="9" refY="5"
                  markerWidth="6" markerHeight="6" orient="auto-start-reverse"
                  markerUnits="userSpaceOnUse">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"></path>
          </marker>
        </defs>
        <g class="sv-viewport">
          <g class="sv-edges"></g>
          <g class="sv-edge-labels"></g>
          <g class="sv-cards"></g>
          <g class="sv-ghosts"></g>
          <g class="sv-chip-layer"></g>
        </g>
      </svg>
                  <div id="sv-empty" hidden>
        <div class="sv-empty-icon">&#10697;</div>
        <div class="sv-empty-msg">No file loaded</div>
      </div>
      <div id="sv-card-measure" aria-hidden="true"></div>
      <div id="sv-edge-tip" hidden></div>
    `;

    _svState.svg      = root.querySelector('#sv-svg');
    _svState.viewport = root.querySelector('.sv-viewport');
    _svState.measureHost = root.querySelector('#sv-card-measure');

        root.querySelector('#sv-back-btn').onclick    = _svGoBack;
    root.querySelector('#sv-fwd-btn').onclick     = _svGoForward;
    root.querySelector('#sv-close-btn').onclick = symViewClose;
            root.querySelector('#sv-expand-all-btn').onclick  = _svExpandAll;
    root.querySelector('#sv-collapse-all-btn').onclick = _svCollapseAll;
    root.querySelector('#sv-ext-btn').onclick = _svToggleExternal;
    root.querySelector('#sv-ext-btn').classList.toggle('sv-btn-active', _svState.showExternal);

    _svInitPanZoom();
    if (typeof _svInitSearch === 'function') _svInitSearch();

    _svState.ready = true;
}

function _svInitPanZoom() {
    const svg = _svState.svg;
    if (!svg) return;
    let isPanning = false;
    let didPan    = false;
    let panStart  = null;

    svg.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = -e.deltaY;
        const factor = delta > 0 ? 1.1 : 0.9;
        const rect = svg.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const z = _svState.zoom;
        const nk = Math.max(0.1, Math.min(4, z.k * factor));
        z.x = cx - (cx - z.x) * (nk / z.k);
        z.y = cy - (cy - z.y) * (nk / z.k);
        z.k = nk;
        _svApplyZoom();
    }, { passive: false });

    svg.addEventListener('mousedown', (e) => {
        if (e.target !== svg && !e.target.classList.contains('sv-viewport')) return;
        isPanning = true;
        didPan    = false;
        panStart  = { x: e.clientX - _svState.zoom.x, y: e.clientY - _svState.zoom.y };
        svg.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', (e) => {
        if (!isPanning) return;
        didPan = true;
        _svState.zoom.x = e.clientX - panStart.x;
        _svState.zoom.y = e.clientY - panStart.y;
        _svApplyZoom();
    });
    window.addEventListener('mouseup', () => {
        if (!isPanning) return;
        isPanning = false;
        svg.style.cursor = '';
    });

    // Click on blank canvas (not on a node/edge) → clear focus and restore camera.
    svg.addEventListener('click', (e) => {
        if (didPan) return;
        const onBackground = e.target === svg
            || e.target === _svState.viewport
            || e.target.classList.contains('sv-edges')
            || e.target.classList.contains('sv-edge-labels')
            || e.target.classList.contains('sv-cards')
            || e.target.classList.contains('sv-ghosts');
        if (onBackground && _svState.focusId) {
            _svState.focusId = null;
            if (typeof _svRebuildForFocus === 'function') _svRebuildForFocus();
            else if (typeof _svApplyFocus === 'function') _svApplyFocus();
        }
    });
}

function _svApplyZoom() {
    const z = _svState.zoom;
    if (_svState.viewport) {
        _svState.viewport.setAttribute('transform', `translate(${z.x},${z.y}) scale(${z.k})`);
    }
}

function _svResetZoom(animate = true) {
    const svg = _svState.svg;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const targetZoom = { k: 1, x: rect.width / 2, y: rect.height / 2 };
    if (!animate) {
        _svState.zoom = targetZoom;
        _svApplyZoom();
        return;
    }
    _svAnimateValue(_svState.zoom, targetZoom, _SV_DUR_MS, _svApplyZoom);
}

function _svAnimateValue(obj, target, durationMs, onStep) {
    const start = {};
    for (const k in target) start[k] = obj[k];
    const t0 = performance.now();
    function frame(now) {
        const t = Math.min(1, (now - t0) / durationMs);
        const e = _svEase(t);
        for (const k in target) obj[k] = start[k] + (target[k] - start[k]) * e;
        if (onStep) onStep();
        if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
}

// easeInOutQuint — more dramatic than cubic, per V3 animation spec.
function _svEase(t) {
    return 1 - Math.pow(1 - t, 4);
}

// ── Public entry points ────────────────────────────────────────────────────

function symViewOpen(fileRel) {
    _svEnsureDom();
    _svState.jobId = window.JOB_ID || null;
    if (!fileRel) return;

    const root = document.getElementById('sym-view');
    if (!root) return;
    const cy = document.getElementById('cy');
    if (cy) cy.style.display = 'none';
    const ls = document.getElementById('layout-switcher');
    if (ls) ls.style.display = 'none';
    root.classList.add('active');
    _svSaveLegend();
    _svHideLegend();

    _svPushHistory();
    _svState.fileRel = fileRel;
    _svState.focusId = null;
    _svState.detailSectionCollapsed.clear();
    _svState.compoundCollapsed.clear();
    _svState._collapseAllOnLoad = true;
    _svState.edgeJumpCursor.clear();
    _svState.selectedEdgeId = null;
    _svState.baseLayoutSnapshot = null;
    _svState.focusLayoutSnapshot = null;
    _svState.activeAnimationToken += 1;
    _svSyncActive();

    if (typeof _svLoadFileGraph === 'function') {
        _svLoadFileGraph(fileRel);
    }
    _svSyncNavBtns();
    _svUpdateStructBtn(true);
    if (typeof refreshGraphZoomControls === 'function') refreshGraphZoomControls();
}

function symViewActivate(symId) {
    if (!symId) return;
    _svEnsureDom();
    _svState.jobId = window.JOB_ID || null;

    const sym = window.DATA && DATA.symbol_index ? DATA.symbol_index[symId] : null;
    if (!sym || !sym.file) return;

    const root = document.getElementById('sym-view');
    if (!root) return;
    const cy = document.getElementById('cy');
    if (cy) cy.style.display = 'none';
    const ls = document.getElementById('layout-switcher');
    if (ls) ls.style.display = 'none';
    root.classList.add('active');
    _svSaveLegend();
    _svHideLegend();

    _svPushHistory();

    if (sym.file !== _svState.fileRel) {
        _svState.fileRel = sym.file;
        _svState.focusId = symId;
        _svState.detailSectionCollapsed.clear();
        _svState.compoundCollapsed.clear();
        _svState._collapseAllOnLoad = true;
        _svState.edgeJumpCursor.clear();
        _svState.selectedEdgeId = null;
        _svState.baseLayoutSnapshot = null;
        _svState.focusLayoutSnapshot = null;
        _svState.activeAnimationToken += 1;
        _svSyncActive();
        if (typeof _svLoadFileGraph === 'function') {
            _svLoadFileGraph(sym.file, { pendingFocus: symId });
        }
    } else {
        // Same file — just move focus.
        _svSetFocus(symId);
    }
    _svSyncNavBtns();
    _svUpdateStructBtn(true);
}

function symViewClose() {
    const root = document.getElementById('sym-view');
    if (root) root.classList.remove('active');
    const cy = document.getElementById('cy');
    if (cy) cy.style.display = '';
    const ls = document.getElementById('layout-switcher');
    if (ls) ls.style.display = '';

    _svState.fileRel = null;
    _svState.focusId = null;
    _svState.currentGraph = null;
    _svState.currentData = null;
    _svState.baseLayoutSnapshot = null;
    _svState.focusLayoutSnapshot = null;
    _svState.activeAnimationToken += 1;
    _svSyncActive();
    _svRestoreLegend();
    _svSyncNavBtns();
    _svUpdateStructBtn(false);

        const results = document.getElementById('sv-search-results');
    if (results) results.hidden = true;
    _svState.searchOpen = false;

    // Sync topbar mode buttons to ensure Galaxy mode can be activated after closing Structure View
    if (typeof syncTopbarModeButtons === 'function') {
        syncTopbarModeButtons();
    }
    if (typeof refreshGraphZoomControls === 'function') refreshGraphZoomControls();
}

function _svPushHistory() {
    if (!_svState.fileRel) return;
    _svState.history.push({ fileRel: _svState.fileRel, focusId: _svState.focusId });
    if (_svState.history.length > 100) _svState.history.shift();
    _svState.future.length = 0;
}

function _svGoBack() {
    if (!_svState.history.length) return;
    const prev = _svState.history.pop();
    _svState.future.push({ fileRel: _svState.fileRel, focusId: _svState.focusId });
    _svJumpTo(prev);
}

function _svGoForward() {
    if (!_svState.future.length) return;
    const nxt = _svState.future.pop();
    _svState.history.push({ fileRel: _svState.fileRel, focusId: _svState.focusId });
    _svJumpTo(nxt);
}

function _svJumpTo(snap) {
    if (!snap) return;
    const prevFile = _svState.fileRel;
    _svState.fileRel = snap.fileRel || null;
    _svState.focusId = snap.focusId || null;
    _svState.detailSectionCollapsed.clear();
    _svState.compoundCollapsed.clear();
    _svState.edgeJumpCursor.clear();
    _svState.focusLayoutSnapshot = null;
    _svSyncActive();
    if (_svState.fileRel && _svState.fileRel !== prevFile) {
        if (typeof _svLoadFileGraph === 'function') {
            _svLoadFileGraph(_svState.fileRel, { pendingFocus: _svState.focusId });
        }
    } else if (typeof _svRebuildForFocus === 'function') {
        _svRebuildForFocus();
    } else if (typeof _svApplyFocus === 'function') {
        _svApplyFocus();
    }
    _svSyncNavBtns();
}

function _svSetFocus(symId) {
    _svPushHistory();
    _svState.focusId = symId;
    _svState.detailSectionCollapsed.clear();
    _svState.edgeJumpCursor.clear();
    _svState.selectedEdgeId = null;
    if (typeof _svRebuildForFocus === 'function') _svRebuildForFocus();
    else if (typeof _svApplyFocus === 'function') _svApplyFocus();
    _svSyncNavBtns();
}

function _svSyncNavBtns() {
    const back = document.getElementById('sv-back-btn');
    const fwd  = document.getElementById('sv-fwd-btn');
    if (back) back.disabled = !_svState.history.length;
    if (fwd)  fwd.disabled  = !_svState.future.length;
    
    // Reset hideUnrelated when no focus
    if (!_svState.focusId) _svState.hideUnrelated = false;
    
    // Refresh graph zoom controls (includes Focus Only button)
    if (typeof refreshGraphZoomControls === 'function') refreshGraphZoomControls();
}

function _svUpdateStructBtn(isOpen) {
    const btn = document.getElementById('struct-toggle-btn');
    if (btn) btn.classList.toggle('active', !!isOpen);
    const graphBtn = document.getElementById('graph-toggle-btn');
    if (graphBtn) {
        const isL2 = !!(window.state && window.state.level >= 2);
        graphBtn.classList.toggle('active', isL2 && !isOpen);
    }
}

// ── Legend save / restore ─────────────────────────────────────────────────
function _svSaveLegend() {
    if (_svState._legendSnap) return;
    const leg = document.getElementById('graph-legend');
    if (!leg) { _svState._legendSnap = { existed: false }; return; }
    _svState._legendSnap = {
        existed:   true,
        html:      leg.innerHTML,
        className: leg.className,
        display:   leg.style.display,
    };
}

function _svHideLegend() {
    const leg = document.getElementById('graph-legend');
    if (leg) leg.style.display = 'none';
}

function _svRestoreLegend() {
    const snap = _svState._legendSnap;
    if (!snap) return;
    const leg = document.getElementById('graph-legend');
    if (!snap.existed) {
        if (leg) leg.remove();
    } else if (leg) {
        leg.innerHTML  = snap.html;
        leg.className  = snap.className;
        leg.style.display = snap.display || '';
    }
    _svState._legendSnap = null;
}

// ── Small util used by all modules ────────────────────────────────────────
function _svEsc(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ── Cross-module globals exposed for viz_graph.js / viz_code_panel.js / viz_sidebar.js
window._svState        = _svState;  // Expose state for viz_layout.js
window.symViewOpen     = symViewOpen;
window.symViewActivate = symViewActivate;
window.symViewClose    = symViewClose;
window.svHideSvView    = symViewClose;
window.svToggleStructView = function () {
    const fileRel = window.codeState && window.codeState.currentFile;
    if (fileRel) symViewOpen(fileRel);
};
window.svUpdateStructureBtn = function (fileRel, _ext) {
    const btn = document.getElementById('struct-toggle-btn');
    if (!btn) return;
    const hasSymbols = !!(window.DATA && window.DATA.symbol_index &&
        Object.values(window.DATA.symbol_index).some(s => s.file === fileRel));
    btn.disabled = !hasSymbols;
    btn.classList.toggle('active', hasSymbols && !!_svState.fileRel);
    btn.title = hasSymbols ? 'Structure View' : 'Structure View (no symbols for this file)';
};
window.svHideStructureBtn = function () {
    const btn = document.getElementById('struct-toggle-btn');
    if (!btn) return;
    btn.disabled = true;
    btn.classList.remove('active');
};
// Multi-snippet hook — legacy no-op so viz_code_panel doesn't throw.
window.symShowCurrentSnippets = function () { /* no-op */ };

// Reverse-sync: code panel line-click → graph focus match. V3 behavior:
// - If the clicked line falls inside a symbol in the current file, set focus
//   to that symbol (stays on the same file graph). Does not recurse into
//   file switching unless the caller explicitly calls symViewActivate.
window.svHighlightLine = function (lineIdx) {
    const lineNo = lineIdx + 1;
    if (!_svState.fileRel || !window.DATA || !DATA.symbol_index) return;

    const candidates = Object.values(DATA.symbol_index)
        .filter(s => s.file === _svState.fileRel);
    let best = null;
    for (const s of candidates) {
        const start = s.line || 0;
        const end   = s.end_line || start;
        if (start && lineNo >= start && lineNo <= end) {
            if (!best || (s.line || 0) > (best.line || 0)) best = s;  // innermost
        }
    }
    if (!best) return;
    if (best.id === _svState.focusId) return;
    _svState.focusId = best.id;
    _svState.detailSectionCollapsed.clear();
    _svState.edgeJumpCursor.clear();
    _svState.selectedEdgeId = null;
    if (typeof _svRebuildForFocus === 'function') _svRebuildForFocus();
    else if (typeof _svApplyFocus === 'function') _svApplyFocus({ noHistory: true });
    _svSyncNavBtns();
};

// Identifier word-click from code panel → activate matching symbol.
window.svHighlightBadgeByName = function (word) {
    if (!word || !window.DATA || !DATA.symbol_index) return;
    const file = _svState.fileRel;
    if (!file) return;
    const all = Object.values(DATA.symbol_index);
    const inFile = all.filter(s => s.file === file && s.name === word);
    const match = inFile.length ? inFile[0] : all.find(s => s.name === word);
    if (!match) return;
    symViewActivate(match.id);
};

// viz_code_panel and viz_sidebar read `window._sv.active`.
window._sv = _svState;
