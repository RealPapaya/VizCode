'use strict';

// ── Galaxy View — State, UI, Sigma, Reducers ─────────────────────────────────
// Depends on: viz_galaxy_physics.js (physics), viz_galaxy_graph.js (graph builder)
// All three files are concatenated into one <script> — global scope shared.

// ── Module-level state ───────────────────────────────────────────────────────

let _gSig = null;
let _gGraph = null;
let _gPinned = null;
let _gNeighborSet = null;
let _gTooltipEl = null;
let _gFilterPanelSaved = null;
let _gHighlightSet = new Set();
let _gBlastSet = new Set();
let _gAnimatedNodes = new Map();
let _gCommunityColors = true;
let _gHoveredNode = null;
let _gHoverNeighborSet = null;
let _gIsolateMode = false;
let _gIsolateBtn = null;
let _gLayoutRunning = false;
let _gLayoutToken = 0;
let _gLayoutPromise = null;
let _gLayoutBadgeEl = null;
let _gPrecomputeHandle = 0;
let _gPrecomputeQueued = false;
let _gPrecomputePending = false;
let _gBackgroundPrecomputeMode = false;
let _gLayoutNeedsNoverlap = false;
let _gBackgroundHooksInstalled = false;
let _gLastUserActionAt = 0;

// Performance: cache graph+layout between open/close cycles
let _gLayoutDone = false;
let _gDataFingerprint = null;
let _gAllowedMods = null;      // null = all modules; Set<string> = folder-filtered modules
let _gSavedAllowedMods = null; // persists the user's folder selection across open/close cycles
let _gDegreeCache = null;       // Map<nodeKey, degree> — built once after graph construction
let _gNodeLabelCache = null;    // Map<nodeKey, lowerLabel> — for edge reducer search path
let _gSearchLower = '';         // Cached lowercase search query — avoids per-node toLowerCase

// Community palette dim/bright look-up arrays (12 entries, built once in _gBuildDegreeCache)
let _G_COMMUNITY_DIM = null;
let _G_COMMUNITY_FOG = null;
let _G_COMMUNITY_HLDIM = null;
let _G_COMMUNITY_SEARCHDIM = null;
let _G_COMMUNITY_BRIGHT = null;

// ── Animation lookup tables (avoid Math.sin per node per frame) ──────────────
// Pulse/ripple animations call sin(progress * π * 4) for every animated node on
// every Sigma frame. With multiple animated nodes at 60fps that is thousands of
// trig calls per second. A 256-entry LUT collapses each call to two adds + an
// array index without any visual difference.
const _G_PULSE_LUT_SIZE = 256;
const _G_PULSE_LUT = (() => {
    const lut = new Float32Array(_G_PULSE_LUT_SIZE);
    for (let i = 0; i < _G_PULSE_LUT_SIZE; i++) {
        // Same formula as inline (Math.sin(progress * π * 4) + 1) / 2,
        // pre-evaluated across [0,1).
        const progress = i / _G_PULSE_LUT_SIZE;
        lut[i] = (Math.sin(progress * Math.PI * 4) + 1) / 2;
    }
    return lut;
})();

function _gPulsePhase(progress) {
    // progress is clamped to [0,1] before this is called.
    const idx = (progress * _G_PULSE_LUT_SIZE) | 0;
    return _G_PULSE_LUT[idx >= _G_PULSE_LUT_SIZE ? _G_PULSE_LUT_SIZE - 1 : idx];
}

// ── Constants ────────────────────────────────────────────────────────────────

const _G_COMMUNITY_PALETTE = [
    '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6',
    '#8b5cf6', '#d946ef', '#ec4899', '#f43f5e', '#14b8a6', '#84cc16',
];

const _G_ROOT_KEY = 'g-folder:__root__';
const _G_CLASS_KINDS = new Set(['class', 'struct', 'interface', 'enum', 'typedef']);
const _G_FUNCTION_KINDS = new Set(['function']);
const _G_METHOD_KINDS = new Set(['method']);
const _G_CODE_NODE_TYPES = new Set(['class', 'struct', 'interface', 'enum', 'typedef', 'function', 'method']);
const _G_NODE_THRESHOLD = 5000;

const _galaxyFilter = {
    nodeTypes: new Set(['folder', 'file', 'class', 'struct', 'interface', 'enum', 'typedef', 'function', 'method']),
    edgeTypes: new Set(['contain', 'import', 'call', 'define', 'extend', 'implements', 'override']),
    searchQuery: '',
    minDegree: 0,
    depthHops: 0,
};

const _G_COLORS = {
    folder: '#6366f1',
    file: '#3b82f6',
    class: '#f59e0b',
    struct: '#f59e0b',
    interface: '#ec4899',
    enum: '#f97316',
    typedef: '#a78bfa',
    function: '#10b981',
    method: '#34d399',
    contain: 'rgba(99, 102, 241, 0.4)',
    define: '#f59e0b',
    import: '#38bdf8',
    call: '#f87171',
    extend: '#a78bfa',
    implements: '#ec4899',
    override: '#fb923c',
};

// Graph builder + physics functions live in viz_galaxy_graph.js / viz_galaxy_physics.js

function _gNodeDefs() {
    return [
        { key: 'folder', label: 'Folder', color: _G_COLORS.folder, icon: 'D' },
        { key: 'file', label: 'File', color: _G_COLORS.file, icon: 'F' },
        { key: 'class', label: 'Class', color: _G_COLORS.class, icon: 'C' },
        { key: 'struct', label: 'Struct', color: _G_COLORS.struct, icon: 'S' },
        { key: 'interface', label: 'Interface', color: _G_COLORS.interface, icon: 'I' },
        { key: 'enum', label: 'Enum', color: _G_COLORS.enum, icon: 'E' },
        { key: 'typedef', label: 'Typedef', color: _G_COLORS.typedef, icon: 'T' },
        { key: 'function', label: 'Function', color: _G_COLORS.function, icon: 'Fn' },
        { key: 'method', label: 'Method', color: _G_COLORS.method, icon: 'M' },
    ];
}

const _G_EDGE_DEFS = [
    { key: 'contain', label: 'Contain', color: _G_COLORS.contain },
    { key: 'import', label: 'Import', color: _G_COLORS.import },
    { key: 'call', label: 'Call', color: _G_COLORS.call },
    { key: 'define', label: 'Define', color: _G_COLORS.define },
    { key: 'extend', label: 'Extend', color: _G_COLORS.extend },
    { key: 'implements', label: 'Implements', color: _G_COLORS.implements },
    { key: 'override', label: 'Override', color: _G_COLORS.override },
];

// ── Utilities ────────────────────────────────────────────────────────────────

function _gDebounce(fn, ms) {
    let timer = null;
    return (...args) => {
        clearTimeout(timer);
        timer = setTimeout(() => fn(...args), ms);
    };
}

