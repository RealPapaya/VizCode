const _DASH_CONFIG_DEFAULTS = {
  custom_tabs: [],
  active_tab: "system",
  git_window_days: 180
};
let _dashConfig = null;
function _dashConfigDefault() {
  return JSON.parse(JSON.stringify(_DASH_CONFIG_DEFAULTS));
}
function _dashConfigCurrent() {
  if (!_dashConfig) _dashConfig = _dashConfigDefault();
  return _dashConfig;
}
function _dashConfigMerge(loaded) {
  const cfg = _dashConfigDefault();
  if (!loaded || typeof loaded !== "object") return cfg;
  if (Array.isArray(loaded.custom_tabs)) {
    const knownWidgets = new Set(
      typeof _DASH_ALL_WIDGETS !== "undefined" ? _DASH_ALL_WIDGETS.map((s) => s.widget) : []
    );
    cfg.custom_tabs = loaded.custom_tabs.filter((t) => t && typeof t.id === "string" && typeof t.name === "string").map((t) => {
      const rawOrder = Array.isArray(t.widget_order) ? t.widget_order : [];
      const order = knownWidgets.size ? rawOrder.filter((k) => knownWidgets.has(k)) : rawOrder;
      return {
        id: t.id,
        name: t.name,
        widget_order: order.length ? order : knownWidgets.size ? [...knownWidgets] : [],
        widget_visible: t.widget_visible && typeof t.widget_visible === "object" ? t.widget_visible : {}
      };
    });
  }
  if (typeof loaded.active_tab === "string") {
    const validIds = /* @__PURE__ */ new Set(["system", ...cfg.custom_tabs.map((t) => t.id)]);
    cfg.active_tab = validIds.has(loaded.active_tab) ? loaded.active_tab : "system";
  }
  if (Number.isFinite(loaded.git_window_days)) {
    cfg.git_window_days = Math.max(7, Math.min(3650, loaded.git_window_days));
  }
  return cfg;
}
async function _dashLoadConfig() {
  const jid = window.JOB_ID || "";
  try {
    const url = "/dashboard-config" + (jid ? `?job=${encodeURIComponent(jid)}` : "");
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const loaded = await resp.json();
    _dashConfig = _dashConfigMerge(loaded);
  } catch (_) {
    _dashConfig = _dashConfigDefault();
  }
  return _dashConfig;
}
async function _dashSaveConfig(cfg) {
  _dashConfig = _dashConfigMerge(cfg);
  const jid = window.JOB_ID || "";
  try {
    await fetch("/dashboard-config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ job_id: jid }, _dashConfig))
    });
  } catch (_) {
  }
  return _dashConfig;
}
async function _dashResetConfig() {
  return _dashSaveConfig(_dashConfigDefault());
}
function _dashGetActiveTabConfig(cfg) {
  const activeId = cfg.active_tab || "system";
  if (activeId === "system") {
    return {
      widget_order: typeof _DASH_ALL_WIDGETS !== "undefined" ? _DASH_ALL_WIDGETS.map((s) => s.widget) : [],
      widget_visible: {}
    };
  }
  const tab = (cfg.custom_tabs || []).find((t) => t.id === activeId);
  if (!tab) {
    cfg.active_tab = "system";
    return _dashGetActiveTabConfig(cfg);
  }
  return {
    widget_order: tab.widget_order || [],
    widget_visible: tab.widget_visible || {}
  };
}
async function _dashSwitchTab(tabId) {
  const cfg = _dashConfigCurrent();
  cfg.active_tab = tabId;
  await _dashSaveConfig(cfg);
  if (typeof _renderDashboard === "function") _renderDashboard();
}
async function _dashAddCustomTab(name, order, visible) {
  const cfg = _dashConfigCurrent();
  const id = "custom-" + Date.now();
  if (!Array.isArray(cfg.custom_tabs)) cfg.custom_tabs = [];
  cfg.custom_tabs.push({ id, name, widget_order: order, widget_visible: visible });
  cfg.active_tab = id;
  await _dashSaveConfig(cfg);
  return id;
}
async function _dashDeleteCustomTab(id) {
  const cfg = _dashConfigCurrent();
  if (!Array.isArray(cfg.custom_tabs)) return;
  cfg.custom_tabs = cfg.custom_tabs.filter((t) => t.id !== id);
  if (cfg.active_tab === id) cfg.active_tab = "system";
  await _dashSaveConfig(cfg);
  if (typeof _renderDashboard === "function") _renderDashboard();
}
async function _dashSaveCustomTabLayout(id, name, order, visible) {
  const cfg = _dashConfigCurrent();
  if (!Array.isArray(cfg.custom_tabs)) cfg.custom_tabs = [];
  const tab = cfg.custom_tabs.find((t) => t.id === id);
  if (tab) {
    tab.name = name;
    tab.widget_order = order;
    tab.widget_visible = visible;
  }
  await _dashSaveConfig(cfg);
}
async function _dashReorderTabs(orderedIds) {
  const cfg = _dashConfigCurrent();
  if (!Array.isArray(cfg.custom_tabs)) return;
  const tabMap = Object.fromEntries(cfg.custom_tabs.map((t) => [t.id, t]));
  cfg.custom_tabs = orderedIds.map((id) => tabMap[id]).filter(Boolean);
  await _dashSaveConfig(cfg);
  if (typeof _renderDashboard === "function") _renderDashboard();
}
