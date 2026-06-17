const _DASH_COLS = 6;
const _DASH_ROWS = 3;
const _DASH_LS_TABS = "vizcode_dashboard_tabs";
const _DASH_DEFAULT_TAB_ID = "default";
const _DASH_DEFAULT_LAYOUT = [
  { id: "code_health", col: 0, row: 0, w: 2, h: 2 },
  { id: "commit_heatmap", col: 2, row: 0, w: 2, h: 1 },
  { id: "overview", col: 4, row: 0, w: 2, h: 2 },
  { id: "churn_timeline", col: 2, row: 1, w: 2, h: 2 },
  { id: "coupling", col: 0, row: 2, w: 2, h: 1 },
  { id: "tech_debt", col: 4, row: 2, w: 1, h: 1 },
  { id: "issues", col: 5, row: 2, w: 1, h: 1 }
];
const _DASH_OPTIONAL_IDS = ["kpi_files", "kpi_functions", "kpi_lines", "complexity", "duplication", "dead_code", "circular_deps", "entry_points", "structure", "graph_intelligence", "health_trend", "bus_factor", "branch_overview", "security"];
const _DASH_SIZE_TIERS = {
  S: { w: 1, h: 1 },
  M: { w: 2, h: 1 },
  L: { w: 2, h: 2 }
};
const _dashWidgetRegistry = {};
function _dashRegisterWidget(descriptor) {
  if (!descriptor || !descriptor.id) return;
  _dashWidgetRegistry[descriptor.id] = descriptor;
  console.log("[dash] registered widget:", descriptor.id);
}
function _dashWidgetSizeTier(widgetId, tier) {
  const widget = _dashWidgetRegistry[widgetId];
  const tiers = widget && widget.sizeTiers || _DASH_SIZE_TIERS;
  return tiers[tier] || _DASH_SIZE_TIERS[tier] || _DASH_SIZE_TIERS.M;
}
function _dashCloneLayout(cells) {
  return (Array.isArray(cells) ? cells : []).map((c) => ({
    id: String(c.id || ""),
    col: Number(c.col) || 0,
    row: Number(c.row) || 0,
    w: Number(c.w) || 1,
    h: Number(c.h) || 1
  })).filter((c) => c.id);
}
function _dashDefaultLayout() {
  return _DASH_DEFAULT_LAYOUT.map((c) => ({ ...c }));
}
function _dashDefaultTab(layout) {
  return {
    id: _DASH_DEFAULT_TAB_ID,
    name: "Default",
    locked: true,
    layout: Array.isArray(layout) ? _dashCloneLayout(layout) : _dashDefaultLayout()
  };
}
function _dashTabsDefaultState() {
  return {
    activeTabId: _DASH_DEFAULT_TAB_ID,
    tabs: [_dashDefaultTab()]
  };
}
function _dashNormalizeTabsState(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.tabs)) {
    return _dashTabsDefaultState();
  }
  const seen = /* @__PURE__ */ new Set();
  const tabs = [];
  let defaultLayout = null;
  raw.tabs.forEach((tab) => {
    if (!tab || typeof tab.id !== "string") return;
    const isDefault = tab.id === _DASH_DEFAULT_TAB_ID || tab.locked === true;
    const normalizedId = isDefault ? _DASH_DEFAULT_TAB_ID : tab.id;
    if (seen.has(normalizedId)) return;
    const name = isDefault ? "Default" : String(tab.name || "").trim();
    if (!isDefault && !name) return;
    seen.add(normalizedId);
    if (isDefault) {
      defaultLayout = Array.isArray(tab.layout) ? _dashCloneLayout(tab.layout) : _dashDefaultLayout();
      tabs.push(_dashDefaultTab(defaultLayout));
      return;
    }
    tabs.push({
      id: tab.id,
      name,
      locked: false,
      layout: Array.isArray(tab.layout) ? _dashCloneLayout(tab.layout) : []
    });
  });
  if (!seen.has(_DASH_DEFAULT_TAB_ID)) tabs.unshift(_dashDefaultTab(defaultLayout));
  const validIds = new Set(tabs.map((tab) => tab.id));
  return {
    activeTabId: validIds.has(raw.activeTabId) ? raw.activeTabId : _DASH_DEFAULT_TAB_ID,
    tabs
  };
}
function _dashLoadTabsState() {
  try {
    const raw = localStorage.getItem(_DASH_LS_TABS);
    if (raw) return _dashNormalizeTabsState(JSON.parse(raw));
  } catch (_) {
  }
  return _dashTabsDefaultState();
}
function _dashSaveTabsState(state) {
  const normalized = _dashNormalizeTabsState(state);
  try {
    localStorage.setItem(_DASH_LS_TABS, JSON.stringify(normalized));
  } catch (_) {
  }
  return normalized;
}
function _dashGetActiveTab(state) {
  const cfg = state || _dashLoadTabsState();
  return cfg.tabs.find((tab) => tab.id === cfg.activeTabId) || cfg.tabs[0];
}
function _dashActiveTabEditable(state) {
  const active = _dashGetActiveTab(state);
  return !!active && !active.locked;
}
function _dashLoadLayout() {
  const active = _dashGetActiveTab();
  return _dashCloneLayout(active ? active.layout : _dashDefaultLayout());
}
function _dashSaveLayout(cells) {
  const state = _dashLoadTabsState();
  const active = _dashGetActiveTab(state);
  if (active && active.locked) return;
  if (active) active.layout = _dashCloneLayout(cells);
  _dashSaveTabsState(state);
}
function _dashSwitchTab(tabId) {
  const state = _dashLoadTabsState();
  if (!state.tabs.some((tab) => tab.id === tabId)) return;
  if (typeof _dashExitCustomize === "function" && typeof _dashCustomizeActive !== "undefined" && _dashCustomizeActive && _dashExitCustomize() === false) return;
  state.activeTabId = tabId;
  _dashSaveTabsState(state);
  if (typeof _dashRenderTabBar === "function") _dashRenderTabBar();
  _dashMountLayout();
  if (typeof _dashSyncCustomizeButton === "function") _dashSyncCustomizeButton();
}
function _dashNextCustomName(tabs) {
  const used = new Set(tabs.map((tab) => tab.name));
  let n = 1;
  while (used.has(`Custom ${n}`)) n += 1;
  return `Custom ${n}`;
}
function _dashAddTab() {
  const state = _dashLoadTabsState();
  const tab = {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: _dashNextCustomName(state.tabs),
    locked: false,
    layout: []
  };
  state.tabs.push(tab);
  state.activeTabId = tab.id;
  _dashSaveTabsState(state);
  if (typeof _dashRenderTabBar === "function") _dashRenderTabBar();
  _dashMountLayout();
  if (typeof _dashEnterCustomize === "function") _dashEnterCustomize();
}
function _dashRenameTab(tabId, name) {
  const state = _dashLoadTabsState();
  const tab = state.tabs.find((t) => t.id === tabId);
  const next = String(name || "").trim();
  if (!tab || tab.locked || !next) return;
  tab.name = next;
  _dashSaveTabsState(state);
  if (typeof _dashRenderTabBar === "function") _dashRenderTabBar();
}
function _dashDeleteTab(tabId) {
  const state = _dashLoadTabsState();
  const tab = state.tabs.find((t) => t.id === tabId);
  if (!tab || tab.locked) return;
  state.tabs = state.tabs.filter((t) => t.id !== tabId);
  if (state.activeTabId === tabId) state.activeTabId = _DASH_DEFAULT_TAB_ID;
  _dashSaveTabsState(state);
  if (typeof _dashExitCustomize === "function" && typeof _dashCustomizeActive !== "undefined" && _dashCustomizeActive) _dashExitCustomize();
  if (typeof _dashRenderTabBar === "function") _dashRenderTabBar();
  _dashMountLayout();
}
function _dashReorderTabs(orderedIds) {
  const state = _dashLoadTabsState();
  if (!Array.isArray(orderedIds) || orderedIds.length === 0) return;
  const tabMap = new Map(state.tabs.map((tab) => [tab.id, tab]));
  const used = /* @__PURE__ */ new Set();
  const nextTabs = [];
  orderedIds.forEach((id) => {
    const tab = tabMap.get(id);
    if (!tab || used.has(id)) return;
    nextTabs.push(tab);
    used.add(id);
  });
  state.tabs.forEach((tab) => {
    if (!used.has(tab.id)) nextTabs.push(tab);
  });
  if (nextTabs.length !== state.tabs.length) return;
  state.tabs = nextTabs;
  _dashSaveTabsState(state);
  if (typeof _dashRenderTabBar === "function") _dashRenderTabBar();
}
function _dashResetActiveTabLayout() {
  const state = _dashLoadTabsState();
  const active = _dashGetActiveTab(state);
  if (!active) return;
  active.layout = active.locked ? _dashDefaultLayout() : [];
  _dashSaveTabsState(state);
  _dashMountLayout();
  if (typeof _dashCustomizeActive !== "undefined" && _dashCustomizeActive) _dashBindDragHandles();
}
function _dashAllWidgetIds() {
  const ordered = [
    ..._DASH_DEFAULT_LAYOUT.map((c) => c.id),
    ..._DASH_OPTIONAL_IDS,
    ...Object.entries(_dashWidgetRegistry).filter(([, widget]) => !widget.deprecated).map(([id]) => id)
  ];
  const result = [...new Set(ordered)].filter((id) => {
    const widget = _dashWidgetRegistry[id];
    return widget && !widget.deprecated;
  });
  console.log("[dash] _dashAllWidgetIds =", result);
  return result;
}
function _dashGridHasRoom(excludeId, w, h) {
  const cells = _dashLoadLayout();
  const grid = {};
  for (const c of _dashReflowCells(cells.filter((c2) => c2.id !== excludeId))) {
    _dashOccupy(grid, c.col, c.row, c.w, c.h, c.id);
  }
  return _dashFindFreeSlot(grid, w, h) !== null;
}
function _dashAddOptionalWidgetWithSize(widgetId, tier) {
  const cells = _dashLoadLayout();
  if (cells.some((c) => c.id === widgetId)) return;
  const { w, h } = _dashWidgetSizeTier(widgetId, tier);
  console.log("[dash] _dashAddOptionalWidgetWithSize", widgetId, tier, "\u2192 size", w, "x", h);
  const grid = {};
  for (const c of _dashReflowCells(cells)) _dashOccupy(grid, c.col, c.row, c.w, c.h, c.id);
  const slot = _dashFindFreeSlot(grid, w, h);
  console.log("[dash] found slot:", slot);
  if (!slot) {
    console.warn("[dash] no free slot for", widgetId, w + "x" + h, "\u2014 widget NOT added");
    return;
  }
  cells.push({ id: widgetId, col: slot.col, row: slot.row, w, h });
  _dashSaveLayout(cells);
  _dashMountLayout();
}
function _dashFindFreeSlot(grid, w, h) {
  for (let r = 0; r <= _DASH_ROWS - h; r++) {
    for (let c = 0; c <= _DASH_COLS - w; c++) {
      if (_dashFits(grid, c, r, w, h)) return { col: c, row: r };
    }
  }
  return null;
}
function _dashFits(grid, col, row, w, h) {
  if (col < 0 || row < 0 || col + w > _DASH_COLS || row + h > _DASH_ROWS) return false;
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
function _dashCellIndex(col, row) {
  return row * _DASH_COLS + col;
}
function _dashNormalizeReflowCell(cell, index) {
  const w = Math.max(1, Math.min(_DASH_COLS, Number(cell.w) || 1));
  const h = Math.max(1, Math.min(_DASH_ROWS, Number(cell.h) || 1));
  const maxCol = Math.max(0, _DASH_COLS - w);
  const maxRow = Math.max(0, _DASH_ROWS - h);
  return {
    ...cell,
    id: String(cell.id || ""),
    col: Math.max(0, Math.min(maxCol, Number(cell.col) || 0)),
    row: Math.max(0, Math.min(maxRow, Number(cell.row) || 0)),
    w,
    h,
    _dashOrder: index
  };
}
function _dashCleanReflowCell(cell) {
  const out = { ...cell };
  delete out._dashOrder;
  delete out._dashPreferredCol;
  delete out._dashPreferredRow;
  return out;
}
function _dashGreedyPackCells(cells, flow) {
  const grid = {};
  const out = [];
  for (const cell of cells) {
    if (!flow && _dashFits(grid, cell.col, cell.row, cell.w, cell.h)) {
      _dashOccupy(grid, cell.col, cell.row, cell.w, cell.h, cell.id);
      out.push({ ...cell });
    } else {
      const prefCol = Number.isFinite(cell._dashPreferredCol) ? cell._dashPreferredCol : cell.col;
      const prefRow = Number.isFinite(cell._dashPreferredRow) ? cell._dashPreferredRow : cell.row;
      const slot = flow && _dashFits(grid, prefCol, prefRow, cell.w, cell.h) ? { col: prefCol, row: prefRow } : _dashFindFreeSlot(grid, cell.w, cell.h);
      if (slot) {
        _dashOccupy(grid, slot.col, slot.row, cell.w, cell.h, cell.id);
        out.push({ ...cell, col: slot.col, row: slot.row });
      }
    }
  }
  return out;
}
function _dashCandidateSlots(cell, flow) {
  const seen = /* @__PURE__ */ new Set();
  const slots = [];
  const preferredCol = Number.isFinite(cell._dashPreferredCol) ? cell._dashPreferredCol : cell.col;
  const preferredRow = Number.isFinite(cell._dashPreferredRow) ? cell._dashPreferredRow : cell.row;
  const add = (col, row) => {
    if (col < 0 || row < 0 || col + cell.w > _DASH_COLS || row + cell.h > _DASH_ROWS) return;
    const key = `${col},${row}`;
    if (seen.has(key)) return;
    seen.add(key);
    slots.push({ col, row });
  };
  add(preferredCol, preferredRow);
  const all = [];
  for (let row = 0; row <= _DASH_ROWS - cell.h; row++) {
    for (let col = 0; col <= _DASH_COLS - cell.w; col++) {
      all.push({
        col,
        row,
        dist: Math.abs(col - preferredCol) + Math.abs(row - preferredRow),
        index: _dashCellIndex(col, row)
      });
    }
  }
  all.sort((a, b) => flow ? a.index - b.index : a.dist !== b.dist ? a.dist - b.dist : a.index - b.index);
  all.forEach((slot) => add(slot.col, slot.row));
  return slots;
}
function _dashExactPackCells(cells, flow) {
  const result = [];
  function placeAt(index, grid) {
    if (index >= cells.length) return true;
    const cell = cells[index];
    for (const slot of _dashCandidateSlots(cell, flow)) {
      if (!_dashFits(grid, slot.col, slot.row, cell.w, cell.h)) continue;
      const nextGrid = {};
      Object.keys(grid).forEach((row) => {
        nextGrid[row] = { ...grid[row] };
      });
      _dashOccupy(nextGrid, slot.col, slot.row, cell.w, cell.h, cell.id);
      result[index] = { ...cell, col: slot.col, row: slot.row };
      if (placeAt(index + 1, nextGrid)) return true;
    }
    result.length = index;
    return false;
  }
  return placeAt(0, {}) ? result : null;
}
function _dashReflowCells(cells, options) {
  const keepOrder = !!(options && options.keepOrder);
  const flow = !!(options && options.flow);
  const normalized = (Array.isArray(cells) ? cells : []).map(_dashNormalizeReflowCell).filter((c) => c.id);
  const ordered = keepOrder ? normalized : [...normalized].sort((a, b) => {
    if (a.row !== b.row) return a.row - b.row;
    if (a.col !== b.col) return a.col - b.col;
    return a._dashOrder - b._dashOrder;
  });
  const greedy = _dashGreedyPackCells(ordered, flow);
  const totalArea = ordered.reduce((sum, c) => sum + c.w * c.h, 0);
  const packed = greedy.length === ordered.length || totalArea > _DASH_COLS * _DASH_ROWS ? greedy : _dashExactPackCells(ordered, flow) || greedy;
  return packed.map(_dashCleanReflowCell);
}
function _dashMountLayout() {
  const bento = document.getElementById("dashboard-bento");
  if (!bento) return;
  _dashDestroyAllCharts();
  bento.innerHTML = "";
  const cells = _dashReflowCells(_dashLoadLayout());
  for (const cell of cells) {
    const widget = _dashWidgetRegistry[cell.id];
    if (!widget) continue;
    if (!window.DATA || !DATA.stats) continue;
    const el = document.createElement("div");
    el.className = "dash-widget";
    el.dataset.id = cell.id;
    el.dataset.w = cell.w;
    el.dataset.h = cell.h;
    el.dataset.col = cell.col;
    el.dataset.row = cell.row;
    el.style.gridColumn = `${cell.col + 1} / span ${cell.w}`;
    el.style.gridRow = `${cell.row + 1} / span ${cell.h}`;
    el.innerHTML = '<span class="dash-widget-link-icon" aria-hidden="true">&#8599;</span>';
    el.innerHTML += `<button class="dash-widget-remove-btn" aria-label="Remove widget" type="button">\u2715</button>`;
    const tier = _dashSizeTierOf(cell.w, cell.h);
    el.innerHTML += `<div class="dash-widget-size-picker" aria-label="Resize widget">
  <button class="dash-size-btn ${tier === "S" ? "active" : ""}" data-tier="S" type="button">S</button>
  <button class="dash-size-btn ${tier === "M" ? "active" : ""}" data-tier="M" type="button">M</button>
  <button class="dash-size-btn ${tier === "L" ? "active" : ""}" data-tier="L" type="button">L</button>
</div>`;
    const content = document.createElement("div");
    content.style.cssText = "flex:1;min-height:0;overflow:hidden;display:flex;flex-direction:column;";
    el.appendChild(content);
    el.addEventListener("click", (e) => {
      if (document.body.classList.contains("dash-customize")) return;
      if (e.target.closest(".dash-widget-size-picker,.dash-size-btn,.dash-widget-remove-btn,.dash-chart-toggle,.dash-chart-toggle-btn")) return;
      const actionable = e.target.closest('[data-clickable="true"], [onclick], a[href]');
      if (!actionable || !el.contains(actionable)) return;
      e.preventDefault();
      e.stopPropagation();
      _dashOpenDetailPanel(cell.id, el.getBoundingClientRect());
    }, true);
    el.addEventListener("click", (e) => {
      if (document.body.classList.contains("dash-customize")) {
        if (e.target.closest(".dash-widget-remove-btn")) {
          e.stopPropagation();
          _dashRemoveWidget(cell.id);
        }
        return;
      }
      if (e.target.closest(".dash-widget-size-picker,.dash-size-btn,.dash-chart-toggle,.dash-chart-toggle-btn")) return;
      _dashOpenDetailPanel(cell.id, el.getBoundingClientRect());
    });
    bento.appendChild(el);
    try {
      const size = _dashWidgetSizeName(cell.w, cell.h);
      widget.render(content, size, DATA.stats);
    } catch (err) {
      console.error(`[dashboard] widget ${cell.id} failed:`, err);
      content.innerHTML = '<div class="dash-empty">Widget error</div>';
    }
  }
  if (typeof _dashAiPromptSyncIndicators === "function") {
    _dashAiPromptSyncIndicators();
  }
}
function _dashSizeTierOf(w, h) {
  if (w <= 1 && h <= 1) return "S";
  if (w <= 2 && h <= 1) return "M";
  return "L";
}
function _dashWidgetSizeName(w, h) {
  if (w <= 1 && h <= 1) return "S";
  if (w <= 2 && h <= 1) return "M";
  return "L";
}
function _dashRemoveWidget(widgetId) {
  const cells = _dashLoadLayout();
  const updated = cells.filter((c) => c.id !== widgetId);
  if (updated.length === cells.length) return;
  _dashSaveLayout(updated);
  _dashMountLayout();
  if (typeof _dashCustomizeActive !== "undefined" && _dashCustomizeActive) {
    if (typeof _dashBindDragHandles === "function") _dashBindDragHandles();
  }
}
function _dashAddOptionalWidget(widgetId) {
  const cells = _dashLoadLayout();
  if (cells.some((c) => c.id === widgetId)) return;
  const widget = _dashWidgetRegistry[widgetId];
  const tier = widget && widget.defaultSize || "M";
  const { w, h } = _dashWidgetSizeTier(widgetId, tier);
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
  const present = new Set(layout.map((c) => c.id));
  return _dashAllWidgetIds().filter((id) => !present.has(id));
}