// Show/hide isolate toggle button when a node is pinned.
// The eye icon lets users hide all non‑related nodes & edges.
function _galaxyShowIsolateBtn() {
    if (_gIsolateBtn?.isConnected) return;
    const container = document.getElementById('graph-zoom-controls');
    if (!container) return;
    const btn = document.createElement('button');
        btn.id = 'galaxy-isolate-btn';
    btn.className = 'graph-zoom-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Focus Only');
    btn.title = 'Focus Only';
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><circle cx="12" cy="12" r="3"></circle><path d="M12 5v.01M12 18.99v.01M5 12h.01M18.99 12h.01"></path></svg>`;
        btn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent event bubbling to zoom controls container
        _gIsolateMode = !_gIsolateMode;
        btn.classList.toggle('isolate-active', _gIsolateMode);
        btn.title = _gIsolateMode ? 'Show All' : 'Focus Only';
        if (_gSig) _gSig.refresh();
    });
    container.prepend(btn);
    _gIsolateBtn = btn;
}

function _galaxyHideIsolateBtn() {
    _gIsolateMode = false;
    if (_gIsolateBtn?.parentNode) _gIsolateBtn.parentNode.removeChild(_gIsolateBtn);
    _gIsolateBtn = null;
}

let _galaxyTipInterval = null;
let _galaxyIsCurrentlyComputing = false;

function _galaxySetButtonComputing(isComputing) {
    const btn = document.getElementById('galaxy-btn');
    if (!btn) return;

    const nextState = !!isComputing;
    if (nextState === _galaxyIsCurrentlyComputing) return;
    _galaxyIsCurrentlyComputing = nextState;

    btn.classList.toggle('computing', nextState);
    btn.setAttribute('aria-busy', nextState ? 'true' : 'false');

    if (_galaxyTipInterval) {
        clearInterval(_galaxyTipInterval);
        _galaxyTipInterval = null;
    }

    if (nextState) {
        let dots = 1;
        const updateTip = () => {
            const dotStr = '.'.repeat(dots);
            const tipStr = typeof T === 'function' ? T('galaxyCalculatingTip', { dots: dotStr }) : `Calculating${dotStr}`;
            btn.setAttribute('data-tip', tipStr);
            dots = (dots + 1) % 4;

            // Live update the global tooltip if it is currently hovering over this button
            if (btn.matches(':hover')) {
                const gTip = document.getElementById('g-tooltip');
                if (gTip && gTip.classList.contains('g-tip-visible')) {
                    gTip.innerHTML = `<strong class="gt-head">${typeof escapeHtml === 'function' ? escapeHtml(tipStr) : tipStr}</strong>`;
                }
            }
        };
        updateTip();
        _galaxyTipInterval = setInterval(updateTip, 400);
    } else {
        btn.setAttribute('data-tip', typeof T === 'function' ? T('galaxyTip') : 'Galaxy View');
    }
}

function _galaxyShouldShowButtonEffect() {
    return !!(
        _gPrecomputePending ||
        _gPrecomputeQueued ||
        _gBackgroundPrecomputeMode ||
        _gLayoutRunning ||
        (state?.galaxyActive && _gLayoutNeedsNoverlap)
    );
}

function _galaxySyncButtonComputing() {
    _galaxySetButtonComputing(_galaxyShouldShowButtonEffect());
}

function _galaxyMarkUserActive() {
    _gLastUserActionAt = performance.now();
}

function _galaxyInstallBackgroundInputHooks() {
    if (_gBackgroundHooksInstalled) return;
    _gBackgroundHooksInstalled = true;
    _galaxyMarkUserActive();
    const mark = () => _galaxyMarkUserActive();
    ['pointerdown', 'pointermove', 'wheel', 'keydown', 'touchstart', 'scroll'].forEach(type => {
        window.addEventListener(type, mark, { passive: true, capture: true });
    });
    document.addEventListener('visibilitychange', mark, true);
}

function _galaxyIsBackgroundPriority() {
    return !!_gBackgroundPrecomputeMode && !state?.galaxyActive;
}

async function _galaxyWaitForBackgroundIdle(token, quietMs = 700) {
    _galaxyInstallBackgroundInputHooks();
    while (_gLayoutToken === token) {
        if (document.hidden) break;
        const idleFor = performance.now() - _gLastUserActionAt;
        if (idleFor >= quietMs) break;
        const waitMs = Math.max(40, Math.min(quietMs - idleFor, 160));
        await new Promise(resolve => window.setTimeout(resolve, waitMs));
    }
    if (_gLayoutToken !== token) return false;
    if (typeof window.requestIdleCallback === 'function') {
        await new Promise(resolve => window.requestIdleCallback(() => resolve(), { timeout: 180 }));
    } else {
        await new Promise(resolve => window.setTimeout(resolve, 32));
    }
    return _gLayoutToken === token;
}

function _gEsc(value) {
    const raw = value == null ? '' : String(value);
    if (typeof escapeHtml === 'function') return escapeHtml(raw);
    return raw
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function _gNodeDisplayType(attrs) {
    const typeMap = {
        folder: 'Folder', file: 'File', class: 'Class', struct: 'Struct',
        interface: 'Interface', enum: 'Enum', typedef: 'Typedef',
        function: 'Function', method: 'Method',
    };
    return typeMap[attrs._t] || attrs._t || 'Node';
}

function _gNodesWithinHops(startNode, maxHops) {
    const visited = new Set();
    if (!_gGraph || !_gGraph.hasNode(startNode)) return visited;
    const queue = [{ node: startNode, depth: 0 }];
    while (queue.length > 0) {
        const { node, depth } = queue.shift();
        if (visited.has(node)) continue;
        visited.add(node);
        if (depth < maxHops) {
            _gGraph.forEachNeighbor(node, neighbor => {
                if (!visited.has(neighbor)) queue.push({ node: neighbor, depth: depth + 1 });
            });
        }
    }
    return visited;
}

let _gHopSet = null;

function _gUpdateHopSet() {
    if (_galaxyFilter.depthHops > 0 && _gPinned) {
        _gHopSet = _gNodesWithinHops(_gPinned, _galaxyFilter.depthHops);
    } else {
        _gHopSet = null;
        // If no pinned node, reset depth to 0
        if (!_gPinned && _galaxyFilter.depthHops > 0) {
            _galaxyFilter.depthHops = 0;
        }
    }
}

function _gUpdateDepthFilterState() {
    const depthSlider = document.getElementById('gf-depth-slider');
    const depthWrap = depthSlider?.parentElement;
    const depthLabel = depthWrap?.querySelector('.gf-slider-label');
    
    if (!depthSlider || !depthLabel) return;
    
    const hasPinned = !!_gPinned;
    depthSlider.disabled = !hasPinned;
    
    if (depthWrap) {
        if (hasPinned) {
            depthWrap.classList.remove('disabled');
        } else {
            depthWrap.classList.add('disabled');
        }
    }
    
    // Update label text
    if (!hasPinned) {
        depthLabel.innerHTML = '<em style="color:#475569">Pin a node to enable</em>';
    } else {
        const depthH = _galaxyFilter.depthHops;
        depthLabel.innerHTML = depthH === 0
            ? 'Off — show all nodes'
            : `<strong class="gf-deg-val">${depthH}</strong> hop${depthH !== 1 ? 's' : ''} from pinned`;
    }
}

function _gCodeLocation(attrs) {
    if (!attrs._file || !attrs._line) return '-';
    return attrs._endLine && attrs._endLine > attrs._line
        ? `${attrs._file}:${attrs._line}-${attrs._endLine}`
        : `${attrs._file}:${attrs._line}`;
}

// ── Data fingerprint for cache invalidation ───────────────────────────────────

function _gComputeDataFingerprint() {
    const D = window.DATA || {};
    const s = D.stats || {};
    return `${s.files || 0}:${s.functions || 0}:${(D.symbol_edges || []).length}:${(D.modules || []).length}`;
}

// ── Layout persistence (across page reloads) ─────────────────────────────────
// FA2 takes seconds-to-minutes for big graphs. Saving final node positions to
// localStorage means a browser refresh → reopen Galaxy is instant: positions
// load from cache, FA2 is skipped entirely. Keyed by data fingerprint + folder
// selection so any data change invalidates the cached layout naturally.

const _G_LAYOUT_STORAGE_PREFIX = 'vizcode:galaxy:layout:';
const _G_LAYOUT_STORAGE_VERSION = 1;
const _G_LAYOUT_STORAGE_LIMIT_BYTES = 6 * 1024 * 1024; // ~6MB safety cap

function _galaxyLayoutStorageKey(fp, allowedMods) {
    const job = window.JOB_ID || '_';
    const folders = allowedMods ? Array.from(allowedMods).sort().join(',') : '*';
    return `${_G_LAYOUT_STORAGE_PREFIX}${job}|${fp}|${folders}`;
}

function _galaxyLayoutStorageSave() {
    if (!_gGraph || _gGraph.order === 0 || !_gLayoutDone) return;
    try {
        const fp = _gComputeDataFingerprint();
        const key = _galaxyLayoutStorageKey(fp, _gSavedAllowedMods);
        const order = _gGraph.order;
        // Pack as parallel typed-array-friendly arrays. Float32 is plenty for layout.
        const keys = new Array(order);
        const xs = new Float32Array(order);
        const ys = new Float32Array(order);
        let i = 0;
        _gGraph.forEachNode((k, attrs) => {
            keys[i] = k;
            xs[i] = attrs.x || 0;
            ys[i] = attrs.y || 0;
            i++;
        });
        const payload = JSON.stringify({
            v: _G_LAYOUT_STORAGE_VERSION,
            ts: Date.now(),
            keys,
            xs: Array.from(xs),
            ys: Array.from(ys),
        });
        if (payload.length > _G_LAYOUT_STORAGE_LIMIT_BYTES) return;
        // Best-effort write — silently skip on QuotaExceededError
        try { localStorage.setItem(key, payload); } catch (_) {}
    } catch (err) {
        console.warn('[galaxy] layout save failed', err);
    }
}

function _galaxyLayoutStorageLoad() {
    if (!_gGraph || _gGraph.order === 0) return false;
    try {
        const fp = _gComputeDataFingerprint();
        const key = _galaxyLayoutStorageKey(fp, _gSavedAllowedMods);
        const raw = localStorage.getItem(key);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.v !== _G_LAYOUT_STORAGE_VERSION) return false;
        if (!Array.isArray(parsed.keys) || !Array.isArray(parsed.xs) || parsed.keys.length !== parsed.xs.length) return false;

        // Apply only positions for keys that still exist in the current graph.
        // Coverage threshold: require ≥95% match to consider it a hit.
        let applied = 0;
        const total = parsed.keys.length;
        for (let i = 0; i < total; i++) {
            const k = parsed.keys[i];
            if (_gGraph.hasNode(k)) {
                _gGraph.setNodeAttribute(k, 'x', parsed.xs[i]);
                _gGraph.setNodeAttribute(k, 'y', parsed.ys[i]);
                applied++;
            }
        }
        const coverage = applied / Math.max(_gGraph.order, 1);
        if (coverage < 0.95) {
            console.log(`[galaxy] cached layout coverage ${(coverage * 100).toFixed(1)}% < 95% — discarding`);
            return false;
        }
        console.log(`[galaxy] restored layout from localStorage (${applied}/${_gGraph.order} nodes, age ${((Date.now() - parsed.ts) / 1000).toFixed(0)}s)`);
        return true;
    } catch (err) {
        console.warn('[galaxy] layout load failed', err);
        return false;
    }
}

// ── Filter panel ─────────────────────────────────────────────────────────────

function _galaxyBuildFilterPanel() {
    const wrap = document.getElementById('sb-body-filters');
    if (!wrap) return;
    _gFilterPanelSaved = wrap.innerHTML;

    const hdr = (label, actions = '') =>
        `<div class="flt-section-hdr" style="${actions ? '' : 'pointer-events:none'}">` +
        `<span class="flt-section-label">${label}</span>` +
        (actions ? `<span class="flt-actions">${actions}</span>` : '') +
        `</div>`;
    const row = (key, label, color, icon, dataAttr, activeSet) =>
        `<div class="nl-row gf-row${activeSet.has(key) ? ' active' : ''}" ${dataAttr}="${key}" style="--nl-col:${color};cursor:pointer">` +
        `<div class="nl-icon-bg"><span class="nl-shape" style="color:${color}">${icon}</span></div>` +
        `<span class="nl-label" style="color:${color}">${label}</span>` +
        `</div>`;

    const searchHtml =
        `<div class="gf-search-wrap"><input type="text" class="gf-search-input" id="gf-search-input" ` +
        `placeholder="Search nodes..." value="${_gEsc(_galaxyFilter.searchQuery || '')}"></div>`;
    const nodeRows = _gNodeDefs()
        .map(def => row(def.key, def.label, def.color, def.icon, 'data-gf-node', _galaxyFilter.nodeTypes))
        .join('');
    const edgeRows = _G_EDGE_DEFS.map(def =>
        `<div class="ef-row gf-row${_galaxyFilter.edgeTypes.has(def.key) ? ' active' : ''}" data-gf-edge="${def.key}" style="--ef-col:${def.color}">` +
        `<div class="ef-icon-bg"><span class="ef-indicator"><svg width="28" height="10" viewBox="0 0 28 10">` +
        `<line x1="2" y1="5" x2="26" y2="5" stroke="${def.color}" stroke-width="2" stroke-linecap="round"></line>` +
        `</svg></span></div><span class="ef-label">${def.label}</span></div>`
    ).join('');

    const ntActions =
        `<button class="flt-action" data-gf-node-action="all">${typeof T === 'function' ? T('selectAll') : 'All'}</button>` +
        `<button class="flt-action" data-gf-node-action="none">${typeof T === 'function' ? T('selectNone') : 'None'}</button>`;
    const etActions =
        `<button class="flt-action" data-gf-edge-action="all">${typeof T === 'function' ? T('selectAll') : 'All'}</button>` +
        `<button class="flt-action" data-gf-edge-action="none">${typeof T === 'function' ? T('selectNone') : 'None'}</button>`;

        const minDeg = _galaxyFilter.minDegree;
    const depthH = _galaxyFilter.depthHops;
    const depthDisabled = !_gPinned;  // Disable depth filter when no pinned node

    wrap.innerHTML =
        `<div style="padding:4px 0 6px">${searchHtml}</div>` +
        `${hdr('Node Types', ntActions)}<div style="padding:4px 0 8px">${nodeRows}</div>` +
        `${hdr('Edge Types', etActions)}<div style="padding:4px 0 8px">${edgeRows}</div>` +
        `${hdr('Min Connections')}<div style="padding:4px 0 8px"><div class="gf-slider-wrap">` +
        `<input type="range" class="gf-slider" id="gf-mindeg-slider" min="0" max="20" step="1" value="${minDeg}">` +
        `<div class="gf-slider-label">Show nodes with <strong class="gf-deg-val" id="gf-deg-val">${minDeg}</strong> connection${minDeg !== 1 ? 's' : ''}</div>` +
        `</div></div>` +
        `${hdr('Depth Filter')}<div style="padding:4px 0 8px"><div class="gf-slider-wrap${depthDisabled ? ' disabled' : ''}">` +
        `<input type="range" class="gf-slider" id="gf-depth-slider" min="0" max="5" step="1" value="${depthH}"${depthDisabled ? ' disabled' : ''}>` +
        `<div class="gf-slider-label">${depthDisabled ? '<em style="color:#475569">Pin a node to enable</em>' : (depthH === 0 ? 'Off — show all nodes' : `<strong class="gf-deg-val" id="gf-depth-val">${depthH}</strong> hop${depthH !== 1 ? 's' : ''} from pinned`)}</div>` +
        `</div></div>` +
        `${hdr('Display')}<div style="padding:4px 0 8px">` +
        `<div class="nl-row gf-row${_gCommunityColors ? ' active' : ''}" id="gf-community-toggle" style="--nl-col:#8b5cf6;cursor:pointer">` +
        `<div class="nl-icon-bg"><span class="nl-shape" style="color:#8b5cf6">&#9673;</span></div>` +
        `<span class="nl-label" style="color:#8b5cf6">Community Colors</span>` +
        `</div></div>`;

    const searchInput = wrap.querySelector('#gf-search-input');
    if (searchInput) {
        const applySearch = _gDebounce(value => {
            _galaxyFilter.searchQuery = value;
            _gSearchLower = (value || '').toLowerCase().trim();  // cache for reducer hot path
            if (_gSig) _gSig.refresh();
        }, 120);
        searchInput.addEventListener('input', event => applySearch(event.target.value));
    }

    wrap.querySelectorAll('[data-gf-node]').forEach(el => {
        el.addEventListener('click', () => {
            const key = el.dataset.gfNode;
            if (_galaxyFilter.nodeTypes.has(key)) _galaxyFilter.nodeTypes.delete(key);
            else _galaxyFilter.nodeTypes.add(key);
            el.classList.toggle('active', _galaxyFilter.nodeTypes.has(key));
            if (_gSig) _gSig.refresh();
        });
    });

    wrap.querySelectorAll('[data-gf-edge]').forEach(el => {
        el.addEventListener('click', () => {
            const key = el.dataset.gfEdge;
            if (_galaxyFilter.edgeTypes.has(key)) _galaxyFilter.edgeTypes.delete(key);
            else _galaxyFilter.edgeTypes.add(key);
            el.classList.toggle('active', _galaxyFilter.edgeTypes.has(key));
            if (_gSig) _gSig.refresh();
        });
    });

    wrap.querySelectorAll('[data-gf-node-action]').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const action = btn.dataset.gfNodeAction;
            if (action === 'all') {
                _galaxyFilter.nodeTypes.clear();
                _gNodeDefs().forEach(d => _galaxyFilter.nodeTypes.add(d.key));
                wrap.querySelectorAll('[data-gf-node]').forEach(row => row.classList.add('active'));
            } else if (action === 'none') {
                _galaxyFilter.nodeTypes.clear();
                wrap.querySelectorAll('[data-gf-node]').forEach(row => row.classList.remove('active'));
            }
            if (_gSig) _gSig.refresh();
        });
    });

    wrap.querySelectorAll('[data-gf-edge-action]').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const action = btn.dataset.gfEdgeAction;
            if (action === 'all') {
                _galaxyFilter.edgeTypes.clear();
                _G_EDGE_DEFS.forEach(d => _galaxyFilter.edgeTypes.add(d.key));
                wrap.querySelectorAll('[data-gf-edge]').forEach(row => row.classList.add('active'));
            } else if (action === 'none') {
                _galaxyFilter.edgeTypes.clear();
                wrap.querySelectorAll('[data-gf-edge]').forEach(row => row.classList.remove('active'));
            }
            if (_gSig) _gSig.refresh();
        });
    });

    const slider = wrap.querySelector('#gf-mindeg-slider');
    const degVal = wrap.querySelector('#gf-deg-val');
    if (slider) {
        slider.addEventListener('input', () => {
            const value = parseInt(slider.value, 10);
            _galaxyFilter.minDegree = Number.isFinite(value) ? value : 0;
            if (degVal) degVal.textContent = String(_galaxyFilter.minDegree);
            if (_gSig) _gSig.refresh();
        });
    }

    const depthSlider = wrap.querySelector('#gf-depth-slider');
    if (depthSlider) {
        depthSlider.addEventListener('input', () => {
            const value = parseInt(depthSlider.value, 10);
            _galaxyFilter.depthHops = Number.isFinite(value) ? value : 0;
            _gUpdateHopSet();
            const depthLabel = depthSlider.parentElement.querySelector('.gf-slider-label');
            if (depthLabel) {
                depthLabel.innerHTML = _galaxyFilter.depthHops === 0
                    ? 'Off — show all nodes'
                    : `<strong class="gf-deg-val">${_galaxyFilter.depthHops}</strong> hop${_galaxyFilter.depthHops !== 1 ? 's' : ''} from pinned`;
            }
            if (_gSig) _gSig.refresh();
        });
    }

    const commToggle = wrap.querySelector('#gf-community-toggle');
    if (commToggle) {
        commToggle.addEventListener('click', () => {
            _gCommunityColors = !_gCommunityColors;
            commToggle.classList.toggle('active', _gCommunityColors);
            if (_gSig) _gSig.refresh();
        });
    }

    if (typeof updateFilterTabEnabled === 'function') updateFilterTabEnabled();
    if (typeof _applySidebarTab === 'function') {
        _sbActiveTab = 'filters';
        _applySidebarTab();
    } else {
        const filterTab = document.querySelector('.sb-tab[data-tab="filters"]');
        if (filterTab) filterTab.click();
    }
}

