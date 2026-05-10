// @module Dashboard_view/dashboard_customize
// Inline Edit Mode: drag handles, S/M/L size pickers, Add Widget picker, Reset.

const _DASH_LS_CUSTOMIZE = 'vizcode.dashboard.customize';

let _dashCustomizeActive = false;
let _dashCustomizeListenersBound = false;

function _dashInitCustomizeMode() {
    const btn = document.getElementById('dash-customize-btn');
    if (!btn) return;

    if (!_dashCustomizeListenersBound) {
        btn.addEventListener('click', () => {
            if (_dashCustomizeActive) _dashExitCustomize();
            else _dashEnterCustomize();
        });

        document.getElementById('dash-reset-layout-btn')
            ?.addEventListener('click', _dashResetLayout);

        document.getElementById('dash-add-widget-btn')
            ?.addEventListener('click', _dashOpenAddWidgetPicker);

        document.getElementById('dashboard-bento')
            ?.addEventListener('click', _dashHandleSizePickerClick);

        _dashCustomizeListenersBound = true;
    }

    if (localStorage.getItem(_DASH_LS_CUSTOMIZE) === 'on') {
        _dashEnterCustomize();
    } else {
        _dashExitCustomize();
    }
}

function _dashEnterCustomize() {
    _dashCustomizeActive = true;
    document.body.classList.add('dash-customize');
    const btn = document.getElementById('dash-customize-btn');
    if (btn) {
        btn.classList.add('active');
        btn.textContent = 'Done';
    }
    document.getElementById('dash-customize-controls')?.classList.add('visible');
    localStorage.setItem(_DASH_LS_CUSTOMIZE, 'on');
    if (typeof _dashRenderTabBar === 'function') _dashRenderTabBar();
    _dashBindDragHandles();
}

function _dashExitCustomize() {
    if (typeof _dashDragEl !== 'undefined' && _dashDragEl) return false;
    _dashCustomizeActive = false;
    document.body.classList.remove('dash-customize');
    const btn = document.getElementById('dash-customize-btn');
    if (btn) {
        btn.classList.remove('active');
        btn.textContent = 'Edit';
    }
    document.getElementById('dash-customize-controls')?.classList.remove('visible');
    localStorage.setItem(_DASH_LS_CUSTOMIZE, 'off');
    if (typeof _dashRenderTabBar === 'function') _dashRenderTabBar();
    _dashUnbindDragHandles();
    return true;
}

// -- Drag / drop ---------------------------------------------------------------

let _dashDragEl    = null;   // original widget element (opacity 0 while dragging)
let _dashDragGhost = null;   // fixed clone that follows the cursor
let _dashDragPlaceholder = null; // visual drop target
let _dashDragOffsetX = 0;
let _dashDragOffsetY = 0;
let _dashDragLayout = [];     // Snapshot of cells at drag start
let _dashHoverCol = -1;
let _dashHoverRow = -1;

function _dashBindDragHandles() {
    const bento = document.getElementById('dashboard-bento');
    if (!bento) return;

    _dashApplyFloatAnimations();

    bento.querySelectorAll('.dash-widget').forEach(handle => {
        handle.removeEventListener('pointerdown', _dashOnDown); // remove old if any
        handle.addEventListener('pointerdown', _dashOnDown, { passive: false });
    });
}

function _dashUnbindDragHandles() {
    const bento = document.getElementById('dashboard-bento');
    if (!bento) return;
    bento.querySelectorAll('.dash-widget').forEach(handle => {
        handle.removeEventListener('pointerdown', _dashOnDown);
    });
}

