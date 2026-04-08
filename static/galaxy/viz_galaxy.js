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
let _gDegreeCache = null;       // Map<nodeKey, degree> — built once after graph construction
let _gNodeLabelCache = null;    // Map<nodeKey, lowerLabel> — for edge reducer search path
let _gSearchLower = '';         // Cached lowercase search query — avoids per-node toLowerCase

// Community palette dim/bright look-up arrays (12 entries, built once in _gBuildDegreeCache)
let _G_COMMUNITY_DIM = null;
let _G_COMMUNITY_FOG = null;
let _G_COMMUNITY_HLDIM = null;
let _G_COMMUNITY_SEARCHDIM = null;
let _G_COMMUNITY_BRIGHT = null;

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
    btn.title = 'Toggle isolate mode — hide unrelated nodes';
    btn.style.cssText = 'width:36px;height:36px;border-radius:50%;border:1.5px solid rgba(100,150,255,0.35);' +
        'background:rgba(10,20,35,0.85);color:#94a3b8;font-size:18px;' +
        'cursor:pointer;display:flex;align-items:center;justify-content:center;' +
        'transition:all .2s ease;backdrop-filter:blur(4px);pointer-events:auto;flex-shrink:0;';
    btn.innerHTML = '👁';
    btn.addEventListener('mouseenter', () => { btn.style.borderColor = '#3b82f6'; btn.style.color = '#e2e8f0'; });
    btn.addEventListener('mouseleave', () => {
        btn.style.borderColor = _gIsolateMode ? '#3b82f6' : 'rgba(100,150,255,0.35)';
        btn.style.color = _gIsolateMode ? '#e2e8f0' : '#94a3b8';
    });
    btn.addEventListener('click', () => {
        _gIsolateMode = !_gIsolateMode;
        btn.style.borderColor = _gIsolateMode ? '#3b82f6' : 'rgba(100,150,255,0.35)';
        btn.style.color = _gIsolateMode ? '#e2e8f0' : '#94a3b8';
        btn.style.background = _gIsolateMode ? 'rgba(59,130,246,0.25)' : 'rgba(10,20,35,0.85)';
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
    wrap.innerHTML =
        `<div style="padding:4px 0 6px">${searchHtml}</div>` +
        `${hdr('Node Types', ntActions)}<div style="padding:4px 0 8px">${nodeRows}</div>` +
        `${hdr('Edge Types', etActions)}<div style="padding:4px 0 8px">${edgeRows}</div>` +
        `${hdr('Min Connections')}<div style="padding:4px 0 8px"><div class="gf-slider-wrap">` +
        `<input type="range" class="gf-slider" id="gf-mindeg-slider" min="0" max="20" step="1" value="${minDeg}">` +
        `<div class="gf-slider-label">Show nodes with <strong class="gf-deg-val" id="gf-deg-val">${minDeg}</strong> connection${minDeg !== 1 ? 's' : ''}</div>` +
        `</div></div>` +
        `${hdr('Depth Filter')}<div style="padding:4px 0 8px"><div class="gf-slider-wrap">` +
        `<input type="range" class="gf-slider" id="gf-depth-slider" min="0" max="5" step="1" value="${depthH}">` +
        `<div class="gf-slider-label">${depthH === 0 ? 'Off — show all nodes' : `<strong class="gf-deg-val" id="gf-depth-val">${depthH}</strong> hop${depthH !== 1 ? 's' : ''} from pinned`}</div>` +
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

    const filterTab = document.querySelector('.sb-tab[data-tab="filters"]');
    if (filterTab) filterTab.click();
}

function _galaxyRestoreFilterPanel() {
    const wrap = document.getElementById('sb-body-filters');
    if (!wrap || _gFilterPanelSaved === null) return;
    wrap.innerHTML = _gFilterPanelSaved;
    _gFilterPanelSaved = null;
    const explorerTab = document.querySelector('.sb-tab[data-tab="explorer"]');
    if (explorerTab) explorerTab.click();
}

// ── Galaxy lifecycle ──────────────────────────────────────────────────────────

async function openGalaxy() {
    if (!window.DATA) {
        if (typeof showToast === 'function') showToast('No analysis data loaded', 'error');
        return;
    }
    if (typeof closeDashboard === 'function') closeDashboard();
    const container = document.getElementById('galaxy-container');
    if (!container) return;
    document.getElementById('cy').style.display = 'none';
    const layoutSwitcher = document.getElementById('layout-switcher');
    if (layoutSwitcher) layoutSwitcher.style.display = 'none';
    container.classList.add('active');
    state.galaxyActive = true;
    _gBackgroundPrecomputeMode = false;

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
        _galaxyBuildGraph();
        _gBuildDegreeCache();
        _galaxyInitPositions();
    } else {
        // Same data: kill only Sigma renderer, keep _gGraph alive
        if (_gSig) { try { _gSig.kill(); } catch (_) { } _gSig = null; }
        _gPinned = null;
        _gNeighborSet = null;
        _gHoveredNode = null;
        _gHopSet = null;
        if (_gTooltipEl) { _gTooltipEl.remove(); _gTooltipEl = null; }
    }

    _gSearchLower = (_galaxyFilter.searchQuery || '').toLowerCase().trim();
    _galaxyInitSigma();
    _galaxyBuildFilterPanel();
    if (typeof syncTopbarModeButtons === 'function') syncTopbarModeButtons();
    if (typeof refreshGraphZoomControls === 'function') refreshGraphZoomControls();

    if (!_gLayoutDone || _gLayoutNeedsNoverlap) {
        if (_gLayoutRunning) _galaxyShowLayoutBadge();
        await _galaxyLayoutAsync();
    }
}