function _galaxyRestoreFilterPanel() {
    const wrap = document.getElementById('sb-body-filters');
    if (!wrap || _gFilterPanelSaved === null) return;
    wrap.innerHTML = _gFilterPanelSaved;
    _gFilterPanelSaved = null;
    const explorerTab = document.querySelector('.sb-tab[data-tab="explorer"]');
    if (explorerTab) explorerTab.click();
}

// ── Change Folders canvas button ────────────────────────────────────────────
// Floating button in the bottom-right of the galaxy canvas, shown only when
// the codebase is too large (folder-filtered mode). Uses an inline SVG icon.

let _gChangeFoldersBtnEl = null;

function _galaxyShowChangeFoldersBtn() {
    if (_gChangeFoldersBtnEl?.isConnected) return;
    const container = document.getElementById('galaxy-container');
    if (!container) return;

    const btn = document.createElement('button');
    btn.id = 'galaxy-change-folders-btn';
    btn.title = 'Change Folders…';
    btn.setAttribute('aria-label', 'Change Folders');
    btn.style.cssText =
        'position:absolute;top:14px;left:14px;z-index:20;' +
        'display:flex;align-items:center;gap:7px;' +
        'padding:6px 13px 6px 10px;' +
        'background:rgba(10,20,35,0.82);' +
        'border:1px solid rgba(100,150,255,0.25);' +
        'border-radius:6px;cursor:pointer;' +
        'font-size:12px;font-weight:500;color:#94a3b8;' +
        'transition:background 0.15s,border-color 0.15s,color 0.15s;' +
        'font-family:inherit;';

    // Open-folder SVG with a plus indicator
    btn.innerHTML =
        `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" ` +
        `stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ` +
        `aria-hidden="true">` +
        `<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>` +
        `<line x1="12" y1="11" x2="12" y2="17"/>` +
        `<line x1="9" y1="14" x2="15" y2="14"/>` +
        `</svg>` +
        `<span>Change Folders…</span>`;

    btn.addEventListener('mouseenter', () => {
        btn.style.background = 'rgba(99,102,241,0.18)';
        btn.style.borderColor = 'rgba(99,102,241,0.6)';
        btn.style.color = '#c7d2fe';
    });
    btn.addEventListener('mouseleave', () => {
        btn.style.background = 'rgba(10,20,35,0.82)';
        btn.style.borderColor = 'rgba(100,150,255,0.25)';
        btn.style.color = '#94a3b8';
    });
    btn.addEventListener('click', () => {
        // Tear down current Sigma renderer but keep layout data alive
        if (_gSig) { try { _gSig.kill(); } catch (_) { } _gSig = null; }
        _gPinned = null;
        _gNeighborSet = null;
        _gHoveredNode = null;
        _gHopSet = null;
        if (_gTooltipEl) { _gTooltipEl.remove(); _gTooltipEl = null; }
        _galaxyHideIsolateBtn();
        _galaxyHideLayoutBadge();
        _galaxyHideChangeFoldersBtn();
        // Reset allowed mods so the gate triggers again
        _gAllowedMods = null;
        // Show folder selector; on confirm, rebuild graph with new selection
        const estTotal = _gEstimateTotalNodes(window.DATA);
        const pathTree = _gBuildPathTree(window.DATA);
        _galaxyShowFolderSelectTree(estTotal, pathTree, (selectedPaths) => {
            _gAllowedMods = selectedPaths;
            _gSavedAllowedMods = selectedPaths; // persist new selection
            // Force full graph rebuild with new folder selection
            _gLayoutToken++;
            _gLayoutRunning = false;
            _gLayoutPromise = null;
            _gLayoutDone = false;
            _gLayoutNeedsNoverlap = false;
            _gGraph = null; // force rebuild
            void openGalaxy();
        });
    });

    container.appendChild(btn);
    _gChangeFoldersBtnEl = btn;
}

function _galaxyHideChangeFoldersBtn() {
    if (_gChangeFoldersBtnEl?.parentNode) {
        _gChangeFoldersBtnEl.parentNode.removeChild(_gChangeFoldersBtnEl);
    }
    _gChangeFoldersBtnEl = null;
}

// ── Galaxy lifecycle ──────────────────────────────────────────────────────────

async function openGalaxy() {
    if (!window.DATA) {
        if (typeof showToast === 'function') showToast('No analysis data loaded', 'error');
        return;
    }
    if (typeof closeDashboard === 'function') closeDashboard();
    // Close Structure View if active
    if (window._sv && window._sv.active && typeof symViewClose === 'function') {
        symViewClose();
    }
    
    // Hide breadcrumb and AI chat in Galaxy mode
    const breadcrumb = document.getElementById('breadcrumb');
    const chatBtn = document.getElementById('chat-btn');
    const chatPanel = document.getElementById('chat-panel');
    if (breadcrumb) breadcrumb.style.display = 'none';
    if (chatBtn) chatBtn.style.display = 'none';
    if (chatPanel && chatPanel.classList.contains('open')) {
        chatPanel.classList.remove('open');
    }
    
    const container = document.getElementById('galaxy-container');
    if (!container) return;

    // ── Folder-select gate: show picker when codebase is too large ────────────
    const estTotal = _gEstimateTotalNodes(window.DATA);
    // Restore saved folder selection from previous session (persists across open/close)
    if (_gAllowedMods === null && _gSavedAllowedMods !== null) {
        _gAllowedMods = _gSavedAllowedMods;
    }
    if (estTotal > _G_NODE_THRESHOLD && _gAllowedMods === null) {
        document.getElementById('cy').style.display = 'none';
        const layoutSwitcher = document.getElementById('layout-switcher');
        if (layoutSwitcher) layoutSwitcher.style.display = 'none';
        container.classList.add('active');
        // Mark galaxy as active so the topbar button lights up and user can switch back
        state.galaxyActive = true;
        if (typeof syncTopbarModeButtons === 'function') syncTopbarModeButtons();
        const pathTree = _gBuildPathTree(window.DATA);
        _galaxyShowFolderSelectTree(estTotal, pathTree, (selectedPaths) => {
            _gAllowedMods = selectedPaths; // Set<string> of folder paths, or null (load all)
            _gSavedAllowedMods = selectedPaths; // persist for next open
            void openGalaxy();
        });
        return;
    }
    // ─────────────────────────────────────────────────────────────────────────

    document.getElementById('cy').style.display = 'none';
    const layoutSwitcher = document.getElementById('layout-switcher');
    if (layoutSwitcher) layoutSwitcher.style.display = 'none';
    container.classList.add('active');
    state.galaxyActive = true;
    _gBackgroundPrecomputeMode = false;
    if (typeof updateFilterTabEnabled === 'function') updateFilterTabEnabled();

    const fp = _gComputeDataFingerprint();
    const dataChanged = fp !== _gDataFingerprint;

    if (dataChanged || !_gGraph) {
        _gLayoutToken++;
        _gLayoutRunning = false;
        _gLayoutPromise = null;
        _gPrecomputePending = true;
        _galaxySyncButtonComputing();
        _galaxyHideLayoutBadge();
        // New analysis or first open: full rebuild
        _galaxyTeardownSigma();
        _gDataFingerprint = fp;
        _gLayoutDone = false;
        _gLayoutNeedsNoverlap = false;
        _galaxyBuildGraph(_gAllowedMods);
        _gBuildDegreeCache();
        // Try to restore positions from previous session before falling back to
        // randomized initial layout. Cache hit → skip FA2 entirely.
        const _restored = _galaxyLayoutStorageLoad();
        if (_restored) {
            _gLayoutDone = true;
            _gLayoutNeedsNoverlap = false;
            // Layout is fully restored from localStorage — clear pending flag now
            // because _galaxyLayoutAsync() will be skipped below.
            _gPrecomputePending = false;
        } else {
            _galaxyInitPositions();
        }
    } else {
        // Same data: kill only Sigma renderer, keep _gGraph alive
        if (_gSig) { try { _gSig.kill(); } catch (_) { } _gSig = null; }
        _gPinned = null;
        _gNeighborSet = null;
        _gHoveredNode = null;
        _gHopSet = null;
        if (_gTooltipEl) { _gTooltipEl.remove(); _gTooltipEl = null; }
    }

    // Save selection for next open, then clear the working copy
    // (gate check uses _gSavedAllowedMods to skip the picker on re-entry)
    _gSavedAllowedMods = _gAllowedMods;
    _gAllowedMods = null;

    _gSearchLower = (_galaxyFilter.searchQuery || '').toLowerCase().trim();
    _galaxyInitSigma();
    _galaxyBuildFilterPanel();
    // Show the canvas "Change Folders" button only in folder-filtered mode
    if (_gEstimateTotalNodes(window.DATA) > _G_NODE_THRESHOLD) {
        _galaxyShowChangeFoldersBtn();
    }
    if (typeof syncTopbarModeButtons === 'function') syncTopbarModeButtons();
    if (typeof refreshGraphZoomControls === 'function') refreshGraphZoomControls();

    if (!_gLayoutDone || _gLayoutNeedsNoverlap) {
        if (_gLayoutRunning) _galaxyShowLayoutBadge();
        await _galaxyLayoutAsync();
    }
}

