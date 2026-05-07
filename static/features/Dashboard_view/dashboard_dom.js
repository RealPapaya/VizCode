// @module Dashboard_view/dashboard_dom
// Builds the overlay shell once and rebuilds the inner section list each
// render to honour the user's saved widget order / visibility (Mode 2).

let _dashBuilt = false;

// Canonical widget list (key + container id). User config picks which of
// these appear and in what order; the keys here are the universe of
// possibilities and define the default ordering.
const _DASH_ALL_WIDGETS = [
    { id: 'dash-sec-kpi',         widget: 'kpi_strip' },
    { id: 'dash-sec-health',      widget: 'code_health' },
    { id: 'dash-sec-debt',        widget: 'tech_debt' },
    { id: 'dash-sec-complexity',  widget: 'complexity' },
    { id: 'dash-sec-duplication', widget: 'duplication' },
    { id: 'dash-sec-coupling',    widget: 'coupling' },
    { id: 'dash-sec-issues',      widget: 'issues' },
    { id: 'dash-sec-structure',   widget: 'structure' },
    { id: 'dash-sec-graph',       widget: 'graph_intelligence' },
    { id: 'dash-sec-temporal',    widget: 'temporal' },
];

const _DASH_WIDGET_INDEX = Object.fromEntries(
    _DASH_ALL_WIDGETS.map(s => [s.widget, s])
);

// Compute the active list of sections from a config object. Unknown keys
// are dropped; hidden widgets are filtered out. Always returns at least
// an empty array.
function _dashSectionsFromConfig(cfg) {
    if (!cfg) cfg = _dashConfigCurrent();
    const order   = cfg.widget_order   || _DASH_ALL_WIDGETS.map(s => s.widget);
    const visible = cfg.widget_visible || {};
    const out = [];
    for (const key of order) {
        if (visible[key] === false) continue;
        const sec = _DASH_WIDGET_INDEX[key];
        if (sec) out.push(sec);
    }
    return out;
}

// Backwards-compat: old call sites used _DASH_SECTIONS as a plain const.
// Keep an exported global that always reflects the current config.
let _DASH_SECTIONS = _DASH_ALL_WIDGETS.slice();

function _dashBuildDOM() {
    if (document.getElementById('dashboard-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'dashboard-overlay';

    overlay.innerHTML = `
<div id="dashboard-panel">
  <div id="dashboard-toolbar">
    <button class="dash-tool-btn" id="dashboard-export"   type="button" title="Export"></button>
    <button class="dash-tool-btn" id="dashboard-settings" type="button" title="Settings"></button>
  </div>
  <div id="dashboard-scroll"></div>
</div>`;

    document.body.appendChild(overlay);

    // Backdrop click + ESC close
    overlay.addEventListener('click', e => {
        if (e.target === overlay) closeDashboard();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && overlay.style.display !== 'none') closeDashboard();
    });

    overlay.querySelector('#dashboard-export')
        ?.addEventListener('click', () => {
            if (typeof _dashExportPrint === 'function') _dashExportPrint();
        });
    overlay.querySelector('#dashboard-settings')
        ?.addEventListener('click', () => {
            if (typeof _dashOpenSettings === 'function') _dashOpenSettings();
        });

    _dashApplyToolbarLabels();

    _dashBuilt = true;
}

// Refresh the inner section list against the current config. Called by
// _renderDashboard before it dispatches each widget.
function _dashRefreshSections(cfg) {
    const sections = _dashSectionsFromConfig(cfg);
    _DASH_SECTIONS = sections;
    const scroll = document.getElementById('dashboard-scroll');
    if (!scroll) return sections;
    scroll.innerHTML = sections
        .map(s => `<section id="${s.id}" class="dash-section" data-widget="${s.widget}"></section>`)
        .join('\n');
    return sections;
}

function _dashApplyToolbarLabels() {
    const exportBtn   = document.getElementById('dashboard-export');
    const settingsBtn = document.getElementById('dashboard-settings');
    if (exportBtn) {
        exportBtn.textContent  = _dashT('dashExport');
        exportBtn.title        = _dashT('dashExport');
    }
    if (settingsBtn) {
        settingsBtn.textContent = _dashT('dashSettings');
        settingsBtn.title       = _dashT('dashSettings');
    }
}
