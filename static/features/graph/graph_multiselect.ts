// ─── Middle-Click Box Selection & Batch Move ──────────────────────────────────
// Press middle mouse button (button=1) and drag on the canvas to draw a
// selection rectangle. All nodes inside the rectangle get selected.
// After selection, left-click-drag on any selected node moves the whole group.

(function () {

    // ── state ──────────────────────────────────────────────────────────────────
    let _msActive      = false;   // box-select in progress
    let _msStartX      = 0;       // canvas-pixel start
    let _msStartY      = 0;
    let _msRect        = null;    // <div> overlay
    let _selectedGroup = null;    // cytoscape collection of selected nodes
    let _dragActive    = false;   // batch-move in progress
    let _dragStartPos  = null;    // { x, y } in graph coordinates at drag start
    let _dragNodePositions = null; // Map<id, {x,y}> original positions

    // ── helpers ────────────────────────────────────────────────────────────────
    function _getCyContainer() {
        return document.getElementById('cy');
    }

    function _getOrCreateRect() {
        if (!_msRect) {
            _msRect = document.createElement('div');
            _msRect.id = 'ms-lasso-rect';
            _msRect.style.cssText = [
                'position:absolute',
                'pointer-events:none',
                'border:2px dashed var(--accent,#dfa745)',
                'background:color-mix(in srgb,var(--accent,#dfa745) 10%,transparent)',
                'border-radius:3px',
                'z-index:500',
                'display:none',
                'box-sizing:border-box',
            ].join(';');
            const graphWrap = document.getElementById('graph-wrap') || document.body;
            graphWrap.appendChild(_msRect);
        }
        return _msRect;
    }

    function _showRect(x1, y1, x2, y2) {
        const rect = _getOrCreateRect();
        const left   = Math.min(x1, x2);
        const top    = Math.min(y1, y2);
        const width  = Math.abs(x2 - x1);
        const height = Math.abs(y2 - y1);
        rect.style.left    = left   + 'px';
        rect.style.top     = top    + 'px';
        rect.style.width   = width  + 'px';
        rect.style.height  = height + 'px';
        rect.style.display = 'block';
    }

    function _hideRect() {
        if (_msRect) _msRect.style.display = 'none';
    }

    // Convert container-relative pixel coords to cytoscape graph position.
    function _pxToGraph(cy_inst, px, py) {
        const pan  = cy_inst.pan();
        const zoom = cy_inst.zoom();
        return {
            x: (px - pan.x) / zoom,
            y: (py - pan.y) / zoom,
        };
    }

    // ── clear selection group ──────────────────────────────────────────────────
    function _clearGroupSelect() {
        if (_selectedGroup && _selectedGroup.length) {
            _selectedGroup.removeClass('ms-selected');
            _selectedGroup.unselect();
        }
        _selectedGroup = null;
    }

    // ── apply selection from lasso rect ───────────────────────────────────────
    function _applyLassoSelect(x1, y1, x2, y2) {
        if (!window.cy) return;
        const cy_inst = window.cy;

        // Convert pixel rect → graph rect
        const tl = _pxToGraph(cy_inst, Math.min(x1, x2), Math.min(y1, y2));
        const br = _pxToGraph(cy_inst, Math.max(x1, x2), Math.max(y1, y2));

        const inBox = cy_inst.nodes().filter(n => {
            if (n.hasClass('isolate-hidden')) return false;
            const p = n.position();
            return p.x >= tl.x && p.x <= br.x && p.y >= tl.y && p.y <= br.y;
        });

        _clearGroupSelect();

        if (inBox.length === 0) return;

        inBox.addClass('ms-selected');
        inBox.select();
        _selectedGroup = inBox;

        // Show count toast
        _showMsToast(inBox.length);
    }

    // ── toast notification ─────────────────────────────────────────────────────
    let _toastTimer = null;
    function _showMsToast(count) {
        let toast = document.getElementById('ms-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'ms-toast';
            toast.style.cssText = [
                'position:fixed',
                'bottom:60px',
                'left:50%',
                'transform:translateX(-50%)',
                'background:var(--panel2,#1e1f1c)',
                'color:var(--text,#eae8e3)',
                'border:1px solid var(--border,#2a2b28)',
                'border-radius:8px',
                'padding:6px 14px',
                'font-size:12px',
                'z-index:9999',
                'pointer-events:none',
                'opacity:0',
                'transition:opacity 0.2s ease',
                'white-space:nowrap',
            ].join(';');
            document.body.appendChild(toast);
        }
        toast.textContent = `✦ ${count} node${count !== 1 ? 's' : ''} selected — drag to move`;
        toast.style.opacity = '1';
        if (_toastTimer) clearTimeout(_toastTimer);
        _toastTimer = setTimeout(() => { toast.style.opacity = '0'; }, 2200);
    }

    // ── batch drag move ────────────────────────────────────────────────────────
    function _startBatchDrag(cy_inst, graphPos) {
        if (!_selectedGroup || !_selectedGroup.length) return;
        _dragActive = true;
        _dragStartPos = { ...graphPos };
        _dragNodePositions = new Map();
        _selectedGroup.forEach(n => {
            _dragNodePositions.set(n.id(), { ...n.position() });
        });
        // Prevent cytoscape from processing this mousedown as a pan
        cy_inst.userPanningEnabled(false);
        cy_inst.boxSelectionEnabled(false);
    }

    function _updateBatchDrag(cy_inst, graphPos) {
        if (!_dragActive || !_dragNodePositions || !_dragStartPos) return;
        const dx = graphPos.x - _dragStartPos.x;
        const dy = graphPos.y - _dragStartPos.y;
        cy_inst.batch(() => {
            _dragNodePositions.forEach((origPos, id) => {
                const n = cy_inst.$id(id);
                if (n && n.length) {
                    n.position({ x: origPos.x + dx, y: origPos.y + dy });
                }
            });
        });
    }

    function _endBatchDrag(cy_inst) {
        if (!_dragActive) return;
        _dragActive = false;
        _dragStartPos = null;
        _dragNodePositions = null;
        cy_inst.userPanningEnabled(true);
    }

    // ── hit-test: is the pointer on a selected node? ───────────────────────────
    function _hitSelectedNode(cy_inst, px, py) {
        if (!_selectedGroup || !_selectedGroup.length) return false;
        const graphPos = _pxToGraph(cy_inst, px, py);
        const zoom = cy_inst.zoom();
        let hit = false;
        _selectedGroup.forEach(n => {
            if (hit) return;
            const p = n.position();
            const w = (n.width()  || 40) / 2;
            const h = (n.height() || 20) / 2;
            if (Math.abs(graphPos.x - p.x) <= w && Math.abs(graphPos.y - p.y) <= h) {
                hit = true;
            }
        });
        return hit;
    }

    // ── init (called after cy is ready) ───────────────────────────────────────
    function initMultiSelect() {
        const container = _getCyContainer();
        if (!container) return;

        // ── Middle mouse down → start lasso ───────────────────────────────────
        container.addEventListener('mousedown', e => {
            if (e.button !== 1) return;   // middle button only
            e.preventDefault();
            e.stopPropagation();

            if (!window.cy) return;
            const rect = container.getBoundingClientRect();
            _msActive  = true;
            _msStartX  = e.clientX - rect.left;
            _msStartY  = e.clientY - rect.top;
            _hideRect();
        }, { passive: false });

        // ── Left mouse down → maybe start batch drag ───────────────────────────
        container.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            if (!_selectedGroup || !_selectedGroup.length) return;
            if (!window.cy) return;

            const rect    = container.getBoundingClientRect();
            const px      = e.clientX - rect.left;
            const py      = e.clientY - rect.top;

            if (_hitSelectedNode(window.cy, px, py)) {
                const graphPos = _pxToGraph(window.cy, px, py);
                _startBatchDrag(window.cy, graphPos);
                e.stopPropagation();   // keep cy from handling this as a tap
            } else {
                // Clicked outside selection → clear group
                _clearGroupSelect();
            }
        }, { capture: true });  // capture phase so we can stopPropagation before cy

        // ── Mouse move ────────────────────────────────────────────────────────
        window.addEventListener('mousemove', e => {
            if (!window.cy) return;
            const rect = container.getBoundingClientRect();

            if (_msActive) {
                const curX = e.clientX - rect.left;
                const curY = e.clientY - rect.top;
                _showRect(_msStartX, _msStartY, curX, curY);
            }

            if (_dragActive) {
                const px      = e.clientX - rect.left;
                const py      = e.clientY - rect.top;
                const graphPos = _pxToGraph(window.cy, px, py);
                _updateBatchDrag(window.cy, graphPos);
            }
        });

        // ── Mouse up ──────────────────────────────────────────────────────────
        window.addEventListener('mouseup', e => {
            if (!window.cy) return;

            if (_msActive && e.button === 1) {
                _msActive = false;
                _hideRect();
                const rect = container.getBoundingClientRect();
                const curX = e.clientX - rect.left;
                const curY = e.clientY - rect.top;
                const dist = Math.sqrt(
                    (curX - _msStartX) ** 2 + (curY - _msStartY) ** 2
                );
                if (dist > 6) {
                    _applyLassoSelect(_msStartX, _msStartY, curX, curY);
                }
            }

            if (_dragActive && e.button === 0) {
                _endBatchDrag(window.cy);
            }
        });

        // ── Prevent default context menu from middle clicks ───────────────────
        container.addEventListener('auxclick', e => {
            if (e.button === 1) e.preventDefault();
        });

        // ── Escape → clear selection ──────────────────────────────────────────
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                _clearGroupSelect();
                _hideRect();
                if (window.cy) _endBatchDrag(window.cy);
            }
        });
    }

    // Expose for external init (called from viz.js after cy is ready)
    window.initMultiSelect = initMultiSelect;

    // Auto-init if cy already exists (hot-reload / dev scenarios)
    if (window.cy) {
        initMultiSelect();
    } else {
        // Wait for cy to be assigned
        const _wait = setInterval(() => {
            if (window.cy) {
                clearInterval(_wait);
                initMultiSelect();
            }
        }, 200);
    }

})();
