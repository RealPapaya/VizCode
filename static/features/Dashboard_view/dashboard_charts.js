// @module Dashboard_view/dashboard_charts
// Chart.js helpers shared by every widget that draws a chart. Owns the
// _dashCharts registry so charts can be destroyed / recreated on re-render.

const _dashCharts = {};   // canvas-id → Chart instance

const _DASH_PALETTE = [
    '#dfa745', '#a78bfa', '#34d399', '#ffd700', '#fb923c',
    '#f472b6', '#60a5fa', '#e879f9', '#10b981', '#f87171',
    '#38bdf8', '#c084fc', '#4ade80', '#facc15', '#ff6b35',
];

function _dashApplyChartDefaults() {
    if (typeof Chart === 'undefined') return;
    Chart.defaults.color = '#64748b';
    Chart.defaults.borderColor = '#1a2535';
    Chart.defaults.font.family = "'Segoe UI', system-ui, sans-serif";
    Chart.defaults.font.size = 11;
    Chart.defaults.plugins.legend.labels.boxWidth = 10;
    Chart.defaults.plugins.legend.labels.padding = 14;
    Chart.defaults.plugins.tooltip.backgroundColor = '#0d1520';
    Chart.defaults.plugins.tooltip.borderColor = '#1a2535';
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.titleColor = '#e2e8f0';
    Chart.defaults.plugins.tooltip.bodyColor = '#94a3b8';
    Chart.defaults.plugins.tooltip.padding = 10;
}

function _dashMkChart(canvas, type, data, options) {
    if (!canvas || typeof Chart === 'undefined') return null;
    const id = canvas.id || ('dash-chart-' + Math.random().toString(36).slice(2, 8));
    canvas.id = id;
    if (_dashCharts[id]) {
        try { _dashCharts[id].destroy(); } catch (_) { /* ignore */ }
        delete _dashCharts[id];
    }
    const ctx = canvas.getContext('2d');
    _dashCharts[id] = new Chart(ctx, { type, data, options });
    return _dashCharts[id];
}

function _dashDestroyAllCharts() {
    Object.keys(_dashCharts).forEach(id => {
        try { _dashCharts[id]?.destroy(); } catch (_) { /* ignore */ }
        delete _dashCharts[id];
    });
}
