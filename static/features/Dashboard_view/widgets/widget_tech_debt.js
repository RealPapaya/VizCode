// @module Dashboard_view/widgets/widget_tech_debt
// Tech Debt — total hours headline + per-issue minute breakdown.

const _DASH_DEBT_ORDER = [
    { key: 'circular',    label: 'dashDebtCircular',    color: '#fb923c' },
    { key: 'god',         label: 'dashDebtGod',         color: '#fbbf24' },
    { key: 'complexity',  label: 'dashDebtComplexity',  color: '#a78bfa' },
    { key: 'duplication', label: 'dashDebtDuplication', color: '#f472b6' },
    { key: 'dead',        label: 'dashDebtDead',        color: '#94a3b8' },
];

function _dashRenderTechDebt(container, stats) {
    if (!container) return;

    const hours     = Number(stats.tech_debt_hours || 0);
    const breakdown = stats.tech_debt_breakdown || {};
    const weights   = stats.tech_debt_weights   || {};

    const totalMinutes = Object.values(breakdown).reduce((a, n) => a + Number(n || 0), 0);
    const denom = totalMinutes || 1;

    const rowsHTML = _DASH_DEBT_ORDER.map(d => {
        const minutes = Number(breakdown[d.key] || 0);
        const pct     = Math.round((minutes / denom) * 100);
        const weight  = Number(weights[d.key] || 0);
        return `
<div class="dash-debt-row">
  <span class="dash-debt-row-label">${_dashEscape(_dashT(d.label))}</span>
  <span class="dash-debt-row-weight">${weight}m / item</span>
  <div class="dash-debt-row-track">
    <div class="dash-debt-row-fill" style="width:${pct}%;background:${d.color}"></div>
  </div>
  <span class="dash-debt-row-value">${minutes}m</span>
</div>`;
    }).join('');

    container.innerHTML = `
<div class="dash-card">
  <div class="dash-card-title">
    <span class="dash-card-title-dot" style="background:#fb923c"></span>${_dashEscape(_dashT('dashTechDebtTitle'))}
  </div>
  <div class="dash-debt-body">
    <div class="dash-debt-headline">
      <div class="dash-debt-hours">${hours.toFixed(1)}<span class="dash-debt-hours-unit">h</span></div>
      <div class="dash-debt-sub">${_dashEscape(_dashT('dashTechDebtSub'))}</div>
    </div>
    <div class="dash-debt-rows">${rowsHTML}</div>
  </div>
</div>`;
}
