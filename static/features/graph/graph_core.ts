// ─── Cytoscape ────────────────────────────────────────────────────────────────
function initCy() {
    const savedFont = getSavedFont();

    // Create a dynamic style config that includes the real font string
    const dynamicStyle = withFont(CY_STYLE, savedFont);

    cy = cytoscape({
        container: document.getElementById('cy'),
        style: dynamicStyle,
        elements: [],
        minZoom: GRAPH_ZOOM_SETTINGS.minZoom,
        maxZoom: GRAPH_ZOOM_SETTINGS.maxZoom,
        wheelSensitivity: GRAPH_ZOOM_SETTINGS.wheelSensitivity,
        boxSelectionEnabled: false,
        // ── Performance ───────────────────────────────────────────────────────────
        textureOnViewport: false,                               // avoids black artifacts on dark bg
        motionBlur: false,                                      // avoids dark-frame accumulation
        pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5), // cap HiDPI render cost
    });
    // Expose cy + highlight APIs so viz_chat.js (inside its IIFE) can drive the canvas.
    window.cy               = cy;
    window.highlightNode    = highlightNode;
    window.pinHighlightNode = pinHighlightNode;
    window.clearHighlight   = clearHighlight;
    window.highlightNodes   = highlightNodes;

    cy.on('zoom', () => {
        if (_bgPointerDown) _bgPointerMoved = true;
        refreshGraphZoomControls();
        _startLabelTracking();    // defer placement to after camera settles
    });
    cy.on('pan', () => {
        if (_bgPointerDown) _bgPointerMoved = true;
        _startLabelTracking();    // defer placement to after camera settles
    });
    cy.on('layoutstop', () => {
        _spatialPlacementNow();
        _startLabelTracking();
    });
    cy.on('mousedown', e => {
        const oe = e.originalEvent;
        if (oe && typeof oe.button === 'number' && oe.button !== 0) return;
        _bgPointerDown = e.target === cy;
        _bgPointerMoved = false;
        _bgPointerDownPos = (_bgPointerDown && e.renderedPosition)
            ? { x: e.renderedPosition.x, y: e.renderedPosition.y }
            : null;
    });
    cy.on('mousemove', e => {
        if (!_bgPointerDown || _bgPointerMoved || !_bgPointerDownPos || !e.renderedPosition) return;
        const dx = e.renderedPosition.x - _bgPointerDownPos.x;
        const dy = e.renderedPosition.y - _bgPointerDownPos.y;
        if ((dx * dx + dy * dy) >= (_BACKGROUND_CLEAR_DRAG_PX * _BACKGROUND_CLEAR_DRAG_PX)) {
            _bgPointerMoved = true;
        }
    });
    cy.on('mouseup', e => {
        const shouldClear = e.target === cy && _bgPointerDown && !_bgPointerMoved;
        _bgPointerDown = false;
        _bgPointerMoved = false;
        _bgPointerDownPos = null;
        if (shouldClear) clearSelection();
    });
    cy.on('tap', 'node', e => onNodeTap(e.target));
    cy.on('tap', 'edge', e => onEdgeTap(e.target));
    cy.on('mouseover', 'edge', e => { 
        e.target.addClass('edge-hovered'); 
        if (state.level !== 2) showTooltip(e); 
    });
    cy.on('mouseout', 'edge', e => { 
        e.target.removeClass('edge-hovered'); 
        if (state.level !== 2) scheduleHideTooltip(); 
    });
    cy.on('cxttap', 'node', e => onNodeRightClick(e, e.target));
    cy.on('mouseover', 'node', e => {
        const node = e.target;
        // Broadcast so viz_chat.js can highlight matching badges.
        try { document.dispatchEvent(new CustomEvent('vizNodeHover', { detail: { nodeId: node.id(), enter: true } })); } catch (_) {}
        if (_hoveredNodeClearTimer) { clearTimeout(_hoveredNodeClearTimer); _hoveredNodeClearTimer = null; }
        if (_hlPinned) {
            // Cancel any pending highlightNode call from scheduleHideTooltip —
            // otherwise it runs cy.elements().addClass('faded') and re-fades the hovered node.
            if (tooltipHideTimer) { clearTimeout(tooltipHideTimer); tooltipHideTimer = null; }
            if (_hoveredNode && !_hoveredNode.same(node)) _clearHoveredNodeStyle();
            const isPinnedRelated = node.hasClass('selected-label') || node.hasClass('neighbor-label');
            if (isPinnedRelated) {
                showTooltip(e);
                return;
            }
            node.removeClass('faded');
            node.addClass('node-hovered');
            _hoveredNode = node;
            return;
        }
        showTooltip(e);
        highlightNode(node);
    });
    cy.on('mouseout', 'node', e => {
        scheduleHideTooltip();
        const node = e.target;
        try { document.dispatchEvent(new CustomEvent('vizNodeHover', { detail: { nodeId: node.id(), enter: false } })); } catch (_) {}
        if (_hoveredNode && _hoveredNode.same(node)) {
            _hoveredNodeClearTimer = setTimeout(() => {
                _hoveredNodeClearTimer = null;
                _clearHoveredNodeStyle();
            }, 80);
        }
    });
    // Double-tap ext/drilled/potential func nodes → lazy drill-down (or collapse if drilled)
    cy.on('dbltap', 'node', e => {
        const d = e.target.data();
        if (d._t === 'drill_group') {
            // double-tap on group = collapse
            const srcNode = d._srcNodeId ? cy.$id(d._srcNodeId) : null;
            _collapseDrillGroup(srcNode || e.target, e.target.id(), srcNode?.data('fn') || '');
            return;
        }
        if (d._t === 'ext_func' || d._t === 'drilled_func' || d._t === 'potential_func') {
            drillDownExtFunc(e.target);
        }
    });
    cy.on('zoom', () => {
        if (_labelZoomRaf) return;
        _labelZoomRaf = requestAnimationFrame(() => {
            _labelZoomRaf = null;
            _updateSelectedLabelZoom();
        });
    });
    document.getElementById('cy').addEventListener('contextmenu', e => e.preventDefault());

    // ── Multi-select visual style ─────────────────────────────────────────────
    // The ms-selected class is toggled by graph_multiselect.js.
    // We register it here (after cy is created) so it picks up the live
    // cytoscape instance and overrides gracefully.
    cy.style().selector('.ms-selected').style({
        'overlay-color':   'var(--accent, #dfa745)',
        'overlay-opacity': 0.22,
        'overlay-padding': 6,
        'border-width':    3,
        'border-color':    'var(--accent, #dfa745)',
        'border-opacity':  0.85,
    }).update();
}


