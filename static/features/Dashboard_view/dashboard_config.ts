// @ts-nocheck -- JS->TS migration: deferred (not in page load order / unused). Curate or remove later.
// @module Dashboard_view/dashboard_config
// Tab-based dashboard config: load / save / defaults.
//
// Config shape (persisted to .vizcode/dashboard_config.json):
//   {
//     custom_tabs:    [{ id, name, widget_order, widget_visible }, ...]
//     active_tab:     'system' | '<custom-id>'
//     git_window_days: 180
//   }
//
// The "system" tab is implicit — always shows all widgets in default order.
// Backward compat: old flat-schema files (widget_order at root) keep only
// git_window_days; widget layout is discarded (system tab takes over).

const _DASH_CONFIG_DEFAULTS = {
    custom_tabs:     [],
    active_tab:      'system',
    git_window_days: 180,
};

let _dashConfig: any = null;   // populated by _dashLoadConfig before each render

function _dashConfigDefault() {
    return JSON.parse(JSON.stringify(_DASH_CONFIG_DEFAULTS));
}

// @ts-ignore -- duplicate; dashboard_config.ts is not in the page load order (dead code)
function _dashConfigCurrent() {
    if (!_dashConfig) _dashConfig = _dashConfigDefault();
    return _dashConfig;
}

// Merge a partial config from the server with the defaults so callers
// always see every field. Handles both old flat schema and new tab schema.
function _dashConfigMerge(loaded) {
    const cfg = _dashConfigDefault();
    if (!loaded || typeof loaded !== 'object') return cfg;

    // New schema: has custom_tabs array
    if (Array.isArray(loaded.custom_tabs)) {
        const knownWidgets = new Set(
            typeof _DASH_ALL_WIDGETS !== 'undefined'
                ? _DASH_ALL_WIDGETS.map(s => s.widget)
                : []
        );
        cfg.custom_tabs = loaded.custom_tabs
            .filter(t => t && typeof t.id === 'string' && typeof t.name === 'string')
            .map(t => {
                const rawOrder = Array.isArray(t.widget_order) ? t.widget_order : [];
                const order = knownWidgets.size
                    ? rawOrder.filter(k => knownWidgets.has(k))
                    : rawOrder;
                return {
                    id:             t.id,
                    name:           t.name,
                    widget_order:   order.length ? order : (knownWidgets.size ? [...knownWidgets] : []),
                    widget_visible: (t.widget_visible && typeof t.widget_visible === 'object')
                        ? t.widget_visible
                        : {},
                };
            });
    }
    // Old flat schema (widget_order at root) — silently drop, system tab takes over

    if (typeof loaded.active_tab === 'string') {
        const validIds = new Set(['system', ...cfg.custom_tabs.map(t => t.id)]);
        cfg.active_tab = validIds.has(loaded.active_tab) ? loaded.active_tab : 'system';
    }

    if (Number.isFinite(loaded.git_window_days)) {
        cfg.git_window_days = Math.max(7, Math.min(3650, loaded.git_window_days));
    }

    return cfg;
}

async function _dashLoadConfig() {
    const jid = window.JOB_ID || '';
    try {
        const url = '/dashboard-config' + (jid ? `?job=${encodeURIComponent(jid)}` : '');
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
    const jid = window.JOB_ID || '';
    try {
        await fetch('/dashboard-config', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify(Object.assign({ job_id: jid }, _dashConfig)),
        });
    } catch (_) { /* save failure is non-fatal */ }
    return _dashConfig;
}

// Reset to defaults and persist.
async function _dashResetConfig() {
    return _dashSaveConfig(_dashConfigDefault());
}

// ── Active-tab helpers ──────────────────────────────────────────────────────

// Returns { widget_order, widget_visible } for the currently active tab.
// @ts-ignore -- duplicate; dashboard_config.ts is not in the page load order (dead code)
function _dashGetActiveTabConfig(cfg) {
    const activeId = cfg.active_tab || 'system';
    if (activeId === 'system') {
        return {
            widget_order:   typeof _DASH_ALL_WIDGETS !== 'undefined'
                ? _DASH_ALL_WIDGETS.map(s => s.widget)
                : [],
            widget_visible: {},
        };
    }
    const tab = (cfg.custom_tabs || []).find(t => t.id === activeId);
    if (!tab) {
        cfg.active_tab = 'system';
        return _dashGetActiveTabConfig(cfg);
    }
    return {
        widget_order:   tab.widget_order   || [],
        widget_visible: tab.widget_visible || {},
    };
}

// ── Tab CRUD ────────────────────────────────────────────────────────────────

// @ts-ignore -- duplicate; dashboard_config.ts is not in the page load order (dead code)
async function _dashSwitchTab(tabId) {
    const cfg = _dashConfigCurrent();
    cfg.active_tab = tabId;
    await _dashSaveConfig(cfg);
    if (typeof _renderDashboard === 'function') _renderDashboard();
}

async function _dashAddCustomTab(name, order, visible) {
    const cfg = _dashConfigCurrent();
    const id = 'custom-' + Date.now();
    if (!Array.isArray(cfg.custom_tabs)) cfg.custom_tabs = [];
    cfg.custom_tabs.push({ id, name, widget_order: order, widget_visible: visible });
    cfg.active_tab = id;
    await _dashSaveConfig(cfg);
    return id;
}

async function _dashDeleteCustomTab(id) {
    const cfg = _dashConfigCurrent();
    if (!Array.isArray(cfg.custom_tabs)) return;
    cfg.custom_tabs = cfg.custom_tabs.filter(t => t.id !== id);
    if (cfg.active_tab === id) cfg.active_tab = 'system';
    await _dashSaveConfig(cfg);
    if (typeof _renderDashboard === 'function') _renderDashboard();
}

async function _dashSaveCustomTabLayout(id, name, order, visible) {
    const cfg = _dashConfigCurrent();
    if (!Array.isArray(cfg.custom_tabs)) cfg.custom_tabs = [];
    const tab = cfg.custom_tabs.find(t => t.id === id);
    if (tab) {
        tab.name           = name;
        tab.widget_order   = order;
        tab.widget_visible = visible;
    }
    await _dashSaveConfig(cfg);
}

// @ts-ignore -- duplicate; dashboard_config.ts is not in the page load order (dead code)
async function _dashReorderTabs(orderedIds) {
    const cfg = _dashConfigCurrent();
    if (!Array.isArray(cfg.custom_tabs)) return;
    const tabMap = Object.fromEntries(cfg.custom_tabs.map(t => [t.id, t]));
    cfg.custom_tabs = orderedIds.map(id => tabMap[id]).filter(Boolean);
    await _dashSaveConfig(cfg);
    if (typeof _renderDashboard === 'function') _renderDashboard();
}