function closeGalaxy() {
    _gLayoutToken++; // cancel any in-flight async layout
    // Remove folder-select overlay if user closes Galaxy while picker is open
    // Note: do NOT reset _gSavedAllowedMods here — we want to preserve the
    // user's folder selection so that re-opening Galaxy skips the picker.
    document.getElementById('g-folder-select')?.remove();
    _gAllowedMods = null;
    const container = document.getElementById('galaxy-container');
    if (container) container.classList.remove('active');
    document.getElementById('cy').style.display = '';
    const layoutSwitcher = document.getElementById('layout-switcher');
    if (layoutSwitcher) layoutSwitcher.style.display = '';
    
    // Show breadcrumb and AI chat button when leaving Galaxy mode
    const breadcrumb = document.getElementById('breadcrumb');
    const chatBtn = document.getElementById('chat-btn');
    if (breadcrumb) breadcrumb.style.display = '';
    if (chatBtn) chatBtn.style.display = 'flex';
    
    state.galaxyActive = false;
    _galaxySyncButtonComputing();
    _galaxyHideLayoutBadge();
    _galaxyHideChangeFoldersBtn();

    // Kill Sigma renderer but KEEP _gGraph alive for instant re-open
    if (_gSig) { try { _gSig.kill(); } catch (_) { } _gSig = null; }
    _gPinned = null;
    _gNeighborSet = null;
    _gHoveredNode = null;
    _gHopSet = null;
    _gHoverNeighborSet = null;
    // Clear interaction sets — they hold references to node keys that, while small,
    // prevent the JIT from cleaning related closures and grow over a session.
    if (_gAnimatedNodes && _gAnimatedNodes.size) _gAnimatedNodes.clear();
    if (_gHighlightSet && _gHighlightSet.size) _gHighlightSet.clear();
    if (_gBlastSet && _gBlastSet.size) _gBlastSet.clear();
    _gIsolateMode = false;
    if (_gTooltipEl) { _gTooltipEl.remove(); _gTooltipEl = null; }

    _galaxyRestoreFilterPanel();
    if (typeof updateFilterTabEnabled === 'function') updateFilterTabEnabled();
    if (typeof clearSidebarGalaxyExplorerHighlight === 'function') clearSidebarGalaxyExplorerHighlight();
    if (typeof syncTopbarModeButtons === 'function') syncTopbarModeButtons();
    if (typeof refreshGraphZoomControls === 'function') refreshGraphZoomControls();
}

window.zoomGalaxyByStep = function (direction) {
    if (!_gSig) return;
    const camera = _gSig.getCamera();
    const factor = direction > 0 ? 1 / 1.5 : 1.5;
    const newRatio = Math.max(0.002, Math.min(50, camera.ratio * factor));
    // Sigma's camera.animate accepts an easing function; cubic-out feels more
    // natural than the default linear curve for discrete zoom steps.
    camera.animate(
        { ratio: newRatio },
        { duration: 220, easing: (t) => 1 - Math.pow(1 - t, 3) }
    );
};

function _galaxyTeardownSigma() {
    // Full teardown — called only when data changes
    if (_gSig) { try { _gSig.kill(); } catch (_) { } _gSig = null; }
    _gGraph = null;
    _gDegreeCache = null;
    _gNodeLabelCache = null;
    _G_COMMUNITY_DIM = null; _G_COMMUNITY_FOG = null;
    _G_COMMUNITY_HLDIM = null; _G_COMMUNITY_SEARCHDIM = null; _G_COMMUNITY_BRIGHT = null;
    _gPinned = null;
    _gNeighborSet = null;
    _gHoveredNode = null;
    _gHopSet = null;
    if (_gTooltipEl) { _gTooltipEl.remove(); _gTooltipEl = null; }
}

// ── Layout orchestration ─────────────────────────────────────────────────────

async function _galaxyLayoutAsync() {
    if (!_gGraph || _gGraph.order === 0) return;
    if (_gLayoutDone && !_gLayoutNeedsNoverlap) return;
    if (_gLayoutRunning && _gLayoutPromise) {
        if (state?.galaxyActive) _galaxyShowLayoutBadge();
        await _gLayoutPromise;
        return;
    }

    _gLayoutToken++;
    const myToken = _gLayoutToken;
    const shouldRunFA2 = !_gLayoutDone;
    _gLayoutRunning = true;
    _gPrecomputePending = true;
    _galaxySyncButtonComputing();
    if (state?.galaxyActive) _galaxyShowLayoutBadge();

    let runPromise = null;
    runPromise = (async () => {
                try {
            if (shouldRunFA2) {
                await _galaxyFA2RunAsync(myToken);
                if (_gLayoutToken !== myToken) return; // cancelled (galaxy closed)
                _gLayoutDone = true;
            }
                        // Noverlap disabled — FA2 result is the final layout (overlaps are acceptable)
            // if (_galaxyIsBackgroundPriority()) {
            //     _gLayoutNeedsNoverlap = true;
            // } else if (shouldRunFA2 || _gLayoutNeedsNoverlap) {
            //     await _galaxyNoverlapPassAsync(myToken);
            //     if (_gLayoutToken !== myToken) return; // cancelled (galaxy closed)
            //     _gLayoutNeedsNoverlap = false;
            // }
            _gLayoutNeedsNoverlap = false; // Always false since Noverlap is disabled
            if (_gSig) _gSig.refresh();
            if (_gLayoutDone) {
                _gPrecomputePending = false;
                // Persist final positions so a refresh / next session can skip FA2.
                _galaxyLayoutStorageSave();
            }
        } finally {
            if (_gLayoutPromise === runPromise) {
                _gLayoutRunning = false;
                _gLayoutPromise = null;
                // Always clear _gPrecomputePending when layout finishes or is cancelled
                if (_gLayoutDone && !_gLayoutNeedsNoverlap) {
                    _gPrecomputePending = false;
                }
                _galaxySyncButtonComputing();
                _galaxyHideLayoutBadge();
            }
        }
    })();

    _gLayoutPromise = runPromise;
    await runPromise;
}

function _galaxyShowLayoutBadge() {
    const container = document.getElementById('galaxy-container');
    if (!container || !container.classList.contains('active')) return null;
    if (_gLayoutBadgeEl?.isConnected) return _gLayoutBadgeEl;

    const el = document.createElement('div');
    el.id = 'galaxy-layout-badge';
    el.style.cssText = 'position:absolute;bottom:14px;left:14px;z-index:20;' +
        'background:rgba(10,20,35,0.82);border:1px solid rgba(100,150,255,0.25);' +
        'border-radius:6px;padding:5px 10px;font-size:11px;color:#94a3b8;' +
        'display:flex;align-items:center;gap:7px;pointer-events:none;';
    el.innerHTML = '<span style="display:inline-block;width:7px;height:7px;' +
        'border-radius:50%;border:1.5px solid #3b82f6;border-top-color:transparent;' +
        'animation:spin .7s linear infinite"></span>Computing layout\u2026';
    container.appendChild(el);
    _gLayoutBadgeEl = el;
    return el;
}

function _galaxyHideLayoutBadge() {
    if (_gLayoutBadgeEl?.parentNode) _gLayoutBadgeEl.parentNode.removeChild(_gLayoutBadgeEl);
    _gLayoutBadgeEl = null;
}

async function _galaxyPrecomputeAsync() {
    if (!window.DATA) return;
    _galaxyInstallBackgroundInputHooks();
    _gPrecomputePending = true;
    _galaxySyncButtonComputing();

    const gateToken = _gLayoutToken;
    const canStart = await _galaxyWaitForBackgroundIdle(gateToken, 900);
    if (!canStart) {
        // Idle gate failed (token changed because openGalaxy ran, or page hidden).
        // If openGalaxy already took over the layout, it owns _gPrecomputePending;
        // otherwise clear it so the button doesn't stay stuck.
        if (!_gLayoutRunning && !_gLayoutDone) {
            _gPrecomputePending = false;
        }
        _galaxySyncButtonComputing();
        return;
    }

    const fp = _gComputeDataFingerprint();
    if (_gGraph && _gDataFingerprint === fp && (_gLayoutDone || _gLayoutRunning)) {
        // Cache hit: graph data hasn't changed and layout is either done or already
        // running in the foreground. Clear all pending flags so the button doesn't
        // stay stuck in computing state (fixes: _gLayoutRunning path left
        // _gPrecomputePending dirty and never hit the finally block).
        _gPrecomputePending = false;
        _gBackgroundPrecomputeMode = false;
        _galaxySyncButtonComputing();
        return;
    }

    _gBackgroundPrecomputeMode = true;
    _galaxySyncButtonComputing();
    try {
        if (fp !== _gDataFingerprint || !_gGraph) {
            _gLayoutToken++;
            _gLayoutRunning = false;
            _gLayoutPromise = null;
            _galaxyHideLayoutBadge();
            _galaxyTeardownSigma();
            _gDataFingerprint = fp;
            _gLayoutDone = false;
            _gLayoutNeedsNoverlap = false;
            _galaxyBuildGraph();
            _gBuildDegreeCache();
            // Same persistence check as openGalaxy — background mode also benefits
            // from skipping FA2 if a valid layout cache exists.
            const _restoredBg = _galaxyLayoutStorageLoad();
            if (_restoredBg) {
                _gLayoutDone = true;
                _gLayoutNeedsNoverlap = false;
            } else {
                _galaxyInitPositions();
            }
        }
        if (!_gLayoutDone) await _galaxyLayoutAsync();
        if (_gLayoutDone) _gPrecomputePending = false;
    } catch (err) {
        console.error('[galaxy] background precompute failed', err);
    } finally {
        if (!state?.galaxyActive) _gBackgroundPrecomputeMode = false;
        _galaxySyncButtonComputing();
    }
}

