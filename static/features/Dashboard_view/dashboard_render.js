// @module Dashboard_view/dashboard_render
// Orchestrator: walks _DASH_SECTIONS and dispatches each one to its widget
// renderer. Each widget owns its container DOM; this file owns the order.

const _DASH_WIDGET_RENDERERS = {
    kpi_strip:          _dashRenderKpiStrip,
    code_health:        _dashRenderCodeHealth,
    tech_debt:          _dashRenderTechDebt,
    complexity:         _dashRenderComplexity,
    duplication:        _dashRenderDuplication,
    coupling:           _dashRenderCoupling,
    issues:             _dashRenderIssues,
    structure:          _dashRenderStructure,
    graph_intelligence: _dashRenderGraphIntelligence,
    temporal:           _dashRenderTemporal,
};

function _renderDashboard() {
    if (!window.DATA || !DATA.stats) return;
    const stats = DATA.stats;

    _dashDestroyAllCharts();

    for (const sec of _DASH_SECTIONS) {
        const container = document.getElementById(sec.id);
        const renderer  = _DASH_WIDGET_RENDERERS[sec.widget];
        if (!container || typeof renderer !== 'function') continue;
        try {
            renderer(container, stats);
        } catch (err) {
            console.error(`[dashboard] widget ${sec.widget} failed:`, err);
            container.innerHTML = `<div class="dash-empty">⚠ widget error</div>`;
        }
    }
}
