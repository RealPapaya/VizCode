// @module Dashboard_view/widgets/widget_complexity
// Function Complexity — distribution histogram (Chart.js) + top offenders list.

function _dashRenderComplexity(container, stats) {
    if (!container) return;

    const dist     = stats.complexity_distribution || [];
    const top      = stats.complexity_top_offenders || [];
    const avg      = Number(stats.avg_complexity || 0);
    const cardId   = 'dash-cyclo-canvas';

    container.innerHTML = `
<div class="dash-grid dash-grid-2">
  <div class="dash-card">
    <div class="dash-card-title">
      <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashComplexityTitle'))}
      <span class="dash-card-sub">avg ${avg.toFixed(1)}</span>
    </div>
    <div class="dash-chart-wrap"><canvas id="${cardId}"></canvas></div>
  </div>
  <div class="dash-card">
    <div class="dash-card-title">
      <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashComplexityTopOffenders'))}
    </div>
    <div class="dash-list" id="dash-cyclo-top"></div>
  </div>
</div>`;

    // ── Histogram ────────────────────────────────────────────────────────────
    const canvas = document.getElementById(cardId);
    const labels = dist.map(b => b.range);
    const vals   = dist.map(b => b.count);
    if (canvas && typeof Chart !== 'undefined' && labels.length) {
        _dashMkChart(canvas, 'bar', {
            labels,
            datasets: [{
                label: _dashT('dashComplexityFunctions'),
                data: vals,
                backgroundColor: _dashAccentTint(0.4),
                borderColor:     _dashAccentTint(1.0),
                borderWidth: 1.5,
                borderRadius: 4,
            }],
        }, {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { display: false } },
                y: { grid: { color: _dashBorderTint(0.6) }, beginAtZero: true },
            },
        });
    }

    // ── Top offenders list (drill-through to code panel) ────────────────────
    const list = document.getElementById('dash-cyclo-top');
    if (list) {
        const max = top[0]?.complexity || 1;
        list.innerHTML = top.map((sym, i) => {
            const pct = Math.round((sym.complexity / max) * 60);
            const fileShort = String(sym.file || '').split('/').pop();
            const fileJSON = JSON.stringify(sym.file).replace(/"/g, '&quot;');
            const nameJSON = JSON.stringify(sym.name).replace(/"/g, '&quot;');
            return `
<div class="dash-list-row" data-clickable="true" data-tip="${_dashEscape(sym.file)}"
     onclick="_dashDrill(${fileJSON}, ${nameJSON})">
  <span class="dash-list-rank">${i + 1}</span>
  <span class="dash-list-name">${_dashEscape(sym.name)}<span class="dash-list-meta">${_dashEscape(fileShort)}</span></span>
  <div class="dash-list-bar" style="width:${pct}px"></div>
  <span class="dash-list-val">${sym.complexity}</span>
</div>`;
        }).join('') || `<div class="dash-empty">${_dashEscape(_dashT('dashNoData'))}</div>`;
    }
}
