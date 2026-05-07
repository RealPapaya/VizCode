// @module Dashboard_view/dashboard_dom
// Builds the overlay shell once; rebuilds the tab bar and inner section list
// each render to honour the active tab's widget order / visibility.

let _dashBuilt = false;

// Canonical widget list (key + container id). The system tab always shows
// all of these in this order. Custom tabs define their own subsets.
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

// Compute the active list of sections from a tab config object
// ({ widget_order, widget_visible }). Returns at least an empty array.
function _dashSectionsFromConfig(tabCfg) {
    const order   = (tabCfg && tabCfg.widget_order)   || _DASH_ALL_WIDGETS.map(s => s.widget);
    const visible = (tabCfg && tabCfg.widget_visible) || {};
    const out = [];
    for (const key of order) {
        if (visible[key] === false) continue;
        const sec = _DASH_WIDGET_INDEX[key];
        if (sec) out.push(sec);
    }
    return out;
}

// Backwards-compat: old call sites used _DASH_SECTIONS as a plain const.
let _DASH_SECTIONS = _DASH_ALL_WIDGETS.slice();

// ── Overlay shell (built once) ─────────────────────────────────────────────

function _dashBuildDOM() {
    if (document.getElementById('dashboard-overlay')) return;

    const ICON_GEAR = `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

    const overlay = document.createElement('div');
    overlay.id = 'dashboard-overlay';
    overlay.innerHTML = `
<div id="dashboard-panel">
  <div id="dashboard-tab-bar"></div>
  <div id="dashboard-card">
    <div id="dashboard-scroll"></div>
  </div>
</div>`;

    document.body.appendChild(overlay);

    // Backdrop click + ESC close
    overlay.addEventListener('click', e => {
        if (e.target === overlay) closeDashboard();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && overlay.style.display !== 'none') closeDashboard();
    });

    _dashBuilt = true;
}

// ── Tab bar ────────────────────────────────────────────────────────────────

const _ICON_GEAR_SM = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;

function _dashRenderTabBar(cfg) {
    const bar = document.getElementById('dashboard-tab-bar');
    if (!bar) return;

    const activeId    = cfg.active_tab || 'system';
    const customTabs  = cfg.custom_tabs || [];

    let html = '';

    // System tab (pinned, non-deletable)
    const sysLabel = _dashEscape(_dashT('dashTabOverview') || 'Overview');
    html += `<button class="dash-tab${activeId === 'system' ? ' active' : ''}" data-tab="system" type="button">${sysLabel}</button>`;

    // Custom tabs (draggable)
    for (const tab of customTabs) {
        const isActive = activeId === tab.id;
        html += `<button class="dash-tab${isActive ? ' active' : ''}" data-tab="${_dashEscape(tab.id)}" type="button" draggable="true">
  <span class="dash-tab-label">${_dashEscape(tab.name)}</span>
  <span class="dash-tab-delete" data-delete-tab="${_dashEscape(tab.id)}" title="${_dashEscape(_dashT('dashTabDelete') || 'Delete tab')}">×</span>
</button>`;
    }

    // "+" add tab button
    html += `<button class="dash-tab-add" id="dashboard-tab-add" type="button" title="${_dashEscape(_dashT('dashTabAdd') || 'New tab')}">+</button>`;

    // Settings gear (global)
    const gearTitle = _dashEscape(_dashT('dashSettings') || 'Settings');
    html += `<button class="dash-tool-btn dash-tab-gear" id="dashboard-settings" type="button" aria-label="${gearTitle}" title="${gearTitle}">${_ICON_GEAR_SM}</button>`;

    bar.innerHTML = html;

    // Tab click → switch
    bar.querySelectorAll('.dash-tab').forEach(btn => {
        btn.addEventListener('click', e => {
            if (e.target.closest('.dash-tab-delete')) return;
            const tabId = btn.dataset.tab;
            if (tabId && tabId !== activeId) _dashSwitchTab(tabId);
        });
        // Double-click on custom tab → edit
        btn.addEventListener('dblclick', e => {
            if (e.target.closest('.dash-tab-delete')) return;
            const tabId = btn.dataset.tab;
            if (tabId && tabId !== 'system') _dashOpenTabEditor(tabId);
        });
    });

    // Delete button
    bar.querySelectorAll('.dash-tab-delete').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const id = btn.dataset.deleteTab;
            if (id && window.confirm((_dashT('dashTabDeleteConfirm') || 'Delete this tab?'))) {
                _dashDeleteCustomTab(id);
            }
        });
    });

    // New tab
    bar.querySelector('#dashboard-tab-add')?.addEventListener('click', () => {
        _dashOpenTabEditor(null);
    });

    // Global settings
    bar.querySelector('#dashboard-settings')?.addEventListener('click', () => {
        if (typeof _dashOpenSettings === 'function') _dashOpenSettings();
    });

    _dashBindTabBarDragDrop(bar);
}

function _dashBindTabBarDragDrop(bar) {
    let dragged = null;

    bar.addEventListener('dragstart', e => {
        const tab = e.target.closest('.dash-tab[draggable="true"]');
        if (!tab || tab.dataset.tab === 'system') { e.preventDefault(); return; }
        dragged = tab;
        setTimeout(() => tab.classList.add('dragging'), 0);
        try { e.dataTransfer.setData('text/plain', tab.dataset.tab); } catch (_) {}
    });

    bar.addEventListener('dragend', () => {
        if (dragged) dragged.classList.remove('dragging');
        bar.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        dragged = null;
    });

    bar.addEventListener('dragover', e => {
        e.preventDefault();
        if (!dragged) return;
        const target = e.target.closest('.dash-tab[data-tab]');
        if (!target || target === dragged || target.dataset.tab === 'system') return;
        bar.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        target.classList.add('drag-over');
    });

    bar.addEventListener('drop', e => {
        e.preventDefault();
        bar.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
        if (!dragged) return;
        const target = e.target.closest('.dash-tab[data-tab]');
        if (!target || target === dragged || target.dataset.tab === 'system') return;

        // Build new custom-tab order from current DOM order (excluding system tab)
        const allCustomTabs = Array.from(
            bar.querySelectorAll('.dash-tab[data-tab]:not([data-tab="system"])')
        );
        const draggedId = dragged.dataset.tab;
        const targetId  = target.dataset.tab;

        const ids = allCustomTabs.map(t => t.dataset.tab).filter(id => id !== draggedId);
        const insertIdx = ids.indexOf(targetId);
        const rect = target.getBoundingClientRect();
        const before = e.clientX < rect.left + rect.width / 2;
        ids.splice(before ? insertIdx : insertIdx + 1, 0, draggedId);

        _dashReorderTabs(ids);
    });
}

// ── Tab editor modal (create / edit custom tab) ────────────────────────────

// DASHBOARD_DESIGN_SPEC.md §5 rule 2: no per-widget identity colour.
// Every preview tile uses var(--accent); shape/label distinguishes widgets.

// Fixed skeleton bar-width patterns per widget (avoids Math.random flicker).
const _DASH_PREVIEW_BARS = {
    tech_debt:          [78, 62, 45],
    complexity:         [85, 58, 71],
    coupling:           [72, 55, 66],
    issues:             [80, 60, 45],
    structure:          [90, 68, 52],
    duplication:        [65, 80, 50],
    graph_intelligence: [75, 60, 85],
};

function _dashPreviewCard(key) {
    const label = _dashT(_DASH_WIDGET_LABEL_KEYS[key] || key) || key;

    let body = '';
    if (key === 'kpi_strip') {
        body = `<div class="dash-preview-kpi-row">
  <div class="dash-preview-kpi-block"></div>
  <div class="dash-preview-kpi-block"></div>
  <div class="dash-preview-kpi-block"></div>
  <div class="dash-preview-kpi-block"></div>
</div>`;
    } else if (key === 'code_health') {
        body = `<div style="display:flex;gap:10px;align-items:center">
  <div class="dash-preview-circle"></div>
  <div style="flex:1">
    <div class="dash-preview-bar" style="width:88%"></div>
    <div class="dash-preview-bar" style="width:70%;margin-top:5px"></div>
    <div class="dash-preview-bar" style="width:80%;margin-top:5px"></div>
  </div>
</div>`;
    } else if (key === 'temporal') {
        body = `<div class="dash-preview-timeline">${
            Array.from({ length: 16 }, (_, i) => {
                const op = 0.15 + (i % 5) * 0.15;
                return `<div class="dash-preview-cell" style="opacity:${op.toFixed(2)}"></div>`;
            }).join('')
        }</div>`;
    } else {
        const widths = _DASH_PREVIEW_BARS[key] || [82, 61, 74];
        body = widths.map((w, i) =>
            `<div class="dash-preview-bar" style="width:${w}%${i ? ';margin-top:5px' : ''}"></div>`
        ).join('');
    }

    return `<div class="dash-preview-card">
  <div class="dash-preview-card-title">
    <div class="dash-preview-dot"></div>
    <span>${_dashEscape(label)}</span>
  </div>
  <div class="dash-preview-body">${body}</div>
</div>`;
}

function _dashUpdatePreview(listEl, previewEl) {
    const rows    = Array.from(listEl.querySelectorAll('.dash-settings-row'));
    const visible = rows.filter(r => r.querySelector('input[data-toggle]')?.checked);

    if (!visible.length) {
        previewEl.innerHTML = `<div class="dash-preview-empty">${_dashEscape(
            _dashT('dashPreviewEmpty') || 'No widgets selected'
        )}</div>`;
        return;
    }
    previewEl.innerHTML = visible.map(r => _dashPreviewCard(r.dataset.widget)).join('');
}

function _dashOpenTabEditor(tabId) {
    if (document.getElementById('dash-tab-editor-overlay')) return;

    const cfg    = _dashConfigCurrent();
    const isEdit = tabId !== null;
    const tab    = isEdit ? (cfg.custom_tabs || []).find(t => t.id === tabId) : null;

    const initOrder   = tab ? tab.widget_order   : _DASH_ALL_WIDGETS.map(s => s.widget);
    const initVisible = tab ? tab.widget_visible : {};

    const confirmLabel = _dashEscape(isEdit
        ? (_dashT('dashTabSave')   || 'Save')
        : (_dashT('dashTabCreate') || 'Create'));
    const titleLabel   = _dashEscape(isEdit
        ? (_dashT('dashTabEdit') || 'Edit Tab')
        : (_dashT('dashTabNew')  || 'New Tab'));

    const overlay = document.createElement('div');
    overlay.id        = 'dash-tab-editor-overlay';
    overlay.className = 'dash-settings-overlay';

    overlay.innerHTML = `
<div class="dash-tab-editor-panel" role="dialog" aria-modal="true">
  <div class="dash-settings-head">
    <span class="dash-settings-title">${titleLabel}</span>
    <input type="text" class="dash-tab-name-input"
           placeholder="${_dashEscape(_dashT('dashTabNamePlaceholder') || 'Tab name…')}"
           value="${_dashEscape(tab ? tab.name : '')}" maxlength="32">
    <button class="dash-settings-close" type="button" aria-label="Close">×</button>
  </div>
  <div class="dash-tab-editor-body">
    <div class="dash-tab-editor-left">
      <h4>${_dashEscape(_dashT('dashSettingsWidgets') || 'Widgets')}</h4>
      <p class="dash-settings-hint">${_dashEscape(_dashT('dashSettingsWidgetsHint') || 'Drag to reorder. Toggle to show/hide.')}</p>
      <ul class="dash-settings-list" id="dash-tab-editor-list">
        ${initOrder.map(key => _dashSettingsWidgetRow(key, initVisible[key] !== false)).join('')}
      </ul>
    </div>
    <div class="dash-tab-editor-right">
      <div class="dash-tab-preview-label">${_dashEscape(_dashT('dashTabPreview') || 'Preview')}</div>
      <div id="dash-tab-preview"></div>
    </div>
  </div>
  <div class="dash-settings-foot">
    <button class="dash-settings-btn ghost"   id="dash-tab-editor-cancel"  type="button">${_dashEscape(_dashT('dashSettingsCancel') || 'Cancel')}</button>
    <button class="dash-settings-btn primary" id="dash-tab-editor-confirm" type="button">${confirmLabel}</button>
  </div>
</div>`;

    document.body.appendChild(overlay);

    const listEl    = overlay.querySelector('#dash-tab-editor-list');
    const previewEl = overlay.querySelector('#dash-tab-preview');

    _dashUpdatePreview(listEl, previewEl);

    // Live preview on toggle
    listEl.addEventListener('change', () => _dashUpdatePreview(listEl, previewEl));

    // Drag-reorder with live preview (reorder callback)
    _dashSettingsBindReorder(listEl, () => _dashUpdatePreview(listEl, previewEl));

    overlay.addEventListener('click', e => {
        if (e.target === overlay) overlay.remove();
    });
    overlay.querySelector('.dash-settings-close')
        ?.addEventListener('click', () => overlay.remove());
    overlay.querySelector('#dash-tab-editor-cancel')
        ?.addEventListener('click', () => overlay.remove());
    overlay.querySelector('#dash-tab-editor-confirm')
        ?.addEventListener('click', () => _dashTabEditorSave(overlay, tabId));
}

async function _dashTabEditorSave(overlay, tabId) {
    const nameInput = overlay.querySelector('.dash-tab-name-input');
    const name = (nameInput?.value || '').trim() || (_dashT('dashTabDefaultName') || 'Custom Tab');

    const order = Array.from(overlay.querySelectorAll('.dash-settings-row'))
        .map(li => li.dataset.widget);
    const visible = {};
    overlay.querySelectorAll('input[data-toggle]').forEach(cb => {
        visible[cb.dataset.toggle] = cb.checked;
    });

    if (tabId) {
        await _dashSaveCustomTabLayout(tabId, name, order, visible);
    } else {
        await _dashAddCustomTab(name, order, visible);
    }
    overlay.remove();
    if (typeof _renderDashboard === 'function') _renderDashboard();
}

// ── Section list ───────────────────────────────────────────────────────────

// Rebuild the inner section containers from a tab config and return sections.
function _dashRefreshSections(tabCfg) {
    const sections = _dashSectionsFromConfig(tabCfg);
    _DASH_SECTIONS  = sections;
    const scroll    = document.getElementById('dashboard-scroll');
    if (!scroll) return sections;
    scroll.innerHTML = sections
        .map(s => `<section id="${s.id}" class="dash-section" data-widget="${s.widget}"></section>`)
        .join('\n');
    return sections;
}

// No-op kept for call-site compatibility (labels are baked into tab bar HTML).
function _dashApplyToolbarLabels() {}