function clearSelection() {
    _graphHideIsolateBtn();
    _hlPinned = false;
    _hlPinnedNode = null;
    _clearHoveredNodeStyle();
    _clearSelectedLabelStyle();
    clearHighlight();
    document.querySelectorAll('.code-line.fn-highlight').forEach(el => el.classList.remove('fn-highlight'));
}

function highlightNode(node) {
    if (tooltipHideTimer) clearTimeout(tooltipHideTimer);
    // Temporarily override any pinned highlight without clearing the pin.
    // Use single cy.batch() to avoid multiple redraws on large graphs.
    cy.batch(() => {
        const all = cy.elements();
        all.removeClass('hl hl-edge-out hl-edge-in hl-node-out hl-node-in');
        all.addClass('faded');
        node.removeClass('faded').addClass('hl');
        const outEdges = node.outgoers('edge');
        outEdges.removeClass('faded').addClass('hl-edge-out');
        outEdges.targets().removeClass('faded').addClass('hl-node-out');
        const inEdges = node.incomers('edge');
        inEdges.removeClass('faded').addClass('hl-edge-in');
        inEdges.sources().removeClass('faded').addClass('hl-node-in');
    });
}

function pinHighlightNode(node) {
    _clearHoveredNodeStyle();
    _clearSelectedLabelStyle();
    _hlPinned = false;
    highlightNode(node);
    _hlPinned = true;
    _hlPinnedNode = node;
    _applySelectedLabelStyle(node);
    _graphShowIsolateBtn();
    _applyGraphIsolateState();
}

// Highlight multiple nodes simultaneously (AI "these files are coupled" use case).
// Unlike highlightNode (which highlights neighbors by direction), this keeps the
// focus on the exact set and fades everything else uniformly.
function highlightNodes(ids) {
    if (!cy || !Array.isArray(ids) || !ids.length) return;
    if (tooltipHideTimer) clearTimeout(tooltipHideTimer);

    const col = cy.collection();
    for (const id of ids) {
        const n = cy.getElementById(id);
        if (n && n.length) col.merge(n);
        else {
            // Fallback: label match
            const byLabel = cy.nodes().filter(x => x.data('label') === id);
            if (byLabel.length) col.merge(byLabel[0]);
        }
    }
    if (!col.length) return;

    cy.batch(() => {
        const all = cy.elements();
        all.removeClass('hl hl-edge-out hl-edge-in hl-node-out hl-node-in');
        all.addClass('faded');
        col.removeClass('faded').addClass('hl');
        // Keep edges between highlighted nodes visible.
        col.edgesWith(col).removeClass('faded').addClass('hl-edge-out');
    });
}