function closeGalaxy() {
    _gLayoutToken++; // cancel any in-flight async layout
    const container = document.getElementById('galaxy-container');
    if (container) container.classList.remove('active');
    document.getElementById('cy').style.display = '';
    const layoutSwitcher = document.getElementById('layout-switcher');
    if (layoutSwitcher) layoutSwitcher.style.display = '';
    state.galaxyActive = false;
    _galaxySyncButtonComputing();
    _galaxyHideLayoutBadge();

    // Kill Sigma renderer but KEEP _gGraph alive for instant re-open
    if (_gSig) { try { _gSig.kill(); } catch (_) { } _gSig = null; }
    _gPinned = null;
    _gNeighborSet = null;
    _gHoveredNode = null;
    _gHopSet = null;
    if (_gTooltipEl) { _gTooltipEl.remove(); _gTooltipEl = null; }

    _galaxyRestoreFilterPanel();
    if (typeof clearSidebarGalaxyExplorerHighlight === 'function') clearSidebarGalaxyExplorerHighlight();
    if (typeof syncTopbarModeButtons === 'function') syncTopbarModeButtons();
    if (typeof refreshGraphZoomControls === 'function') refreshGraphZoomControls();
}

window.zoomGalaxyByStep = function (direction) {
    if (!_gSig) return;
    const camera = _gSig.getCamera();
    const factor = direction > 0 ? 1 / 1.5 : 1.5;
    const newRatio = Math.max(0.002, Math.min(50, camera.ratio * factor));
    camera.animate({ ratio: newRatio }, { duration: 250 });
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
            if (_gLayoutDone) _gPrecomputePending = false;
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
        _galaxySyncButtonComputing();
        return;
    }

    const fp = _gComputeDataFingerprint();
    if (_gGraph && _gDataFingerprint === fp && (_gLayoutDone || _gLayoutRunning)) {
        if (_gLayoutDone) _gPrecomputePending = false;
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
            _galaxyInitPositions();
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

function scheduleGalaxyPrecompute() {
    if (!window.DATA || _gPrecomputeQueued || _gLayoutDone || _gLayoutRunning) return;
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
        // CodeViz-style hover: dark background pill + glow ring
        defaultDrawNodeHover: (context, data, settings) => {
            const label = data.label;
            if (!label) return;

            const size = settings.labelSize || 11;
            const font = settings.labelFont || 'JetBrains Mono, monospace';
            const weight = '500';

            context.font = `${weight} ${size}px ${font}`;
            const textWidth = context.measureText(label).width;

            const nodeSize = data.size || 8;
            const x = data.x;
            const y = data.y - nodeSize - 10;
            const paddingX = 8;
            const paddingY = 5;
            const height = size + paddingY * 2;
            const width = textWidth + paddingX * 2;
            const radius = 4;

            // Dark background pill
            context.fillStyle = _tC('#060a10', '#f5efe8');
            context.beginPath();
            if (context.roundRect) {
                context.roundRect(x - width / 2, y - height / 2, width, height, radius);
            } else {
                context.rect(x - width / 2, y - height / 2, width, height);
            }
            context.fill();

            // Border matching node color
            context.strokeStyle = data.color || '#6366f1';
            context.lineWidth = 2;
            context.stroke();

            // Label text — light
            context.fillStyle = _tC('#f5f5f7', '#020826');
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText(label, x, y);

            // Glow ring around the node
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
        if (_gSig) {
            const _cam = _gSig.getCamera();
            _cam.animate({ ratio: _cam.ratio * 1.0001 }, { duration: 50 });
        }
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
        const progress = Math.min(elapsed / anim.duration, 1);
        const phase = (Math.sin(progress * Math.PI * 4) + 1) / 2;
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
        data.color = data._colorBright || data.color;  // pre-computed brighten 1.4x
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
            data.color = data._colorBright || data.color;
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
        if (src === active || tgt === active) {
            data.size = Math.max((data.size || 1) * 4, 3);
            data.color = data._colorBright || data.color;
            data.zIndex = 10;
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
            data.color = data._colorBright || data.color;
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