// ── Pointer down: start drag ──────────────────────────────────────────────
function _dashOnDown(e) {
    if (!_dashCustomizeActive) return;
    if (e.target.closest('.dash-widget-size-picker, .dash-size-btn')) return;
    e.preventDefault();
    _dashDragEl = e.currentTarget.closest('.dash-widget');
    if (!_dashDragEl) return;

    const rect = _dashDragEl.getBoundingClientRect();
    _dashDragOffsetX = e.clientX - rect.left;
    _dashDragOffsetY = e.clientY - rect.top;

    _dashDragLayout = _dashLoadLayout();
    
    const w = Number(_dashDragEl.dataset.w);
    const h = Number(_dashDragEl.dataset.h);
    const col = Number(_dashDragEl.dataset.col);
    const row = Number(_dashDragEl.dataset.row);

    // Build a fixed ghost clone that follows the cursor
    _dashDragGhost = _dashDragEl.cloneNode(true);
    _dashDragGhost.className = 'dash-widget dash-drag-ghost';
    Object.assign(_dashDragGhost.style, {
        position:        'fixed',
        left:            rect.left + 'px',
        top:             rect.top  + 'px',
        width:           rect.width  + 'px',
        height:          rect.height + 'px',
        pointerEvents:   'none',
        zIndex:          '9999',
        transform:       'scale(1.05)',
        transformOrigin: 'center center',
        margin:          '0',
        transition:      'box-shadow 120ms ease',
        animation:       'none',
    });
    document.body.appendChild(_dashDragGhost);

    // Hide original in-grid widget (keeps its grid slot as implicit placeholder)
    _dashDragEl.classList.add('dash-dragging');

    _dashDragPlaceholder = document.createElement('div');
    _dashDragPlaceholder.className = 'dash-drop-placeholder';
    _dashDragPlaceholder.style.gridColumn = `${col + 1} / span ${w}`;
    _dashDragPlaceholder.style.gridRow    = `${row + 1} / span ${h}`;
    document.getElementById('dashboard-bento').appendChild(_dashDragPlaceholder);

    _dashHoverCol = col;
    _dashHoverRow = row;

    document.addEventListener('pointermove', _dashOnMove, { passive: false });
    document.addEventListener('pointerup',   _dashOnUp);
    document.addEventListener('pointercancel', _dashOnUp);
}

// ── Pointer move: calculate reflow ─────────────────────────────────────────
function _dashOnMove(e) {
    if (!_dashDragGhost || !_dashDragEl) return;
    e.preventDefault();

    // Move ghost
    _dashDragGhost.style.left = (e.clientX - _dashDragOffsetX) + 'px';
    _dashDragGhost.style.top  = (e.clientY - _dashDragOffsetY) + 'px';

    const cell = _dashSnapToCell(e.clientX, e.clientY);
    if (!cell) return;

    if (cell.col !== _dashHoverCol || cell.row !== _dashHoverRow) {
        _dashHoverCol = cell.col;
        _dashHoverRow = cell.row;

        const w = Number(_dashDragEl.dataset.w);
        const h = Number(_dashDragEl.dataset.h);
        
        // Prevent out of bounds
        if (cell.col + w > _DASH_COLS || cell.row + h > _DASH_ROWS) return;

        // Simulate layout reflow
        const id = _dashDragEl.dataset.id;
        const newLayout = _dashCloneLayout(_dashDragLayout);
        const dragged = newLayout.find(c => c.id === id);
        if (dragged) {
            dragged.col = cell.col;
            dragged.row = cell.row;
            // Force it to be evaluated first at this col/row
            dragged._isDragging = true; 
        }

        const sorted = newLayout.sort((a, b) => {
            if (a.row !== b.row) return a.row - b.row;
            if (a.col !== b.col) return a.col - b.col;
            if (a._isDragging) return -1;
            if (b._isDragging) return 1;
            return 0;
        });

        const reflowed = _dashReflowCells(sorted);
        
        // Find actual resolved position of dragged widget
        const resolved = reflowed.find(c => c.id === id);
        if (resolved && _dashDragPlaceholder) {
            _dashDragPlaceholder.style.display = 'block';
            _dashDragPlaceholder.style.gridColumn = `${resolved.col + 1} / span ${resolved.w}`;
            _dashDragPlaceholder.style.gridRow    = `${resolved.row + 1} / span ${resolved.h}`;
        }

        // Apply smooth transition to all other widgets
        const bento = document.getElementById('dashboard-bento');
        bento.querySelectorAll('.dash-widget:not(.dash-dragging)').forEach(el => {
            const elId = el.dataset.id;
            const targetCell = reflowed.find(c => c.id === elId);
            if (!targetCell) return;
            
            const origCol = Number(el.dataset.col);
            const origRow = Number(el.dataset.row);
            
            if (origCol !== targetCell.col || origRow !== targetCell.row) {
                const targetRect = _dashCellRect(targetCell.col, targetCell.row, targetCell.w, targetCell.h);
                const currentRect = _dashCellRect(origCol, origRow, targetCell.w, targetCell.h);
                const dx = targetRect.left - currentRect.left;
                const dy = targetRect.top - currentRect.top;
                
                el.classList.add('dash-shifted-widget');
                el.style.transform = `translate(${dx}px, ${dy}px)`;
            } else {
                el.classList.remove('dash-shifted-widget');
                el.style.transform = '';
            }
        });
    }
}

