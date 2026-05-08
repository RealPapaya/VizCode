// @module Dashboard_view/widgets/widget_kpi_health

_dashRegisterWidget({
    id: 'kpi_health',
    labelKey: 'dashKpiHealth',
    defaultSize: 'S',

    render(container, size, stats) {
        const score = Number(stats.code_health_score || 0);
        const color = _dashHealthColor(score);
        const label = score >= (_DASH_HEALTH_BANDS.amber)
            ? 'Good' : score >= (_DASH_HEALTH_BANDS.red) ? 'Fair' : 'Poor';
        container.innerHTML = `
<div class="dash-widget-title">Code Health</div>
<div class="dash-widget-stat" style="color:${color}">${score.toFixed(1)}</div>
<div class="dash-widget-sub" style="color:${color}">${label} / 10</div>`;
    },

    renderDetail(container, stats) {
        const score     = Number(stats.code_health_score || 0);
        const breakdown = stats.code_health_breakdown || {};
        const weights   = stats.code_health_weights   || {};
        const color     = _dashHealthColor(score);
        const statusKey = score >= (_DASH_HEALTH_BANDS.amber) ? 'Good'
                        : score >= (_DASH_HEALTH_BANDS.red) ? 'Fair' : 'Poor';

        const pct     = Math.max(0, Math.min(1, score / 10));
        const trackLen = Math.PI * 88;
        const fillLen  = (pct * trackLen).toFixed(2);

        const subRows = Object.entries(breakdown).map(([key, val]) => {
            const w    = weights[key] || 0;
            const name = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            const subColor = _dashHealthColor(Number(val));
            const p   = Math.round(Math.max(0, Math.min(1, Number(val) / 10)) * 100);
            return `<div class="dash-health-row">
              <span class="dash-health-row-label">${_dashEscape(name)}</span>
              <div class="dash-health-row-track">
                <div class="dash-health-row-fill" style="width:${p}%;background:${subColor}"></div>
              </div>
              <span class="dash-health-row-value" style="color:${subColor}">${Number(val).toFixed(1)}</span>
              <span style="color:var(--muted);font-size:10px;margin-left:4px;">×${(w*100).toFixed(0)}%</span>
            </div>`;
        }).join('');

        container.innerHTML = `
<div class="dash-card">
  <div class="dash-card-title"><span class="dash-card-title-dot" style="background:${color}"></span>Overall Score</div>
  <div class="dash-health-gauge-area">
    <svg class="dash-health-gauge-svg" viewBox="0 0 220 130" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path class="dash-health-gauge-track" d="M 22 110 A 88 88 0 0 1 198 110"/>
      <path class="dash-health-gauge-fill" d="M 22 110 A 88 88 0 0 1 198 110"
            style="stroke-dasharray:${fillLen} ${trackLen.toFixed(2)};stroke:${color}"/>
      <text x="110" y="82"  class="dash-health-gauge-score">${score.toFixed(1)}</text>
      <text x="110" y="104" class="dash-health-gauge-den">/ 10</text>
    </svg>
    <span class="dash-health-status-badge" style="color:${color}">${_dashEscape(statusKey)}</span>
  </div>
</div>
<div class="dash-card">
  <div class="dash-card-title"><span class="dash-card-title-dot"></span>Sub-score Breakdown</div>
  <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px;">
    ${subRows || '<div class="dash-empty">No breakdown data</div>'}
  </div>
</div>`;
    },
});
