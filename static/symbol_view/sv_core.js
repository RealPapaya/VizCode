// ── Symbol View — self-contained module (core) ──────────────────────────
// Owns: _svState, mount/unmount of #sym-view, public entry points, history,
//       legend save/restore. Graph rendering lives in sv_graph.js; search
//       bar in sv_search.js. Loaded before those two so they can read state.

'use strict';

// ── Module state ──────────────────────────────────────────────────────────
const _svState = {
    active:       null,         // current center symId or '__overview__'
    history:      [],           // back stack
    future:       [],           // forward stack
    jobId:        null,
    ready:        false,        // DOM mounted?
    overviewFile: null,         // file shown in overview mode
    svg:          null,         // root <svg id="sv-svg">
    viewport:     null,         // zoom target <g class="sv-viewport">
    zoom:         { k: 1, x: 0, y: 0 },
    currentGraph: null,         // last rendered model (for keyed diff)
    searchOpen:   false,
    searchCache:  new Map(),
    hiddenEdgeTypes: new Set(), // edge types toggled off via legend
    _legendSnap:  null,
};

// Semantic palette. Gray=type, yellow=method, blue=field.
const _SV_KIND_COLOR = {
    class:      '#9ca3af',
    struct:     '#9ca3af',
    interface:  '#9ca3af',
    enum:       '#9ca3af',
    type:       '#9ca3af',
    method:     '#fbbf24',
    function:   '#fbbf24',
    field:      '#60a5fa',
    variable:   '#60a5fa',
    constant:   '#60a5fa',
    property:   '#60a5fa',
    default:    '#94a3b8',
};

const _SV_EDGE_COLOR = {
    call:        '#fbbf24',
    inheritance: '#9ca3af',
    implements:  '#9ca3af',
    override:    '#f472b6',
    import:      '#34d399',
    include:     '#34d399',
    type_usage:  '#60a5fa',
    member:      '#a78bfa',
    default:     '#64748b',
};

const _SV_CARD_KINDS = new Set(['class', 'struct', 'interface', 'enum']);

