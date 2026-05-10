// @module Dashboard_view/dashboard_dom
// Builds the dashboard overlay shell once and renders the browser-style tab bar.

let _dashBuilt = false;
const _DASH_REMOVE_TAB_MODAL_ID = 'dash-remove-tab-modal';

function _dashBuildDOM() {
    if (document.getElementById('dashboard-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'dashboard-overlay';
    overlay.innerHTML = `
<div id="dashboard-panel">
  <div id="dashboard-topbar">
    <div class="dash-tab-strip" id="dash-tab-strip" role="tablist" aria-label="Dashboard tabs"></div>
    <div class="dash-topbar-right">
      <div class="dash-topbar-customize-controls" id="dash-customize-controls">
        <button class="dash-topbar-btn" id="dash-add-widget-btn" type="button">+ Add Widget</button>
        <button class="dash-topbar-btn" id="dash-reset-layout-btn" type="button">Reset Layout</button>
      </div>
      <button class="dash-topbar-btn" id="dash-customize-btn" type="button">Edit</button>
    </div>
  </div>
  <div id="dashboard-bento"></div>
</div>`;

    document.body.appendChild(overlay);
    _dashRenderTabBar();
    _dashBuilt = true;
}

function _dashRenderTabBar() {
    const strip = document.getElementById('dash-tab-strip');
    if (!strip) return;

    const state = _dashLoadTabsState();
    const editActive = typeof _dashCustomizeActive !== 'undefined' && _dashCustomizeActive;
    if (!editActive) _dashCloseRemoveTabModal();
    strip.innerHTML = state.tabs.map(tab => {
        const active = tab.id === state.activeTabId;
        const locked = !!tab.locked;
        const renameBtn = (!locked && editActive)
            ? `<button class="dash-tab-rename" type="button" aria-label="Rename ${_dashEscape(tab.name)}">
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
                  <path d="M3 11.6 3.4 13l1.4-.4 6.9-6.9-1.8-1.8L3 10.8v.8Z" fill="currentColor"/>
                  <path d="m10.7 3.1 1.1-1.1c.4-.4 1-.4 1.4 0l.8.8c.4.4.4 1 0 1.4l-1.1 1.1-2.2-2.2Z" fill="currentColor"/>
                </svg>
              </button>`
            : '';
        const closeBtn = (!locked && editActive)
            ? '<button class="dash-tab-close" type="button" aria-label="Remove tab">x</button>'
            : '';
        return `<div class="dash-tab${active ? ' active' : ''}${locked ? ' locked' : ''}"
            role="tab"
            tabindex="0"
            aria-selected="${active ? 'true' : 'false'}"
            data-tab-id="${_dashEscape(tab.id)}">
  <span class="dash-tab-label" title="${_dashEscape(tab.name)}">${_dashEscape(tab.name)}</span>
  ${renameBtn}
  ${closeBtn}
</div>`;
    }).join('') + '<button class="dash-tab-add" id="dash-add-tab-btn" type="button" aria-label="Add tab">+</button>';

    strip.querySelectorAll('.dash-tab').forEach(tabEl => {
        const tabId = tabEl.dataset.tabId;
        const label = tabEl.querySelector('.dash-tab-label');

        tabEl.addEventListener('click', e => {
            if (e.target.closest('.dash-tab-close,.dash-tab-rename')) return;
            if (label && label.isContentEditable) return;
            _dashCloseRemoveTabModal();
            _dashSwitchTab(tabId);
        });

        tabEl.addEventListener('keydown', e => {
            if (label && label.isContentEditable) return;
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                _dashSwitchTab(tabId);
            }
        });

        label?.addEventListener('dblclick', e => {
            e.preventDefault();
            e.stopPropagation();
            _dashStartTabRename(tabId, label);
        });

        tabEl.querySelector('.dash-tab-rename')?.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            _dashCloseRemoveTabModal();
            _dashStartTabRename(tabId, label);
        });

        tabEl.querySelector('.dash-tab-close')?.addEventListener('click', e => {
            e.preventDefault();
            e.stopPropagation();
            _dashOpenRemoveTabModal(tabId);
        });
    });

    strip.querySelector('#dash-add-tab-btn')?.addEventListener('click', () => {
        _dashCloseRemoveTabModal();
        _dashAddTab();
    });
}

function _dashOpenRemoveTabModal(tabId) {
    const state = _dashLoadTabsState();
    const tab = state.tabs.find(t => t.id === tabId);
    if (!tab || tab.locked) return;

    _dashCloseRemoveTabModal();

    const overlay = document.createElement('div');
    overlay.id = _DASH_REMOVE_TAB_MODAL_ID;
    overlay.className = 'dash-remove-tab-overlay';
    overlay.innerHTML = `
<div class="dash-remove-tab-dialog" role="dialog" aria-modal="true" aria-labelledby="dash-remove-tab-title">
  <div class="dash-remove-tab-title" id="dash-remove-tab-title">Remove this tab?</div>
  <div class="dash-remove-tab-actions">
    <button class="dash-remove-tab-btn primary" data-action="confirm" type="button">Confirm</button>
    <button class="dash-remove-tab-btn" data-action="cancel" type="button">Cancel</button>
  </div>
</div>`;

    document.body.appendChild(overlay);

    overlay.addEventListener('click', e => {
        if (e.target === overlay) _dashCloseRemoveTabModal();
    });
    overlay.querySelector('[data-action="confirm"]')?.addEventListener('click', e => {
        e.preventDefault();
        _dashCloseRemoveTabModal();
        _dashDeleteTab(tabId);
    });
    overlay.querySelector('[data-action="cancel"]')?.addEventListener('click', e => {
        e.preventDefault();
        _dashCloseRemoveTabModal();
    });
}

function _dashCloseRemoveTabModal() {
    document.getElementById(_DASH_REMOVE_TAB_MODAL_ID)?.remove();
}

function _dashStartTabRename(tabId, label) {
    const state = _dashLoadTabsState();
    const tab = state.tabs.find(t => t.id === tabId);
    if (!tab || tab.locked || !label || label.isContentEditable) return;

    const original = tab.name;
    _dashCloseRemoveTabModal();
    label.closest('.dash-tab')?.classList.add('renaming');
    label.contentEditable = 'true';
    label.classList.add('editing');
    label.textContent = original;
    label.focus();

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(label);
    selection.removeAllRanges();
    selection.addRange(range);

    const commit = () => {
        const next = (label.textContent || '').trim();
        label.closest('.dash-tab')?.classList.remove('renaming');
        label.contentEditable = 'false';
        label.classList.remove('editing');
        label.removeEventListener('blur', commit);
        label.removeEventListener('keydown', onKeydown);
        if (next) _dashRenameTab(tabId, next);
        else _dashRenderTabBar();
    };

    const onKeydown = e => {
        if (e.key === 'Enter') {
            e.preventDefault();
            commit();
        }
        if (e.key === 'Escape') {
            e.preventDefault();
            label.textContent = original;
            commit();
        }
    };

    label.addEventListener('blur', commit);
    label.addEventListener('keydown', onKeydown);
}

function _dashRefreshSections() { return []; }
function _dashApplyToolbarLabels() {}

// Kept for call-sites in dashboard_config that no longer run.
function _dashConfigCurrent() { return {}; }
function _dashGetActiveTabConfig() { return {}; }
