// @module Dashboard_view/widgets/widget_tech_debt
// Tech Debt — total hours headline + per-issue minute breakdown. The
// breakdown is rendered as a horizontal bar list (default) or as a pie
// chart showing each category's share of the cleanup effort.

// Per-issue colours come from accent alpha steps at render time —
// no per-key hex (DASHBOARD_DESIGN_SPEC.md §5 rule 2).
const _DASH_DEBT_ORDER = [
    { key: 'circular',    label: 'dashDebtCircular'    },
    { key: 'god',         label: 'dashDebtGod'         },
    { key: 'complexity',  label: 'dashDebtComplexity'  },
    { key: 'duplication', label: 'dashDebtDuplication' },
    { key: 'dead',        label: 'dashDebtDead'        },
];

const _DASH_DEBT_KEY     = 'tech_debt';
const _DASH_DEBT_TYPES   = ['bar', 'pie'];
const _DASH_DEBT_DEFAULT = 'bar';

function _dashRenderTechDebt(container, stats) {
    if (!container) return;

    const hours     = Number(stats.tech_debt_hours || 0);
    const breakdown = stats.tech_debt_breakdown || {};
    const weights   = stats.tech_debt_weights   || {};

    container.innerHTML = `
<div class="dash-card">
  <div class="dash-card-title">
    <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashTechDebtTitle'))}
    ${_dashChartToggleHTML(_DASH_DEBT_KEY, _DASH_DEBT_TYPES, _DASH_DEBT_DEFAULT)}
  </div>
  <div class="dash-debt-body">
    <div class="dash-debt-headline">
      <div class="dash-debt-hours">${hours.toFixed(1)}<span class="dash-debt-hours-unit">h</span></div>
      <div class="dash-debt-sub">${_dashEscape(_dashT('dashTechDebtSub'))}</div>
    </div>
    <div class="dash-debt-render" id="dash-debt-render"></div>
  </div>
</div>`;

    _dashRegisterChartSwitch(_DASH_DEBT_KEY, () => _dashRenderTechDebt(container, stats));

    const type = _dashChartCurrentType(_DASH_DEBT_KEY, _DASH_DEBT_DEFAULT);
    if (type === 'pie') {
        _dashRenderDebtPie(breakdown);
    } else {
        _dashRenderDebtBars(breakdown, weights);
    }
}

function _dashRenderDebtBars(breakdown, weights) {
    const target = document.getElementById('dash-debt-render');
    if (!target) return;
    const totalMinutes = Object.values(breakdown).reduce((a, n) => a + Number(n || 0), 0);
    const denom = totalMinutes || 1;
    const fills = _dashAccentSeries(_DASH_DEBT_ORDER.length);
    const rowsHTML = _DASH_DEBT_ORDER.map((d, i) => {
        const minutes = Number(breakdown[d.key] || 0);
        const pct     = Math.round((minutes / denom) * 100);
        const weight  = Number(weights[d.key] || 0);
        return `
<div class="dash-debt-row">
  <span class="dash-debt-row-label">${_dashEscape(_dashT(d.label))}</span>
  <span class="dash-debt-row-weight">${weight}m / item</span>
  <div class="dash-debt-row-track">
    <div class="dash-debt-row-fill" style="width:${pct}%;background:${fills[i]}"></div>
  </div>
  <span class="dash-debt-row-value">${minutes}m</span>
</div>`;
    }).join('');
    target.innerHTML = `<div class="dash-debt-rows">${rowsHTML}</div>`;
}

function _dashRenderDebtPie(breakdown) {
    const target = document.getElementById('dash-debt-render');
    if (!target) return;
    target.innerHTML = `<div class="dash-chart-wrap"><canvas id="dash-chart-debt"></canvas></div>`;
    const canvas = document.getElementById('dash-chart-debt');
    if (!canvas || typeof Chart === 'undefined') return;

    const labels = _DASH_DEBT_ORDER.map(d => _dashT(d.label));
    const data   = _DASH_DEBT_ORDER.map(d => Number(breakdown[d.key] || 0));
    const fills   = _dashAccentSeries(_DASH_DEBT_ORDER.length);
    const strokes = fills.map(() => _dashAccentTint(1.0));

    _dashMkChart(canvas, 'pie', {
        labels,
        datasets: [{
            data,
            backgroundColor: fills,
            borderColor:     strokes,
            borderWidth: 1.5,
            hoverOffset: 6,
        }],
    }, {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { position: 'right', labels: { boxWidth: 10, padding: 10 } },
            tooltip: {
                callbacks: {
                    label: ctx => ` ${ctx.label}: ${ctx.parsed} min`,
                },
            },
        },
    });
}
