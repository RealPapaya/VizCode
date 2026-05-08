// @module Dashboard_view/widgets/widget_tech_debt

const _DASH_DEBT_ORDER = [
    { key: 'circular',    label: 'dashDebtCircular'    },
    { key: 'god',         label: 'dashDebtGod'         },
    { key: 'complexity',  label: 'dashDebtComplexity'  },
    { key: 'duplication', label: 'dashDebtDuplication' },
    { key: 'dead',        label: 'dashDebtDead'        },
];

_dashRegisterWidget({
    id: 'tech_debt',
    labelKey: 'dashTechDebtTitle',
    defaultSize: 'M',

    render(container, size, stats) {
        const hours     = Number(stats.tech_debt_hours || 0);
        const breakdown = stats.tech_debt_breakdown || {};
        const colors    = _dashAccentForSlices(_DASH_DEBT_ORDER.length);
        const totalMin  = Object.values(breakdown).reduce((a, n) => a + Number(n || 0), 0);
        const denom     = totalMin || 1;

        const bars = _DASH_DEBT_ORDER.map((d, i) => {
            const minutes = Number(breakdown[d.key] || 0);
            const pct     = Math.round((minutes / denom) * 100);
            const col     = colors[Math.min(i, colors.length - 1)];
            return `<div class="dash-debt-row">
              <span class="dash-debt-row-label">${_dashEscape(_dashT(d.label))}</span>
              <div class="dash-debt-row-track">
                <div class="dash-debt-row-fill" style="width:${pct}%;background:${col}"></div>
              </div>
              <span class="dash-debt-row-value">${minutes}m</span>
            </div>`;
        }).join('');

        container.innerHTML = `
<div class="dash-widget-title">${_dashEscape(_dashT('dashTechDebtTitle'))}</div>
<div class="dash-widget-stat">${hours.toFixed(1)}<small style="font-size:var(--text-xs);color:var(--muted);margin-left:3px">h</small></div>
<div class="dash-debt-rows" style="margin-top:6px;overflow:hidden;flex:1;">${bars}</div>`;
    },

    renderDetail(container, stats) {
        const hours     = Number(stats.tech_debt_hours || 0);
        const breakdown = stats.tech_debt_breakdown || {};
        const colors    = _dashAccentForSlices(_DASH_DEBT_ORDER.length);
        const totalMin  = Object.values(breakdown).reduce((a, n) => a + Number(n || 0), 0);
        const denom     = totalMin || 1;
        const canvasId  = 'dash-detail-debt-pie';

        const { labels, data, colors: sliceColors } = _dashGroupedSlices(
            _DASH_DEBT_ORDER.map(d => _dashT(d.label)),
            _DASH_DEBT_ORDER.map(d => Number(breakdown[d.key] || 0))
        );

        const bars = _DASH_DEBT_ORDER.map((d, i) => {
            const minutes = Number(breakdown[d.key] || 0);
            const pct     = Math.round((minutes / denom) * 100);
            const col     = colors[Math.min(i, colors.length - 1)];
            return `<div class="dash-debt-row">
              <span class="dash-debt-row-label">${_dashEscape(_dashT(d.label))}</span>
              <div class="dash-debt-row-track">
                <div class="dash-debt-row-fill" style="width:${pct}%;background:${col}"></div>
              </div>
              <span class="dash-debt-row-value">${minutes}m</span>
            </div>`;
        }).join('');

        container.innerHTML = `
<div class="dash-card">
  <div class="dash-card-title"><span class="dash-card-title-dot"></span>Total Estimated Debt</div>
  <div style="font-size:var(--text-display);font-weight:700;color:#DFA745;line-height:1;padding:12px 0 4px">
    ${hours.toFixed(1)}<span style="font-size:var(--text-base);color:var(--muted);margin-left:4px">hours</span>
  </div>
</div>
<div class="dash-card">
  <div class="dash-card-title"><span class="dash-card-title-dot"></span>By Category</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start;margin-top:8px;">
    <div class="dash-chart-wrap" style="min-height:180px;">
      <canvas id="${canvasId}"></canvas>
    </div>
    <div class="dash-debt-rows">${bars}</div>
  </div>
</div>`;

        const canvas = document.getElementById(canvasId);
        if (canvas && typeof Chart !== 'undefined') {
            _dashMkChart(canvas, 'doughnut', {
                labels,
                datasets: [{ data, backgroundColor: sliceColors, borderWidth: 0, hoverOffset: 8 }],
            }, {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, padding: 8 } } },
                cutout: '65%',
            });
        }
    },
});
