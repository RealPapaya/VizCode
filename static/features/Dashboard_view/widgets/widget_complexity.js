// @module Dashboard_view/widgets/widget_complexity

function _dashComplexityBucketFunctions(range) {
    const m = /^(\d+)(?:-(\d+)|\+)$/.exec(String(range || ''));
    if (!m) return [];
    const lo = Number(m[1]);
    const hi = range.includes('+') ? Infinity : Number(m[2] || m[1]);
    return (DATA.stats.complexity_top_offenders || [])
        .filter(sym => Number(sym.complexity || 0) >= lo && Number(sym.complexity || 0) <= hi)
        .map(sym => ({ file: sym.file, name: sym.name, value: `cx ${sym.complexity}` }));
}

_dashRegisterWidget({
    id: 'complexity',
    labelKey: 'dashComplexityTitle',
    defaultSize: 'M',

    render(container, size, stats) {
        const top    = stats.complexity_top_offenders || [];
        const avg    = Number(stats.avg_complexity || 0);
        const colors = _dashAccentForSlices(Math.min(top.length, 5));

        if (size === 'S') {
            const topName = top[0] ? (top[0].name || top[0].file || '?').split('/').pop() : 'n/a';
            const pills = top.slice(0, 3).map(sym => ({
                label: sym.name || '?',
                value: sym.complexity,
                title: sym.file || '',
                onclick: `_dashGoToGraphFile(${_dashJson(sym.file || '')}, ${_dashJson(sym.name || '')})`,
            }));
            container.innerHTML = `
<div class="dash-kpi-s">
  <div class="dash-kpi-s-body">
    <div class="dash-widget-title">${_dashEscape(_dashT('dashComplexityTitle'))}</div>
    <div class="dash-widget-stat">${avg.toFixed(1)}</div>
    <div class="dash-widget-sub">avg &middot; top: ${_dashEscape(topName)}</div>
    ${_dashMiniPills(pills)}
  </div>
</div>`;
            return;
        }

        const limit = size === 'L' ? 8 : 5;
        const maxVal = top[0]?.complexity || 1;
        const rows = top.slice(0, limit).map((sym, i) => {
            const pct      = Math.round((sym.complexity / maxVal) * 60);
            const col      = colors[Math.min(i, colors.length - 1)];
            const fileShort = String(sym.file || '').split('/').pop();
            const fileJSON  = JSON.stringify(sym.file).replace(/"/g, '&quot;');
            const nameJSON  = JSON.stringify(sym.name).replace(/"/g, '&quot;');
            return `<div class="dash-list-row" data-clickable="true" data-tip="${_dashEscape(sym.file)}"
             onclick="_dashDrill(${fileJSON}, ${nameJSON})">
          <span class="dash-list-rank">${i + 1}</span>
          <span class="dash-list-name">${_dashEscape(sym.name)}<span class="dash-list-meta">${_dashEscape(fileShort)}</span></span>
          <div class="dash-list-bar" style="width:${pct}px;background:${col}"></div>
          <span class="dash-list-val">${sym.complexity}</span>
        </div>`;
        }).join('') || `<div class="dash-empty">${_dashEscape(_dashT('dashNoData'))}</div>`;

        container.innerHTML = `
<div style="height:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:var(--space-2);">
  <div class="dash-card-title">
    <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashComplexityTitle'))}
    <span class="dash-card-sub">avg ${avg.toFixed(1)}</span>
  </div>
  <div class="dash-list" style="flex:1;overflow:hidden;" id="dash-cyclo-top">${rows}</div>
</div>`;
    },

    renderDetail(container, stats) {
        const dist   = stats.complexity_distribution || [];
        const top    = stats.complexity_top_offenders || [];
        const avg    = Number(stats.avg_complexity || 0);
        const canvasId = 'dash-detail-cyclo-canvas';
        const colors = _dashAccentForSlices(Math.min(top.length, 5));
        const max    = top[0]?.complexity || 1;

        container.innerHTML = `
<div class="dash-card">
  <div class="dash-card-title">
    <span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashComplexityTitle'))}
    <span class="dash-card-sub">avg ${avg.toFixed(1)}</span>
  </div>
  <div class="dash-chart-wrap" style="min-height:160px;">
    <canvas id="${canvasId}"></canvas>
  </div>
</div>
<div class="dash-card">
  <div class="dash-card-title"><span class="dash-card-title-dot"></span>${_dashEscape(_dashT('dashComplexityTopOffenders'))}</div>
  <div class="dash-list" style="max-height:300px;overflow-y:auto;">
    ${top.map((sym, i) => {
        const pct = Math.round((sym.complexity / max) * 60);
        const col = colors[Math.min(i, colors.length - 1)];
        const fileShort = String(sym.file || '').split('/').pop();
        const fileJSON  = JSON.stringify(sym.file).replace(/"/g, '&quot;');
        const nameJSON  = JSON.stringify(sym.name).replace(/"/g, '&quot;');
        return `<div class="dash-list-row" data-clickable="true" data-tip="${_dashEscape(sym.file)}"
             onclick="_dashDrill(${fileJSON}, ${nameJSON})">
          <span class="dash-list-rank">${i + 1}</span>
          <span class="dash-list-name">${_dashEscape(sym.name)}<span class="dash-list-meta">${_dashEscape(fileShort)}</span></span>
          <div class="dash-list-bar" style="width:${pct}px;background:${col}"></div>
          <span class="dash-list-val">${sym.complexity}</span>
        </div>`;
    }).join('') || `<div class="dash-empty">${_dashEscape(_dashT('dashNoData'))}</div>`}
  </div>
</div>`;

        const canvas = document.getElementById(canvasId);
        if (canvas && typeof Chart !== 'undefined' && dist.length) {
            _dashMkChart(canvas, 'bar', {
                labels: dist.map(b => b.range),
                datasets: [{
                    data: dist.map(b => b.count),
                    backgroundColor: dist.map((_, i) => _dashAccentStop(i)),
                    borderRadius: 6,
                    borderWidth: 0,
                }],
            }, {
                responsive: true, maintainAspectRatio: false,
                onClick: (_evt, elements) => {
                    if (!elements || !elements.length) return;
                    const bucket = dist[elements[0].index];
                    if (bucket) _dashOpenFunctionGroupDrilldown(`Complexity ${bucket.range}`, _dashComplexityBucketFunctions(bucket.range));
                },
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false } },
                    y: { grid: { color: 'rgba(255,255,255,0.06)' }, beginAtZero: true },
                },
            });
        }
    },
});
