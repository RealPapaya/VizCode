// @module Dashboard_view/dashboard_lifecycle
// Hide / restore peer UI when entering / leaving Dashboard mode. Peer UI
// listed once here so adding a new sibling overlay needs one edit per side.

const _DASH_PEER_IDS = [
    'topbar', 'sidebar', 'breadcrumb', 'chat-card',
    'rail-explorer-btn', 'rail-filter-btn',
];

function _dashHidePeerUI() {
    // Close sibling overlays first.
    if (window.state && state.galaxyActive && typeof closeGalaxy === 'function') {
        closeGalaxy();
    }
    if (window._sv && window._sv.active && typeof symViewClose === 'function') {
        symViewClose();
    }

    for (const id of _DASH_PEER_IDS) {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    }

    // Chat panel: collapse if open (display style is managed separately)
    const chatPanel = document.getElementById('chat-panel');
    if (chatPanel && chatPanel.classList.contains('open')) {
        chatPanel.classList.remove('open');
    }
}

function _dashRestorePeerUI() {
    for (const id of _DASH_PEER_IDS) {
        const el = document.getElementById(id);
        if (el) el.style.display = '';
    }
}
