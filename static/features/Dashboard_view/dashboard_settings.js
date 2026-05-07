// @module Dashboard_view/dashboard_settings
// Mode 2 settings modal: lets the user toggle widget visibility, reorder
// sections, and tune the git history window. Saves to
// .vizcode/dashboard_config.json via dashboard_config.js's helpers.

const _DASH_SETTINGS_OVERLAY_ID = 'dash-settings-overlay';

const _DASH_WIDGET_LABEL_KEYS = {
    kpi_strip:          'dashSettingsWidgetKpi',
    code_health:        'dashCodeHealthTitle',
    tech_debt:          'dashTechDebtTitle',
    complexity:         'dashComplexityTitle',
    duplication:        'dashDuplicationTitle',
    coupling:           'dashSettingsWidgetCoupling',
    issues:             'dashSettingsWidgetIssues',
    structure:          'dashSettingsWidgetStructure',
    graph_intelligence: 'dashSettingsWidgetGraph',
    temporal:           'dashTemporalTitle',
};

function _dashOpenSettings() {
    if (document.getElementById(_DASH_SETTINGS_OVERLAY_ID)) return;

    const cfg = _dashConfigCurrent();

    const overlay = document.createElement('div');
    overlay.id = _DASH_SETTINGS_OVERLAY_ID;
    overlay.className = 'dash-settings-overlay';
    overlay.innerHTML = `
<div class="dash-settings-panel" role="dialog" aria-modal="true">
  <div class="dash-settings-head">
    <span class="dash-settings-title">${_dashEscape(_dashT('dashSettingsTitle'))}</span>
    <button class="dash-settings-close" type="button" aria-label="Close">×</button>
  </div>
  <div class="dash-settings-body">
    <section class="dash-settings-section">
      <h4>${_dashEscape(_dashT('dashSettingsWidgets'))}</h4>
      <p class="dash-settings-hint">${_dashEscape(_dashT('dashSettingsWidgetsHint'))}</p>
      <ul class="dash-settings-list" id="dash-settings-widgets">
        ${cfg.widget_order.map(key => _dashSettingsWidgetRow(key, cfg.widget_visible[key] !== false)).join('')}
      </ul>
    </section>
    <section class="dash-settings-section">
      <h4>${_dashEscape(_dashT('dashSettingsWindow'))}</h4>
      <p class="dash-settings-hint">${_dashEscape(_dashT('dashSettingsWindowHint'))}</p>
      <label class="dash-settings-window">
        <input type="number" id="dash-settings-window-input" min="7" max="3650" step="1" value="${Number(cfg.git_window_days) || 180}">
        <span>${_dashEscape(_dashT('dashSettingsWindowDays'))}</span>
      </label>
    </section>
  </div>
  <div class="dash-settings-foot">
    <button class="dash-settings-btn ghost"   id="dash-settings-reset"  type="button">${_dashEscape(_dashT('dashSettingsReset'))}</button>
    <button class="dash-settings-btn"         id="dash-settings-cancel" type="button">${_dashEscape(_dashT('dashSettingsCancel'))}</button>
    <button class="dash-settings-btn primary" id="dash-settings-save"   type="button">${_dashEscape(_dashT('dashSettingsSave'))}</button>
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

    _dashSettingsBindReorder(overlay.querySelector('#dash-settings-widgets'));
}

function _dashSettingsWidgetRow(key, visible) {
    const labelKey = _DASH_WIDGET_LABEL_KEYS[key] || key;
    const label = _dashT(labelKey);
    return `
<li class="dash-settings-row" data-widget="${key}" draggable="true">
  <span class="dash-settings-grip" aria-hidden="true">⋮⋮</span>
  <label class="dash-settings-toggle">
    <input type="checkbox" data-toggle="${key}" ${visible ? 'checked' : ''}>
    <span>${_dashEscape(label)}</span>
  </label>
  <span class="dash-settings-key">${key}</span>
</li>`;
}

function _dashCloseSettings() {
    const overlay = document.getElementById(_DASH_SETTINGS_OVERLAY_ID);
    if (overlay) overlay.remove();
}

function _dashSettingsBindReorder(list) {
    if (!list) return;
    let dragged = null;

    list.addEventListener('dragstart', e => {
        const row = e.target.closest('.dash-settings-row');
        if (!row) return;
        dragged = row;
        row.classList.add('dragging');
        try { e.dataTransfer.setData('text/plain', row.dataset.widget); } catch (_) {}
    });
    list.addEventListener('dragend', () => {
        if (dragged) dragged.classList.remove('dragging');
        dragged = null;
    });
    list.addEventListener('dragover', e => {
        e.preventDefault();
        if (!dragged) return;
        const target = e.target.closest('.dash-settings-row');
        if (!target || target === dragged) return;
        const rect = target.getBoundingClientRect();
        const before = (e.clientY - rect.top) < rect.height / 2;
        list.insertBefore(dragged, before ? target : target.nextSibling);
    });
}

async function _dashSettingsSave() {
    const overlay = document.getElementById(_DASH_SETTINGS_OVERLAY_ID);
    if (!overlay) return;

    const order = Array.from(overlay.querySelectorAll('.dash-settings-row'))
        .map(li => li.dataset.widget);
    const visible = {};
    overlay.querySelectorAll('input[data-toggle]').forEach(cb => {
        visible[cb.dataset.toggle] = cb.checked;
    });
    const days = Number(overlay.querySelector('#dash-settings-window-input')?.value || 180);

    await _dashSaveConfig({
        widget_order:    order,
        widget_visible:  visible,
        git_window_days: Number.isFinite(days) ? days : 180,
    });

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
