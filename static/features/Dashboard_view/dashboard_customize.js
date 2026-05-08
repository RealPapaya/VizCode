// @module Dashboard_view/dashboard_customize
// Inline Customize Mode: drag handles, S/M/L size pickers, Add Widget picker,
// Reset / Save-as-Preset / Delete-Preset. Uses vanilla pointer events — no library.

const _DASH_LS_CUSTOMIZE = 'vizcode.dashboard.customize';

let _dashCustomizeActive  = false;
let _dashDragState        = null;   // { widgetEl, startX, startY, ghostEl, origCell }

function _dashInitCustomizeMode() {
    const btn = document.getElementById('dash-customize-btn');
    if (!btn) return;

    // Populate preset selector first
    _dashRefreshPresetSelector();

    // Restore previous toggle state
    if (localStorage.getItem(_DASH_LS_CUSTOMIZE) === 'on') {
        _dashEnterCustomize();
    }

    btn.addEventListener('click', () => {
        if (_dashCustomizeActive) _dashExitCustomize();
        else _dashEnterCustomize();
    });

    document.getElementById('dash-reset-layout-btn')
        ?.addEventListener('click', _dashResetLayout);

    document.getElementById('dash-add-widget-btn')
        ?.addEventListener('click', _dashOpenAddWidgetPicker);

    document.getElementById('dash-save-preset-btn')
        ?.addEventListener('click', _dashSaveAsPreset);

    document.getElementById('dash-delete-preset-btn')
        ?.addEventListener('click', _dashDeleteCurrentPreset);

    // Preset selector change
    document.getElementById('dash-preset-select')
        ?.addEventListener('change', e => {
            _dashApplyPreset(e.target.value);
            if (_dashCustomizeActive) _dashBindDragHandles();
        });

    // Delegate size picker clicks
    document.getElementById('dashboard-bento')
        ?.addEventListener('click', _dashHandleSizePickerClick);
}

function _dashEnterCustomize() {
    _dashCustomizeActive = true;
    document.body.classList.add('dash-customize');
    const btn = document.getElementById('dash-customize-btn');
    if (btn) btn.classList.add('active');
    document.getElementById('dash-customize-controls')?.classList.add('visible');
    localStorage.setItem(_DASH_LS_CUSTOMIZE, 'on');
    _dashBindDragHandles();
}

function _dashExitCustomize() {
    _dashCustomizeActive = false;
    document.body.classList.remove('dash-customize');
    const btn = document.getElementById('dash-customize-btn');
    if (btn) btn.classList.remove('active');
    document.getElementById('dash-customize-controls')?.classList.remove('visible');
    localStorage.setItem(_DASH_LS_CUSTOMIZE, 'off');
    _dashUnbindDragHandles();
}

// ── Drag / drop ───────────────────────────────────────────────────────────

function _dashBindDragHandles() {
    const bento = document.getElementById('dashboard-bento');
    if (!bento) return;
    bento.querySelectorAll('.dash-widget-handle').forEach(handle => {
        handle.addEventListener('pointerdown', _dashOnHandlePointerDown);
    });
}

function _dashUnbindDragHandles() {
    const bento = document.getElementById('dashboard-bento');
    if (!bento) return;
    bento.querySelectorAll('.dash-widget-handle').forEach(handle => {
        handle.removeEventListener('pointerdown', _dashOnHandlePointerDown);
    });
}

function _dashOnHandlePointerDown(e) {
    if (!_dashCustomizeActive) return;
    e.preventDefault();
    e.stopPropagation();

    const widgetEl = e.currentTarget.closest('.dash-widget');
    if (!widgetEl) return;

    const rect = widgetEl.getBoundingClientRect();

    // Ghost: clone for visual drag feedback
    const ghost = widgetEl.cloneNode(true);
    ghost.style.cssText = `
        position:fixed;
        width:${rect.width}px;
        height:${rect.height}px;
        left:${rect.left}px;
        top:${rect.top}px;
        opacity:0.7;
        pointer-events:none;
        z-index:200;
        transition:none;
    `;
    document.body.appendChild(ghost);

    widgetEl.classList.add('dash-dragging');

    _dashDragState = {
        widgetEl,
        ghost,
        startX: e.clientX,
        startY: e.clientY,
        rectLeft: rect.left,
        rectTop:  rect.top,
        id:   widgetEl.dataset.id,
        w:    Number(widgetEl.dataset.w),
        h:    Number(widgetEl.dataset.h),
    };

    document.addEventListener('pointermove', _dashOnDragMove, { passive: true });
    document.addEventListener('pointerup',   _dashOnDragEnd);
}