let _hlPinned = false;
let _hlPinnedNode = null;
let _lastTappedEdge = null;  // L1: last edge tapped, for code-panel reverse sync
let _hoveredNodeClearTimer = null;
let _labelStyledNodes = null; // Cytoscape collection: pinned node + all neighbors
let _selectedLabelNode = null; // pinned node that keeps zoom-invariant label size
let _neighborLabelNodes = null; // highlighted neighbors that share the label emphasis
let _hoveredNode = null;      // non-highlighted node currently hovered
let _graphIsolateMode = false;
let _graphIsolateBtn = null;
let _bgPointerDown = false;
let _bgPointerMoved = false;
let _bgPointerDownPos = null;
let _labelZoomRaf = null; // RAF handle for throttling _updateSelectedLabelZoom
const _BACKGROUND_CLEAR_DRAG_PX = 6;

// ── Zoom-aware label emphasis for the selected subgraph ─────────────────────
const _SELECTED_LABEL_SIZE = 13;
const _NEIGHBOR_LABEL_SIZE = 12;
const _HOVER_MARGIN_Y = -10; // desired screen-px gap above node
const _DEFAULT_NODE_LABEL_SIZE = 11;
const _L0_NODE_LABEL_SIZE = 12;
const _L1_NODE_LABEL_SIZE = 10;
const _DEFAULT_TEXT_MAX_WIDTH = 160;
const _SIMPLE_TEXT_MAX_WIDTH = 80;

function _getBaseNodeLabelFontSize(node) {
    if (!node || !node.length) return _DEFAULT_NODE_LABEL_SIZE;
    const lvl = Number(node.data('lvl'));
    if (lvl === 0) return _L0_NODE_LABEL_SIZE;
    if (lvl === 1) return _L1_NODE_LABEL_SIZE;
    return _DEFAULT_NODE_LABEL_SIZE;
}

function _getBaseNodeTextMaxWidth(node) {
    if (!node || !node.length) return _DEFAULT_TEXT_MAX_WIDTH;
    return node.data('simple') ? _SIMPLE_TEXT_MAX_WIDTH : _DEFAULT_TEXT_MAX_WIDTH;
}

function _getHighlightedLabelFontSize(node, targetScreenPx, zoom) {
    const safeZoom = Math.max(zoom || 1, 0.0001);
    const baseSize = _getBaseNodeLabelFontSize(node);
    return Math.max(baseSize, Math.round(targetScreenPx / safeZoom));
}

function _getHighlightedTextMaxWidth(node, targetScreenPx, zoom) {
    const safeZoom = Math.max(zoom || 1, 0.0001);
    const baseWidth = _getBaseNodeTextMaxWidth(node);
    return Math.max(baseWidth, Math.round(targetScreenPx / safeZoom));
}

function _updateSelectedLabelZoom() {
    if (!cy) return;
    const z = cy.zoom();
    if (_selectedLabelNode && _selectedLabelNode.length) {
        const fs = _getHighlightedLabelFontSize(_selectedLabelNode, _SELECTED_LABEL_SIZE, z);
        _selectedLabelNode.style('font-size', fs);
        _selectedLabelNode.style('text-max-width', _getHighlightedTextMaxWidth(_selectedLabelNode, _DEFAULT_TEXT_MAX_WIDTH, z));
        _selectedLabelNode.style('text-margin-x', 0);
    }
    if (_neighborLabelNodes && _neighborLabelNodes.length) {
        _neighborLabelNodes.forEach(n => {
            n.style('font-size', _getHighlightedLabelFontSize(n, _NEIGHBOR_LABEL_SIZE, z));
            n.style('text-max-width', _getHighlightedTextMaxWidth(n, _DEFAULT_TEXT_MAX_WIDTH, z));
            n.style('text-margin-x', 0);
        });
    }
}

function _clearHoveredNodeStyle() {
    if (_hoveredNodeClearTimer) { clearTimeout(_hoveredNodeClearTimer); _hoveredNodeClearTimer = null; }
    if (!_hoveredNode || !_hoveredNode.length) return;
    const node = _hoveredNode;
    node.removeClass('node-hovered');
    node.removeStyle('font-size');
    node.removeStyle('text-max-width');
    node.removeStyle('text-margin-x');
    node.removeStyle('text-margin-y');
    node.removeStyle('text-background-padding');
    node.removeStyle('text-border-width');
    if (_hlPinned) node.addClass('faded');
    _hoveredNode = null;
}

