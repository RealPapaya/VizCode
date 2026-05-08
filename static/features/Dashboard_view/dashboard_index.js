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
    // Close any open detail panel first
    if (_dashDetailOpen) _dashCloseDetailPanel(true);

    // Exit customize mode silently
    if (_dashCustomizeActive) {
        _dashCustomizeActive = false;
        document.body.classList.remove('dash-customize');
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