function _dashOnDragMove(e) {
    if (!_dashDragState) return;
    const { ghost, startX, startY, rectLeft, rectTop } = _dashDragState;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    ghost.style.left = `${rectLeft + dx}px`;
    ghost.style.top  = `${rectTop  + dy}px`;

    // Highlight the drop target cell
    _dashClearDropTargets();
    const cell = _dashSnapToCell(e.clientX, e.clientY);
    if (cell) {
        const target = _dashWidgetAtCell(cell.col, cell.row);
        if (target && target !== _dashDragState.widgetEl) {
            target.classList.add('dash-drop-target');
        }
    }
}

function _dashOnDragEnd(e) {
    if (!_dashDragState) return;
    document.removeEventListener('pointermove', _dashOnDragMove);
    document.removeEventListener('pointerup',   _dashOnDragEnd);

    const { widgetEl, ghost, id, w, h } = _dashDragState;
    ghost.remove();
    widgetEl.classList.remove('dash-dragging');
    _dashClearDropTargets();
    _dashDragState = null;

    const cell = _dashSnapToCell(e.clientX, e.clientY);
    if (!cell) return;

    // Validate the drop doesn't exceed grid bounds
    if (cell.col + w > _DASH_COLS || cell.row + h > _DASH_ROWS) return;

    // Persist the move
    const cells  = _dashLoadLayout();
    const moving = cells.find(c => c.id === id);
    if (!moving) return;

    // Swap with any widget already occupying this position
    const occupant = cells.find(c => c.id !== id &&
        c.col < cell.col + w && c.col + c.w > cell.col &&
        c.row < cell.row + h && c.row + c.h > cell.row);

    if (occupant) {
        const origCol = moving.col;
        const origRow = moving.row;
        occupant.col = origCol;
        occupant.row = origRow;
    }

    moving.col = cell.col;
    moving.row = cell.row;

    _dashSaveLayout(cells);
    _dashMountLayout();
    _dashBindDragHandles();
}

function _dashSnapToCell(clientX, clientY) {
    const bento = document.getElementById('dashboard-bento');
    if (!bento) return null;
    const bentoRect = bento.getBoundingClientRect();
    const style     = getComputedStyle(bento);
    const gapX      = parseFloat(style.columnGap) || 12;
    const gapY      = parseFloat(style.rowGap)    || 12;
    const colW      = (bentoRect.width  - gapX * (_DASH_COLS - 1)) / _DASH_COLS;
    const rowH      = (bentoRect.height - gapY * (_DASH_ROWS - 1)) / _DASH_ROWS;

    const relX = clientX - bentoRect.left;
    const relY = clientY - bentoRect.top;

    const col = Math.floor(relX / (colW + gapX));
    const row = Math.floor(relY / (rowH + gapY));

    if (col < 0 || col >= _DASH_COLS || row < 0 || row >= _DASH_ROWS) return null;
    return { col, row };
}

function _dashWidgetAtCell(col, row) {
    const bento = document.getElementById('dashboard-bento');
    if (!bento) return null;
    return Array.from(bento.querySelectorAll('.dash-widget')).find(el => {
        const c = Number(el.dataset.col);
        const r = Number(el.dataset.row);
        const w = Number(el.dataset.w);
        const h = Number(el.dataset.h);
        return col >= c && col < c + w && row >= r && row < r + h;
    }) || null;
}

function _dashClearDropTargets() {
    document.querySelectorAll('.dash-drop-target')
        .forEach(el => el.classList.remove('dash-drop-target'));
}

// ── Size picker ───────────────────────────────────────────────────────────

function _dashHandleSizePickerClick(e) {
    const btn = e.target.closest('.dash-size-btn');
    if (!btn || !_dashCustomizeActive) return;
    e.stopPropagation();

    const tier     = btn.dataset.tier;
    const widgetEl = btn.closest('.dash-widget');
    if (!widgetEl || !tier) return;

    const id       = widgetEl.dataset.id;
    const { w, h } = _DASH_SIZE_TIERS[tier] || _DASH_SIZE_TIERS.M;

    // Check grid capacity (exclude current widget's footprint)
    if (!_dashGridHasRoom(id, w, h)) {
        const orig = btn.textContent;
        btn.textContent = '✗';
        setTimeout(() => { btn.textContent = orig; }, 700);
        return;
    }

    const cells = _dashLoadLayout();
    const cell  = cells.find(c => c.id === id);
    if (!cell) return;

    cell.w = w;
    cell.h = h;
    _dashSaveLayout(cells);
    _dashMountLayout();
    if (_dashCustomizeActive) _dashBindDragHandles();
}

// ── Preset management ─────────────────────────────────────────────────────

function _dashRefreshPresetSelector() {
    const sel = document.getElementById('dash-preset-select');
    if (!sel) return;
    const presets = _dashLoadPresets();
    const active  = _dashGetActivePreset();
    sel.innerHTML = Object.keys(presets).map(name =>
        `<option value="${_dashEscape(name)}"${name === active ? ' selected' : ''}>${_dashEscape(name)}</option>`
    ).join('');
}

