// @module Dashboard_view/dashboard_render
// Orchestrator: renders the tab bar, refreshes section containers from the
// active tab's config, then dispatches each visible widget to its renderer.

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

    const cfg    = _dashConfigCurrent();
    _dashRenderTabBar(cfg);

    const tabCfg  = _dashGetActiveTabConfig(cfg);
    const sections = _dashRefreshSections(tabCfg);

    for (const sec of sections) {
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
