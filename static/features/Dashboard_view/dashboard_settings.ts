// @ts-nocheck -- JS->TS migration: renamed to .ts, type-curation pending. Remove this line and fix errors to enable checking.
// @module Dashboard_view/dashboard_settings
// Global settings modal: only controls git_window_days.
// Widget layout is configured per-tab via the tab editor in dashboard_dom.js.

const _DASH_SETTINGS_OVERLAY_ID = 'dash-settings-overlay';

function _dashOpenSettings() {
    if (document.getElementById(_DASH_SETTINGS_OVERLAY_ID)) return;

    const cfg = _dashConfigCurrent();

    const overlay = document.createElement('div');
    overlay.id        = _DASH_SETTINGS_OVERLAY_ID;
    overlay.className = 'dash-settings-overlay';
    overlay.innerHTML = `
<div class="dash-settings-panel" role="dialog" aria-modal="true">
  <div class="dash-settings-head">
    <span class="dash-settings-title">${_dashEscape(_dashT('dashSettingsTitle') || 'Settings')}</span>
    <button class="dash-settings-close" type="button" aria-label="Close">×</button>
  </div>
  <div class="dash-settings-body">
    <section class="dash-settings-section">
      <h4>${_dashEscape(_dashT('dashSettingsWindow') || 'Git History Window')}</h4>
      <p class="dash-settings-hint">${_dashEscape(_dashT('dashSettingsWindowHint') || 'How many days of git history to analyse.')}</p>
      <label class="dash-settings-window">
        <input type="number" id="dash-settings-window-input" min="7" max="3650" step="1" value="${Number(cfg.git_window_days) || 180}">
        <span>${_dashEscape(_dashT('dashSettingsWindowDays') || 'days')}</span>
      </label>
    </section>
  </div>
  <div class="dash-settings-foot">
    <button class="dash-settings-btn ghost"   id="dash-settings-reset"  type="button">${_dashEscape(_dashT('dashSettingsReset') || 'Reset')}</button>
    <button class="dash-settings-btn"         id="dash-settings-cancel" type="button">${_dashEscape(_dashT('dashSettingsCancel') || 'Cancel')}</button>
    <button class="dash-settings-btn primary" id="dash-settings-save"   type="button">${_dashEscape(_dashT('dashSettingsSave') || 'Save')}</button>
  </div>
</div>`;

    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => {
        if (e.target === overlay) _dashCloseSettings();
    });

    overlay.querySelector('.dash-settings-close')?.addEventListener('click', _dashCloseSettings);
    overlay.querySelector('#dash-settings-cancel')?.addEventListener('click', _dashCloseSettings);
    overlay.querySelector('#dash-settings-save')?.addEventListener('click', _dashSettingsSave);
    overlay.querySelector('#dash-settings-reset')?.addEventListener('click', _dashSettingsReset);
}

function _dashCloseSettings() {
    const overlay = document.getElementById(_DASH_SETTINGS_OVERLAY_ID);
    if (overlay) overlay.remove();
}

async function _dashSettingsSave() {
    const overlay = document.getElementById(_DASH_SETTINGS_OVERLAY_ID);
    if (!overlay) return;

    const days = Number(overlay.querySelector('#dash-settings-window-input')?.value || 180);
    const cfg  = _dashConfigCurrent();
    cfg.git_window_days = Number.isFinite(days) ? Math.max(7, Math.min(3650, days)) : 180;

    await _dashSaveConfig(cfg);
    _dashCloseSettings();
    if (typeof _renderDashboard === 'function') _renderDashboard();
}

async function _dashSettingsReset() {
    const ok = window.confirm(_dashT('dashSettingsResetConfirm') || 'Reset to defaults?');
    if (!ok) return;
    await _dashResetConfig();
    _dashCloseSettings();
    if (typeof _renderDashboard === 'function') _renderDashboard();
}
