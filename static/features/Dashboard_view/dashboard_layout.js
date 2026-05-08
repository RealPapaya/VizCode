// @module Dashboard_view/dashboard_layout
// 6×3 bento grid model. Owns:
//   • Default layout definition
//   • localStorage persistence (vizcode.dashboard.layout / .added)
//   • Cell placement renderer
//   • Mount / unmount lifecycle

const _DASH_COLS = 6;
const _DASH_ROWS = 3;
const _DASH_LS_LAYOUT = 'vizcode.dashboard.layout';
const _DASH_LS_ADDED  = 'vizcode.dashboard.added';

// Default 6×3 arrangement (col/row are 0-indexed)
// Row 1: Files 1×1 | Functions 1×1 | Lines 1×1 | Health 3×1
// Row 2: CodeHealth gauge 2×2 | TechDebt 2×1 | Complexity 2×1
// Row 3: (bottom of 2×2) | MostComplex 3×1 | Duplication 1×1
const _DASH_DEFAULT_LAYOUT = [
    { id: 'kpi_files',      col: 0, row: 0, w: 1, h: 1 },
    { id: 'kpi_functions',  col: 1, row: 0, w: 1, h: 1 },
    { id: 'kpi_lines',      col: 2, row: 0, w: 1, h: 1 },
    { id: 'kpi_health',     col: 3, row: 0, w: 3, h: 1 },
    { id: 'code_health',    col: 0, row: 1, w: 2, h: 2 },
    { id: 'tech_debt',      col: 2, row: 1, w: 2, h: 1 },
    { id: 'complexity',     col: 4, row: 1, w: 2, h: 1 },
    { id: 'most_complex',   col: 2, row: 2, w: 3, h: 1 },
    { id: 'duplication',    col: 5, row: 2, w: 1, h: 1 },
];

// Optional widgets (not in default layout; available via + Add Widget)
const _DASH_OPTIONAL_IDS = ['dead_code', 'coupling', 'issues', 'structure', 'graph_intelligence', 'temporal'];

// Size tier definitions: S = small, M = medium, L = large
// Each tier is expressed as { w, h } in grid units
const _DASH_SIZE_TIERS = {
    S: { w: 1, h: 1 },
    M: { w: 2, h: 1 },
    L: { w: 2, h: 2 },
};

// Registry: id → widget descriptor (populated by each widget file calling _dashRegisterWidget)
const _dashWidgetRegistry = {};

function _dashRegisterWidget(descriptor) {
    if (!descriptor || !descriptor.id) return;
    _dashWidgetRegistry[descriptor.id] = descriptor;
}

// ── Layout persistence ────────────────────────────────────────────────────

function _dashLoadLayout() {
    try {
        const raw = localStorage.getItem(_DASH_LS_LAYOUT);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length) return parsed;
        }
    } catch (_) {}
    return _DASH_DEFAULT_LAYOUT.map(c => ({ ...c }));
}

function _dashSaveLayout(cells) {
    try {
        localStorage.setItem(_DASH_LS_LAYOUT, JSON.stringify(cells));
    } catch (_) {}
}

function _dashLoadAdded() {
    try {
        const raw = localStorage.getItem(_DASH_LS_ADDED);
        if (raw) return JSON.parse(raw);
    } catch (_) {}
    return [];
}

function _dashSaveAdded(ids) {
    try {
        localStorage.setItem(_DASH_LS_ADDED, JSON.stringify(ids));
    } catch (_) {}
}

// ── Preset system ─────────────────────────────────────────────────────────

const _DASH_LS_PRESETS       = 'vizcode.dashboard.presets';
const _DASH_LS_ACTIVE_PRESET = 'vizcode.dashboard.activePreset';

function _dashLoadPresets() {
    const builtins = { Default: _DASH_DEFAULT_LAYOUT.map(c => ({ ...c })) };
    try {
        const raw = localStorage.getItem(_DASH_LS_PRESETS);
        if (raw) return { ...builtins, ...JSON.parse(raw) };
    } catch (_) {}
    return builtins;
}

