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

    _dashExitCustomize();
    _dashSyncCustomizeButton();
}

function _dashSyncCustomizeButton() {
    const btn = document.getElementById('dash-customize-btn');
    if (!btn) return;

    const editable = typeof _dashActiveTabEditable === 'function' && _dashActiveTabEditable();
    btn.disabled = !editable;
    btn.title = editable ? '' : 'Default tab is read-only';
    if (!editable) {
        btn.classList.remove('active');
        btn.textContent = 'Edit';
    }
}

function _dashEnterCustomize() {
    if (typeof _dashActiveTabEditable === 'function' && !_dashActiveTabEditable()) {
        _dashExitCustomize();
        _dashSyncCustomizeButton();
        return false;
    }
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
    _dashSyncCustomizeButton();
    _dashBindDragHandles();
    return true;
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
    _dashSyncCustomizeButton();
    return true;
}

// -- Drag / drop ---------------------------------------------------------------

let _dashDragEl    = null;   // original widget element (opacity 0 while dragging)
let _dashDragGhost = null;   // fixed clone that follows the cursor
let _dashDragPlaceholder = null; // visual drop target
let _dashDragOffsetX = 0;
let _dashDragOffsetY = 0;
let _dashDragLayout = [];     // Snapshot of cells at drag start
let _dashDragResolvedLayout = [];
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
    if (e.target.closest('.dash-widget-size-picker, .dash-size-btn, .dash-widget-remove-btn')) return;
    e.preventDefault();
    _dashDragEl = e.currentTarget.closest('.dash-widget');
    if (!_dashDragEl) return;

    const rect = _dashDragEl.getBoundingClientRect();
    _dashDragOffsetX = e.clientX - rect.left;
    _dashDragOffsetY = e.clientY - rect.top;

    _dashDragLayout = _dashReflowCells(_dashLoadLayout());
    _dashDragResolvedLayout = _dashCloneLayout(_dashDragLayout);
    
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
    const bento = document.getElementById('dashboard-bento');
    bento?.classList.add('dash-reflowing');
    bento?.appendChild(_dashDragPlaceholder);

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

        const id = _dashDragEl.dataset.id;
        const reflowed = _dashResolveDragLayout(id, cell.col, cell.row);
        if (!reflowed.length) return;
        _dashDragResolvedLayout = reflowed;
        
        // Find actual resolved position of dragged widget
        const resolved = reflowed.find(c => c.id === id);
        if (resolved && _dashDragPlaceholder) {
            _dashDragPlaceholder.style.display = 'block';
            _dashDragPlaceholder.style.gridColumn = `${resolved.col + 1} / span ${resolved.w}`;
            _dashDragPlaceholder.style.gridRow    = `${resolved.row + 1} / span ${resolved.h}`;
        }

        _dashApplyDragReflow(reflowed);
    }
}

// ── Pointer up: commit reflow and clean up ───────────────────────────────
function _dashOnUp() {
    document.removeEventListener('pointermove', _dashOnMove);
    document.removeEventListener('pointerup',   _dashOnUp);
    document.removeEventListener('pointercancel', _dashOnUp);

    if (!_dashDragEl) return;

    const reflowed = _dashDragResolvedLayout.length
        ? _dashCloneLayout(_dashDragResolvedLayout)
        : _dashResolveDragLayout(_dashDragEl.dataset.id, _dashHoverCol, _dashHoverRow);
    
    _dashSaveLayout(reflowed);

    const bento = document.getElementById('dashboard-bento');
    bento?.classList.remove('dash-reflowing');
    bento?.querySelectorAll('.dash-widget').forEach(el => {
        el.classList.remove('dash-shifted-widget');
        el.style.transform = '';
    });

    _dashDragGhost?.remove();
    _dashDragGhost = null;

    _dashDragPlaceholder?.remove();
    _dashDragPlaceholder = null;

    _dashDragEl.classList.remove('dash-dragging');
    _dashDragEl = null;
    _dashDragResolvedLayout = [];

    _dashMountLayout();
    if (typeof _dashCustomizeActive !== 'undefined' && _dashCustomizeActive) {
        _dashBindDragHandles();
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function _dashResolveDragLayout(draggedId, targetCol, targetRow) {
    if (!draggedId || targetCol < 0 || targetRow < 0) return [];

    const cells = _dashCloneLayout(_dashDragLayout);
    const dragged = cells.find(c => c.id === draggedId);
    if (!dragged) return [];

    targetCol = Math.max(0, Math.min(_DASH_COLS - dragged.w, targetCol));
    targetRow = Math.max(0, Math.min(_DASH_ROWS - dragged.h, targetRow));

    const others = cells
        .filter(c => c.id !== draggedId)
        .sort((a, b) => {
            const ai = _dashCellIndex(a.col, a.row);
            const bi = _dashCellIndex(b.col, b.row);
            return ai !== bi ? ai - bi : String(a.id).localeCompare(String(b.id));
        });

    const originalIndex = _dashCellIndex(dragged.col, dragged.row);
    const targetIndex = _dashCellIndex(targetCol, targetRow);
    const occupantIndex = others.findIndex(c =>
        targetCol >= c.col && targetCol < c.col + c.w &&
        targetRow >= c.row && targetRow < c.row + c.h);
    const linearIndex = others.findIndex(c => _dashCellIndex(c.col, c.row) >= targetIndex);
    let insertAt = linearIndex >= 0 ? linearIndex : others.length;
    if (occupantIndex >= 0) {
        insertAt = occupantIndex + (targetIndex > originalIndex ? 1 : 0);
    }

    dragged.col = targetCol;
    dragged.row = targetRow;
    dragged._dashPreferredCol = targetCol;
    dragged._dashPreferredRow = targetRow;

    const ordered = [...others];
    ordered.splice(insertAt, 0, dragged);
    return _dashReflowCells(ordered, { keepOrder: true, flow: true });
}

function _dashApplyDragReflow(reflowed) {
    const bento = document.getElementById('dashboard-bento');
    if (!bento) return;

    const targetById = new Map(reflowed.map(c => [c.id, c]));
    bento.querySelectorAll('.dash-widget:not(.dash-dragging)').forEach(el => {
        const targetCell = targetById.get(el.dataset.id);
        if (!targetCell) {
            el.classList.remove('dash-shifted-widget');
            el.style.transform = '';
            return;
        }

        const origCol = Number(el.dataset.col);
        const origRow = Number(el.dataset.row);
        const targetRect = _dashCellRect(targetCell.col, targetCell.row, targetCell.w, targetCell.h);
        const currentRect = _dashCellRect(origCol, origRow, targetCell.w, targetCell.h);
        const dx = targetRect.left - currentRect.left;
        const dy = targetRect.top - currentRect.top;

        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
            el.classList.add('dash-shifted-widget');
            el.style.transform = `translate(${dx}px, ${dy}px)`;
        } else {
            el.classList.remove('dash-shifted-widget');
            el.style.transform = '';
        }
    });
}

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
    if (typeof _dashActiveTabEditable === 'function' && !_dashActiveTabEditable()) return;
    _dashResetActiveTabLayout();
}

// -- Add Widget picker ---------------------------------------------------------

function _dashOpenAddWidgetPicker() {
    if (typeof _dashActiveTabEditable === 'function' && !_dashActiveTabEditable()) return;
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
