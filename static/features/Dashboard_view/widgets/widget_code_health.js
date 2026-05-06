// @module Dashboard_view/widgets/widget_code_health
// Code Health — large score badge + 5 sub-score view. The sub-scores can
// be visualised either as horizontal bars (default, matches the rest of
// the dashboard's bar idiom) or as a radar chart (sub-score profile at a
// glance). Visual config (sub-score order, labels, colours, threshold
// bands) comes from dashboard_health_config.js — formula + weights live
// on the backend.

const _DASH_HEALTH_KEY     = 'code_health';
const _DASH_HEALTH_TYPES   = ['bar', 'radar'];
const _DASH_HEALTH_DEFAULT = 'bar';

function _dashRenderCodeHealth(container, stats) {
    if (!container) return;

    const score      = Number(stats.code_health_score || 0);
    const breakdown  = stats.code_health_breakdown || {};
    const weights    = stats.code_health_weights   || {};
    const badgeColor = _dashHealthColor(score);

    const type = _dashChartCurrentType(_DASH_HEALTH_KEY, _DASH_HEALTH_DEFAULT);

    container.innerHTML = `
<div class="dash-card">
  <div class="dash-card-title">
    <span class="dash-card-title-dot" style="background:${badgeColor}"></span>${_dashEscape(_dashT('dashCodeHealthTitle'))}
    ${_dashChartToggleHTML(_DASH_HEALTH_KEY, _DASH_HEALTH_TYPES, _DASH_HEALTH_DEFAULT)}
  </div>
  <div class="dash-health-body">
    <div class="dash-health-badge" style="--health-color:${badgeColor}">
      <div class="dash-health-badge-score">${score.toFixed(1)}</div>
      <div class="dash-health-badge-max">/ 10</div>
    </div>
    <div class="dash-health-render" id="dash-health-render"></div>
  </div>
</div>`;

    _dashRegisterChartSwitch(_DASH_HEALTH_KEY, () => _dashRenderCodeHealth(container, stats));

    if (type === 'radar') {
        _dashRenderHealthRadar(breakdown);
    } else {
        _dashRenderHealthBars(breakdown, weights);
    }
}

function _dashRenderHealthBars(breakdown, weights) {
    const target = document.getElementById('dash-health-render');
    if (!target) return;
    const barsHTML = _DASH_HEALTH_SUBSCORES.map(s => {
        const v       = Number(breakdown[s.key] || 0);
        const weight  = Number(weights[s.key] || 0);
        const pct     = Math.max(0, Math.min(100, (v / 10) * 100));
        const weightPct = Math.round(weight * 100);
        return `
<div class="dash-health-row">
  <span class="dash-health-row-label">${_dashEscape(_dashT(s.label))}</span>
  <span class="dash-health-row-weight">${weightPct}%</span>
  <div class="dash-health-row-track">
    <div class="dash-health-row-fill" style="width:${pct}%;background:${s.color}"></div>
  </div>
  <span class="dash-health-row-value">${v.toFixed(1)}</span>
</div>`;
    }).join('');
    target.innerHTML = `<div class="dash-health-bars">${barsHTML}</div>`;
}

function _dashRenderHealthRadar(breakdown) {
    const target = document.getElementById('dash-health-render');
    if (!target) return;
    target.innerHTML = `<div class="dash-chart-wrap" style="min-height:240px"><canvas id="dash-chart-health"></canvas></div>`;
    const canvas = document.getElementById('dash-chart-health');
    if (!canvas || typeof Chart === 'undefined') return;

    const labels = _DASH_HEALTH_SUBSCORES.map(s => _dashT(s.label));
    const data   = _DASH_HEALTH_SUBSCORES.map(s => Number(breakdown[s.key] || 0));

    _dashMkChart(canvas, 'radar', {
        labels,
        datasets: [{
            label: _dashT('dashCodeHealthTitle'),
            data,
            backgroundColor: '#a78bfa44',
            borderColor: '#a78bfa',
            borderWidth: 2,
            pointBackgroundColor: '#a78bfa',
            pointRadius: 4,
        }],
    }, {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
            r: {
                beginAtZero: true,
                min: 0,
                max: 10,
                grid:        { color: '#1a253588' },
                angleLines:  { color: '#1a253588' },
                pointLabels: { color: '#94a3b8', font: { size: 11 } },
                ticks:       { color: '#64748b', backdropColor: 'transparent', stepSize: 2 },
            },
        },
    });
}
