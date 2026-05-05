// @module Dashboard_view/widgets/widget_temporal
// Temporal Analysis (Phase 2 placeholder).
//
// Renders nothing in Phase 1: when stats.has_git_history is false, the
// container is left empty (not even a header). When the git-log parser
// arrives in Phase 2, this is the only file that needs to grow.

function _dashRenderTemporal(container, stats) {
    if (!container) return;
    container.innerHTML = '';
    if (!stats.has_git_history) return;
    // Phase 2 widgets land here (hotspot, change coupling, churn). Until then
    // we leave the container empty even when git history is present.
}