// ── Node count estimation ────────────────────────────────────────────────────

function _gEstimateTotalNodes(data) {
    const D = data || window.DATA || {};
    let files = 0;
    for (const arr of Object.values(D.files_by_module || {})) files += arr.length;
    for (const arr of Object.values(D.other_files_by_module || {})) files += arr.length;
    const symbols = Object.keys(D.symbol_index || {}).length;
    return files + symbols + Math.ceil(files * 0.25);
}

// ── Hierarchical path tree builder ───────────────────────────────────────────
// Returns root: { name, path, files, symbols, total, children: Map }

function _gBuildPathTree(data) {
    const D = data || window.DATA || {};
    const fileSymbols = new Map();
    for (const sym of Object.values(D.symbol_index || {})) {
        const p = _gNormPath(sym.file);
        fileSymbols.set(p, (fileSymbols.get(p) || 0) + 1);
    }
    const allFiles = [];
    for (const arr of Object.values(D.files_by_module || {})) allFiles.push(...arr);
    for (const arr of Object.values(D.other_files_by_module || {})) allFiles.push(...arr);

    const root = { name: '', path: '', files: 0, symbols: 0, total: 0, children: new Map() };
    const byPath = new Map([['', root]]);

    function ensure(path) {
        if (byPath.has(path)) return byPath.get(path);
        const i = path.lastIndexOf('/');
        const name = i < 0 ? path : path.slice(i + 1);
        const parentPath = i < 0 ? '' : path.slice(0, i);
        const parent = ensure(parentPath);
        const n = { name, path, files: 0, symbols: 0, total: 0, children: new Map() };
        parent.children.set(name, n);
        byPath.set(path, n);
        return n;
    }

    for (const file of allFiles) {
        const norm = _gNormPath(file.path);
        const syms = fileSymbols.get(norm) || 0;
        const parts = norm.split('/');
        let cur = '';
        for (let i = 0; i < parts.length - 1; i++) {
            cur = cur ? cur + '/' + parts[i] : parts[i];
            const n = ensure(cur);
            n.files++;
            n.symbols += syms;
        }
        root.files++;
        root.symbols += syms;
    }

    function calc(n) {
        n.total = n.files + n.symbols + Math.ceil(n.files * 0.25);
        for (const c of n.children.values()) calc(c);
    }
    calc(root);
    return root;
}

// ── Explorer-style folder selector ───────────────────────────────────────────

function _galaxyShowFolderSelectTree(totalCount, tree, onConfirm) {
    const container = document.getElementById('galaxy-container');
    if (!container) return;

    const stale = document.getElementById('g-folder-select');
    if (stale) stale.remove();

    // ── Galaxy-fixed dark palette (independent of app theme) ─────────────────
    const C = {
        ovBg:    'rgba(6,6,16,0.94)',
        dlgBg:   '#0d0d1f',
        border:  '#252545',
        listBg:  '#080818',
        listBdr: '#1c1c38',
        text:    '#dde4f2',
        dim:     '#8a9ab8',
        muted:   '#505870',
        hover:   'rgba(255,255,255,0.05)',
        accent:  '#6366f1',
        btnBdr:  '#2a2a50',
    };

    const fmt = n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
    const fmtFull = n => n.toLocaleString();

    // ── Selection state ───────────────────────────────────────────────────────
    const checkedPaths = new Set();
    for (const child of tree.children.values()) checkedPaths.add(child.path);

    function setSubtreeChecked(node, on) {
        if (on) checkedPaths.add(node.path); else checkedPaths.delete(node.path);
        for (const c of node.children.values()) setSubtreeChecked(c, on);
    }

    function checkState(node) {
        if (checkedPaths.has(node.path)) return 'checked';
        function anyDesc(n) {
            for (const c of n.children.values())
                if (checkedPaths.has(c.path) || anyDesc(c)) return true;
            return false;
        }
        return anyDesc(node) ? 'indeterminate' : 'unchecked';
    }

    function countSelected() {
        function walk(node, parentOn) {
            if (parentOn) return 0;
            if (checkedPaths.has(node.path)) return node.total;
            let s = 0;
            for (const c of node.children.values()) s += walk(c, false);
            return s;
        }
        return walk(tree, false);
    }

    // ── DOM tree builder ──────────────────────────────────────────────────────
    const cbByPath  = new Map(); // path → <input>
    const exByPath  = new Map(); // path → { kidsEl, chev } for expand/collapse all

    function buildRow(node, depth) {
        const hasKids = node.children.size > 0;
        const wrapper = document.createElement('div');

        const row = document.createElement('div');
        row.style.cssText = `display:flex;align-items:center;gap:5px;` +
            `padding:4px 6px 4px ${depth * 14 + 4}px;border-radius:5px;` +
            `transition:background 0.12s;user-select:none;cursor:pointer`;
        row.onmouseenter = () => { row.style.background = C.hover; };
        row.onmouseleave = () => { row.style.background = ''; };

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.style.cssText = `width:13px;height:13px;flex-shrink:0;cursor:pointer;accent-color:${C.accent}`;
        cbByPath.set(node.path, cb);

        const chev = document.createElement('span');
        chev.style.cssText = `width:12px;text-align:center;flex-shrink:0;font-size:9px;` +
            `color:${C.dim};transition:transform 0.15s;line-height:1`;
        chev.textContent = hasKids ? '▶' : '';

        const icon = document.createElement('span');
        icon.style.cssText = 'font-size:12px;flex-shrink:0;line-height:1';
        icon.textContent = '📁';

        const label = document.createElement('span');
        label.textContent = node.name;
        label.style.cssText = `flex:1;font-size:13px;color:${C.text};` +
            'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';

        const cnt = document.createElement('span');
        cnt.style.cssText = `font-size:11px;color:${C.muted};white-space:nowrap;flex-shrink:0`;
        cnt.textContent = `${fmt(node.files)} files · ${fmt(node.symbols)} sym`;

        row.append(cb, chev, icon, label, cnt);
        wrapper.appendChild(row);

        let kidsEl = null;
        if (hasKids) {
            kidsEl = document.createElement('div');
            kidsEl.style.display = 'none'; // all collapsed by default
            const sorted = [...node.children.values()].sort((a, b) => b.total - a.total);
            for (const c of sorted) kidsEl.appendChild(buildRow(c, depth + 1));
            wrapper.appendChild(kidsEl);
            exByPath.set(node.path, { kidsEl, chev });
        }

        cb.addEventListener('change', (e) => {
            e.stopPropagation();
            setSubtreeChecked(node, cb.checked);
            syncCheckboxes();
            updateFooter();
        });

        row.addEventListener('click', (e) => {
            if (e.target === cb) return;
            if (!hasKids) return;
            const open = kidsEl.style.display !== 'none';
            kidsEl.style.display = open ? 'none' : '';
            chev.style.transform = open ? '' : 'rotate(90deg)';
        });

        return wrapper;
    }

    function syncCheckboxes() {
        for (const [path, cbEl] of cbByPath) {
            const n = _gPathTreeFind(tree, path);
            if (!n) continue;
            const s = checkState(n);
            cbEl.checked = s === 'checked';
            cbEl.indeterminate = s === 'indeterminate';
        }
    }

    // ── Overlay ───────────────────────────────────────────────────────────────
    const overlay = document.createElement('div');
    overlay.id = 'g-folder-select';
    overlay.style.cssText = `position:absolute;inset:0;z-index:20;` +
        `background:${C.ovBg};display:flex;align-items:center;justify-content:center`;

    const dialog = document.createElement('div');
    dialog.style.cssText = `background:${C.dlgBg};border:1px solid ${C.border};` +
        `border-radius:12px;padding:20px 20px 16px;width:540px;max-width:94vw;max-height:90vh;` +
        `display:flex;flex-direction:column;box-shadow:0 24px 64px rgba(0,0,0,0.85)`;

    // Header
    const hdr = document.createElement('div');
    hdr.style.marginBottom = '14px';
    hdr.innerHTML =
        `<div style="font-size:15px;font-weight:600;color:${C.text};margin-bottom:5px">` +
        `Codebase too large ` +
        `<span style="font-weight:400;color:${C.dim}">(≈ ${fmtFull(totalCount)} nodes)</span></div>` +
        `<div style="font-size:12px;color:${C.dim};line-height:1.5">` +
        `Galaxy renders best under ${fmtFull(_G_NODE_THRESHOLD)} nodes. ` +
        `Navigate the folder tree and check what to include.</div>`;

    // Toolbar: selection controls left, expand controls right
    const toolbar = document.createElement('div');
    toolbar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;' +
        'margin-bottom:6px;flex-shrink:0';

    function mkTextBtn(txt) {
        const b = document.createElement('button');
        b.textContent = txt;
        b.style.cssText = `font-size:11px;color:${C.dim};background:none;border:none;` +
            'cursor:pointer;padding:2px 7px;border-radius:4px;transition:color 0.1s';
        b.onmouseenter = () => { b.style.color = C.text; };
        b.onmouseleave = () => { b.style.color = C.dim; };
        return b;
    }

    const leftGroup = document.createElement('div');
    leftGroup.style.cssText = 'display:flex;gap:2px;align-items:center';
    const lbl = document.createElement('span');
    lbl.textContent = 'Select:';
    lbl.style.cssText = `font-size:11px;color:${C.muted};margin-right:2px`;
    const btnAll  = mkTextBtn('All');
    const btnNone = mkTextBtn('None');
    leftGroup.append(lbl, btnAll, btnNone);

    const rightGroup = document.createElement('div');
    rightGroup.style.cssText = 'display:flex;gap:2px;align-items:center';
    const lbl2 = document.createElement('span');
    lbl2.textContent = 'Tree:';
    lbl2.style.cssText = `font-size:11px;color:${C.muted};margin-right:2px`;
    const btnExpand   = mkTextBtn('▼ Expand All');
    const btnCollapse = mkTextBtn('▶ Collapse All');
    rightGroup.append(lbl2, btnExpand, btnCollapse);

    toolbar.append(leftGroup, rightGroup);

    // Tree list
    const treeEl = document.createElement('div');
    treeEl.style.cssText = `flex:1;overflow-y:auto;background:${C.listBg};` +
        `border:1px solid ${C.listBdr};border-radius:7px;padding:4px;` +
        'min-height:100px;max-height:340px';
    const sortedRoots = [...tree.children.values()].sort((a, b) => b.total - a.total);
    for (const child of sortedRoots) treeEl.appendChild(buildRow(child, 0));

    // Footer
    const footer = document.createElement('div');
    footer.style.cssText = 'display:flex;align-items:center;justify-content:space-between;' +
        'margin-top:12px;margin-bottom:14px;flex-shrink:0;min-height:20px';
    const countEl = document.createElement('span');
    countEl.style.fontSize = '12px';
    const hintEl = document.createElement('span');
    hintEl.style.cssText = 'font-size:11px;font-weight:500';
    footer.append(countEl, hintEl);

    // Action buttons
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;flex-shrink:0';

    const loadAllBtn = document.createElement('button');
    loadAllBtn.textContent = 'Load All Anyway';
    loadAllBtn.style.cssText = `font-size:12px;color:${C.dim};background:none;` +
        `border:1px solid ${C.btnBdr};border-radius:6px;padding:6px 14px;cursor:pointer;` +
        'transition:border-color 0.15s,color 0.15s';
    loadAllBtn.onmouseenter = () => {
        loadAllBtn.style.borderColor = C.dim;
        loadAllBtn.style.color = C.text;
    };
    loadAllBtn.onmouseleave = () => {
        loadAllBtn.style.borderColor = C.btnBdr;
        loadAllBtn.style.color = C.dim;
    };

    const loadBtn = document.createElement('button');
    loadBtn.textContent = 'Load Selected';
    loadBtn.style.cssText = 'font-size:13px;font-weight:600;color:#fff;background:#4f46e5;' +
        'border:none;border-radius:6px;padding:7px 18px;cursor:pointer;transition:background 0.15s';
    loadBtn.onmouseenter = () => { loadBtn.style.background = '#4338ca'; };
    loadBtn.onmouseleave = () => { loadBtn.style.background = '#4f46e5'; };
    btnRow.append(loadAllBtn, loadBtn);

    dialog.append(hdr, toolbar, treeEl, footer, btnRow);
    overlay.appendChild(dialog);
    container.appendChild(overlay);

    // ── Updaters ──────────────────────────────────────────────────────────────
    function updateFooter() {
        const total = countSelected();
        const clr = total <= _G_NODE_THRESHOLD ? '#10b981' :
            total <= _G_NODE_THRESHOLD * 1.6 ? '#f59e0b' : '#ef4444';
        countEl.innerHTML =
            `<span style="color:${C.dim}">Selected: </span>` +
            `<strong style="color:${clr}">${fmtFull(total)}</strong>` +
            `<span style="color:${C.dim}"> nodes</span>`;
        if (total <= _G_NODE_THRESHOLD) {
            hintEl.textContent = '';
        } else if (total <= _G_NODE_THRESHOLD * 1.6) {
            hintEl.style.color = '#f59e0b';
            hintEl.textContent = '⚠ May be slow';
        } else {
            hintEl.style.color = '#ef4444';
            hintEl.textContent = '⚠ Very slow — fewer folders recommended';
        }
        const hasAny = checkedPaths.size > 0;
        loadBtn.disabled = !hasAny;
        loadBtn.style.opacity = hasAny ? '1' : '0.4';
        loadBtn.style.cursor = hasAny ? 'pointer' : 'not-allowed';
    }

    // ── Event handlers ────────────────────────────────────────────────────────
    btnAll.addEventListener('click', () => {
        for (const child of tree.children.values()) setSubtreeChecked(child, true);
        syncCheckboxes();
        updateFooter();
    });
    btnNone.addEventListener('click', () => {
        checkedPaths.clear();
        syncCheckboxes();
        updateFooter();
    });
    btnExpand.addEventListener('click', () => {
        for (const { kidsEl, chev } of exByPath.values()) {
            kidsEl.style.display = '';
            chev.style.transform = 'rotate(90deg)';
        }
    });
    btnCollapse.addEventListener('click', () => {
        for (const { kidsEl, chev } of exByPath.values()) {
            kidsEl.style.display = 'none';
            chev.style.transform = '';
        }
    });

    // ── Inline confirm dialog (shown when selection exceeds threshold) ──────────
    function _showLargeFolderConfirm(nodeCount, onProceed, onCancel) {
        const confirmOverlay = document.createElement('div');
        confirmOverlay.style.cssText =
            'position:absolute;inset:0;z-index:30;background:rgba(0,0,0,0.72);' +
            'display:flex;align-items:center;justify-content:center';

        const box = document.createElement('div');
        box.style.cssText =
            `background:${C.dlgBg};border:1px solid #3a2020;border-radius:10px;` +
            'padding:22px 24px 18px;width:360px;max-width:92vw;' +
            'box-shadow:0 16px 48px rgba(0,0,0,0.9);text-align:center';

        const icon = document.createElement('div');
        icon.style.cssText = 'font-size:28px;margin-bottom:10px';
        icon.textContent = '⚠️';

        const title = document.createElement('div');
        title.style.cssText = `font-size:15px;font-weight:700;color:#f87171;margin-bottom:8px`;
        title.textContent = 'Large Selection';

        const body = document.createElement('div');
        body.style.cssText = `font-size:12.5px;color:${C.dim};line-height:1.6;margin-bottom:18px`;
        const overRatio = Math.round((nodeCount / _G_NODE_THRESHOLD) * 10) / 10;
        body.innerHTML =
            `You selected <strong style="color:${C.text}">${nodeCount.toLocaleString()} nodes</strong>` +
            ` — <strong style="color:#f87171">${overRatio}×</strong> the recommended limit of ${_G_NODE_THRESHOLD.toLocaleString()}.` +
            `<br><br>Galaxy may be <strong style="color:#fbbf24">very slow or unresponsive</strong>.` +
            `<br>Consider selecting fewer folders.`;

        const btnRow2 = document.createElement('div');
        btnRow2.style.cssText = 'display:flex;gap:10px;justify-content:center';

        const cancelBtn2 = document.createElement('button');
        cancelBtn2.textContent = 'Go Back';
        cancelBtn2.style.cssText =
            `font-size:12px;color:${C.dim};background:none;border:1px solid ${C.btnBdr};` +
            'border-radius:6px;padding:7px 18px;cursor:pointer;transition:border-color 0.15s,color 0.15s';
        cancelBtn2.onmouseenter = () => { cancelBtn2.style.borderColor = C.dim; cancelBtn2.style.color = C.text; };
        cancelBtn2.onmouseleave = () => { cancelBtn2.style.borderColor = C.btnBdr; cancelBtn2.style.color = C.dim; };
        cancelBtn2.addEventListener('click', () => { confirmOverlay.remove(); onCancel(); });

        const proceedBtn = document.createElement('button');
        proceedBtn.textContent = 'Load Anyway';
        proceedBtn.style.cssText =
            'font-size:13px;font-weight:600;color:#fff;background:#b91c1c;' +
            'border:none;border-radius:6px;padding:7px 18px;cursor:pointer;transition:background 0.15s';
        proceedBtn.onmouseenter = () => { proceedBtn.style.background = '#991b1b'; };
        proceedBtn.onmouseleave = () => { proceedBtn.style.background = '#b91c1c'; };
        proceedBtn.addEventListener('click', () => { confirmOverlay.remove(); onProceed(); });

        btnRow2.append(cancelBtn2, proceedBtn);
        box.append(icon, title, body, btnRow2);
        confirmOverlay.appendChild(box);
        // Attach to the folder-select overlay so it appears above the tree dialog
        overlay.appendChild(confirmOverlay);
    }

    function _doLoad() {
        const result = new Set();
        function collect(node, parentOn) {
            if (parentOn) return;
            if (checkedPaths.has(node.path)) { result.add(node.path); return; }
            for (const c of node.children.values()) collect(c, false);
        }
        collect(tree, false);
        overlay.remove();
        onConfirm(result.size > 0 ? result : null);
    }

    loadBtn.addEventListener('click', () => {
        const total = countSelected();
        if (total > _G_NODE_THRESHOLD) {
            _showLargeFolderConfirm(total, _doLoad, () => { /* user goes back — do nothing */ });
        } else {
            _doLoad();
        }
    });
    loadAllBtn.addEventListener('click', () => {
        const allTotal = _gEstimateTotalNodes(window.DATA);
        if (allTotal > _G_NODE_THRESHOLD) {
            _showLargeFolderConfirm(allTotal,
                () => { overlay.remove(); onConfirm(null); },
                () => { /* user goes back */ }
            );
        } else {
            overlay.remove(); onConfirm(null);
        }
    });

    // ── Initial render ────────────────────────────────────────────────────────
    syncCheckboxes();
    updateFooter();
}