function _dashSavePreset(name, cells) {
    if (name === 'Default') return;
    const raw    = localStorage.getItem(_DASH_LS_PRESETS);
    const custom = raw ? JSON.parse(raw) : {};
    custom[name] = cells.map(c => ({ ...c }));
    localStorage.setItem(_DASH_LS_PRESETS, JSON.stringify(custom));
}

function _dashDeletePreset(name) {
    if (name === 'Default') return;
    const raw = localStorage.getItem(_DASH_LS_PRESETS);
    if (!raw) return;
    const custom = JSON.parse(raw);
    delete custom[name];
    localStorage.setItem(_DASH_LS_PRESETS, JSON.stringify(custom));
}

function _dashGetActivePreset() {
    return localStorage.getItem(_DASH_LS_ACTIVE_PRESET) || 'Default';
}

function _dashSetActivePreset(name) {
    localStorage.setItem(_DASH_LS_ACTIVE_PRESET, name);
}

function _dashApplyPreset(name) {
    const presets = _dashLoadPresets();
    if (!presets[name]) return;
    _dashSaveLayout(presets[name].map(c => ({ ...c })));
    _dashSetActivePreset(name);
    _dashMountLayout();
}

// ── Grid capacity helpers ─────────────────────────────────────────────────

// Returns true if a (w×h) block fits in the current grid.
// excludeId: widget id whose current cells are excluded from the occupancy check.
function _dashGridHasRoom(excludeId, w, h) {
    const cells = _dashLoadLayout();
    const grid  = {};
    for (const c of _dashReflowCells(cells.filter(c => c.id !== excludeId))) {
        _dashOccupy(grid, c.col, c.row, c.w, c.h, c.id);
    }
    return _dashFindFreeSlot(grid, w, h) !== null;
}

// Like _dashAddOptionalWidget but accepts an explicit size tier.
function _dashAddOptionalWidgetWithSize(widgetId, tier) {
    const cells = _dashLoadLayout();
    if (cells.some(c => c.id === widgetId)) return;
    const { w, h } = _DASH_SIZE_TIERS[tier] || _DASH_SIZE_TIERS.M;
    const grid = {};
    for (const c of _dashReflowCells(cells)) _dashOccupy(grid, c.col, c.row, c.w, c.h, c.id);
    const slot = _dashFindFreeSlot(grid, w, h);
    if (!slot) return;
    cells.push({ id: widgetId, col: slot.col, row: slot.row, w, h });
    _dashSaveLayout(cells);
    const added = _dashLoadAdded();
    if (!added.includes(widgetId)) added.push(widgetId);
    _dashSaveAdded(added);
    _dashMountLayout();
}

// ── Reflow / collision resolver ───────────────────────────────────────────

function _dashFindFreeSlot(grid, w, h) {
    for (let r = 0; r <= _DASH_ROWS - h; r++) {
        for (let c = 0; c <= _DASH_COLS - w; c++) {
            if (_dashFits(grid, c, r, w, h)) return { col: c, row: r };
        }
    }
    return null;
}

function _dashFits(grid, col, row, w, h) {
    for (let r = row; r < row + h; r++) {
        for (let c = col; c < col + w; c++) {
            if (grid[r] && grid[r][c]) return false;
        }
    }
    return true;
}

function _dashOccupy(grid, col, row, w, h, id) {
    for (let r = row; r < row + h; r++) {
        if (!grid[r]) grid[r] = {};
        for (let c = col; c < col + w; c++) grid[r][c] = id;
    }
}

// Re-pack cells to ensure no overlaps, returns a new clean array.
function _dashReflowCells(cells) {
    const grid = {};
    const out  = [];
    // Sort by row then col to maintain visual order
    const sorted = [...cells].sort((a, b) => a.row !== b.row ? a.row - b.row : a.col - b.col);
    for (const cell of sorted) {
        if (_dashFits(grid, cell.col, cell.row, cell.w, cell.h)) {
            _dashOccupy(grid, cell.col, cell.row, cell.w, cell.h, cell.id);
            out.push({ ...cell });
        } else {
            // Try to find a free slot
            const slot = _dashFindFreeSlot(grid, cell.w, cell.h);
            if (slot) {
                _dashOccupy(grid, slot.col, slot.row, cell.w, cell.h, cell.id);
                out.push({ ...cell, col: slot.col, row: slot.row });
            }
            // Skip if no slot found (widget simply doesn't render)
        }
    }
    return out;
}

