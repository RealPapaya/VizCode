// @module Dashboard_view/dashboard_config
// Mode 2 widget-picker config: load / save / defaults.
//
// Config shape (persisted to .vizcode/dashboard_config.json):
//   {
//     widget_order:   ['kpi_strip', 'code_health', ...]   // render order
//     widget_visible: { kpi_strip: true, ... }            // per-widget toggle
//     git_window_days: 180                                // backend git --since
//   }
// Anything missing falls back to the default. The user only persists
// what's been explicitly toggled / re-ordered.

const _DASH_CONFIG_DEFAULTS = {
    widget_order: [
        'kpi_strip',
        'code_health',
        'tech_debt',
        'complexity',
        'duplication',
        'coupling',
        'issues',
        'structure',
        'graph_intelligence',
        'temporal',
    ],
    widget_visible: {
        kpi_strip:          true,
        code_health:        true,
        tech_debt:          true,
        complexity:         true,
        duplication:        true,
        coupling:           true,
        issues:             true,
        structure:          true,
        graph_intelligence: true,
        temporal:           true,
    },
    git_window_days: 180,
};

let _dashConfig = null;   // populated by _dashLoadConfig before each render

function _dashConfigDefault() {
    return JSON.parse(JSON.stringify(_DASH_CONFIG_DEFAULTS));
}

function _dashConfigCurrent() {
    if (!_dashConfig) _dashConfig = _dashConfigDefault();
    return _dashConfig;
}

// Merge a partial config from the server with the defaults so callers
// always see every field.
function _dashConfigMerge(loaded) {
    const cfg = _dashConfigDefault();
    if (!loaded || typeof loaded !== 'object') return cfg;

    if (Array.isArray(loaded.widget_order)) {
        // Keep only known widget keys, then append any defaults the user
        // hasn't explicitly ordered yet (so new widgets appear at the end
        // instead of disappearing on schema bumps).
        const known = new Set(cfg.widget_order);
        const ordered = loaded.widget_order.filter(k => known.has(k));
        for (const k of cfg.widget_order) {
            if (!ordered.includes(k)) ordered.push(k);
        }
        cfg.widget_order = ordered;
    }
    if (loaded.widget_visible && typeof loaded.widget_visible === 'object') {
        Object.assign(cfg.widget_visible, loaded.widget_visible);
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
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign({ job_id: jid }, _dashConfig)),
        });
    } catch (_) { /* save failure is non-fatal */ }
    return _dashConfig;
}

// Reset to defaults and persist.
async function _dashResetConfig() {
    return _dashSaveConfig(_dashConfigDefault());
}
