// @module Dashboard_view/dashboard_index
// Public entry — globals openDashboard / closeDashboard are still expected
// by switchTopbarMode('dashboard') and the rail button click handler.

function openDashboard() {
    _dashHidePeerUI();
    _dashBuildDOM();
    _dashApplyChartDefaults();

    const overlay = document.getElementById('dashboard-overlay');
    if (overlay) overlay.style.display = 'block';

    _renderDashboard();

    if (typeof syncTopbarModeButtons === 'function') syncTopbarModeButtons();
}

function closeDashboard() {
    const overlay = document.getElementById('dashboard-overlay');
    if (overlay) overlay.style.display = 'none';

    _dashRestorePeerUI();

    if (typeof syncTopbarModeButtons === 'function') syncTopbarModeButtons();
}
