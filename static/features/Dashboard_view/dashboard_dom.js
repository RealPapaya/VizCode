// @module Dashboard_view/dashboard_dom
// Builds the dashboard overlay shell once. Single bento canvas — no tabs.

let _dashBuilt = false;

// ── Overlay shell (built once) ────────────────────────────────────────────

function _dashBuildDOM() {
    if (document.getElementById('dashboard-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'dashboard-overlay';
    overlay.innerHTML = `
<div id="dashboard-panel">
  <div id="dashboard-topbar">
    <span id="dashboard-title">DASHBOARD</span>
    <select class="dash-preset-select" id="dash-preset-select" title="Layout Preset"></select>
    <button class="dash-topbar-btn" id="dash-customize-btn" type="button">
      <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
        <circle cx="5" cy="8" r="1.5"/><circle cx="11" cy="8" r="1.5"/>
        <line x1="0" y1="8" x2="3.5" y2="8"/><line x1="6.5" y1="8" x2="9.5" y2="8"/><line x1="12.5" y1="8" x2="16" y2="8"/>
      </svg>
      Customize
    </button>
    <div class="dash-topbar-customize-controls" id="dash-customize-controls">
      <button class="dash-topbar-btn" id="dash-add-widget-btn"    type="button">+ Add Widget</button>
      <button class="dash-topbar-btn" id="dash-save-preset-btn"   type="button">Save as Preset</button>
      <button class="dash-topbar-btn" id="dash-delete-preset-btn" type="button">Delete Preset</button>
      <button class="dash-topbar-btn" id="dash-reset-layout-btn"  type="button">Reset Layout</button>
    </div>
  </div>
  <div id="dashboard-bento"></div>
</div>`;

    document.body.appendChild(overlay);
    _dashBuilt = true;
}

// No-op kept for call-site compatibility
function _dashRenderTabBar() {}
function _dashRefreshSections() { return []; }
function _dashApplyToolbarLabels() {}

// Kept for call-sites in dashboard_config that no longer run
function _dashConfigCurrent() { return {}; }
function _dashGetActiveTabConfig() { return {}; }