// Helper: find a tree node by path (used by syncCheckboxes)
function _gPathTreeFind(tree, path) {
    if (tree.path === path) return tree;
    const parts = path.split('/');
    let cur = tree;
    for (const part of parts) {
        cur = cur.children.get(part);
        if (!cur) return null;
    }
    return cur;
}

function scheduleGalaxyPrecompute() {
    if (!window.DATA || _gPrecomputeQueued || _gLayoutDone || _gLayoutRunning) return;
    if (_gEstimateTotalNodes(window.DATA) > _G_NODE_THRESHOLD) return; // too large; user must select folders first
    if (_gPrecomputeHandle) return;
    _galaxyInstallBackgroundInputHooks();

    const run = () => {
        _gPrecomputeHandle = 0;
        _gPrecomputeQueued = false;
        _galaxySyncButtonComputing();
        void _galaxyPrecomputeAsync();
    };

    _gPrecomputeQueued = true;
    _gPrecomputePending = true;
    _galaxySyncButtonComputing();
    if (typeof window.requestIdleCallback === 'function') {
        _gPrecomputeHandle = window.requestIdleCallback(run, { timeout: 120 });
    } else {
        _gPrecomputeHandle = window.setTimeout(run, 60);
    }
}

// ── Sigma initialization ─────────────────────────────────────────────────────

function _galaxyInitSigma() {
    const container = document.getElementById('galaxy-container');
    if (!container || !_gGraph) return;
    const SigmaClass = window.Sigma;
    if (!SigmaClass) {
        console.error('[galaxy] Sigma not loaded');
        return;
    }

    const edgeCurveProg = SigmaClass.rendering && SigmaClass.rendering.EdgeCurveProgram;
    const n = _gGraph.order;
    const isLarge = n > 5000;

    const sigmaSettings = {
        renderLabels: true,
        labelRenderedSizeThreshold: isLarge ? 14 : 8,
        labelDensity: isLarge ? 0.05 : 0.1,
        labelGridCellSize: isLarge ? 120 : 70,
        labelSize: 11,
        labelFont: 'JetBrains Mono, monospace',
        labelColor: { color: _tC('#cbd5e1', '#716040') },
        hideEdgesOnMove: true,
        hideLabelsOnMove: true,
        enableEdgeEvents: false,
        defaultEdgeType: edgeCurveProg ? 'curved' : 'line',
        zIndex: !isLarge,
        minCameraRatio: 0.002,
        maxCameraRatio: 50,
        nodeReducer: _galaxyNodeReducer,
        edgeReducer: _galaxyEdgeReducer,
        // Galaxy hover keeps only the detailed DOM tooltip; Sigma hover draws
        // just a glow ring so we don't show a second file-name tooltip.
        defaultDrawNodeHover: (context, data, settings) => {
            const nodeSize = data.size || 8;
            context.beginPath();
            context.arc(data.x, data.y, nodeSize + 4, 0, Math.PI * 2);
            context.strokeStyle = data.color || '#6366f1';
            context.lineWidth = 2;
            context.globalAlpha = 0.5;
            context.stroke();
            context.globalAlpha = 1;
        },
    };
    if (edgeCurveProg) {
        sigmaSettings.edgeProgramClasses = { curved: edgeCurveProg, line: SigmaClass.rendering.EdgeLineProgram };
    }
    _gSig = new SigmaClass(_gGraph, container, sigmaSettings);

    _gSig.on('enterNode', ({ node }) => {
        _gHoveredNode = node;
        _gHoverNeighborSet = new Set();
        if (_gGraph && _gGraph.hasNode(node)) {
            _gGraph.forEachNeighbor(node, neighbor => _gHoverNeighborSet.add(neighbor));
        }
        _galaxyShowTooltip(node);
        if (_gSig) _gSig.refresh();
    });

    _gSig.on('leaveNode', () => {
        _gHoveredNode = null;
        _gHoverNeighborSet = null;
        _galaxyHideTooltip();
        if (_gSig) _gSig.refresh();
    });

        _gSig.on('clickNode', ({ node }) => {
        if (_gPinned === node) {
            _gPinned = null;
            _gNeighborSet = null;
            _gHopSet = null;
            _galaxyHideIsolateBtn();
        } else {
            _gPinned = node;
            _buildGNeighborSet(node);
            _gUpdateHopSet();
            _galaxyShowIsolateBtn();
        }
        _gUpdateDepthFilterState();  // Update depth filter state based on pin status
        // Skip the camera-nudge hack — a direct refresh redraws node sizes/colors
        // without queuing a 50ms camera animation that fires another redraw.
        _galaxySyncExplorer(_gGraph ? _gGraph.getNodeAttributes(node) : null);
        if (_gSig) _gSig.refresh();
    });

    _gSig.on('doubleClickNode', ({ node }) => {
        _galaxyNavigate(node);
    });

        _gSig.on('clickStage', () => {
        if (_gPinned) {
            _gPinned = null;
            _gNeighborSet = null;
            _gHopSet = null;
            _galaxyHideIsolateBtn();
            _gUpdateDepthFilterState();  // Update depth filter state based on pin status
            if (_gSig) _gSig.refresh();
        }
    });
}