function _applySelectedLabelStyle(node) {
    _clearSelectedLabelStyle();
    const neighbors = node.outgoers('node').union(node.incomers('node'));
    _selectedLabelNode = node;
    _neighborLabelNodes = neighbors;
    _labelStyledNodes = node.union(neighbors);
    node.addClass('selected-label');
    neighbors.addClass('neighbor-label');
    _updateSelectedLabelZoom();
}

function _clearSelectedLabelStyle() {
    if (!_labelStyledNodes) return;
    _labelStyledNodes.removeClass('selected-label neighbor-label');
    _labelStyledNodes.removeStyle('font-size');
    _labelStyledNodes.removeStyle('text-max-width');
    _labelStyledNodes.removeStyle('text-margin-x');
    _labelStyledNodes = null;
    _selectedLabelNode = null;
    _neighborLabelNodes = null;
}

function clearHighlight() {
    if (_hlPinned) return;
    cy.batch(() => {
        cy.elements().removeClass('faded hl hl-edge-out hl-edge-in hl-node-out hl-node-in');
    });
    _applyGraphIsolateState();
}

function _resetGraphHighlightPreservingPin() {
    if (!cy) return;
    if (_hlPinned && _hlPinnedNode && _hlPinnedNode.length) {
        highlightNode(_hlPinnedNode);
        _applySelectedLabelStyle(_hlPinnedNode);
        _applyGraphIsolateState();
        return;
    }
    cy.batch(() => {
        cy.elements().removeClass('faded hl hl-edge-out hl-edge-in hl-node-out hl-node-in');
    });
    _applyGraphIsolateState();
}

// ── Smart Label Visibility ────────────────────────────────────────────────────
// Runs spatial label placement synchronously with the camera, like Sigma.js's
// labelGridCellSize approach: one label per grid cell, highest-degree wins.
let _labelRaf = null;

function _graphUpdateIsolateBtnState() {
    if (!_graphIsolateBtn) return;
    const active = !!_graphIsolateMode;
    _graphIsolateBtn.classList.toggle('isolate-active', active);
    _graphIsolateBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
        _graphIsolateBtn.setAttribute('data-tip', active ? 'Show All' : 'Focus Only');
    _graphIsolateBtn.title = active ? 'Show All' : 'Focus Only';
}

