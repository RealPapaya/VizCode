// @module Dashboard_view/widgets/widget_most_complex

_dashRegisterWidget({
    id: 'most_complex',
    labelKey: 'dashMostComplex',
    defaultSize: 'M',

    render(container, size, stats) {
        const all    = stats.complexity_top_offenders || [];
        const top    = all.slice(0, size === 'L' ? 8 : 5);

        if (size === 'S') {
            const item = all[0];
            if (!item) {
                container.innerHTML = `
<div class="dash-kpi-s">
  <div class="dash-kpi-s-body">
    <div class="dash-widget-title">Most Complex</div>
    <div class="dash-widget-sub" style="margin-top:auto">No data</div>
  </div>
</div>`;
                return;
            }
            const val    = item.complexity || item.score || 0;
            const name   = (item.name || item.file || '?').split('/').pop();
            const pills = all.slice(0, 3).map(sym => ({
                label: sym.name || sym.function || '?',
                value: sym.complexity || sym.score || 0,
                title: sym.file || '',
                onclick: `_dashGoToGraphFile(${_dashJson(sym.file || '')}, ${_dashJson(sym.name || sym.function || '')})`,
            }));
            container.innerHTML = `
<div class="dash-kpi-s">
  <div class="dash-kpi-s-body">
    <div class="dash-widget-title">Most Complex</div>
    <div class="dash-widget-stat">${val}</div>
    <div class="dash-widget-sub" title="${_dashEscape(item.file || '')}">${_dashEscape(name)}</div>
    ${_dashMiniPills(pills)}
  </div>
</div>`;
            return;
        }

        if (!top.length) {
            container.innerHTML = `
<div class="dash-widget-title">Most Complex</div>
<div class="dash-empty">No complexity data</div>`;
            return;
        }

        const maxVal = top[0].complexity || top[0].score || 1;
        const colors = _dashAccentForSlices(Math.min(top.length, 5));
        const rows = top.map((item, i) => {
            const val  = item.complexity || item.score || 0;
            const pct  = Math.round((val / maxVal) * 100);
            const col  = colors[Math.min(i, colors.length - 1)];
            const name = (item.name || item.function || item.file || '?').split('/').pop();
            return `<div class="dash-list-row" data-clickable="true" onclick="_dashGoToGraphFile(${_dashJson(item.file || '')}, ${_dashJson(item.name || item.function || '')})">
        <span class="dash-list-rank">${i + 1}</span>
        <span class="dash-list-name" title="${_dashEscape(item.file || '')}">${_dashEscape(name)}</span>
        <div class="dash-list-bar" style="width:${Math.round(pct * 0.55)}px;background:${col}"></div>
        <span class="dash-list-val">${val}</span>
      </div>`;
        }).join('');

        container.innerHTML = `
<div style="height:100%;box-sizing:border-box;display:flex;flex-direction:column;gap:var(--space-2);">
  <div class="dash-widget-title">Most Complex</div>
  <div class="dash-list" style="flex:1;overflow:hidden;">${rows}</div>
</div>`;
    },

    renderDetail(container, stats) {
        const all    = stats.complexity_top_offenders || [];
        const avg    = Number(stats.avg_complexity || 0);
        const dist   = stats.complexity_distribution || [];
        const canvasId = 'dash-detail-complex-chart';
        const colors = _dashAccentForSlices(Math.min(all.length, 5));

        container.innerHTML = `
<div class="dash-card">
  <div class="dash-card-title"><span class="dash-card-title-dot"></span>Distribution <span class="dash-card-sub">avg ${avg.toFixed(1)}</span></div>
  <div class="dash-chart-wrap" style="min-height:160px;">
    <canvas id="${canvasId}"></canvas>
  </div>
</div>
<div class="dash-card">
  <div class="dash-card-title"><span class="dash-card-title-dot"></span>All Offenders</div>
  <div class="dash-list" style="max-height:320px;overflow-y:auto;">
    ${all.map((item, i) => {
        const val  = item.complexity || item.score || 0;
        const max2 = all[0] ? (all[0].complexity || all[0].score || 1) : 1;
        const pct  = Math.round((val / max2) * 100);
        const col  = colors[Math.min(i, colors.length - 1)];
        const name = (item.name || item.function || '?');
        const file = (item.file || '').split('/').pop();
        return `<div class="dash-list-row" data-clickable="true" onclick="_dashGoToGraphFile(${_dashJson(item.file || '')}, ${_dashJson(item.name || item.function || '')})">
          <span class="dash-list-rank">${i + 1}</span>
          <span class="dash-list-name" title="${_dashEscape(item.file || '')}">${_dashEscape(name)}<span style="color:var(--muted);font-size:10px;margin-left:6px;">${_dashEscape(file)}</span></span>
          <div class="dash-list-bar" style="width:${Math.round(pct * 0.5)}px;background:${col}"></div>
          <span class="dash-list-val">${val}</span>
        </div>`;
    }).join('') || '<div class="dash-empty">No data</div>'}
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
                    y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.06)' } },
                    x: { grid: { display: false } },
                },
            });
        }
    },
});
