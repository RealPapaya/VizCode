// @module Dashboard_view/widgets/widget_code_health
// Code Health — large score badge + 5 sub-score bars. Visual config
// (sub-score order, labels, colours, threshold bands) comes from
// dashboard_health_config.js — formula + weights live on the backend.

function _dashRenderCodeHealth(container, stats) {
    if (!container) return;

    const score     = Number(stats.code_health_score || 0);
    const breakdown = stats.code_health_breakdown || {};
    const weights   = stats.code_health_weights || {};

    const badgeColor = _dashHealthColor(score);

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

    container.innerHTML = `
<div class="dash-card">
  <div class="dash-card-title">
    <span class="dash-card-title-dot" style="background:${badgeColor}"></span>${_dashEscape(_dashT('dashCodeHealthTitle'))}
  </div>
  <div class="dash-health-body">
    <div class="dash-health-badge" style="--health-color:${badgeColor}">
      <div class="dash-health-badge-score">${score.toFixed(1)}</div>
      <div class="dash-health-badge-max">/ 10</div>
    </div>
    <div class="dash-health-bars">${barsHTML}</div>
  </div>
</div>`;
}
