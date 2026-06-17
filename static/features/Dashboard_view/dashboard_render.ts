// @ts-nocheck -- JS->TS migration: renamed to .ts, type-curation pending. Remove this line and fix errors to enable checking.
// @module Dashboard_view/dashboard_render
// Thin orchestrator: delegates to dashboard_layout.js for bento cell rendering.

function _renderDashboard() {
    if (!window.DATA || !DATA.stats) return;
    _dashMountLayout();
}
