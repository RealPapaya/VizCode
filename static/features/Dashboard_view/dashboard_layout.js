// @module Dashboard_view/dashboard_layout
// 6x3 bento grid model. Owns:
//   - Default layout definition
//   - Browser-style dashboard tabs and localStorage persistence
//   - Cell placement renderer
//   - Mount / unmount lifecycle

const _DASH_COLS = 6;
const _DASH_ROWS = 3;
const _DASH_LS_TABS = 'vizcode_dashboard_tabs';
const _DASH_DEFAULT_TAB_ID = 'default';

// Default 6x3 arrangement (col/row are 0-indexed)
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
const _DASH_SIZE_TIERS = {
    S: { w: 1, h: 1 },
    M: { w: 2, h: 1 },
    L: { w: 2, h: 2 },
};

// Registry: id -> widget descriptor (populated by each widget file calling _dashRegisterWidget)
const _dashWidgetRegistry = {};

function _dashRegisterWidget(descriptor) {
    if (!descriptor || !descriptor.id) return;
    _dashWidgetRegistry[descriptor.id] = descriptor;
}

// -- Tab and layout persistence ------------------------------------------------

function _dashCloneLayout(cells) {
    return (Array.isArray(cells) ? cells : []).map(c => ({
        id:  String(c.id || ''),
        col: Number(c.col) || 0,
        row: Number(c.row) || 0,
        w:   Number(c.w)   || 1,
        h:   Number(c.h)   || 1,
    })).filter(c => c.id);
}

function _dashDefaultLayout() {
    return _DASH_DEFAULT_LAYOUT.map(c => ({ ...c }));
}

function _dashDefaultTab(layout) {
    return {
        id:     _DASH_DEFAULT_TAB_ID,
        name:   'Default',
        locked: true,
        layout: Array.isArray(layout) ? _dashCloneLayout(layout) : _dashDefaultLayout(),
    };
}

function _dashTabsDefaultState() {
    return {
        activeTabId: _DASH_DEFAULT_TAB_ID,
        tabs:        [_dashDefaultTab()],
    };
}

function _dashNormalizeTabsState(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.tabs)) {
        return _dashTabsDefaultState();
    }

    const seen = new Set();
    const customTabs = [];
    let defaultLayout = null;

    raw.tabs.forEach(tab => {
        if (!tab || typeof tab.id !== 'string' || seen.has(tab.id)) return;
        const isDefault = tab.id === _DASH_DEFAULT_TAB_ID || tab.locked === true;
        const name = isDefault ? 'Default' : String(tab.name || '').trim();
        if (!isDefault && !name) return;

        seen.add(tab.id);
        if (isDefault) {
            defaultLayout = Array.isArray(tab.layout) ? _dashCloneLayout(tab.layout) : _dashDefaultLayout();
            return;
        }

        customTabs.push({
            id:     tab.id,
            name,
            locked: false,
            layout: Array.isArray(tab.layout) ? _dashCloneLayout(tab.layout) : [],
        });
    });

    const tabs = [_dashDefaultTab(defaultLayout), ...customTabs];
    const validIds = new Set(tabs.map(tab => tab.id));
    return {
        activeTabId: validIds.has(raw.activeTabId) ? raw.activeTabId : _DASH_DEFAULT_TAB_ID,
        tabs,
    };
}

function _dashLoadTabsState() {
    try {
        const raw = localStorage.getItem(_DASH_LS_TABS);
        if (raw) return _dashNormalizeTabsState(JSON.parse(raw));
    } catch (_) {}
    return _dashTabsDefaultState();
}

function _dashSaveTabsState(state) {
    const normalized = _dashNormalizeTabsState(state);
    try {
        localStorage.setItem(_DASH_LS_TABS, JSON.stringify(normalized));
    } catch (_) {}
    return normalized;
}

function _dashGetActiveTab(state) {
    const cfg = state || _dashLoadTabsState();
    return cfg.tabs.find(tab => tab.id === cfg.activeTabId) || cfg.tabs[0];
}

function _dashLoadLayout() {
    const active = _dashGetActiveTab();
    return _dashCloneLayout(active ? active.layout : _dashDefaultLayout());
}

function _dashSaveLayout(cells) {
    const state = _dashLoadTabsState();
    const active = _dashGetActiveTab(state);
    if (active) active.layout = _dashCloneLayout(cells);
    _dashSaveTabsState(state);
}

function _dashSwitchTab(tabId) {
    const state = _dashLoadTabsState();
    if (!state.tabs.some(tab => tab.id === tabId)) return;
    if (typeof _dashExitCustomize === 'function' &&
        typeof _dashCustomizeActive !== 'undefined' &&
        _dashCustomizeActive &&
        _dashExitCustomize() === false) return;
    state.activeTabId = tabId;
    _dashSaveTabsState(state);
    if (typeof _dashRenderTabBar === 'function') _dashRenderTabBar();
    _dashMountLayout();
}

function _dashNextCustomName(tabs) {
    const used = new Set(tabs.map(tab => tab.name));
    let n = 1;
    while (used.has(`Custom ${n}`)) n += 1;
    return `Custom ${n}`;
}