function _dashSaveAsPreset() {
    const name = (window.prompt('Preset name:') || '').trim();
    if (!name || name === 'Default') return;
    _dashSavePreset(name, _dashLoadLayout());
    _dashSetActivePreset(name);
    _dashRefreshPresetSelector();
}

function _dashDeleteCurrentPreset() {
    const name = _dashGetActivePreset();
    if (name === 'Default') return;
    if (!window.confirm(`Delete preset "${name}"?`)) return;
    _dashDeletePreset(name);
    _dashApplyPreset('Default');
    _dashRefreshPresetSelector();
}

// ── Reset / Save ──────────────────────────────────────────────────────────

function _dashResetLayout() {
    // Reset to the base cells of the currently active preset
    const cells = (_dashLoadPresets()[_dashGetActivePreset()] || _DASH_DEFAULT_LAYOUT).map(c => ({ ...c }));
    _dashSaveLayout(cells);
    _dashMountLayout();
    if (_dashCustomizeActive) _dashBindDragHandles();
}

// ── Add Widget picker (visual preview cards) ──────────────────────────────

function _dashOpenAddWidgetPicker() {
    if (document.getElementById('dash-add-widget-overlay')) return;

    const hidden = _dashHiddenWidgetIds();

    const overlay = document.createElement('div');
    overlay.className = 'dash-add-widget-overlay';
    overlay.id = 'dash-add-widget-overlay';

    // Build card HTML for each hidden widget
    const cards = hidden.map(id => {
        const w     = _dashWidgetRegistry[id];
        if (!w) return '';
        const label       = _dashT(w.labelKey || id) || id;
        const defaultTier = w.defaultSize || 'M';

        const tierButtons = Object.entries(_DASH_SIZE_TIERS).map(([tier, { w: gw, h: gh }]) => {
            const fits      = _dashGridHasRoom(null, gw, gh);
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
    }).join('') || `<div class="dash-empty" style="padding:var(--space-4)">All widgets are already on the dashboard.</div>`;

    overlay.innerHTML = `<div class="dash-add-widget-panel">
  <div class="dash-add-widget-head">
    <span class="dash-add-widget-title">Add Widget</span>
    <button class="dash-detail-close" id="dash-add-widget-close" type="button" aria-label="Close">×</button>
  </div>
  <div class="dash-add-widget-grid">${cards}</div>
</div>`;

    document.body.appendChild(overlay);

    // Render widget previews (S size, real data)
    hidden.forEach(id => {
        const widget    = _dashWidgetRegistry[id];
        const previewEl = document.getElementById(`dash-preview-${id}`);
        if (!widget || !previewEl || !window.DATA || !DATA.stats) return;
        try {
            widget.render(previewEl, 'S', DATA.stats);
        } catch (_) {
            previewEl.innerHTML = `<div class="dash-empty" style="font-size:11px;padding:8px;">${_dashEscape(id)}</div>`;
        }
    });

    // Track selected tier per card (default = defaultSize if fits, else first fitting, else null)
    const selectedTier = {};
    overlay.querySelectorAll('.dash-add-widget-card').forEach(card => {
        const widgetId = card.dataset.widgetId;
        const w        = _dashWidgetRegistry[widgetId];
        const defTier  = (w && w.defaultSize) || 'M';
        const { w: dw, h: dh } = _DASH_SIZE_TIERS[defTier] || _DASH_SIZE_TIERS.M;
        if (_dashGridHasRoom(null, dw, dh)) {
            selectedTier[widgetId] = defTier;
        } else {
            // Find first tier that fits
            const fit = Object.entries(_DASH_SIZE_TIERS).find(([, { w: gw, h: gh }]) =>
                _dashGridHasRoom(null, gw, gh));
            selectedTier[widgetId] = fit ? fit[0] : null;
        }

        // Size button clicks within this card
        card.querySelectorAll('.dash-size-btn:not([disabled])').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                card.querySelectorAll('.dash-size-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedTier[widgetId] = btn.dataset.tier;
            });
        });
    });

    // Add button clicks
    overlay.querySelectorAll('.dash-add-widget-add-btn:not([disabled])').forEach(btn => {
        btn.addEventListener('click', () => {
            const widgetId = btn.dataset.widgetId;
            const tier     = selectedTier[widgetId];
            if (!tier) return;
            _dashAddOptionalWidgetWithSize(widgetId, tier);
            overlay.remove();
            if (_dashCustomizeActive) _dashBindDragHandles();
        });
    });

    // Close handlers
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    overlay.querySelector('#dash-add-widget-close')
        ?.addEventListener('click', () => overlay.remove());
}