// ── Mount ─────────────────────────────────────────────────────────────────

function _dashMountLayout() {
    const bento = document.getElementById('dashboard-bento');
    if (!bento) return;

    _dashDestroyAllCharts();
    bento.innerHTML = '';

    const cells = _dashReflowCells(_dashLoadLayout());

    for (const cell of cells) {
        const widget = _dashWidgetRegistry[cell.id];
        if (!widget) continue;
        if (!window.DATA || !DATA.stats) continue;

        const el = document.createElement('div');
        el.className  = 'dash-widget';
        el.dataset.id = cell.id;
        el.dataset.w  = cell.w;
        el.dataset.h  = cell.h;
        el.dataset.col = cell.col;
        el.dataset.row = cell.row;

        el.style.gridColumn = `${cell.col + 1} / span ${cell.w}`;
        el.style.gridRow    = `${cell.row + 1} / span ${cell.h}`;

        // ↗ hover icon
        el.innerHTML = '<span class="dash-widget-link-icon" aria-hidden="true">↗</span>';

        // Drag handle (shown only in customize mode)
        el.innerHTML += '<span class="dash-widget-handle" aria-hidden="true">⠿</span>';

        // Size picker (customize mode)
        const tier = _dashSizeTierOf(cell.w, cell.h);
        el.innerHTML += `<div class="dash-widget-size-picker" aria-label="Resize widget">
  <button class="dash-size-btn ${tier === 'S' ? 'active' : ''}" data-tier="S" type="button">S</button>
  <button class="dash-size-btn ${tier === 'M' ? 'active' : ''}" data-tier="M" type="button">M</button>
  <button class="dash-size-btn ${tier === 'L' ? 'active' : ''}" data-tier="L" type="button">L</button>
</div>`;

        // Content container
        const content = document.createElement('div');
        content.style.cssText = 'flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;';

        try {
            const size = _dashWidgetSizeName(cell.w, cell.h);
            widget.render(content, size, DATA.stats);
        } catch (err) {
            console.error(`[dashboard] widget ${cell.id} failed:`, err);
            content.innerHTML = `<div class="dash-empty">⚠ widget error</div>`;
        }

        el.appendChild(content);

        // Click → detail panel (only when not in customize mode)
        el.addEventListener('click', e => {
            if (document.body.classList.contains('dash-customize')) return;
            if (e.target.closest('.dash-widget-handle,.dash-widget-size-picker,.dash-size-btn')) return;
            _dashOpenDetailPanel(cell.id, el.getBoundingClientRect());
        });

        bento.appendChild(el);
    }
}

function _dashSizeTierOf(w, h) {
    if (w <= 1 && h <= 1) return 'S';
    if (w <= 2 && h <= 1) return 'M';
    return 'L';
}

function _dashWidgetSizeName(w, h) {
    if (w <= 1 && h <= 1) return 'S';
    if (w <= 2 && h <= 1) return 'M';
    return 'L';
}

// ── Add / Remove optional widgets ─────────────────────────────────────────

function _dashAddOptionalWidget(widgetId) {
    const cells = _dashLoadLayout();
    if (cells.some(c => c.id === widgetId)) return; // already present

    const widget = _dashWidgetRegistry[widgetId];
    const tier   = (widget && widget.defaultSize) || 'M';
    const { w, h } = _DASH_SIZE_TIERS[tier] || _DASH_SIZE_TIERS.M;

    const grid = {};
    for (const c of _dashReflowCells(cells)) {
        _dashOccupy(grid, c.col, c.row, c.w, c.h, c.id);
    }
    const slot = _dashFindFreeSlot(grid, w, h);
    if (!slot) return; // no room

    cells.push({ id: widgetId, col: slot.col, row: slot.row, w, h });
    _dashSaveLayout(cells);

    const added = _dashLoadAdded();
    if (!added.includes(widgetId)) added.push(widgetId);
    _dashSaveAdded(added);

    _dashMountLayout();
}

function _dashHiddenWidgetIds() {
    const layout = _dashLoadLayout();
    const present = new Set(layout.map(c => c.id));
    return _DASH_OPTIONAL_IDS.filter(id => !present.has(id));
}
