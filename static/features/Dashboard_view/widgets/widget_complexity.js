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
      <span class="dash-card-title-dot" style="background:#a78bfa"></span>${_dashEscape(_dashT('dashComplexityTitle'))}
      <span class="dash-card-sub">avg ${avg.toFixed(1)}</span>
    </div>
    <div class="dash-chart-wrap" style="min-height:220px"><canvas id="${cardId}"></canvas></div>
  </div>
  <div class="dash-card">
    <div class="dash-card-title">
      <span class="dash-card-title-dot" style="background:#f472b6"></span>${_dashEscape(_dashT('dashComplexityTopOffenders'))}
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
                backgroundColor: '#a78bfa66',
                borderColor: '#a78bfa',
                borderWidth: 1.5,
                borderRadius: 4,
            }],
        }, {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { display: false }, ticks: { color: '#94a3b8' } },
                y: { grid: { color: '#1a253588' }, ticks: { color: '#64748b' }, beginAtZero: true },
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
            return `
<div class="dash-list-row" data-tip="${_dashEscape(sym.file)}"
     onclick="_dashJumpToFunction(${JSON.stringify(sym.file).replace(/"/g, '&quot;')}, ${JSON.stringify(sym.name).replace(/"/g, '&quot;')})"
     style="cursor:pointer">
  <span class="dash-list-rank">${i + 1}</span>
  <span class="dash-list-name">${_dashEscape(sym.name)}<span style="color:#64748b;font-size:11px;margin-left:4px">${_dashEscape(fileShort)}</span></span>
  <div class="dash-list-bar" style="width:${pct}px;background:#a78bfa"></div>
  <span class="dash-list-val" style="color:#a78bfa">${sym.complexity}</span>
</div>`;
        }).join('') || `<div class="dash-empty">${_dashEscape(_dashT('dashNoData'))}</div>`;
    }
}

// Jump-through helper — used by Complexity, Duplication, and Issues widgets.
function _dashJumpToFunction(filePath, funcName) {
    if (typeof closeDashboard === 'function') closeDashboard();
    const target = _dashFlatFiles().find(f =>
        (f.path || '').replace(/\\/g, '/') === String(filePath).replace(/\\/g, '/')
    );
    if (target && typeof drillFile === 'function') {
        drillFile(target);
        if (funcName && typeof openCodePanel === 'function') {
            setTimeout(() => openCodePanel(target, funcName), 300);
        }
    }
}
