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
let _dashSwapTarget = null;  // widget B currently being displaced
let _dashDragOffsetX = 0;
let _dashDragOffsetY = 0;

function _dashBindDragHandles() {
    const bento = document.getElementById('dashboard-bento');
    if (!bento) return;

    _dashApplyFloatAnimations();

    bento.querySelectorAll('.dash-widget-handle').forEach(handle => {
        handle.removeEventListener('pointerdown', _dashOnDown); // remove old if any
        handle.addEventListener('pointerdown', _dashOnDown, { passive: false });
    });
}

function _dashUnbindDragHandles() {
    const bento = document.getElementById('dashboard-bento');
    if (!bento) return;
    bento.querySelectorAll('.dash-widget-handle').forEach(handle => {
        handle.removeEventListener('pointerdown', _dashOnDown);
    });
}

// ── Pointer down: start drag ──────────────────────────────────────────────
function _dashOnDown(e) {
    if (!_dashCustomizeActive) return;
    e.preventDefault();
    _dashDragEl = e.currentTarget.closest('.dash-widget');
    if (!_dashDragEl) return;

    const rect = _dashDragEl.getBoundingClientRect();
    _dashDragOffsetX = e.clientX - rect.left;
    _dashDragOffsetY = e.clientY - rect.top;

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

    document.addEventListener('pointermove', _dashOnMove, { passive: false });
    document.addEventListener('pointerup',   _dashOnUp);
    document.addEventListener('pointercancel', _dashOnUp);
}

// ── Pointer move: update ghost + compute swap target ─────────────────────
function _dashOnMove(e) {
    if (!_dashDragGhost || !_dashDragEl) return;
    e.preventDefault();

    // Move ghost
    _dashDragGhost.style.left = (e.clientX - _dashDragOffsetX) + 'px';
    _dashDragGhost.style.top  = (e.clientY - _dashDragOffsetY) + 'px';

    // Find the widget under the cursor (excluding the dragged widget itself)
    const bento = document.getElementById('dashboard-bento');
    const under = _dashWidgetAtPoint(e.clientX, e.clientY, _dashDragEl, bento);

    if (under && under !== _dashSwapTarget) {
        // Clear previous swap target first
        _dashClearSwap(_dashSwapTarget);
        _dashSwapTarget = under;

        // Slide B towards A's current grid position
        const aRect = _dashDragEl.getBoundingClientRect();
        const bRect = _dashSwapTarget.getBoundingClientRect();
        const dx = aRect.left - bRect.left;
        const dy = aRect.top  - bRect.top;

        _dashSwapTarget.classList.add('dash-shifted-widget');
        _dashSwapTarget.style.animation = 'none';
        _dashSwapTarget.style.transform = `translate(${dx}px, ${dy}px)`;

    } else if (!under && _dashSwapTarget) {
        // Cursor left all widgets — slide B back
        _dashClearSwap(_dashSwapTarget);
        _dashSwapTarget = null;
    }
}

// ── Pointer up: commit swap and clean up ─────────────────────────────────
function _dashOnUp() {
    document.removeEventListener('pointermove', _dashOnMove);
    document.removeEventListener('pointerup',   _dashOnUp);
    document.removeEventListener('pointercancel', _dashOnUp);

    if (!_dashDragEl) return;

    if (_dashSwapTarget) {
        const aId = _dashDragEl.dataset.id;
        const bId = _dashSwapTarget.dataset.id;

        const cells = _dashLoadLayout();
        const aCell = cells.find(c => c.id === aId);
        const bCell = cells.find(c => c.id === bId);

        if (aCell && bCell) {
            // Swap grid positions only; each widget keeps its own size.
            // _dashReflowCells() resolves any resulting overlaps on mount.
            [aCell.col, bCell.col] = [bCell.col, aCell.col];
            [aCell.row, bCell.row] = [bCell.row, aCell.row];
            _dashSaveLayout(cells);
        }

        _dashClearSwap(_dashSwapTarget);
        _dashSwapTarget = null;
    }

    _dashDragGhost?.remove();
    _dashDragGhost = null;

    _dashDragEl.classList.remove('dash-dragging');
    _dashDragEl = null;

    // Rebuild grid and re-attach handles
    _dashMountLayout();
    if (typeof _dashCustomizeActive !== 'undefined' && _dashCustomizeActive) {
        _dashBindDragHandles();
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function _dashClearSwap(el) {
    if (!el) return;
    el.classList.remove('dash-shifted-widget');
    el.style.transform = '';
    el.style.animation = '';
}

// Returns the .dash-widget element whose bounding rect contains (cx, cy),
// excluding `exclude`. Returns null if none found.
function _dashWidgetAtPoint(cx, cy, exclude, bento) {
    if (!bento) return null;
    const widgets = bento.querySelectorAll('.dash-widget:not(.dash-dragging)');
    for (const w of widgets) {
        if (w === exclude) continue;
        const r = w.getBoundingClientRect();
        if (cx >= r.left && cx <= r.right && cy >= r.top && cy <= r.bottom) {
            return w;
        }
    }
    return null;
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