function _svKindColor(kind) {
    return _SV_KIND_COLOR[kind] || _SV_KIND_COLOR.default;
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
        <div id="sv-nav-group">
          <button id="sv-back-btn" title="Back" disabled>&larr;</button>
          <button id="sv-fwd-btn"  title="Forward" disabled>&rarr;</button>
          <button id="sv-overview-btn" title="Overview" style="display:none">&#9783;</button>
          <div id="sv-breadcrumb"></div>
        </div>
        <div id="sv-search-wrap">
          <span id="sv-search-icon">&#128269;</span>
          <input id="sv-search-input" type="text" placeholder="Search symbols…" autocomplete="off" spellcheck="false" />
          <button id="sv-search-clear" style="display:none">&times;</button>
          <div id="sv-search-results" hidden></div>
        </div>
        <button id="sv-close-btn" title="Close Structure View">&times;</button>
      </div>
      <div id="sv-body">
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
          </g>
        </svg>
        <div id="sv-overview" hidden></div>
        <div id="sv-empty" hidden>
          <div class="sv-empty-icon">&#10697;</div>
          <div class="sv-empty-msg">No symbol selected</div>
        </div>
        <div id="sv-edge-tip" hidden></div>
      </div>
    `;

    _svState.svg      = root.querySelector('#sv-svg');
    _svState.viewport = root.querySelector('.sv-viewport');

    // Nav buttons
    root.querySelector('#sv-back-btn').onclick     = _svGoBack;
    root.querySelector('#sv-fwd-btn').onclick      = _svGoForward;
    root.querySelector('#sv-overview-btn').onclick = () => {
        if (_svState.overviewFile) symViewOpen(_svState.overviewFile);
    };
    root.querySelector('#sv-close-btn').onclick = symViewClose;

    // Zoom + pan on SVG
    _svInitPanZoom();

    // Search (handled in sv_search.js)
    if (typeof _svInitSearch === 'function') _svInitSearch();

    _svState.ready = true;
}

function _svInitPanZoom() {
    const svg = _svState.svg;
    if (!svg) return;
    let isPanning = false;
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
        // Zoom toward cursor
        z.x = cx - (cx - z.x) * (nk / z.k);
        z.y = cy - (cy - z.y) * (nk / z.k);
        z.k = nk;
        _svApplyZoom();
    }, { passive: false });

    svg.addEventListener('mousedown', (e) => {
        if (e.target !== svg && !e.target.classList.contains('sv-viewport')) return;
        // Only pan on empty canvas clicks
        isPanning = true;
        panStart  = { x: e.clientX - _svState.zoom.x, y: e.clientY - _svState.zoom.y };
        svg.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', (e) => {
        if (!isPanning) return;
        _svState.zoom.x = e.clientX - panStart.x;
        _svState.zoom.y = e.clientY - panStart.y;
        _svApplyZoom();
    });
    window.addEventListener('mouseup', () => {
        if (!isPanning) return;
        isPanning = false;
        svg.style.cursor = '';
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
    _svAnimateValue(_svState.zoom, targetZoom, 280, _svApplyZoom);
}

// Generic object-property tween (used for zoom + node positions).
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

// easeInOutCubic
function _svEase(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// ── Public entry points ────────────────────────────────────────────────────

function symViewOpen(fileRel) {
    _svEnsureDom();
    _svState.jobId = window.JOB_ID || null;

    const root = document.getElementById('sym-view');
    if (!root) return;

    // Hide other overlays
    const cy = document.getElementById('cy');
    if (cy) cy.style.display = 'none';
    root.classList.add('active');

    _svSaveLegend();
    _svHideLegend();

    const prev = _svState.active;
    if (prev !== null && prev !== '__overview__') {
        _svState.history.push(prev);
        if (_svState.history.length > 100) _svState.history.shift();
    }
    _svState.future = [];
    _svState.active       = '__overview__';
    _svState.overviewFile = fileRel;
    _svRenderOverview(fileRel);
    _svSyncNavBtns();
    _svUpdateStructBtn(true);
}

function symViewActivate(symId) {
    if (!symId) return;
    _svEnsureDom();
    _svState.jobId = window.JOB_ID || null;

    const root = document.getElementById('sym-view');
    if (!root) return;
    const cy = document.getElementById('cy');
    if (cy) cy.style.display = 'none';
    root.classList.add('active');
    _svSaveLegend();
    _svHideLegend();

    const prev = _svState.active;
    if (prev !== null && prev !== symId) {
        _svState.history.push(prev);
        if (_svState.history.length > 100) _svState.history.shift();
        _svState.future = [];
    }
    _svState.active = symId;
    _svFetchAndRender(symId);
    _svSyncNavBtns();
    _svUpdateStructBtn(true);
}

function symViewClose() {
    const root = document.getElementById('sym-view');
    if (root) root.classList.remove('active');
    const cy = document.getElementById('cy');
    if (cy) cy.style.display = '';

    _svState.active       = null;
    _svState.overviewFile = null;
    _svState.currentGraph = null;
    _svRestoreLegend();
    _svSyncNavBtns();
    _svUpdateStructBtn(false);

    // Close search dropdown if open
    const results = document.getElementById('sv-search-results');
    if (results) results.hidden = true;
    _svState.searchOpen = false;
}

function _svGoBack() {
    if (!_svState.history.length) return;
    const prev = _svState.history.pop();
    const cur  = _svState.active;
    if (cur !== null) _svState.future.push(cur);
    _svState.active = prev;
    if (prev === '__overview__') {
        _svRenderOverview(_svState.overviewFile);
    } else {
        _svFetchAndRender(prev);
    }
    _svSyncNavBtns();
}

function _svGoForward() {
    if (!_svState.future.length) return;
    const nxt = _svState.future.pop();
    const cur = _svState.active;
    if (cur !== null) _svState.history.push(cur);
    _svState.active = nxt;
    if (nxt === '__overview__') {
        _svRenderOverview(_svState.overviewFile);
    } else {
        _svFetchAndRender(nxt);
    }
    _svSyncNavBtns();
}

function _svSyncNavBtns() {
    const back = document.getElementById('sv-back-btn');
    const fwd  = document.getElementById('sv-fwd-btn');
    const ov   = document.getElementById('sv-overview-btn');
    if (back) back.disabled = !_svState.history.length;
    if (fwd)  fwd.disabled  = !_svState.future.length;
    if (ov)   ov.style.display = (_svState.overviewFile && _svState.active !== '__overview__') ? '' : 'none';
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

// ── Overview (file-level symbol list) ─────────────────────────────────────
function _svRenderOverview(fileRel) {
    const ov  = document.getElementById('sv-overview');
    const svg = _svState.svg;
    const empty = document.getElementById('sv-empty');
    if (!ov || !svg) return;

    svg.style.display = 'none';
    if (empty) empty.hidden = true;
    ov.hidden = false;

    const brd = document.getElementById('sv-breadcrumb');
    if (brd) brd.textContent = 'Overview · ' + (fileRel || '');

    if (!window.DATA || !DATA.symbol_index) {
        ov.innerHTML = '<div class="sv-overview-empty">No symbols for this file.</div>';
        return;
    }

    const syms = Object.values(DATA.symbol_index).filter(s => s.file === fileRel);
    if (!syms.length) {
        ov.innerHTML = '<div class="sv-overview-empty">No symbols for this file.</div>';
        return;
    }

    const byKind = {};
    for (const s of syms) {
        const k = s.kind || 'other';
        (byKind[k] = byKind[k] || []).push(s);
    }

    const order = ['class', 'struct', 'interface', 'enum', 'function', 'method', 'field', 'variable', 'constant', 'property'];
    const kinds = Object.keys(byKind).sort((a, b) => {
        const ai = order.indexOf(a); const bi = order.indexOf(b);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    let html = '';
    for (const k of kinds) {
        const items = byKind[k].sort((a, b) => (a.line || 0) - (b.line || 0));
        html += `<div class="sv-ov-section">
          <div class="sv-ov-section-title">
            <span class="sv-kind-dot" style="background:${_svKindColor(k)}"></span>
            ${_svEsc(k)} <span class="sv-ov-count">${items.length}</span>
          </div>
          <div class="sv-ov-grid">
            ${items.map(s => `
              <div class="sv-ov-card" data-symid="${_svEsc(s.id)}" title="${_svEsc(s.name)} · line ${s.line || '?'}">
                <span class="sv-kind-dot" style="background:${_svKindColor(s.kind)}"></span>
                <span class="sv-ov-name">${_svEsc(s.name)}</span>
                <span class="sv-ov-line">L${s.line || 0}</span>
              </div>`).join('')}
          </div>
        </div>`;
    }
    ov.innerHTML = html;

    ov.querySelectorAll('.sv-ov-card').forEach(el => {
        el.addEventListener('click', () => {
            const sid = el.dataset.symid;
            if (sid) symViewActivate(sid);
        });
    });
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
window.symViewOpen     = symViewOpen;
window.symViewActivate = symViewActivate;
window.symViewClose    = symViewClose;
window.svHideSvView    = symViewClose;
window.svToggleStructView = function () {
    const fileRel = window.codeState && window.codeState.currentFile;
    if (fileRel) symViewOpen(fileRel);
};
// Called by viz_code_panel when a file loads — enable Structure btn if file has symbols.
window.svUpdateStructureBtn = function (fileRel, _ext) {
    const btn = document.getElementById('struct-toggle-btn');
    if (!btn) return;
    const hasSymbols = !!(window.DATA && window.DATA.symbol_index &&
        Object.values(window.DATA.symbol_index).some(s => s.file === fileRel));
    btn.disabled = !hasSymbols;
    btn.classList.toggle('active', hasSymbols && !!_svState.active);
    btn.title = hasSymbols ? 'Structure View' : 'Structure View (no symbols for this file)';
};
window.svHideStructureBtn = function () {
    const btn = document.getElementById('struct-toggle-btn');
    if (!btn) return;
    btn.disabled = true;
    btn.classList.remove('active');
};
// Multi-snippet hook — v2 feature; keep as no-op so viz_code_panel doesn't throw.
window.symShowCurrentSnippets = function () { /* no-op in v1 */ };
// Reverse-sync stub: code panel line-click → graph highlight. Deferred.
window.svHighlightLine = function (_lineIdx) { /* no-op in v1 */ };
// Identifier word-click from code panel → activate matching symbol.
window.svHighlightBadgeByName = function (word) {
    if (!word || !window.DATA || !DATA.symbol_index) return;
    const file = _svState.overviewFile
        || (_svState.active && _svState.active !== '__overview__'
              ? (DATA.symbol_index[_svState.active] || {}).file
              : null);
    if (!file) return;
    const all = Object.values(DATA.symbol_index);
    const inFile = all.filter(s => s.file === file && s.name === word);
    const match = inFile.length ? inFile[0] : all.find(s => s.name === word);
    if (!match) return;
    symViewActivate(match.id);
};
// viz_code_panel and viz_sidebar read `window._sv.active`.
window._sv = _svState;