// ── Reducers — hot path, zero allocation ─────────────────────────────────────
// Sigma.js v2 creates a fresh copy of node/edge attributes before calling the
// reducer, so mutating `data` directly is safe and avoids GC pressure.

function _galaxyNodeReducer(node, data) {
    // Community color override — also update pre-computed dim/bright to match community color
    if (_gCommunityColors && data._community >= 0) {
        const ci = data._community % 12;
        data.color = _G_COMMUNITY_PALETTE[ci];
        data._colorDim = _G_COMMUNITY_DIM ? _G_COMMUNITY_DIM[ci] : data._colorDim;
        data._colorFog = _G_COMMUNITY_FOG ? _G_COMMUNITY_FOG[ci] : data._colorFog;
        data._colorHlDim = _G_COMMUNITY_HLDIM ? _G_COMMUNITY_HLDIM[ci] : data._colorHlDim;
        data._colorSearchDim = _G_COMMUNITY_SEARCHDIM ? _G_COMMUNITY_SEARCHDIM[ci] : data._colorSearchDim;
        data._colorBright = _G_COMMUNITY_BRIGHT ? _G_COMMUNITY_BRIGHT[ci] : data._colorBright;
    }

    if (!_galaxyFilter.nodeTypes.has(data._t)) {
        data.hidden = true;
        data.label = '';
        return data;
    }

    if (_galaxyFilter.minDegree > 0) {
        const degree = _gDegreeCache ? (_gDegreeCache.get(node) || 0) : 0;
        if (degree < _galaxyFilter.minDegree) {
            data.hidden = true;
            data.label = '';
            return data;
        }
    }

    if (_gHopSet && !_gHopSet.has(node)) {
        data.hidden = true;
        data.label = '';
        return data;
    }

    const baseSize = data.size || 1;

    // Animation override (highest priority)
    const anim = _gAnimatedNodes.get(node);
    if (anim) {
        const elapsed = Date.now() - anim.startTime;
        const progress = elapsed >= anim.duration ? 1 : elapsed / anim.duration;
        const phase = _gPulsePhase(progress);
        if (anim.type === 'pulse') {
            data.size = baseSize * (1.3 + phase * 0.5);
            data.color = phase > 0.5 ? '#06b6d4' : '#29d4f5';  // pre-computed brighten
        } else if (anim.type === 'ripple') {
            data.size = baseSize * (1.2 + phase * 0.8);
            data.color = phase > 0.5 ? '#ef4444' : '#f87171';
        }
        data.zIndex = 5;
        data.highlighted = true;
        data.forceLabel = true;
        if (progress >= 1) _gAnimatedNodes.delete(node);
        return data;
    }

    // Use cached lowercase search query — avoids creating new strings per node per frame
    const q = _gSearchLower;
    const matchesSearch = !q || !!(data._labelLower && data._labelLower.includes(q));
    const active = _gPinned;
    const hasBlast = _gBlastSet.size > 0;
    const hasHighlight = _gHighlightSet.size > 0;

    // Blast Radius mode (no pinned selection)
    if (hasBlast && !active) {
        if (_gBlastSet.has(node)) {
            data.color = '#ef4444';
            data.size = baseSize * 1.8;
            data.zIndex = 3;
            data.highlighted = true;
            data.forceLabel = true;
            return data;
        }
        if (_gHighlightSet.has(node)) {
            data.color = '#06b6d4';
            data.size = baseSize * 1.4;
            data.zIndex = 2;
            data.highlighted = true;
            data.forceLabel = true;
            return data;
        }
        data.color = data._colorFog || data.color;
        data.label = '';
        data.zIndex = 0;
        return data;
    }

    // Query Highlight mode (no pinned selection)
    if (hasHighlight && !active) {
        if (_gHighlightSet.has(node)) {
            data.color = '#06b6d4';
            data.size = baseSize * 1.6;
            data.zIndex = 2;
            data.highlighted = true;
            data.forceLabel = true;
            return data;
        }
        data.color = data._colorHlDim || data.color;
        data.label = '';
        data.zIndex = 0;
        return data;
    }

        // Selection mode (pinned node)
    if (active) {
        const isActiveNode = node === active;
        const isNeighbor = _gNeighborSet && _gNeighborSet.has(node);
        const inHopRange = _gHopSet && _gHopSet.has(node);
        
        if (isActiveNode) {
            data.size = baseSize * 1.8;
            data.forceLabel = true;
            data.highlighted = true;
            data.zIndex = 4;
            return data;
        }
        if (isNeighbor) {
            data.size = baseSize * 1.3;
            data.forceLabel = true;
            data.zIndex = 3;
            return data;
        }
                // Highlight nodes within hop range (for depth filter > 1)
        if (inHopRange && _gHopSet.size > (_gNeighborSet ? _gNeighborSet.size : 0) + 1) {
            data.size = baseSize * 1.2;
            // Keep original color (no brightening)
            data.forceLabel = false;
            data.zIndex = 2;
            return data;
        }
        if (q && matchesSearch) {
            data.color = data._colorSearchDim || data.color;
            data.label = '';
            data.zIndex = 1;
            return data;
        }
        // Isolate mode: hide non-neighbor nodes entirely
        if (_gIsolateMode) {
            data.hidden = true;
            data.label = '';
            return data;
        }
        data.color = data._colorDim || data.color;
        data.label = '';
        data.zIndex = 0;
        return data;
    }

        // Search-only mode
    if (q) {
        if (!matchesSearch) {
            data.color = data._colorFog || data.color;  // pre-computed blend 0.15
            data.label = '';
            data.zIndex = 0;
            return data;
        }
        // Keep original color (no brightening)
        data.size = baseSize * 1.3;
        data.forceLabel = true;
        data.zIndex = 2;
        return data;
    }

        // Hover highlight mode (no pinned, no search, no highlight active)
    if (_gHoveredNode && !active && !hasHighlight && !hasBlast && !q) {
        const isHovered = node === _gHoveredNode;
        const isHoverNeighbor = _gHoverNeighborSet && _gHoverNeighborSet.has(node);
        if (isHovered) {
            // Keep original color (no brightening)
            data.size = baseSize * 1.8;
            data.highlighted = true;
            data.forceLabel = true;
            data.zIndex = 4;
            return data;
        }
        if (isHoverNeighbor) {
            data.size = baseSize * 1.3;
            data.forceLabel = true;
            data.zIndex = 3;
            return data;
        }
        data.color = data._colorDim || data.color;
        data.label = '';
        data.zIndex = 0;
        return data;
    }

    // Dark matter ring: isolated nodes are very dim unless hovered
    if (data._isolated && node !== _gHoveredNode) {
        data.color = data._colorFog || data.color;  // pre-computed blend 0.15
        data.label = '';
        return data;
    }

    return data;
}

function _galaxyEdgeReducer(edge, data) {
    if (!_galaxyFilter.edgeTypes.has(data._t)) {
        data.hidden = true;
        return data;
    }
    if (!_gGraph) return data;

    const src = _gGraph.source(edge);
    const tgt = _gGraph.target(edge);
    const active = _gPinned;
    const hasBlast = _gBlastSet.size > 0;
    const hasHighlight = _gHighlightSet.size > 0;

    // Blast Radius mode
    if (hasBlast && !active) {
        const srcActive = _gBlastSet.has(src) || _gHighlightSet.has(src);
        const tgtActive = _gBlastSet.has(tgt) || _gHighlightSet.has(tgt);
        if (srcActive && tgtActive) {
            const bothBlast = _gBlastSet.has(src) && _gBlastSet.has(tgt);
            data.color = bothBlast ? '#ef4444' : '#06b6d4';
            data.size = Math.max((data.size || 1) * 3, 2);
            data.zIndex = 2;
            return data;
        }
        data.color = data._colorDim || data.color;  // pre-computed blend 0.08
        data.size = 0.2;
        data.zIndex = 0;
        return data;
    }

    // Query Highlight mode
    if (hasHighlight && !active) {
        const srcHL = _gHighlightSet.has(src);
        const tgtHL = _gHighlightSet.has(tgt);
        if (srcHL && tgtHL) {
            data.color = '#06b6d4';
            data.size = Math.max((data.size || 1) * 3, 2);
            data.zIndex = 2;
            return data;
        }
        if (srcHL || tgtHL) {
            data.color = '#111e35';  // pre-computed: _gBlendHex('#06b6d4', 0.4)
            data.size = 1;
            data.zIndex = 1;
            return data;
        }
        data.color = data._colorDim || data.color;  // pre-computed blend 0.08
        data.size = 0.2;
        data.zIndex = 0;
        return data;
    }

        // Selection mode
    if (active) {
        const srcInHopRange = _gHopSet && _gHopSet.has(src);
        const tgtInHopRange = _gHopSet && _gHopSet.has(tgt);
        
                // Direct connection to pinned node
        if (src === active || tgt === active) {
            data.size = Math.max((data.size || 1) * 4, 3);
            // Keep original color (no brightening)
            data.zIndex = 10;
            return data;
        }
                // Edge between two nodes within hop range (for depth filter > 1)
        if (_gHopSet && srcInHopRange && tgtInHopRange) {
            data.size = Math.max((data.size || 1) * 2, 1.5);
            // Keep original color (no brightening)
            data.zIndex = 5;
            return data;
        }
        // Isolate mode: hide non-connected edges entirely
        if (_gIsolateMode) {
            data.hidden = true;
            return data;
        }
        data.color = '#080c14';
        data.size = 0.3;
        data.zIndex = 0;
        return data;
    }

    // Search only — use label cache (avoids getNodeAttributes object allocation per edge)
    const q = _gSearchLower;
    if (q) {
        const srcLabel = _gNodeLabelCache ? (_gNodeLabelCache.get(src) || '') : '';
        const tgtLabel = _gNodeLabelCache ? (_gNodeLabelCache.get(tgt) || '') : '';
        if (!srcLabel.includes(q) && !tgtLabel.includes(q)) {
            data.hidden = true;
            return data;
        }
    }

        // Hover highlight — connected edges get brightened, others dim
    if (_gHoveredNode && !active && !hasHighlight && !hasBlast) {
        if (src === _gHoveredNode || tgt === _gHoveredNode) {
            // Keep original color (no brightening)
            data.size = Math.max((data.size || 1) * 4, 3);
            data.zIndex = 10;
            return data;
        }
        data.color = '#080c14';  // very dark — guaranteed dim for all edge types
        data.size = 0.2;
        data.zIndex = 0;
        return data;
    }

    return data;
}

