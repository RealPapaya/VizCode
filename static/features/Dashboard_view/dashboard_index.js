// @module Dashboard_view/dashboard_index
// Public entry — globals openDashboard / closeDashboard.

async function openDashboard() {
    _dashHidePeerUI();
    _dashBuildDOM();
    _dashApplyChartDefaults();

    const overlay = document.getElementById('dashboard-overlay');
    if (overlay) overlay.style.display = 'block';

    _renderDashboard();
    _dashInitCustomizeMode();

    if (typeof syncTopbarModeButtons === 'function') syncTopbarModeButtons();
}

function closeDashboard() {
    if (typeof _dashCloseGroupDrilldown === 'function') _dashCloseGroupDrilldown();
    if (typeof _dashCloseDrilldown === 'function') _dashCloseDrilldown();
    // Close any open detail panel first
    if (_dashDetailOpen) _dashCloseDetailPanel(true);

    if (_dashCustomizeActive && typeof _dashExitCustomize === 'function') {
        _dashExitCustomize();
    } else if (_dashCustomizeActive) {
        _dashCustomizeActive = false;
        document.body.classList.remove('dash-customize');
        try { localStorage.setItem(_DASH_LS_CUSTOMIZE, 'off'); } catch (_) {}
    }

    const overlay = document.getElementById('dashboard-overlay');
    if (overlay) overlay.style.display = 'none';

    _dashRestorePeerUI();

    if (typeof syncTopbarModeButtons === 'function') syncTopbarModeButtons();
}

// ESC key: close detail panel first, then close dashboard
document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const overlay = document.getElementById('dashboard-overlay');
    if (!overlay || overlay.style.display === 'none') return;
    if (_dashDetailOpen) return;  // detail panel handles its own ESC
    closeDashboard();
});