// ── Pointer up: commit reflow and clean up ───────────────────────────────
function _dashOnUp() {
    document.removeEventListener('pointermove', _dashOnMove);
    document.removeEventListener('pointerup',   _dashOnUp);
    document.removeEventListener('pointercancel', _dashOnUp);

    if (!_dashDragEl) return;

    // Apply the latest reflowed layout
    const id = _dashDragEl.dataset.id;
    const newLayout = _dashCloneLayout(_dashDragLayout);
    const dragged = newLayout.find(c => c.id === id);
    if (dragged) {
        dragged.col = _dashHoverCol;
        dragged.row = _dashHoverRow;
        dragged._isDragging = true;
    }

    const sorted = newLayout.sort((a, b) => {
        if (a.row !== b.row) return a.row - b.row;
        if (a.col !== b.col) return a.col - b.col;
        if (a._isDragging) return -1;
        if (b._isDragging) return 1;
        return 0;
    });

    const reflowed = _dashReflowCells(sorted);
    // remove temp marker
    reflowed.forEach(c => delete c._isDragging);
    
    _dashSaveLayout(reflowed);

    _dashDragGhost?.remove();
    _dashDragGhost = null;

    _dashDragPlaceholder?.remove();
    _dashDragPlaceholder = null;

    _dashDragEl.classList.remove('dash-dragging');
    _dashDragEl = null;

    _dashMountLayout();
    if (typeof _dashCustomizeActive !== 'undefined' && _dashCustomizeActive) {
        _dashBindDragHandles();
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function _dashSnapToCell(clientX, clientY) {
    const bento = document.getElementById('dashboard-bento');
    if (!bento) return null;
    const bentoRect = bento.getBoundingClientRect();
    const style = getComputedStyle(bento);
    const gapX = parseFloat(style.columnGap) || 12;
    const gapY = parseFloat(style.rowGap) || 12;
    const colW = (bentoRect.width - gapX * (_DASH_COLS - 1)) / _DASH_COLS;
    const rowH = (bentoRect.height - gapY * (_DASH_ROWS - 1)) / _DASH_ROWS;

    const relX = clientX - bentoRect.left;
    const relY = clientY - bentoRect.top;
    const col = Math.floor(relX / (colW + gapX));
    const row = Math.floor(relY / (rowH + gapY));

    if (col < 0 || col >= _DASH_COLS || row < 0 || row >= _DASH_ROWS) return null;
    return { col, row };
}

function _dashCellRect(col, row, w, h) {
    const bento = document.getElementById('dashboard-bento');
    if (!bento) return { left: 0, top: 0, width: 0, height: 0 };
    const bentoRect = bento.getBoundingClientRect();
    const style = getComputedStyle(bento);
    const gapX = parseFloat(style.columnGap) || 12;
    const gapY = parseFloat(style.rowGap) || 12;
    const colW = (bentoRect.width - gapX * (_DASH_COLS - 1)) / _DASH_COLS;
    const rowH = (bentoRect.height - gapY * (_DASH_ROWS - 1)) / _DASH_ROWS;
    return {
        left: bentoRect.left + col * (colW + gapX),
        top: bentoRect.top + row * (rowH + gapY),
        width: w * colW + Math.max(0, w - 1) * gapX,
        height: h * rowH + Math.max(0, h - 1) * gapY,
    };
}

// Assigns staggered animation-delay values so widgets don't float in sync.
// Called once per _dashBindDragHandles() invocation.
function _dashApplyFloatAnimations() {
    const PERIOD = 3.2; // must match animation duration in CSS
    document.querySelectorAll('#dashboard-bento .dash-widget').forEach((el, i) => {
        // Spread delays evenly across the period, negative so animation starts mid-cycle
        el.style.animationDelay = `-${((i * 0.55) % PERIOD).toFixed(2)}s`;
    });
}

// -- Size picker ---------------------------------------------------------------

function _dashHandleSizePickerClick(e) {
    const btn = e.target.closest('.dash-size-btn');
    if (!btn || !_dashCustomizeActive) return;
    e.stopPropagation();

    const tier = btn.dataset.tier;
    const widgetEl = btn.closest('.dash-widget');
    if (!widgetEl || !tier) return;

    const id = widgetEl.dataset.id;
    const { w, h } = _DASH_SIZE_TIERS[tier] || _DASH_SIZE_TIERS.M;

    if (!_dashGridHasRoom(id, w, h)) {
        const orig = btn.textContent;
        btn.textContent = '!';
        setTimeout(() => { btn.textContent = orig; }, 700);
        return;
    }

    const cells = _dashLoadLayout();
    const cell = cells.find(c => c.id === id);
    if (!cell) return;

    cell.w = w;
    cell.h = h;
    _dashSaveLayout(cells);
    _dashMountLayout();
    if (_dashCustomizeActive) _dashBindDragHandles();
}

// -- Reset ---------------------------------------------------------------------

function _dashResetLayout() {
    _dashResetActiveTabLayout();
}

// -- Add Widget picker ---------------------------------------------------------

function _dashOpenAddWidgetPicker() {
    if (document.getElementById('dash-add-widget-overlay')) return;

    const hidden = _dashHiddenWidgetIds();
    const overlay = document.createElement('div');
    overlay.className = 'dash-add-widget-overlay';
    overlay.id = 'dash-add-widget-overlay';

    const cards = hidden.map(id => {
        const widget = _dashWidgetRegistry[id];
        if (!widget) return '';
        const label = _dashT(widget.labelKey || id) || id;
        const defaultTier = widget.defaultSize || 'M';

        const tierButtons = Object.entries(_DASH_SIZE_TIERS).map(([tier, { w: gw, h: gh }]) => {
            const fits = _dashGridHasRoom(null, gw, gh);
            const isDefault = tier === defaultTier;
            return `<button class="dash-size-btn${isDefault && fits ? ' active' : ''}"
                data-tier="${tier}"${!fits ? ' disabled' : ''} type="button">${tier}</button>`;
        }).join('');

        const anyFits = Object.values(_DASH_SIZE_TIERS).some(({ w: gw, h: gh }) =>
            _dashGridHasRoom(null, gw, gh));

        return `<div class="dash-add-widget-card" data-widget-id="${_dashEscape(id)}">
  <div class="dash-add-widget-preview" id="dash-preview-${_dashEscape(id)}"></div>
  <div class="dash-add-widget-card-footer">
    <span class="dash-add-widget-card-name">${_dashEscape(label)}</span>
    <div class="dash-add-widget-size-row">${tierButtons}</div>
    <button class="dash-add-widget-add-btn" data-widget-id="${_dashEscape(id)}"
      type="button"${!anyFits ? ' disabled' : ''}>${anyFits ? 'Add' : 'Grid Full'}</button>
  </div>
</div>`;
    }).join('') || '<div class="dash-empty" style="padding:var(--space-4)">All widgets are already on this tab.</div>';

    overlay.innerHTML = `<div class="dash-add-widget-panel">
  <div class="dash-add-widget-head">
    <span class="dash-add-widget-title">Add Widget</span>
    <button class="dash-detail-close" id="dash-add-widget-close" type="button" aria-label="Close">x</button>
  </div>
  <div class="dash-add-widget-grid">${cards}</div>
</div>`;

    document.body.appendChild(overlay);

    hidden.forEach(id => {
        const widget = _dashWidgetRegistry[id];
        const previewEl = document.getElementById(`dash-preview-${id}`);
        if (!widget || !previewEl || !window.DATA || !DATA.stats) return;
        try {
            widget.render(previewEl, 'S', DATA.stats);
        } catch (_) {
            previewEl.innerHTML = `<div class="dash-empty" style="font-size:11px;padding:8px;">${_dashEscape(id)}</div>`;
        }
    });

    const selectedTier = {};
    overlay.querySelectorAll('.dash-add-widget-card').forEach(card => {
        const widgetId = card.dataset.widgetId;
        const widget = _dashWidgetRegistry[widgetId];
        const defTier = (widget && widget.defaultSize) || 'M';
        const { w: dw, h: dh } = _DASH_SIZE_TIERS[defTier] || _DASH_SIZE_TIERS.M;

        if (_dashGridHasRoom(null, dw, dh)) {
            selectedTier[widgetId] = defTier;
        } else {
            const fit = Object.entries(_DASH_SIZE_TIERS).find(([, { w: gw, h: gh }]) =>
                _dashGridHasRoom(null, gw, gh));
            selectedTier[widgetId] = fit ? fit[0] : null;
        }

        card.querySelectorAll('.dash-size-btn:not([disabled])').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                card.querySelectorAll('.dash-size-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedTier[widgetId] = btn.dataset.tier;
            });
        });
    });

    overlay.querySelectorAll('.dash-add-widget-add-btn:not([disabled])').forEach(btn => {
        btn.addEventListener('click', () => {
            const widgetId = btn.dataset.widgetId;
            const tier = selectedTier[widgetId];
            if (!tier) return;
            _dashAddOptionalWidgetWithSize(widgetId, tier);
            overlay.remove();
            if (_dashCustomizeActive) _dashBindDragHandles();
        });
    });

    overlay.addEventListener('click', e => {
        if (e.target === overlay) overlay.remove();
    });
    overlay.querySelector('#dash-add-widget-close')
        ?.addEventListener('click', () => overlay.remove());
}