// ── Galaxy Highlight API ─────────────────────────────────────────────────────

window.galaxyHighlight = function (nodeKeys) {
    _gHighlightSet = new Set(nodeKeys || []);
    _gBlastSet = new Set();
    if (_gSig) _gSig.refresh();
};

window.galaxyBlastRadius = function (blastKeys, highlightKeys) {
    _gBlastSet = new Set(blastKeys || []);
    _gHighlightSet = new Set(highlightKeys || []);
    if (_gSig) _gSig.refresh();
};

window.galaxyClearHighlight = function () {
    _gHighlightSet = new Set();
    _gBlastSet = new Set();
    _gAnimatedNodes = new Map();
    if (_gSig) _gSig.refresh();
};

window.galaxyAnimateNodes = function (nodeKeys, type, duration) {
    const now = Date.now();
    const dur = duration || (type === 'ripple' ? 3000 : 2000);
    (nodeKeys || []).forEach(key => {
        _gAnimatedNodes.set(key, { type: type || 'pulse', startTime: now, duration: dur });
    });
    _gRunAnimationLoop();
};

let _gAnimFrameId = null;
function _gRunAnimationLoop() {
    if (_gAnimFrameId) return;
    const tick = () => {
        if (_gAnimatedNodes.size === 0) {
            _gAnimFrameId = null;
            return;
        }
        if (_gSig) _gSig.refresh();
        _gAnimFrameId = requestAnimationFrame(tick);
    };
    _gAnimFrameId = requestAnimationFrame(tick);
}

// ── Color helpers ────────────────────────────────────────────────────────────

function _gDimColor(hex, alpha) {
    if (!hex) return hex;
    if (hex.charAt(0) === '#') {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }
    const rgbMatch = hex.match(/^rgba?\(([^)]+)\)$/i);
    if (rgbMatch) {
        const parts = rgbMatch[1].split(',').map(part => part.trim());
        if (parts.length >= 3) return `rgba(${parts[0]},${parts[1]},${parts[2]},${alpha})`;
    }
    return hex;
}

function _gFadeColor(color, multiplier, alpha) {
    if (!color) return color;
    let r, g, b;
    if (color.charAt(0) === '#') {
        r = parseInt(color.slice(1, 3), 16);
        g = parseInt(color.slice(3, 5), 16);
        b = parseInt(color.slice(5, 7), 16);
    } else {
        const rgbMatch = color.match(/^rgba?\(([^)]+)\)$/i);
        if (!rgbMatch) return color;
        const parts = rgbMatch[1].split(',').map(part => part.trim());
        if (parts.length < 3) return color;
        r = Number(parts[0]); g = Number(parts[1]); b = Number(parts[2]);
    }
    const mul = Math.max(0, Math.min(1, multiplier));
    return `rgba(${Math.round(r * mul)},${Math.round(g * mul)},${Math.round(b * mul)},${alpha})`;
}

function _gBlendWithBg(hex, amount) {
    // Mix color toward galaxy background (#060a10) — avoids WebGL transparency glow artifacts
    const bgR = 6, bgG = 10, bgB = 16;
    let r, g, b;
    if (!hex) return hex;
    if (hex.charAt(0) === '#') {
        r = parseInt(hex.slice(1, 3), 16);
        g = parseInt(hex.slice(3, 5), 16);
        b = parseInt(hex.slice(5, 7), 16);
    } else {
        const m = hex.match(/^rgba?\(([^)]+)\)/i);
        if (!m) return hex;
        const parts = m[1].split(',').map(s => s.trim());
        r = Number(parts[0]); g = Number(parts[1]); b = Number(parts[2]);
    }
    const t = Math.max(0, Math.min(1, amount));
    const nr = Math.round(bgR + (r - bgR) * t);
    const ng = Math.round(bgG + (g - bgG) * t);
    const nb = Math.round(bgB + (b - bgB) * t);
    return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

function _gBrightenColor(hex, factor) {
    if (!hex || hex.charAt(0) !== '#') return hex;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const f = Math.max(1, factor) - 1;
    const nr = Math.min(255, Math.round(r + (255 - r) * f / factor));
    const ng = Math.min(255, Math.round(g + (255 - g) * f / factor));
    const nb = Math.min(255, Math.round(b + (255 - b) * f / factor));
    return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`;
}

// ── Tooltip ──────────────────────────────────────────────────────────────────

function _galaxyShowTooltip(nodeKey) {
    if (!_gGraph || !_gGraph.hasNode(nodeKey) || !_gSig) return;
    const attrs = _gGraph.getNodeAttributes(nodeKey);
    const vp = _gSig.graphToViewport({ x: attrs.x, y: attrs.y });
    const container = document.getElementById('galaxy-container');
    if (!container) return;
    if (!_gTooltipEl) {
        _gTooltipEl = document.createElement('div');
        _gTooltipEl.className = 'galaxy-tooltip';
        container.appendChild(_gTooltipEl);
    }
    _gTooltipEl.style.display = 'block';
    const name = _gEsc(attrs.label || _gNodeDisplayType(attrs));
    const typeLabel = _gNodeDisplayType(attrs);
    const loc = _gCodeLocation(attrs);
    const degree = _gDegreeCache ? (_gDegreeCache.get(nodeKey) || 0) : (_gGraph ? _gGraph.degree(nodeKey) : 0);
    const nodeColor = attrs.color || '#888';
    let html = `<div class="gt-name" style="color:${nodeColor}">${name}</div>`;
    html += `<div class="gt-type">${_gEsc(typeLabel)}</div>`;
    if (loc !== '-') html += `<div class="gt-loc">${_gEsc(loc)}</div>`;
    if (attrs._mod) html += `<div class="gt-mod">${_gEsc(attrs._mod)}</div>`;
    if (attrs._isolated) {
        html += `<div class="gt-degree" style="color:#666">Isolated — no connections</div>`;
    } else {
        html += `<div class="gt-degree">${degree} connection${degree !== 1 ? 's' : ''}</div>`;
    }
    _gTooltipEl.innerHTML = html;
    _gTooltipEl.style.borderColor = nodeColor;
    const pad = 10;
    const width = _gTooltipEl.offsetWidth || 0;
    const height = _gTooltipEl.offsetHeight || 0;
    const left = Math.min(
        Math.max(vp.x - width / 2, pad),
        Math.max(pad, container.clientWidth - width - pad)
    );
    const top = Math.min(
        Math.max(vp.y - height - 12, pad),
        Math.max(pad, container.clientHeight - height - pad)
    );
    _gTooltipEl.style.left = `${left}px`;
    _gTooltipEl.style.top = `${top}px`;
}

function _galaxyHideTooltip() {
    if (_gTooltipEl) _gTooltipEl.style.display = 'none';
}

// ── Navigation / code sync ────────────────────────────────────────────────────

function _galaxySyncExplorer(attrs) {
    if (!attrs || typeof revealSidebarExplorerPath !== 'function') return;
    const isFilters = typeof _sbActiveTab !== 'undefined' && _sbActiveTab === 'filters';
    if (isFilters) return;
    if (attrs._t === 'folder') revealSidebarExplorerPath(attrs._path || '', 'folder');
    else if (attrs._file) revealSidebarExplorerPath(attrs._file, 'file');
}

function _galaxyOpenCodeForNode(attrs) {
    if (!attrs || !_G_CODE_NODE_TYPES.has(attrs._t) || !attrs._file) return;
    if (typeof loadFileInPanel !== 'function') return;
    loadFileInPanel(attrs._file, null);
    if (attrs._line && typeof jumpToLine === 'function') {
        setTimeout(() => jumpToLine(attrs._line), 260);
    } else if ((attrs._t === 'function' || attrs._t === 'method') && attrs.label && typeof jumpToFunc === 'function') {
        setTimeout(() => jumpToFunc(attrs.label), 260);
    }
}

function _galaxyNavigate(nodeKey) {
    if (!_gGraph || !_gGraph.hasNode(nodeKey)) return;

    const attrs = _gGraph.getNodeAttributes(nodeKey);
    const file = attrs._file || '';
    const line = attrs._line || 0;

    _galaxySyncExplorer(attrs);

    if (attrs._t === 'folder' || !file) {
        return;
    }

    if (typeof loadFileInPanel === 'function') loadFileInPanel(file, null);

    if (attrs._t === 'function' || attrs._t === 'method') {
        const idx = Number.isInteger(attrs._funcIdx) ? attrs._funcIdx : null;
        if (idx != null) {
            setTimeout(() => {
                if (typeof focusFunc === 'function') focusFunc(file, idx);
            }, 280);
        } else if (line) {
            setTimeout(() => {
                if (typeof jumpToLine === 'function') jumpToLine(line);
            }, 240);
        }
    } else if (line) {
        setTimeout(() => {
            if (typeof jumpToLine === 'function') jumpToLine(line);
        }, 240);
    }
}

// ── Neighbor set ─────────────────────────────────────────────────────────────

function _buildGNeighborSet(node) {
    _gNeighborSet = new Set();
    if (!_gGraph || !_gGraph.hasNode(node)) return;
    _gGraph.forEachEdge(node, (edge, attrs, src, tgt) => {
        _gNeighborSet.add(src);
        _gNeighborSet.add(tgt);
    });
}

// ── Theme refresh ─────────────────────────────────────────────────────────────

function _galaxyRefreshThemeColors() {
    _gApplyThemeTypeColors();
    if (_gGraph) {
        _gGraph.forEachNode((node, attrs) => {
            _gGraph.setNodeAttribute(node, 'color', _gNodeTypeColor(attrs._t, attrs._symbolKind, true));
        });
    }
    if (state?.galaxyActive) _galaxyBuildFilterPanel();
    if (_gSig) _gSig.refresh();
}

// ── Public API: Highlight node from Explorer click ────────────────────────────

function galaxyHighlightByPath(filePath) {
    if (!state?.galaxyActive || !_gGraph) return false;
    
    // Find node with matching file path
    let foundNode = null;
    _gGraph.forEachNode((node, attrs) => {
        if (attrs._file === filePath) {
            foundNode = node;
            return false; // break
        }
    });
    
    if (!foundNode) return false;
    
    // Highlight the node (same logic as clickNode)
    if (_gPinned === foundNode) {
        // Clicking same node - unpin
        _gPinned = null;
        _gNeighborSet = null;
        _gHopSet = null;
        _galaxyHideIsolateBtn();
    } else {
        // Pin this node
        _gPinned = foundNode;
        _buildGNeighborSet(foundNode);
        _gUpdateHopSet();
        _galaxyShowIsolateBtn();
    }
    
    _gUpdateDepthFilterState();
    if (_gSig) _gSig.refresh();

    return true;
}

window.galaxyHighlightByPath = galaxyHighlightByPath;