function _graphShowIsolateBtn() {
    if (_graphIsolateBtn?.isConnected) {
        _graphUpdateIsolateBtnState();
        return;
    }
    const container = document.getElementById('graph-zoom-controls');
    if (!container) return;
    const btn = document.createElement('button');
    btn.id = 'graph-isolate-btn';
    btn.className = 'graph-zoom-btn';
    btn.type = 'button';
        btn.setAttribute('aria-label', 'Focus Only');
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><circle cx="12" cy="12" r="3"></circle><path d="M12 5v.01M12 18.99v.01M5 12h.01M18.99 12h.01"></path></svg>`;
    btn.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent event bubbling to zoom controls container
        _graphIsolateMode = !_graphIsolateMode;
        _graphUpdateIsolateBtnState();
        _applyGraphIsolateState();
    });
    container.prepend(btn);
    _graphIsolateBtn = btn;
    _graphUpdateIsolateBtnState();
}

function _graphHideIsolateBtn() {
    _graphIsolateMode = false;
    if (cy) cy.elements().removeClass('isolate-hidden');
    if (_graphIsolateBtn?.parentNode) _graphIsolateBtn.parentNode.removeChild(_graphIsolateBtn);
    _graphIsolateBtn = null;
}

function _graphSyncIsolateBtn(shouldShow) {
    if (shouldShow && _hlPinned && _hlPinnedNode && _hlPinnedNode.length) {
        _graphShowIsolateBtn();
        _applyGraphIsolateState();
        return;
    }
    _graphHideIsolateBtn();
}

function _graphPinnedVisibleElements(node) {
    if (!cy || !node || !node.length) return cy ? cy.collection() : null;

    let visibleNodes = node.closedNeighborhood().nodes();
    let parents = visibleNodes.parents();
    while (parents && parents.length) {
        visibleNodes = visibleNodes.union(parents);
        parents = parents.parents();
    }

    return visibleNodes.union(node.connectedEdges());
}

function _applyGraphIsolateState() {
    if (!cy) return;
    cy.batch(() => {
        const all = cy.elements();
        all.removeClass('isolate-hidden');
        if (!_graphIsolateMode || !_hlPinned || !_hlPinnedNode || !_hlPinnedNode.length) return;
        const visible = _graphPinnedVisibleElements(_hlPinnedNode);
        all.not(visible).addClass('isolate-hidden');
    });
    _startLabelTracking();
}

function _spatialPlacementNow() {
    if (!cy) return;
    const z = cy.zoom();

    if (z >= 0.85) {
        cy.batch(() => cy.nodes().removeClass('label-hidden'));
        return;
    }

    // Effective screen font size; simple nodes clamp at min-zoomed-font-size: 6
    const effFs = Math.max(11 * z, 6);
    const PAD = 4;

    const items = [];
    cy.nodes().forEach(n => {
        if (n.hasClass('isolate-hidden')) return;
        const alwaysShow =
            n.data('lvl') === 0 ||
            n.isParent() ||
            !n.data('simple') ||
            n.hasClass('selected-label') ||
            n.hasClass('neighbor-label') ||
            n.hasClass('node-hovered');

        const pos = n.renderedPosition();
        const firstLine = (n.data('label') || '').split('\n')[0];
        const estW = Math.max(firstLine.length * effFs * 0.62, effFs * 4);
        const nodeR = Math.max((n.width() || 14) * z / 2, 4);
        const labelH = effFs * 1.4;

        items.push({
            node: n,
            degree: n.degree(false),
            alwaysShow,
            bb: { x1: pos.x - estW / 2, y1: pos.y - nodeR,
                  x2: pos.x + estW / 2, y2: pos.y + nodeR + labelH + 6 },
        });
    });

    items.sort((a, b) =>
        a.alwaysShow !== b.alwaysShow ? (a.alwaysShow ? -1 : 1) : b.degree - a.degree);

    // Spatial grid for O(1) average overlap detection instead of O(n²)
    const CELL = 80;   // grid cell size in rendered px — tuned for typical label widths
    const grid = new Map();
    function _cellKey(cx, cy) { return (cx << 16) ^ cy; }
    function gridInsert(bb) {
        const cx0 = Math.floor((bb.x1 - PAD) / CELL);
        const cy0 = Math.floor((bb.y1 - PAD) / CELL);
        const cx1 = Math.floor((bb.x2 + PAD) / CELL);
        const cy1 = Math.floor((bb.y2 + PAD) / CELL);
        for (let gx = cx0; gx <= cx1; gx++) {
            for (let gy = cy0; gy <= cy1; gy++) {
                const k = _cellKey(gx, gy);
                let arr = grid.get(k);
                if (!arr) { arr = []; grid.set(k, arr); }
                arr.push(bb);
            }
        }
    }
    function overlaps(bb) {
        const cx0 = Math.floor((bb.x1 - PAD) / CELL);
        const cy0 = Math.floor((bb.y1 - PAD) / CELL);
        const cx1 = Math.floor((bb.x2 + PAD) / CELL);
        const cy1 = Math.floor((bb.y2 + PAD) / CELL);
        for (let gx = cx0; gx <= cx1; gx++) {
            for (let gy = cy0; gy <= cy1; gy++) {
                const k = _cellKey(gx, gy);
                const arr = grid.get(k);
                if (!arr) continue;
                for (const p of arr) {
                    if (bb.x1 - PAD < p.x2 && bb.x2 + PAD > p.x1 &&
                        bb.y1 - PAD < p.y2 && bb.y2 + PAD > p.y1) return true;
                }
            }
        }
        return false;
    }

    cy.batch(() => {
        for (const it of items) {
            if (it.alwaysShow || !overlaps(it.bb)) {
                it.node.removeClass('label-hidden');
                gridInsert(it.bb);
            } else {
                it.node.addClass('label-hidden');
            }
        }
    });
}

// Start a rAF loop that waits for the camera to settle, then runs placement once.
// During movement: do nothing (textureOnViewport handles smooth bitmap pan/zoom).
// After 3 stable frames: run _spatialPlacementNow() once and stop.
function _startLabelTracking() {
    if (_labelRaf) return; // already running
    let prevZ = null, prevPanX = null, prevPanY = null, stableFrames = 0;

    const tick = () => {
        if (!cy) { _labelRaf = null; return; }
        const z = cy.zoom();
        const pan = cy.pan();
        const moved = z !== prevZ || pan.x !== prevPanX || pan.y !== prevPanY;
        prevZ = z; prevPanX = pan.x; prevPanY = pan.y;

        if (moved) {
            stableFrames = 0;
        } else if (++stableFrames >= 3) {
            _spatialPlacementNow();   // camera settled — update labels once
            _labelRaf = null;
            return;
        }
        _labelRaf = requestAnimationFrame(tick);
    };
    _labelRaf = requestAnimationFrame(tick);
}