function _dashAddTab() {
    const state = _dashLoadTabsState();
    const tab = {
        id:     `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name:   _dashNextCustomName(state.tabs),
        locked: false,
        layout: [],
    };
    state.tabs.push(tab);
    state.activeTabId = tab.id;
    _dashSaveTabsState(state);
    if (typeof _dashRenderTabBar === 'function') _dashRenderTabBar();
    _dashMountLayout();
    if (typeof _dashEnterCustomize === 'function') _dashEnterCustomize();
}

function _dashRenameTab(tabId, name) {
    const state = _dashLoadTabsState();
    const tab = state.tabs.find(t => t.id === tabId);
    const next = String(name || '').trim();
    if (!tab || tab.locked || !next) return;
    tab.name = next;
    _dashSaveTabsState(state);
    if (typeof _dashRenderTabBar === 'function') _dashRenderTabBar();
}

function _dashDeleteTab(tabId) {
    const state = _dashLoadTabsState();
    const tab = state.tabs.find(t => t.id === tabId);
    if (!tab || tab.locked) return;

    state.tabs = state.tabs.filter(t => t.id !== tabId);
    if (state.activeTabId === tabId) state.activeTabId = _DASH_DEFAULT_TAB_ID;
    _dashSaveTabsState(state);
    if (typeof _dashExitCustomize === 'function' && typeof _dashCustomizeActive !== 'undefined' && _dashCustomizeActive) _dashExitCustomize();
    if (typeof _dashRenderTabBar === 'function') _dashRenderTabBar();
    _dashMountLayout();
}

function _dashResetActiveTabLayout() {
    const state = _dashLoadTabsState();
    const active = _dashGetActiveTab(state);
    if (!active) return;
    active.layout = active.locked ? _dashDefaultLayout() : [];
    _dashSaveTabsState(state);
    _dashMountLayout();
    if (typeof _dashCustomizeActive !== 'undefined' && _dashCustomizeActive) _dashBindDragHandles();
}

function _dashAllWidgetIds() {
    const ordered = [
        ..._DASH_DEFAULT_LAYOUT.map(c => c.id),
        ..._DASH_OPTIONAL_IDS,
        ...Object.keys(_dashWidgetRegistry),
    ];
    return [...new Set(ordered)].filter(id => _dashWidgetRegistry[id]);
}

// -- Grid capacity helpers -----------------------------------------------------

// Returns true if a (w x h) block fits in the current grid.
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
    _dashMountLayout();
}

// -- Reflow / collision resolver ----------------------------------------------

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
    const sorted = [...cells].sort((a, b) => a.row !== b.row ? a.row - b.row : a.col - b.col);
    for (const cell of sorted) {
        if (_dashFits(grid, cell.col, cell.row, cell.w, cell.h)) {
            _dashOccupy(grid, cell.col, cell.row, cell.w, cell.h, cell.id);
            out.push({ ...cell });
        } else {
            const slot = _dashFindFreeSlot(grid, cell.w, cell.h);
            if (slot) {
                _dashOccupy(grid, slot.col, slot.row, cell.w, cell.h, cell.id);
                out.push({ ...cell, col: slot.col, row: slot.row });
            }
        }
    }
    return out;
}

// -- Mount ---------------------------------------------------------------------

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

        el.innerHTML = '<span class="dash-widget-link-icon" aria-hidden="true">&#8599;</span>';
        el.innerHTML += '<span class="dash-widget-handle" aria-hidden="true">::</span>';

        const tier = _dashSizeTierOf(cell.w, cell.h);
        el.innerHTML += `<div class="dash-widget-size-picker" aria-label="Resize widget">
  <button class="dash-size-btn ${tier === 'S' ? 'active' : ''}" data-tier="S" type="button">S</button>
  <button class="dash-size-btn ${tier === 'M' ? 'active' : ''}" data-tier="M" type="button">M</button>
  <button class="dash-size-btn ${tier === 'L' ? 'active' : ''}" data-tier="L" type="button">L</button>
</div>`;

        const content = document.createElement('div');
        content.style.cssText = 'flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;';

        try {
            const size = _dashWidgetSizeName(cell.w, cell.h);
            widget.render(content, size, DATA.stats);
        } catch (err) {
            console.error(`[dashboard] widget ${cell.id} failed:`, err);
            content.innerHTML = '<div class="dash-empty">Widget error</div>';
        }

        el.appendChild(content);

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

// -- Add / Remove optional widgets --------------------------------------------

function _dashAddOptionalWidget(widgetId) {
    const cells = _dashLoadLayout();
    if (cells.some(c => c.id === widgetId)) return;

    const widget = _dashWidgetRegistry[widgetId];
    const tier   = (widget && widget.defaultSize) || 'M';
    const { w, h } = _DASH_SIZE_TIERS[tier] || _DASH_SIZE_TIERS.M;

    const grid = {};
    for (const c of _dashReflowCells(cells)) {
        _dashOccupy(grid, c.col, c.row, c.w, c.h, c.id);
    }
    const slot = _dashFindFreeSlot(grid, w, h);
    if (!slot) return;

    cells.push({ id: widgetId, col: slot.col, row: slot.row, w, h });
    _dashSaveLayout(cells);
    _dashMountLayout();
}

function _dashHiddenWidgetIds() {
    const layout = _dashLoadLayout();
    const present = new Set(layout.map(c => c.id));
    return _dashAllWidgetIds().filter(id => !present.has(id));
}
